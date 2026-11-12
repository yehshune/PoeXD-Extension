import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed } from 'vue';
import {
  ensureOfficialStatTextLoaded,
  getOfficialStatLabel,
  resetOfficialStatTextForTests,
  setMockOfficialStatText,
} from '@/utils/official-stat-text';

const shard = (locale: string, stats: Record<string, string | string[]>) => ({
  schemaVersion: 1,
  gameVersion: 'poe2',
  locale,
  source: 'test',
  labels: {},
  stats,
  options: {},
});

describe('official stat text (官方市集詞綴文字)', () => {
  beforeEach(() => {
    resetOfficialStatTextForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('依詞綴代碼回傳該語系市集的寫法，正負向跟官方一致', () => {
    setMockOfficialStatText('poe2', 'zh-TW', {
      'explicit.stat_3639275092': '增加#%能力值需求',
      'explicit.stat_2160282525': '減少#%你身上的冰凍持續時間',
    });
    expect(getOfficialStatLabel('explicit.stat_3639275092', 'poe2', 'zh-TW')).toBe(
      '增加#%能力值需求',
    );
    expect(getOfficialStatLabel('explicit.stat_2160282525', 'poe2', 'zh-TW')).toBe(
      '減少#%你身上的冰凍持續時間',
    );
  });

  it('英文跟詞綴字典一致：轉小寫並去掉開頭的 +', () => {
    setMockOfficialStatText('poe1', 'en', {
      'explicit.stat_3299347043': '+# to maximum Life',
      'explicit.stat_474294393': '#% reduced Mana Cost of Skills',
    });
    expect(getOfficialStatLabel('explicit.stat_3299347043', 'poe1', 'en')).toBe(
      '# to maximum life',
    );
    expect(getOfficialStatLabel('explicit.stat_474294393', 'poe1', 'en')).toBe(
      '#% reduced mana cost of skills',
    );
  });

  it('同一代碼有多種寫法時取第一個', () => {
    setMockOfficialStatText('poe1', 'zh-TW', {
      'explicit.stat_1': ['區域內有 #% 機率', '地圖內有 #% 機率'],
    });
    expect(getOfficialStatLabel('explicit.stat_1', 'poe1', 'zh-TW')).toBe('區域內有 #% 機率');
  });

  it('其他類別查不到時退回 explicit 同一個 stat', () => {
    setMockOfficialStatText('poe2', 'zh-TW', { 'explicit.stat_9': '增加#%護甲值' });
    expect(getOfficialStatLabel('fractured.stat_9', 'poe2', 'zh-TW')).toBe('增加#%護甲值');
  });

  it('中文市集回傳的仍是英文原文時視為沒有翻譯', () => {
    setMockOfficialStatText('poe2', 'en', { 'explicit.stat_5': '#% increased Spirit' });
    setMockOfficialStatText('poe2', 'zh-TW', { 'explicit.stat_5': '#% increased Spirit' });
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
    expect(await ensureOfficialStatTextLoaded('poe1', 'zh-TW')).toBe(false);
    expect(await ensureOfficialStatTextLoaded('poe1', 'zh-TW')).toBe(false);
    expect(getOfficialStatLabel('explicit.stat_1', 'poe1', 'zh-TW')).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
