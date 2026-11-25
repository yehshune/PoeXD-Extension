// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createResultEnhancementHost,
  type ResultEnhancementHost,
} from '@/entrypoints/content/logic/result-enhancement-pipeline';
import type {
  ResultEnhancementHostPort,
  ResultEnhancementPageContext,
  ResultEnhancementToastTone,
} from '@/entrypoints/content/logic/result-enhancement-host-port';
import {
  RESULT_EXTERNAL_LINKS_CLASS,
  RESULT_LEFT_ACTIONS_CLASS,
  RESULT_MOD_QUICK_FILTER_ACTIONS_CLASS,
  RESULT_MOD_QUICK_FILTER_BUTTON_CLASS,
  RESULT_MOD_QUICK_FILTER_HOST_CLASS,
  RESULT_PIN_BUTTON_CLASS,
  RESULT_PINNED_ROW_CLASS,
  RESULT_POB_COPY_BUTTON_CLASS,
} from '@/entrypoints/content/logic/result-enhancement-styles';
import { resetI18nStateForTests, setActiveDisplayLocale } from '@/utils/i18n';
import { RESULT_MOD_ENGLISH_SUBTITLE_CLASS } from '@/utils/market-result-translator';
import type { PinnedItemClient } from '@/utils/pinned-item-client';
import type { PinnedItemOutcome, PinnedItemSnapshot } from '@/utils/pinned-items';
import { createPobTextLexicon } from '@/utils/pob-text-lexicon';
import { DEFAULT_PREFERENCES, type Preferences } from '@/utils/preferences-contract';
import type { CurrencyRateSnapshot } from '@/utils/price-comparison';
import type { PoeVersion } from '@/utils/trade-context';
import { TradeResultCache } from '@/utils/trade-result-cache';

const RARE_ITEM = {
  name: 'Golem Veil',
  baseType: 'Crimson Raiment',
  rarity: 'Rare',
  ilvl: 48,
  explicitMods: [
    { description: '+74 to maximum Life', domain: 'explicit', hash: 'stat.explicit.stat_1' },
  ],
};

const TW_ITEM = {
  name: '蛇牙 慧齒',
  baseType: '靈石法杖',
  rarity: 'Rare',
  explicitMods: [
    { description: '+37 最大魔力', domain: 'explicit', hash: 'stat.explicit.stat_1050105434' },
  ],
};

const POE2_WEAPON = (id: string, dps: number, sockets: unknown[] = []) => ({
  id,
  listing: { price: { amount: 2, currency: 'divine' } },
  item: {
    id,
    realm: 'poe2',
    rarity: 'Rare',
    name: `Weapon ${id}`,
    typeLine: 'Sinister Quarterstaff',
    baseType: 'Sinister Quarterstaff',
    ilvl: 75,
    properties: [
      { name: 'Physical Damage', values: [['100-200', 0]] },
      { name: 'Attacks per Second', values: [['1.50', 0]] },
    ],
    sockets,
    extended: { category: 'warstaff', dps, pdps: dps, edps: 0 },
  },
});

const POE2_HYBRID_ARMOUR = {
  id: 'hybrid-armour-1',
  listing: { price: { amount: 50, currency: 'exalted' } },
  item: {
    id: 'item-hybrid',
    realm: 'poe2',
    name: 'Beast Curtain',
    typeLine: 'Briar Cuirass',
    baseType: 'Briar Cuirass',
    ilvl: 75,
    properties: [
      { name: 'Armour', values: [['492', 1]], type: 16 },
      { name: 'Evasion Rating', values: [['448', 1]], type: 17 },
    ],
    explicitMods: [
      {
        description: '31% increased Armour and Evasion',
        hash: 'stat.explicit.stat_2451402625',
      },
    ],
    sockets: [],
    extended: { category: 'body-armour', ar: 492, ev: 448 },
  },
};

function makeFetchDetail(
  searchId: string,
  results: unknown[],
  apiPrefix: 'trade' | 'trade2' = 'trade',
): string {
  return JSON.stringify({
    url: `https://www.pathofexile.com/api/${apiPrefix}/fetch/batch?query=${searchId}`,
    data: { result: results },
  });
}

function makePrefs(overrides: Partial<Preferences> = {}): Readonly<Preferences> {
  return { ...DEFAULT_PREFERENCES, ...overrides };
}

