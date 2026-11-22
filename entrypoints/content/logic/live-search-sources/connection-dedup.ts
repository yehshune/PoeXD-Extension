import type { ParsedTradeSearchIdentity } from '@/utils/trade-search-identity';
import { isValidPoeCdnImageUrl } from '@/utils/poe-cdn-url';
import type { TradeSearchCriteriaKeyResolver } from '@/utils/trade-search-criteria-key';

/**
 * 主控台連線去重（Connection Dedup）
 *
 * 規則：
 * 1. 主控台中「相同搜尋條件」（同版本、同聯盟、解碼後條件相同）只能存在一筆連線，
 *    不論來源是書籤、暫時搜尋、一般頁送入或上次連線。
 * 2. 新加入的連線若與「上次連線」相同，兩者合併為一筆：有封面圖片的一方優先；
 *    兩者都有或都沒有時，以新加入的一方為準。
 */

export interface DedupEntry {
  key: string;
  identity: ParsedTradeSearchIdentity;
  name?: string;
  url?: string;
  coverImageUrl?: string;
  sourceBookmarkId?: string;
}

export interface CriteriaMatch {
  section: 'session' | 'previous';
  entry: DedupEntry;
  /** 與候選項目的 canonical key（search ID）完全相同 */
  sameKey: boolean;
}

export interface ConnectionDedupDeps {
  resolver: TradeSearchCriteriaKeyResolver;
  /** 「本次連線」與監聽中的項目 */
  listSessionEntries(): DedupEntry[];
  /** 尚未進入「本次連線」的「上次連線」項目 */
  listPreviousEntries(): DedupEntry[];
}

export function hasValidCover(url: string | undefined | null): url is string {
  return Boolean(url && isValidPoeCdnImageUrl(url));
}

/** 有圖片優先：只有既有項目有封面而新加入者沒有時，才改用既有項目。 */
export function shouldAdoptExisting(
  incomingCover: string | undefined | null,
  existingCover: string | undefined | null,
): boolean {
  return !hasValidCover(incomingCover) && hasValidCover(existingCover);
}

function sameVersionAndLeague(a: ParsedTradeSearchIdentity, b: ParsedTradeSearchIdentity) {
  return (
    a.gameVersion === b.gameVersion &&
    a.league.trim().toLowerCase() === b.league.trim().toLowerCase()
  );
}

export interface ConnectionDedup {
  findEquivalent(
    identity: ParsedTradeSearchIdentity,
    canonicalKey: string,
  ): Promise<CriteriaMatch | null>;
  /** 同步讀取已快取的條件鍵；尚未解析時回傳 undefined。 */
  peekCriteriaKey(identity: ParsedTradeSearchIdentity): string | undefined;
  resolveMany(identities: readonly ParsedTradeSearchIdentity[]): Promise<void>;
}

export function createConnectionDedup(deps: ConnectionDedupDeps): ConnectionDedup {
  const { resolver } = deps;

  const findIn = (
    entries: DedupEntry[],
    identity: ParsedTradeSearchIdentity,
    canonicalKey: string,
    criteriaKey: string,
  ): { entry: DedupEntry; sameKey: boolean } | null => {
    const exact = entries.find((entry) => entry.key === canonicalKey);
    if (exact) return { entry: exact, sameKey: true };
    const match = entries.find(
      (entry) =>
        sameVersionAndLeague(entry.identity, identity) &&
        resolver.peek(entry.identity) === criteriaKey,
    );
    return match ? { entry: match, sameKey: false } : null;
  };

  return {
    async findEquivalent(identity, canonicalKey) {
      const sessionEntries = deps.listSessionEntries();
      const previousEntries = deps.listPreviousEntries();
      const [criteriaKey] = await Promise.all([
        resolver.resolve(identity),
        resolver.resolveMany(
          [...sessionEntries, ...previousEntries]
            .map((entry) => entry.identity)
            .filter((other) => sameVersionAndLeague(other, identity)),
        ),
      ]);
      const sessionMatch = findIn(sessionEntries, identity, canonicalKey, criteriaKey);
      if (sessionMatch) return { section: 'session', ...sessionMatch };
      const previousMatch = findIn(previousEntries, identity, canonicalKey, criteriaKey);
      if (previousMatch) return { section: 'previous', ...previousMatch };
      return null;
    },
    peekCriteriaKey(identity) {
      return resolver.peek(identity);
    },
    resolveMany(identities) {
      return resolver.resolveMany(identities);
    },
  };
}

export interface DedupableItem {
  canonicalKey: string | null;
  canonicalIdentity: ParsedTradeSearchIdentity | null;
  coverImageUrl?: string;
}

/**
 * 「上次連線」顯示去重：移除與本次連線條件相同者，並合併彼此條件相同者（有圖片優先）。
 * 回傳尚未解析條件鍵的 identity，供呼叫端非同步解析後重新發布快照。
 */
export function dedupePreviousConnectionItems<T extends DedupableItem>(
  items: readonly T[],
  sessionItems: readonly DedupableItem[],
  peek: (identity: ParsedTradeSearchIdentity) => string | undefined,
): { items: T[]; unresolved: ParsedTradeSearchIdentity[] } {
  const unresolved: ParsedTradeSearchIdentity[] = [];
  const keyOf = (item: DedupableItem): string | null => {
    if (!item.canonicalIdentity) return item.canonicalKey;
    const criteria = peek(item.canonicalIdentity);
    if (criteria === undefined) {
      unresolved.push(item.canonicalIdentity);
      return item.canonicalKey;
    }
    return criteria;
  };

  const sessionKeys = new Set<string>();
  for (const item of sessionItems) {
    const key = keyOf(item);
    if (key) sessionKeys.add(key);
  }

  const result: T[] = [];
  const indexByKey = new Map<string, number>();
  for (const item of items) {
    const key = keyOf(item);
    if (!key) {
      result.push(item);
      continue;
    }
    if (sessionKeys.has(key)) continue;
    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      indexByKey.set(key, result.length);
      result.push(item);
      continue;
    }
    if (shouldAdoptExisting(result[existingIndex].coverImageUrl, item.coverImageUrl)) {
      result[existingIndex] = item;
    }
  }
  return { items: result, unresolved };
}
