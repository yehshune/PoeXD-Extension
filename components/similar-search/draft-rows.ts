/**
 * 找相似面板（ADR-0020）把草稿的一列轉成共用預覽列（PreviewStatRow）的 props，事件再轉回草稿調整。
 */
import type { DraftStat, StatDomainChoice, SimilarBatch } from '@/utils/similar-item-search';
import type {
  PreviewStatBound,
  PreviewStatBounds,
} from '@/components/sidebar/item-preview/PreviewStatRow.vue';

const prefixOf = (key: string): string => key.slice(0, key.indexOf('.'));

/** 共用列用網域前綴；「不限」顯示成預設搜尋代碼的前綴 */
export function statDomainProps(stat: DraftStat): { domain: string; domains: string[] } {
  const base = prefixOf(stat.key);
  const toPrefix = (choice: StatDomainChoice): string => (choice === 'any' ? base : choice);
  return {
    domain: toPrefix(stat.domain),
    domains: (stat.domains ?? []).map(toPrefix),
  };
}

export function domainChoiceOf(stat: DraftStat, prefix: string): StatDomainChoice | undefined {
  if (prefix === prefixOf(stat.key)) return 'any';
  return (stat.domains ?? []).find((choice) => choice === prefix);
}

/** 正數門檻是下限、負數是上限 */
export function boundsOf(threshold: number | undefined): PreviewStatBounds {
  if (threshold === undefined) return {};
  return threshold < 0 ? { max: threshold } : { min: threshold };
}

/** 使用者在下限或上限欄輸入的值換回門檻；清空另一欄不影響目前的門檻 */
export function thresholdFromBound(
  current: number | undefined,
  bound: PreviewStatBound,
  value: number | null,
): number | undefined | 'unchanged' {
  if (value !== null) return value;
  const owner: PreviewStatBound | undefined =
    current === undefined ? undefined : current < 0 ? 'max' : 'min';
  return owner === bound ? undefined : 'unchanged';
}

export interface SimilarTabView {
  key: string;
  kind: 'home' | SimilarBatch['kind'];
  index?: number;
  total?: number;
  inexact?: boolean;
}

export function tabsOf(batches: readonly SimilarBatch[], homeKey: string): SimilarTabView[] {
  if (batches.length === 0) return [];
  return [
    { key: homeKey, kind: 'home' },
    ...batches.map((batch) => ({
      key: batch.key,
      kind: batch.kind,
      ...(batch.kind === 'relaxed' ? { index: Number(batch.key.split('-')[1]) } : {}),
      total: batch.total,
      inexact: batch.inexact,
    })),
  ];
}
