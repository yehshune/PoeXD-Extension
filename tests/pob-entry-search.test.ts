import { describe, expect, it } from 'vitest';
import {
  clearSelectionBounds,
  hasEnabledNumericBounds,
  hasRelaxableNumericBounds,
  relaxSelectionBounds,
  resolveEntrySearch,
  type ShoppingStatFilter,
} from '@/utils/pob-entry-search';

describe('pob-entry-search：放寬／清除上下限與 countableFilterCount', () => {
  const sampleFilters: ShoppingStatFilter[] = [
    {
      id: 'explicit.stat_life',
      key: 'explicit.stat_life',
      value: 100,
      enabled: true,
      min: 80,
      customized: false,
    },
    {
      id: 'explicit.stat_neg',
      key: 'explicit.stat_neg',
      value: -20,
      enabled: true,
      max: -16,
      customized: false,
    },
    {
      id: 'enchant.stat_cluster',
      key: 'enchant.stat_cluster',
      value: 8,
      enabled: true,
      min: 8,
      max: 8,
      customized: false,
    },
    {
      id: 'explicit.stat_disabled',
      key: 'explicit.stat_disabled',
      value: 50,
      enabled: false,
      min: 40,
      customized: false,
    },
    {
      id: 'explicit.stat_option',
      key: 'explicit.stat_option',
      option: 3,
      enabled: true,
      customized: false,
    },
  ];

  it('hasEnabledNumericBounds 與 hasRelaxableNumericBounds 正確區分精確鎖定與停用條件', () => {
    expect(hasEnabledNumericBounds(sampleFilters)).toBe(true);
    expect(hasRelaxableNumericBounds(sampleFilters)).toBe(true);

    const exactOnly = sampleFilters.filter((filter) => filter.key === 'enchant.stat_cluster');
    expect(hasEnabledNumericBounds(exactOnly)).toBe(true);
    expect(hasRelaxableNumericBounds(exactOnly)).toBe(false);

    const disabledOnly = sampleFilters.filter((filter) => !filter.enabled);
    expect(hasEnabledNumericBounds(disabledOnly)).toBe(false);
    expect(hasRelaxableNumericBounds(disabledOnly)).toBe(false);
  });

  it('relaxSelectionBounds 將正負上下限放寬 10%，跳過精確鎖定、停用與選項型條件', () => {
    const next = relaxSelectionBounds({}, sampleFilters);
    expect(next.stats).toEqual({
      'explicit.stat_life': { min: 72 },
      'explicit.stat_neg': { max: -14 },
    });
  });

  it('clearSelectionBounds 清除已啟用數值條件的上下限，保留停用與選項型條件', () => {
    const next = clearSelectionBounds({}, sampleFilters);
    expect(next.stats).toEqual({
      'explicit.stat_life': { min: null, max: null },
      'explicit.stat_neg': { min: null, max: null },
      'enchant.stat_cluster': { min: null, max: null },
    });
  });

  it('countableFilterCount：一般裝備排除固定詞綴與附魔，合成臟器保留固定詞綴', () => {
    const mods = [
      {
        text: '+10% implicit',
        kind: 'implicit' as const,
        searched: true,
        stat: { id: 'implicit.stat_1', value: 10, defaultEnabled: true },
      },
      {
        text: '+20% implicit 2',
        kind: 'implicit' as const,
        searched: true,
        stat: { id: 'implicit.stat_2', value: 20, defaultEnabled: true },
      },
      {
        text: '+80 to maximum Life',
        kind: 'explicit' as const,
        searched: true,
        stat: { id: 'explicit.stat_3', value: 80, defaultEnabled: true },
      },
    ];

    const normal = resolveEntrySearch({ searchBase: { type: 'Ring' }, mods });
    expect(normal.countableFilterCount).toBe(1);

    const bundle = resolveEntrySearch({
      searchBase: { filters: { type_filters: { filters: { category: { option: 'viscera' } } } } },
      visceraBundle: true,
      mods,
    });
    expect(bundle.countableFilterCount).toBe(3);
  });

  it('resolveEntrySearch 保留已在地化的詞綴文字，只更新 searched 狀態', () => {
    const resolved = resolveEntrySearch(
      {
        searchBase: { type: 'Ring' },
        mods: [
          {
            text: '+100 最大生命',
            kind: 'explicit',
            searched: true,
            stat: { id: 'explicit.stat_life', value: 100, defaultEnabled: true },
          },
        ],
      },
      { stats: { 'explicit.stat_life': { enabled: false } } },
    );
    expect(resolved.mods).toEqual([
      {
        text: '+100 最大生命',
        kind: 'explicit',
        searched: false,
        stat: { id: 'explicit.stat_life', value: 100, defaultEnabled: true },
      },
    ]);
  });
});
