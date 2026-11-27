import { describe, expect, it } from 'vitest';
import {
  draftKeysOfStatId,
  orderBySimilarity,
  scoreSimilarity,
  setPropertyEnabled,
  setStatRole,
  type DraftProperty,
} from '@/utils/similar-item-search';
import { chestDraft, chestResult, englishStatText } from './helpers/similar-search-fixtures';

const score = (lines: Parameters<typeof chestResult>[1], draft = chestDraft()) =>
  scoreSimilarity(draft, chestResult('x', lines).item, { englishStatText });

describe('scoreSimilarity', () => {
  it('每個參考 stat 取 min(實際 / 目標, 1) 的平均；超過目標不加分', () => {
    const result = score({ life: 150, fire: 45, evasion: 50 });
    // 生命 1、抗性 45/90 = 0.5、閃避 1
    expect(result.similarity).toBeCloseTo((1 + 0.5 + 1) / 3, 5);
    expect(result.marks).toEqual({
      'pseudo.pseudo_total_life': 'met',
      'pseudo.pseudo_total_elemental_resistance': 'missing',
      'explicit.stat_124859000': 'met',
    });
  });

  it('達到門檻但未達原物品數值是「在容忍度內」，完全沒有是「缺少」', () => {
    const result = score({ life: 85 });
    expect(result.marks['pseudo.pseudo_total_life']).toBe('within');
    expect(result.marks['explicit.stat_124859000']).toBe('missing');
    expect(result.actuals['explicit.stat_124859000']).toBe(0);
    expect(result.similarity).toBeCloseTo(0.85 / 3, 5);
  });

  it('必要 stat 不計入 Similarity；啟用的屬性要計入', () => {
    const required = setStatRole(chestDraft(), 'pseudo.pseudo_total_life', 'required');
    const armour: DraftProperty = {
      id: 'ev',
      value: 800,
      enabled: true,
      threshold: 640,
      customized: false,
    };
    const draft = { ...required, properties: [armour] };
    const result = scoreSimilarity(
      draft,
      chestResult('x', { fire: 90, evasion: 50 }, { extended: { ev: 400 } }).item,
      { englishStatText },
    );
    expect(result.marks).not.toHaveProperty('pseudo.pseudo_total_life');
    expect(result.marks.ev).toBe('missing');
    expect(result.similarity).toBeCloseTo((1 + 1 + 0.5) / 3, 5);
    expect(
      scoreSimilarity(setPropertyEnabled(draft, 'ev', false), chestResult('x', {}).item, {
        englishStatText,
      }).marks,
    ).not.toHaveProperty('ev');
  });

  it('沒有參考條件時 Similarity 為 1', () => {
    const draft = { ...chestDraft(), stats: [] };
    expect(scoreSimilarity(draft, chestResult('x', {}).item, { englishStatText }).similarity).toBe(
      1,
    );
  });
});

describe('orderBySimilarity', () => {
  it('偏科的物品（單一 stat 遠超目標、其他缺少）不會排第一', () => {
    const draft = chestDraft();
    const lopsided = chestResult('lopsided', { life: 500 });
    const balanced = chestResult('balanced', { life: 90, fire: 81, evasion: 45 });
    const ordered = orderBySimilarity(draft, [lopsided, balanced], { englishStatText });
    expect(ordered.map((entry) => entry.id)).toEqual(['balanced', 'lopsided']);
    expect(ordered[0].similarity).toBeCloseTo(0.9, 5);
  });

  it('有換算價格時，相似度相同的物品便宜的排前面；無法換算的維持相似度排序', () => {
    const draft = chestDraft();
    const cheap = chestResult('cheap', { life: 100, fire: 90, evasion: 50 });
    const pricey = chestResult('pricey', { life: 100, fire: 90, evasion: 50 });
    const prices: Record<string, number> = { cheap: 1, pricey: 100 };
    const ordered = orderBySimilarity(draft, [pricey, cheap], {
      englishStatText,
      priceInDivine: (entry) => prices[entry.id],
    });
    expect(ordered.map((entry) => entry.id)).toEqual(['cheap', 'pricey']);
    const unpriced = orderBySimilarity(draft, [pricey, cheap], { englishStatText });
    expect(unpriced.map((entry) => entry.id)).toEqual(['pricey', 'cheap']);
  });
});

describe('draftKeysOfStatId', () => {
  it('結果列的詞綴行對到草稿 stat：抗性與生命對 pseudo，破裂詞對 explicit', () => {
    expect(draftKeysOfStatId('explicit.stat_3372524247', englishStatText)).toEqual([
      'pseudo.pseudo_total_elemental_resistance',
    ]);
    expect(draftKeysOfStatId('implicit.stat_3299347043', englishStatText)).toEqual([
      'pseudo.pseudo_total_life',
    ]);
    expect(draftKeysOfStatId('fractured.stat_124859000', englishStatText)).toEqual([
      'explicit.stat_124859000',
    ]);
    expect(draftKeysOfStatId('enchant.stat_1', englishStatText)).toEqual(['enchant.stat_1']);
    expect(draftKeysOfStatId('nonsense', englishStatText)).toEqual([]);
  });
});
