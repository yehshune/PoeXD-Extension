/**
 * 看板列的顯示文字：名稱顏色、上架時間、價格、總價與「載入停止」提示。
 */
import { getActiveUiLocale, t, type I18nKey } from '@/utils/i18n';
import type { BoardEntry, BoardPrice } from '@/utils/result-board/board-entry';
import type { LoadStopReason } from '@/utils/result-board/board-loader';
import { PRICE_COMPARISON_CURRENCIES, formatConvertedAmount } from '@/utils/price-comparison';
import type { PriceTotal } from '@/utils/result-board/board-projection';
import type { CurrencyDisplay } from '@/utils/result-board/board-session';
import { RARITY_COLOURS, resolveRarityClass } from '../pinned-items/pinned-item-card';

export function rarityColour(entry: BoardEntry): string {
  return (
    RARITY_COLOURS[resolveRarityClass({ frameType: entry.frameType })] ?? RARITY_COLOURS.normal!
  );
}

/** 名稱與基底（傳奇與稀有物品有名稱；其餘只有基底） */
export function entryTitle(entry: BoardEntry): string {
  return [entry.name, entry.typeLine].filter(Boolean).join(' ');
}

/** 名稱與基底拆成獨立行，供市集漢化（.item-popup__header-line）比對單行／雙行標題 */
export function entryNameLines(entry: BoardEntry): string[] {
  return [entry.name, entry.typeLine].filter(Boolean);
}

const RELATIVE_UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

export function formatAge(indexedAt: number | undefined, now: number = Date.now()): string {
  if (indexedAt === undefined) return '';
  const elapsed = now - indexedAt;
  if (!Number.isFinite(elapsed)) return '';
  const format = new Intl.RelativeTimeFormat(getActiveUiLocale(), { numeric: 'auto' });
  for (const [unit, ms] of RELATIVE_UNITS) {
    if (elapsed >= ms) return format.format(-Math.floor(elapsed / ms), unit);
  }
  return format.format(0, 'minute');
}

/** 實際標價與總價：最多兩位小數，去掉多餘的 0（不像換算值那樣依大小捨去精度） */
export function formatAmount(amount: number): string {
  return new Intl.NumberFormat(getActiveUiLocale(), { maximumFractionDigits: 2 }).format(amount);
}

/** 「≈」換算值：與釘選、官方結果列相同的格式（見 `formatConvertedAmount`） */
export function formatConverted(amount: number): string {
  return formatConvertedAmount(amount, getActiveUiLocale());
}

export function formatPrice(price: BoardPrice | undefined): string {
  return price ? `${formatAmount(price.amount)} ${price.currency}` : t('common.noPrice');
}

export function formatTotal(total: PriceTotal): string {
  if (total.kind === 'converted') {
    const amount = `${formatAmount(total.amount)} ${total.currency}`;
    return total.unconverted > 0
      ? `${amount} ${t('resultBoard.total.unconverted', { count: total.unconverted })}`
      : amount;
  }
  if (total.totals.length === 0) return t('common.noPrice');
  return total.totals.map((price) => `${formatAmount(price.amount)} ${price.currency}`).join(' + ');
}

const STOP_MESSAGE_KEYS: Readonly<Record<LoadStopReason, I18nKey>> = {
  complete: 'resultBoard.load.stop.complete',
  'no-button': 'resultBoard.load.stop.noButton',
  'rate-limited': 'resultBoard.load.stop.rateLimited',
  failed: 'resultBoard.load.stop.failed',
  timeout: 'resultBoard.load.stop.timeout',
  stopped: 'resultBoard.load.stop.stopped',
  'search-changed': 'resultBoard.load.stop.searchChanged',
};

export function stopMessage(reason: LoadStopReason): string {
  return t(STOP_MESSAGE_KEYS[reason]);
}

/** 通貨圖示：先用官方結果列上學到的，再退回內建的換算通貨圖示（chaos、divine 等） */
export function currencyDisplayOf(
  code: string | undefined,
  learned: Readonly<Record<string, CurrencyDisplay>>,
): CurrencyDisplay | undefined {
  if (!code) return undefined;
  if (Object.hasOwn(learned, code)) return learned[code];
  const builtIn = Object.hasOwn(PRICE_COMPARISON_CURRENCIES, code)
    ? PRICE_COMPARISON_CURRENCIES[code as keyof typeof PRICE_COMPARISON_CURRENCIES]
    : undefined;
  return builtIn ? { icon: builtIn.icon, name: t(builtIn.labelKey) } : undefined;
}
