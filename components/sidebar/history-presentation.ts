import { decodeRepeatedly, parseTradePath, type PoeVersion } from '@/utils/trade-context';
import {
  isLegacyTradeSearchUrl,
  parseTradeSearchUrl,
  stripLiveSuffix,
} from '@/utils/trade-search-identity';
import {
  decodeTradeSearchUrl,
  extractQueryMetadata,
  isGenericTradePageTitle,
} from '@/utils/trade-url-codec';
import { loadTradeDictionaries, translateStatLines } from '@/utils/trade-stat-dictionary';
import type { HistoryEntry } from '@/utils/search-records';

export type HistoryTimeGroupKey = 'today' | 'yesterday' | 'last7Days' | 'older';

export interface HistoryTimeGroup {
  key: HistoryTimeGroupKey;
  entries: HistoryEntry[];
}

const MS_PER_DAY = 86_400_000;

export function isLiveTradeSearchUrl(urlValue: string): boolean {
  if (typeof urlValue !== 'string' || !urlValue) return false;
  try {
    const url = new URL(urlValue);
    const parts = url.pathname.split('/').filter(Boolean);
    return parts.at(-1)?.toLowerCase() === 'live';
  } catch {
    return /\/live\/?(\?.*)?$/i.test(urlValue);
  }
}

export function extractTradeLeagueFromUrl(urlValue: string): string | null {
  if (typeof urlValue !== 'string' || !urlValue) return null;
  try {
    const url = new URL(urlValue);
    const path = parseTradePath(url.pathname);
    if (!path || path.leagueIndex === undefined) return null;
    const raw = decodeRepeatedly(path.parts[path.leagueIndex] || '')
      .trim()
      .replace(/\s+/g, ' ');
    return raw || null;
  } catch {
    return null;
  }
}

export function getOtherLeagueLabel(
  entryUrl: string,
  currentLeague?: string | null,
): string | null {
  const entryLeague = extractTradeLeagueFromUrl(entryUrl);
  const activeLeague = currentLeague?.trim().replace(/\s+/g, ' ');
  if (!entryLeague || !activeLeague) return null;
  if (entryLeague.toLowerCase() === activeLeague.toLowerCase()) return null;
  return entryLeague;
}

export function isCurrentHistoryEntry(entryUrl: string, currentPageUrl: string): boolean {
  if (!entryUrl || !currentPageUrl) return false;
  const entryIdentity = parseTradeSearchUrl(entryUrl);
  const currentIdentity = parseTradeSearchUrl(currentPageUrl);
  if (entryIdentity && currentIdentity) {
    return (
      entryIdentity.gameVersion === currentIdentity.gameVersion &&
      entryIdentity.league === currentIdentity.league &&
      entryIdentity.searchId === currentIdentity.searchId
    );
  }
  return stripLiveSuffix(entryUrl) === stripLiveSuffix(currentPageUrl);
}

export function groupHistoryEntriesByTime(
  entries: readonly HistoryEntry[],
  nowMs: number = Date.now(),
): HistoryTimeGroup[] {
  const now = new Date(nowMs);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - MS_PER_DAY;
  const startOfLast7Days = startOfToday - 6 * MS_PER_DAY;

  const buckets: Record<HistoryTimeGroupKey, HistoryEntry[]> = {
    today: [],
    yesterday: [],
    last7Days: [],
    older: [],
  };

  for (const entry of entries) {
    const ts = entry.visitedAt;
    if (typeof ts === 'number' && Number.isFinite(ts)) {
      if (ts >= startOfToday) {
        buckets.today.push(entry);
      } else if (ts >= startOfYesterday) {
        buckets.yesterday.push(entry);
      } else if (ts >= startOfLast7Days) {
        buckets.last7Days.push(entry);
      } else {
        buckets.older.push(entry);
      }
    } else {
      buckets.older.push(entry);
    }
  }

  const order: HistoryTimeGroupKey[] = ['today', 'yesterday', 'last7Days', 'older'];
  return order
    .filter((key) => buckets[key].length > 0)
    .map((key) => ({ key, entries: buckets[key] }));
}

export function findDisambiguationEntryIds(
  entries: readonly HistoryEntry[],
  getDisplayName: (entry: HistoryEntry) => string,
  version: PoeVersion,
): Set<string> {
  const nameCounts = new Map<string, number>();
  const resolvedNames = new Map<string, string>();

  for (const entry of entries) {
    const displayName = getDisplayName(entry).trim();
    resolvedNames.set(entry.id, displayName);
    const normalized = displayName.toLowerCase();
    nameCounts.set(normalized, (nameCounts.get(normalized) ?? 0) + 1);
  }

  const result = new Set<string>();
  for (const entry of entries) {
    if (isLegacyTradeSearchUrl(entry.url)) continue;
    const displayName = resolvedNames.get(entry.id) ?? '';
    const count = nameCounts.get(displayName.toLowerCase()) ?? 0;
    if (count > 1 || isGenericTradePageTitle(displayName, version)) {
      result.add(entry.id);
    }
  }
  return result;
}

function formatPriceHint(price: any): string | null {
  if (!price || typeof price !== 'object') return null;
  const min = price.min !== undefined && price.min !== null && price.min !== '' ? price.min : null;
  const max = price.max !== undefined && price.max !== null && price.max !== '' ? price.max : null;
  if (min === null && max === null) return null;
  const currency =
    typeof price.option === 'string' && price.option.trim() ? ` ${price.option.trim()}` : '';
  if (min !== null && max !== null) return `${min}–${max}${currency}`;
  if (max !== null) return `≤ ${max}${currency}`;
  return `≥ ${min}${currency}`;
}

function formatStatHint(
  stat: { id: string; min?: number; max?: number },
  version: PoeVersion,
): string {
  const label = translateStatLines(stat.id, version)[0] ?? stat.id;
  const cleanLabel = label.replace(/#/g, '').replace(/\s+/g, ' ').trim();
  const hasMin = stat.min !== undefined && stat.min !== null;
  const hasMax = stat.max !== undefined && stat.max !== null;
  if (hasMin && hasMax) return `${cleanLabel} (${stat.min}–${stat.max})`;
  if (hasMin) return `${cleanLabel} ≥ ${stat.min}`;
  if (hasMax) return `${cleanLabel} ≤ ${stat.max}`;
  return cleanLabel;
}

export async function deriveHistoryCriteriaHint(url: string, version: PoeVersion): Promise<string> {
  if (!url || isLegacyTradeSearchUrl(url)) return '';
  try {
    const decoded = await decodeTradeSearchUrl(url);
    if (!decoded) return '';
    try {
      await loadTradeDictionaries(version);
    } catch {
      // Dictionary load failure falls back to raw stat text/ID
    }
    const meta = extractQueryMetadata(decoded.query, version);
    const parts: string[] = [];

    const priceFilter = meta.filters.find(
      (f) => f.sectionKey === 'trade_filters' && f.fieldKey === 'price',
    );
    const priceHint = priceFilter ? formatPriceHint(priceFilter.value) : null;
    if (priceHint) parts.push(priceHint);

    for (const stat of meta.stats) {
      if (parts.length >= 2) break;
      const hint = formatStatHint(stat, version);
      if (hint) parts.push(hint);
    }

    if (parts.length === 0 && meta.suggestedName?.trim()) {
      parts.push(meta.suggestedName.trim());
    }

    return parts.slice(0, 2).join(' · ');
  } catch {
    return '';
  }
}
