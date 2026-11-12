// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { isReactive, ref } from 'vue';
import { getKnownStatsRef, setKnownStats } from '@/utils/known-stats-store';
import { useFilterData } from '@/components/sidebar/composables/useFilterData';

describe('known stats 記憶體 store', () => {
  it('側欄直接讀內容腳本收到的 known stats，不轉成深層 reactive', () => {
    const stats = {
      'explicit.stat_1': { id: 'explicit.stat_1', text: '+# Life', type: 'explicit' },
    };
    setKnownStats(stats);
    const { knownStats } = useFilterData('poe2', ref('weapon'));
    expect(knownStats.value).toBe(stats);
    expect(isReactive(knownStats.value)).toBe(false);
    expect(getKnownStatsRef().value['explicit.stat_1'].text).toBe('+# Life');
  });
});
