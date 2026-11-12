import { describe, expect, it, vi } from 'vitest';
import {
  loadMarketTradeDictionary,
  loadResultTranslatorData,
} from '@/utils/market-translation-assets';

const ASSETS: Record<string, unknown> = {
  'json/poe2/locales/zh-TW/trade-stats.json': {
    schemaVersion: 1,
    gameVersion: 'poe2',
    locale: 'zh-TW',
    labels: { explicit: '隨機屬性' },
    stats: { 'explicit.stat_1': '增加#%能力值需求' },
    options: {},
  },
  'json/poe2/locales/zh-TW/trade-static.json': {
    schemaVersion: 1,
    gameVersion: 'poe2',
    locale: 'zh-TW',
    labels: { Currency: '通貨' },
    entries: { Currency: { wisdom: '知識卷軸' } },
  },
  'json/poe2/locales/zh-TW/trade-filters.json': {
    groups: { type_filters: '類別過濾' },
    fields: { category: '道具分類' },
    options: { category: { weapon: '武器' } },
  },
  'json/poe2/locales/en/items.json': {
    patch: '0.5.5.8',
    items: ['Gold Ring', 'Andvarius', ''],
  },
  'json/poe2/locales/zh-TW/items.json': {
    patch: '0.5.5.8',
    items: ['金光戒指', '貪慾之記', ''],
  },
};

const loader = (assets: Record<string, unknown>) =>
  vi.fn(async (path: string) => {
    if (!(path in assets)) throw new Error(`404 ${path}`);
    return assets[path];
  });

describe('loadMarketTradeDictionary', () => {
  it('載入四類分片並組成字典；物品以英文名（小寫）對應譯名', async () => {
    const dictionary = await loadMarketTradeDictionary(loader(ASSETS), {
      version: 'poe2',
      locale: 'zh-TW',
    });
    expect(dictionary.stats?.stats['explicit.stat_1']).toBe('增加#%能力值需求');
    expect(dictionary.stats?.labels.explicit).toBe('隨機屬性');
    expect(dictionary.static?.entries.Currency.wisdom).toBe('知識卷軸');
    expect(dictionary.filters?.groups.type_filters).toBe('類別過濾');
    expect(dictionary.items).toEqual({
      'gold ring': '金光戒指',
      andvarius: '貪慾之記',
    });
  });

  it('單一分片失敗或格式不符時只略過那一類，其他照常翻譯', async () => {
    const assets = {
      ...ASSETS,
      'json/poe2/locales/zh-TW/trade-stats.json': {
        schemaVersion: 1,
        locale: 'zh-CN',
        stats: {},
      },
      'json/poe2/locales/zh-TW/items.json': { items: ['金光戒指'] },
    };
    delete (assets as Record<string, unknown>)['json/poe2/locales/zh-TW/trade-static.json'];
    const dictionary = await loadMarketTradeDictionary(loader(assets), {
      version: 'poe2',
      locale: 'zh-TW',
    });
    expect(dictionary.stats).toBeUndefined();
    expect(dictionary.static).toBeUndefined();
    // 物品分片長度與英文不同：索引對不齊，不採用
    expect(dictionary.items).toBeUndefined();
    expect(dictionary.filters?.fields.category).toBe('道具分類');
  });
});

describe('loadResultTranslatorData', () => {
  const RESULT_ASSETS: Record<string, unknown> = {
    'json/poe2/locales/zh-TW/mod-lines.json': {
      schemaVersion: 1,
      patch: '0.5.5.8',
      locale: 'zh-TW',
      lines: { '1': [['{0:d}% increased Spirit', '增加 {0:d}% 精魂']] },
    },
    'json/poe2/locales/en/trade-stats.json': {
      schemaVersion: 1,
      locale: 'en',
      labels: {},
      stats: { 'explicit.stat_1': '#% increased Spirit' },
      options: {},
    },
    'json/poe2/locales/en/trade-filters.json': {
      groups: {},
      fields: { ilvl: 'Item Level', quality: 'Item Quality' },
    },
    'json/poe2/locales/zh-TW/result-labels.json': {
      schemaVersion: 1,
      patch: '0.5.5.8',
      locale: 'zh-TW',
      labels: { 'Item Level': '物品等級（遊戲）', Quarterstaff: '細杖' },
      templates: [['Lasts {0} Seconds', '持續 {0} 秒']],
    },
  };
  const dictionary = {
    stats: {
      labels: {},
      stats: { 'explicit.stat_1': '增加 #% 精魂' },
      options: {},
    },
    filters: {
      groups: {},
      fields: { ilvl: '物品等級', quality: '物品品質' },
      options: {},
    },
    items: { 'gold ring': '金光戒指' },
  };

  it('組合遊戲寫法變體、市集寫法備援、物品名與屬性標籤（介面字典優先）', async () => {
    const data = await loadResultTranslatorData(loader(RESULT_ASSETS), {
      version: 'poe2',
      locale: 'zh-TW',
      dictionary,
      ui: { 'Item Level': '道具等級', Requires: '需求' },
    });
    expect(data.modLines['1']).toEqual([['{0:d}% increased Spirit', '增加 {0:d}% 精魂']]);
    expect(data.tradeStats?.en['explicit.stat_1']).toBe('#% increased Spirit');
    expect(data.tradeStats?.localized['explicit.stat_1']).toBe('增加 #% 精魂');
    expect(data.items).toEqual({ 'gold ring': '金光戒指' });
    // 遊戲資料表的標籤優先序最低：介面字典 > 篩選器欄位名稱 > 遊戲標籤
    expect(data.labels).toEqual({
      'Item Level': '道具等級',
      'Item Quality': '物品品質',
      Quarterstaff: '細杖',
      Requires: '需求',
    });
    expect(data.templates).toEqual([['Lasts {0} Seconds', '持續 {0} 秒']]);
    expect(data.locale).toBe('zh-TW');
  });

  it('分片缺少或語系不符時該部分為空', async () => {
    const assets = {
      ...RESULT_ASSETS,
      'json/poe2/locales/zh-TW/mod-lines.json': {
        schemaVersion: 1,
        locale: 'zh-CN',
        lines: {},
      },
      'json/poe2/locales/zh-TW/result-labels.json': {
        schemaVersion: 1,
        locale: 'zh-TW',
        labels: [],
      },
    };
    const data = await loadResultTranslatorData(loader(assets), {
      version: 'poe2',
      locale: 'zh-TW',
      dictionary: {},
      ui: {},
    });
    expect(data.modLines).toEqual({});
    expect(data.tradeStats).toBeUndefined();
    expect(data.items).toEqual({});
    expect(data.templates).toEqual([]);
  });
});
