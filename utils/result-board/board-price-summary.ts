/**
 * 看板頂端的價格摘要：已取得結果中的最低價與中位數（僅能換算的服）。
 */
import type { CurrencyRateSnapshot } from '@/utils/price-comparison';
import type { BoardEntry } from './board-entry';
import { convertPrice } from './board-price';

export interface PriceSummary {
  /** 匯率快照的主通貨 */
  currency: string;
  min: number;
  median: number;
  /** 參與計算（能換算）的件數 */
  count: number;
}

export function summarizePrices(
  entries: readonly BoardEntry[],
  rates: CurrencyRateSnapshot | undefined,
): PriceSummary | undefined {
  if (!rates) return undefined;
  const values = entries
    .map((entry) => convertPrice(entry.price, rates))
    .filter((value): value is number => value !== undefined)
    .sort((a, b) => a - b);
  if (values.length === 0) return undefined;
  const middle = Math.floor(values.length / 2);
  const median =
    values.length % 2 === 1 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
  return { currency: rates.primary, min: values[0], median, count: values.length };
}
