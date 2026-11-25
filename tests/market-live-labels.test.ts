import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetI18nStateForTests, setActiveDisplayLocale } from '../utils/i18n';
import { startMarketLiveLabelsSync, toMarketLiveSnapshot } from '../utils/market-live-labels';
import {
  MARKET_LIVE_SCHEMA_VERSION,
  getMarketLiveDataCacheKey,
  type MarketLiveDataCache,
} from '../utils/market-live-cache';
import {
  type LiveTradeDataSnapshot,
  getOfficialStatLabel,
  getUsableLiveTradeData,
  resetTradeLabelsForTests,
  setLiveTradeData,
  setMarketLiveTradeData,
  setTradeLabelTestData,
  translateFilterKey,
  translateStat,
} from '@/utils/trade-label-resolver';

const INTERNATIONAL = 'www.pathofexile.com';

const makeCache = (overrides: Partial<MarketLiveDataCache> = {}): MarketLiveDataCache => ({
  schemaVersion: MARKET_LIVE_SCHEMA_VERSION,
  version: 'poe1',
  locale: 'zh-TW',
  updatedAt: 1,
  filters: {
    groups: { map_filters: '快取地圖篩選' },
    fields: { viscera_new_field: '快取新欄位' },
    options: { category: { viscera: '任何臟器' } },
  },
  stats: {
    labels: { explicit: '隨機' },
    stats: {
      'explicit.stat_cache_only': '快取才有的詞綴 #%',
      'explicit.stat_duplicated': ['第一種寫法 #', '第二種寫法 #'],
      'pseudo.pseudo_cache_total': '+#  快取總計',
    },
    options: {},
  },
  ...overrides,
});

describe('toMarketLiveSnapshot', () => {
  it('轉成與頁面即時資料相同的形狀，語系取自快取', () => {
    const snapshot = toMarketLiveSnapshot(makeCache());
    expect(snapshot?.pageLocale).toBe('zh-TW');
    expect(snapshot?.filters?.fields.viscera_new_field).toBe('快取新欄位');
    expect(snapshot?.statLabels?.stats['explicit.stat_cache_only']).toBe('快取才有的詞綴 #%');
  });

  it('重複 id 取第一次出現的寫法', () => {
    const snapshot = toMarketLiveSnapshot(makeCache());
    expect(snapshot?.statLabels?.stats['explicit.stat_duplicated']).toBe('第一種寫法 #');
  });

  it('pseudo 另外整理成 pseudoStats 並合併連續空白', () => {
    const snapshot = toMarketLiveSnapshot(makeCache());
    expect(snapshot?.statLabels?.pseudoStats).toEqual({
      'pseudo.pseudo_cache_total': '+# 快取總計',
    });
  });

  it('只有部分端點成功時保留有的部分；都沒有時回傳 null', () => {
    const filtersOnly = toMarketLiveSnapshot(makeCache({ stats: undefined }));
    expect(filtersOnly?.filters).not.toBeNull();
    expect(filtersOnly?.statLabels).toBeNull();
    expect(toMarketLiveSnapshot(makeCache({ stats: undefined, filters: undefined }))).toBeNull();
  });
});

describe('getUsableLiveTradeData 的市集漢化來源', () => {
  afterEach(() => resetTradeLabelsForTests());

  const market = toMarketLiveSnapshot(makeCache()) as LiveTradeDataSnapshot;

  it('國際服顯示中文時採用語系相符的市集漢化快取', () => {
    setMarketLiveTradeData('poe1', market);
    expect(getUsableLiveTradeData('poe1', 'zh-TW', INTERNATIONAL)).toBeDefined();
    expect(getUsableLiveTradeData('poe1', 'zh-CN', INTERNATIONAL)).toBeUndefined();
    expect(getUsableLiveTradeData('poe2', 'zh-TW', INTERNATIONAL)).toBeUndefined();
  });

  it('不影響其他情境：國際服英文與在地化官網仍只用頁面資料', () => {
    setMarketLiveTradeData('poe1', market);
    expect(getUsableLiveTradeData('poe1', 'en', INTERNATIONAL)).toBeUndefined();
    expect(getUsableLiveTradeData('poe1', 'zh-TW', 'pathofexile.tw')).toBeUndefined();
  });

  it('國際服顯示中文時仍不採用頁面資料（可能已被改寫成中英並列）', () => {
    setLiveTradeData('poe1', { pageLocale: 'zh-TW', filters: null, statLabels: null });
    expect(getUsableLiveTradeData('poe1', 'zh-TW', INTERNATIONAL)).toBeUndefined();
  });

  it('傳入 null 會清除', () => {
    setMarketLiveTradeData('poe1', market);
    setMarketLiveTradeData('poe1', null);
    expect(getUsableLiveTradeData('poe1', 'zh-TW', INTERNATIONAL)).toBeUndefined();
  });
});

