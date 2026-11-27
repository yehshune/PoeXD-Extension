import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed } from 'vue';
import {
  getOfficialStatDomainLabel,
  getOfficialStatDomains,
  getOfficialStatLabel,
  resetTradeLabelsForTests,
  setTradeLabelTestData,
} from '@/utils/trade-label-resolver';

const shard = (
  locale: string,
  stats: Record<string, string | string[]>,
  labels: Record<string, string> = {},
) => ({
  schemaVersion: 1,
  gameVersion: 'poe2',
  locale,
  source: 'test',
  labels,
  stats,
  options: {},
});

describe('official stat text (官方市集詞綴文字)', () => {
  beforeEach(() => {
    resetTradeLabelsForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('依詞綴代碼回傳該語系市集的寫法，正負向跟官方一致', () => {
    setTradeLabelTestData({
      version: 'poe2',
      officialStats: {
        'zh-TW': {
          stats: {
            'explicit.stat_3639275092': '增加#%能力值需求',
            'explicit.stat_2160282525': '減少#%你身上的冰凍持續時間',
          },
        },
      },
    });
    expect(getOfficialStatLabel('explicit.stat_3639275092', 'poe2', 'zh-TW')).toBe(
      '增加#%能力值需求',
    );
    expect(getOfficialStatLabel('explicit.stat_2160282525', 'poe2', 'zh-TW')).toBe(
      '減少#%你身上的冰凍持續時間',
    );
  });

  it('將官方市集文字中的句中折行 \\n 折為單一空白，避免截斷長句', () => {
    setTradeLabelTestData({
      version: 'poe1',
      officialStats: {
        'zh-TW': {
          stats: {
            'explicit.stat_wrap_zh':
              '每個此珠寶插槽和你職業起始位置間\n已配置的天賦點，增加此珠寶插槽 #% 效果。',
          },
        },
        en: {
          stats: {
            'explicit.stat_wrap_en': 'Your Maps have +#% chance\nto contain a Shrine',
          },
        },
      },
    });
    expect(getOfficialStatLabel('explicit.stat_wrap_zh', 'poe1', 'zh-TW')).toBe(
      '每個此珠寶插槽和你職業起始位置間 已配置的天賦點，增加此珠寶插槽 #% 效果。',
    );
    expect(getOfficialStatLabel('explicit.stat_wrap_en', 'poe1', 'en')).toBe(
      'your maps have +#% chance to contain a shrine',
    );
  });

  it('英文跟詞綴字典一致：轉小寫並去掉開頭的 +', () => {
    setTradeLabelTestData({
      version: 'poe1',
      officialStats: {
        en: {
          stats: {
            'explicit.stat_3299347043': '+# to maximum Life',
            'explicit.stat_474294393': '#% reduced Mana Cost of Skills',
          },
        },
      },
    });
    expect(getOfficialStatLabel('explicit.stat_3299347043', 'poe1', 'en')).toBe(
      '# to maximum life',
    );
    expect(getOfficialStatLabel('explicit.stat_474294393', 'poe1', 'en')).toBe(
      '#% reduced mana cost of skills',
    );
  });

  it('同一代碼有多種寫法時取第一個', () => {
    setTradeLabelTestData({
      version: 'poe1',
      officialStats: {
        'zh-TW': {
          stats: {
            'explicit.stat_1': ['區域內有 #% 機率', '地圖內有 #% 機率'],
          },
        },
      },
    });
    expect(getOfficialStatLabel('explicit.stat_1', 'poe1', 'zh-TW')).toBe('區域內有 #% 機率');
  });

  it('其他類別查不到時退回 explicit 同一個 stat', () => {
    setTradeLabelTestData({
      version: 'poe2',
      officialStats: { 'zh-TW': { stats: { 'explicit.stat_9': '增加#%護甲值' } } },
    });
    expect(getOfficialStatLabel('fractured.stat_9', 'poe2', 'zh-TW')).toBe('增加#%護甲值');
  });

  it('中文市集回傳的仍是英文原文時視為沒有翻譯', () => {
    setTradeLabelTestData({
      version: 'poe2',
      officialStats: { en: { stats: { 'explicit.stat_5': '#% increased Spirit' } } },
    });
    setTradeLabelTestData({
      version: 'poe2',
      officialStats: { 'zh-TW': { stats: { 'explicit.stat_5': '#% increased Spirit' } } },
    });
    expect(getOfficialStatLabel('explicit.stat_5', 'poe2', 'zh-TW')).toBeNull();
  });

  it('沒有官方資料的語系直接回傳 null，不發出請求', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(getOfficialStatLabel('explicit.stat_5', 'poe2', 'ja')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('按需載入分片，載入完成後重新渲染讀取者', async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes('json/poe2/locales/zh-CN/trade-stats.json')
        ? shard('zh-CN', { 'explicit.stat_7': '属性需求提高 #%' })
        : shard('en', { 'explicit.stat_7': '#% increased Attribute Requirements' });
      return new Response(JSON.stringify(body), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const label = computed(() => getOfficialStatLabel('explicit.stat_7', 'poe2', 'zh-CN'));
    expect(label.value).toBeNull();
    await vi.waitFor(() => expect(label.value).toBe('属性需求提高 #%'));
    // 中文分片與用來比對的英文分片各請求一次
    const urls = fetchSpy.mock.calls.map(([input]) => String(input));
    expect(urls.filter((url) => url.includes('/zh-CN/'))).toHaveLength(1);
    expect(urls.filter((url) => url.includes('/en/'))).toHaveLength(1);
  });

  it('格式不符或載入失敗時不重複請求', async () => {
    const fetchSpy = vi.fn(
      async () => new Response(JSON.stringify({ stats: 'bad' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    // 第一次查詢觸發載入，分片格式不符
    expect(getOfficialStatLabel('explicit.stat_1', 'poe1', 'zh-TW')).toBeNull();
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    await new Promise((done) => setTimeout(done, 0));
    expect(getOfficialStatLabel('explicit.stat_1', 'poe1', 'zh-TW')).toBeNull();
    await new Promise((done) => setTimeout(done, 0));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('擴充 context 失效、取得資產網址時同步丟錯，讀取者不會跟著丟錯', async () => {
    vi.stubGlobal('chrome', {
      runtime: {
        getURL: () => {
          throw new Error('Extension context invalidated.');
        },
      },
    });
    const label = computed(() => getOfficialStatLabel('explicit.stat_1', 'poe1', 'zh-TW'));
    expect(label.value).toBeNull();
    expect(getOfficialStatDomains('explicit.stat_1', 'poe1')).toEqual([]);
    await new Promise((done) => setTimeout(done, 0));
    expect(label.value).toBeNull();
  });

  it('載入分片時同時保存並查詢官方 labels（stat 網域標籤）', async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(
          JSON.stringify(shard('zh-TW', { 'fractured.stat_1': 'test' }, { fractured: '破裂' })),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const label = computed(() => getOfficialStatDomainLabel('fractured', 'poe2', 'zh-TW'));
    expect(label.value).toBeNull();
    await vi.waitFor(() => expect(label.value).toBe('破裂'));
  });
});
