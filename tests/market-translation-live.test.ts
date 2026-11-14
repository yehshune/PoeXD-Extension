import { describe, expect, it, vi } from 'vitest';
import {
  MARKET_LIVE_ERROR_COOLDOWN_MS,
  MARKET_LIVE_TTL_MS,
  alignLiveStatsWithEnglish,
  createMarketTranslationLiveService,
  getMarketLiveDataCacheKey,
  getMarketLiveErrorCacheKey,
  getMarketLiveUiCacheKey,
  mergeMarketTradeDictionary,
  mergeMarketUiStrings,
  parseOfficialTradeFilters,
  parseOfficialTradeStatic,
  parseOfficialTradeStats,
  parseOfficialTranslateJs,
  type MarketLiveHttpClient,
  type MarketLiveStorage,
} from '@/utils/market-translation-live';

function buildTranslateJs(count = 110, extraLines: string[] = []): string {
  const lines = [
    '// PoE official dictionary',
    'var __ = {};',
    "__['Search Listed Items'] = '搜尋道具';",
    "__['Any'] = '任何';",
    "__['Same'] = 'Same';",
    "__[\"Gemcutter's Prism\"] = '珠寶匠的稜鏡';",
    "__['Escaped'] = '第一行\\n第二行\\\\\\\'引號\\u0021';",
  ];
  for (let i = 0; i < count; i += 1) {
    lines.push(`__['Key ${i}'] = '譯文 ${i}';`);
  }
  lines.push(...extraLines);
  return `\uFEFF${lines.join('\n')}`;
}

function buildStatsResponse(
  count = 510,
  label = '偽屬性',
  options: { prefix?: string; dupCount?: number } = {},
) {
  const prefix = options.prefix ?? '詞綴';
  const dupCount = options.dupCount ?? 2;
  const entries = [
    { id: 'pseudo.pseudo_total_life', text: '+# 最大生命', type: 'pseudo' },
    {
      id: 'pseudo.pseudo_searing_implicit_tier',
      text: '灼烙總督固定詞綴階級',
      type: 'pseudo',
      option: { options: [{ id: 1, text: '低階' }] },
    },
  ];
  const explicitEntries = Array.from({ length: dupCount }, (_, i) => ({
    id: 'explicit.stat_dup',
    text: i === 0 ? '魔法怪物增加 #%' : `增加 #% 地圖中魔法怪物數量 (${i})`,
    type: 'explicit',
  }));
  for (let i = 0; i < count; i += 1) {
    explicitEntries.push({ id: `explicit.stat_${i}`, text: `${prefix} ${i}`, type: 'explicit' });
  }
  return {
    result: [
      { id: 'pseudo', label, entries },
      { id: 'explicit', label: '隨機屬性', entries: explicitEntries },
    ],
  };
}

function buildEnglishStatsResponse(count = 510) {
  const entries = [
    { id: 'pseudo.pseudo_total_life', text: '+# to maximum Life', type: 'pseudo' },
    {
      id: 'pseudo.pseudo_searing_implicit_tier',
      text: 'Searing Exarch Implicit Modifier Tier',
      type: 'pseudo',
      option: { options: [{ id: 1, text: 'Lesser' }] },
    },
  ];
  const explicitEntries = [
    { id: 'explicit.stat_dup', text: '#% increased Magic Monsters', type: 'explicit' },
    { id: 'explicit.stat_dup', text: '#% increased Magic Monsters in Area', type: 'explicit' },
  ];
  for (let i = 0; i < count; i += 1) {
    explicitEntries.push({ id: `explicit.stat_${i}`, text: `Mod ${i}`, type: 'explicit' });
  }
  return {
    result: [
      { id: 'pseudo', label: 'Pseudo', entries },
      { id: 'explicit', label: 'Explicit', entries: explicitEntries },
    ],
  };
}

function buildEnglishFiltersResponse() {
  const filters = Array.from({ length: 10 }, (_, i) => ({ id: `field_${i}`, text: `Field ${i}` }));
  return {
    result: [
      {
        id: 'type_filters',
        title: 'Type Filters',
        filters: [
          {
            id: 'sale_type',
            text: 'Sale Type',
            option: { options: [{ id: null, text: 'Buyout' }] },
          },
          ...filters,
        ],
      },
    ],
  };
}

