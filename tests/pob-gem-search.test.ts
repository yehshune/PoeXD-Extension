import { describe, expect, it } from 'vitest';
import { toEntrySearchSelection } from '@/utils/pob-build-store';
import {
  buildEntryQuery,
  cloneEntrySearchSelection,
  effectiveGemFilters,
  isSelectionDraftModified,
  normalizeSelectionForEntry,
  type ShoppingEntry,
} from '@/utils/pob-shopping-list';

const STATUS = { option: 'securable' };

const gem: ShoppingEntry = {
  key: 'gem\u0000Body Armour\u0000Arc\u000021\u000020',
  kind: 'gem',
  label: 'Arc',
  englishName: 'Arc',
  count: 1,
  level: 21,
  quality: 20,
  searchBase: {
    status: STATUS,
    type: 'Arc',
    filters: { misc_filters: { filters: { gem_level: { min: 21 }, quality: { min: 20 } } } },
  },
  query: null,
};

describe('寶石等級／品質條件', () => {
  it('預設帶入 PoB 的等級與品質下限', () => {
    expect(effectiveGemFilters(gem)).toEqual({ level: 21, quality: 20 });
    expect(buildEntryQuery(gem)).toEqual(gem.searchBase);
  });

  it('可以改下限或改成不限', () => {
    expect(buildEntryQuery(gem, { gemLevel: 20, gemQuality: null })).toEqual({
      status: STATUS,
      type: 'Arc',
      filters: { misc_filters: { filters: { gem_level: { min: 20 } } } },
    });
    expect(buildEntryQuery(gem, { gemLevel: null, gemQuality: null })).toEqual({
      status: STATUS,
      type: 'Arc',
    });
    expect(effectiveGemFilters(gem, { gemLevel: null })).toEqual({ quality: 20 });
  });

  it('只保留和 PoB 不同的調整；草稿比較包含寶石條件', () => {
    expect(normalizeSelectionForEntry(gem, { gemLevel: 21, gemQuality: 20 })).toBeUndefined();
    expect(normalizeSelectionForEntry(gem, { gemLevel: 1, gemQuality: 20 })).toEqual({
      gemLevel: 1,
    });
    expect(cloneEntrySearchSelection({ gemLevel: null, gemQuality: 5 })).toEqual({
      gemLevel: null,
      gemQuality: 5,
    });
    expect(
      isSelectionDraftModified(
        { gemLevelMin: 21, gemQualityMin: 20 },
        { gemLevelMin: 20, gemQualityMin: 20 },
      ),
    ).toBe(true);
  });

  it('儲存的寶石條件逐欄驗證', () => {
    expect(toEntrySearchSelection({ gemLevel: 21, gemQuality: null })).toEqual({
      gemLevel: 21,
      gemQuality: null,
    });
    expect(toEntrySearchSelection({ gemLevel: 999, gemQuality: -1 })).toBeUndefined();
    expect(toEntrySearchSelection({ gemLevel: 2.5 })).toBeUndefined();
  });
});