function createFakeHostHarness(
  options: {
    version?: PoeVersion;
    pageContext?: Partial<ResultEnhancementPageContext>;
    rates?: CurrencyRateSnapshot | undefined;
    pinOutcome?: PinnedItemOutcome;
    isSearchFormUrl?: (url: string) => boolean;
  } = {},
) {
  const version = options.version ?? 'poe1';
  const cache = new TradeResultCache();
  let pageContext: ResultEnhancementPageContext = {
    origin: 'https://www.pathofexile.com',
    href:
      version === 'poe2'
        ? 'https://www.pathofexile.com/trade2/search/poe2/Standard/q1'
        : 'https://www.pathofexile.com/trade/search/Standard/q1',
    league: 'Standard',
    pageLocale: 'en',
    isPriceConversionSupported: true,
    ...options.pageContext,
  };

  let pinListener: ((items: PinnedItemSnapshot[]) => void) | undefined;
  const pinnedItems = {
    list: vi.fn(async () => [] as PinnedItemSnapshot[]),
    subscribe: vi.fn((cb: (items: PinnedItemSnapshot[]) => void) => {
      pinListener = cb;
      return () => {
        pinListener = undefined;
      };
    }),
    pin: vi.fn(
      async (_snapshot: PinnedItemSnapshot): Promise<PinnedItemOutcome> =>
        options.pinOutcome ?? { ok: true },
    ),
    unpin: vi.fn(async (): Promise<PinnedItemOutcome> => ({ ok: true })),
    clear: vi.fn(async (): Promise<PinnedItemOutcome> => ({ ok: true })),
    reorder: vi.fn(async (): Promise<PinnedItemOutcome> => ({ ok: true })),
    markSold: vi.fn(async (): Promise<PinnedItemOutcome> => ({ ok: true })),
    clearSold: vi.fn(async (): Promise<PinnedItemOutcome> => ({ ok: true })),
  } satisfies PinnedItemClient;

  const overlayChannel = {
    read: vi.fn().mockResolvedValue({
      snapshot: { stats: [{ type: 'and', filters: [] }] },
      knownStatIds: new Set(['explicit.stat_3299347043', 'skill.parry']),
    }),
    commit: vi.fn().mockResolvedValue(undefined),
    resolveStatText: vi.fn((id: string) =>
      id === 'explicit.stat_3299347043' ? '+# to maximum Life' : undefined,
    ),
    isSearchFormUrl: vi.fn(options.isSearchFormUrl ?? (() => true)),
  };

  const twLexicon = createPobTextLexicon({
    modLines: {},
    englishItems: ['Opal Wand', "Kalandra's Touch"],
    localizedItems: ['靈石法杖', '卡蘭德之觸'],
  });

  const toasts: Array<{ message: string; tone: ResultEnhancementToastTone }> = [];
  const loadRates = vi.fn(async (_league: string): Promise<CurrencyRateSnapshot | undefined> =>
    'rates' in options ? options.rates : { primary: 'chaos', rates: { chaos: 1, divine: 200 } },
  );
  const loadLexicon = vi.fn(async (_v: PoeVersion, _locale: string) => twLexicon);
  const writeClipboard = vi.fn(async (_text: string) => undefined);
  const openUrl = vi.fn((_url: string) => undefined);
  const notify = vi.fn((message: string, tone: ResultEnhancementToastTone) => {
    toasts.push({ message, tone });
  });

  const port: ResultEnhancementHostPort = {
    doc: document,
    loadRates,
    pinnedItems,
    overlayChannel,
    loadLexicon,
    writeClipboard,
    openUrl,
    notify,
    getPageContext: () => pageContext,
    now: () => 42,
  };

  const host = createResultEnhancementHost(version, cache, port);

  return {
    host,
    cache,
    port,
    toasts,
    loadRates,
    loadLexicon,
    writeClipboard,
    openUrl,
    notify,
    pinnedItems,
    overlayChannel,
    setPageContext: (patch: Partial<ResultEnhancementPageContext>) => {
      pageContext = { ...pageContext, ...patch };
    },
    emitPinned: (items: PinnedItemSnapshot[]) => pinListener?.(items),
  };
}

function mountTradeDom(rowsHtml: string, { withRowTotal = true, compact = false } = {}) {
  document.body.innerHTML = `
    <div id="trade">
      <div class="results${compact ? ' compact' : ''}">
        ${withRowTotal ? '<div class="row row-total"></div>' : ''}
        <div class="resultset">${rowsHtml}</div>
      </div>
    </div>
  `;
  return {
    results: document.querySelector('.results') as HTMLElement,
    rowTotal: document.querySelector('.row.row-total') as HTMLElement | null,
    resultSet: document.querySelector('.resultset') as HTMLElement,
  };
}

