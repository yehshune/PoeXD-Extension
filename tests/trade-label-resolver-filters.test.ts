import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, computed } from 'vue';
import { resetI18nStateForTests, setActiveDisplayLocale } from '@/utils/i18n';
import {
  preloadTradeLabels,
  resetTradeLabelsForTests,
  translateFilterGroup,
  translateFilterKey,
} from '@/utils/trade-label-resolver';

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
    resetTradeLabelsForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses bundled UI locales synchronously without fetching', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    setActiveDisplayLocale('zh-CN');
    expect(translateFilterGroup('type_filters', 'poe1')).toBe('类型过滤器');
    setActiveDisplayLocale('zh-TW');
    await preloadTradeLabels('poe1');
    expect(translateFilterGroup('type_filters', 'poe1')).toBe('類別過濾');
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

    await preloadTradeLabels('poe1');
    // ko 不存在：退回 UI 語系（ko 對應 UI 語系為 en），且不再請求
    expect(translateFilterGroup('type_filters', 'poe1')).toBe('Type Filters');
    expect(translateFilterKey('misc_filters.ilvl', 'poe1')).toBe('Item Level');
    await preloadTradeLabels('poe1');
    await flush();
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
    setActiveDisplayLocale('ja');
    const label = computed(() => translateFilterGroup('type_filters', 'poe1'));
    expect(label.value).toBe('Type Filters');
    await expect(preloadTradeLabels('poe1')).resolves.toBeUndefined();
  });
});
