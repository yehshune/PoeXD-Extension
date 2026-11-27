/**
 * 讀出 Source Item 上每一行詞綴的分類、stat 代碼、數值與階級。
 * 文字與 stat 代碼沿用共用的 `trade-item-mods`；階級與正負號讀自結構化詞綴的 `mods[]`。
 */
import {
  normalizeStatHash,
  parseModTierCode,
  readTradeItemModLines,
  TRADE_ITEM_MOD_FIELDS,
  unwrapItemMarkup,
} from '../trade-item-mods';

const MAX_LINE_LENGTH = 300;
const NUMBER = /\d+(?:\.\d+)?/g;
/** 沒有數字的詞綴（`Cannot be Frozen`）以 1 計，搜尋時只要求存在 */
const VALUELESS = 1;

export interface SourceLine {
  /** 實際分類：`explicit`、`fractured`、`crafted`、`desecrated`、`implicit`、`enchant`… */
  category: string;
  text: string;
  /** 不含 `stat.` 前綴，例如 `fractured.stat_1509134228` */
  statId: string;
  value: number;
  tier?: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** 一行裡所有數字的平均（`Adds 7 to 14` → 10.5） */
function averageOf(text: string): number {
  const numbers = (text.match(NUMBER) ?? []).map(Number).filter(Number.isFinite);
  if (numbers.length === 0) return VALUELESS;
  return numbers.reduce((sum, number) => sum + number, 0) / numbers.length;
}

/** 描述文字只寫絕對值；數值範圍全為負時代表負向詞綴 */
function isNegative(mods: readonly unknown[]): boolean {
  const bounds = mods
    .flatMap((entry) =>
      isRecord(entry) && Array.isArray(entry.magnitudes) ? entry.magnitudes : [],
    )
    .flatMap((range) => (isRecord(range) ? [Number(range.min), Number(range.max)] : []))
    .filter(Number.isFinite);
  return (
    bounds.length > 0 && bounds.every((bound) => bound <= 0) && bounds.some((bound) => bound < 0)
  );
}

function bestTier(mods: readonly unknown[]): number | undefined {
  const tiers = mods
    .map((entry) => (isRecord(entry) && typeof entry.tier === 'string' ? entry.tier : undefined))
    .map((tier) => parseModTierCode(tier)?.tierNumber)
    .filter((tier): tier is number => tier !== undefined);
  return tiers.length > 0 ? Math.min(...tiers) : undefined;
}

function readStructuredLine(
  entry: Record<string, unknown>,
  fieldCategory: string,
): SourceLine | undefined {
  const raw = typeof entry.description === 'string' ? entry.description : '';
  const statId = typeof entry.hash === 'string' ? normalizeStatHash(entry.hash) : '';
  if (!raw || raw.length > MAX_LINE_LENGTH || !statId) return undefined;
  const text = unwrapItemMarkup(raw).trim();
  const average = averageOf(text);
  if (!text) return undefined;
  const mods = Array.isArray(entry.mods) ? entry.mods : [];
  const domain = typeof entry.domain === 'string' && entry.domain.trim() ? entry.domain.trim() : '';
  const tier = bestTier(mods);
  return {
    category: domain || fieldCategory,
    text,
    statId,
    value: isNegative(mods) ? -average : average,
    ...(tier !== undefined ? { tier } : {}),
  };
}

const hasStructuredMods = (item: Record<string, unknown>): boolean =>
  TRADE_ITEM_MOD_FIELDS.some(([field]) => {
    const list = item[field];
    return Array.isArray(list) && list.some(isRecord);
  });

/** 舊版字串格式：沒有階級與正負號資訊 */
function readLegacyLines(item: Record<string, unknown>): SourceLine[] {
  return readTradeItemModLines(item, { maxLineLength: MAX_LINE_LENGTH }).flatMap((line) =>
    line.statId
      ? [
          {
            category: line.category,
            text: line.text,
            statId: line.statId,
            value: averageOf(line.text),
          },
        ]
      : [],
  );
}

export function readSourceLines(item: Record<string, unknown>): SourceLine[] {
  if (!hasStructuredMods(item)) return readLegacyLines(item);
  return TRADE_ITEM_MOD_FIELDS.flatMap(([field, fieldCategory]) => {
    const list = item[field];
    if (!Array.isArray(list)) return [];
    return list.flatMap((entry) => {
      const line = isRecord(entry) ? readStructuredLine(entry, fieldCategory) : undefined;
      return line ? [line] : [];
    });
  });
}
