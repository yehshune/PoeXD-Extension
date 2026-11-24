// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import {
  syncDisplayTotal,
  trimOldestBatches,
} from '@/entrypoints/main-world/official-livesearch-adapter';
import type { HostSearchObject, HostVuexStore } from '@/entrypoints/main-world/host-types';
import {
  RESULT_FILTER_STYLE_ID,
  buildResultFilterCss,
  createLiveSearchResultFilter,
} from '@/entrypoints/content/logic/live-search-result-filter';
import {
  buildFakeTradeResults,
  buildFallbackDevOwners,
} from '@/entrypoints/content/logic/live-search-dev-fixtures';
import { LiveSearchPrimaryRuntime } from '@/entrypoints/content/logic/live-search-primary-runtime';
import type {
  HostCommandOutcome,
  ILiveSearchHostClient,
  RenderResultOptions,
} from '@/entrypoints/content/logic/live-search-host-client';
import {
  parsePoeLiveSearchCommandResult,
  parsePoeLiveSearchRenderResult,
} from '@/utils/event-protocol-types';
import type { SyncTotalOptions } from '@/entrypoints/content/logic/live-search-host-client';
import { createInMemoryPreferencesStorage, createPreferencesModule } from '@/utils/preferences';

function makeStore(): HostVuexStore {
  return {
    _withCommit: (fn) => fn(),
    commit: vi.fn(),
  };
}

function makeContainer(ids: string[]): HostSearchObject {
  return {
    localId: 'display',
    type: 'live',
    live: true,
    status: true,
    realm: 'pc',
    league: 'Standard',
    results: ids.map((id) => ({ id, result: [`t_${id}`], total: 1 })),
    total: ids.length,
    inexact: false,
    collapse: false,
    dirty: false,
    unreadHits: 0,
  };
}

describe('trimOldestBatches（展示筆數上限）', () => {
  it('新批次在前端時，從尾端淘汰最舊者', () => {
    const container = makeContainer(['n', 'a', 'b', 'c']);
    expect(trimOldestBatches(makeStore(), container, 'n', 2)).toBe(2);
    expect(container.results.map((b) => b.id)).toEqual(['n', 'a']);
  });

  it('新批次在尾端時，從前端淘汰最舊者', () => {
    const container = makeContainer(['a', 'b', 'c', 'n']);
    expect(trimOldestBatches(makeStore(), container, 'n', 3)).toBe(1);
    expect(container.results.map((b) => b.id)).toEqual(['b', 'c', 'n']);
  });

  it('未超過上限或上限無效時不變更', () => {
    const container = makeContainer(['n', 'a']);
    expect(trimOldestBatches(makeStore(), container, 'n', 5)).toBe(0);
    expect(trimOldestBatches(makeStore(), container, 'n', undefined)).toBe(0);
    expect(trimOldestBatches(makeStore(), container, 'n', 0)).toBe(0);
    expect(container.results).toHaveLength(2);
  });
});

describe('render payload maxResults', () => {
  const base = {
    requestId: 'r',
    localId: 'l',
    batchId: 'b',
    sourceSearchId: 's',
    token: 't',
    itemData: { id: 'x' },
    total: 1,
  };

  it('保留合法的正整數上限', () => {
    expect(
      parsePoeLiveSearchRenderResult(JSON.stringify({ ...base, maxResults: 100 })),
    ).toMatchObject({ maxResults: 100 });
  });

  it('丟棄非法上限', () => {
    const parsed = parsePoeLiveSearchRenderResult(JSON.stringify({ ...base, maxResults: -1 }));
    expect(parsed).toBeDefined();
    expect(parsed).not.toHaveProperty('maxResults');
  });
});

describe('Result Filter（依連線篩選）', () => {
  it('只隱藏非選定連線的結果列', () => {
    const map = [
      { itemId: 'a1', owner: 'k1' },
      { itemId: 'b1', owner: 'k2' },
      { itemId: 'a"2', owner: 'k1' },
    ];
    expect(buildResultFilterCss(map, null)).toBe('');
    const css = buildResultFilterCss(map, 'k2');
    expect(css).toContain('.row[data-id="a1"]');
    expect(css).toContain('.row[data-id="a\\"2"]');
    expect(css).not.toContain('b1');
  });

  it('套用與取消篩選時注入／移除樣式', () => {
    const filter = createLiveSearchResultFilter({ document });
    filter.record('a1', 'k1');
    filter.record('b1', 'k2');
    filter.setFilter('k1');
    const style = document.getElementById(RESULT_FILTER_STYLE_ID);
    expect(style?.textContent).toContain('b1');
    filter.record('b2', 'k2');
    expect(style?.textContent).toContain('b2');
    expect(filter.countFor('k2')).toBe(2);
    filter.setFilter(null);
    expect(document.getElementById(RESULT_FILTER_STYLE_ID)).toBeNull();
    filter.dispose();
  });

  it('記錄數超過上限時淘汰最舊者', () => {
    const filter = createLiveSearchResultFilter({ document, maxTracked: 2 });
    filter.record('a', 'k');
    filter.record('b', 'k');
    filter.record('c', 'k');
    expect(filter.countFor('k')).toBe(2);
    filter.dispose();
  });
});