function buildStaticResponse() {
  const entries = Array.from({ length: 20 }, (_, i) => ({ id: `curr_${i}`, text: `通貨 ${i}` }));
  return {
    result: [
      { id: 'Currency', label: '通貨', entries: [{ id: 'sep', text: '分隔標題' }, ...entries] },
      { id: 'Fragments', label: '碎片', entries: [{ id: 'frag', text: '碎片' }] },
      { id: 'Cards', label: '命運卡', entries: [{ id: 'card', text: '命運卡' }] },
    ],
  };
}

function buildFiltersResponse() {
  const filters = Array.from({ length: 10 }, (_, i) => ({ id: `field_${i}`, text: `欄位 ${i}` }));
  return {
    result: [
      {
        id: 'type_filters',
        title: '類別過濾',
        filters: [
          {
            id: 'sale_type',
            text: '販售類型',
            option: { options: [{ id: null, text: '直購價' }] },
          },
          ...filters,
        ],
      },
    ],
  };
}

function createMemoryStorage(initial: Record<string, unknown> = {}): MarketLiveStorage {
  const store: Record<string, unknown> = { ...initial };
  return {
    get: vi.fn(async (keys) => {
      const list = Array.isArray(keys) ? keys : [keys];
      const result: Record<string, unknown> = {};
      for (const k of list) {
        if (k in store) result[k] = store[k];
      }
      return result;
    }),
    set: vi.fn(async (items) => {
      Object.assign(store, items);
    }),
  };
}

function okResponse(body: unknown): Pick<Response, 'ok' | 'status' | 'text' | 'json'> {
  return {
    ok: true,
    status: 200,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => body,
  };
}

describe('parseOfficialTranslateJs', () => {
  it('嚴格解析官方 __ 字典，處理跳脫字元並略過未翻譯鍵', () => {
    const parsed = parseOfficialTranslateJs(buildTranslateJs());
    expect(parsed).not.toBeNull();
    expect(parsed?.['Search Listed Items']).toBe('搜尋道具');
    expect(parsed?.["Gemcutter's Prism"]).toBe('珠寶匠的稜鏡');
    expect(parsed?.Escaped).toBe("第一行\n第二行\\'引號!");
    expect(parsed?.Same).toBeUndefined();
  });

  it('拒絕 HTML、非賦值腳本、純英文或過少條目', () => {
    expect(parseOfficialTranslateJs('<html><body>cf</body></html>')).toBeNull();
    expect(parseOfficialTranslateJs(buildTranslateJs(110, ['alert(1);']))).toBeNull();
    expect(parseOfficialTranslateJs(buildTranslateJs(5))).toBeNull();
    const englishOnly = Array.from({ length: 120 }, (_, i) => `__['K${i}'] = 'V${i}';`).join('\n');
    expect(parseOfficialTranslateJs(englishOnly)).toBeNull();
  });
});

