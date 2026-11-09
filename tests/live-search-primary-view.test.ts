// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createApp, nextTick, ref, watch } from 'vue';
import LiveSearchPrimaryPane from '@/components/sidebar/LiveSearchPrimaryPane.vue';
import LiveSearchConsoleSettingsPane from '@/components/sidebar/LiveSearchConsoleSettingsPane.vue';
import { createInMemoryPreferencesStorage, createPreferencesModule } from '@/utils/preferences';
import { setMockDictionaries } from '@/utils/trade-stat-dictionary';
import { useTradeSearchPreview } from '@/components/sidebar/composables/useTradeSearchPreview';
import TradeSearchPreviewTooltip from '@/components/sidebar/search-preview/TradeSearchPreviewTooltip.vue';
import { createLiveSearchPrimaryController } from '@/entrypoints/content/logic/live-search-primary-controller';
import {
  createLiveSearchSourceController,
  type LiveSearchBatchOutcome,
  type LiveSearchBookmarkSourcePort,
  type LiveSearchSourceController,
  type LiveSearchSourceSnapshot,
} from '@/entrypoints/content/logic/live-search-bookmark-controller';
import { LiveSearchPrimaryRuntime } from '@/entrypoints/content/logic/live-search-primary-runtime';
import { LiveSearchFetchRateGate } from '@/entrypoints/content/logic/live-search-fetch-rate-gate';
import { LiveSearchOpenScheduler } from '@/entrypoints/content/logic/live-search-open-scheduler';
import {
  createLiveSearchConsoleTitleGuard,
  LIVE_SEARCH_CONSOLE_TITLE,
} from '@/entrypoints/content/logic/live-search-console-title';
import { createLiveSearchResumeStore } from '@/utils/live-search-resume-store';
import { createLiveSearchResumeController } from '@/entrypoints/content/logic/live-search-resume-controller';
import { listenPoeEvent } from '@/utils/event-contracts';
import type {
  EnsureContainerOptions,
  HostCommandOutcome,
  ILiveSearchHostClient,
  RenderResultOptions,
  ResetUnreadOptions,
} from '@/entrypoints/content/logic/live-search-host-client';

let customLoadTradeDictionariesImpl: ((version?: 'poe1' | 'poe2') => Promise<void>) | null = null;

vi.mock('@/utils/trade-stat-dictionary', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/trade-stat-dictionary')>();
  return {
    ...actual,
    loadTradeDictionaries: vi.fn(async (version: 'poe1' | 'poe2' = 'poe1') => {
      if (customLoadTradeDictionariesImpl) {
        await customLoadTradeDictionariesImpl(version);
      }
    }),
  };
});

function createMockMixedLeagueOutcome(): LiveSearchBatchOutcome {
  return {
    success: false,
    requested: 2,
    succeeded: 0,
    skipped: 0,
    failed: 2,
    rejectReason: 'mixed-league',
    error: '選取項目包含多個聯盟',
    skipReasons: {
      alreadyActive: 0,
      pending: 0,
      incompatible: 0,
      duplicateInBatch: 0,
      notFound: 0,
      inactive: 0,
    },
    incompatibleBreakdown: { invalidUrl: 0, wrongVersion: 0, wrongLeague: 0 },
    runtimeFailureCount: 0,
  };
}

function createGzipTradeUrl(queryPayload: any, version: 'poe1' | 'poe2' = 'poe2'): string {
  const hash = gzipSync(Buffer.from(JSON.stringify(queryPayload), 'utf8')).toString('base64url');
  return version === 'poe2'
    ? `https://www.pathofexile.com/trade2/search/poe2/Standard/${hash}`
    : `https://www.pathofexile.com/trade/search/Standard/${hash}`;
}

class FakeWebSocket {
  public url: string;
  public onopen: ((ev: Event) => void) | null = null;
  public onerror: ((ev: Event) => void) | null = null;
  public onclose: ((ev: CloseEvent) => void) | null = null;
  public onmessage: ((ev: MessageEvent) => void) | null = null;
  public readyState = 0;
  public closed = false;

  constructor(url: string) {
    this.url = url;
  }

  public triggerOpen(): void {
    if (this.onopen && !this.closed) {
      this.readyState = 1;
      this.onopen(new Event('open'));
    }
  }

  public triggerError(message: string): void {
    if (this.onerror && !this.closed) {
      this.onerror(new Error(message) as unknown as Event);
    }
  }

  public triggerClose(): void {
    this.close();
  }

  public close(): void {
    this.closed = true;
    this.readyState = 3;
    if (this.onclose) {
      this.onclose(new CloseEvent('close'));
    }
  }
}

class FakeHostClient implements ILiveSearchHostClient {
  public async ensureContainer(_options: EnsureContainerOptions): Promise<HostCommandOutcome> {
    return { success: true };
  }

  public async renderResult(_options: RenderResultOptions): Promise<HostCommandOutcome> {
    return { success: true };
  }

  public async resetUnread(_options: ResetUnreadOptions): Promise<HostCommandOutcome> {
    return { success: true };
  }

  public dispose(): void {}
}

function mountComponent(props: any) {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const app = createApp(LiveSearchPrimaryPane, props);
  app.mount(container);

  return {
    container,
    app,
    unmount: () => {
      app.unmount();
      container.remove();
    },
  };
}