describe('Dev 假資料', () => {
  it('依連線輪流分配並具備官方 result 形狀', () => {
    const owners = buildFallbackDevOwners('poe1', 'Standard');
    const items = buildFakeTradeResults(5, 'Standard', 'poe1', owners, 1_000);
    expect(items).toHaveLength(5);
    expect(new Set(items.map((i) => i.itemData.id)).size).toBe(5);
    expect(items[0].ownerKey).toBe(owners[0].canonicalKey);
    expect(items[1].ownerKey).toBe(owners[1].canonicalKey);
    expect(items[0].itemData).toMatchObject({
      listing: { price: { currency: 'chaos' } },
      item: { league: 'Standard', identified: true },
    });
  });

  it('比照新版 /fetch 格式，帶官方卡片渲染所需的 extended、rarity 與物件詞綴', () => {
    const [{ itemData }] = buildFakeTradeResults(
      1,
      'Standard',
      'poe1',
      buildFallbackDevOwners('poe1', 'Standard'),
      1_000,
    );
    const item = (itemData as any).item;
    expect(item).toMatchObject({ rarity: 'Rare', frameTypeId: 'Rare' });
    expect(item.explicitMods[0]).toMatchObject({
      description: expect.any(String),
      domain: 'explicit',
      hash: expect.stringMatching(/^stat\.explicit\.stat_\d+$/),
    });
    expect(item.extended.hashes.explicit).toHaveLength(item.explicitMods.length);
    expect(atob(item.extended.text)).toContain(item.explicitMods[0].description);
    expect((itemData as any).listing.hideout_token).toBeUndefined();
  });

  it('沒有連線歸屬時不產生資料，且數量有上限', () => {
    expect(buildFakeTradeResults(5, 'Standard', 'poe1', [])).toEqual([]);
    expect(
      buildFakeTradeResults(5000, 'Standard', 'poe1', buildFallbackDevOwners('poe1', 'Standard')),
    ).toHaveLength(1000);
  });
});

class RecordingHostClient implements ILiveSearchHostClient {
  renderCalls: RenderResultOptions[] = [];
  syncCalls: SyncTotalOptions[] = [];
  async syncTotal(options: SyncTotalOptions): Promise<HostCommandOutcome> {
    this.syncCalls.push(options);
    return { success: true };
  }
  ensureCalls = 0;
  ensurePayloads: unknown[] = [];
  nextEnsureSuccess = true;
  async ensureContainer(options?: unknown): Promise<HostCommandOutcome> {
    this.ensureCalls++;
    this.ensurePayloads.push(options);
    return this.nextEnsureSuccess ? { success: true } : { success: false, error: 'host failed' };
  }
  async renderResult(options: RenderResultOptions): Promise<HostCommandOutcome> {
    this.renderCalls.push(options);
    return { success: true };
  }
  async resetUnread(): Promise<HostCommandOutcome> {
    return { success: true };
  }
  dispose(): void {}
}

describe('Runtime 假結果渲染與篩選', () => {
  it('不建立 WebSocket、不呼叫 fetch，並帶入展示上限與連線歸屬', async () => {
    const hostClient = new RecordingHostClient();
    const webSocketFactory = vi.fn();
    const fetchClient = vi.fn();
    const runtime = new LiveSearchPrimaryRuntime('poe1', {
      hostClient,
      webSocketFactory,
      fetchClient,
      getMaxDisplayedResults: () => 50,
    });
    const owners = buildFallbackDevOwners('poe1', 'Standard');
    const outcome = await runtime.renderSyntheticResults(
      'Standard',
      buildFakeTradeResults(6, 'Standard', 'poe1', owners),
    );

    expect(outcome).toEqual({ rendered: 6, failed: 0 });
    expect(webSocketFactory).not.toHaveBeenCalled();
    expect(fetchClient).not.toHaveBeenCalled();
    expect(hostClient.ensureCalls).toBe(1);
    expect(hostClient.renderCalls.every((call) => call.maxResults === 50)).toBe(true);
    expect(runtime.getCumulativeRenderedTotal()).toBe(6);

    runtime.setResultFilter(owners[0].canonicalKey);
    expect(runtime.getSnapshot().resultFilterKey).toBe(owners[0].canonicalKey);
    expect(document.getElementById(RESULT_FILTER_STYLE_ID)?.textContent).toContain(
      String(
        hostClient.renderCalls[1].itemData &&
          (hostClient.renderCalls[1].itemData as { id: string }).id,
      ),
    );

    runtime.setResultFilter(null);
    expect(runtime.getSnapshot()).not.toHaveProperty('resultFilterKey');
    runtime.dispose();
  });
});

