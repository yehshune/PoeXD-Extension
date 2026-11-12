import { describe, expect, it } from 'vitest';
import {
  getTradeDataKind,
  localizeTradeData,
  type MarketTradeDictionary,
} from '@/utils/market-translation-data';

// 取自 2026-11-12 國際服 API 回應與台服分片的實際片段
const DICTIONARY: MarketTradeDictionary = {
  stats: {
    labels: { pseudo: '偽屬性', explicit: '隨機屬性' },
    stats: {
      'pseudo.pseudo_total_cold_resistance': '+#% 冰冷抗性',
      'explicit.stat_3639275092': '增加#%能力值需求',
      'explicit.stat_1821565133': ['魔法怪物增加 #%', '增加 #% 地圖中魔法怪物數量'],
      'explicit.stat_untranslated': '#% increased Spirit',
    },
    options: { 'pseudo.pseudo_searing_implicit_tier': { '1': '低階', '2': '高階' } },
  },
  static: {
    labels: { Currency: '通貨' },
    entries: { Currency: { wisdom: '知識卷軸', transmute: '蛻變石' } },
  },
  filters: {
    groups: { type_filters: '類別過濾' },
    fields: { category: '道具分類' },
    options: { category: { weapon: '武器' } },
  },
  items: { 'gold ring': '金光戒指', andvarius: '貪慾之記', 'crimson amulet': '赤紅項鍊' },
  ui: { Any: '任何' },
};

const STATS_RESPONSE = {
  result: [
    {
      id: 'pseudo',
      label: 'Pseudo',
      entries: [
        {
          id: 'pseudo.pseudo_total_cold_resistance',
          text: '+#% total to Cold Resistance',
          type: 'pseudo',
        },
        {
          id: 'pseudo.pseudo_searing_implicit_tier',
          text: 'Searing Exarch Implicit Modifier Tier',
          type: 'pseudo',
          option: {
            options: [
              { id: 1, text: 'Lesser' },
              { id: 2, text: 'Greater' },
            ],
          },
        },
      ],
    },
    {
      id: 'explicit',
      label: 'Explicit',
      entries: [
        {
          id: 'explicit.stat_3639275092',
          text: '#% increased Attribute Requirements',
          type: 'explicit',
        },
        { id: 'explicit.stat_1821565133', text: '#% increased Magic Monsters', type: 'explicit' },
        {
          id: 'explicit.stat_1821565133',
          text: '#% increased number of Magic Monsters in your Maps',
          type: 'explicit',
        },
        { id: 'explicit.stat_untranslated', text: '#% increased Spirit', type: 'explicit' },
        { id: 'explicit.stat_missing', text: 'Some new stat', type: 'explicit' },
      ],
    },
  ],
};

describe('getTradeDataKind', () => {
  it('只辨識四份 data API', () => {
    expect(getTradeDataKind('/api/trade2/data/stats')).toBe('stats');
    expect(getTradeDataKind('/api/trade/data/items')).toBe('items');
    expect(getTradeDataKind('/api/trade/data/static')).toBe('static');
    expect(getTradeDataKind('/api/trade2/data/filters')).toBe('filters');
    expect(getTradeDataKind('/api/trade2/search/poe2')).toBeNull();
    expect(getTradeDataKind('/api/trade2/data/leagues')).toBeNull();
  });
});

