import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, computed } from 'vue';
import {
  ensureTradeFiltersLoaded,
  getTradeFiltersSources,
  resetTradeFiltersForTests,
} from '@/utils/trade-filters-store';
import { translateFilterGroup, translateFilterKey } from '@/utils/trade-stat-dictionary';
import { resetI18nStateForTests, setActiveDisplayLocale } from '@/utils/i18n';

const JA_POE1 = {
  groups: { type_filters: '種類フィルター' },
  fields: { price: 'バイアウト価格' },
  options: {},
};

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  await nextTick();
};

describe('trade filters store (per display locale)', () => {
  beforeEach(() => {
    resetI18nStateForTests('zh-TW');
    resetTradeFiltersForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses bundled UI locales synchronously without fetching', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    setActiveDisplayLocale('zh-CN');
    expect(translateFilterGroup('type_filters', 'poe1')).toBe('类型过滤器');
    expect(await ensureTradeFiltersLoaded('poe1', 'zh-TW')).not.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('lazy-loads a non-UI display locale and re-renders reactive readers', async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain('json/poe1/locales/ja/trade-filters.json');
      return new Response(JSON.stringify(JA_POE1), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);
    setActiveDisplayLocale('ja');

    const label = computed(() => translateFilterGroup('type_filters', 'poe1'));
    // 尚未載入：退回 UI 語系（ja 對應 UI 語系為 en）
    expect(label.value).toBe('Type Filters');
    await vi.waitFor(() => expect(label.value).toBe('種類フィルター'));
    expect(translateFilterKey('trade_filters.price', 'poe1')).toBe('バイアウト価格');
    // 缺少的欄位退回 en
    expect(translateFilterKey('misc_filters.ilvl', 'poe1')).toBe('Item Level');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back without refetching when a locale file is unavailable', async () => {
    const fetchSpy = vi.fn(async () => new Response('', { status: 404 }));
    vi.stubGlobal('fetch', fetchSpy);
    setActiveDisplayLocale('ko');

    expect(await ensureTradeFiltersLoaded('poe1', 'ko')).toBeNull();
    expect(translateFilterGroup('type_filters', 'poe1')).toBe('Type Filters');
    getTradeFiltersSources('poe1');
    await flush();
    await new Promise((done) => setTimeout(done, 0));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