describe('parseOfficialTrade{Stats,Static,Filters}', () => {
  it('stats 保留重複 id 順序為陣列，並解析選項文字', () => {
    const parsed = parseOfficialTradeStats(buildStatsResponse());
    expect(parsed?.labels.pseudo).toBe('偽屬性');
    expect(parsed?.stats['pseudo.pseudo_total_life']).toBe('+# 最大生命');
    expect(parsed?.stats['explicit.stat_dup']).toEqual([
      '魔法怪物增加 #%',
      '增加 #% 地圖中魔法怪物數量 (1)',
    ]);
    expect(parsed?.options['pseudo.pseudo_searing_implicit_tier']).toEqual({ '1': '低階' });
    expect(parseOfficialTradeStats(buildStatsResponse(510, 'Pseudo'))).not.toBeNull();
    expect(
      parseOfficialTradeStats({
        result: [
          {
            id: 'pseudo',
            label: 'Pseudo',
            entries: Array.from({ length: 500 }, (_, i) => ({ id: `p${i}`, text: `Stat ${i}` })),
          },
        ],
      }),
    ).toBeNull();
  });

  it('alignLiveStatsWithEnglish 僅保留國際服同出現次數 id 並拒絕超過 50% 為英文的回應', () => {
    const enStats = buildEnglishStatsResponse()
      .result.flatMap((g) => g.entries)
      .reduce<Record<string, string | string[]>>((acc, entry) => {
        const prev = acc[entry.id];
        acc[entry.id] = prev
          ? Array.isArray(prev)
            ? [...prev, entry.text]
            : [prev, entry.text]
          : entry.text;
        return acc;
      }, {});

    // 1) 重複 id 出現次數不同 (1 vs 2) 與不存在於國際服的 id 皆應略過
    const mismatched = parseOfficialTradeStats({
      result: [
        ...buildStatsResponse(510, '偽屬性', { dupCount: 1 }).result,
        { id: 'extra', label: '額外', entries: [{ id: 'realm.only', text: '僅此服存在' }] },
      ],
    })!;
    const aligned = alignLiveStatsWithEnglish(mismatched, enStats);
    expect(aligned).not.toBeNull();
    expect(aligned?.stats['explicit.stat_dup']).toBeUndefined();
    expect(aligned?.stats['realm.only']).toBeUndefined();
    expect(aligned?.stats['pseudo.pseudo_total_life']).toBe('+# 最大生命');

    // 2) 重複 id 次數相同 (2 vs 2) 則保留
    const matched = parseOfficialTradeStats(buildStatsResponse())!;
    expect(alignLiveStatsWithEnglish(matched, enStats)?.stats['explicit.stat_dup']).toEqual([
      '魔法怪物增加 #%',
      '增加 #% 地圖中魔法怪物數量 (1)',
    ]);

    // 3) 與英文完全相同超過 50% 時整份拒絕（即使含有少量中文詞綴）
    const mostlyEnglish = parseOfficialTradeStats(
      buildStatsResponse(510, 'Pseudo', { prefix: 'Mod' }),
    )!;
    expect(alignLiveStatsWithEnglish(mostlyEnglish, enStats)).toBeNull();
  });

  it('static 依群組收錄條目並略過 sep 分隔列', () => {
    const parsed = parseOfficialTradeStatic(buildStaticResponse());
    expect(parsed?.labels.Currency).toBe('通貨');
    expect(parsed?.entries.Currency.curr_0).toBe('通貨 0');
    expect(parsed?.entries.Currency.sep).toBeUndefined();
  });

  it('filters 沿用 parseLiveTradeFilters 並拒絕純英文回應', () => {
    const parsed = parseOfficialTradeFilters(buildFiltersResponse());
    expect(parsed?.groups.type_filters).toBe('類別過濾');
    expect(parsed?.options.sale_type).toEqual({ priced: '直購價' });

    const english = {
      result: [
        {
          id: 'type_filters',
          title: 'Type Filters',
          filters: Array.from({ length: 10 }, (_, i) => ({ id: `f_${i}`, text: `Field ${i}` })),
        },
      ],
    };
    expect(parseOfficialTradeFilters(english)).toBeNull();
  });
});

