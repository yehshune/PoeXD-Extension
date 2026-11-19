/**
 * 看板的結果帳本：一個搜尋（search ID）已取得的結果，依官方順序、以 id 去重。
 *
 * 帳本是不可變的值：每次加入結果都回傳新的帳本。換搜尋時從空帳本重新開始。
 */
import type { TradeResultEntry } from '@/utils/trade-result-cache';
import { toBoardEntry, type BoardEntry } from './board-entry';

export interface BoardLedger {
  searchId: string;
  entries: readonly BoardEntry[];
  /** 格式不符、無法放進看板的結果 id（同一筆重複送來只算一次） */
  skippedIds: readonly string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function createLedger(searchId: string): BoardLedger {
  return { searchId, entries: [], skippedIds: [] };
}

/** 同一個搜尋就沿用原帳本，換搜尋就回傳新的空帳本 */
export function ledgerForSearch(ledger: BoardLedger, searchId: string): BoardLedger {
  return ledger.searchId === searchId ? ledger : createLedger(searchId);
}

export function appendToLedger(
  ledger: BoardLedger,
  results: readonly TradeResultEntry[],
): BoardLedger {
  const seen = new Set(ledger.entries.map((entry) => entry.id));
  const skipped = new Set(ledger.skippedIds);
  const added: BoardEntry[] = [];
  for (const raw of results) {
    if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id) continue;
    if (raw.sourceSearchId !== ledger.searchId || seen.has(raw.id) || skipped.has(raw.id)) {
      continue;
    }
    const entry = toBoardEntry(raw, ledger.entries.length + added.length);
    if (!entry) {
      skipped.add(raw.id);
      continue;
    }
    seen.add(entry.id);
    added.push(entry);
  }
  if (added.length === 0 && skipped.size === ledger.skippedIds.length) return ledger;
  return {
    ...ledger,
    entries: [...ledger.entries, ...added],
    skippedIds: Array.from(skipped),
  };
}