function makeRowHtml(
  id: string,
  opts: {
    priceCurrencyIcon?: boolean;
    withAdditional?: string;
    modsHtml?: string;
  } = {},
): string {
  const priceHtml = opts.priceCurrencyIcon
    ? `<span data-field="price">1x</span><span class="currency-text currency-image"><img src="https://web.poecdn.com/gen/image/alch.png" alt="alch" title="alch"><span>Alch</span></span>`
    : `<span data-field="price">200x chaos</span>`;
  return `
    <div class="row" data-id="${id}">
      <div class="left"><div class="newItemContainer"></div></div>
      <div class="middle">
        <div class="item-popup">
          <div class="property"><span class="s" data-field="ilvl">Item Level: 82</span></div>
          ${opts.modsHtml ?? '<div class="explicitMod"><span class="s" data-field="stat.explicit.stat_3299347043">+65 to maximum Life</span></div>'}
        </div>
        ${opts.withAdditional !== undefined ? `<div class="itemPopupAdditional">${opts.withAdditional}</div>` : ''}
      </div>
      <div class="right"><div class="price">${priceHtml}</div></div>
    </div>
  `;
}

function getVisibleSortValues(toolbar: Element | null): string[] {
  if (!toolbar) return [];
  return Array.from(
    toolbar.querySelectorAll<HTMLElement>('.poexd-sort-popover .poexd-popover-item'),
  )
    .filter((item) => item.style.display !== 'none')
    .map((item) => item.getAttribute('data-value') || '')
    .filter(Boolean);
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('ResultEnhancementHost', () => {
  let activeHost: ResultEnhancementHost | undefined;

  beforeEach(() => {
    resetI18nStateForTests('zh-TW');
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    activeHost = undefined;
  });

  afterEach(() => {
    activeHost?.cleanup();
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('單次解析 /fetch 並寫入 TradeResultCache，在匯率載入完成前即完成 PoB / PoEDB / 釘選掛載', async () => {
    let resolveRates!: (snapshot: CurrencyRateSnapshot) => void;
    const harness = createFakeHostHarness();
    harness.loadRates.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRates = resolve;
        }),
    );
    activeHost = harness.host;
    mountTradeDom(makeRowHtml('r1'));
    await harness.host.applyPreferences(makePrefs());

    const fetchPromise = harness.host.handleFetchResponse(
      makeFetchDetail('q1', [
        {
          id: 'r1',
          item: RARE_ITEM,
          listing: { hideout_token: 'secret-token', price: { amount: 200, currency: 'chaos' } },
        },
      ]),
      'Standard',
    );

    // 匯率尚未回傳前，TradeResultCache 已有資料且不需等待匯率即可使用
    expect(harness.cache.get('r1')?.sourceSearchId).toBe('q1');
    expect(harness.cache.get('r1')?.league).toBe('Standard');
    expect(harness.loadRates).toHaveBeenCalledTimes(1);

    resolveRates({ primary: 'chaos', rates: { chaos: 1, divine: 200 } });
    await fetchPromise;

    expect(
      document.querySelector(`[data-id="r1"] .${RESULT_POB_COPY_BUTTON_CLASS}`),
    ).not.toBeNull();
    expect(document.querySelector(`[data-id="r1"] .${RESULT_EXTERNAL_LINKS_CLASS}`)).not.toBeNull();
    expect(document.querySelector(`[data-id="r1"] .${RESULT_PIN_BUTTON_CLASS}`)).not.toBeNull();
    expect(document.querySelector('[data-id="r1"] .poexd-price-comparison')?.textContent).toContain(
      '≈ 1',
    );

    const priceStyle = document.getElementById('poexd-price-comparison-style');
    expect(priceStyle?.textContent).toContain('background-color: oklch(0.2393 0 0)');
    expect(priceStyle?.textContent).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it('支援價格換算開關、非國際服停用、語系即時切換與 PoE 1 價格排序', async () => {
    const harness = createFakeHostHarness({
      rates: { primary: 'chaos', rates: { chaos: 1, divine: 150 } },
    });
    activeHost = harness.host;
    const { rowTotal, resultSet } = mountTradeDom(
      makeRowHtml('exp') + makeRowHtml('unpriced') + makeRowHtml('cheap'),
    );
    await harness.host.applyPreferences(makePrefs({ enablePriceComparison: true }));

    await harness.host.handleFetchResponse(
      makeFetchDetail('ctrl-poe1', [
        { id: 'exp', listing: { price: { amount: 2, currency: 'divine' } }, item: RARE_ITEM },
        { id: 'unpriced', listing: {}, item: RARE_ITEM },
        { id: 'cheap', listing: { price: { amount: 150, currency: 'chaos' } }, item: RARE_ITEM },
      ]),
      'Standard',
    );

    const toolbar = rowTotal!.querySelector('.poexd-total-controls');
    expect(toolbar).not.toBeNull();
    expect(getVisibleSortValues(toolbar)).toEqual(['default', 'price_asc', 'price_desc']);

    // 透過工具列下拉選單選擇 price_asc / price_desc / default
    toolbar!.querySelector<HTMLElement>('.poexd-sort-btn')!.click();
    expect(toolbar!.querySelector('.poexd-sort-popover')?.classList.contains('poexd-open')).toBe(
      true,
    );
    toolbar!.querySelector<HTMLElement>('.poexd-sort-popover [data-value="price_asc"]')!.click();
    expect(Array.from(resultSet.children).map((el) => el.getAttribute('data-id'))).toEqual([
      'cheap',
      'exp',
      'unpriced',
    ]);

    toolbar!.querySelector<HTMLElement>('.poexd-sort-popover [data-value="price_desc"]')!.click();
    expect(Array.from(resultSet.children).map((el) => el.getAttribute('data-id'))).toEqual([
      'exp',
      'cheap',
      'unpriced',
    ]);

    toolbar!.querySelector<HTMLElement>('.poexd-sort-popover [data-value="default"]')!.click();
    expect(Array.from(resultSet.children).map((el) => el.getAttribute('data-id'))).toEqual([
      'exp',
      'unpriced',
      'cheap',
    ]);

    // 語系切換更新價格換算提示與貨幣名稱
    setActiveDisplayLocale('en');
    await harness.host.applyPreferences(makePrefs({ enablePriceComparison: true }));
    const imgEn = document.querySelector<HTMLImageElement>(
      '[data-id="cheap"] .poexd-price-comparison img',
    );
    expect(imgEn?.alt).toBe('Divine Orb');

    // 停用價格換算後移除換算與工具列，再重新開啟時從 TradeResultCache 重算
    await harness.host.applyPreferences(makePrefs({ enablePriceComparison: false }));
    expect(document.querySelector('.poexd-price-comparison')).toBeNull();
    expect(rowTotal!.querySelector('.poexd-total-controls')).toBeNull();

    await harness.host.applyPreferences(makePrefs({ enablePriceComparison: true }));
    expect(document.querySelectorAll('.poexd-price-comparison').length).toBeGreaterThan(0);

    // 非國際服不取匯率也不顯示換算與排序工具列
    harness.host.cleanup();
    const twHarness = createFakeHostHarness({
      pageContext: {
        origin: 'https://pathofexile.tw',
        href: 'https://pathofexile.tw/trade/search/Standard/tw1',
        isPriceConversionSupported: false,
      },
    });
    activeHost = twHarness.host;
    const twDom = mountTradeDom(makeRowHtml('tw-1'));
    await twHarness.host.applyPreferences(makePrefs({ enablePriceComparison: true }));
    await twHarness.host.handleFetchResponse(
      makeFetchDetail('tw1', [
        { id: 'tw-1', listing: { price: { amount: 5, currency: 'chaos' } }, item: RARE_ITEM },
      ]),
      '亡焰咒海',
    );
    expect(twHarness.loadRates).not.toHaveBeenCalled();
    expect(twDom.rowTotal!.querySelector('.poexd-total-controls')).toBeNull();
  });

  it('PoE 2 符文標準化渲染行內覆寫與打孔標籤、切換符文即時重算，並支援屬性與性價比排序', async () => {
    const harness = createFakeHostHarness({
      version: 'poe2',
      rates: { primary: 'exalted', rates: { exalted: 1, divine: 15 } },
    });
    activeHost = harness.host;
    const { rowTotal, resultSet } = mountTradeDom(
      makeRowHtml('low-dps', {
        withAdditional:
          '<span data-field="dps" class="s lc">DPS<span class="colourAugmented">400</span></span>',
      }) +
        makeRowHtml('high-dps', {
          withAdditional:
            '<span data-field="dps" class="s lc">DPS<span class="colourAugmented">900</span></span>',
        }) +
        makeRowHtml('hybrid-armour-1', {
          withAdditional: [
            '<span data-field="ar" class="s lc s aug">護甲<span class="colourAugmented">492</span></span>',
            '<span data-field="ev" class="s lc s aug">閃避<span class="colourAugmented">448</span></span>',
            '<span data-field="es" class="s lc s invisible">能量護盾<span class="colourDefault"></span></span>',
          ].join(''),
        }),
    );

    await harness.host.applyPreferences(
      makePrefs({ enableItemNormalizer: true, enablePriceComparison: true }),
    );
    await harness.host.handleFetchResponse(
      makeFetchDetail(
        'q-poe2',
        [POE2_WEAPON('low-dps', 400), POE2_WEAPON('high-dps', 900), POE2_HYBRID_ARMOUR],
        'trade2',
      ),
      'Standard',
    );

    // 驗證行內覆寫、隱藏欄位略過、圖片下方打孔潛力標籤與樣式注入
    const hybridRow = document.querySelector('[data-id="hybrid-armour-1"]')!;
    expect(hybridRow.querySelector('[data-field="ar"] .poexd-inline-override')?.textContent).toBe(
      '➔642',
    );
    expect(hybridRow.querySelector('[data-field="ev"] .poexd-inline-override')?.textContent).toBe(
      '➔585',
    );
    expect(hybridRow.querySelector('[data-field="es"] .poexd-inline-override')).toBeNull();
    expect(
      hybridRow.querySelector('.left > .poexd-left-badges [data-field="poexd-sockets"]'),
    ).not.toBeNull();
    const normStyle = document.getElementById('poexd-normalized-stats-style-v2');
    expect(normStyle?.textContent).toContain('.poexd-inline-override::before');
    expect(normStyle?.textContent).toContain('content: none !important');

    // 透過工具列切換防具符文為 18% -> 從 TradeResultCache 重算並原地更新
    const toolbar = rowTotal!.querySelector('.poexd-total-controls')!;
    expect(toolbar.querySelector('.poexd-weapon-btn')).not.toBeNull();
    expect(toolbar.querySelector('.poexd-armour-btn')).not.toBeNull();
    toolbar.querySelector<HTMLElement>('.poexd-armour-popover [data-value="def_18"]')!.click();
    expect(hybridRow.querySelector('[data-field="ar"] .poexd-inline-override')?.textContent).toBe(
      '➔627',
    );
    expect(hybridRow.querySelectorAll('[data-field="ar"] .poexd-inline-override')).toHaveLength(1);

    // 依 potential_dps 排序
    toolbar.querySelector<HTMLElement>('.poexd-sort-popover [data-value="potential_dps"]')!.click();
    expect(Array.from(resultSet.children).map((el) => el.getAttribute('data-id'))[0]).toBe(
      'high-dps',
    );

    // 關閉 enableItemNormalizer -> 還原順序、移除前導符文按鈕與覆寫標籤，保留價格排序
    await harness.host.applyPreferences(
      makePrefs({ enableItemNormalizer: false, enablePriceComparison: true }),
    );
    expect(Array.from(resultSet.children).map((el) => el.getAttribute('data-id'))).toEqual([
      'low-dps',
      'high-dps',
      'hybrid-armour-1',
    ]);
    expect(rowTotal!.querySelector('.poexd-weapon-btn')).toBeNull();
    expect(document.querySelectorAll('.poexd-inline-override')).toHaveLength(0);
    expect(document.querySelectorAll('.poexd-left-badges')).toHaveLength(0);
    expect(getVisibleSortValues(rowTotal!.querySelector('.poexd-total-controls'))).toEqual([
      'default',
      'price_asc',
      'price_desc',
    ]);
  });

  it('增量重排採 LIS 最小移動、保留 Vue 註解錨點，且支援官方欄位點擊與同 searchId 重搜重置順序', async () => {
    const harness = createFakeHostHarness({
      rates: { primary: 'chaos', rates: { chaos: 1 } },
    });
    activeHost = harness.host;
    const { rowTotal, resultSet } = mountTradeDom(
      makeRowHtml('a') + makeRowHtml('b') + makeRowHtml('c'),
    );
    const anchor = document.createComment('v-for-anchor');
    resultSet.appendChild(anchor);

    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      frames.push(cb);
      return frames.length;
    });

    await harness.host.applyPreferences(makePrefs({ enablePriceComparison: true }));
    harness.host.init();
    frames.splice(0).forEach((cb) => cb(0));

    await harness.host.handleFetchResponse(
      makeFetchDetail('q-lis', [
        { id: 'a', listing: { price: { amount: 100, currency: 'chaos' } }, item: RARE_ITEM },
        { id: 'b', listing: { price: { amount: 200, currency: 'chaos' } }, item: RARE_ITEM },
        { id: 'c', listing: { price: { amount: 300, currency: 'chaos' } }, item: RARE_ITEM },
      ]),
      'Standard',
    );
    rowTotal!.querySelector<HTMLElement>('.poexd-sort-popover [data-value="price_asc"]')!.click();

    // 新增更便宜的列 d -> LIS 只移動 1 個節點並保留 anchor 在最後
    const rowD = document.createElement('div');
    rowD.className = 'row';
    rowD.setAttribute('data-id', 'd');
    const insertSpy = vi.spyOn(resultSet, 'insertBefore');
    resultSet.insertBefore(rowD, anchor);
    insertSpy.mockClear();

    await harness.host.handleFetchResponse(
      makeFetchDetail('q-lis', [
        { id: 'd', listing: { price: { amount: 25, currency: 'chaos' } }, item: RARE_ITEM },
      ]),
      'Standard',
    );
    expect(insertSpy).toHaveBeenCalledTimes(1);
    expect(Array.from(resultSet.children).map((el) => el.getAttribute('data-id'))).toEqual([
      'd',
      'a',
      'b',
      'c',
    ]);
    const nodes = Array.from(resultSet.childNodes);
    expect(nodes.indexOf(resultSet.children[3])).toBeLessThan(nodes.indexOf(anchor));

    // 點擊官方可排序欄位 -> 退回 default
    const officialMod = document.querySelector<HTMLElement>('[data-id="a"] .s[data-field]')!;
    officialMod.click();
    expect(
      rowTotal!.querySelector('.poexd-sort-popover .poexd-selected')?.getAttribute('data-value'),
    ).toBe('default');

    // 同 searchId 重新搜尋（handleSearchResultSummary）-> 清空舊順序，官方新順序 c, a, b 生效
    harness.host.handleSearchResultSummary('q-lis');
    const [rC, rA, rB] = ['c', 'a', 'b'].map((id) => document.querySelector(`[data-id="${id}"]`)!);
    resultSet.replaceChildren(rC, rA, rB);
    await harness.host.handleFetchResponse(
      makeFetchDetail('q-lis', [
        { id: 'c', listing: { price: { amount: 300, currency: 'chaos' } }, item: RARE_ITEM },
        { id: 'a', listing: { price: { amount: 100, currency: 'chaos' } }, item: RARE_ITEM },
        { id: 'b', listing: { price: { amount: 200, currency: 'chaos' } }, item: RARE_ITEM },
      ]),
      'Standard',
    );
    expect(Array.from(resultSet.children).map((el) => el.getAttribute('data-id'))).toEqual([
      'c',
      'a',
      'b',
    ]);
  });

  it('PoB 複製與 PoEDB 外部連結共用快取字典，切斷跨層耦合且共享左上工具列容器', async () => {
    const harness = createFakeHostHarness({
      pageContext: { pageLocale: 'zh-TW' },
    });
    activeHost = harness.host;
    mountTradeDom(makeRowHtml('tw') + makeRowHtml('currency'));
    await harness.host.applyPreferences(
      makePrefs({
        enableResultPobCopy: true,
        enableResultExternalLinks: true,
        sidebarModulePinnedItems: false,
      }),
    );

    await harness.host.handleFetchResponse(
      makeFetchDetail('q-pob', [
        { id: 'tw', item: TW_ITEM, listing: {} },
        { id: 'currency', item: { typeLine: 'Chaos Orb', frameType: 5 }, listing: {} },
      ]),
      'Standard',
    );

    // 只有可匯出裝備有按鈕
    expect(document.querySelectorAll(`.${RESULT_POB_COPY_BUTTON_CLASS}`)).toHaveLength(1);
    expect(document.querySelectorAll(`.${RESULT_EXTERNAL_LINKS_CLASS}`)).toHaveLength(1);

    // 先按 PoB 再按 PoEDB -> 共用同一個英文反查字典，只載入一次
    document.querySelector<HTMLButtonElement>(`.${RESULT_POB_COPY_BUTTON_CLASS}`)!.click();
    await flushMicrotasks();
    document.querySelector<HTMLButtonElement>(`.${RESULT_EXTERNAL_LINKS_CLASS} button`)!.click();
    await flushMicrotasks();

    expect(harness.loadLexicon).toHaveBeenCalledTimes(1);
    expect(harness.writeClipboard.mock.calls[0][0]).toContain('Opal Wand');
    expect(harness.openUrl).toHaveBeenCalledWith('https://poedb.tw/tw/Opal_Wand');

    // 關掉 PoEDB 不影響 PoB 與共用 .poexd-left-actions 容器；兩者都關掉才清容器與樣式
    await harness.host.applyPreferences(
      makePrefs({
        enableResultPobCopy: true,
        enableResultExternalLinks: false,
        sidebarModulePinnedItems: false,
      }),
    );
    expect(document.querySelector(`.${RESULT_EXTERNAL_LINKS_CLASS}`)).toBeNull();
    expect(document.querySelector(`.${RESULT_LEFT_ACTIONS_CLASS}`)).not.toBeNull();
    expect(document.getElementById('poexd-result-left-actions-style')).not.toBeNull();

    await harness.host.applyPreferences(
      makePrefs({
        enableResultPobCopy: false,
        enableResultExternalLinks: false,
        sidebarModulePinnedItems: false,
      }),
    );
    expect(document.querySelector(`.${RESULT_LEFT_ACTIONS_CLASS}`)).toBeNull();
    expect(document.getElementById('poexd-result-left-actions-style')).toBeNull();
  });

  it('釘選按鈕與詞綴高亮屬 scope: always，在 live 與 live-search-primary 下維持運作，其餘 search-normal 完整清理', async () => {
    const harness = createFakeHostHarness();
    activeHost = harness.host;
    mountTradeDom(makeRowHtml('r1', { priceCurrencyIcon: true }) + makeRowHtml('r2'));
    await harness.host.applyPreferences(makePrefs());
    harness.host.handleSearchQuery('q-scope', {
      stats: [
        {
          filters: [
            { id: 'explicit.stat_3299347043' },
            { id: 'explicit.stat_disabled', disabled: true },
          ],
        },
      ],
    });
    await harness.host.handleFetchResponse(
      makeFetchDetail('q-scope', [
        {
          id: 'r1',
          item: RARE_ITEM,
          listing: { hideout_token: 'secret-jwt', price: { amount: 1, currency: 'alch' } },
        },
      ]),
      'Covens',
    );

    // search-normal 下 8 項功能都正常掛載
    expect(document.querySelector(`.${RESULT_PIN_BUTTON_CLASS}`)).not.toBeNull();
    expect(document.querySelector(`.${RESULT_POB_COPY_BUTTON_CLASS}`)).not.toBeNull();
    expect(document.querySelector(`.${RESULT_EXTERNAL_LINKS_CLASS}`)).not.toBeNull();
    expect(document.querySelector(`.${RESULT_MOD_QUICK_FILTER_ACTIONS_CLASS}`)).not.toBeNull();
    expect(document.querySelector('.poexd-filter-mod-highlight')).not.toBeNull();
    expect(document.querySelector('.poexd-total-controls')).not.toBeNull();

    // 切換為 live-search-primary -> 所有 search-normal 清理，always（釘選、高亮）保留；
    // 即使在非一般搜尋下再次呼叫 applyPreferences 也不會把 PoB / PoEDB 重新注入
    harness.host.setPageRole('live-search-primary');
    await harness.host.applyPreferences(makePrefs());
    expect(document.querySelector(`.${RESULT_POB_COPY_BUTTON_CLASS}`)).toBeNull();
    expect(document.querySelector(`.${RESULT_EXTERNAL_LINKS_CLASS}`)).toBeNull();
    expect(document.querySelector(`.${RESULT_MOD_QUICK_FILTER_ACTIONS_CLASS}`)).toBeNull();
    expect(document.querySelector('.poexd-price-comparison')).toBeNull();
    expect(document.querySelector('.poexd-total-controls')).toBeNull();
    expect(document.querySelector(`.${RESULT_PIN_BUTTON_CLASS}`)).not.toBeNull();
    expect(document.querySelector('.poexd-filter-mod-highlight')).not.toBeNull();

    // 切回 normal 再切換為 live 模式 -> 同樣清理所有 search-normal，保留 always
    harness.host.setPageRole('normal');
    harness.host.setPageMode('live');
    await harness.host.applyPreferences(makePrefs());
    expect(document.querySelector(`.${RESULT_POB_COPY_BUTTON_CLASS}`)).toBeNull();
    expect(document.querySelector(`.${RESULT_EXTERNAL_LINKS_CLASS}`)).toBeNull();
    expect(document.querySelector(`.${RESULT_MOD_QUICK_FILTER_ACTIONS_CLASS}`)).toBeNull();
    expect(document.querySelector('.poexd-total-controls')).toBeNull();
    expect(document.querySelector(`.${RESULT_PIN_BUTTON_CLASS}`)).not.toBeNull();
    expect(document.querySelector('.poexd-filter-mod-highlight')).not.toBeNull();

    // 在 live-search-primary 點釘選 -> 送出無 token 的快照並含通貨圖示
    document.querySelector<HTMLButtonElement>(`.${RESULT_PIN_BUTTON_CLASS}`)!.click();
    await flushMicrotasks();
    const snapshot = harness.pinnedItems.pin.mock.calls[0]![0] as PinnedItemSnapshot;
    expect(snapshot).toMatchObject({
      id: 'r1',
      league: 'Covens',
      sourceSearchId: 'q-scope',
      pinnedAt: 42,
      listing: {
        instantBuyout: true,
        price: { icon: 'https://web.poecdn.com/gen/image/alch.png', currencyName: 'Alch' },
      },
    });
    expect(JSON.stringify(snapshot)).not.toContain('secret-jwt');

    // 收到儲存層已釘選通知 -> 標記列與按鈕，再點一次取消釘選
    harness.emitPinned([snapshot]);
    expect(
      document.querySelector('[data-id="r1"]')?.classList.contains(RESULT_PINNED_ROW_CLASS),
    ).toBe(true);
    document.querySelector<HTMLButtonElement>(`.${RESULT_PIN_BUTTON_CLASS}`)!.click();
    await flushMicrotasks();
    expect(harness.pinnedItems.unpin).toHaveBeenCalledWith('r1');
  });

  it('詞綴快篩支援 +和 / +不、不冒泡、already-exists 使用 default tone、非搜尋表單網址停用並相容雙語副標', async () => {
    const harness = createFakeHostHarness();
    activeHost = harness.host;
    mountTradeDom(makeRowHtml('m1'), { compact: true });
    await harness.host.applyPreferences(makePrefs({ enableResultModQuickFilter: true }));

    expect(document.querySelectorAll(`.${RESULT_MOD_QUICK_FILTER_HOST_CLASS}`)).toHaveLength(1);
    const styleEl = document.getElementById('poexd-result-mod-quick-filter-style');
    expect(styleEl?.textContent).toContain(
      `:has(> .${RESULT_MOD_ENGLISH_SUBTITLE_CLASS}) > .${RESULT_MOD_QUICK_FILTER_ACTIONS_CLASS}`,
    );

    const hostEl = document.querySelector(`.${RESULT_MOD_QUICK_FILTER_HOST_CLASS}`) as HTMLElement;
    const parentClick = vi.fn();
    hostEl.addEventListener('click', parentClick);

    hostEl
      .querySelector<HTMLButtonElement>(
        `.${RESULT_MOD_QUICK_FILTER_BUTTON_CLASS}[data-poexd-quick-group="and"]`,
      )!
      .click();
    await flushMicrotasks();
    expect(parentClick).not.toHaveBeenCalled();
    expect(harness.overlayChannel.commit).toHaveBeenCalledWith([
      {
        kind: 'setStatFilter',
        group: 0,
        filter: { id: 'explicit.stat_3299347043', disabled: false },
      },
    ]);
    expect(harness.toasts[0]?.tone).toBe('success');

    // already-exists -> 不呼叫 commit，發出 default tone
    harness.overlayChannel.commit.mockClear();
    harness.overlayChannel.read.mockResolvedValueOnce({
      snapshot: { stats: [{ type: 'and', filters: [{ id: 'explicit.stat_3299347043' }] }] },
      knownStatIds: new Set(['explicit.stat_3299347043']),
    });
    hostEl
      .querySelector<HTMLButtonElement>(
        `.${RESULT_MOD_QUICK_FILTER_BUTTON_CLASS}[data-poexd-quick-group="and"]`,
      )!
      .click();
    await flushMicrotasks();
    expect(harness.overlayChannel.commit).not.toHaveBeenCalled();
    expect(harness.toasts[1]?.tone).toBe('default');

    // 非搜尋表單網址（例如 exchange）不注入
    harness.host.cleanup();
    const exchangeHarness = createFakeHostHarness({ isSearchFormUrl: () => false });
    activeHost = exchangeHarness.host;
    mountTradeDom(makeRowHtml('m2'));
    await exchangeHarness.host.applyPreferences(makePrefs({ enableResultModQuickFilter: true }));
    expect(document.querySelectorAll(`.${RESULT_MOD_QUICK_FILTER_ACTIONS_CLASS}`)).toHaveLength(0);
  });

  it('cleanup() 完整移除所有注入 DOM 與全部 9 個結果增強樣式', async () => {
    const harness = createFakeHostHarness({
      version: 'poe2',
      rates: { primary: 'exalted', rates: { exalted: 1, divine: 15 } },
    });
    activeHost = harness.host;
    mountTradeDom(
      makeRowHtml('r1', {
        withAdditional:
          '<span data-field="dps" class="s lc">DPS<span class="colourAugmented">400</span></span>',
      }),
    );
    await harness.host.applyPreferences(makePrefs());
    harness.host.handleSearchQuery('q-clean', {
      stats: [{ filters: [{ id: 'explicit.stat_3299347043' }] }],
    });
    await harness.host.handleFetchResponse(
      makeFetchDetail('q-clean', [POE2_WEAPON('r1', 400)], 'trade2'),
      'Standard',
    );

    expect(document.head.querySelectorAll('style[id^="poexd-"]')).toHaveLength(9);

    harness.host.cleanup();
    expect(document.head.querySelectorAll('style[id^="poexd-"]')).toHaveLength(0);
    expect(document.querySelector('.poexd-total-controls')).toBeNull();
    expect(document.querySelector(`.${RESULT_LEFT_ACTIONS_CLASS}`)).toBeNull();
    expect(document.querySelector(`.${RESULT_MOD_QUICK_FILTER_ACTIONS_CLASS}`)).toBeNull();
    expect(document.querySelector('.poexd-price-comparison')).toBeNull();
    expect(document.querySelector('.poexd-filter-mod-highlight')).toBeNull();
  });
});