describe('偏好設定：liveSearchMaxDisplayedResults', () => {
  it('預設 100，僅接受 50/100/200/500', async () => {
    const outcome = await createPreferencesModule('poe1', createInMemoryPreferencesStorage());
    if (!outcome.ok) throw new Error(outcome.error.message);
    const prefs = outcome.value;
    expect(prefs.read().liveSearchMaxDisplayedResults).toBe(100);
    expect((await prefs.update({ liveSearchMaxDisplayedResults: 200 })).ok).toBe(true);
    expect(prefs.read().liveSearchMaxDisplayedResults).toBe(200);
    const invalid = await prefs.update({
      liveSearchMaxDisplayedResults: 123 as unknown as 100,
    });
    expect(invalid.ok).toBe(false);
    expect(prefs.read().liveSearchMaxDisplayedResults).toBe(200);
  });
});

describe('官方上方顯示筆數（實際保留數，與篩選連動）', () => {
  it('syncDisplayTotal 只寫入 PoeXD 展示容器的 total', () => {
    const container = makeContainer(['a', 'b']);
    container.total = 99;
    const store: HostVuexStore = {
      ...makeStore(),
      state: { transient: { searches: [container] } },
    };
    expect(syncDisplayTotal({ localId: 'display', total: 2 }, store)).toEqual({ success: true });
    expect(container.total).toBe(2);
    expect(syncDisplayTotal({ localId: 'other', total: 1 }, store).success).toBe(false);
    expect(syncDisplayTotal({ localId: 'display', total: -1 }, store).success).toBe(false);
    expect(container.total).toBe(2);
  });

  it('command result 接受 sync-total', () => {
    expect(
      parsePoeLiveSearchCommandResult(JSON.stringify({ command: 'sync-total', success: true })),
    ).toMatchObject({ command: 'sync-total', success: true });
  });

  it('渲染時 total 不超過上限，篩選時為該連線筆數並立即同步', async () => {
    const hostClient = new RecordingHostClient();
    const runtime = new LiveSearchPrimaryRuntime('poe1', {
      hostClient,
      webSocketFactory: vi.fn(),
      fetchClient: vi.fn(),
      getMaxDisplayedResults: () => 4,
    });
    const owners = buildFallbackDevOwners('poe1', 'Standard');
    await runtime.renderSyntheticResults(
      'Standard',
      buildFakeTradeResults(6, 'Standard', 'poe1', owners),
    );
    expect(hostClient.renderCalls.map((call) => call.total)).toEqual([1, 2, 3, 4, 4, 4]);
    expect(runtime.getCumulativeRenderedTotal()).toBe(6);

    // 保留的最後 4 筆依序屬於 owners[2], owners[0], owners[1], owners[2]
    runtime.setResultFilter(owners[2].canonicalKey);
    expect(hostClient.syncCalls.at(-1)?.total).toBe(2);

    await runtime.renderSyntheticResults(
      'Standard',
      buildFakeTradeResults(1, 'Standard', 'poe1', [owners[0]], 99_999),
    );
    // 新增一筆 owners[0]，淘汰最舊的 owners[2] → 篩選中的連線剩 1 筆
    expect(hostClient.renderCalls.at(-1)?.total).toBe(1);

    runtime.setResultFilter(null);
    expect(hostClient.syncCalls.at(-1)?.total).toBe(4);
    runtime.dispose();
  });

  it('snapshot 提供各連線命中數與總顯示筆數，clearResults 會重置容器與計數而不影響後續渲染', async () => {
    const hostClient = new RecordingHostClient();
    const onRendered = vi.fn();
    const onCleared = vi.fn();
    const runtime = new LiveSearchPrimaryRuntime('poe1', {
      hostClient,
      webSocketFactory: vi.fn(),
      fetchClient: vi.fn(),
      onResultRendered: onRendered,
      onResultsCleared: onCleared,
    });
    const owners = buildFallbackDevOwners('poe1', 'Standard');
    await runtime.renderSyntheticResults(
      'Standard',
      buildFakeTradeResults(4, 'Standard', 'poe1', owners),
    );

    const snapBefore = runtime.getSnapshot();
    expect(snapBefore.displayedResultCount).toBe(4);
    expect(snapBefore.resultCountsByOwner).toEqual({
      [owners[0].canonicalKey]: 2,
      [owners[1].canonicalKey]: 1,
      [owners[2].canonicalKey]: 1,
    });
    expect(onRendered).toHaveBeenCalledTimes(4);

    // 篩選狀態下若 Host 重置失敗，本地計數、篩選與來源標籤均保持原樣不清空
    runtime.setResultFilter(owners[0].canonicalKey);
    hostClient.nextEnsureSuccess = false;
    const failedOutcome = await runtime.clearResults();
    expect(failedOutcome.success).toBe(false);
    expect(onCleared).toHaveBeenCalledTimes(0);
    expect(runtime.getSnapshot().displayedResultCount).toBe(4);
    expect(runtime.getSnapshot().resultFilterKey).toBe(owners[0].canonicalKey);

    // Host 重置成功後清空本地狀態並一併解除結果篩選
    hostClient.nextEnsureSuccess = true;
    const outcome = await runtime.clearResults();
    expect(outcome.success).toBe(true);
    expect(onCleared).toHaveBeenCalledTimes(1);
    expect(hostClient.ensurePayloads.at(-1)).toMatchObject({
      league: 'Standard',
      resetResults: true,
    });

    const snapAfter = runtime.getSnapshot();
    expect(snapAfter.displayedResultCount).toBeUndefined();
    expect(snapAfter.resultCountsByOwner).toBeUndefined();
    expect(snapAfter.resultFilterKey).toBeUndefined();
    expect(runtime.getCumulativeRenderedTotal()).toBe(0);

    runtime.dispose();
  });

  it('clearResults 會丟棄進行中 renderResult 回傳後的過期寫入，不殘留幽靈計數或來源標籤', async () => {
    const deferredRender: { resolve: ((val: HostCommandOutcome) => void) | null } = {
      resolve: null,
    };
    const hostClient: ILiveSearchHostClient = {
      ensureContainer: vi.fn(async () => ({ success: true })),
      renderResult: vi.fn(
        () =>
          new Promise<HostCommandOutcome>((resolve) => {
            deferredRender.resolve = resolve;
          }),
      ),
      resetUnread: vi.fn(async () => ({ success: true })),
      dispose: vi.fn(),
    };
    const onRendered = vi.fn();
    let capturedHandlers: { onToken: (token: string) => void } | null = null;
    const runtime = new LiveSearchPrimaryRuntime('poe1', {
      hostClient,
      fetchClient: vi.fn(async () => ({
        ok: true,
        json: async () => ({ result: [{ id: 'stale-item-1', item: { name: 'Stale' } }] }),
      })) as unknown as (url: string, init?: RequestInit) => Promise<Response>,
      sessionFactory: (opts) => {
        capturedHandlers = opts.handlers;
        return { start: vi.fn(), stop: vi.fn(), retry: vi.fn(), dispose: vi.fn() } as any;
      },
      onResultRendered: onRendered,
    });

    await runtime.addSubscription({
      id: 'sub_clear_race',
      gameVersion: 'poe1',
      league: 'Standard',
      searchId: 'H4sIAAAAAAAA_race1',
      url: 'https://www.pathofexile.com/trade/search/Standard/H4sIAAAAAAAA_race1',
      status: 'idle',
      createdAt: Date.now(),
    });

    // 1. 送入兩筆 token：第一筆進入 in-flight renderResult，第二筆排在 queue 中
    capturedHandlers!.onToken('tok-1');
    capturedHandlers!.onToken('tok-2');
    await new Promise((r) => setTimeout(r, 10));
    expect(deferredRender.resolve).not.toBeNull();

    // 2. 在第一筆 renderResult 尚未 resolve 前按下清空結果
    await runtime.clearResults();

    // 3. 第一筆過期 renderResult 事後 resolve：不得寫入幽靈計數、不得觸發 onRendered，且第二筆排隊任務應已被清空
    deferredRender.resolve!({ success: true });
    await new Promise((r) => setTimeout(r, 10));

    expect(runtime.getCumulativeRenderedTotal()).toBe(0);
    expect(runtime.getSnapshot().displayedResultCount).toBeUndefined();
    expect(onRendered).not.toHaveBeenCalled();
    expect(hostClient.renderResult).toHaveBeenCalledTimes(1);

    runtime.dispose();
  });
});
