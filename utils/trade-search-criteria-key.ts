import { decodeGzipBase64UrlToQuery } from './trade-url-codec';
import {
  getTradeSearchCanonicalKey,
  type ParsedTradeSearchIdentity,
} from './trade-search-identity';

/**
 * 搜尋條件鍵（Criteria Key）
 *
 * Canonical search ID 是 gzip 壓縮的查詢 JSON（ADR-0008），同一組搜尋條件可能因欄位順序或
 * 壓縮器不同而產生不同的 search ID。條件鍵以解碼後的查詢內容判斷「是否為相同搜尋條件」：
 * - 排序（`sort`）不影響即時搜尋結果，不納入比較。
 * - 物件欄位順序不影響結果，一律依鍵名排序後序列化。
 * - 無法解碼時退回 canonical key（等同只以 search ID 判斷）。
 */

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  }
  const entries = Object.keys(value as Record<string, unknown>)
    .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
    .sort()
    .map(
      (key) => `${JSON.stringify(key)}:${stableSerialize((value as Record<string, unknown>)[key])}`,
    );
  return `{${entries.join(',')}}`;
}

/** 53-bit 非加密雜湊（cyrb53），僅用來縮短條件鍵長度。 */
function hashString(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** 將解碼後的查詢 JSON 正規化為與排序、欄位順序無關的指紋。 */
export function fingerprintTradeQuery(decoded: unknown): string | null {
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return null;
  const { sort: _sort, ...criteria } = decoded as Record<string, unknown>;
  return hashString(stableSerialize(criteria));
}

export function buildTradeSearchCriteriaKey(
  identity: ParsedTradeSearchIdentity,
  fingerprint: string | null,
): string {
  if (!fingerprint) return getTradeSearchCanonicalKey(identity);
  return `${identity.gameVersion}:${identity.league.trim().toLowerCase()}:q:${fingerprint}`;
}

export interface TradeSearchCriteriaKeyResolver {
  /** 同步讀取已解析的條件鍵；尚未解析時回傳 undefined。 */
  peek(identity: ParsedTradeSearchIdentity): string | undefined;
  /** 解析（含快取）條件鍵；解碼失敗時退回 canonical key。 */
  resolve(identity: ParsedTradeSearchIdentity): Promise<string>;
  resolveMany(identities: readonly ParsedTradeSearchIdentity[]): Promise<void>;
}

export function createTradeSearchCriteriaKeyResolver(
  decode: (searchId: string) => Promise<unknown> = decodeGzipBase64UrlToQuery,
): TradeSearchCriteriaKeyResolver {
  const fingerprintBySearchId = new Map<string, string | null>();
  const inflight = new Map<string, Promise<string | null>>();

  const loadFingerprint = (searchId: string): Promise<string | null> => {
    const cached = fingerprintBySearchId.get(searchId);
    if (cached !== undefined) return Promise.resolve(cached);
    const pending = inflight.get(searchId);
    if (pending) return pending;
    const task = Promise.resolve()
      .then(() => decode(searchId))
      .then(
        (decoded) => fingerprintTradeQuery(decoded),
        () => null,
      )
      .then((fingerprint) => {
        fingerprintBySearchId.set(searchId, fingerprint);
        inflight.delete(searchId);
        return fingerprint;
      });
    inflight.set(searchId, task);
    return task;
  };

  return {
    peek(identity) {
      const searchId = identity.searchId.trim();
      if (!fingerprintBySearchId.has(searchId)) return undefined;
      return buildTradeSearchCriteriaKey(identity, fingerprintBySearchId.get(searchId) ?? null);
    },
    async resolve(identity) {
      const fingerprint = await loadFingerprint(identity.searchId.trim());
      return buildTradeSearchCriteriaKey(identity, fingerprint);
    },
    async resolveMany(identities) {
      await Promise.all(identities.map((identity) => loadFingerprint(identity.searchId.trim())));
    },
  };
}
