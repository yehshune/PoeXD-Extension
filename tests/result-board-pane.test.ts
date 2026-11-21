// @vitest-environment happy-dom
// @vitest-environment-options { "url": "https://www.pathofexile.com/trade/search/Covens" }
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';
import ResultBoardPane from '@/components/sidebar/result-board/ResultBoardPane.vue';
import { ResultBoardRuntime } from '@/entrypoints/content/logic/result-board-runtime';
import { setActiveDisplayLocalePreference } from '@/utils/i18n';
import { createResultTranslator } from '@/utils/market-result-translator';
import { receiveResultTranslationRequests } from '@/utils/market-result-translation-request';
import { getTradeResultCache, TradeResultCache } from '@/utils/trade-result-cache';
import { rawResult } from './helpers/result-board-fixtures';

const { runtimeHolder, mockFetchCurrencyRates, prefState, prefListeners, tradeContextState } =
  vi.hoisted(() => ({
    runtimeHolder: { current: undefined as ResultBoardRuntime | undefined },
    mockFetchCurrencyRates: vi.fn(async () => ({
      primary: 'chaos',
      rates: { chaos: 1, divine: 200 },
    })),
    prefState: { enablePriceComparison: true },
    prefListeners: new Set<(snapshot: { enablePriceComparison: boolean }) => void>(),
    tradeContextState: { league: 'Covens' as string | undefined },
  }));

vi.mock('@/utils/preferences', () => ({
  getPreferences: vi.fn(async () => ({
    ok: true,
    value: {
      read: () => ({ enablePriceComparison: prefState.enablePriceComparison }),
      subscribe: (listener: (snapshot: { enablePriceComparison: boolean }) => void) => {
        prefListeners.add(listener);
        listener({ enablePriceComparison: prefState.enablePriceComparison });
        return () => prefListeners.delete(listener);
      },
    },
  })),
}));

vi.mock('@/entrypoints/content/logic/result-board-runtime', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/entrypoints/content/logic/result-board-runtime')>();
  return {
    ...actual,
    getResultBoardRuntime: () => runtimeHolder.current!,
  };
});

vi.mock('@/entrypoints/content/logic/result-price-presenter', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/entrypoints/content/logic/result-price-presenter')>();
  return {
    ...actual,
    fetchCurrencyRates: mockFetchCurrencyRates,
  };
});

vi.mock('@/utils/trade-context', () => ({
  getPoeVersion: () => 'poe1',
  getTradeLeague: () => tradeContextState.league,
}));

