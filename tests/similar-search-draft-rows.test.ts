import { describe, expect, it } from 'vitest';
import {
  boundsOf,
  domainChoiceOf,
  statDomainProps,
  tabsOf,
  thresholdFromBound,
} from '@/components/similar-search/draft-rows';
import type { DraftStat, SimilarBatch } from '@/utils/similar-item-search';

const stat = (patch: Partial<DraftStat> = {}): DraftStat => ({
  key: 'explicit.stat_1',
  id: 'explicit.stat_1',
  text: '+10 to Strength',
  value: 10,
  role: 'reference',
  domain: 'any',
  customized: false,
  pseudo: false,
  ...patch,
});

describe('找相似面板的列轉換', () => {
  it('「不限」對應預設代碼的前綴，可縮小的型態照原樣', () => {
    const fractured = stat({ domains: ['any', 'fractured'] });
    expect(statDomainProps(fractured)).toEqual({
      domain: 'explicit',
      domains: ['explicit', 'fractured'],
    });
    expect(statDomainProps({ ...fractured, domain: 'fractured' }).domain).toBe('fractured');
    expect(domainChoiceOf(fractured, 'explicit')).toBe('any');
    expect(domainChoiceOf(fractured, 'fractured')).toBe('fractured');
    expect(domainChoiceOf(fractured, 'crafted')).toBeUndefined();
  });

  it('正數門檻顯示在下限、負數在上限；清空另一欄不改門檻', () => {
    expect(boundsOf(8)).toEqual({ min: 8 });
    expect(boundsOf(-8)).toEqual({ max: -8 });
    expect(boundsOf(undefined)).toEqual({});
    expect(thresholdFromBound(8, 'min', 9)).toBe(9);
    expect(thresholdFromBound(8, 'min', null)).toBeUndefined();
    expect(thresholdFromBound(8, 'max', null)).toBe('unchanged');
    expect(thresholdFromBound(-8, 'max', null)).toBeUndefined();
  });

  it('有批次時第一個分頁是我的搜尋，放寬批次帶序號', () => {
    const batch = (key: string, kind: SimilarBatch['kind']): SimilarBatch => ({
      key,
      kind,
      total: 12,
      inexact: false,
      results: [],
    });
    expect(tabsOf([], 'home')).toEqual([]);
    expect(tabsOf([batch('strict', 'strict'), batch('relaxed-2', 'relaxed')], 'home')).toEqual([
      { key: 'home', kind: 'home' },
      { key: 'strict', kind: 'strict', total: 12, inexact: false },
      { key: 'relaxed-2', kind: 'relaxed', index: 2, total: 12, inexact: false },
    ]);
  });
});