describe('localizeTradeData（data API 改寫）', () => {
  it('stats：依 id 換掉 text，同一 id 多次出現時依順序對應；id 與 type 不變', () => {
    const result = localizeTradeData('stats', STATS_RESPONSE, DICTIONARY, {
      bilingual: false,
    }) as typeof STATS_RESPONSE;
    const [pseudo, explicit] = result.result;
    expect(pseudo.label).toBe('偽屬性');
    expect(pseudo.entries[0]).toEqual({
      id: 'pseudo.pseudo_total_cold_resistance',
      text: '+#% 冰冷抗性',
      type: 'pseudo',
    });
    expect(pseudo.entries[1].option?.options).toEqual([
      { id: 1, text: '低階' },
      { id: 2, text: '高階' },
    ]);
    expect(explicit.entries.map((entry) => entry.text)).toEqual([
      '增加#%能力值需求',
      '魔法怪物增加 #%',
      '增加 #% 地圖中魔法怪物數量',
      '#% increased Spirit',
      'Some new stat',
    ]);
    expect(explicit.entries.map((entry) => entry.id)).toEqual(
      STATS_RESPONSE.result[1].entries.map((entry) => entry.id),
    );
  });

  it('雙語：可搜尋的文字變成「中文 (English)」，查不到或相同的維持英文；不改動原物件', () => {
    const snapshot = JSON.stringify(STATS_RESPONSE);
    const result = localizeTradeData('stats', STATS_RESPONSE, DICTIONARY, {
      bilingual: true,
    }) as typeof STATS_RESPONSE;
    const explicit = result.result[1];
    expect(explicit.entries[0].text).toBe('增加#%能力值需求 (#% increased Attribute Requirements)');
    expect(explicit.entries[3].text).toBe('#% increased Spirit');
    expect(explicit.entries[4].text).toBe('Some new stat');
    // 群組名稱與選項不加英文
    expect(result.result[0].label).toBe('偽屬性');
    expect(result.result[0].entries[1].option?.options[0].text).toBe('低階');
    expect(JSON.stringify(STATS_RESPONSE)).toBe(snapshot);
  });

  it('static：依群組與 id 換掉 text，保留圖片等其他欄位', () => {
    const response = {
      result: [
        {
          id: 'Currency',
          label: 'Currency',
          entries: [
            { id: 'wisdom', text: 'Scroll of Wisdom', image: '/gen/image/wisdom.png' },
            { id: 'unknown', text: 'Unknown Orb' },
          ],
        },
      ],
    };
    const result = localizeTradeData('static', response, DICTIONARY, { bilingual: true }) as any;
    expect(result.result[0].label).toBe('通貨');
    expect(result.result[0].entries[0]).toEqual({
      id: 'wisdom',
      text: '知識卷軸 (Scroll of Wisdom)',
      image: '/gen/image/wisdom.png',
    });
    expect(result.result[0].entries[1].text).toBe('Unknown Orb');
  });

  it('filters：群組標題、欄位與選項只換中文（不加英文），null 選項改查介面字典', () => {
    const response = {
      result: [
        {
          id: 'type_filters',
          title: 'Type Filters',
          filters: [
            {
              id: 'category',
              text: 'Item Category',
              fullSpan: true,
              option: {
                options: [
                  { id: null, text: 'Any' },
                  { id: 'weapon', text: 'Any Weapon' },
                  { id: 'weapon.claw', text: 'Claw' },
                ],
              },
            },
          ],
        },
        { id: 'status_filters', filters: [{ id: 'status' }] },
      ],
    };
    const result = localizeTradeData('filters', response, DICTIONARY, { bilingual: true }) as any;
    const group = result.result[0];
    expect(group.title).toBe('類別過濾');
    expect(group.filters[0].text).toBe('道具分類');
    expect(group.filters[0].fullSpan).toBe(true);
    expect(group.filters[0].option.options).toEqual([
      { id: null, text: '任何' },
      { id: 'weapon', text: '武器' },
      { id: 'weapon.claw', text: 'Claw' },
    ]);
    expect(result.result[1]).toEqual({ id: 'status_filters', filters: [{ id: 'status' }] });
  });

  it('items：基底新增 text、傳奇改寫 text；type 與 name 位元組不變', () => {
    const response = {
      result: [
        {
          id: 'accessory',
          label: 'Accessories',
          entries: [
            { type: 'Crimson Amulet' },
            {
              type: 'Gold Ring',
              text: 'Andvarius Gold Ring',
              name: 'Andvarius',
              flags: { unique: true },
            },
            { type: 'Unknown Base' },
          ],
        },
      ],
    };
    const result = localizeTradeData('items', response, DICTIONARY, { bilingual: true }) as any;
    const [base, unique, unknown] = result.result[0].entries;
    expect(base).toEqual({ type: 'Crimson Amulet', text: '赤紅項鍊 (Crimson Amulet)' });
    expect(unique).toEqual({
      type: 'Gold Ring',
      text: '貪慾之記 金光戒指 (Andvarius Gold Ring)',
      name: 'Andvarius',
      flags: { unique: true },
    });
    expect(unknown).toEqual({ type: 'Unknown Base' });

    const mono = localizeTradeData('items', response, DICTIONARY, { bilingual: false }) as any;
    expect(mono.result[0].entries[0].text).toBe('赤紅項鍊');
    expect(mono.result[0].entries[1].text).toBe('貪慾之記 金光戒指');
  });

  it('形狀不符或缺少該類字典時原樣回傳', () => {
    const weird = { notResult: true };
    expect(localizeTradeData('stats', weird, DICTIONARY, { bilingual: false })).toBe(weird);
    expect(localizeTradeData('stats', STATS_RESPONSE, {}, { bilingual: false })).toBe(
      STATS_RESPONSE,
    );
  });
});