describe('ResultBoardPane interactions, translation, instant-only filter & persistent search', () => {
  let container: HTMLElement;
  let unmount: (() => void) | undefined;
  let cache: TradeResultCache;
  let runtime: ResultBoardRuntime;
  let storageData: Record<string, unknown>;
  let previousChrome: unknown;

  const flush = async () => {
    for (let i = 0; i < 4; i += 1) {
      await nextTick();
      await new Promise((r) => setTimeout(r, 0));
    }
  };

  beforeEach(() => {
    tradeContextState.league = 'Covens';
    prefState.enablePriceComparison = true;
    prefListeners.clear();
    mockFetchCurrencyRates.mockClear();
    setActiveDisplayLocalePreference('zh-TW');
    storageData = {};
    previousChrome = (globalThis as { chrome?: unknown }).chrome;
    (globalThis as { chrome?: unknown }).chrome = {
      storage: {
        local: {
          get: vi.fn(async (keys: string[]) => {
            const out: Record<string, unknown> = {};
            for (const key of keys) {
              if (key in storageData) out[key] = storageData[key];
            }
            return out;
          }),
          set: vi.fn(async (patch: Record<string, unknown>) => {
            Object.assign(storageData, patch);
          }),
        },
      },
    };
    cache = new TradeResultCache();
    runtime = new ResultBoardRuntime(cache, document);
    runtimeHolder.current = runtime;
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    unmount?.();
    unmount = undefined;
    runtime.cleanup();
    container.remove();
    (globalThis as { chrome?: unknown }).chrome = previousChrome;
  });

  function ingest(entries: ReturnType<typeof rawResult>[], searchId = 'search-1') {
    runtime.session.setSummary({
      searchId,
      resultCount: entries.length,
      total: entries.length,
      inexact: false,
    });
    for (const entry of entries) {
      cache.ingestResult(
        { ...entry, sourceSearchId: searchId },
        { sourceSearchId: searchId, league: 'Covens' },
      );
    }
    runtime.session.observeFetch(searchId);
  }

  it('translates result item names via .item-popup__header-line and requestResultTranslation', async () => {
    const translator = createResultTranslator({
      modLines: {},
      items: { 'vaal regalia': '瓦爾法衣', 'heavy belt': '重革腰帶' },
      labels: {},
    });
    const receiver = receiveResultTranslationRequests(document);
    receiver.attach((root) => translator.translate(root));

    try {
      ingest([
        rawResult({ id: 'r1', name: 'Doom Shell', typeLine: 'Vaal Regalia', frameType: 2 }),
        rawResult({ id: 'r2', name: '', typeLine: 'Heavy Belt', frameType: 0 }),
      ]);

      const app = createApp({ render: () => h(ResultBoardPane) });
      app.mount(container);
      unmount = () => app.unmount();
      await flush();

      const names = Array.from(container.querySelectorAll('[data-board-entry-name]')).map((el) =>
        el.textContent?.trim(),
      );
      expect(names).toEqual(['Doom Shell瓦爾法衣', '重革腰帶']);
    } finally {
      receiver.dispose();
    }
  });

  it('shows instant-only checkbox only when results mix instant buyout and whisper-only listings', async () => {
    ingest([
      rawResult({ id: 'r1', instantBuyout: true }),
      rawResult({ id: 'r2', instantBuyout: true }),
    ]);

    const app = createApp({ render: () => h(ResultBoardPane) });
    app.mount(container);
    unmount = () => app.unmount();
    await flush();

    // All instant buyout -> checkbox hidden
    expect(container.querySelector('[data-board-instant-only]')).toBeNull();
    expect(container.querySelectorAll('[data-board-entry-id]')).toHaveLength(2);

    // Mixed -> checkbox appears and filters
    ingest([
      rawResult({ id: 'r1', instantBuyout: true }),
      rawResult({ id: 'r2', instantBuyout: true }),
      rawResult({ id: 'r3', instantBuyout: false }),
    ]);
    await flush();

    const checkbox = container.querySelector<HTMLElement>('[data-board-instant-only]');
    expect(checkbox).not.toBeNull();
    checkbox!.click();
    await flush();
    expect(container.querySelectorAll('[data-board-entry-id]')).toHaveLength(2);

    // Next search is all whisper-only -> checkbox hides and does NOT trap user with empty filtered list
    cache.clear();
    ingest([rawResult({ id: 'w1', instantBuyout: false, searchId: 'search-2' })], 'search-2');
    await flush();
    expect(container.querySelector('[data-board-instant-only]')).toBeNull();
    expect(container.querySelectorAll('[data-board-entry-id]')).toHaveLength(1);
  });

  it('toggles search input from a persistent button and restores state across mounts', async () => {
    ingest([
      rawResult({ id: 'r1', name: 'Alpha', typeLine: 'Ring' }),
      rawResult({ id: 'r2', name: 'Beta', typeLine: 'Belt' }),
    ]);

    const app1 = createApp({ render: () => h(ResultBoardPane) });
    app1.mount(container);
    unmount = () => app1.unmount();
    await flush();

    // Hidden by default
    expect(container.querySelector('[data-board-keyword]')).toBeNull();
    const toggle = container.querySelector<HTMLElement>('[data-board-search-toggle]')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    // Click to open -> shows search input & persists true
    toggle.click();
    await flush();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const input = container.querySelector<HTMLInputElement>('[data-board-keyword]');
    expect(input).not.toBeNull();
    expect(storageData.resultBoardSearchVisible_poe1).toBe(true);

    // Remount -> restores open search box
    app1.unmount();
    unmount = undefined;
    const app2 = createApp({ render: () => h(ResultBoardPane) });
    app2.mount(container);
    unmount = () => app2.unmount();
    await flush();

    expect(container.querySelector('[data-board-keyword]')).not.toBeNull();

    // Filter then press Esc -> clears keyword, closes box, persists false
    const input2 = container.querySelector<HTMLInputElement>('[data-board-keyword]')!;
    input2.value = 'Alpha';
    input2.dispatchEvent(new Event('input'));
    await flush();
    expect(container.querySelectorAll('[data-board-entry-id]')).toHaveLength(1);

    input2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flush();
    expect(container.querySelector('[data-board-keyword]')).toBeNull();
    expect(container.querySelectorAll('[data-board-entry-id]')).toHaveLength(2);
    expect(storageData.resultBoardSearchVisible_poe1).toBe(false);
  });

  it('remembers the items / sellers view across mounts', async () => {
    ingest([rawResult({ id: 'r1', name: 'Alpha' })]);
    const mountPane = async () => {
      unmount?.();
      const app = createApp({ render: () => h(ResultBoardPane) });
      app.mount(container);
      unmount = () => app.unmount();
      await flush();
    };
    const selected = () =>
      container
        .querySelector('[data-board-view][aria-selected="true"]')
        ?.getAttribute('data-board-view');

    await mountPane();
    expect(selected()).toBe('items');

    container.querySelector<HTMLElement>('[data-board-view="sellers"]')!.click();
    await flush();
    expect(selected()).toBe('sellers');
    expect(storageData.resultBoardView_poe1).toBe('sellers');

    await mountPane();
    expect(selected()).toBe('sellers');
    expect(container.querySelector('[data-board-no-seller-match]')).not.toBeNull();

    container.querySelector<HTMLElement>('[data-board-view="items"]')!.click();
    await flush();
    expect(storageData.resultBoardView_poe1).toBe('items');
  });

  it('ignores an unknown stored view', async () => {
    storageData.resultBoardView_poe1 = 'constructor';
    ingest([rawResult({ id: 'r1', name: 'Alpha' })]);
    const app = createApp({ render: () => h(ResultBoardPane) });
    app.mount(container);
    unmount = () => app.unmount();
    await flush();
    expect(
      container
        .querySelector('[data-board-view][aria-selected="true"]')
        ?.getAttribute('data-board-view'),
    ).toBe('items');
  });

  it('toggles expand-all and collapse-all and clears price range bounds', async () => {
    ingest([
      rawResult({ id: 'r1', amount: 10, currency: 'chaos' }),
      rawResult({ id: 'r2', amount: 50, currency: 'chaos' }),
    ]);

    const app = createApp({ render: () => h(ResultBoardPane) });
    app.mount(container);
    unmount = () => app.unmount();
    await flush();

    // Complete state shown inline when all results are retrieved
    expect(container.querySelector('[data-board-load-next]')).toBeNull();
    expect(container.querySelector('[data-board-stop-reason]')?.textContent).toContain(
      '已取得全部結果',
    );

    const expandToggleBtn = container.querySelector<HTMLButtonElement>(
      '[data-board-expand-toggle]',
    )!;
    expect(expandToggleBtn.disabled).toBe(false);
    expect(expandToggleBtn.getAttribute('aria-pressed')).toBe('false');

    // Click when all collapsed -> expands all items
    expandToggleBtn.click();
    await flush();
    expect(expandToggleBtn.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelectorAll('[data-board-entry-card-missing]')).toHaveLength(2);

    // Click when expanded -> collapses all items
    expandToggleBtn.click();
    await flush();
    expect(expandToggleBtn.getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelectorAll('[data-board-entry-card-missing]')).toHaveLength(0);

    // Expand one item -> clicking toggles back to collapse all
    container.querySelector<HTMLElement>('[data-board-entry-toggle]')!.click();
    await flush();
    expect(expandToggleBtn.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelectorAll('[data-board-entry-card-missing]')).toHaveLength(1);

    expandToggleBtn.click();
    await flush();
    expect(expandToggleBtn.getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelectorAll('[data-board-entry-card-missing]')).toHaveLength(0);

    // Enter min price -> clear button appears and resets filter
    expect(container.querySelector('[data-board-price-clear]')).toBeNull();
    const minInput = container.querySelector<HTMLInputElement>('[data-board-price-min]')!;
    minInput.value = '20';
    minInput.dispatchEvent(new Event('input'));
    await flush();
    expect(container.querySelectorAll('[data-board-entry-id]')).toHaveLength(1);

    const clearBtn = container.querySelector<HTMLButtonElement>('[data-board-price-clear]')!;
    clearBtn.click();
    await flush();
    expect(container.querySelectorAll('[data-board-entry-id]')).toHaveLength(2);
    expect(container.querySelector('[data-board-price-clear]')).toBeNull();
  });

  it('shows and copies the stash search regex for the picked results of an expanded seller', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    ingest([
      rawResult({ id: 'r1', name: 'Doom Ward', priceType: '~b/o', amount: 2, currency: 'chaos' }),
      rawResult({ id: 'r2', name: 'Grim Coat', priceType: '~b/o', amount: 3, currency: 'chaos' }),
      rawResult({ id: 'r3', name: 'Doom Ward', priceType: '~b/o', amount: 3, currency: 'chaos' }),
    ]);

    const app = createApp({ render: () => h(ResultBoardPane) });
    app.mount(container);
    unmount = () => app.unmount();
    await flush();

    container.querySelector<HTMLElement>('[data-board-view="sellers"]')!.click();
    await flush();
    expect(container.querySelector('[data-board-stash-regex]')).toBeNull();
    container.querySelector<HTMLElement>('[data-board-seller-toggle]')!.click();
    await flush();

    // 預設全選可直購：名稱與標價交叉後不會誤中其他物品
    const parts = () =>
      Array.from(container.querySelectorAll('[data-board-stash-regex-part] code'), (node) =>
        node.textContent?.trim(),
      );
    expect(parts()).toEqual(['"Doom Ward|Grim Coat" "Vaal Regalia" "~b/o 2 chaos|~b/o 3 chaos"']);
    expect(container.querySelector('[data-board-stash-regex-warning]')).toBeNull();

    // 取消勾選 r3：Doom Ward + 3 chaos 的組合會誤中，明確警告
    const picks = container.querySelectorAll<HTMLElement>('[data-board-pick]');
    picks[picks.length - 1].click();
    await flush();
    expect(container.querySelector('[data-board-stash-regex-warning]')?.textContent).toContain(
      '另有 1 件已載入的物品也會被標出',
    );

    container.querySelector<HTMLElement>('[data-board-stash-regex-copy]')!.click();
    await flush();
    expect(writeText).toHaveBeenCalledWith(
      '"Doom Ward|Grim Coat" "Vaal Regalia" "~b/o 2 chaos|~b/o 3 chaos"',
    );
  });

  it('follows enablePriceComparison for rate fetching, price inputs, summary, sorting and filtering', async () => {
    ingest([
      rawResult({ id: 'r1', amount: 1, currency: 'divine' }),
      rawResult({ id: 'r2', amount: 50, currency: 'chaos' }),
    ]);

    const app = createApp({ render: () => h(ResultBoardPane) });
    app.mount(container);
    unmount = () => app.unmount();
    await flush();

    expect(mockFetchCurrencyRates).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-board-price-min]')).not.toBeNull();
    expect(container.querySelector('[data-board-price-max]')).not.toBeNull();
    expect(container.querySelector('[data-board-price-summary]')).not.toBeNull();
    expect(container.querySelector('[data-board-no-conversion]')).toBeNull();

    // Filter with min price 100c -> only 1 divine (200c) remains
    const minInput = container.querySelector<HTMLInputElement>('[data-board-price-min]')!;
    minInput.value = '100';
    minInput.dispatchEvent(new Event('input'));
    await flush();
    expect(container.querySelectorAll('[data-board-entry-id]')).toHaveLength(1);

    // Disable enablePriceComparison -> inputs, summary & filtering disable, no realm-unavailable notice
    prefState.enablePriceComparison = false;
    prefListeners.forEach((fn) => fn({ enablePriceComparison: false }));
    await flush();

    expect(container.querySelector('[data-board-price-min]')).toBeNull();
    expect(container.querySelector('[data-board-price-max]')).toBeNull();
    expect(container.querySelector('[data-board-price-summary]')).toBeNull();
    expect(container.querySelector('[data-board-no-conversion]')).toBeNull();
    expect(container.querySelectorAll('[data-board-entry-id]')).toHaveLength(2);

    // Sort menu omits price options when disabled
    container.querySelector<HTMLElement>('[data-board-sort]')!.click();
    await flush();
    expect(document.querySelector('[data-board-sort-mode="price-asc"]')).toBeNull();
    expect(document.querySelector('[data-board-sort-mode="price-desc"]')).toBeNull();

    // Re-enable -> price inputs, summary & price sort options return
    prefState.enablePriceComparison = true;
    prefListeners.forEach((fn) => fn({ enablePriceComparison: true }));
    await flush();

    expect(container.querySelector('[data-board-price-min]')).not.toBeNull();
    expect(container.querySelector('[data-board-price-max]')).not.toBeNull();
    expect(container.querySelector('[data-board-price-summary]')).not.toBeNull();
    expect(container.querySelectorAll('[data-board-entry-id]')).toHaveLength(1);
  });

  it('does not fetch currency rates on mount when enablePriceComparison starts disabled', async () => {
    prefState.enablePriceComparison = false;
    ingest([rawResult({ id: 'r1', amount: 10, currency: 'chaos' })]);

    const app = createApp({ render: () => h(ResultBoardPane) });
    app.mount(container);
    unmount = () => app.unmount();
    await flush();

    expect(mockFetchCurrencyRates).not.toHaveBeenCalled();
    expect(container.querySelector('[data-board-price-min]')).toBeNull();
    expect(container.querySelector('[data-board-no-conversion]')).toBeNull();
  });

  it('resolves league and loads card details and currency rates after searching from a new page without league in URL', async () => {
    const sharedCache = getTradeResultCache();
    sharedCache.clear();
    runtime.cleanup();
    runtime = new ResultBoardRuntime(sharedCache, document);
    runtimeHolder.current = runtime;

    // 模擬剛開啟新頁面 `/trade`（網址尚無聯盟），此時看板就已掛載
    tradeContextState.league = undefined;
    const app = createApp({ render: () => h(ResultBoardPane) });
    app.mount(container);
    unmount = () => {
      app.unmount();
      sharedCache.clear();
    };
    await flush();

    expect(mockFetchCurrencyRates).not.toHaveBeenCalled();

    // 執行搜尋後，SPA 路由切換至帶聯盟的搜尋網址並收到結果
    tradeContextState.league = 'Covens';
    runtime.session.setSummary({
      searchId: 'search-new',
      resultCount: 2,
      total: 2,
      inexact: false,
    });
    sharedCache.ingestResult(
      { ...rawResult({ id: 'r1', amount: 1, currency: 'divine' }), sourceSearchId: 'search-new' },
      { sourceSearchId: 'search-new', league: 'Covens' },
    );
    sharedCache.ingestResult(
      { ...rawResult({ id: 'r2', amount: 50, currency: 'chaos' }), sourceSearchId: 'search-new' },
      { sourceSearchId: 'search-new', league: 'Covens' },
    );
    runtime.session.observeFetch('search-new');
    await flush();

    expect(mockFetchCurrencyRates).toHaveBeenCalledWith('poe1', 'Covens');
    expect(container.querySelector('[data-board-no-conversion]')).toBeNull();
    expect(container.querySelector('[data-board-price-min]')).not.toBeNull();
    expect(container.querySelector('[data-board-price-summary]')).not.toBeNull();

    // 展開第一筆結果應正常顯示物品卡片而非「無法顯示這筆結果的卡片」
    container.querySelector<HTMLElement>('[data-board-entry-toggle]')!.click();
    await flush();
    expect(container.querySelector('[data-board-entry-card]')).not.toBeNull();
    expect(container.querySelector('[data-board-entry-card-missing]')).toBeNull();

    // 同一頁切換聯盟再搜尋時，應依新聯盟重新載入匯率
    tradeContextState.league = 'Standard';
    runtime.session.setSummary({
      searchId: 'search-std',
      resultCount: 1,
      total: 1,
      inexact: false,
    });
    sharedCache.ingestResult(
      { ...rawResult({ id: 'r3', amount: 10, currency: 'chaos' }), sourceSearchId: 'search-std' },
      { sourceSearchId: 'search-std', league: 'Standard' },
    );
    runtime.session.observeFetch('search-std');
    await flush();

    expect(mockFetchCurrencyRates).toHaveBeenCalledWith('poe1', 'Standard');
  });

  it('groups seller items by stash tab, computes per-stash regex, and displays stash coordinates', async () => {
    ingest([
      rawResult({
        id: 'r1',
        name: 'Doom Ward',
        priceType: '~b/o',
        amount: 2,
        currency: 'chaos',
        stash: { name: '24', x: 1, y: 9 },
      }),
      rawResult({
        id: 'r2',
        name: 'Grim Coat',
        priceType: '~b/o',
        amount: 3,
        currency: 'chaos',
        stash: { name: '24', x: 2, y: 9 },
      }),
      rawResult({
        id: 'r3',
        name: 'Doom Ward',
        priceType: '~b/o',
        amount: 3,
        currency: 'chaos',
        stash: { name: '24', x: 4, y: 1 },
      }),
      rawResult({
        id: 'r4',
        name: 'Solar Edge',
        priceType: '~b/o',
        amount: 5,
        currency: 'chaos',
        stash: { name: 'Uniques', x: 0, y: 2 },
      }),
    ]);

    const app = createApp({ render: () => h(ResultBoardPane) });
    app.mount(container);
    unmount = () => app.unmount();
    await flush();

    container.querySelector<HTMLElement>('[data-board-view="sellers"]')!.click();
    await flush();
    container.querySelector<HTMLElement>('[data-board-seller-toggle]')!.click();
    await flush();

    const groups = Array.from(container.querySelectorAll('[data-board-stash-group]'));
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.getAttribute('data-board-stash-name'))).toEqual(['24', 'Uniques']);

    // 各分區各自產生 regex，不把別的倉庫頁混進去
    expect(groups[0].querySelector('[data-board-stash-regex-part] code')?.textContent?.trim()).toBe(
      '"Doom Ward|Grim Coat" "Vaal Regalia" "~b/o 2 chaos|~b/o 3 chaos"',
    );
    expect(groups[1].querySelector('[data-board-stash-regex-part] code')?.textContent?.trim()).toBe(
      '"Solar Edge" "Vaal Regalia" "~b/o 5 chaos"',
    );

    // 物品列顯示 1-based 倉庫格位座標
    const metas = Array.from(groups[0].querySelectorAll('[data-board-entry-meta]')).map((el) =>
      el.textContent?.trim(),
    );
    expect(metas[0]).toContain('格位 (2, 10)');
  });

  it('does not show visited on seller header when items are only marked sold', async () => {
    ingest([
      rawResult({ id: 'r1', account: 'Seller#1' }),
      rawResult({ id: 'r2', account: 'Seller#1' }),
    ]);

    const app = createApp({ render: () => h(ResultBoardPane) });
    app.mount(container);
    unmount = () => app.unmount();
    await flush();

    container.querySelector<HTMLElement>('[data-board-view="sellers"]')!.click();
    await flush();

    // 其中一件下架／已售出：賣家不應顯示「已前往」
    runtime.session.markSold('r1');
    await flush();
    const sellerRow = container.querySelector('[data-board-seller="Seller#1"]')!;
    expect(sellerRow.hasAttribute('data-board-seller-visited')).toBe(false);
    expect(sellerRow.querySelector('[data-board-seller-mark]')).toBeNull();

    // 全部已售出時改顯示「已售出」，仍非「已前往」
    runtime.session.markSold('r2');
    await flush();
    expect(sellerRow.hasAttribute('data-board-seller-visited')).toBe(false);
    expect(sellerRow.querySelector('[data-board-seller-mark]')?.textContent).toBe('已售出');
  });

  it('excludes sold items from picked total and regex, supports per-stash toggle and seller travel', async () => {
    const travelSpy = vi.spyOn(runtime, 'travel').mockResolvedValue('travelled');
    ingest([
      rawResult({
        id: 'a1',
        account: 'SellerA#1',
        name: 'Alpha',
        priceType: '~b/o',
        amount: 10,
        currency: 'chaos',
        stash: { name: 'Tab1' },
      }),
      rawResult({
        id: 'a2',
        account: 'SellerA#1',
        name: 'Beta',
        priceType: '~b/o',
        amount: 20,
        currency: 'chaos',
        stash: { name: 'Tab1' },
      }),
      rawResult({
        id: 'a3',
        account: 'SellerA#1',
        name: 'Gamma',
        priceType: '~b/o',
        amount: 30,
        currency: 'chaos',
        stash: { name: 'Tab2' },
      }),
      rawResult({
        id: 'b1',
        account: 'SellerB#2',
        character: '',
        name: 'Delta',
        priceType: '~b/o',
        amount: 5,
        currency: 'chaos',
        stash: { name: 'S1' },
      }),
      rawResult({
        id: 'b2',
        account: 'SellerB#2',
        character: '',
        name: 'Epsilon',
        priceType: '~b/o',
        amount: 5,
        currency: 'chaos',
        stash: { name: 'S1' },
      }),
    ]);

    const app = createApp({ render: () => h(ResultBoardPane) });
    app.mount(container);
    unmount = () => app.unmount();
    await flush();

    container.querySelector<HTMLElement>('[data-board-view="sellers"]')!.click();
    await flush();

    // 標記 a1 已售出：SellerA 剩餘 2 件可直購，總價扣掉 10c 剩 50c
    runtime.session.markSold('a1');
    await flush();

    const sellerA = container.querySelector('[data-board-seller="SellerA#1"]')!;
    expect(sellerA.querySelector('[data-board-seller-count]')?.textContent).toContain('2');
    expect(sellerA.querySelector('[data-board-seller-total]')?.textContent).toContain('50');

    // 當角色名與帳號相同（或無獨立角色名）時，副標不重複顯示帳號
    const sellerWithAccountOnly = container.querySelector('[data-board-seller="SellerB#2"]')!;
    const headerLines = Array.from(
      sellerWithAccountOnly.querySelectorAll('[data-board-seller-toggle] > span'),
    ).map((el) => el.textContent?.trim());
    expect(headerLines).toEqual(['SellerB#2', '5 chaos']);

    // 展開 SellerA：a1 不在 Tab1 的 regex 裡，且勾選框禁用
    sellerA.querySelector<HTMLElement>('[data-board-seller-toggle]')!.click();
    await flush();
    const tab1 = sellerA.querySelector('[data-board-stash-name="Tab1"]')!;
    expect(tab1.querySelector('[data-board-stash-regex-part] code')?.textContent?.trim()).toBe(
      '"Beta" "Vaal Regalia" "~b/o 20 chaos"',
    );
    expect(
      tab1.querySelector<HTMLButtonElement>('[data-board-entry-id="a1"] [data-board-pick]')
        ?.disabled,
    ).toBe(true);

    // 點擊 Tab1 倉庫勾選框：一次取消勾選 Tab1（剩 Tab2 的 30c）
    tab1.querySelector<HTMLElement>('[data-board-stash-pick]')!.click();
    await flush();
    expect(sellerA.querySelector('[data-board-seller-picked]')?.textContent).toContain('1');
    expect(sellerA.querySelector('[data-board-seller-picked]')?.textContent).toContain('30');

    // 點擊賣家標頭的一鍵前往藏身處：挑已勾選且未售出的 a3
    sellerA.querySelector<HTMLElement>('[data-board-seller-travel]')!.click();
    await flush();
    expect(travelSpy).toHaveBeenCalledWith('a3', expect.any(Function));

    // SellerB 全部已售出時沉到清單底部並禁用一鍵前往
    runtime.session.markSold('b1');
    runtime.session.markSold('b2');
    await flush();
    const order = Array.from(container.querySelectorAll('[data-board-seller]')).map((el) =>
      el.getAttribute('data-board-seller'),
    );
    expect(order).toEqual(['SellerA#1', 'SellerB#2']);
    expect(
      container.querySelector<HTMLButtonElement>(
        '[data-board-seller="SellerB#2"] [data-board-seller-travel]',
      )?.disabled,
    ).toBe(true);
  });
});
