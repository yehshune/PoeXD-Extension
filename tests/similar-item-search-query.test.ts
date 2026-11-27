import { describe, expect, it } from 'vitest';
import poe1Stats from '@/public/json/poe1/locales/en/trade-stats.json';
import poe2Stats from '@/public/json/poe2/locales/en/trade-stats.json';
import poe1Chest from './fixtures/similar-item-search/poe1-chest.json';
import poe1Weapon from './fixtures/similar-item-search/poe1-weapon.json';
import poe2Weapon from './fixtures/similar-item-search/poe2-weapon.json';
import {
  buildSimilarSearchQuery,
  createSimilarSearchDraft,
  setPropertyEnabled,
  setScope,
  setStatRole,
  setStatThreshold,
  type DraftStat,
  type SimilarSearchDraft,
} from '@/utils/similar-item-search';
import type { PoeVersion } from '@/utils/trade-context';

const statsOf = { poe1: poe1Stats.stats, poe2: poe2Stats.stats } as const;

/** 同一個代碼有多種寫法時，市集資料是陣列；取第一種 */
function englishStatTextOf(version: PoeVersion) {
  const stats = statsOf[version] as Record<string, string | string[]>;
  return (statId: string): string | undefined => {
    const text = stats[statId];
    return Array.isArray(text) ? text[0] : text;
  };
}

function draftOf(item: Record<string, unknown>, version: PoeVersion): SimilarSearchDraft {
  const draft = createSimilarSearchDraft(item, {
    version,
    englishStatText: englishStatTextOf(version),
  });
  if (!draft) throw new Error('no draft');
  return draft;
}

type Query = {
  status: { option: string };
  type?: string;
  stats: {
    type: string;
    filters: { id: string; value: Record<string, number> }[];
    value?: Record<string, number>;
  }[];
  filters: Record<string, { filters: Record<string, unknown> }>;
};
const queryOf = (body: Record<string, unknown>) => body.query as Query;

describe('buildSimilarSearchQuery', () => {
  it('嚴格搜尋：參考 stat 進加權群組（權重 1/門檻、依加權排序），同時在 and 群組要求門檻', () => {
    const draft = draftOf(poe2Weapon, 'poe2');
    const { body, dropped } = buildSimilarSearchQuery(draft, { phase: 'strict' });
    expect(dropped).toEqual([]);
    expect(body.sort).toEqual({ 'statgroup.0': 'desc' });
    const query = queryOf(body);
    expect(query.status).toEqual({ option: 'securable' });
    expect(query.stats[0]).toEqual({
      type: 'weight',
      filters: [
        { id: 'explicit.stat_518292764', value: { weight: 0.27027 } },
        { id: 'pseudo.pseudo_total_strength', value: { weight: 0.041667 } },
        { id: 'explicit.stat_748522257', value: { weight: 0.0625 } },
      ],
    });
    expect(query.stats[1]).toEqual({
      type: 'and',
      filters: [
        { id: 'explicit.stat_518292764', value: { min: 3.7 } },
        { id: 'pseudo.pseudo_total_strength', value: { min: 24 } },
        { id: 'explicit.stat_748522257', value: { min: 16 } },
      ],
    });
  });

  it('放寬搜尋：只留必要 stat 的門檻，加權群組用指定的總和下限', () => {
    const draft = setStatRole(draftOf(poe2Weapon, 'poe2'), 'explicit.stat_3336890334', 'required');
    const { body } = buildSimilarSearchQuery(draft, { phase: 'relaxed', weightMin: 2.5 });
    const query = queryOf(body);
    expect(query.stats[0]).toMatchObject({ type: 'weight', value: { min: 2.5 } });
    expect(query.stats[1]).toEqual({
      type: 'and',
      filters: [{ id: 'explicit.stat_3336890334', value: { min: 11 } }],
    });
  });

  it('沒有參考 stat 時不放加權群組、依價格排序；沒設門檻的必要 stat 只要求存在', () => {
    let draft = draftOf(poe1Chest, 'poe1');
    draft = setStatRole(draft, 'pseudo.pseudo_total_life', 'required');
    draft = setStatThreshold(draft, 'pseudo.pseudo_total_life', undefined);
    const { body } = buildSimilarSearchQuery(draft, { phase: 'strict' });
    expect(body.sort).toEqual({ price: 'asc' });
    expect(queryOf(body).stats).toEqual([
      { type: 'and', filters: [{ id: 'pseudo.pseudo_total_life', value: {} }] },
    ]);
  });

  it('負數門檻是上限', () => {
    const draft = draftOf(poe1Chest, 'poe1');
    const negative = {
      ...draft,
      stats: draft.stats.map((stat) =>
        stat.key === 'pseudo.pseudo_total_chaos_resistance'
          ? { ...stat, value: -17, threshold: -13, role: 'required' as const }
          : stat,
      ),
    };
    const { body } = buildSimilarSearchQuery(negative, { phase: 'relaxed' });
    expect(queryOf(body).stats).toContainEqual({
      type: 'and',
      filters: [{ id: 'pseudo.pseudo_total_chaos_resistance', value: { max: -13 } }],
    });
  });

  it('類別與稀有度、開啟的武器屬性當篩選；不帶物品等級、插槽、連線、汙染等條件', () => {
    const draft = setPropertyEnabled(draftOf(poe1Weapon, 'poe1'), 'crit', true);
    const query = queryOf(buildSimilarSearchQuery(draft, { phase: 'strict' }).body);
    expect(Object.keys(query.filters).sort()).toEqual(['type_filters', 'weapon_filters']);
    expect(query.filters.type_filters.filters).toEqual({
      category: { option: 'weapon.onesword' },
      rarity: { option: 'nonunique' },
    });
    expect(query.filters.weapon_filters.filters).toEqual({
      pdps: { min: 176 },
      crit: { min: 4.4 },
    });
    expect(query.type).toBeUndefined();
  });

  it('PoE 2 的武器與防具屬性放在 equipment_filters；同基底時改用基底名稱', () => {
    const draft = setScope(draftOf(poe2Weapon, 'poe2'), 'base');
    const query = queryOf(buildSimilarSearchQuery(draft, { phase: 'strict' }).body);
    expect(query.type).toBe('Marauding Mace');
    expect(query.filters.type_filters.filters).toEqual({ rarity: { option: 'nonunique' } });
    expect(query.filters.equipment_filters.filters).toEqual({ pdps: { min: 93 } });
  });

  it('超過複雜度上限 200 時，從階級最差的參考 stat 開始捨棄並回報', () => {
    const base = draftOf(poe1Weapon, 'poe1');
    const stats: DraftStat[] = Array.from({ length: 20 }, (_, index) => ({
      key: `explicit.stat_${index + 1}`,
      id: `explicit.stat_${index + 1}`,
      text: `line ${index + 1}`,
      value: 10,
      tier: index + 1,
      role: 'reference',
      domain: 'any',
      threshold: 8,
      customized: false,
      pseudo: false,
    }));
    const draft = { ...base, stats };
    const strict = buildSimilarSearchQuery(draft, { phase: 'strict' });
    expect(strict.dropped).toEqual([
      'explicit.stat_20',
      'explicit.stat_19',
      'explicit.stat_18',
      'explicit.stat_17',
    ]);
    expect(queryOf(strict.body).stats[0].filters).toHaveLength(16);
    expect(buildSimilarSearchQuery(draft, { phase: 'relaxed' }).dropped).toEqual([]);
  });
});
