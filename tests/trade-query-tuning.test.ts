import { describe, expect, it } from 'vitest';
import {
  areTradeQueriesEqual,
  cloneTradeQuery,
  isGroupValueEditable,
  isNumericStatFilter,
  resolveTunedTradeSearchUrl,
  setTradeQueryStatus,
  setTradeStatFilterBound,
  setTradeStatFilterDisabled,
  setTradeStatFilterDomain,
  setTradeStatGroupBound,
  setTradeStatGroupDisabled,
  setTradeStatGroupType,
} from '@/utils/trade-query-tuning';

describe('trade-query-tuning', () => {
  const sampleQuery = {
    status: { option: 'securable' },
    type: 'Amber Amulet',
    stats: [
      { type: 'and', filters: [] },
      {
        type: 'count',
        value: { min: 2 },
        filters: [
          { id: 'explicit.stat_life', value: { min: 70 } },
          { id: 'explicit.stat_res', value: { min: 30, weight: 1 } },
          { id: 'enchant.stat_anoint', value: { option: 12345 } },
        ],
      },
    ],
  };

  it('cloneTradeQuery 深拷貝且不共用參考', () => {
    const cloned = cloneTradeQuery(sampleQuery)!;
    expect(cloned).toEqual(sampleQuery);
    expect(cloned).not.toBe(sampleQuery);
    expect(areTradeQueriesEqual(cloned, sampleQuery)).toBe(true);
    expect(cloneTradeQuery(null)).toBeNull();
    expect(cloneTradeQuery([])).toBeNull();
  });

  it('修改上架狀態並保持原物件不變', () => {
    const next = setTradeQueryStatus(sampleQuery, 'available');
    expect((next as any).status).toEqual({ option: 'available' });
    expect((sampleQuery as any).status).toEqual({ option: 'securable' });
    expect(areTradeQueriesEqual(next, sampleQuery)).toBe(false);
  });

  it('對齊可見群組索引（跳過空群組），切換群組與詞綴停用及修改範圍', () => {
    // visibleGroupIndex 0 對應 sampleQuery.stats[1]（因 stats[0] 為空）
    const disabledGroup = setTradeStatGroupDisabled(sampleQuery, 0, true);
    expect((disabledGroup as any).stats[1].disabled).toBe(true);
    expect((disabledGroup as any).stats[0].disabled).toBeUndefined();

    const reEnabledGroup = setTradeStatGroupDisabled(disabledGroup, 0, false);
    expect(areTradeQueriesEqual(reEnabledGroup, sampleQuery)).toBe(true);

    const tunedGroupMin = setTradeStatGroupBound(sampleQuery, 0, 'min', 3);
    expect((tunedGroupMin as any).stats[1].value).toEqual({ min: 3 });

    const disabledFilter = setTradeStatFilterDisabled(sampleQuery, 0, 0, true);
    expect((disabledFilter as any).stats[1].filters[0].disabled).toBe(true);
    expect(
      areTradeQueriesEqual(setTradeStatFilterDisabled(disabledFilter, 0, 0, false), sampleQuery),
    ).toBe(true);

    // 保留 weight 的同時設定上限並清空下限
    const tunedMax = setTradeStatFilterBound(sampleQuery, 0, 1, 'max', 45);
    const clearedMin = setTradeStatFilterBound(tunedMax, 0, 1, 'min', null);
    expect((clearedMin as any).stats[1].filters[1].value).toEqual({ weight: 1, max: 45 });
  });

  it('setTradeStatFilterDomain 換掉網域前綴並保留數值；不在可切換清單的前綴不更動', () => {
    const allowed = ['explicit', 'fractured'];
    const switched = setTradeStatFilterDomain(sampleQuery, 0, 0, 'fractured', allowed);
    expect((switched as any).stats[1].filters[0]).toEqual({
      id: 'fractured.stat_life',
      value: { min: 70 },
    });
    expect((sampleQuery as any).stats[1].filters[0].id).toBe('explicit.stat_life');
    expect(
      areTradeQueriesEqual(
        setTradeStatFilterDomain(switched, 0, 0, 'explicit', allowed),
        sampleQuery,
      ),
    ).toBe(true);
    expect(
      areTradeQueriesEqual(
        setTradeStatFilterDomain(sampleQuery, 0, 0, 'crafted', allowed),
        sampleQuery,
      ),
    ).toBe(true);
  });

  it('setTradeStatGroupType 換群組類別：無數值類別清掉數值，計數沒有下限時補 1，不認得的類別不更動', () => {
    const toAnd = setTradeStatGroupType(sampleQuery, 0, 'and');
    expect((toAnd as any).stats[1]).toMatchObject({ type: 'and' });
    expect((toAnd as any).stats[1].value).toBeUndefined();
    expect((setTradeStatGroupType(toAnd, 0, 'count') as any).stats[1].value).toEqual({ min: 1 });
    expect((setTradeStatGroupType(sampleQuery, 0, 'weight') as any).stats[1]).toMatchObject({
      type: 'weight',
      value: { min: 2 },
    });
    expect(areTradeQueriesEqual(setTradeStatGroupType(sampleQuery, 0, 'bogus'), sampleQuery)).toBe(
      true,
    );
    expect(sampleQuery.stats[1].type).toBe('count');
  });

  it('支援外層包著 { query, sort } 的 payload', () => {
    const wrapped = { query: sampleQuery, sort: { price: 'asc' } };
    const next = setTradeStatFilterBound(wrapped, 0, 0, 'min', 90);
    expect((next as any).query.stats[1].filters[0].value).toEqual({ min: 90 });
    expect((next as any).sort).toEqual({ price: 'asc' });
  });

  it('判斷群組與詞綴是否支援數值編輯', () => {
    expect(isGroupValueEditable('count')).toBe(true);
    expect(isGroupValueEditable('weight')).toBe(true);
    expect(isGroupValueEditable('weight2')).toBe(true);
    expect(isGroupValueEditable('and')).toBe(false);

    expect(isNumericStatFilter({ value: { min: 10 } })).toBe(true);
    expect(isNumericStatFilter({ value: { option: 123 } })).toBe(false);
    expect(isNumericStatFilter({})).toBe(true);
  });

  it('resolveTunedTradeSearchUrl 在無修改時保留原網址，有修改時覆寫 gzip 搜尋碼', async () => {
    const baseUrl = 'https://www.pathofexile.com/trade/search/Standard/H4sIAAAAAAAACqtWykxRsjI0AAA';
    expect(await resolveTunedTradeSearchUrl(baseUrl, null)).toBe(baseUrl);

    const tunedUrl = await resolveTunedTradeSearchUrl(baseUrl, { status: { option: 'online' } });
    expect(tunedUrl).not.toBeNull();
    expect(tunedUrl).not.toBe(baseUrl);
    expect(tunedUrl).toContain('https://www.pathofexile.com/trade/search/Standard/');
  });
});
