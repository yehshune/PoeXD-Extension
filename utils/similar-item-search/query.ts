/**
 * Similar Search Draft → 官方 `/search` 請求（ADR-0020 Decision 4）。
 * - `stats[0]`：參考 stat 的加權群組，權重 1/門檻，依 `statgroup.0` 由高到低排序。
 *   加權群組裡的 `min` 不會篩掉物品、`max` 會，所以單一 stat 的門檻一律放在 `and` 群組。
 * - `stats[1]`：必要 stat 的 `and` 群組；嚴格搜尋另外要求每個參考 stat 達到門檻。
 * - 武器與防具屬性是篩選下限；物品等級、插槽、連線、汙染、勢力與鏡像不帶入。
 */
import type {
  DraftProperty,
  DraftStat,
  SimilarSearchDraft,
  SimilarSearchQuery,
  SimilarSearchQueryOptions,
} from './types';

/** 官方查詢複雜度上限與各部分的成本（沿用 Path of Building 的估算） */
const COMPLEXITY = {
  limit: 200,
  base: 4,
  weightGroup: 54,
  andGroup: 4,
  stat: 4,
  filter: 3,
} as const;
const WEIGHT_DIGITS = 6;
const NON_UNIQUE = 'nonunique';
const PROPERTY_SECTION = {
  poe1: { weapon: 'weapon_filters', armour: 'armour_filters' },
  poe2: { weapon: 'equipment_filters', armour: 'equipment_filters' },
} as const;
const ARMOUR_PROPERTIES = new Set(['ar', 'ev', 'es', 'ward']);

type Bound = { min: number } | { max: number } | Record<string, never>;

const boundOf = (threshold: number | undefined): Bound =>
  threshold === undefined ? {} : threshold < 0 ? { max: threshold } : { min: threshold };

const targetOf = (stat: DraftStat): number => {
  const target = stat.threshold !== undefined && stat.threshold !== 0 ? stat.threshold : stat.value;
  return target === 0 ? 1 : target;
};

const weightOf = (stat: DraftStat): number => {
  const factor = 10 ** WEIGHT_DIGITS;
  return Math.round(factor / targetOf(stat)) / factor;
};

/** 越不重要越先捨棄：階級數字越大越不重要，沒有階級的排最後，同階級時後出現的先捨棄 */
function dropOrder(stats: readonly DraftStat[]): DraftStat[] {
  return stats
    .map((stat, index) => ({ stat, index }))
    .sort(
      (left, right) =>
        (right.stat.tier ?? Infinity) - (left.stat.tier ?? Infinity) || right.index - left.index,
    )
    .map(({ stat }) => stat);
}

function complexityOf(
  reference: number,
  required: number,
  properties: number,
  strict: boolean,
): number {
  const andStats = required + (strict ? reference : 0);
  return (
    COMPLEXITY.base +
    properties * COMPLEXITY.filter +
    (reference > 0 ? COMPLEXITY.weightGroup + reference * COMPLEXITY.stat : 0) +
    (andStats > 0 ? COMPLEXITY.andGroup + andStats * COMPLEXITY.stat : 0)
  );
}

/** 依複雜度上限挑出要帶入的參考 stat，回傳保留與捨棄的部分 */
function fitReferenceStats(
  reference: readonly DraftStat[],
  required: number,
  properties: number,
  strict: boolean,
): { kept: DraftStat[]; dropped: DraftStat[] } {
  const order = dropOrder(reference);
  const dropped: DraftStat[] = [];
  while (
    dropped.length < order.length &&
    complexityOf(reference.length - dropped.length, required, properties, strict) > COMPLEXITY.limit
  ) {
    dropped.push(order[dropped.length]);
  }
  return { kept: reference.filter((stat) => !dropped.includes(stat)), dropped };
}

function propertyFilters(draft: SimilarSearchDraft, properties: readonly DraftProperty[]) {
  const sections = PROPERTY_SECTION[draft.version];
  return properties.reduce<Record<string, { filters: Record<string, Bound> }>>((acc, property) => {
    const section = ARMOUR_PROPERTIES.has(property.id) ? sections.armour : sections.weapon;
    const filters = { ...acc[section]?.filters, [property.id]: boundOf(property.threshold) };
    return { ...acc, [section]: { filters } };
  }, {});
}

function typeFilters(draft: SimilarSearchDraft) {
  return {
    type_filters: {
      filters: {
        ...(draft.scope === 'category' ? { category: { option: draft.category } } : {}),
        rarity: { option: NON_UNIQUE },
      },
    },
  };
}

function statGroups(
  kept: readonly DraftStat[],
  required: readonly DraftStat[],
  options: SimilarSearchQueryOptions,
) {
  const strict = options.phase === 'strict';
  const weightGroup =
    kept.length > 0
      ? [
          {
            type: 'weight',
            filters: kept.map((stat) => ({ id: stat.id, value: { weight: weightOf(stat) } })),
            ...(!strict && options.weightMin !== undefined
              ? { value: { min: options.weightMin } }
              : {}),
          },
        ]
      : [];
  const andStats = [...required, ...(strict ? kept : [])];
  const andGroup =
    andStats.length > 0
      ? [
          {
            type: 'and',
            filters: andStats.map((stat) => ({ id: stat.id, value: boundOf(stat.threshold) })),
          },
        ]
      : [];
  return [...weightGroup, ...andGroup];
}

export function buildSimilarSearchQuery(
  draft: SimilarSearchDraft,
  options: SimilarSearchQueryOptions,
): SimilarSearchQuery {
  const required = draft.stats.filter((stat) => stat.role === 'required');
  const reference = draft.stats.filter((stat) => stat.role === 'reference');
  const properties = draft.properties.filter((property) => property.enabled);
  const { kept, dropped } = fitReferenceStats(
    reference,
    required.length,
    properties.length,
    options.phase === 'strict',
  );
  const stats = statGroups(kept, required, options);
  const query = {
    status: { option: draft.status },
    ...(draft.scope === 'base' && draft.baseType ? { type: draft.baseType } : {}),
    stats: stats.length > 0 ? stats : [{ type: 'and', filters: [] }],
    filters: { ...typeFilters(draft), ...propertyFilters(draft, properties) },
  };
  return {
    body: { query, sort: kept.length > 0 ? { 'statgroup.0': 'desc' } : { price: 'asc' } },
    dropped: dropped.map((stat) => stat.key),
  };
}