describe('LiveSearchPrimaryPane UI & Lifecycle Tests', () => {
  let hostClient: FakeHostClient;
  let createdSockets: FakeWebSocket[];
  let webSocketFactory: (url: string) => WebSocket;
  let runtime: LiveSearchPrimaryRuntime;

  beforeEach(() => {
    document.body.innerHTML = '';
    customLoadTradeDictionariesImpl = null;
    hostClient = new FakeHostClient();
    createdSockets = [];
    webSocketFactory = (url: string) => {
      const ws = new FakeWebSocket(url);
      createdSockets.push(ws);
      return ws as unknown as WebSocket;
    };
    runtime = new LiveSearchPrimaryRuntime('poe1', {
      hostClient,
      webSocketFactory,
      openScheduler: new LiveSearchOpenScheduler({ cooldownMs: 0 }),
    });
  });

  const flushAsync = async (ms = 50) => {
    await nextTick();
    await new Promise((r) => setTimeout(r, ms));
    await nextTick();
  };

  it('renders safe unavailable state when controller is null or undefined without exposing internal Primary terminology', async () => {
    const { container, unmount } = mountComponent({ controller: null });

    const unavailable = container.querySelector('[data-test="controller-unavailable"]');
    expect(unavailable).not.toBeNull();
    expect(unavailable?.textContent).toContain('線上搜尋主控台尚未完成初始化');
    expect(unavailable?.textContent).not.toMatch(/primary/i);
    expect(container.querySelector('[data-test="runtime-summary"]')).toBeNull();

    unmount();
  });

  it('allows user to open Custom URL form, input canonical URL, creates Custom Source under 搜尋連線, starts subscription, and updates row and compact header', async () => {
    const controller = createLiveSearchPrimaryController(runtime);
    const { container, unmount } = mountComponent({ controller });

    await flushAsync();

    // 驗證 Pane 內部不再渲染重複頂部標題列、不再有獨立「作用中訂閱」或「書籤快速加入」
    expect(container.querySelector('[data-test="console-version-label"]')).toBeNull();
    expect(container.textContent).not.toContain('線上搜尋主控台');
    expect(container.textContent).not.toContain('作用中訂閱');
    expect(container.textContent).not.toContain('書籤快速加入');
    expect(container.textContent).not.toMatch(/primary/i);
    expect(container.querySelector('[data-test="runtime-summary"]')).not.toBeNull();

    // 驗證單一捲動區契約 (ScrollAreaViewport + pb-[var(--pxd-pane-scroll-end-space)])
    const connectionsList = container.querySelector('[data-test="search-connections-list"]');
    expect(connectionsList).not.toBeNull();
    expect(connectionsList?.hasAttribute('data-reka-scroll-area-viewport')).toBe(true);
    expect(connectionsList?.classList.contains('pxd-scrollbar')).toBe(false);
    expect(connectionsList?.className).toContain('pb-[var(--pxd-pane-scroll-end-space)]');

    // 初始狀態：尚無連線項目，且無自訂網址時不顯示空「自訂網址」群組
    expect(container.querySelector('[data-test="connections-empty"]')).not.toBeNull();
    expect(
      container.querySelector('[data-test="connection-group"][data-group-kind="custom"]'),
    ).toBeNull();
    // Compact Header 常駐呈現 League Selector
    expect(container.querySelector('[data-test="summary-league"]')?.textContent?.trim()).toBe(
      'Standard',
    );
    expect(container.querySelector('[data-test="summary-count"]')?.textContent?.trim()).toBe(
      '0 監聽',
    );
    // 預設不顯示累計渲染
    expect(container.querySelector('[data-test="summary-rendered"]')).toBeNull();

    // 建立暫時搜尋連線
    await controller.addFromUrl(
      'https://www.pathofexile.com/trade/search/Standard/H4sImysearch123',
      {
        name: '神聖石監聽',
      },
    );
    await flushAsync();

    // 自訂網址群組與項目應出現在「搜尋連線」列表中
    expect(
      container.querySelector('[data-test="connection-group"][data-group-kind="custom"]'),
    ).not.toBeNull();
    const row = container.querySelector('[data-test="connection-item-name"]');
    expect(row).not.toBeNull();
    expect(row?.textContent?.trim()).toBe('神聖石監聽');

    // 狀態初始為連線中（單一按鈕轉為旋轉圖示且不可按）
    const connectingBtn = container.querySelector(
      '[data-test^="btn-connecting-"]',
    ) as HTMLButtonElement;
    expect(connectingBtn).not.toBeNull();
    expect(connectingBtn.disabled).toBe(true);
    expect(connectingBtn.getAttribute('data-status')).toBe('連線中');

    // WebSocket open 後變為監聽中（單一按鈕轉為暫停按鈕）
    const ws = createdSockets[0];
    expect(ws).toBeDefined();
    ws.triggerOpen();
    await nextTick();
    await nextTick();

    const activeStopBtn = container.querySelector('[data-test^="btn-stop-"]') as HTMLButtonElement;
    expect(activeStopBtn).not.toBeNull();
    expect(activeStopBtn.getAttribute('data-status')).toBe('監聽中');

    // Compact Summary 更新：顯示已鎖定聯盟與監聽數
    const summaryLeague = container.querySelector('[data-test="summary-league"]');
    expect(summaryLeague?.textContent?.trim()).toBe('Standard');
    const countBadge = container.querySelector('[data-test="summary-count"]');
    expect(countBadge?.textContent?.trim()).toBe('1 監聽');

    unmount();
  });

  it('supports Custom URL full lifecycle: stop keeps source as 未啟用, enable restarts, and remove stops runtime and deletes source', async () => {
    const controller = createLiveSearchPrimaryController(runtime);
    const sourceController = createLiveSearchSourceController(null, controller);
    const { container, unmount } = mountComponent({ controller, sourceController });

    await flushAsync();

    await sourceController.addCustom(
      'https://www.pathofexile.com/trade/search/Standard/H4sIitem-to-stop',
      { name: '測試自訂搜尋' },
    );
    await flushAsync();
    createdSockets[0].triggerOpen();
    await flushAsync();

    expect(container.querySelector('[data-test="connection-item-name"]')?.textContent?.trim()).toBe(
      '測試自訂搜尋',
    );
    expect(runtime.getSubscriptions()).toHaveLength(1);

    // 1. 點擊暫停按鈕：Runtime 訂閱移除，但自訂網址項目保留並轉為 未啟用
    const stopBtn = container.querySelector('[data-test^="btn-stop-"]') as HTMLButtonElement;
    expect(stopBtn).not.toBeNull();
    stopBtn.click();
    await flushAsync();

    expect(runtime.getSubscriptions()).toHaveLength(0);
    expect(container.querySelector('[data-test="connection-item-name"]')?.textContent?.trim()).toBe(
      '測試自訂搜尋',
    );
    const enableBtn = container.querySelector('[data-test^="btn-enable-"]') as HTMLButtonElement;
    expect(enableBtn).not.toBeNull();
    expect(enableBtn.getAttribute('data-status')).toBe('未啟用');

    // 2. 點擊啟用按鈕：以同一 URL 與名稱重新建立 Runtime 訂閱
    enableBtn.click();
    await flushAsync();

    expect(runtime.getSubscriptions()).toHaveLength(1);
    expect(runtime.getSubscriptions()[0].name).toBe('測試自訂搜尋');
    const reconnectingBtn = container.querySelector(
      '[data-test^="btn-connecting-"]',
    ) as HTMLButtonElement;
    expect(reconnectingBtn?.getAttribute('data-status')).toBe('連線中');

    // 3. 在監聽/連線中透過次要選單點擊移除：先停止 Runtime 訂閱，再從「自訂網址」刪除
    const itemMenuBtn = container.querySelector(
      '[data-test^="btn-item-menu-"]',
    ) as HTMLButtonElement;
    expect(itemMenuBtn).not.toBeNull();
    itemMenuBtn.click();
    await flushAsync();

    const removeBtn = document.body.querySelector('[data-test^="btn-remove-"]') as HTMLElement;
    expect(removeBtn).not.toBeNull();
    removeBtn.click();
    await flushAsync();

    expect(runtime.getSubscriptions()).toHaveLength(0);
    expect(container.querySelector('[data-test="connection-item-name"]')).toBeNull();
    expect(
      container.querySelector('[data-test="connection-group"][data-group-kind="custom"]'),
    ).toBeNull();
    expect(container.querySelector('[data-test="connections-empty"]')).not.toBeNull();

    unmount();
  });

  it('dispatches toast error when addCustom fails with invalid url and does not render inline banner', async () => {
    const toasts: any[] = [];
    const removeToastListener = listenPoeEvent('poexd-toast', (detail) => {
      toasts.push(detail);
    });

    const controller = createLiveSearchPrimaryController(runtime);
    const sourceController = createLiveSearchSourceController(null, controller);
    const { container, unmount } = mountComponent({ controller, sourceController });

    await flushAsync();

    await sourceController.addCustom(
      'https://www.pathofexile.com/trade/search/Standard/H4sIitem-to-fail',
      { name: '測試' },
    );
    await flushAsync();

    const item = sourceController.read().groups[0]?.items[0];
    expect(item).toBeDefined();
    sourceController.stop(item!.id);
    await flushAsync();

    vi.spyOn(sourceController, 'enable').mockResolvedValueOnce({
      success: false,
      error: '啟用搜尋連線失敗',
    });

    const enableBtn = container.querySelector('[data-test^="btn-enable-"]') as HTMLButtonElement;
    expect(enableBtn).not.toBeNull();
    enableBtn.click();
    await flushAsync();

    // 驗證未產生 inline 冗餘橫幅，而是透過 toast 呈現
    expect(container.querySelector('[data-test="pane-error-message"]')).toBeNull();
    expect(toasts.length).toBeGreaterThan(0);
    expect(toasts[toasts.length - 1].message).toContain('啟用搜尋連線失敗');
    expect(toasts[toasts.length - 1].tone).toBe('error');

    removeToastListener();
    unmount();
  });

  it('displays status reconnecting with countdown and error message when websocket encounters error', async () => {
    const controller = createLiveSearchPrimaryController(runtime);
    const sourceController = createLiveSearchSourceController(null, controller);
    const { container, unmount } = mountComponent({ controller, sourceController });

    await flushAsync();

    await sourceController.addCustom(
      'https://www.pathofexile.com/trade/search/Standard/H4sIws-err-search',
      {
        name: '重連測試',
      },
    );
    await flushAsync();

    const ws = createdSockets[0];
    ws.triggerError('WS Connection Aborted');

    await flushAsync();

    const connectingBtn = container.querySelector(
      '[data-test^="btn-connecting-"]',
    ) as HTMLButtonElement;
    expect(connectingBtn).not.toBeNull();
    expect(connectingBtn.disabled).toBe(true);
    expect(connectingBtn.getAttribute('data-status')).toMatch(/重連 \d+ 秒/);

    const rowError = container.querySelector('[data-test^="error-"]');
    expect(rowError?.textContent).toContain('WS Connection Aborted');

    // 尚未進入 terminal error，不顯示重試按鈕，單一主按鈕為 disabled 旋轉狀態，停止收納於次要選單
    expect(container.querySelector('[data-test^="btn-retry-"]')).toBeNull();
    const itemMenu = container.querySelector('[data-test^="btn-item-menu-"]') as HTMLButtonElement;
    expect(itemMenu).not.toBeNull();
    itemMenu.click();
    await flushAsync();
    expect(document.body.querySelector('[data-test^="btn-stop-"]')).not.toBeNull();

    unmount();
  });

  it('displays terminal failure with retry button, updates compact error count, and triggers retry upon clicking', async () => {
    const terminalRuntime = new LiveSearchPrimaryRuntime('poe1', {
      hostClient,
      webSocketFactory,
      openScheduler: new LiveSearchOpenScheduler({ cooldownMs: 0 }),
      reconnectPolicy: { maxFailedAttempts: 0 },
    });
    const controller = createLiveSearchPrimaryController(terminalRuntime);
    const sourceController = createLiveSearchSourceController(null, controller);
    const { container, unmount } = mountComponent({ controller, sourceController });

    await flushAsync();

    await sourceController.addCustom(
      'https://www.pathofexile.com/trade/search/Standard/H4sIterminal-search',
      {
        name: '終態測試',
      },
    );
    await flushAsync();

    const ws = createdSockets[createdSockets.length - 1];
    ws.triggerClose();

    await flushAsync();

    const retryBtn = container.querySelector<HTMLButtonElement>('[data-test^="btn-retry-"]');
    expect(retryBtn).not.toBeNull();
    expect(retryBtn?.getAttribute('data-status')).toBe('異常');

    // 驗證 Compact Status Header 與 Group Header 異常數量
    expect(container.querySelector('[data-test="summary-count"]')?.textContent?.trim()).toBe(
      '0 監聽',
    );
    expect(container.querySelector('[data-test="summary-error-count"]')?.textContent?.trim()).toBe(
      '1 異常',
    );
    expect(
      container.querySelector('[data-test="connection-group-error-count"]')?.textContent?.trim(),
    ).toBe('1 異常');

    // 異常視為因錯誤而停止：左側紅條 + 單一重試按鈕，次要選單不再顯示冗餘「停止連線」
    const rowEl = container.querySelector('[data-test="connection-item"]');
    expect(rowEl?.className).toContain('border-l-destructive');
    expect(container.querySelector('[data-test^="btn-stop-"]')).toBeNull();

    const itemMenu = container.querySelector('[data-test^="btn-item-menu-"]') as HTMLButtonElement;
    expect(itemMenu).not.toBeNull();
    itemMenu.click();
    await flushAsync();
    expect(document.body.querySelector('[data-test^="btn-stop-"]')).toBeNull();
    expect(document.body.querySelector('[data-test^="btn-remove-"]')).not.toBeNull();

    // 點擊重試
    retryBtn?.click();
    await flushAsync();

    const connectingBtnAfterRetry = container.querySelector(
      '[data-test^="btn-connecting-"]',
    ) as HTMLButtonElement;
    expect(connectingBtnAfterRetry?.getAttribute('data-status')).toBe('連線中');
    expect(container.querySelector('[data-test="summary-count"]')?.textContent?.trim()).toBe(
      '1 監聽',
    );
    expect(container.querySelector('[data-test="summary-error-count"]')).toBeNull();

    unmount();
  });

  it('renders 本次連線 and 上次連線 sections, supports removing connections, and supports combined search + status filtering', async () => {
    const filterRuntime = new LiveSearchPrimaryRuntime('poe1', {
      hostClient,
      webSocketFactory,
      openScheduler: new LiveSearchOpenScheduler({ cooldownMs: 0 }),
      reconnectPolicy: { maxFailedAttempts: 0 },
    });
    const controller = createLiveSearchPrimaryController(filterRuntime);

    const port: LiveSearchBookmarkSourcePort = {
      readCollection: async () => ({
        ok: true,
        value: {
          groups: [{ id: 'grp_cards', name: '命運卡', order: 0 } as any],
          bookmarks: [
            {
              id: 'bmk_doctor',
              name: '瘋醫',
              url: 'https://www.pathofexile.com/trade/search/Standard/H4sIdoctor',
              leaguePinned: true,
              groupId: 'grp_cards',
              searchRecordId: 'rec_doc',
              gameVersion: 'poe1',
              order: 0,
            },
            {
              id: 'bmk_apothecary',
              name: '藥劑師',
              url: 'https://www.pathofexile.com/trade/search/Standard/H4sIapothecary',
              leaguePinned: true,
              groupId: 'grp_cards',
              searchRecordId: 'rec_apo',
              gameVersion: 'poe1',
              order: 1,
            },
          ],
        },
      }),
      subscribe: () => () => {},
    };

    const resumeStorage = {
      async get() {
        return {
          liveSearchResumePlan_poe1: {
            version: 2,
            identities: [
              { gameVersion: 'poe1', league: 'standard', searchId: 'H4sIdoctor' },
              { gameVersion: 'poe1', league: 'standard', searchId: 'H4sIapothecary' },
            ],
          },
        };
      },
      async set() {},
      async remove() {},
    };
    const resumeStore = createLiveSearchResumeStore('poe1', resumeStorage);
    const sourceController = createLiveSearchSourceController(port, controller, { resumeStore });
    const { container, unmount } = mountComponent({
      controller,
      sourceController,
    });

    await flushAsync();

    // 啟用「藥劑師」書籤並使其進入 active (已啟用，移入「本次連線」)
    const apothecaryEnableBtn = container.querySelector(
      '[data-test="btn-enable-bmk_apothecary"]',
    ) as HTMLButtonElement;
    expect(apothecaryEnableBtn).not.toBeNull();
    apothecaryEnableBtn.click();
    await flushAsync();
    createdSockets[0].triggerOpen();
    await flushAsync();

    // 新增一筆自訂網址並使其進入 terminal error (異常)
    await sourceController.addCustom(
      'https://www.pathofexile.com/trade/search/Standard/H4sIheadhunter_xyz',
      {
        name: '獵首',
      },
    );
    await flushAsync();
    createdSockets[1].triggerClose();
    await flushAsync();

    // 驗證「本次連線」與「上次連線」兩個分區皆正確呈現
    expect(container.querySelector('[data-group-id="session_connections"]')).not.toBeNull();
    expect(container.querySelector('[data-group-id="previous_connections"]')).not.toBeNull();

    const customMenuBtn = container.querySelector(
      '[data-source-id^="custom_"] [data-test^="btn-item-menu-"]',
    ) as HTMLButtonElement;
    expect(customMenuBtn).not.toBeNull();
    customMenuBtn.click();
    await flushAsync();
    expect(document.body.querySelector('[data-test^="btn-remove-custom_"]')).not.toBeNull();

    // 驗證狀態篩選：「已啟用」只包含藥劑師
    const filterEnabled = container.querySelector(
      '[data-test="filter-status-enabled"]',
    ) as HTMLButtonElement;
    filterEnabled.click();
    await flushAsync();
    let visibleNames = Array.from(
      container.querySelectorAll('[data-test="connection-item-name"]'),
    ).map((el) => el.textContent?.trim());
    expect(visibleNames).toEqual(['藥劑師']);

    // 驗證狀態篩選：「未啟用」只包含瘋醫（位於上次連線）
    const filterDisabled = container.querySelector(
      '[data-test="filter-status-disabled"]',
    ) as HTMLButtonElement;
    filterDisabled.click();
    await flushAsync();
    visibleNames = Array.from(container.querySelectorAll('[data-test="connection-item-name"]')).map(
      (el) => el.textContent?.trim(),
    );
    expect(visibleNames).toEqual(['瘋醫']);

    // 驗證狀態篩選：「異常」只包含獵首
    const filterAbnormal = container.querySelector(
      '[data-test="filter-status-error"]',
    ) as HTMLButtonElement;
    filterAbnormal.click();
    await flushAsync();
    visibleNames = Array.from(container.querySelectorAll('[data-test="connection-item-name"]')).map(
      (el) => el.textContent?.trim(),
    );
    expect(visibleNames).toEqual(['獵首']);

    // 切回「全部」並搭配搜尋輸入框（支援名稱、分區名、searchId、ESC 清空）
    const filterAll = container.querySelector(
      '[data-test="filter-status-all"]',
    ) as HTMLButtonElement;
    filterAll.click();
    await flushAsync();

    const searchInput = container.querySelector(
      '[data-test="search-connections-input"]',
    ) as HTMLInputElement;
    searchInput.value = 'headhunter_xyz';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    await flushAsync();
    visibleNames = Array.from(container.querySelectorAll('[data-test="connection-item-name"]')).map(
      (el) => el.textContent?.trim(),
    );
    expect(visibleNames).toEqual(['獵首']);

    // 按下 ESC 清空搜尋
    searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flushAsync();
    expect(searchInput.value).toBe('');
    visibleNames = Array.from(container.querySelectorAll('[data-test="connection-item-name"]')).map(
      (el) => el.textContent?.trim(),
    );
    expect(visibleNames).toEqual(['藥劑師', '獵首', '瘋醫']);

    unmount();
  });

  describe('Rate Limit Compact UI Projection', () => {
    it('projects initial compact rate status (API ● 正常), updates dynamically on 200 headers, and immediately reflects 429 waiting state (API ◐ 等待 15s)', async () => {
      let nowMs = Date.now();
      let sleepResolvers: Array<() => void> = [];
      let fetchCallCount = 0;
      const fetchFn = vi.fn(async () => {
        fetchCallCount += 1;
        if (fetchCallCount === 1) {
          return new Response(JSON.stringify({ result: [{ id: 'item-1' }] }), {
            status: 200,
            headers: {
              'x-rate-limit-policy': 'trade-fetch-request-limit',
              'x-rate-limit-rules': 'Account,CustomRule',
              'x-rate-limit-account': '3:4:60,6:12:300',
              'x-rate-limit-account-state': '2:4:0,3:12:0',
              'x-rate-limit-customrule': '10:30:120',
              'x-rate-limit-customrule-state': '4:30:0',
            },
          });
        }
        if (fetchCallCount === 2) {
          return new Response('Too Many Requests', {
            status: 429,
            headers: {
              'retry-after': '15',
              'x-rate-limit-policy': 'trade-fetch-request-limit',
              'x-rate-limit-rules': 'Account',
              'x-rate-limit-account': '3:4:60',
              'x-rate-limit-account-state': '3:4:15',
            },
          });
        }
        return new Response(JSON.stringify({ result: [{ id: 'item-2' }] }), {
          status: 200,
          headers: {
            'x-rate-limit-policy': 'trade-fetch-request-limit',
            'x-rate-limit-rules': 'Account',
            'x-rate-limit-account': '3:4:60',
            'x-rate-limit-account-state': '1:4:0',
          },
        });
      });

      const fetchRateGate = new LiveSearchFetchRateGate({
        fetchClient: fetchFn as unknown as typeof fetch,
        timer: {
          now: () => nowMs,
          setTimeout: (cb) => {
            sleepResolvers.push(cb);
            return sleepResolvers.length;
          },
          clearTimeout: () => {},
        },
      });

      const rateRuntime = new LiveSearchPrimaryRuntime('poe1', {
        hostClient,
        webSocketFactory,
        openScheduler: new LiveSearchOpenScheduler({ cooldownMs: 0 }),
        fetchRateGate,
      });
      const controller = createLiveSearchPrimaryController(rateRuntime);
      const sourceController = createLiveSearchSourceController(null, controller);

      const { container, unmount } = mountComponent({ controller, sourceController });
      await flushAsync();

      // 1. 尚未收到任何 /fetch header 時的預設狀態
      expect(container.querySelector('[data-test="rate-limit-status"]')?.textContent?.trim()).toBe(
        'API ● 正常',
      );
      const detailsEl = container.querySelector('[data-test="rate-limit-details"]') as HTMLElement;
      expect(detailsEl.style.display).toBe('none');

      // 展開明細：顯示「尚未收到速率限制資料」
      const toggleBtn = container.querySelector(
        '[data-test="btn-toggle-rate-details"]',
      ) as HTMLButtonElement;
      toggleBtn.click();
      await flushAsync();
      expect(detailsEl.style.display).not.toBe('none');
      expect(container.querySelector('[data-test="rate-limit-policy"]')).toBeNull();
      expect(
        container.querySelector('[data-test="rate-limit-next-allowed"]')?.textContent?.trim(),
      ).toBe('下一次可請求：立即');
      expect(container.querySelector('[data-test="rate-limit-empty"]')?.textContent).toContain(
        '尚未收到速率限制資料',
      );

      // 2. 建立訂閱並推送第 1 筆新物品 -> 觸發 200 /fetch
      await sourceController.addCustom(
        'https://www.pathofexile.com/trade/search/Standard/H4sIrate-test',
        {
          name: '速率測試',
        },
      );
      await flushAsync();
      const ws = createdSockets[0];
      ws.triggerOpen();
      ws.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ result: 'item-1' }) }));
      await flushAsync();

      expect(container.querySelector('[data-test="rate-limit-status"]')?.textContent?.trim()).toBe(
        'API ● 正常',
      );
      expect(container.querySelector('[data-test="rate-limit-policy"]')).toBeNull();
      expect(
        container.querySelector('[data-test="rate-limit-next-allowed"]')?.textContent?.trim(),
      ).toBe('下一次可請求：立即');

      const detailsText =
        container.querySelector('[data-test="rate-limit-details"]')?.textContent || '';
      expect(detailsText).toContain('帳號');
      expect(detailsText).toContain('2 / 3');
      expect(detailsText).toContain('統計區間 4 秒');
      expect(detailsText).toContain('冷卻時間 60 秒');
      expect(detailsText).toContain('3 / 6');
      expect(detailsText.toLowerCase()).toContain('customrule');
      expect(detailsText).toContain('4 / 10');

      // 3. 推送第 2 筆新物品 -> 收到 429，在 retry sleep 尚未結束前 UI 立即更新為「API ◐ 等待 15 秒」
      ws.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ result: 'item-2' }) }));
      await flushAsync();

      expect(container.querySelector('[data-test="rate-limit-status"]')?.textContent?.trim()).toBe(
        'API ◐ 等待 15 秒',
      );
      expect(
        container.querySelector('[data-test="rate-limit-next-allowed"]')?.textContent?.trim(),
      ).toBe('下一次可請求：15 秒');
      expect(container.querySelector('[data-test="rate-limit-details"]')?.textContent).toContain(
        '冷卻剩餘 15 秒',
      );

      // 釋放 sleep 完成重試後，恢復正常
      nowMs += 15_000;
      while (sleepResolvers.length > 0) {
        const r = sleepResolvers.shift()!;
        r();
        await flushAsync();
      }

      expect(container.querySelector('[data-test="rate-limit-status"]')?.textContent?.trim()).toBe(
        'API ● 正常',
      );
      expect(
        container.querySelector('[data-test="rate-limit-next-allowed"]')?.textContent?.trim(),
      ).toBe('下一次可請求：立即');

      unmount();
    });

    it('returns to API ● 正常 / 立即 and decays displayed Cooldown Left to 0 after 15s when server returns cooldownLeft = 15 and no further response arrives', async () => {
      let currentNowMs = 100_000;
      const dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => currentNowMs);
      try {
        const fetchFn = vi.fn(async () => {
          return new Response(JSON.stringify({ result: [{ id: 'item-cooldown' }] }), {
            status: 200,
            headers: {
              'x-rate-limit-policy': 'trade-fetch-request-limit',
              'x-rate-limit-rules': 'Account',
              'x-rate-limit-account': '12:4:60',
              'x-rate-limit-account-state': '12:4:15',
            },
          });
        });

        const fetchRateGate = new LiveSearchFetchRateGate({
          fetchClient: fetchFn as unknown as typeof fetch,
          timer: {
            now: () => currentNowMs,
            setTimeout: (cb, ms) => setTimeout(cb, ms),
            clearTimeout: (id) => clearTimeout(id as any),
          },
        });

        const rateRuntime = new LiveSearchPrimaryRuntime('poe1', {
          hostClient,
          webSocketFactory,
          openScheduler: new LiveSearchOpenScheduler({ cooldownMs: 0 }),
          fetchRateGate,
        });
        const controller = createLiveSearchPrimaryController(rateRuntime);
        const sourceController = createLiveSearchSourceController(null, controller);

        const { container, unmount } = mountComponent({ controller, sourceController });
        await flushAsync();

        // 展開明細
        const toggleBtn = container.querySelector(
          '[data-test="btn-toggle-rate-details"]',
        ) as HTMLButtonElement;
        toggleBtn.click();
        await flushAsync();

        await sourceController.addCustom(
          'https://www.pathofexile.com/trade/search/Standard/H4sIcooldown-decay-test',
          {
            name: '冷卻衰減測試',
          },
        );
        await flushAsync();

        const ws = createdSockets[0];
        ws.triggerOpen();
        ws.onmessage?.(
          new MessageEvent('message', { data: JSON.stringify({ result: 'item-cooldown' }) }),
        );
        await flushAsync();

        // 收到 cooldownLeft = 15 時，狀態為 API ◐ 等待 15 秒，下一次可請求 15 秒，冷卻剩餘 15 秒
        expect(
          container.querySelector('[data-test="rate-limit-status"]')?.textContent?.trim(),
        ).toBe('API ◐ 等待 15 秒');
        expect(
          container.querySelector('[data-test="rate-limit-next-allowed"]')?.textContent?.trim(),
        ).toBe('下一次可請求：15 秒');
        expect(container.querySelector('[data-test="rate-limit-details"]')?.textContent).toContain(
          '冷卻剩餘 15 秒',
        );
        expect(container.querySelector('[data-test="rate-limit-details"]')?.textContent).toContain(
          '區間剩餘 4 秒',
        );

        // 之後沒有任何新 response，時間往後經過 15 秒，等待 UI 倒數計時器 tick
        currentNowMs += 15_000;
        await new Promise((r) => setTimeout(r, 300));
        await nextTick();

        expect(fetchFn).toHaveBeenCalledTimes(1);
        expect(
          container.querySelector('[data-test="rate-limit-status"]')?.textContent?.trim(),
        ).toBe('API ● 正常');
        expect(
          container.querySelector('[data-test="rate-limit-next-allowed"]')?.textContent?.trim(),
        ).toBe('下一次可請求：立即');
        expect(container.querySelector('[data-test="rate-limit-details"]')?.textContent).toContain(
          '冷卻剩餘 0 秒',
        );
        expect(container.querySelector('[data-test="rate-limit-details"]')?.textContent).toContain(
          '區間剩餘 0 秒',
        );

        unmount();
      } finally {
        dateNowSpy.mockRestore();
      }
    });
  });

  describe('Lifecycle & Teardown Regression Protection', () => {
    it('unmounting pane only unsubscribes feed; does NOT dispose runtime and does NOT close WebSockets', async () => {
      const controller = createLiveSearchPrimaryController(runtime);

      // 加入 active subscription
      await controller.addFromUrl(
        'https://www.pathofexile.com/trade/search/Standard/H4sIpersistent-sub',
      );
      const ws = createdSockets[0];
      ws.triggerOpen();

      // 掛載 Pane
      const { unmount } = mountComponent({ controller });
      await nextTick();

      // Unmount Pane (模擬使用者收合面板或切換分頁)
      unmount();
      await nextTick();

      // 關鍵驗證：Runtime 絕不被 dispose，WebSocket 依然維持連線！
      expect(runtime.isDisposed()).toBe(false);
      expect(ws.closed).toBe(false);
      expect(runtime.getSubscriptions()).toHaveLength(1);
      expect(runtime.getSubscriptions()[0].status).toBe('active');
    });
  });

  describe('Pane Header Contract', () => {
    it('LiveSearchPrimaryPane does not render console-version-label or duplicate 線上搜尋主控台 header while keeping Compact Status Header', async () => {
      const controller = createLiveSearchPrimaryController(runtime);
      const { container, unmount } = mountComponent({ controller });
      await flushAsync();

      const pane = container.querySelector('[data-sidebar-pane="live-search-primary"]');
      expect(pane).not.toBeNull();
      expect(pane?.querySelector('[data-test="console-version-label"]')).toBeNull();
      expect(pane?.textContent).not.toContain('線上搜尋主控台');
      expect(pane?.querySelector('[data-test="runtime-summary"]')).not.toBeNull();

      unmount();
    });
  });

  describe('Collapsible Groups & Snapshot Counts', () => {
    it('supports independent group collapse/expand, keeps enabled/total/error counts visible when collapsed, and preserves snapshot group counts during filtering', async () => {
      const groupRuntime = new LiveSearchPrimaryRuntime('poe1', {
        hostClient,
        webSocketFactory,
        openScheduler: new LiveSearchOpenScheduler({ cooldownMs: 0 }),
        reconnectPolicy: { maxFailedAttempts: 0 },
      });
      const controller = createLiveSearchPrimaryController(groupRuntime);

      const port: LiveSearchBookmarkSourcePort = {
        readCollection: async () => ({
          ok: true,
          value: {
            groups: [
              { id: 'grp_gear', name: '常用裝備', order: 0 } as any,
              { id: 'grp_currency', name: '通貨', order: 1 } as any,
            ],
            bookmarks: [
              {
                id: 'bmk_1',
                name: '魔血',
                url: 'https://www.pathofexile.com/trade/search/Standard/H4sImb1',
                leaguePinned: true,
                groupId: 'grp_gear',
                searchRecordId: 'rec_1',
                gameVersion: 'poe1',
                order: 0,
              },
              {
                id: 'bmk_2',
                name: '獵首',
                url: 'https://www.pathofexile.com/trade/search/Standard/H4sIhh2',
                leaguePinned: true,
                groupId: 'grp_gear',
                searchRecordId: 'rec_2',
                gameVersion: 'poe1',
                order: 1,
              },
              {
                id: 'bmk_3',
                name: '神聖石',
                url: 'https://www.pathofexile.com/trade/search/Standard/H4sIdiv3',
                leaguePinned: true,
                groupId: 'grp_currency',
                searchRecordId: 'rec_3',
                gameVersion: 'poe1',
                order: 0,
              },
            ],
          },
        }),
        subscribe: () => () => {},
      };

      const resumeStorage = {
        async get() {
          return {
            liveSearchResumePlan_poe1: {
              version: 2,
              identities: [
                { gameVersion: 'poe1', league: 'standard', searchId: 'H4sImb1' },
                { gameVersion: 'poe1', league: 'standard', searchId: 'H4sIhh2' },
                { gameVersion: 'poe1', league: 'standard', searchId: 'H4sIdiv3' },
              ],
            },
          };
        },
        async set() {},
        async remove() {},
      };
      const resumeStore = createLiveSearchResumeStore('poe1', resumeStorage);
      const sourceController = createLiveSearchSourceController(port, controller, { resumeStore });
      const { container, unmount } = mountComponent({ controller, sourceController });
      await flushAsync();

      // 啟用「魔血」與「獵首」移入「本次連線」，再將「獵首」暫停使其為 1 / 2；「神聖石」留在「上次連線」為 0 / 1
      await sourceController.enableMany(['bmk_1', 'bmk_2']);
      await flushAsync();
      createdSockets[0].triggerOpen();
      createdSockets[1].triggerOpen();
      sourceController.stop('bmk_2');
      await flushAsync();

      const sessionGroup = container.querySelector('[data-group-id="session_connections"]')!;
      const previousGroup = container.querySelector('[data-group-id="previous_connections"]')!;
      expect(
        sessionGroup.querySelector('[data-test="connection-group-count"]')?.textContent?.trim(),
      ).toBe('1 / 2');
      expect(
        previousGroup.querySelector('[data-test="connection-group-count"]')?.textContent?.trim(),
      ).toBe('0 / 1');
      expect(sessionGroup.querySelectorAll('[data-test="connection-item"]')).toHaveLength(2);
      expect(previousGroup.querySelectorAll('[data-test="connection-item"]')).toHaveLength(1);

      // 收合「本次連線」群組 -> items 隱藏，header count (1 / 2) 仍可見，另一群組「上次連線」不受影響
      const sessionToggle = sessionGroup.querySelector(
        '[data-test="connection-group-header"]',
      ) as HTMLButtonElement;
      sessionToggle.click();
      await nextTick();

      expect(sessionGroup.querySelectorAll('[data-test="connection-item"]')).toHaveLength(0);
      expect(
        sessionGroup.querySelector('[data-test="connection-group-count"]')?.textContent?.trim(),
      ).toBe('1 / 2');
      expect(previousGroup.querySelectorAll('[data-test="connection-item"]')).toHaveLength(1);

      // 再次點擊展開「本次連線」群組
      sessionToggle.click();
      await nextTick();
      expect(sessionGroup.querySelectorAll('[data-test="connection-item"]')).toHaveLength(2);

      // 搜尋或篩選後，group count 仍穩定描述該群組於目前 source snapshot 的 enabled / total
      const filterDisabledBtn = container.querySelector(
        '[data-test="filter-status-disabled"]',
      ) as HTMLButtonElement;
      filterDisabledBtn.click();
      await nextTick();

      expect(sessionGroup.querySelectorAll('[data-test="connection-item"]')).toHaveLength(1);
      expect(
        sessionGroup.querySelector('[data-test="connection-group-count"]')?.textContent?.trim(),
      ).toBe('1 / 2');

      unmount();
    });
  });

  describe('Console Display Preferences & Settings Integration', () => {
    it('never shows technical diagnostics (cumulative rendered count / policy) and offers no toggle', async () => {
      const storage = createInMemoryPreferencesStorage();
      const prefOutcome = await createPreferencesModule('poe1', storage);
      if (!prefOutcome.ok) throw new Error(prefOutcome.error.message);
      const preferences = prefOutcome.value;

      const fetchFn = vi.fn(async () => {
        return new Response(JSON.stringify({ result: [{ id: 'item-diag-1' }] }), {
          status: 200,
        });
      });
      const diagRuntime = new LiveSearchPrimaryRuntime('poe1', {
        hostClient,
        webSocketFactory,
        openScheduler: new LiveSearchOpenScheduler({ cooldownMs: 0 }),
        fetchClient: fetchFn as unknown as typeof fetch,
      });
      const controller = createLiveSearchPrimaryController(diagRuntime);
      const sourceController = createLiveSearchSourceController(null, controller);

      const container = document.createElement('div');
      document.body.appendChild(container);
      const app = createApp({
        components: { LiveSearchPrimaryPane, LiveSearchConsoleSettingsPane },
        setup() {
          return { controller, sourceController, preferences };
        },
        template: `
          <div>
            <LiveSearchPrimaryPane
              :controller="controller"
              :source-controller="sourceController"
              :preferences="preferences"
            />
            <LiveSearchConsoleSettingsPane :preferences="preferences" />
          </div>
        `,
      });
      app.mount(container);
      await flushAsync();

      expect(container.querySelector('[data-test="summary-rendered"]')).toBeNull();

      // 觸發 1 筆渲染使 cumulativeRenderedTotal = 1
      await sourceController.addCustom(
        'https://www.pathofexile.com/trade/search/Standard/H4sIdiag-sub',
        {
          name: '診斷測試',
        },
      );
      await flushAsync();
      createdSockets[0].triggerOpen();
      createdSockets[0].onmessage?.(
        new MessageEvent('message', { data: JSON.stringify({ result: 'item-diag-1' }) }),
      );
      await flushAsync(100);

      // 已移除診斷設定：渲染後仍不顯示累計渲染，設定頁也沒有診斷開關
      expect(container.querySelector('[data-test="summary-rendered"]')).toBeNull();
      expect(container.querySelector('[data-test="rate-limit-policy"]')).toBeNull();
      expect(container.querySelector('[data-test="pref-show-diagnostics"]')).toBeNull();
      expect(container.querySelector('[data-test="pref-max-results-100"]')).not.toBeNull();

      app.unmount();
      container.remove();
    });

    it('LiveSearchConsoleSettingsPane renders ToggleGroup for resume mode, updates preference and dynamic description, and prevents empty deselection', async () => {
      const storage = createInMemoryPreferencesStorage({
        liveSearchResumeMode_poe1: 'prompt',
      });
      const prefOutcome = await createPreferencesModule('poe1', storage);
      if (!prefOutcome.ok) throw new Error(prefOutcome.error.message);
      const preferences = prefOutcome.value;

      const container = document.createElement('div');
      document.body.appendChild(container);
      const app = createApp(LiveSearchConsoleSettingsPane, { preferences });
      app.mount(container);
      await flushAsync();

      // 1. 初始為 prompt (手動) 且具有對應說明文字
      const toggleGroup = container.querySelector('[data-test="pref-resume-mode"]');
      expect(toggleGroup).not.toBeNull();
      const offBtn = container.querySelector('[data-test="pref-resume-mode-off"]') as HTMLElement;
      const promptBtn = container.querySelector(
        '[data-test="pref-resume-mode-prompt"]',
      ) as HTMLElement;
      const autoBtn = container.querySelector('[data-test="pref-resume-mode-auto"]') as HTMLElement;

      expect(offBtn.textContent?.trim()).toBe('清理');
      expect(promptBtn.textContent?.trim()).toBe('手動');
      expect(autoBtn.textContent?.trim()).toBe('自動');

      expect(container.textContent).toContain(
        '保留於主控台列表下方的「上次連線」分區，由您手動選擇單筆或全部恢復。',
      );

      // 2. 點擊「自動」 -> 切換為 auto 且說明文字更新
      autoBtn.click();
      await flushAsync();
      expect(preferences.read().liveSearchResumeMode).toBe('auto');
      expect(container.textContent).toContain(
        '重新開啟主控台時，自動連線上次啟用的搜尋並加入「本次連線」。',
      );

      // 3. 再次點擊已選取的「自動」 -> 仍維持 auto，不被取消選取為空值
      autoBtn.click();
      await flushAsync();
      expect(preferences.read().liveSearchResumeMode).toBe('auto');
      expect(container.textContent).toContain(
        '重新開啟主控台時，自動連線上次啟用的搜尋並加入「本次連線」。',
      );

      // 4. 點擊「清理」 -> 切換為 off 且說明文字更新
      offBtn.click();
      await flushAsync();
      expect(preferences.read().liveSearchResumeMode).toBe('off');
      expect(container.textContent).toContain(
        '重新開啟主控台時自動清空上次的連線紀錄，不保留「上次連線」分區。',
      );

      app.unmount();
      container.remove();
    });

    it('status filter ToggleGroup maintains single-selection invariant and does not deselect to empty when re-clicked', async () => {
      const controller = createLiveSearchPrimaryController(runtime);
      const { container, unmount } = mountComponent({ controller });
      await flushAsync();

      const filterBar = container.querySelector('[data-test="connection-status-filter-bar"]');
      expect(filterBar).not.toBeNull();

      const filterAll = container.querySelector('[data-test="filter-status-all"]') as HTMLElement;
      const filterEnabled = container.querySelector(
        '[data-test="filter-status-enabled"]',
      ) as HTMLElement;

      // 1. 初始選取為 all
      expect(filterAll.getAttribute('data-state')).toBe('on');

      // 2. 點擊「已啟用」 -> 切換為 enabled
      filterEnabled.click();
      await flushAsync();
      expect(filterEnabled.getAttribute('data-state')).toBe('on');
      expect(filterAll.getAttribute('data-state')).toBe('off');

      // 3. 再次點擊已選取的「已啟用」 -> 仍維持 enabled，不取消選取為空值
      filterEnabled.click();
      await flushAsync();
      expect(filterEnabled.getAttribute('data-state')).toBe('on');

      unmount();
    });
  });

  describe('Console Title Ownership Guard', () => {
    it('sets document.title to 線上搜尋主控台, restores when overwritten, and stops after dispose', async () => {
      document.title = 'Path of Exile Trade - Standard';
      const guard = createLiveSearchConsoleTitleGuard(document);

      // 啟動前（例如 Normal Trade 分頁不呼叫 start）不覆蓋標題
      expect(document.title).toBe('Path of Exile Trade - Standard');

      // 主控台分頁啟動後立即設為固定標題
      guard.start();
      expect(document.title).toBe(LIVE_SEARCH_CONSOLE_TITLE);
      expect(document.title).toBe('線上搜尋主控台');

      // 官方 Trade 頁面或 SPA 改寫 document.title 時自動恢復
      document.title = '流亡黯道市集 - 瓦爾的宿命';
      await flushAsync();
      expect(document.title).toBe('線上搜尋主控台');

      // Teardown 後不再覆蓋標題
      guard.dispose();
      document.title = 'Normal Trade Page Title';
      await flushAsync();
      expect(document.title).toBe('Normal Trade Page Title');
    });
  });

  describe('Source Compatibility Presentation & Reactive League Lock UI', () => {
    it('renders resumable sources for the active league and reactively updates Hardcore row after switching league', async () => {
      const controller = createLiveSearchPrimaryController(runtime);
      const port: LiveSearchBookmarkSourcePort = {
        readCollection: async () => ({
          ok: true,
          value: {
            groups: [{ id: 'grp_compat', name: '相容性測試', order: 0 } as any],
            bookmarks: [
              {
                id: 'b_std',
                name: '魔血',
                url: 'https://www.pathofexile.com/trade/search/Standard/H4sImb_1',
                leaguePinned: true,
                groupId: 'grp_compat',
                searchRecordId: 'r1',
                gameVersion: 'poe1',
                order: 0,
              },
              {
                id: 'b_hc',
                name: 'Hardcore 胸甲',
                url: 'https://www.pathofexile.com/trade/search/Hardcore/H4sIhc_chest',
                leaguePinned: true,
                groupId: 'grp_compat',
                searchRecordId: 'r3',
                gameVersion: 'poe1',
                order: 2,
              },
            ],
          },
        }),
        subscribe: () => () => {},
      };

      const resumeStorage = {
        async get() {
          return {
            liveSearchResumePlan_poe1: {
              version: 2,
              identities: [
                { gameVersion: 'poe1', league: 'standard', searchId: 'H4sImb_1' },
                { gameVersion: 'poe1', league: 'hardcore', searchId: 'H4sIhc_chest' },
              ],
            },
          };
        },
        async set() {},
        async remove() {},
      };
      const resumeStore = createLiveSearchResumeStore('poe1', resumeStorage);
      const sourceController = createLiveSearchSourceController(port, controller, { resumeStore });
      const { container, unmount } = mountComponent({ controller, sourceController });
      await flushAsync();

      // 1. 初始 Standard 工作區：Standard 可啟用，Hardcore 被過濾不出現
      expect(container.querySelector('[data-test="btn-enable-b_std"]')).not.toBeNull();
      expect(container.querySelector('[data-source-id="b_hc"]')).toBeNull();

      // 嚴禁在可見文字中暴露內部 enum 字串
      expect(container.textContent).not.toContain('wrong-version');
      expect(container.textContent).not.toContain('wrong-league');
      expect(container.textContent).not.toContain('invalid-url');

      // 2. 切換聯盟至 Hardcore 後，Hardcore 項目出現並可啟用，Standard 被過濾
      await sourceController.switchLeague('Hardcore');
      await flushAsync();

      expect(container.querySelector('[data-source-id="b_hc"]')).not.toBeNull();
      expect(container.querySelector('[data-test="btn-enable-b_hc"]')).not.toBeNull();
      expect(container.querySelector('[data-source-id="b_std"]')).toBeNull();

      unmount();
      sourceController.dispose();
    });

    it('directly renders compatibility badges and tooltips from sourceController snapshot without view-level re-evaluation', async () => {
      const controller = createLiveSearchPrimaryController(runtime);
      const mockSnapshot = {
        groups: [
          {
            id: 'grp_projected',
            name: '投影測試',
            kind: 'bookmark' as const,
            items: [
              {
                kind: 'bookmark' as const,
                id: 'item_compat',
                name: '相容項目',
                url: 'https://example.com/arbitrary/url/1',
                canonicalIdentity: {
                  gameVersion: 'poe1' as const,
                  league: 'Standard',
                  searchId: 'H4sIs1',
                  isLive: true,
                },
                canonicalKey: 'poe1:Standard:s1',
                compatibility: 'compatible' as const,
                groupId: 'grp_projected',
                groupName: '投影測試',
                pending: false,
                removable: false,
              },
              {
                kind: 'bookmark' as const,
                id: 'item_wrong_ver',
                name: '跨版本項目',
                url: 'https://example.com/arbitrary/url/2',
                canonicalIdentity: {
                  gameVersion: 'poe2' as const,
                  league: 'Standard',
                  searchId: 'H4sIs2',
                  isLive: true,
                },
                canonicalKey: 'poe2:Standard:s2',
                compatibility: 'wrong-version' as const,
                compatibilityMessage: '自訂版本警告訊息',
                groupId: 'grp_projected',
                groupName: '投影測試',
                pending: false,
                removable: false,
              },
              {
                kind: 'bookmark' as const,
                id: 'item_wrong_lg',
                name: '跨聯盟項目',
                url: 'https://example.com/arbitrary/url/3',
                canonicalIdentity: {
                  gameVersion: 'poe1' as const,
                  league: 'Hardcore',
                  searchId: 'H4sIs3',
                  isLive: true,
                },
                canonicalKey: 'poe1:Hardcore:s3',
                compatibility: 'wrong-league' as const,
                compatibilityMessage: '自訂聯盟警告訊息',
                groupId: 'grp_projected',
                groupName: '投影測試',
                pending: false,
                removable: false,
              },
              {
                kind: 'bookmark' as const,
                id: 'item_invalid',
                name: '無效項目',
                url: 'https://example.com/arbitrary/url/4',
                canonicalIdentity: null,
                canonicalKey: null,
                compatibility: 'invalid-url' as const,
                compatibilityMessage: '自訂網址錯誤訊息',
                groupId: 'grp_projected',
                groupName: '投影測試',
                pending: false,
                removable: false,
              },
            ],
            bookmarks: [],
          },
        ],
        customSources: [],
      };

      const mockSourceController: any = {
        read: () => mockSnapshot,
        subscribe: (cb: any) => {
          cb(mockSnapshot);
          return () => {};
        },
        enable: vi.fn(),
        stop: vi.fn(),
        enableMany: vi.fn(),
        stopMany: vi.fn(),
        addCustom: vi.fn(),
        removeCustom: vi.fn(),
        reload: vi.fn(),
        dispose: vi.fn(),
      };

      const { container, unmount } = mountComponent({
        controller,
        sourceController: mockSourceController,
      });
      await flushAsync();

      // 1. Compatible item: shows enable button, no incompatibility badge
      expect(container.querySelector('[data-test="compatibility-item_compat"]')).toBeNull();
      expect(container.querySelector('[data-test="btn-enable-item_compat"]')).not.toBeNull();

      // 2. Wrong-version item: displays badge and projected message, no enable button
      const wrongVerBadge = container.querySelector(
        '[data-test="compatibility-item_wrong_ver"]',
      ) as HTMLElement;
      expect(wrongVerBadge).not.toBeNull();
      expect(wrongVerBadge.textContent?.trim()).toBe('不同版本');
      expect(wrongVerBadge.getAttribute('aria-label')).toBe('自訂版本警告訊息');
      expect(wrongVerBadge.getAttribute('title')).toBeNull();
      expect(container.querySelector('[data-test="btn-enable-item_wrong_ver"]')).toBeNull();

      // 3. Wrong-league item: displays badge and projected message, no enable button
      const wrongLgBadge = container.querySelector(
        '[data-test="compatibility-item_wrong_lg"]',
      ) as HTMLElement;
      expect(wrongLgBadge).not.toBeNull();
      expect(wrongLgBadge.textContent?.trim()).toBe('不同聯盟');
      expect(wrongLgBadge.getAttribute('aria-label')).toBe('自訂聯盟警告訊息');
      expect(wrongLgBadge.getAttribute('title')).toBeNull();
      expect(container.querySelector('[data-test="btn-enable-item_wrong_lg"]')).toBeNull();

      // 4. Invalid-url item: displays badge and projected message, no enable button
      const invalidBadge = container.querySelector(
        '[data-test="compatibility-item_invalid"]',
      ) as HTMLElement;
      expect(invalidBadge).not.toBeNull();
      expect(invalidBadge.textContent?.trim()).toBe('無效網址');
      expect(invalidBadge.getAttribute('aria-label')).toBe('自訂網址錯誤訊息');
      expect(invalidBadge.getAttribute('title')).toBeNull();
      expect(container.querySelector('[data-test="btn-enable-item_invalid"]')).toBeNull();

      unmount();
    });
  });

  describe('Group Batch & Filtered Result Batch UI', () => {
    it('Group Batch operates on the entire group even when search/filter is active, and supports group stop', async () => {
      const controller = createLiveSearchPrimaryController(runtime);
      const port: LiveSearchBookmarkSourcePort = {
        readCollection: async () => ({
          ok: true,
          value: {
            groups: [
              { id: 'grp_a', name: 'Group A', order: 0 } as any,
              { id: 'grp_b', name: 'Group B', order: 1 } as any,
            ],
            bookmarks: [
              {
                id: 'a1',
                name: '魔血 A1',
                url: 'https://www.pathofexile.com/trade/search/Standard/H4sIa_1',
                leaguePinned: true,
                groupId: 'grp_a',
                searchRecordId: 'ra1',
                gameVersion: 'poe1',
                order: 0,
              },
              {
                id: 'a2',
                name: '獵首 A2',
                url: 'https://www.pathofexile.com/trade/search/Standard/H4sIa_2',
                leaguePinned: true,
                groupId: 'grp_a',
                searchRecordId: 'ra2',
                gameVersion: 'poe1',
                order: 1,
              },
              {
                id: 'a3',
                name: '星團 A3',
                url: 'https://www.pathofexile.com/trade/search/Standard/H4sIa_3',
                leaguePinned: true,
                groupId: 'grp_a',
                searchRecordId: 'ra3',
                gameVersion: 'poe1',
                order: 2,
              },
              {
                id: 'b1',
                name: '神聖 B1',
                url: 'https://www.pathofexile.com/trade/search/Standard/H4sIb_1',
                leaguePinned: true,
                groupId: 'grp_b',
                searchRecordId: 'rb1',
                gameVersion: 'poe1',
                order: 0,
              },
              {
                id: 'b2',
                name: '崇高 B2',
                url: 'https://www.pathofexile.com/trade/search/Standard/H4sIb_2',
                leaguePinned: true,
                groupId: 'grp_b',
                searchRecordId: 'rb2',
                gameVersion: 'poe1',
                order: 1,
              },
            ],
          },
        }),
        subscribe: () => () => {},
      };

      const resumeStorage = {
        async get() {
          return {
            liveSearchResumePlan_poe1: {
              version: 2,
              identities: [
                { gameVersion: 'poe1', league: 'standard', searchId: 'H4sIb_1' },
                { gameVersion: 'poe1', league: 'standard', searchId: 'H4sIb_2' },
              ],
            },
          };
        },
        async set() {},
        async remove() {},
      };
      const resumeStore = createLiveSearchResumeStore('poe1', resumeStorage);
      const sourceController = createLiveSearchSourceController(port, controller, { resumeStore });
      // 將 a1, a2, a3 加入本次連線後暫停，使其位於 session_connections 且為未啟用；b1, b2 位於 previous_connections
      await sourceController.enableMany(['a1', 'a2', 'a3']);
      sourceController.stopMany(['a1', 'a2', 'a3']);
      await flushAsync();

      const enableManySpy = vi.spyOn(sourceController, 'enableMany');
      const stopManySpy = vi.spyOn(sourceController, 'stopMany');
      const { container, unmount } = mountComponent({ controller, sourceController });
      await flushAsync();

      // 搜尋「魔血」，使畫面上 本次連線 只顯示 1 筆項目
      const searchInput = container.querySelector(
        '[data-test="search-connections-input"]',
      ) as HTMLInputElement;
      searchInput.value = '魔血';
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      await flushAsync();

      const groupA = container.querySelector('[data-group-id="session_connections"]')!;
      expect(groupA.querySelectorAll('[data-test="connection-item"]')).toHaveLength(1);

      // 點擊 本次連線 的 [⋯] 選單 -> 「啟用此群組全部」
      const groupMenuBtn = container.querySelector(
        '[data-test="btn-group-menu-session_connections"]',
      ) as HTMLButtonElement;
      expect(groupMenuBtn).not.toBeNull();
      groupMenuBtn.click();
      await flushAsync();

      const toasts: any[] = [];
      const removeToastListener = listenPoeEvent('poexd-toast', (detail) => {
        toasts.push(detail);
      });

      const enableGroupBtn = document.body.querySelector(
        '[data-test="btn-group-enable-all-session_connections"]',
      ) as HTMLElement;
      expect(enableGroupBtn).not.toBeNull();
      enableGroupBtn.click();
      await flushAsync();

      // 關鍵驗證：即使搜尋只顯示 1 筆，啟用此群組全部仍提交整個 本次連線 的 3 筆，且不碰 上次連線 (b1, b2)
      expect(enableManySpy).toHaveBeenCalledWith(['a1', 'a2', 'a3']);
      expect(runtime.getSubscriptions()).toHaveLength(3);
      expect(container.querySelector('[data-test="pane-batch-summary"]')).toBeNull();
      expect(toasts.some((t) => t.message.includes('已啟用 3 項'))).toBe(true);

      // 點擊 本次連線 的 [⋯] 選單 -> 「停止此群組全部」
      groupMenuBtn.click();
      await flushAsync();
      const stopGroupBtn = document.body.querySelector(
        '[data-test="btn-group-stop-all-session_connections"]',
      ) as HTMLElement;
      expect(stopGroupBtn).not.toBeNull();
      stopGroupBtn.click();
      await flushAsync();

      expect(stopManySpy).toHaveBeenCalledWith(['a1', 'a2', 'a3']);
      expect(runtime.getSubscriptions()).toHaveLength(0);
      expect(container.querySelector('[data-test="pane-batch-summary"]')).toBeNull();
      expect(toasts.some((t) => t.message.includes('已停止 3 項'))).toBe(true);

      removeToastListener();
      unmount();
      sourceController.dispose();
    });

    it('Filtered Result Batch submits only the currently filtered source IDs from filteredGroups and rejects mixed-league batch atomically', async () => {
      const controller = createLiveSearchPrimaryController(runtime);
      const port: LiveSearchBookmarkSourcePort = {
        readCollection: async () => ({
          ok: true,
          value: {
            groups: [
              { id: 'grp_1', name: '裝備', order: 0 } as any,
              { id: 'grp_2', name: '珠寶', order: 1 } as any,
            ],
            bookmarks: [
              {
                id: 'f1',
                name: '精選裝備 1',
                url: 'https://www.pathofexile.com/trade/search/Standard/H4sIf_1',
                leaguePinned: true,
                groupId: 'grp_1',
                searchRecordId: 'rf1',
                gameVersion: 'poe1',
                order: 0,
              },
              {
                id: 'f2',
                name: '精選裝備 2',
                url: 'https://www.pathofexile.com/trade/search/Standard/H4sIf_2',
                leaguePinned: true,
                groupId: 'grp_1',
                searchRecordId: 'rf2',
                gameVersion: 'poe1',
                order: 1,
              },
              {
                id: 'f3',
                name: '精選珠寶 3',
                url: 'https://www.pathofexile.com/trade/search/Standard/H4sIf_3',
                leaguePinned: true,
                groupId: 'grp_2',
                searchRecordId: 'rf3',
                gameVersion: 'poe1',
                order: 0,
              },
              {
                id: 'f4',
                name: '精選珠寶 4',
                url: 'https://www.pathofexile.com/trade/search/Standard/H4sIf_4',
                leaguePinned: true,
                groupId: 'grp_2',
                searchRecordId: 'rf4',
                gameVersion: 'poe1',
                order: 1,
              },
              {
                id: 'other_hc',
                name: '其他專家胸甲',
                url: 'https://www.pathofexile.com/trade/search/Hardcore/H4sIhc_other',
                leaguePinned: true,
                groupId: 'grp_2',
                searchRecordId: 'rf5',
                gameVersion: 'poe1',
                order: 2,
              },
            ],
          },
        }),
        subscribe: () => () => {},
      };

      const resumeStorage = {
        async get() {
          return {
            liveSearchResumePlan_poe1: {
              version: 2,
              identities: [
                { gameVersion: 'poe1', league: 'standard', searchId: 'H4sIf_1' },
                { gameVersion: 'poe1', league: 'standard', searchId: 'H4sIf_2' },
                { gameVersion: 'poe1', league: 'standard', searchId: 'H4sIf_3' },
                { gameVersion: 'poe1', league: 'standard', searchId: 'H4sIf_4' },
                { gameVersion: 'poe1', league: 'hardcore', searchId: 'H4sIhc_other' },
              ],
            },
          };
        },
        async set() {},
        async remove() {},
      };
      const resumeStore = createLiveSearchResumeStore('poe1', resumeStorage);
      const sourceController = createLiveSearchSourceController(port, controller, { resumeStore });
      const enableManySpy = vi.spyOn(sourceController, 'enableMany');
      const toasts: any[] = [];
      const removeToastListener = listenPoeEvent('poexd-toast', (detail) => {
        toasts.push(detail);
      });

      const { container, unmount } = mountComponent({ controller, sourceController });
      await flushAsync();

      // 1. 預設「全部 + 無搜尋」時，降噪隱藏 filtered-batch-bar
      expect(container.querySelector('[data-test="filtered-batch-bar"]')).toBeNull();

      // 切換狀態篩選為「未啟用」（包含 5 項未啟用來源，混合 Standard 與 Hardcore）
      const filterDisabled = container.querySelector(
        '[data-test="filter-status-disabled"]',
      ) as HTMLButtonElement;
      filterDisabled.click();
      await flushAsync();

      // 此時出現「符合 4 項」（Standard 來源）與批次選單 -> 模擬點擊「啟用目前篩選結果」觸發 mixed-league 原子拒絕
      expect(
        container.querySelector('[data-test="filtered-match-count"]')?.textContent?.trim(),
      ).toBe('符合 4 項');
      enableManySpy.mockResolvedValueOnce(createMockMixedLeagueOutcome());
      const batchMenuBtn = container.querySelector(
        '[data-test="btn-filtered-batch-menu"]',
      ) as HTMLButtonElement;
      batchMenuBtn.click();
      await flushAsync();

      const enableFilteredBtn = document.body.querySelector(
        '[data-test="btn-batch-enable-filtered"]',
      ) as HTMLElement;
      expect(enableFilteredBtn).not.toBeNull();
      enableFilteredBtn.click();
      await flushAsync();

      expect(runtime.getSubscriptions()).toHaveLength(0);
      expect(container.querySelector('[data-test="pane-error-message"]')).toBeNull();
      expect(toasts.some((t) => t.message.includes('選取項目包含多個聯盟'))).toBe(true);

      // 切回全部狀態並搜尋「精選」後，filteredGroups 縮減為 4 項 Standard 來源
      const filterAll = container.querySelector(
        '[data-test="filter-status-all"]',
      ) as HTMLButtonElement;
      filterAll.click();
      await flushAsync();

      // 2. 搜尋「精選」後，filteredGroups 縮減為 4 項 Standard 來源
      const searchInput = container.querySelector(
        '[data-test="search-connections-input"]',
      ) as HTMLInputElement;
      searchInput.value = '精選';
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      await flushAsync();

      expect(
        container.querySelector('[data-test="filtered-match-count"]')?.textContent?.trim(),
      ).toBe('符合 4 項');

      enableManySpy.mockClear();
      const batchMenuBtnAfterSearch = container.querySelector(
        '[data-test="btn-filtered-batch-menu"]',
      ) as HTMLButtonElement;
      expect(batchMenuBtnAfterSearch).not.toBeNull();
      batchMenuBtnAfterSearch.click();
      await flushAsync();
      (
        document.body.querySelector('[data-test="btn-batch-enable-filtered"]') as HTMLElement
      ).click();
      await flushAsync();

      // 只提交目前篩選結果的 4 個 source IDs
      expect(enableManySpy).toHaveBeenCalledWith(['f1', 'f2', 'f3', 'f4']);
      expect(runtime.getSubscriptions()).toHaveLength(4);
      expect(container.querySelector('[data-test="pane-batch-summary"]')).toBeNull();
      expect(toasts.some((t) => t.message.includes('已啟用 4 項'))).toBe(true);

      removeToastListener();
      unmount();
      sourceController.dispose();
    });

    it('prompt restore 遭遇 mixed-league reject 時在介面呈現錯誤提示（Toast），且零部分連線', async () => {
      const toasts: any[] = [];
      const removeToastListener = listenPoeEvent('poexd-toast', (detail) => {
        toasts.push(detail);
      });

      const controller = createLiveSearchPrimaryController(runtime);
      const port: LiveSearchBookmarkSourcePort = {
        readCollection: async () => ({
          ok: true,
          value: {
            groups: [],
            bookmarks: [
              {
                id: 'b_std',
                name: 'Standard 項目',
                url: 'https://www.pathofexile.com/trade/search/Standard/H4sIs1',
                leaguePinned: true,
                groupId: 'g1',
                searchRecordId: 'r1',
                gameVersion: 'poe1',
                order: 0,
              },
              {
                id: 'b_hc',
                name: 'Hardcore 項目',
                url: 'https://www.pathofexile.com/trade/search/Hardcore/H4sIh1',
                leaguePinned: true,
                groupId: 'g1',
                searchRecordId: 'r2',
                gameVersion: 'poe1',
                order: 1,
              },
            ],
          },
        }),
        subscribe: () => () => {},
      };

      const resumeStorage = {
        async get() {
          return {
            liveSearchResumePlan_poe1: {
              version: 1,
              identities: [
                { gameVersion: 'poe1', league: 'standard', searchId: 'H4sIs1' },
                { gameVersion: 'poe1', league: 'hardcore', searchId: 'H4sIh1' },
              ],
            },
          };
        },
        async set() {},
        async remove() {},
      };
      const resumeStore = createLiveSearchResumeStore('poe1', resumeStorage);
      const sourceController = createLiveSearchSourceController(port, controller, { resumeStore });

      const prefStorage = createInMemoryPreferencesStorage({
        liveSearchResumeMode_poe1: 'prompt',
      });
      const prefOutcome = await createPreferencesModule('poe1', prefStorage);
      if (!prefOutcome.ok) throw new Error(prefOutcome.error.message);

      const resumeController = createLiveSearchResumeController({
        version: 'poe1',
        preferences: prefOutcome.value,
        sourceController,
        resumeStore,
      });

      const { container, unmount } = mountComponent({
        controller,
        sourceController,
        resumeController,
      });
      await flushAsync(80);

      // 頂部不再重複渲染冗餘橫幅，而是收斂在「上次連線」分區
      expect(container.querySelector('[data-test="resume-prompt-banner"]')).toBeNull();
      const prevGroup = container.querySelector('[data-group-id="previous_connections"]');
      expect(prevGroup).not.toBeNull();

      // 點擊「上次連線」全部恢復按鈕（模擬遭遇 mixed-league reject）
      vi.spyOn(sourceController, 'restoreAllPreviousConnections').mockResolvedValueOnce(
        createMockMixedLeagueOutcome(),
      );
      const restoreBtn = container.querySelector(
        '[data-test="btn-group-quick-enable-previous_connections"]',
      ) as HTMLButtonElement;
      expect(restoreBtn).not.toBeNull();
      restoreBtn.click();
      await flushAsync(80);

      // 零部分連線
      expect(runtime.getSubscriptions()).toHaveLength(0);

      // 使用者可見 Toast，不產生冗餘 inline 錯誤橫幅
      expect(container.querySelector('[data-test="pane-error-message"]')).toBeNull();
      expect(toasts.some((t) => t.message.includes('選取項目包含多個聯盟'))).toBe(true);

      removeToastListener();
      unmount();
      sourceController.dispose();
      resumeController.dispose();
    });

    it('auto restore 遭遇 mixed-league reject 時亦將錯誤呈現在 Toast，不 silent', async () => {
      const toasts: any[] = [];
      const removeToastListener = listenPoeEvent('poexd-toast', (detail) => {
        toasts.push(detail);
      });

      const controller = createLiveSearchPrimaryController(runtime);
      const port: LiveSearchBookmarkSourcePort = {
        readCollection: async () => ({
          ok: true,
          value: {
            groups: [],
            bookmarks: [
              {
                id: 'b_std',
                name: 'Standard 項目',
                url: 'https://www.pathofexile.com/trade/search/Standard/H4sIs1',
                leaguePinned: true,
                groupId: 'g1',
                searchRecordId: 'r1',
                gameVersion: 'poe1',
                order: 0,
              },
              {
                id: 'b_hc',
                name: 'Hardcore 項目',
                url: 'https://www.pathofexile.com/trade/search/Hardcore/H4sIh1',
                leaguePinned: true,
                groupId: 'g1',
                searchRecordId: 'r2',
                gameVersion: 'poe1',
                order: 1,
              },
            ],
          },
        }),
        subscribe: () => () => {},
      };

      const resumeStorage = {
        async get() {
          return {
            liveSearchResumePlan_poe1: {
              version: 1,
              identities: [
                { gameVersion: 'poe1', league: 'standard', searchId: 'H4sIs1' },
                { gameVersion: 'poe1', league: 'hardcore', searchId: 'H4sIh1' },
              ],
            },
          };
        },
        async set() {},
        async remove() {},
      };
      const resumeStore = createLiveSearchResumeStore('poe1', resumeStorage);
      const sourceController = createLiveSearchSourceController(port, controller, { resumeStore });

      const prefStorage = createInMemoryPreferencesStorage({
        liveSearchResumeMode_poe1: 'auto',
      });
      const prefOutcome = await createPreferencesModule('poe1', prefStorage);
      if (!prefOutcome.ok) throw new Error(prefOutcome.error.message);

      const resumeController = createLiveSearchResumeController({
        version: 'poe1',
        preferences: prefOutcome.value,
        sourceController,
        resumeStore,
      });

      // 模擬自動恢復時遭遇 mixed-league reject
      vi.spyOn(sourceController, 'enableMany').mockResolvedValueOnce(
        createMockMixedLeagueOutcome(),
      );

      const { container, unmount } = mountComponent({
        controller,
        sourceController,
        resumeController,
      });
      await flushAsync(100);

      // 零部分連線
      expect(runtime.getSubscriptions()).toHaveLength(0);

      // 自動恢復失敗不 silent，呈現至 Toast
      expect(container.querySelector('[data-test="pane-error-message"]')).toBeNull();
      expect(toasts.some((t) => t.message.includes('選取項目包含多個聯盟'))).toBe(true);

      removeToastListener();
      unmount();
      sourceController.dispose();
      resumeController.dispose();
    });

    it('上次連線分區直接顯示當前聯盟可恢復項目與來源資料夾標籤，隱藏閒置「未啟用」文字，且不渲染冗餘頂部橫幅', async () => {
      const controller = createLiveSearchPrimaryController(runtime);
      const port: LiveSearchBookmarkSourcePort = {
        readCollection: async () => ({
          ok: true,
          value: {
            groups: [
              { id: 'grp_parent', name: '配裝設定', order: 0 } as any,
              { id: 'grp_child', name: '飾品', parentId: 'grp_parent', order: 1 } as any,
            ],
            bookmarks: [
              {
                id: 'bm_ring',
                name: '戒指搜尋',
                url: 'https://www.pathofexile.com/trade/search/Standard/H4sIring_1',
                leaguePinned: true,
                groupId: 'grp_child',
                searchRecordId: 'r_ring',
                gameVersion: 'poe1',
                order: 0,
              },
              {
                id: 'bm_hc_belt',
                name: '專家腰帶',
                url: 'https://www.pathofexile.com/trade/search/Hardcore/H4sIbelt_hc',
                leaguePinned: true,
                groupId: 'grp_parent',
                searchRecordId: 'r_belt',
                gameVersion: 'poe1',
                order: 1,
              },
            ],
          },
        }),
        subscribe: () => () => {},
      };

      const resumeStorage: LiveSearchResumeStorage = {
        async get() {
          return {
            liveSearchResumePlan_poe1: {
              version: 2,
              identities: [
                { gameVersion: 'poe1', league: 'standard', searchId: 'H4sIring_1' },
                { gameVersion: 'poe1', league: 'hardcore', searchId: 'H4sIbelt_hc' },
                { gameVersion: 'poe1', league: 'standard', searchId: 'H4sItemp_should_not_show' },
              ],
            },
          };
        },
        async set() {},
        async remove() {},
      };
      const resumeStore = createLiveSearchResumeStore('poe1', resumeStorage);
      const sourceController = createLiveSearchSourceController(port, controller, { resumeStore });

      // 加入 Temporary Search
      await sourceController.addCustom(
        'https://www.pathofexile.com/trade/search/Standard/H4sItemp_should_not_show',
      );

      const prefStorage = createInMemoryPreferencesStorage({
        liveSearchResumeMode_poe1: 'prompt',
      });
      const prefOutcome = await createPreferencesModule('poe1', prefStorage);
      if (!prefOutcome.ok) throw new Error(prefOutcome.error.message);

      const resumeController = createLiveSearchResumeController({
        version: 'poe1',
        preferences: prefOutcome.value,
        sourceController,
        resumeStore,
      });

      const { container, unmount } = mountComponent({
        controller,
        sourceController,
        resumeController,
      });
      await flushAsync(100);

      // 不再渲染冗餘頂部橫幅，統一由「上次連線」分區承載
      expect(container.querySelector('[data-test="resume-prompt-banner"]')).toBeNull();

      const prevSection = container.querySelector('[data-group-id="previous_connections"]');
      expect(prevSection).not.toBeNull();

      // 上次連線分區只顯示當前聯盟可恢復書籤（戒指搜尋），不渲染行內資料夾 badge 以保留名稱空間，並於名稱 title 附帶來源資料夾「飾品」
      const ringRow = prevSection?.querySelector('[data-source-id="bm_ring"]');
      expect(ringRow).not.toBeNull();
      expect(ringRow?.querySelector('[data-test="connection-item-folder-badge"]')).toBeNull();
      const ringNameEl = ringRow?.querySelector('[data-test="connection-item-name"]');
      expect(ringNameEl?.getAttribute('data-folder')).toBe('飾品');
      expect(ringNameEl?.getAttribute('title')).toBeNull();

      // 閒置未啟用的項目不渲染獨立狀態文字
      expect(ringRow?.querySelector('[data-test="connection-item-status"]')).toBeNull();

      // Hardcore 書籤在上次連線分區不會混入為可相容恢復項目（或若因選單在選單外被排除）
      expect(prevSection?.textContent).not.toContain('temp_should_not_show');

      unmount();
      sourceController.dispose();
      resumeController.dispose();
    });

    it('上次連線選單「清空紀錄」與本次連線選單「移除已停止的連線」、新增連線入口及排隊啟動中狀態回饋', async () => {
      const controller = createLiveSearchPrimaryController(runtime);
      const port: LiveSearchBookmarkSourcePort = {
        readCollection: async () => ({
          ok: true,
          value: {
            groups: [{ id: 'grp_1', name: '我的書籤', order: 0 } as any],
            bookmarks: [
              {
                id: 'bm_manual',
                name: '手動恢復項目',
                url: 'https://www.pathofexile.com/trade/search/Standard/H4sImanual_1',
                leaguePinned: true,
                groupId: 'grp_1',
                searchRecordId: 'r_m1',
                gameVersion: 'poe1',
                order: 0,
              },
              {
                id: 'bm_session_stopped',
                name: '本次已停止項目',
                url: 'https://www.pathofexile.com/trade/search/Standard/H4sIsession_stopped',
                leaguePinned: true,
                groupId: 'grp_1',
                searchRecordId: 'r_m2',
                gameVersion: 'poe1',
                order: 1,
              },
            ],
          },
        }),
        subscribe: () => () => {},
      };

      const resumeStorage: LiveSearchResumeStorage = {
        async get() {
          return {
            liveSearchResumePlan_poe1: {
              version: 2,
              identities: [{ gameVersion: 'poe1', league: 'standard', searchId: 'H4sImanual_1' }],
            },
          };
        },
        async set() {},
        async remove() {},
      };
      const resumeStore = createLiveSearchResumeStore('poe1', resumeStorage);
      const sourceController = createLiveSearchSourceController(port, controller, { resumeStore });

      const { container, unmount } = mountComponent({
        controller,
        sourceController,
      });
      await flushAsync(80);

      // 1. 展開「上次連線」選單並執行「清空上次連線紀錄」
      const prevMenuBtn = container.querySelector(
        '[data-test="btn-group-menu-previous_connections"]',
      ) as HTMLButtonElement;
      expect(prevMenuBtn).not.toBeNull();
      prevMenuBtn.click();
      await flushAsync(40);

      const clearPrevBtn = document.body.querySelector(
        '[data-test="btn-group-clear-previous_connections"]',
      ) as HTMLButtonElement;
      expect(clearPrevBtn).not.toBeNull();
      clearPrevBtn.click();
      await flushAsync(60);

      expect(container.querySelector('[data-group-id="previous_connections"]')).toBeNull();

      // 2. 將 bm_session_stopped 加入本次連線後停止
      await sourceController.enable('bm_session_stopped');
      sourceController.stop('bm_session_stopped');
      await flushAsync(60);

      // 本次連線標題列有 [＋] 新增連線按鈕
      expect(container.querySelector('[data-test="btn-group-add-connection"]')).not.toBeNull();

      // 3. 展開「本次連線」選單並執行「移除已停止的連線」
      const sessionMenuBtn = container.querySelector(
        '[data-test="btn-group-menu-session_connections"]',
      ) as HTMLButtonElement;
      expect(sessionMenuBtn).not.toBeNull();
      sessionMenuBtn.click();
      await flushAsync(40);

      const clearStoppedBtn = document.body.querySelector(
        '[data-test="btn-group-clear-stopped-session_connections"]',
      ) as HTMLButtonElement;
      expect(clearStoppedBtn).not.toBeNull();
      clearStoppedBtn.click();
      await flushAsync(60);

      expect(container.querySelector('[data-source-id="bm_session_stopped"]')).toBeNull();

      // 4. 當本次連線與上次連線皆清空時，顯示空狀態 CTA 按鈕 `[＋ 新增搜尋連線]`
      const emptyAddBtn = container.querySelector(
        '[data-test="btn-empty-add-connection"]',
      ) as HTMLButtonElement;
      expect(emptyAddBtn).not.toBeNull();
      expect(emptyAddBtn.textContent).toContain('新增搜尋連線');

      unmount();
      sourceController.dispose();
    });

    it('Preview Tooltip contract: Trigger 僅包含 identity 且右側 controls 排除在 Trigger 之外，且 TradeSearchPreviewTooltip 傳入 boundaryAnchor', async () => {
      const controller = createLiveSearchPrimaryController(runtime);
      const port: LiveSearchBookmarkSourcePort = {
        readCollection: async () => ({
          ok: true,
          value: {
            groups: [{ id: 'grp_1', name: '測試群組', order: 0 } as any],
            bookmarks: [
              {
                id: 'bm_tooltip_test',
                name: '測試預覽項目',
                url: 'https://www.pathofexile.com/trade/search/Standard/H4sItooltip_1',
                leaguePinned: true,
                groupId: 'grp_1',
                searchRecordId: 'r_t1',
                gameVersion: 'poe1',
                order: 0,
              },
            ],
          },
        }),
        subscribe: () => () => {},
      };

      const resumeStorage = {
        async get() {
          return {
            liveSearchResumePlan_poe1: {
              version: 2,
              identities: [{ gameVersion: 'poe1', league: 'standard', searchId: 'H4sItooltip_1' }],
            },
          };
        },
        async set() {},
        async remove() {},
      };
      const resumeStore = createLiveSearchResumeStore('poe1', resumeStorage);
      const sourceController = createLiveSearchSourceController(port, controller, { resumeStore });

      const { container, unmount } = mountComponent({
        controller,
        sourceController,
      });
      await flushAsync(80);

      const row = container.querySelector('[data-source-id="bm_tooltip_test"]') as HTMLElement;
      expect(row).not.toBeNull();

      // 1. Tooltip Trigger 正確只包含 connection-item-identity (封面/名稱/provenance)
      const trigger = row.querySelector('[data-test="connection-item-identity"]');
      expect(trigger).not.toBeNull();
      expect(trigger?.querySelector('[data-test="connection-item-name"]')).not.toBeNull();

      // 2. 右側 controls (啟用按鈕、選單) 絕對不包含在 connection-item-identity 內
      const enableBtn = row.querySelector('[data-test="btn-enable-bm_tooltip_test"]');
      expect(enableBtn).not.toBeNull();
      expect(trigger?.contains(enableBtn)).toBe(false);

      // 3. TradeSearchPreviewTooltip 具備 boundaryAnchor prop
      expect(TradeSearchPreviewTooltip.props).toHaveProperty('boundaryAnchor');

      unmount();
      sourceController.dispose();
    });

    it('Row Action Hierarchy 與 Group Quick Action UX 收斂回歸驗證', async () => {
      const controller = createLiveSearchPrimaryController(runtime);
      const port: LiveSearchBookmarkSourcePort = {
        readCollection: async () => ({
          ok: true,
          value: {
            groups: [{ id: 'grp_test', name: '測試群組', order: 0 } as any],
            bookmarks: [
              {
                id: 'b_test1',
                name: '測試項目 1',
                url: 'https://www.pathofexile.com/trade/search/Standard/H4sIt_1',
                leaguePinned: true,
                groupId: 'grp_test',
                searchRecordId: 'r1',
                gameVersion: 'poe1',
                order: 0,
              },
              {
                id: 'b_test2',
                name: '測試項目 2',
                url: 'https://www.pathofexile.com/trade/search/Standard/H4sIt_2',
                leaguePinned: true,
                groupId: 'grp_test',
                searchRecordId: 'r2',
                gameVersion: 'poe1',
                order: 1,
              },
            ],
          },
        }),
        subscribe: () => () => {},
      };

      const sourceController = createLiveSearchSourceController(port, controller);
      await sourceController.enableMany(['b_test1', 'b_test2']);
      sourceController.stopMany(['b_test1', 'b_test2']);
      await flushAsync();

      const enableManySpy = vi.spyOn(sourceController, 'enableMany');
      const { container, unmount } = mountComponent({ controller, sourceController });
      await flushAsync();

      // 1. 群組 Header 存在未啟用項目時，提供低干擾的快捷「啟用」操作
      const quickEnableBtn = container.querySelector(
        '[data-test="btn-group-quick-enable-session_connections"]',
      ) as HTMLButtonElement;
      expect(quickEnableBtn).not.toBeNull();
      expect(quickEnableBtn.getAttribute('aria-label')).toBe('全部啟用');

      // 2. 未啟用狀態的 row：右側主要操作只有「啟用」，無「停止」或「重試」
      expect(container.querySelector('[data-test="btn-enable-b_test1"]')).not.toBeNull();
      expect(container.querySelector('[data-test="btn-stop-b_test1"]')).toBeNull();
      expect(container.querySelector('[data-test="btn-retry-b_test1"]')).toBeNull();

      // 3. 點擊群組快捷「啟用」，走既有 enableMany batch handler
      quickEnableBtn.click();
      await flushAsync();
      expect(enableManySpy).toHaveBeenCalledWith(['b_test1', 'b_test2']);

      // 建立連線成功後
      createdSockets[createdSockets.length - 2].triggerOpen();
      createdSockets[createdSockets.length - 1].triggerOpen();
      await flushAsync();

      // 4. 群組全部項目已啟用後，Header 的快捷啟用按鈕自動隱藏
      expect(
        container.querySelector('[data-test="btn-group-quick-enable-session_connections"]'),
      ).toBeNull();

      // 5. 監聽中狀態的 row：右側主要操作只有「停止」，無「啟用」或「重試」
      expect(container.querySelector('[data-test="btn-stop-b_test1"]')).not.toBeNull();
      expect(container.querySelector('[data-test="btn-enable-b_test1"]')).toBeNull();
      expect(container.querySelector('[data-test="btn-retry-b_test1"]')).toBeNull();

      unmount();
      sourceController.dispose();
    });

    it('Group Quick Action 僅在存在可進入既有 enableMany() 的來源時顯示，並排除 incompatible/error/pending/active-only', async () => {
      const controller = createLiveSearchPrimaryController(runtime);
      const currentSnapshot: LiveSearchSourceSnapshot = {
        loading: false,
        leagueResolved: true,
        selectedLeague: 'Standard',
        availableLeagues: ['Standard'],
        isSwitchingLeague: false,
        groups: [
          // 1. compatible + idle 群組：應顯示 quick enable
          {
            id: 'grp_idle',
            name: '可啟用群組',
            kind: 'bookmark',
            items: [
              {
                kind: 'bookmark',
                id: 's_idle',
                name: '相容且閒置',
                url: 'https://www.pathofexile.com/trade/search/Standard/H4sIidle',
                canonicalIdentity: {
                  gameVersion: 'poe1',
                  league: 'Standard',
                  searchId: 'H4sIidle',
                },
                canonicalKey: 'poe1:Standard:idle',
                compatibility: 'compatible',
                groupId: 'grp_idle',
                groupName: '可啟用群組',
                status: 'idle',
                pending: false,
                removable: false,
              },
            ],
            bookmarks: [],
          },
          // 2. 全部 active 群組：不顯示 quick enable
          {
            id: 'grp_active',
            name: '全啟動中群組',
            kind: 'bookmark',
            items: [
              {
                kind: 'bookmark',
                id: 's_active',
                name: '連線中項目',
                url: 'https://www.pathofexile.com/trade/search/Standard/H4sIactive',
                canonicalIdentity: {
                  gameVersion: 'poe1',
                  league: 'Standard',
                  searchId: 'H4sIactive',
                },
                canonicalKey: 'poe1:Standard:active',
                compatibility: 'compatible',
                groupId: 'grp_active',
                groupName: '全啟動中群組',
                status: 'active',
                pending: false,
                removable: false,
              },
            ],
            bookmarks: [],
          },
          // 3. incompatible-only 群組：不顯示 quick enable
          {
            id: 'grp_incompat',
            name: '不相容群組',
            kind: 'bookmark',
            items: [
              {
                kind: 'bookmark',
                id: 's_incompat',
                name: '不同聯盟項目',
                url: 'https://www.pathofexile.com/trade/search/Hardcore/H4sIincompat',
                canonicalIdentity: {
                  gameVersion: 'poe1',
                  league: 'Hardcore',
                  searchId: 'H4sIincompat',
                },
                canonicalKey: 'poe1:Hardcore:incompat',
                compatibility: 'wrong-league',
                compatibilityMessage: '主控台已鎖定 Standard，此搜尋屬於 Hardcore',
                groupId: 'grp_incompat',
                groupName: '不相容群組',
                status: 'idle',
                pending: false,
                removable: false,
              },
            ],
            bookmarks: [],
          },
          // 4. error-only 群組：不顯示 quick enable
          {
            id: 'grp_error',
            name: '異常群組',
            kind: 'bookmark',
            items: [
              {
                kind: 'bookmark',
                id: 's_error',
                name: '異常連線項目',
                url: 'https://www.pathofexile.com/trade/search/Standard/H4sIerror',
                canonicalIdentity: {
                  gameVersion: 'poe1',
                  league: 'Standard',
                  searchId: 'H4sIerror',
                },
                canonicalKey: 'poe1:Standard:error',
                compatibility: 'compatible',
                groupId: 'grp_error',
                groupName: '異常群組',
                status: 'error',
                errorMessage: '連線逾時',
                pending: false,
                removable: false,
              },
            ],
            bookmarks: [],
          },
          // 5. pending-only 群組：不顯示 quick enable
          {
            id: 'grp_pending',
            name: '啟動中群組',
            kind: 'bookmark',
            items: [
              {
                kind: 'bookmark',
                id: 's_pending',
                name: '正處於啟動中項目',
                url: 'https://www.pathofexile.com/trade/search/Standard/H4sIpending',
                canonicalIdentity: {
                  gameVersion: 'poe1',
                  league: 'Standard',
                  searchId: 'H4sIpending',
                },
                canonicalKey: 'poe1:Standard:pending',
                compatibility: 'compatible',
                groupId: 'grp_pending',
                groupName: '啟動中群組',
                status: 'idle',
                pending: true,
                removable: false,
              },
            ],
            bookmarks: [],
          },
        ],
      };

      const enableManySpy = vi.fn().mockResolvedValue({
        success: true,
        succeeded: 1,
        skipped: 0,
        failed: 0,
        sourceIds: ['s_idle'],
        skipReasons: {
          alreadyActive: 0,
          pending: 0,
          incompatible: 0,
          duplicateInBatch: 0,
          notFound: 0,
          inactive: 0,
        },
        incompatibleBreakdown: { invalidUrl: 0, wrongVersion: 0, wrongLeague: 0 },
      });

      const mockSourceController: LiveSearchSourceController = {
        read: () => currentSnapshot,
        subscribe: (listener) => {
          listener(currentSnapshot);
          return () => {};
        },
        enable: vi.fn(),
        add: vi.fn(),
        enableMany: enableManySpy,
        stopMany: vi.fn(),
        addCustom: vi.fn(),
        removeCustom: vi.fn(),
        retry: vi.fn(),
        stop: vi.fn(),
        switchLeague: vi.fn().mockResolvedValue(true),
        getSelectedLeague: () => 'Standard',
        getAvailableLeagues: () => ['Standard'],
        dispose: vi.fn(),
      };

      const { container, unmount } = mountComponent({
        controller,
        sourceController: mockSourceController,
      });
      await flushAsync();

      // 1. compatible + idle → 顯示 quick enable
      const idleQuickEnable = container.querySelector(
        '[data-test="btn-group-quick-enable-grp_idle"]',
      );
      expect(idleQuickEnable).not.toBeNull();
      expect(idleQuickEnable?.getAttribute('aria-label')).toBe('啟用群組');

      // 2. 全部 active → 不顯示
      expect(container.querySelector('[data-test="btn-group-quick-enable-grp_active"]')).toBeNull();

      // 3. incompatible-only → 不顯示
      expect(
        container.querySelector('[data-test="btn-group-quick-enable-grp_incompat"]'),
      ).toBeNull();

      // 4. error-only → 不顯示
      expect(container.querySelector('[data-test="btn-group-quick-enable-grp_error"]')).toBeNull();

      // 5. pending-only → 不顯示
      expect(
        container.querySelector('[data-test="btn-group-quick-enable-grp_pending"]'),
      ).toBeNull();

      // 單筆 pending 啟用按鈕：顯示 Loader2 旋轉圖示，保持 disabled 與「啟動中...」
      const pendingEnableBtn = container.querySelector(
        '[data-test="btn-enable-s_pending"]',
      ) as HTMLButtonElement;
      expect(pendingEnableBtn).not.toBeNull();
      expect(pendingEnableBtn.disabled).toBe(true);
      expect(pendingEnableBtn.getAttribute('aria-label')).toBe('啟動中...');
      expect(pendingEnableBtn.getAttribute('title')).toBe('啟動中...');
      expect(pendingEnableBtn.querySelector('.animate-spin')).not.toBeNull();

      // 非 pending 啟用按鈕：顯示靜態 Play 圖示（無 animate-spin），非 disabled
      const idleEnableBtn = container.querySelector(
        '[data-test="btn-enable-s_idle"]',
      ) as HTMLButtonElement;
      expect(idleEnableBtn).not.toBeNull();
      expect(idleEnableBtn.disabled).toBe(false);
      expect(idleEnableBtn.getAttribute('aria-label')).toBe('啟用');
      expect(idleEnableBtn.getAttribute('title')).toBe('啟用');
      expect(idleEnableBtn.querySelector('.animate-spin')).toBeNull();

      // 6. quick enable 點擊後仍呼叫既有 enableMany()，不建立第二條 pipeline
      (idleQuickEnable as HTMLButtonElement).click();
      await flushAsync();
      expect(enableManySpy).toHaveBeenCalledTimes(1);
      expect(enableManySpy).toHaveBeenCalledWith(['s_idle']);

      unmount();
    });

    it('renders Compact Header League Selector, expands available leagues, triggers switchLeague, and reflects disabled switching state', async () => {
      const controller = createLiveSearchPrimaryController(runtime);
      let currentSnap: LiveSearchSourceSnapshot = {
        loading: false,
        leagueResolved: true,
        groups: [],
        selectedLeague: 'Standard',
        availableLeagues: ['Standard', 'Hardcore'],
        isSwitchingLeague: false,
      };
      let currentListener: ((s: Readonly<LiveSearchSourceSnapshot>) => void) | null = null;
      const emitSnapshot = (snap: LiveSearchSourceSnapshot) => {
        currentSnap = snap;
        if (currentListener) {
          currentListener(currentSnap);
        }
      };

      const switchLeagueMock = vi.fn(async (target: string) => {
        emitSnapshot({
          ...currentSnap,
          isSwitchingLeague: true,
        });
        await flushAsync(10);
        emitSnapshot({
          ...currentSnap,
          selectedLeague: target,
          isSwitchingLeague: false,
        });
        return true;
      });

      const mockSourceController: LiveSearchSourceController = {
        read: () => currentSnap,
        subscribe: (listener) => {
          currentListener = listener;
          listener(currentSnap);
          return () => {
            currentListener = null;
          };
        },
        enable: vi.fn(),
        add: vi.fn(),
        enableMany: vi.fn(),
        stopMany: vi.fn(),
        addCustom: vi.fn(),
        removeCustom: vi.fn(),
        retry: vi.fn(),
        stop: vi.fn(),
        switchLeague: switchLeagueMock,
        getSelectedLeague: () => currentSnap.selectedLeague,
        getAvailableLeagues: () => currentSnap.availableLeagues,
        dispose: vi.fn(),
      };

      const { container, unmount } = mountComponent({
        controller,
        sourceController: mockSourceController,
      });
      await flushAsync();

      // 1. 初始渲染呈現目前選定聯盟
      const trigger = container.querySelector(
        '[data-test="league-selector-trigger"]',
      ) as HTMLButtonElement;
      expect(trigger).not.toBeNull();
      expect(container.querySelector('[data-test="summary-league"]')?.textContent?.trim()).toBe(
        'Standard',
      );
      expect(trigger.disabled).toBe(false);

      // 2. 展開下拉選單
      trigger.click();
      await flushAsync();

      const hcOption = document.body.querySelector(
        '[data-test="league-option-Hardcore"]',
      ) as HTMLElement;
      expect(hcOption).not.toBeNull();
      expect(hcOption.textContent).toContain('Hardcore');

      // 3. 點擊切換為 Hardcore
      hcOption.click();
      await flushAsync();

      expect(switchLeagueMock).toHaveBeenCalledWith('Hardcore');
      expect(container.querySelector('[data-test="summary-league"]')?.textContent?.trim()).toBe(
        'Hardcore',
      );

      // 4. 切換中呈現 disabled 狀態
      emitSnapshot({
        ...currentSnap,
        isSwitchingLeague: true,
      });
      await flushAsync();

      expect(trigger.disabled).toBe(true);

      unmount();
    });
  });

  describe('10. Bookmark Folder Hierarchy UI, Subtree Collapse, Subtree Batch & Stats, and Hierarchy Filter', () => {
    let controller: LiveSearchPrimaryController;

    beforeEach(() => {
      controller = createLiveSearchPrimaryController(runtime);
    });

    function createHierarchySnapshot(): LiveSearchSourceSnapshot {
      return {
        loading: false,
        selectedLeague: 'Standard',
        availableLeagues: ['Standard', 'Hardcore'],
        isSwitchingLeague: false,
        leagueResolved: true,
        groups: [
          {
            id: 'f-equip',
            name: '裝備',
            kind: 'bookmark',
            parentId: undefined,
            order: 0,
            depth: 0,
            items: [],
            bookmarks: [],
          },
          {
            id: 'f-helmet',
            name: '頭盔',
            kind: 'bookmark',
            parentId: 'f-equip',
            order: 0,
            depth: 1,
            items: [
              {
                kind: 'bookmark',
                id: 'b-helm-active',
                name: '皇家頭盔',
                url: 'https://www.pathofexile.com/trade/search/Standard/H4sIhelm_active',
                canonicalIdentity: {
                  gameVersion: 'poe1',
                  league: 'Standard',
                  searchId: 'H4sIhelm_active',
                },
                canonicalKey: 'poe1:standard:helm_active',
                compatibility: 'compatible',
                groupId: 'f-helmet',
                groupName: '頭盔',
                status: 'active',
                liveSearchStatus: 'active',
                pending: false,
                subscriptionId: 'sub-helm-active',
                removable: false,
              },
            ],
            bookmarks: [],
          },
          {
            id: 'f-high',
            name: '高價',
            kind: 'bookmark',
            parentId: 'f-helmet',
            order: 0,
            depth: 2,
            items: [
              {
                kind: 'bookmark',
                id: 'b-hh-idle',
                name: 'Headhunter',
                url: 'https://www.pathofexile.com/trade/search/Standard/H4sIhh_idle',
                canonicalIdentity: {
                  gameVersion: 'poe1',
                  league: 'Standard',
                  searchId: 'H4sIhh_idle',
                },
                canonicalKey: 'poe1:standard:hh_idle',
                compatibility: 'compatible',
                groupId: 'f-high',
                groupName: '高價',
                status: 'idle',
                liveSearchStatus: 'idle',
                pending: false,
                removable: false,
              },
              {
                kind: 'bookmark',
                id: 'b-mb-error',
                name: 'Mageblood',
                url: 'https://www.pathofexile.com/trade/search/Standard/H4sImb_error',
                canonicalIdentity: {
                  gameVersion: 'poe1',
                  league: 'Standard',
                  searchId: 'H4sImb_error',
                },
                canonicalKey: 'poe1:standard:mb_error',
                compatibility: 'compatible',
                groupId: 'f-high',
                groupName: '高價',
                status: 'error',
                liveSearchStatus: 'error',
                errorMessage: 'WebSocket 斷線',
                pending: false,
                subscriptionId: 'sub-mb-error',
                removable: false,
              },
            ],
            bookmarks: [],
          },
          {
            id: 'f-gloves',
            name: '手套',
            kind: 'bookmark',
            parentId: 'f-equip',
            order: 1,
            depth: 1,
            items: [
              {
                kind: 'bookmark',
                id: 'b-gloves-idle',
                name: '扣釘手套',
                url: 'https://www.pathofexile.com/trade/search/Standard/H4sIgloves_idle',
                canonicalIdentity: {
                  gameVersion: 'poe1',
                  league: 'Standard',
                  searchId: 'H4sIgloves_idle',
                },
                canonicalKey: 'poe1:standard:gloves_idle',
                compatibility: 'compatible',
                groupId: 'f-gloves',
                groupName: '手套',
                status: 'idle',
                liveSearchStatus: 'idle',
                pending: false,
                removable: false,
              },
            ],
            bookmarks: [],
          },
        ],
      };
    }

    it('renders multi-level folder hierarchy with real folder names, data-depth, indentation, and subtree-aggregated header stats', async () => {
      const snap = createHierarchySnapshot();
      const mockSourceController: LiveSearchSourceController = {
        read: () => snap,
        subscribe: (listener) => {
          listener(snap);
          return () => {};
        },
        enable: vi.fn(),
        add: vi.fn(),
        enableMany: vi.fn(),
        stopMany: vi.fn(),
        addCustom: vi.fn(),
        removeCustom: vi.fn(),
        retry: vi.fn(),
        stop: vi.fn(),
        switchLeague: vi.fn(),
        getSelectedLeague: () => 'Standard',
        getAvailableLeagues: () => ['Standard'],
        dispose: vi.fn(),
      };

      const { container, unmount } = mountComponent({
        controller,
        sourceController: mockSourceController,
      });
      await flushAsync();

      const groupEls = Array.from(
        container.querySelectorAll('[data-test="connection-group"]'),
      ) as HTMLElement[];
      expect(
        groupEls.map((el) => ({
          id: el.getAttribute('data-group-id'),
          depth: el.getAttribute('data-depth'),
          name: el.querySelector('[data-test="connection-group-name"]')?.textContent?.trim(),
        })),
      ).toEqual([
        { id: 'f-equip', depth: '0', name: '裝備' },
        { id: 'f-helmet', depth: '1', name: '頭盔' },
        { id: 'f-high', depth: '2', name: '高價' },
        { id: 'f-gloves', depth: '1', name: '手套' },
      ]);

      // Indentation uses scale/density-aware CSS tokens matching BookmarkFolderNode.vue
      expect(groupEls[0]!.style.marginLeft).toBe('');
      expect(groupEls[1]!.style.marginLeft).toContain(
        'calc((var(--pxd-space-lg) + var(--pxd-space-md)))',
      );
      expect(groupEls[2]!.style.marginLeft).toContain(
        'calc((var(--pxd-space-lg) + var(--pxd-space-md)) + (var(--pxd-space-lg) + var(--pxd-space-md)))',
      );

      // Parent folder f-equip has 0 direct items, but its subtree has 4 items (1 active, 1 error, 2 idle)
      const equipCountText = groupEls[0]!
        .querySelector('[data-test="connection-group-count"]')
        ?.textContent?.replace(/\s+/g, ' ')
        .trim();
      expect(equipCountText).toContain('1 / 4');
      expect(equipCountText).toContain('1 異常');

      // Child folder f-helmet has 1 direct active + 2 grandchild items = 1 / 3, 1 異常
      const helmetCountText = groupEls[1]!
        .querySelector('[data-test="connection-group-count"]')
        ?.textContent?.replace(/\s+/g, ' ')
        .trim();
      expect(helmetCountText).toContain('1 / 3');
      expect(helmetCountText).toContain('1 異常');

      unmount();
    });

    it('collapsing a parent folder hides its entire descendant subtree, and active search temporarily expands matching branches without mutating collapse state', async () => {
      const snap = createHierarchySnapshot();
      const mockSourceController: LiveSearchSourceController = {
        read: () => snap,
        subscribe: (listener) => {
          listener(snap);
          return () => {};
        },
        enable: vi.fn(),
        add: vi.fn(),
        enableMany: vi.fn(),
        stopMany: vi.fn(),
        addCustom: vi.fn(),
        removeCustom: vi.fn(),
        retry: vi.fn(),
        stop: vi.fn(),
        switchLeague: vi.fn(),
        getSelectedLeague: () => 'Standard',
        getAvailableLeagues: () => ['Standard'],
        dispose: vi.fn(),
      };

      const { container, unmount } = mountComponent({
        controller,
        sourceController: mockSourceController,
      });
      await flushAsync();

      // 1. Collapse intermediate parent 'f-helmet': hides 'f-high' and 'f-helmet' direct items, keeps 'f-equip' and 'f-gloves' visible
      const helmetToggle = container.querySelector(
        '[data-group-toggle="f-helmet"]',
      ) as HTMLButtonElement;
      helmetToggle.click();
      await flushAsync();

      expect(
        Array.from(container.querySelectorAll('[data-test="connection-group"]')).map((el) =>
          el.getAttribute('data-group-id'),
        ),
      ).toEqual(['f-equip', 'f-helmet', 'f-gloves']);
      expect(
        container.querySelector('[data-group-id="f-helmet"] [data-test="connection-group-items"]'),
      ).toBeNull();

      // 2. Collapse root 'f-equip': hides 'f-helmet', 'f-high', and 'f-gloves'
      const equipToggle = container.querySelector(
        '[data-group-toggle="f-equip"]',
      ) as HTMLButtonElement;
      equipToggle.click();
      await flushAsync();

      expect(
        Array.from(container.querySelectorAll('[data-test="connection-group"]')).map((el) =>
          el.getAttribute('data-group-id'),
        ),
      ).toEqual(['f-equip']);

      // 3. Searching 'Headhunter' temporarily expands collapsed ancestors so the matching grandchild is visible
      const searchInput = container.querySelector(
        '[data-test="search-connections-input"]',
      ) as HTMLInputElement;
      searchInput.value = 'Headhunter';
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      await flushAsync();

      expect(
        Array.from(container.querySelectorAll('[data-test="connection-group"]')).map((el) =>
          el.getAttribute('data-group-id'),
        ),
      ).toEqual(['f-equip', 'f-helmet', 'f-high']);
      expect(container.querySelector('[data-source-id="b-hh-idle"]')).not.toBeNull();

      // 4. Clearing search restores original collapsed state ('f-equip' still collapsed)
      const clearBtn = container.querySelector('[data-test="btn-clear-search"]') as HTMLElement;
      clearBtn.click();
      await flushAsync();

      expect(
        Array.from(container.querySelectorAll('[data-test="connection-group"]')).map((el) =>
          el.getAttribute('data-group-id'),
        ),
      ).toEqual(['f-equip']);

      unmount();
    });

    it('parent folder Quick Enable, Enable All, and Stop All act on the entire descendant subtree in canonical pre-order', async () => {
      const snap = createHierarchySnapshot();
      const enableManyMock = vi.fn().mockResolvedValue({
        success: true,
        requested: 4,
        succeeded: 2,
        skipped: 2,
        failed: 0,
        skipReasons: {
          alreadyActive: 1,
          pending: 0,
          incompatible: 0,
          duplicateInBatch: 0,
          notFound: 0,
          inactive: 0,
        },
        incompatibleBreakdown: { invalidUrl: 0, wrongVersion: 0, wrongLeague: 0 },
        runtimeFailureCount: 0,
      });
      const stopManyMock = vi.fn().mockReturnValue({
        success: true,
        requested: 4,
        succeeded: 2,
        skipped: 2,
        failed: 0,
        skipReasons: {
          alreadyActive: 0,
          pending: 0,
          incompatible: 0,
          duplicateInBatch: 0,
          notFound: 0,
          inactive: 2,
        },
        incompatibleBreakdown: { invalidUrl: 0, wrongVersion: 0, wrongLeague: 0 },
        runtimeFailureCount: 0,
      });

      const mockSourceController: LiveSearchSourceController = {
        read: () => snap,
        subscribe: (listener) => {
          listener(snap);
          return () => {};
        },
        enable: vi.fn(),
        add: vi.fn(),
        enableMany: enableManyMock,
        stopMany: stopManyMock,
        addCustom: vi.fn(),
        removeCustom: vi.fn(),
        retry: vi.fn(),
        stop: vi.fn(),
        switchLeague: vi.fn(),
        getSelectedLeague: () => 'Standard',
        getAvailableLeagues: () => ['Standard'],
        dispose: vi.fn(),
      };

      const { container, unmount } = mountComponent({
        controller,
        sourceController: mockSourceController,
      });
      await flushAsync();

      // 1. Parent folder 'f-equip' (0 direct items) shows Quick Enable because its subtree has enableable items ('b-hh-idle', 'b-gloves-idle')
      const quickEnableBtn = container.querySelector(
        '[data-test="btn-group-quick-enable-f-equip"]',
      ) as HTMLButtonElement;
      expect(quickEnableBtn).not.toBeNull();
      quickEnableBtn.click();
      await flushAsync();

      expect(enableManyMock).toHaveBeenCalledTimes(1);
      expect(enableManyMock).toHaveBeenLastCalledWith([
        'b-helm-active',
        'b-hh-idle',
        'b-mb-error',
        'b-gloves-idle',
      ]);

      // 2. Open [⋯] menu on 'f-helmet' -> click '啟用此資料夾全部': submits 'f-helmet' + 'f-high' subtree items
      const helmetMenuBtn = container.querySelector(
        '[data-test="btn-group-menu-f-helmet"]',
      ) as HTMLButtonElement;
      helmetMenuBtn.click();
      await flushAsync();

      const enableAllHelmetBtn = document.body.querySelector(
        '[data-test="btn-group-enable-all-f-helmet"]',
      ) as HTMLElement;
      expect(enableAllHelmetBtn).not.toBeNull();
      expect(enableAllHelmetBtn.textContent?.trim()).toBe('啟用此資料夾全部');
      enableAllHelmetBtn.click();
      await flushAsync();

      expect(enableManyMock).toHaveBeenCalledTimes(2);
      expect(enableManyMock).toHaveBeenLastCalledWith(['b-helm-active', 'b-hh-idle', 'b-mb-error']);

      // 3. Open [⋯] menu on 'f-equip' -> click '停止此資料夾全部': submits entire 'f-equip' subtree
      const equipMenuBtn = container.querySelector(
        '[data-test="btn-group-menu-f-equip"]',
      ) as HTMLButtonElement;
      equipMenuBtn.click();
      await flushAsync();

      const stopAllEquipBtn = document.body.querySelector(
        '[data-test="btn-group-stop-all-f-equip"]',
      ) as HTMLElement;
      expect(stopAllEquipBtn).not.toBeNull();
      expect(stopAllEquipBtn.textContent?.trim()).toBe('停止此資料夾全部');
      stopAllEquipBtn.click();
      await flushAsync();

      expect(stopManyMock).toHaveBeenCalledTimes(1);
      expect(stopManyMock).toHaveBeenLastCalledWith([
        'b-helm-active',
        'b-hh-idle',
        'b-mb-error',
        'b-gloves-idle',
      ]);

      unmount();
    });

    it('Filtered Result Batch only includes actually matched items (not non-matching items from retained ancestor folders) and includes subtree when folder name matches', async () => {
      const snap = createHierarchySnapshot();
      const enableManyMock = vi.fn().mockResolvedValue({
        success: true,
        requested: 1,
        succeeded: 1,
        skipped: 0,
        failed: 0,
        skipReasons: {
          alreadyActive: 0,
          pending: 0,
          incompatible: 0,
          duplicateInBatch: 0,
          notFound: 0,
          inactive: 0,
        },
        incompatibleBreakdown: { invalidUrl: 0, wrongVersion: 0, wrongLeague: 0 },
        runtimeFailureCount: 0,
      });

      const mockSourceController: LiveSearchSourceController = {
        read: () => snap,
        subscribe: (listener) => {
          listener(snap);
          return () => {};
        },
        enable: vi.fn(),
        add: vi.fn(),
        enableMany: enableManyMock,
        stopMany: vi.fn(),
        addCustom: vi.fn(),
        removeCustom: vi.fn(),
        retry: vi.fn(),
        stop: vi.fn(),
        switchLeague: vi.fn(),
        getSelectedLeague: () => 'Standard',
        getAvailableLeagues: () => ['Standard'],
        dispose: vi.fn(),
      };

      const { container, unmount } = mountComponent({
        controller,
        sourceController: mockSourceController,
      });
      await flushAsync();

      const searchInput = container.querySelector(
        '[data-test="search-connections-input"]',
      ) as HTMLInputElement;

      // Case A: Search grandchild item 'Headhunter' -> retains f-equip -> f-helmet -> f-high as ancestor context,
      // but filteredSourceIds ONLY has ['b-hh-idle'] (does NOT include 'b-helm-active' from ancestor 'f-helmet')!
      searchInput.value = 'Headhunter';
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      await flushAsync();

      expect(
        container.querySelector('[data-test="filtered-match-count"]')?.textContent?.trim(),
      ).toBe('符合 1 項');

      const batchMenuBtn = container.querySelector(
        '[data-test="btn-filtered-batch-menu"]',
      ) as HTMLButtonElement;
      batchMenuBtn.click();
      await flushAsync();

      const batchEnableFilteredBtn = document.body.querySelector(
        '[data-test="btn-batch-enable-filtered"]',
      ) as HTMLElement;
      batchEnableFilteredBtn.click();
      await flushAsync();

      expect(enableManyMock).toHaveBeenLastCalledWith(['b-hh-idle']);

      // Case B: Search folder name '頭盔' -> matches folder 'f-helmet' and its descendant 'f-high' (3 items total),
      // while excluding sibling 'f-gloves'
      searchInput.value = '頭盔';
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      await flushAsync();

      expect(
        container.querySelector('[data-test="filtered-match-count"]')?.textContent?.trim(),
      ).toBe('符合 3 項');

      batchMenuBtn.click();
      await flushAsync();

      const batchEnableFilteredBtn2 = document.body.querySelector(
        '[data-test="btn-batch-enable-filtered"]',
      ) as HTMLElement;
      batchEnableFilteredBtn2.click();
      await flushAsync();

      expect(enableManyMock).toHaveBeenLastCalledWith(['b-helm-active', 'b-hh-idle', 'b-mb-error']);

      unmount();
    });
  });

  describe('Bookmark Cover Thumbnail & Shared TradeSearchPreviewTooltip Presentation Tests', () => {
    it('enforces shared preview architecture, avoids duplicate composables, and confines tooltip trigger surface', () => {
      const panePath = resolve(__dirname, '../components/sidebar/LiveSearchPrimaryPane.vue');
      const paneSource = readFileSync(panePath, 'utf-8');

      // Direct reuse of TradeSearchPreviewTooltip and useTradeSearchPreview
      expect(paneSource).toContain(
        "import TradeSearchPreviewTooltip from './search-preview/TradeSearchPreviewTooltip.vue'",
      );
      expect(paneSource).toContain(
        "import { useTradeSearchPreview } from './composables/useTradeSearchPreview'",
      );

      // Forbids importing BookmarkPane-specific wrappers or cover discovery composables
      expect(paneSource).not.toContain('useBookmarkPreview');
      expect(paneSource).not.toContain('useBookmarkCovers');
      expect(paneSource).not.toContain('LiveSearchPreviewTooltip');

      // Tooltip trigger wraps only connection-item-identity, excluding right-side controls
      expect(paneSource).toMatch(
        /<TradeSearchPreviewTooltip[\s\S]*?<div[\s\S]*?data-test="connection-item-identity"/,
      );
    });

    it('renders compact thumbnail for bookmark with coverImageUrl and placeholder slot for bookmark without', async () => {
      const controller = createLiveSearchPrimaryController(runtime);
      const snap: LiveSearchSourceSnapshot = {
        loading: false,
        selectedLeague: 'Standard',
        availableLeagues: ['Standard'],
        isSwitchingLeague: false,
        leagueResolved: true,
        groups: [
          {
            id: 'g-test',
            name: '一般書籤',
            kind: 'bookmark',
            depth: 0,
            items: [
              {
                kind: 'bookmark',
                id: 'b-with-cover',
                name: '帶封面書籤',
                url: 'https://www.pathofexile.com/trade/search/Standard/H4sIcover_1',
                canonicalIdentity: null,
                canonicalKey: 'poe1/Standard/cover_1',
                compatibility: 'compatible',
                groupId: 'g-test',
                groupName: '一般書籤',
                pending: false,
                removable: false,
                coverImageUrl: 'https://web.poecdn.com/gen/image/test_cover.png',
              },
              {
                kind: 'bookmark',
                id: 'b-no-cover',
                name: '無封面書籤',
                url: 'https://www.pathofexile.com/trade/search/Standard/H4sIcover_2',
                canonicalIdentity: null,
                canonicalKey: 'poe1/Standard/cover_2',
                compatibility: 'compatible',
                groupId: 'g-test',
                groupName: '一般書籤',
                pending: false,
                removable: false,
              },
            ],
            bookmarks: [],
          },
        ],
      };

      const mockSourceController: LiveSearchSourceController = {
        read: () => snap,
        subscribe: (listener) => {
          listener(snap);
          return () => {};
        },
        enable: vi.fn(),
        add: vi.fn(),
        enableMany: vi.fn(),
        stopMany: vi.fn(),
        addCustom: vi.fn(),
        removeCustom: vi.fn(),
        retry: vi.fn(),
        stop: vi.fn(),
        switchLeague: vi.fn(),
        getSelectedLeague: () => 'Standard',
        getAvailableLeagues: () => ['Standard'],
        dispose: vi.fn(),
      };

      const { container, unmount } = mountComponent({
        controller,
        sourceController: mockSourceController,
      });
      await flushAsync();

      // 1. Item with coverImageUrl: renders <img> with proper classes and attributes
      const itemWithCover = container.querySelector('[data-source-id="b-with-cover"]');
      expect(itemWithCover).not.toBeNull();
      const img = itemWithCover?.querySelector(
        '[data-test="connection-item-thumbnail"]',
      ) as HTMLImageElement;
      expect(img).not.toBeNull();
      expect(img.tagName).toBe('IMG');
      expect(img.getAttribute('src')).toBe('https://web.poecdn.com/gen/image/test_cover.png');
      expect(img.getAttribute('alt')).toBe('');
      expect(img.getAttribute('draggable')).toBe('false');
      expect(img.className).toContain('size-[var(--control-height-sm)]');
      expect(img.className).toContain('object-contain');
      expect(itemWithCover?.querySelector('[data-test="connection-item-placeholder"]')).toBeNull();

      // 2. Item without coverImageUrl: renders placeholder slot with fixed size and bullet
      const itemWithoutCover = container.querySelector('[data-source-id="b-no-cover"]');
      expect(itemWithoutCover).not.toBeNull();
      expect(itemWithoutCover?.querySelector('[data-test="connection-item-thumbnail"]')).toBeNull();
      const placeholder = itemWithoutCover?.querySelector(
        '[data-test="connection-item-placeholder"]',
      );
      expect(placeholder).not.toBeNull();
      expect(placeholder?.textContent?.trim()).toBe('•');
      expect(placeholder?.className).toContain('size-[var(--control-height-sm)]');

      unmount();
    });

    it('ensures Temporary Search row renders neither thumbnail nor placeholder slot', async () => {
      const controller = createLiveSearchPrimaryController(runtime);
      const snap: LiveSearchSourceSnapshot = {
        loading: false,
        selectedLeague: 'Standard',
        availableLeagues: ['Standard'],
        isSwitchingLeague: false,
        leagueResolved: true,
        groups: [
          {
            id: 'custom_sources',
            name: '暫時搜尋',
            kind: 'custom',
            depth: 0,
            items: [
              {
                kind: 'custom',
                id: 'c-test-1',
                name: '自訂暫時搜尋',
                url: 'https://www.pathofexile.com/trade/search/Standard/H4sIcustom_1',
                canonicalIdentity: null,
                canonicalKey: 'poe1/Standard/custom_1',
                compatibility: 'compatible',
                groupId: 'custom_sources',
                groupName: '暫時搜尋',
                pending: false,
                removable: true,
              },
            ],
            bookmarks: [],
          },
        ],
      };

      const mockSourceController: LiveSearchSourceController = {
        read: () => snap,
        subscribe: (listener) => {
          listener(snap);
          return () => {};
        },
        enable: vi.fn(),
        add: vi.fn(),
        enableMany: vi.fn(),
        stopMany: vi.fn(),
        addCustom: vi.fn(),
        removeCustom: vi.fn(),
        retry: vi.fn(),
        stop: vi.fn(),
        switchLeague: vi.fn(),
        getSelectedLeague: () => 'Standard',
        getAvailableLeagues: () => ['Standard'],
        dispose: vi.fn(),
      };

      const { container, unmount } = mountComponent({
        controller,
        sourceController: mockSourceController,
      });
      await flushAsync();

      const customRow = container.querySelector('[data-source-id="c-test-1"]');
      expect(customRow).not.toBeNull();
      expect(customRow?.querySelector('[data-test="connection-item-thumbnail"]')).toBeNull();
      expect(customRow?.querySelector('[data-test="connection-item-placeholder"]')).toBeNull();

      unmount();
    });

    it('silently hides thumbnail on image load error without crashing or mutating storage', async () => {
      const controller = createLiveSearchPrimaryController(runtime);
      const snap: LiveSearchSourceSnapshot = {
        loading: false,
        selectedLeague: 'Standard',
        availableLeagues: ['Standard'],
        isSwitchingLeague: false,
        leagueResolved: true,
        groups: [
          {
            id: 'g-err',
            name: '封面錯誤測試',
            kind: 'bookmark',
            depth: 0,
            items: [
              {
                kind: 'bookmark',
                id: 'b-broken-img',
                name: '損毀封面書籤',
                url: 'https://www.pathofexile.com/trade/search/Standard/H4sIbroken',
                canonicalIdentity: null,
                canonicalKey: 'poe1/Standard/broken',
                compatibility: 'compatible',
                groupId: 'g-err',
                groupName: '封面錯誤測試',
                pending: false,
                removable: false,
                coverImageUrl: 'https://web.poecdn.com/gen/image/not_found.png',
              },
            ],
            bookmarks: [],
          },
        ],
      };

      const mockSourceController: LiveSearchSourceController = {
        read: () => snap,
        subscribe: (listener) => {
          listener(snap);
          return () => {};
        },
        enable: vi.fn(),
        add: vi.fn(),
        enableMany: vi.fn(),
        stopMany: vi.fn(),
        addCustom: vi.fn(),
        removeCustom: vi.fn(),
        retry: vi.fn(),
        stop: vi.fn(),
        switchLeague: vi.fn(),
        getSelectedLeague: () => 'Standard',
        getAvailableLeagues: () => ['Standard'],
        dispose: vi.fn(),
      };

      const { container, unmount } = mountComponent({
        controller,
        sourceController: mockSourceController,
      });
      await flushAsync();

      const img = container.querySelector(
        '[data-test="connection-item-thumbnail"]',
      ) as HTMLImageElement;
      expect(img).not.toBeNull();
      expect(img.style.visibility).not.toBe('hidden');

      // Trigger image load error event
      img.dispatchEvent(new Event('error'));
      await flushAsync();

      expect(img.style.visibility).toBe('hidden');

      unmount();
    });

    it('excludes right-side control buttons from the tooltip trigger surface', async () => {
      const controller = createLiveSearchPrimaryController(runtime);
      const snap: LiveSearchSourceSnapshot = {
        loading: false,
        selectedLeague: 'Standard',
        availableLeagues: ['Standard'],
        isSwitchingLeague: false,
        leagueResolved: true,
        groups: [
          {
            id: 'g-controls',
            name: '控制按鈕測試',
            kind: 'bookmark',
            depth: 0,
            items: [
              {
                kind: 'bookmark',
                id: 'b-idle-ctrl',
                name: '待啟用項目',
                url: 'https://www.pathofexile.com/trade/search/Standard/H4sIidle_ctrl',
                canonicalIdentity: null,
                canonicalKey: 'poe1/Standard/idle_ctrl',
                compatibility: 'compatible',
                groupId: 'g-controls',
                groupName: '控制按鈕測試',
                pending: false,
                removable: false,
              },
            ],
            bookmarks: [],
          },
        ],
      };

      const mockSourceController: LiveSearchSourceController = {
        read: () => snap,
        subscribe: (listener) => {
          listener(snap);
          return () => {};
        },
        enable: vi.fn(),
        add: vi.fn(),
        enableMany: vi.fn(),
        stopMany: vi.fn(),
        addCustom: vi.fn(),
        removeCustom: vi.fn(),
        retry: vi.fn(),
        stop: vi.fn(),
        switchLeague: vi.fn(),
        getSelectedLeague: () => 'Standard',
        getAvailableLeagues: () => ['Standard'],
        dispose: vi.fn(),
      };

      const { container, unmount } = mountComponent({
        controller,
        sourceController: mockSourceController,
      });
      await flushAsync();

      const identityEl = container.querySelector('[data-test="connection-item-identity"]');
      const enableBtn = container.querySelector('[data-test="btn-enable-b-idle-ctrl"]');

      expect(identityEl).not.toBeNull();
      expect(enableBtn).not.toBeNull();

      // enableBtn must NOT be a child of identityEl (the tooltip trigger)
      expect(identityEl?.contains(enableBtn)).toBe(false);

      unmount();
    });

    it('dynamically adapts Tooltip side according to sidebarPosition preference', async () => {
      const sampleUrl = createGzipTradeUrl(
        {
          query: {
            name: 'Headhunter',
            type: 'Leather Belt',
          },
        },
        'poe1',
      );

      const controller = createLiveSearchPrimaryController(runtime);
      const snap: LiveSearchSourceSnapshot = {
        loading: false,
        selectedLeague: 'Standard',
        availableLeagues: ['Standard'],
        isSwitchingLeague: false,
        leagueResolved: true,
        groups: [
          {
            id: 'g-pos',
            name: '位置測試',
            kind: 'bookmark',
            depth: 0,
            items: [
              {
                kind: 'bookmark',
                id: 'b-pos-1',
                name: '側欄位置測試項',
                url: sampleUrl,
                canonicalIdentity: null,
                canonicalKey: 'poe1/Standard/pos_1',
                compatibility: 'compatible',
                groupId: 'g-pos',
                groupName: '位置測試',
                pending: false,
                removable: false,
              },
            ],
            bookmarks: [],
          },
        ],
      };

      const mockSourceController: LiveSearchSourceController = {
        read: () => snap,
        subscribe: (listener) => {
          listener(snap);
          return () => {};
        },
        enable: vi.fn(),
        add: vi.fn(),
        enableMany: vi.fn(),
        stopMany: vi.fn(),
        addCustom: vi.fn(),
        removeCustom: vi.fn(),
        retry: vi.fn(),
        stop: vi.fn(),
        switchLeague: vi.fn(),
        getSelectedLeague: () => 'Standard',
        getAvailableLeagues: () => ['Standard'],
        dispose: vi.fn(),
      };

      function triggerTooltip(el: HTMLElement) {
        if (typeof PointerEvent !== 'undefined') {
          el.dispatchEvent(
            new PointerEvent('pointermove', {
              bubbles: true,
              cancelable: true,
              pointerType: 'mouse',
            }),
          );
        } else {
          el.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, cancelable: true }));
        }
        el.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      }

      // Case A: sidebarPosition = 'left' -> tooltip side should be 'right'
      const leftStorage = createInMemoryPreferencesStorage({ sidebarPosition_poe1: 'left' });
      const leftRes = await createPreferencesModule('poe1', leftStorage);
      if (!leftRes.ok) throw new Error(leftRes.error.message);
      const leftPref = leftRes.value;
      const { container: containerLeft, unmount: unmountLeft } = mountComponent({
        controller,
        sourceController: mockSourceController,
        preferences: leftPref,
      });
      await flushAsync();

      const identityLeft = containerLeft.querySelector(
        '[data-source-id="b-pos-1"] [data-test="connection-item-identity"]',
      ) as HTMLElement;
      expect(identityLeft).not.toBeNull();
      triggerTooltip(identityLeft);
      await flushAsync(250);

      const tooltipLeft = document.body.querySelector('[data-slot="tooltip-content"]');
      expect(tooltipLeft).not.toBeNull();
      expect(tooltipLeft?.getAttribute('data-side')).toBe('right');
      unmountLeft();
      await flushAsync(50);

      // Case B: sidebarPosition = 'right' -> tooltip side should be 'left'
      const rightStorage = createInMemoryPreferencesStorage({ sidebarPosition_poe1: 'right' });
      const rightRes = await createPreferencesModule('poe1', rightStorage);
      if (!rightRes.ok) throw new Error(rightRes.error.message);
      const rightPref = rightRes.value;
      const { container: containerRight, unmount: unmountRight } = mountComponent({
        controller,
        sourceController: mockSourceController,
        preferences: rightPref,
      });
      await flushAsync();

      const identityRight = containerRight.querySelector(
        '[data-source-id="b-pos-1"] [data-test="connection-item-identity"]',
      ) as HTMLElement;
      expect(identityRight).not.toBeNull();
      triggerTooltip(identityRight);
      await flushAsync(250);

      const tooltipRight = document.body.querySelector('[data-slot="tooltip-content"]');
      expect(tooltipRight).not.toBeNull();
      expect(tooltipRight?.getAttribute('data-side')).toBe('left');
      unmountRight();
    });

    it('disables preview tooltip for invalid-url items while supporting wrong-version items', async () => {
      const controller = createLiveSearchPrimaryController(runtime);
      const snap: LiveSearchSourceSnapshot = {
        loading: false,
        selectedLeague: 'Standard',
        availableLeagues: ['Standard'],
        isSwitchingLeague: false,
        leagueResolved: true,
        groups: [
          {
            id: 'g-compat',
            name: '相容性測試',
            kind: 'bookmark',
            depth: 0,
            items: [
              {
                kind: 'bookmark',
                id: 'b-invalid-url',
                name: '損毀網址項目',
                url: 'https://www.google.com/not-a-trade-url',
                canonicalIdentity: null,
                canonicalKey: null,
                compatibility: 'invalid-url',
                compatibilityMessage: '無效的官方交易網址',
                groupId: 'g-compat',
                groupName: '相容性測試',
                pending: false,
                removable: false,
              },
              {
                kind: 'bookmark',
                id: 'b-wrong-version',
                name: '跨版本項目',
                url: createGzipTradeUrl({ query: { name: 'Foul Staff' } }, 'poe2'),
                canonicalIdentity: {
                  gameVersion: 'poe2',
                  league: 'Standard',
                  searchId: 'H4sIpoe2_search',
                },
                canonicalKey: 'poe2/Standard/poe2_search',
                compatibility: 'wrong-version',
                compatibilityMessage: '此搜尋屬於 PoE 2，與目前主控台不符',
                groupId: 'g-compat',
                groupName: '相容性測試',
                pending: false,
                removable: false,
              },
            ],
            bookmarks: [],
          },
        ],
      };

      const mockSourceController: LiveSearchSourceController = {
        read: () => snap,
        subscribe: (listener) => {
          listener(snap);
          return () => {};
        },
        enable: vi.fn(),
        add: vi.fn(),
        enableMany: vi.fn(),
        stopMany: vi.fn(),
        addCustom: vi.fn(),
        removeCustom: vi.fn(),
        retry: vi.fn(),
        stop: vi.fn(),
        switchLeague: vi.fn(),
        getSelectedLeague: () => 'Standard',
        getAvailableLeagues: () => ['Standard'],
        dispose: vi.fn(),
      };

      function triggerTooltip(el: HTMLElement) {
        if (typeof PointerEvent !== 'undefined') {
          el.dispatchEvent(
            new PointerEvent('pointermove', {
              bubbles: true,
              cancelable: true,
              pointerType: 'mouse',
            }),
          );
        } else {
          el.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, cancelable: true }));
        }
        el.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      }

      const { container, unmount } = mountComponent({
        controller,
        sourceController: mockSourceController,
      });
      await flushAsync();

      // C. invalid-url 項目：互動時不得觸發 preview 解碼管線，不得渲染 preview tooltip
      const invalidItemEl = container.querySelector('[data-source-id="b-invalid-url"]');
      expect(invalidItemEl).not.toBeNull();
      expect(invalidItemEl?.getAttribute('data-source-compatibility')).toBe('invalid-url');

      const invalidIdentity = invalidItemEl?.querySelector(
        '[data-test="connection-item-identity"]',
      ) as HTMLElement;
      expect(invalidIdentity).not.toBeNull();
      triggerTooltip(invalidIdentity);
      await flushAsync(250);
      expect(document.body.querySelector('[data-slot="tooltip-content"]')).toBeNull();

      // wrong-version 項目仍具合法 URL，可正常觸發預覽浮層
      const wrongVersionItemEl = container.querySelector('[data-source-id="b-wrong-version"]');
      expect(wrongVersionItemEl).not.toBeNull();
      expect(wrongVersionItemEl?.getAttribute('data-source-compatibility')).toBe('wrong-version');

      const wrongVersionIdentity = wrongVersionItemEl?.querySelector(
        '[data-test="connection-item-identity"]',
      ) as HTMLElement;
      expect(wrongVersionIdentity).not.toBeNull();
      triggerTooltip(wrongVersionIdentity);
      await flushAsync(250);
      expect(document.body.querySelector('[data-slot="tooltip-content"]')).not.toBeNull();

      unmount();
    });

    it('supports preview loading from row identity and shares URL cache across bookmark and temporary searches without duplicate decoding', async () => {
      const sampleUrlA = createGzipTradeUrl(
        {
          query: {
            name: 'Headhunter',
            type: 'Leather Belt',
            filters: {
              misc_filters: {
                filters: {
                  corrupted: { option: 'false' },
                },
              },
            },
          },
        },
        'poe1',
      );

      const sampleUrlB = createGzipTradeUrl(
        {
          query: {
            name: 'Mageblood',
            type: 'Heavy Belt',
          },
        },
        'poe1',
      );

      const controller = createLiveSearchPrimaryController(runtime);
      const snapRef = ref<LiveSearchSourceSnapshot>({
        loading: false,
        selectedLeague: 'Standard',
        availableLeagues: ['Standard'],
        isSwitchingLeague: false,
        leagueResolved: true,
        groups: [
          {
            id: 'g-1',
            name: '書籤群組',
            kind: 'bookmark',
            depth: 0,
            items: [
              {
                kind: 'bookmark',
                id: 'b-hh',
                name: '獵首書籤',
                url: sampleUrlA,
                canonicalIdentity: null,
                canonicalKey: 'poe1/Standard/hh',
                compatibility: 'compatible',
                groupId: 'g-1',
                groupName: '書籤群組',
                pending: false,
                removable: false,
              },
            ],
            bookmarks: [],
          },
          {
            id: 'custom_sources',
            name: '暫時搜尋',
            kind: 'custom',
            depth: 0,
            items: [
              {
                kind: 'custom',
                id: 'c-mb',
                name: '魔血暫時搜尋',
                url: sampleUrlB,
                canonicalIdentity: null,
                canonicalKey: 'poe1/Standard/mb',
                compatibility: 'compatible',
                groupId: 'custom_sources',
                groupName: '暫時搜尋',
                pending: false,
                removable: true,
              },
              {
                kind: 'custom',
                id: 'c-shared-hh',
                name: '共用獵首暫時搜尋',
                url: sampleUrlA,
                canonicalIdentity: null,
                canonicalKey: 'poe1/Standard/shared-hh',
                compatibility: 'compatible',
                groupId: 'custom_sources',
                groupName: '暫時搜尋',
                pending: false,
                removable: true,
              },
            ],
            bookmarks: [],
          },
        ],
      });

      const mockSourceController: LiveSearchSourceController = {
        read: () => snapRef.value,
        subscribe: (listener) => {
          listener(snapRef.value);
          const stop = watch(snapRef, (newSnap) => listener(newSnap), { deep: true });
          return () => stop();
        },
        enable: vi.fn(),
        add: vi.fn(),
        enableMany: vi.fn(),
        stopMany: vi.fn(),
        addCustom: vi.fn(),
        removeCustom: vi.fn(),
        retry: vi.fn(),
        stop: vi.fn(),
        switchLeague: vi.fn(),
        getSelectedLeague: () => 'Standard',
        getAvailableLeagues: () => ['Standard'],
        dispose: vi.fn(),
      };

      function triggerTooltip(el: HTMLElement) {
        if (typeof PointerEvent !== 'undefined') {
          el.dispatchEvent(
            new PointerEvent('pointermove', {
              bubbles: true,
              cancelable: true,
              pointerType: 'mouse',
            }),
          );
        } else {
          el.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, cancelable: true }));
        }
        el.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      }

      const { container, unmount } = mountComponent({
        controller,
        sourceController: mockSourceController,
      });
      await flushAsync();

      // A. 真實 Bookmark preview 流程：identity 觸發 preview，驗證 tooltip 內容正確掛載並顯示解碼條件
      const bookmarkIdentity = container.querySelector(
        '[data-source-id="b-hh"] [data-test="connection-item-identity"]',
      ) as HTMLElement;
      expect(bookmarkIdentity).not.toBeNull();
      triggerTooltip(bookmarkIdentity);
      await flushAsync(250);

      let tooltipContent = document.body.querySelector('[data-slot="tooltip-content"]');
      expect(tooltipContent).not.toBeNull();
      expect(tooltipContent?.querySelector('.trade-search-preview-popover')).not.toBeNull();
      expect(tooltipContent?.textContent).toContain('Headhunter');
      expect(tooltipContent?.textContent).toContain('Leather Belt');
      expect(
        bookmarkIdentity.querySelector('[data-test="connection-item-name"]')?.getAttribute('title'),
      ).toBeNull();
      expect(
        tooltipContent?.querySelector('[data-test="preview-source-name"]')?.textContent?.trim(),
      ).toBe('獵首書籤');

      // B. 真實 Temporary Search preview 流程：自訂搜尋 row 也能正確觸發相同的共享 preview 浮層
      const customIdentity = container.querySelector(
        '[data-source-id="c-mb"] [data-test="connection-item-identity"]',
      ) as HTMLElement;
      expect(customIdentity).not.toBeNull();
      triggerTooltip(customIdentity);
      await flushAsync(250);

      tooltipContent = document.body.querySelector('[data-slot="tooltip-content"]');
      expect(tooltipContent).not.toBeNull();
      expect(tooltipContent?.querySelector('.trade-search-preview-popover')).not.toBeNull();
      expect(tooltipContent?.textContent).toContain('Mageblood');
      expect(tooltipContent?.textContent).toContain('Heavy Belt');
      expect(
        customIdentity.querySelector('[data-test="connection-item-name"]')?.getAttribute('title'),
      ).toBeNull();
      expect(
        tooltipContent?.querySelector('[data-test="preview-source-name"]')?.textContent?.trim(),
      ).toBe('魔血暫時搜尋');

      // B2. Temporary Search 與 Bookmark 共用相同 URL 時，立即以共享快取呈現
      const customSharedIdentity = container.querySelector(
        '[data-source-id="c-shared-hh"] [data-test="connection-item-identity"]',
      ) as HTMLElement;
      expect(customSharedIdentity).not.toBeNull();
      triggerTooltip(customSharedIdentity);
      await flushAsync(250);

      tooltipContent = document.body.querySelector('[data-slot="tooltip-content"]');
      expect(tooltipContent).not.toBeNull();
      expect(tooltipContent?.textContent).toContain('Headhunter');

      unmount();
    });

    it('cleans up active preview when source item disappears from view via filter or snapshot removal', async () => {
      const sampleUrl = createGzipTradeUrl(
        {
          query: {
            name: 'Headhunter',
            type: 'Leather Belt',
          },
        },
        'poe1',
      );

      const controller = createLiveSearchPrimaryController(runtime);
      const snapRef = ref<LiveSearchSourceSnapshot>({
        loading: false,
        selectedLeague: 'Standard',
        availableLeagues: ['Standard', 'Hardcore'],
        isSwitchingLeague: false,
        leagueResolved: true,
        groups: [
          {
            id: 'g-cleanup',
            name: '清理測試',
            kind: 'bookmark',
            depth: 0,
            items: [
              {
                kind: 'bookmark',
                id: 'b-cleanup-1',
                name: '待消失項目',
                url: sampleUrl,
                canonicalIdentity: null,
                canonicalKey: 'poe1/Standard/cleanup_1',
                compatibility: 'compatible',
                groupId: 'g-cleanup',
                groupName: '清理測試',
                pending: false,
                removable: false,
              },
            ],
            bookmarks: [],
          },
        ],
      });

      const mockSourceController: LiveSearchSourceController = {
        read: () => snapRef.value,
        subscribe: (listener) => {
          listener(snapRef.value);
          const stop = watch(snapRef, (newSnap) => listener(newSnap), { deep: true });
          return () => stop();
        },
        enable: vi.fn(),
        add: vi.fn(),
        enableMany: vi.fn(),
        stopMany: vi.fn(),
        addCustom: vi.fn(),
        removeCustom: vi.fn(),
        retry: vi.fn(),
        stop: vi.fn(),
        switchLeague: vi.fn(),
        getSelectedLeague: () => 'Standard',
        getAvailableLeagues: () => ['Standard', 'Hardcore'],
        dispose: vi.fn(),
      };

      function triggerTooltip(el: HTMLElement) {
        if (typeof PointerEvent !== 'undefined') {
          el.dispatchEvent(
            new PointerEvent('pointermove', {
              bubbles: true,
              cancelable: true,
              pointerType: 'mouse',
            }),
          );
        } else {
          el.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, cancelable: true }));
        }
        el.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      }

      const { container, unmount } = mountComponent({
        controller,
        sourceController: mockSourceController,
      });
      await flushAsync();

      const identityEl = container.querySelector(
        '[data-source-id="b-cleanup-1"] [data-test="connection-item-identity"]',
      ) as HTMLElement;
      expect(identityEl).not.toBeNull();

      // 先開啟 preview，確認處於 active 狀態
      triggerTooltip(identityEl);
      await flushAsync(250);
      expect(document.body.querySelector('[data-slot="tooltip-content"]')).not.toBeNull();

      // D. 項目消失／被過濾：透過關鍵字搜尋將該項目過濾掉，驗證 active preview 被可靠關閉並清除
      const searchInput = container.querySelector(
        '[data-test="search-connections-input"]',
      ) as HTMLInputElement;
      searchInput.value = 'non_matching_search_keyword';
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      await flushAsync(100);

      expect(container.querySelector('[data-source-id="b-cleanup-1"]')).toBeNull();
      expect(document.body.querySelector('[data-slot="tooltip-content"]')).toBeNull();

      // 清除關鍵字並重新打開 preview
      searchInput.value = '';
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      await flushAsync(100);

      const restoredIdentityEl = container.querySelector(
        '[data-source-id="b-cleanup-1"] [data-test="connection-item-identity"]',
      ) as HTMLElement;
      expect(restoredIdentityEl).not.toBeNull();
      triggerTooltip(restoredIdentityEl);
      await flushAsync(250);
      expect(document.body.querySelector('[data-slot="tooltip-content"]')).not.toBeNull();

      // 從 snapshot 移除該項目，驗證 active preview 同樣立即關閉
      snapRef.value = {
        ...snapRef.value,
        groups: [
          {
            id: 'g-cleanup',
            name: '清理測試',
            kind: 'bookmark',
            depth: 0,
            items: [],
            bookmarks: [],
          },
        ],
      };
      await flushAsync(100);
      expect(document.body.querySelector('[data-slot="tooltip-content"]')).toBeNull();

      unmount();
    });

    it('reconciles active preview when source URL changes for the same entity ID or changes to invalid-url', async () => {
      const urlA = createGzipTradeUrl(
        {
          query: {
            name: 'Headhunter',
            type: 'Leather Belt',
          },
        },
        'poe1',
      );

      const urlB = createGzipTradeUrl(
        {
          query: {
            name: 'Mageblood',
            type: 'Heavy Belt',
          },
        },
        'poe1',
      );

      const controller = createLiveSearchPrimaryController(runtime);
      const snapRef = ref<LiveSearchSourceSnapshot>({
        loading: false,
        selectedLeague: 'Standard',
        availableLeagues: ['Standard'],
        isSwitchingLeague: false,
        leagueResolved: true,
        groups: [
          {
            id: 'g-reconcile',
            name: '變更測試',
            kind: 'bookmark',
            depth: 0,
            items: [
              {
                kind: 'bookmark',
                id: 'b-reconcile-1',
                name: '動態更新項目',
                url: urlA,
                canonicalIdentity: null,
                canonicalKey: 'poe1/Standard/reconcile_1',
                compatibility: 'compatible',
                groupId: 'g-reconcile',
                groupName: '變更測試',
                pending: false,
                removable: false,
              },
            ],
            bookmarks: [],
          },
        ],
      });

      const mockSourceController: LiveSearchSourceController = {
        read: () => snapRef.value,
        subscribe: (listener) => {
          listener(snapRef.value);
          const stop = watch(snapRef, (newSnap) => listener(newSnap), { deep: true });
          return () => stop();
        },
        enable: vi.fn(),
        add: vi.fn(),
        enableMany: vi.fn(),
        stopMany: vi.fn(),
        addCustom: vi.fn(),
        removeCustom: vi.fn(),
        retry: vi.fn(),
        stop: vi.fn(),
        switchLeague: vi.fn(),
        getSelectedLeague: () => 'Standard',
        getAvailableLeagues: () => ['Standard'],
        dispose: vi.fn(),
      };

      function triggerTooltip(el: HTMLElement) {
        if (typeof PointerEvent !== 'undefined') {
          el.dispatchEvent(
            new PointerEvent('pointermove', {
              bubbles: true,
              cancelable: true,
              pointerType: 'mouse',
            }),
          );
        } else {
          el.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, cancelable: true }));
        }
        el.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      }

      const { container, unmount } = mountComponent({
        controller,
        sourceController: mockSourceController,
      });
      await flushAsync();

      const identityEl = container.querySelector(
        '[data-source-id="b-reconcile-1"] [data-test="connection-item-identity"]',
      ) as HTMLElement;
      expect(identityEl).not.toBeNull();

      // 1. 先開啟 bookmark:b-reconcile-1 -> URL A，驗證 preview 正確顯示 Headhunter
      triggerTooltip(identityEl);
      await flushAsync(250);

      let tooltip = document.body.querySelector('[data-slot="tooltip-content"]');
      expect(tooltip).not.toBeNull();
      expect(tooltip?.textContent).toContain('Headhunter');

      // 2. 保持相同 ID，但將快照中的 URL 更新為 URL B（如書籤編輯或同步）
      snapRef.value = {
        ...snapRef.value,
        groups: [
          {
            id: 'g-reconcile',
            name: '變更測試',
            kind: 'bookmark',
            depth: 0,
            items: [
              {
                kind: 'bookmark',
                id: 'b-reconcile-1',
                name: '動態更新項目',
                url: urlB,
                canonicalIdentity: null,
                canonicalKey: 'poe1/Standard/reconcile_1',
                compatibility: 'compatible',
                groupId: 'g-reconcile',
                groupName: '變更測試',
                pending: false,
                removable: false,
              },
            ],
            bookmarks: [],
          },
        ],
      };
      await flushAsync(100);

      // 原 URL A 的預覽浮層不得殘留
      tooltip = document.body.querySelector('[data-slot="tooltip-content"]');
      expect(tooltip).toBeNull();

      // 3. 再次觸發相同 ID 的 preview，此時已載入新的 URL B (Mageblood)
      const updatedIdentityEl = container.querySelector(
        '[data-source-id="b-reconcile-1"] [data-test="connection-item-identity"]',
      ) as HTMLElement;
      expect(updatedIdentityEl).not.toBeNull();
      triggerTooltip(updatedIdentityEl);
      await flushAsync(250);

      tooltip = document.body.querySelector('[data-slot="tooltip-content"]');
      expect(tooltip).not.toBeNull();
      expect(tooltip?.textContent).toContain('Mageblood');

      // 4. 同一 ID 變更為 invalid-url 時，預覽必須立即關閉
      snapRef.value = {
        ...snapRef.value,
        groups: [
          {
            id: 'g-reconcile',
            name: '變更測試',
            kind: 'bookmark',
            depth: 0,
            items: [
              {
                kind: 'bookmark',
                id: 'b-reconcile-1',
                name: '動態更新項目',
                url: 'https://example.com/not-valid-trade',
                canonicalIdentity: null,
                canonicalKey: null,
                compatibility: 'invalid-url',
                groupId: 'g-reconcile',
                groupName: '變更測試',
                pending: false,
                removable: false,
              },
            ],
            bookmarks: [],
          },
        ],
      };
      await flushAsync(100);

      tooltip = document.body.querySelector('[data-slot="tooltip-content"]');
      expect(tooltip).toBeNull();

      unmount();
    });

    it('late close events from non-active entity do not clear subsequent active preview or its URL reconciliation context', async () => {
      const urlA = createGzipTradeUrl(
        {
          query: {
            name: 'Headhunter',
            type: 'Leather Belt',
          },
        },
        'poe1',
      );

      const urlB1 = createGzipTradeUrl(
        {
          query: {
            name: 'Mageblood',
            type: 'Heavy Belt',
          },
        },
        'poe1',
      );

      const urlB2 = createGzipTradeUrl(
        {
          query: {
            name: 'Nimis',
            type: 'Topaz Ring',
          },
        },
        'poe1',
      );

      const controller = createLiveSearchPrimaryController(runtime);
      const snapRef = ref<LiveSearchSourceSnapshot>({
        loading: false,
        selectedLeague: 'Standard',
        availableLeagues: ['Standard'],
        isSwitchingLeague: false,
        leagueResolved: true,
        groups: [
          {
            id: 'g-race',
            name: '競態測試',
            kind: 'bookmark',
            depth: 0,
            items: [
              {
                kind: 'bookmark',
                id: 'b-race-a',
                name: '項目 A',
                url: urlA,
                canonicalIdentity: null,
                canonicalKey: 'poe1/Standard/race_a',
                compatibility: 'compatible',
                groupId: 'g-race',
                groupName: '競態測試',
                pending: false,
                removable: false,
              },
              {
                kind: 'bookmark',
                id: 'b-race-b',
                name: '項目 B',
                url: urlB1,
                canonicalIdentity: null,
                canonicalKey: 'poe1/Standard/race_b1',
                compatibility: 'compatible',
                groupId: 'g-race',
                groupName: '競態測試',
                pending: false,
                removable: false,
              },
            ],
            bookmarks: [],
          },
        ],
      });

      const mockSourceController: LiveSearchSourceController = {
        read: () => snapRef.value,
        subscribe: (listener) => {
          listener(snapRef.value);
          const stop = watch(snapRef, (newSnap) => listener(newSnap), { deep: true });
          return () => stop();
        },
        enable: vi.fn(),
        add: vi.fn(),
        enableMany: vi.fn(),
        stopMany: vi.fn(),
        addCustom: vi.fn(),
        removeCustom: vi.fn(),
        retry: vi.fn(),
        stop: vi.fn(),
        switchLeague: vi.fn(),
        getSelectedLeague: () => 'Standard',
        getAvailableLeagues: () => ['Standard'],
        dispose: vi.fn(),
      };

      function triggerTooltipOpen(el: HTMLElement) {
        if (typeof PointerEvent !== 'undefined') {
          el.dispatchEvent(
            new PointerEvent('pointermove', {
              bubbles: true,
              cancelable: true,
              pointerType: 'mouse',
            }),
          );
        } else {
          el.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, cancelable: true }));
        }
        el.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      }

      function triggerTooltipClose(el: HTMLElement) {
        if (typeof PointerEvent !== 'undefined') {
          el.dispatchEvent(
            new PointerEvent('pointerleave', {
              bubbles: true,
              cancelable: true,
              pointerType: 'mouse',
            }),
          );
        } else {
          el.dispatchEvent(new MouseEvent('pointerleave', { bubbles: true, cancelable: true }));
        }
        el.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
      }

      const { container, unmount } = mountComponent({
        controller,
        sourceController: mockSourceController,
      });
      await flushAsync();

      const identityA = container.querySelector(
        '[data-source-id="b-race-a"] [data-test="connection-item-identity"]',
      ) as HTMLElement;
      const identityB = container.querySelector(
        '[data-source-id="b-race-b"] [data-test="connection-item-identity"]',
      ) as HTMLElement;
      expect(identityA).not.toBeNull();
      expect(identityB).not.toBeNull();

      // 1. 開啟 A preview
      triggerTooltipOpen(identityA);
      await flushAsync(250);

      let tooltip = document.body.querySelector('[data-slot="tooltip-content"]');
      expect(tooltip).not.toBeNull();
      expect(tooltip?.textContent).toContain('Headhunter');

      // 2. 開啟 B preview，且在同波次模擬 A 的 late open=false 抵達
      triggerTooltipOpen(identityB);
      triggerTooltipClose(identityA);
      await flushAsync(250);

      // 3. 確認 B 仍保持 active 且顯示 Mageblood
      tooltip = document.body.querySelector('[data-slot="tooltip-content"]');
      expect(tooltip).not.toBeNull();
      expect(tooltip?.textContent).toContain('Mageblood');

      // 4. 保持 B entity ID 不變，將 B URL 更新為 urlB2 (Nimis)
      snapRef.value = {
        ...snapRef.value,
        groups: [
          {
            id: 'g-race',
            name: '競態測試',
            kind: 'bookmark',
            depth: 0,
            items: [
              {
                kind: 'bookmark',
                id: 'b-race-a',
                name: '項目 A',
                url: urlA,
                canonicalIdentity: null,
                canonicalKey: 'poe1/Standard/race_a',
                compatibility: 'compatible',
                groupId: 'g-race',
                groupName: '競態測試',
                pending: false,
                removable: false,
              },
              {
                kind: 'bookmark',
                id: 'b-race-b',
                name: '項目 B',
                url: urlB2,
                canonicalIdentity: null,
                canonicalKey: 'poe1/Standard/race_b2',
                compatibility: 'compatible',
                groupId: 'g-race',
                groupName: '競態測試',
                pending: false,
                removable: false,
              },
            ],
            bookmarks: [],
          },
        ],
      };
      await flushAsync(100);

      // 5. 確認 B 的 URL reconciliation context 未被 A 清掉，B 的舊 preview 立即被關閉
      tooltip = document.body.querySelector('[data-slot="tooltip-content"]');
      expect(tooltip).toBeNull();

      // 6. 再 hover B 時才載入新 URL preview (Nimis)
      const updatedIdentityB = container.querySelector(
        '[data-source-id="b-race-b"] [data-test="connection-item-identity"]',
      ) as HTMLElement;
      expect(updatedIdentityB).not.toBeNull();
      triggerTooltipOpen(updatedIdentityB);
      await flushAsync(250);

      tooltip = document.body.querySelector('[data-slot="tooltip-content"]');
      expect(tooltip).not.toBeNull();
      expect(tooltip?.textContent).toContain('Nimis');

      unmount();
    });
  });

  describe('Two-Section Console (本次連線 & 上次連線) & Push-to-Console Integration', () => {
    it('supports 上次連線 single enable, 全部恢復, single remove, 清空上次連線紀錄, and 本次連線 pause vs remove', async () => {
      const controller = createLiveSearchPrimaryController(runtime);
      const port: LiveSearchBookmarkSourcePort = {
        readCollection: async () => ({
          ok: true,
          value: {
            groups: [{ id: 'grp_1', name: '裝備', order: 0 } as any],
            bookmarks: [
              {
                id: 'bmk_prev_1',
                name: '魔血腰帶',
                url: 'https://www.pathofexile.com/trade/search/Standard/H4sIprev_1',
                leaguePinned: true,
                groupId: 'grp_1',
                searchRecordId: 'rp1',
                gameVersion: 'poe1',
                order: 0,
              },
            ],
          },
        }),
        subscribe: () => () => {},
      };

      let storedIdentities: any[] = [
        { gameVersion: 'poe1', league: 'standard', searchId: 'H4sIprev_1' },
        {
          gameVersion: 'poe1',
          league: 'standard',
          searchId: 'H4sIprev_pushed',
          name: '一般頁面派送項目',
          url: 'https://www.pathofexile.com/trade/search/Standard/H4sIprev_pushed',
        },
        {
          gameVersion: 'poe1',
          league: 'standard',
          searchId: 'H4sIprev_to_remove',
          name: '待移除上次連線',
          url: 'https://www.pathofexile.com/trade/search/Standard/H4sIprev_to_remove',
        },
      ];
      const resumeStorage = {
        async get() {
          return {
            liveSearchResumePlan_poe1: {
              version: 2,
              identities: storedIdentities,
            },
          };
        },
        async set(values: Record<string, any>) {
          if (values.liveSearchResumePlan_poe1) {
            storedIdentities = values.liveSearchResumePlan_poe1.identities ?? [];
          }
        },
        async remove() {
          storedIdentities = [];
        },
      };
      const resumeStore = createLiveSearchResumeStore('poe1', resumeStorage);
      const sourceController = createLiveSearchSourceController(port, controller, { resumeStore });

      const { container, unmount } = mountComponent({ controller, sourceController });
      await flushAsync();

      // 1. 初始僅顯示「上次連線」3 筆，尚無「本次連線」
      expect(container.querySelector('[data-group-id="session_connections"]')).toBeNull();
      const prevGroup = container.querySelector('[data-group-id="previous_connections"]');
      expect(prevGroup).not.toBeNull();
      expect(prevGroup?.querySelectorAll('[data-test="connection-item"]')).toHaveLength(3);

      // 2. 從「上次連線」移除單筆 (待移除上次連線)
      const prevRemoveItem = container.querySelector(
        '[data-source-id="prev_poe1:standard:H4sIprev_to_remove"]',
      );
      expect(prevRemoveItem).not.toBeNull();
      const prevItemMenuBtn = prevRemoveItem?.querySelector(
        '[data-test^="btn-item-menu-"]',
      ) as HTMLButtonElement;
      prevItemMenuBtn.click();
      await flushAsync();
      const removePrevBtn = document.body.querySelector(
        '[data-test="btn-remove-prev_poe1:standard:H4sIprev_to_remove"]',
      ) as HTMLElement;
      expect(removePrevBtn).not.toBeNull();
      expect(removePrevBtn.textContent?.trim()).toBe('移除上次連線紀錄');
      removePrevBtn.click();
      await flushAsync();

      expect(
        container.querySelectorAll(
          '[data-group-id="previous_connections"] [data-test="connection-item"]',
        ),
      ).toHaveLength(2);

      // 3. 在「上次連線」點擊單筆啟用 (魔血腰帶) -> 移入「本次連線」
      const enablePrev1Btn = container.querySelector(
        '[data-test="btn-enable-bmk_prev_1"]',
      ) as HTMLButtonElement;
      enablePrev1Btn.click();
      await flushAsync();
      createdSockets[createdSockets.length - 1].triggerOpen();
      await flushAsync();

      expect(
        container.querySelectorAll(
          '[data-group-id="session_connections"] [data-test="connection-item"]',
        ),
      ).toHaveLength(1);
      expect(
        container.querySelectorAll(
          '[data-group-id="previous_connections"] [data-test="connection-item"]',
        ),
      ).toHaveLength(1);

      // 4. 在「本次連線」點擊停止 -> 留在「本次連線」轉為未啟用（不會跳回上次連線）
      const stopSession1Btn = container.querySelector(
        '[data-test="btn-stop-bmk_prev_1"]',
      ) as HTMLButtonElement;
      stopSession1Btn.click();
      await flushAsync();

      expect(
        container.querySelectorAll(
          '[data-group-id="session_connections"] [data-test="connection-item"]',
        ),
      ).toHaveLength(1);
      expect(
        container.querySelector('[data-test="btn-enable-bmk_prev_1"]')?.getAttribute('data-status'),
      ).toBe('未啟用');
      expect(
        container.querySelectorAll(
          '[data-group-id="previous_connections"] [data-test="connection-item"]',
        ),
      ).toHaveLength(1);

      // 5. 點擊「上次連線」Header 的 [▶ 全部恢復] 快捷按鈕 -> 剩餘 1 筆移入「本次連線」，「上次連線」自動隱藏
      const restoreAllQuickBtn = container.querySelector(
        '[data-test="btn-group-quick-enable-previous_connections"]',
      ) as HTMLButtonElement;
      expect(restoreAllQuickBtn).not.toBeNull();
      expect(restoreAllQuickBtn.getAttribute('title')).toBe('全部恢復');
      restoreAllQuickBtn.click();
      await flushAsync();

      expect(
        container.querySelectorAll(
          '[data-group-id="session_connections"] [data-test="connection-item"]',
        ),
      ).toHaveLength(2);
      expect(container.querySelector('[data-group-id="previous_connections"]')).toBeNull();

      // 6. 從「本次連線」透過選單移除「魔血腰帶」 -> 徹底從本次連線移除
      const sessionMenuBtn = container.querySelector(
        '[data-test="btn-item-menu-bmk_prev_1"]',
      ) as HTMLButtonElement;
      sessionMenuBtn.click();
      await flushAsync();
      const removeSessionBtn = document.body.querySelector(
        '[data-test="btn-remove-bmk_prev_1"]',
      ) as HTMLElement;
      expect(removeSessionBtn).not.toBeNull();
      expect(removeSessionBtn.textContent?.trim()).toBe('從本次連線移除');
      removeSessionBtn.click();
      await flushAsync();

      expect(
        container.querySelectorAll(
          '[data-group-id="session_connections"] [data-test="connection-item"]',
        ),
      ).toHaveLength(1);

      unmount();
      sourceController.dispose();
    });

    it('enqueues incoming connections from Normal Page into 本次連線 and persists metadata to ResumeStore', async () => {
      const controller = createLiveSearchPrimaryController(runtime);
      let storedIdentities: any[] = [];
      const resumeStorage = {
        async get() {
          return {
            liveSearchResumePlan_poe1: {
              version: 2,
              identities: storedIdentities,
            },
          };
        },
        async set(values: Record<string, any>) {
          if (values.liveSearchResumePlan_poe1) {
            storedIdentities = values.liveSearchResumePlan_poe1.identities ?? [];
          }
        },
        async remove() {
          storedIdentities = [];
        },
      };
      const resumeStore = createLiveSearchResumeStore('poe1', resumeStorage);
      const sourceController = createLiveSearchSourceController(null, controller, { resumeStore });

      const { container, unmount } = mountComponent({ controller, sourceController });
      await flushAsync();

      const res = await sourceController.enqueueIncomingConnections!([
        {
          url: 'https://www.pathofexile.com/trade/search/Standard/H4sInormal_push_1',
          name: '一般頁面搜尋條件',
          coverImageUrl: 'https://web.poecdn.com/gen/image/push_cover.png',
        },
      ]);

      expect(res.success).toBe(true);
      expect(res.addedCount).toBe(1);
      await flushAsync();

      const sessionGroup = container.querySelector('[data-group-id="session_connections"]');
      expect(sessionGroup).not.toBeNull();
      expect(
        sessionGroup?.querySelector('[data-test="connection-item-name"]')?.textContent?.trim(),
      ).toBe('一般頁面搜尋條件');
      expect(storedIdentities).toEqual([
        {
          gameVersion: 'poe1',
          league: 'standard',
          searchId: 'H4sInormal_push_1',
          name: '一般頁面搜尋條件',
          url: 'https://www.pathofexile.com/trade/search/Standard/H4sInormal_push_1',
          coverImageUrl: 'https://web.poecdn.com/gen/image/push_cover.png',
        },
      ]);

      unmount();
      sourceController.dispose();
    });

    it('retains all unremoved 上次連線 and 本次連線 (including paused and custom URLs) across console reopen, and supports drag-to-trash single removal', async () => {
      let storedIdentities: any[] = [
        {
          gameVersion: 'poe1',
          league: 'standard',
          searchId: 'H4sIunrestored_prev',
          name: '待恢復舊連線',
          url: 'https://www.pathofexile.com/trade/search/Standard/H4sIunrestored_prev',
        },
      ];
      const resumeStorage = {
        async get() {
          return {
            liveSearchResumePlan_poe1: {
              version: 2,
              identities: storedIdentities,
            },
          };
        },
        async set(values: Record<string, any>) {
          if (values.liveSearchResumePlan_poe1) {
            storedIdentities = values.liveSearchResumePlan_poe1.identities ?? [];
          }
        },
        async remove() {
          storedIdentities = [];
        },
      };

      const port: LiveSearchBookmarkSourcePort = {
        readCollection: async () => ({
          ok: true,
          value: {
            groups: [{ id: 'grp_1', name: '裝備', order: 0 } as any],
            bookmarks: [
              {
                id: 'bmk_paused',
                name: '本次暫停書籤',
                url: 'https://www.pathofexile.com/trade/search/Standard/H4sIpaused_bmk',
                leaguePinned: true,
                groupId: 'grp_1',
                searchRecordId: 'rp1',
                gameVersion: 'poe1',
                order: 0,
              },
            ],
          },
        }),
        subscribe: () => () => {},
      };

      // Session 1：啟用一筆書籤後暫停、新增一筆自訂網址，並保留一筆待恢復的上次連線
      const controller1 = createLiveSearchPrimaryController(runtime);
      const resumeStore1 = createLiveSearchResumeStore('poe1', resumeStorage);
      const sourceController1 = createLiveSearchSourceController(port, controller1, {
        resumeStore: resumeStore1,
      });
      await flushAsync();

      await sourceController1.enable('bmk_paused');
      sourceController1.stop('bmk_paused'); // 暫停但仍在本次連線清單內
      await sourceController1.addCustom(
        'https://www.pathofexile.com/trade/search/Standard/H4sIcustom_session',
        { name: '本次自訂網址' },
      );
      await flushAsync();

      // 驗證儲存中同時保留：待恢復舊連線、已暫停的本次書籤、本次自訂網址（共 3 筆）
      expect(storedIdentities.map((i) => i.searchId)).toEqual([
        'H4sIunrestored_prev',
        'H4sIpaused_bmk',
        'H4sIcustom_session',
      ]);

      sourceController1.dispose();

      // Session 2：重新開啟主控台（全新 runtime 與 sourceController），3 筆皆完整顯示於「上次連線」
      const runtime2 = new LiveSearchPrimaryRuntime('poe1', {
        hostClient,
        webSocketFactory,
        openScheduler: new LiveSearchOpenScheduler({ cooldownMs: 0 }),
      });
      const controller2 = createLiveSearchPrimaryController(runtime2);
      const resumeStore2 = createLiveSearchResumeStore('poe1', resumeStorage);
      const sourceController2 = createLiveSearchSourceController(port, controller2, {
        resumeStore: resumeStore2,
      });

      const { container, unmount } = mountComponent({
        controller: controller2,
        sourceController: sourceController2,
      });
      await flushAsync();

      const prevItems = Array.from(
        container.querySelectorAll(
          '[data-group-id="previous_connections"] [data-test="connection-item-name"]',
        ),
      ).map((el) => el.textContent?.trim());
      expect(prevItems).toEqual(['待恢復舊連線', '本次暫停書籤', '本次自訂網址']);

      // 驗證拖曳單筆連線至垃圾桶 (DragTrashZone) 可直接移除該筆連線
      const trashEl = container.querySelector(
        '[data-test="live-search-drag-trash"]',
      ) as HTMLElement;
      expect(trashEl).not.toBeNull();
      expect(trashEl.classList.contains('visible')).toBe(false);

      const firstRow = container.querySelector(
        '[data-group-id="previous_connections"] [data-test="connection-item"]',
      ) as HTMLElement;
      expect(firstRow).not.toBeNull();
      expect(firstRow.getAttribute('draggable')).toBe('true');

      firstRow.dispatchEvent(new Event('dragstart', { bubbles: true, cancelable: true }));
      await nextTick();
      expect(trashEl.classList.contains('visible')).toBe(true);

      trashEl.dispatchEvent(new Event('dragenter', { bubbles: true, cancelable: true }));
      await nextTick();
      expect(trashEl.classList.contains('drag-hover')).toBe(true);
      expect(trashEl.textContent).toContain('放開以移除連線');

      firstRow.dispatchEvent(new Event('dragend', { bubbles: true }));
      await flushAsync();

      expect(trashEl.classList.contains('visible')).toBe(false);
      const remainingPrevItems = Array.from(
        container.querySelectorAll(
          '[data-group-id="previous_connections"] [data-test="connection-item-name"]',
        ),
      ).map((el) => el.textContent?.trim());
      expect(remainingPrevItems).toEqual(['本次暫停書籤', '本次自訂網址']);
      expect(storedIdentities.map((i) => i.searchId)).toEqual([
        'H4sIpaused_bmk',
        'H4sIcustom_session',
      ]);

      unmount();
      sourceController2.dispose();
    });
  });
});