describe('側邊欄標籤採用市集漢化快取', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { location: { hostname: INTERNATIONAL } });
    setActiveDisplayLocale('zh-TW');
    setTradeLabelTestData({ version: 'poe1', officialStats: { en: { stats: {} } } });
    setTradeLabelTestData({ version: 'poe1', officialStats: { 'zh-TW': { stats: {} } } });
    setMarketLiveTradeData('poe1', toMarketLiveSnapshot(makeCache()));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetTradeLabelsForTests();
    resetI18nStateForTests('zh-TW');
  });

  it('打包資料沒有的篩選欄位顯示快取的中文', () => {
    expect(translateFilterKey('viscera_new_field', 'poe1')).toBe('快取新欄位');
  });

  it('打包資料沒有的詞綴顯示快取的市集寫法', () => {
    expect(getOfficialStatLabel('explicit.stat_cache_only', 'poe1', 'zh-TW')).toBe(
      '快取才有的詞綴 #%',
    );
    expect(translateStat('pseudo.pseudo_cache_total', 'poe1')).toBe('# 快取總計');
  });

  it('市集漢化停用（快取清空）後退回打包資料', () => {
    setMarketLiveTradeData('poe1', null);
    expect(getOfficialStatLabel('explicit.stat_cache_only', 'poe1', 'zh-TW')).toBeNull();
  });
});

describe('startMarketLiveLabelsSync', () => {
  const cacheKey = getMarketLiveDataCacheKey('poe1', 'zh-TW');

  function setup(initial: Record<string, unknown>) {
    const storage: Record<string, unknown> = { ...initial };
    const applied: Array<LiveTradeDataSnapshot | null> = [];
    let notify: (keys: readonly string[]) => void = () => undefined;
    const unsubscribe = vi.fn();
    const stop = startMarketLiveLabelsSync({
      version: 'poe1',
      hostname: INTERNATIONAL,
      browserLocale: 'en-US',
      readStorage: async (keys) =>
        Object.fromEntries(keys.filter((key) => key in storage).map((key) => [key, storage[key]])),
      subscribeStorage: (handler) => {
        notify = handler;
        return unsubscribe;
      },
      apply: (snapshot) => applied.push(snapshot),
    });
    const change = async (items: Record<string, unknown>) => {
      Object.assign(storage, items);
      notify(Object.keys(items));
      await flush();
    };
    return { applied, change, stop, unsubscribe };
  }

  const flush = async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  };
  const enabled = { marketTranslation: true, displayLocale: 'zh-TW' };

  it('市集漢化啟用且有快取時套用快照', async () => {
    const { applied } = setup({ ...enabled, [cacheKey]: makeCache() });
    await flush();
    expect(applied).toHaveLength(1);
    expect(applied[0]?.pageLocale).toBe('zh-TW');
  });

  it('市集漢化未啟用時不採用既有快取', async () => {
    const { applied } = setup({ displayLocale: 'zh-TW', [cacheKey]: makeCache() });
    await flush();
    expect(applied).toEqual([null]);
  });

  it('快取格式不符時退回打包資料', async () => {
    const { applied } = setup({ ...enabled, [cacheKey]: { schemaVersion: 999 } });
    await flush();
    expect(applied).toEqual([null]);
  });

  it('背景更新寫入快取後重新套用', async () => {
    const { applied, change } = setup({ ...enabled });
    await flush();
    expect(applied).toEqual([null]);
    await change({ [cacheKey]: makeCache() });
    expect(applied).toHaveLength(2);
    expect(applied[1]?.filters?.fields.viscera_new_field).toBe('快取新欄位');
  });

  it('關閉市集漢化後清空', async () => {
    const { applied, change } = setup({ ...enabled, [cacheKey]: makeCache() });
    await flush();
    await change({ marketTranslation: false });
    expect(applied.at(-1)).toBeNull();
  });

  it('無關的 storage 變更不重新讀取', async () => {
    const { applied, change } = setup({ ...enabled, [cacheKey]: makeCache() });
    await flush();
    await change({ unrelated_key: 1 });
    expect(applied).toHaveLength(1);
  });

  it('讀取失敗時清空，不拋出', async () => {
    const applied: Array<LiveTradeDataSnapshot | null> = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    startMarketLiveLabelsSync({
      version: 'poe1',
      hostname: INTERNATIONAL,
      browserLocale: 'en-US',
      readStorage: async () => {
        throw new Error('storage unavailable');
      },
      subscribeStorage: () => () => undefined,
      apply: (snapshot) => applied.push(snapshot),
    });
    await flush();
    expect(applied).toEqual([null]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('停止後取消訂閱且不再套用', async () => {
    const { applied, change, stop, unsubscribe } = setup({ ...enabled, [cacheKey]: makeCache() });
    await flush();
    stop();
    await change({ [cacheKey]: makeCache() });
    expect(unsubscribe).toHaveBeenCalled();
    expect(applied).toHaveLength(1);
  });
});
