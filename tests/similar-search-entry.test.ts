import { describe, expect, it, vi } from 'vitest';
import {
  canFindSimilar,
  findSimilar,
  provideSimilarSearchEntry,
} from '@/utils/similar-search-entry';
import { chestResult } from './helpers/similar-search-fixtures';

const anchor = {} as Element;

describe('側邊欄的找相似入口', () => {
  it('市集頁登記後，適用的物品可以從側邊欄開啟同一個面板', () => {
    const open = vi.fn();
    const stop = provideSimilarSearchEntry({ version: 'poe1', open });
    const { item } = chestResult('pinned', { life: 100 });

    expect(canFindSimilar(item)).toBe(true);
    expect(findSimilar(item, anchor, 'poe1')).toBe(true);
    expect(open).toHaveBeenCalledWith(item, anchor);
    stop();
    expect(canFindSimilar(item)).toBe(false);
  });

  it('不適用的物品、其他遊戲版本或沒有登記時不開啟', () => {
    const open = vi.fn();
    const { item } = chestResult('pinned', { life: 100 });
    expect(findSimilar(item, anchor)).toBe(false);

    const stop = provideSimilarSearchEntry({ version: 'poe1', open });
    expect(findSimilar({ ...item, rarity: 'Unique' }, anchor)).toBe(false);
    expect(findSimilar(item, anchor, 'poe2')).toBe(false);
    expect(open).not.toHaveBeenCalled();
    stop();
  });

  it('只有目前登記的入口能撤銷自己', () => {
    const first = provideSimilarSearchEntry({ version: 'poe1', open: vi.fn() });
    const second = provideSimilarSearchEntry({ version: 'poe1', open: vi.fn() });
    first();
    expect(canFindSimilar(chestResult('x', { life: 100 }).item)).toBe(true);
    second();
    expect(canFindSimilar(chestResult('x', { life: 100 }).item)).toBe(false);
  });
});
