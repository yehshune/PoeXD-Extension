/**
 * 看板的價格換算與加總。
 *
 * 有匯率（國際服的 poe.ninja）時換成主通貨加總；沒有匯率時依幣種分開加總，不需要匯率。
 * 照官方標價直接加總，不做單價 × 數量。
 */
import type { CurrencyRateSnapshot } from '@/utils/price-comparison';
import type { BoardPrice } from './board-entry';

export type PriceTotal =
  | {
      kind: 'converted';
      /** 匯率快照的主通貨 */
      currency: string;
      amount: number;
      /** 沒有標價或無法換算、未計入的件數 */
      unconverted: number;
    }
  | {
      kind: 'per-currency';
      /** 依首次出現的順序 */
      totals: readonly BoardPrice[];
      /** 沒有標價、未計入的件數 */
      unpriced: number;
    };

/** 去掉浮點誤差（例如 0.1 + 0.2） */
const roundAmount = (value: number): number => Math.round(value * 1e6) / 1e6;

/** 換算成匯率快照的主通貨；無法換算時為 undefined */
export function convertPrice(
  price: BoardPrice | undefined,
  rates: CurrencyRateSnapshot | undefined,
): number | undefined {
  if (!price || !rates) return undefined;
  // 通貨名稱來自不可信輸入：只讀自有屬性，避免 `constructor` 等原型屬性
  if (!Object.hasOwn(rates.rates, price.currency)) return undefined;
  const rate = rates.rates[price.currency];
  if (!Number.isFinite(rate) || rate <= 0) return undefined;
  const value = price.amount * rate;
  return Number.isFinite(value) ? value : undefined;
}

export function sumPrices(
  prices: readonly (BoardPrice | undefined)[],
  rates: CurrencyRateSnapshot | undefined,
): PriceTotal {
  if (rates) {
    const converted = prices.map((price) => convertPrice(price, rates));
    const known = converted.filter((value): value is number => value !== undefined);
    return {
      kind: 'converted',
      currency: rates.primary,
      amount: roundAmount(known.reduce((sum, value) => sum + value, 0)),
      unconverted: converted.length - known.length,
    };
  }

  const totals = new Map<string, number>();
  let unpriced = 0;
  for (const price of prices) {
    if (!price) {
      unpriced += 1;
      continue;
    }
    totals.set(price.currency, (totals.get(price.currency) ?? 0) + price.amount);
  }
  return {
    kind: 'per-currency',
    totals: Array.from(totals, ([currency, amount]) => ({ currency, amount: roundAmount(amount) })),
    unpriced,
  };
}