describe('createMarketTranslationLiveService', () => {
  it('抓取台服官方 API 與 UI 字典並寫入快取，TTL 內不重抓', async () => {
    let nowMs = 1_000_000;
    const storage = createMemoryStorage();
    const http = vi.fn<MarketLiveHttpClient>(async (url) => {
      if (url === 'https://webtw.poecdn.com/js/translate.zh_TW.js')
        return okResponse(buildTranslateJs());
      if (url === 'https://pathofexile.tw/api/trade/data/stats')
        return okResponse(buildStatsResponse());
      if (url === 'https://pathofexile.tw/api/trade/data/static')
        return okResponse(buildStaticResponse());
      if (url === 'https://pathofexile.tw/api/trade/data/filters')
        return okResponse(buildFiltersResponse());
      if (url === 'https://www.pathofexile.com/api/trade/data/stats')
        return okResponse(buildEnglishStatsResponse());
      if (url === 'https://www.pathofexile.com/api/trade/data/filters')
        return okResponse(buildEnglishFiltersResponse());
      throw new Error(`unexpected ${url}`);
    });
    const service = createMarketTranslationLiveService({ storage, http, now: () => nowMs });

    const first = await service.refresh({ version: 'poe1', locale: 'zh-TW' });
    expect(first).toEqual({
      ok: true,
      updated: true,
      sources: ['ui', 'stats', 'static', 'filters', 'enStats', 'enFilters'],
    });
    const cached = await storage.get([
      getMarketLiveUiCacheKey('zh-TW'),
      getMarketLiveDataCacheKey('poe1', 'zh-TW'),
    ]);
    expect((cached[getMarketLiveUiCacheKey('zh-TW')] as any).strings['Search Listed Items']).toBe(
      '搜尋道具',
    );
    expect(
      (cached[getMarketLiveDataCacheKey('poe1', 'zh-TW')] as any).filters.groups.type_filters,
    ).toBe('類別過濾');

    // TTL 內不再發請求
    http.mockClear();
    nowMs += MARKET_LIVE_TTL_MS - 1000;
    const second = await service.refresh({ version: 'poe1', locale: 'zh-TW' });
    expect(second).toEqual({ ok: true, updated: false, sources: [] });
    expect(http).not.toHaveBeenCalled();

    // 超過 TTL 重新抓取
    nowMs += 2000;
    await service.refresh({ version: 'poe1', locale: 'zh-TW' });
    expect(http).toHaveBeenCalled();
  });

  it('簡中 UI 字典在 poecdn.game.qq.com 失敗時自動退回 poe.game.qq.com，並合併並發請求', async () => {
    const storage = createMemoryStorage();
    const http = vi.fn<MarketLiveHttpClient>(async (url) => {
      if (url === 'https://poecdn.game.qq.com/js/translate.zh_CN.js')
        return { ok: false, status: 504, text: async () => '', json: async () => ({}) };
      if (url === 'https://poe.game.qq.com/js/translate.zh_CN.js')
        return okResponse(buildTranslateJs());
      if (url === 'https://poe.game.qq.com/api/trade2/data/stats')
        return okResponse(buildStatsResponse());
      if (url === 'https://poe.game.qq.com/api/trade2/data/static')
        return okResponse(buildStaticResponse());
      if (url === 'https://poe.game.qq.com/api/trade2/data/filters')
        return okResponse(buildFiltersResponse());
      if (url === 'https://www.pathofexile.com/api/trade2/data/stats')
        return okResponse(buildEnglishStatsResponse());
      if (url === 'https://www.pathofexile.com/api/trade2/data/filters')
        return okResponse(buildEnglishFiltersResponse());
      throw new Error(`unexpected ${url}`);
    });
    const service = createMarketTranslationLiveService({ storage, http, now: () => 5_000_000 });

    const [a, b] = await Promise.all([
      service.refresh({ version: 'poe2', locale: 'zh-CN' }),
      service.refresh({ version: 'poe2', locale: 'zh-CN' }),
    ]);
    expect(a).toEqual(b);
    expect(a).toMatchObject({ ok: true, updated: true });
    expect(http.mock.calls.filter(([u]) => u.includes('/api/trade2/data/stats'))).toHaveLength(2);
  });

  it('全部端點失敗時寫入冷卻時間，冷卻期內不重複請求；部分成功不覆寫既有快取', async () => {
    let nowMs = 10_000_000;
    const storage = createMemoryStorage();
    const http = vi.fn<MarketLiveHttpClient>(async () => ({
      ok: false,
      status: 503,
      text: async () => '',
      json: async () => ({}),
    }));
    const service = createMarketTranslationLiveService({ storage, http, now: () => nowMs });

    const failed = await service.refresh({ version: 'poe1', locale: 'zh-TW' });
    expect(failed.ok).toBe(false);
    const errStored = await storage.get(getMarketLiveErrorCacheKey('poe1', 'zh-TW'));
    expect((errStored[getMarketLiveErrorCacheKey('poe1', 'zh-TW')] as any).failedAt).toBe(nowMs);

    http.mockClear();
    nowMs += MARKET_LIVE_ERROR_COOLDOWN_MS - 1000;
    const cooled = await service.refresh({ version: 'poe1', locale: 'zh-TW' });
    expect(cooled).toEqual({ ok: true, updated: false, sources: [] });
    expect(http).not.toHaveBeenCalled();
  });

  it('部分端點失敗時只冷卻失敗端點並在冷卻後單獨重試，不凍結 6 小時也不重抓已成功端點', async () => {
    let nowMs = 20_000_000;
    let failStatic = true;
    const storage = createMemoryStorage();
    const http = vi.fn<MarketLiveHttpClient>(async (url) => {
      if (url === 'https://webtw.poecdn.com/js/translate.zh_TW.js')
        return okResponse(buildTranslateJs());
      if (url === 'https://pathofexile.tw/api/trade/data/stats')
        return okResponse(buildStatsResponse());
      if (url === 'https://pathofexile.tw/api/trade/data/static') {
        if (failStatic)
          return { ok: false, status: 503, text: async () => '', json: async () => ({}) };
        return okResponse(buildStaticResponse());
      }
      if (url === 'https://pathofexile.tw/api/trade/data/filters')
        return okResponse(buildFiltersResponse());
      if (url === 'https://www.pathofexile.com/api/trade/data/stats')
        return okResponse(buildEnglishStatsResponse());
      if (url === 'https://www.pathofexile.com/api/trade/data/filters')
        return okResponse(buildEnglishFiltersResponse());
      throw new Error(`unexpected ${url}`);
    });
    const service = createMarketTranslationLiveService({ storage, http, now: () => nowMs });

    const first = await service.refresh({ version: 'poe1', locale: 'zh-TW' });
    expect(first).toEqual({
      ok: true,
      updated: true,
      sources: ['ui', 'stats', 'filters', 'enStats', 'enFilters'],
    });

    // 冷卻期內不應重複發請求
    http.mockClear();
    nowMs += MARKET_LIVE_ERROR_COOLDOWN_MS - 1000;
    const withinCooldown = await service.refresh({ version: 'poe1', locale: 'zh-TW' });
    expect(withinCooldown).toEqual({ ok: true, updated: false, sources: [] });
    expect(http).not.toHaveBeenCalled();

    // 冷卻過後只單獨補抓之前失敗的 static，不再重抓其他 5 個新鮮端點
    failStatic = false;
    nowMs += 2000;
    const retry = await service.refresh({ version: 'poe1', locale: 'zh-TW' });
    expect(retry).toEqual({ ok: true, updated: true, sources: ['static'] });
    expect(http.mock.calls.map(([u]) => u)).toEqual([
      'https://pathofexile.tw/api/trade/data/static',
    ]);

    // 之後 6 小時內不再重抓任何端點
    http.mockClear();
    nowMs += MARKET_LIVE_TTL_MS - MARKET_LIVE_ERROR_COOLDOWN_MS - 5000;
    const settled = await service.refresh({ version: 'poe1', locale: 'zh-TW' });
    expect(settled).toEqual({ ok: true, updated: false, sources: [] });
    expect(http).not.toHaveBeenCalled();
  });

  it('merge helpers 以即時資料同 id 覆蓋打包資料並保留未覆蓋的打包鍵', () => {
    const mergedUi = mergeMarketUiStrings({ Keep: '保留', Update: '舊' }, { Update: '新' });
    expect(mergedUi).toEqual({ Keep: '保留', Update: '新' });

    const mergedDict = mergeMarketTradeDictionary(
      {
        filters: {
          groups: { type_filters: '舊群組', keep_group: '保留群組' },
          fields: { category: '舊欄位' },
          options: { category: { weapon: '武器', gem: '寶石' } },
        },
        items: { 'gold ring': '金光戒指' },
      },
      {
        schemaVersion: 1,
        version: 'poe1',
        locale: 'zh-TW',
        updatedAt: 1,
        filters: {
          groups: { type_filters: '新群組', map_filters: '地圖篩選' },
          fields: { map_bonus: '輿圖掉落' },
          options: { category: { weapon: '新武器' } },
        },
      },
    );
    expect(mergedDict.filters?.groups).toEqual({
      type_filters: '新群組',
      keep_group: '保留群組',
      map_filters: '地圖篩選',
    });
    expect(mergedDict.filters?.options.category).toEqual({ weapon: '新武器', gem: '寶石' });
    expect(mergedDict.items).toEqual({ 'gold ring': '金光戒指' });
  });
});
