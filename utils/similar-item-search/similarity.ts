/**
 * Similarity（相似度，ADR-0020 Decision 7）：在 PoeXD 本地計算，不用官方加權總和。
 * 每個參考 stat 與啟用的屬性取 `min(實際 / 目標, 1)`，再取平均；超過目標不加分、缺少就扣分。
 * 目標是 Source Item 的數值；必要 stat 每筆結果都符合，不計入。
 */
import { deriveArmourProperties, deriveWeaponProperties } from './properties';
import { deriveDraftStats } from './stats';
import type { DraftProperty, DraftStat, SimilarSearchDraft } from './types';

/** 達到原物品數值、達到門檻（容忍度）、沒達到 */
export type SimilarityMark = 'met' | 'within' | 'missing';

export interface SimilarityScore {
  similarity: number;
  /** 參考 stat 的鍵或屬性代碼 → 標記 */
  marks: Record<string, SimilarityMark>;
  actuals: Record<string, number>;
}

export interface SimilarityOptions {
  englishStatText: (statId: string) => string | undefined;
}

export interface ScoredResult<T> {
  id: string;
  entry: T;
  similarity: number;
  marks: Record<string, SimilarityMark>;
}

/** 價格分數的權重：Similarity 減去這個係數 × log10(神聖石價格) */
const PRICE_FACTOR = 0.1;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

interface Target {
  key: string;
  value: number;
  threshold?: number;
}

function ratioOf(actual: number, target: number): number {
  if (target === 0) return 1;
  return Math.max(0, Math.min(actual / target, 1));
}

function markOf(actual: number, target: Target): SimilarityMark {
  if (ratioOf(actual, target.value) >= 1) return 'met';
  const threshold = target.threshold;
  if (threshold !== undefined && threshold !== 0 && actual / threshold >= 1) return 'within';
  return 'missing';
}

function statActuals(
  draft: SimilarSearchDraft,
  item: Record<string, unknown>,
  options: SimilarityOptions,
) {
  const stats = deriveDraftStats(item, {
    version: draft.version,
    tolerance: draft.tolerance,
    englishStatText: options.englishStatText,
  });
  return new Map(stats.map((stat) => [stat.key, stat.value]));
}

function propertyActuals(draft: SimilarSearchDraft, item: Record<string, unknown>) {
  const properties = draft.weaponMode
    ? deriveWeaponProperties(item, draft.tolerance).properties
    : deriveArmourProperties(item, draft.tolerance);
  return new Map(properties.map((property) => [property.id as string, property.value]));
}

const toTarget = (entry: DraftStat | DraftProperty, key: string): Target => ({
  key,
  value: entry.value,
  ...(entry.threshold !== undefined ? { threshold: entry.threshold } : {}),
});

export function scoreSimilarity(
  draft: SimilarSearchDraft,
  item: unknown,
  options: SimilarityOptions,
): SimilarityScore {
  const source = isRecord(item) ? item : {};
  const stats = statActuals(draft, source, options);
  const properties = propertyActuals(draft, source);
  const targets: [Target, number][] = [
    ...draft.stats
      .filter((stat) => stat.role === 'reference')
      .map((stat): [Target, number] => [toTarget(stat, stat.key), stats.get(stat.key) ?? 0]),
    ...draft.properties
      .filter((property) => property.enabled)
      .map((property): [Target, number] => [
        toTarget(property, property.id),
        properties.get(property.id) ?? 0,
      ]),
  ];
  if (targets.length === 0) return { similarity: 1, marks: {}, actuals: {} };
  const ratios = targets.map(([target, actual]) => ratioOf(actual, target.value));
  return {
    similarity: ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length,
    marks: Object.fromEntries(
      targets.map(([target, actual]) => [target.key, markOf(actual, target)]),
    ),
    actuals: Object.fromEntries(targets.map(([target, actual]) => [target.key, actual])),
  };
}

const priceScore = (price: number | undefined): number =>
  price !== undefined && Number.isFinite(price) && price > 0 ? PRICE_FACTOR * Math.log10(price) : 0;

/**
 * 依 Similarity 由高到低排序 `/fetch` 結果（`{ id, item }`），同分時維持原本順序。
 * 有 `priceInDivine` 時改用 Similarity − 0.1 × log10(價格) 排序；換算不出價格的結果不扣分。
 */
export function orderBySimilarity<T extends { id: string; item?: unknown }>(
  draft: SimilarSearchDraft,
  entries: readonly T[],
  options: SimilarityOptions & { priceInDivine?: (entry: T) => number | undefined },
): ScoredResult<T>[] {
  return entries
    .map((entry, index) => {
      const { similarity, marks } = scoreSimilarity(draft, entry.item, options);
      const rank = similarity - priceScore(options.priceInDivine?.(entry));
      return { scored: { id: entry.id, entry, similarity, marks }, rank, index };
    })
    .sort((left, right) => right.rank - left.rank || left.index - right.index)
    .map(({ scored }) => scored);
}
