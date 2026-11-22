import { decodeRepeatedly, parseTradePath, type PoeVersion } from './trade-context';
import { isSupportedTradeHost } from './trade-realms';

export interface ParsedTradeSearchIdentity {
  gameVersion: PoeVersion;
  league: string;
  searchId: string;
}

export function parseTradeSearchUrl(urlValue: string): ParsedTradeSearchIdentity | undefined {
  try {
    const url = new URL(urlValue);
    if (!isSupportedTradeOrigin(url)) return undefined;
    const path = getSearchPath(url);
    if (!path) return undefined;
    const league = decodeRepeatedly(path.parts[path.leagueIndex] || '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();
    const searchId = decodeRepeatedly(path.parts[path.leagueIndex + 1] || '').trim();
    if (!league || !searchId || searchId === 'live') return undefined;
    return {
      gameVersion: path.gameVersion,
      league,
      searchId,
    };
  } catch {
    return undefined;
  }
}

/**
 * 載入這個網址時官方會不會自動搜尋並抓取第一批結果：一般搜尋頁且網址帶搜尋 id 才會。
 * 即時搜尋頁的結果由 WebSocket 推送，不在首次載入時抓取。
 */
export function expectsInitialSearchResults(urlValue: string): boolean {
  if (!parseTradeSearchUrl(urlValue)) return false;
  try {
    return !new URL(urlValue).pathname.split('/').some((part) => part.toLowerCase() === 'live');
  } catch {
    return false;
  }
}

function isSupportedTradeOrigin(url: URL) {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  return isSupportedTradeHost(url.hostname);
}

export function withTradeSearchId(urlValue: string, searchId: string): string | undefined {
  try {
    const url = new URL(urlValue);
    const path = getSearchPath(url);
    if (!path || !path.parts[path.leagueIndex]) return undefined;
    path.parts[path.leagueIndex + 1] = searchId;
    url.pathname = `/${path.parts.join('/')}`;
    return url.toString();
  } catch {
    return undefined;
  }
}

function getSearchPath(url: URL) {
  const path = parseTradePath(url.pathname);
  if (!path || path.leagueIndex === undefined) return undefined;
  return {
    parts: path.parts,
    leagueIndex: path.leagueIndex,
    gameVersion: path.version,
  };
}

export function withTradeLeague(urlValue: string, league: string): string | undefined {
  try {
    const cleanLeague = league.trim().replace(/\s+/g, ' ');
    if (!cleanLeague) return undefined;
    const url = new URL(urlValue);
    const path = getSearchPath(url);
    if (!path) return undefined;
    path.parts[path.leagueIndex] = cleanLeague;
    url.pathname = `/${path.parts.join('/')}`;
    return url.toString();
  } catch {
    return undefined;
  }
}

export function stripLiveSuffix(urlValue: string): string {
  if (typeof urlValue !== 'string' || !urlValue) return urlValue;
  try {
    const url = new URL(urlValue);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.at(-1)?.toLowerCase() === 'live') {
      parts.pop();
      url.pathname = `/${parts.join('/')}`;
      return url.toString();
    }
    return urlValue;
  } catch {
    return urlValue.replace(/\/live\/?(\?.*)?$/i, '$1');
  }
}

export function toLiveUrl(urlValue: string): string {
  if (typeof urlValue !== 'string' || !urlValue) return urlValue;
  try {
    const clean = stripLiveSuffix(urlValue);
    const url = new URL(clean);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.at(-1)?.toLowerCase() !== 'live') {
      parts.push('live');
      url.pathname = `/${parts.join('/')}`;
    }
    return url.toString();
  } catch {
    const clean = stripLiveSuffix(urlValue);
    return clean.endsWith('/live') ? clean : `${clean.replace(/\/+$/, '')}/live`;
  }
}

export function isSameTradeSearchIdentity(
  a: ParsedTradeSearchIdentity,
  b: ParsedTradeSearchIdentity,
): boolean {
  return (
    a.gameVersion === b.gameVersion &&
    a.league.trim().toLowerCase() === b.league.trim().toLowerCase() &&
    a.searchId.trim() === b.searchId.trim()
  );
}

function getTradeRouteKind(urlValue: string): 'search' | 'exchange' | undefined {
  try {
    const path = parseTradePath(new URL(urlValue).pathname);
    const kind = path?.parts[1];
    return kind === 'search' || kind === 'exchange' ? kind : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 判斷兩個市集網址是否指向同一個搜尋頁面（忽略 `/live` 後綴、query string、hash 與尾端斜線，
 * 且區分 `/search/` 與 `/exchange/` 路由，不比對無效或非搜尋頁面網址）。
 */
export function isSameTradeSearchPageUrl(leftUrl: string, rightUrl: string): boolean {
  if (!leftUrl || !rightUrl) return false;
  const cleanLeft = stripLiveSuffix(leftUrl).split('?')[0].split('#')[0].replace(/\/+$/, '');
  const cleanRight = stripLiveSuffix(rightUrl).split('?')[0].split('#')[0].replace(/\/+$/, '');
  const left = parseTradeSearchUrl(cleanLeft);
  const right = parseTradeSearchUrl(cleanRight);
  if (!left || !right) return false;
  return (
    getTradeRouteKind(cleanLeft) === getTradeRouteKind(cleanRight) &&
    isSameTradeSearchIdentity(left, right)
  );
}

export function getTradeSearchCanonicalKey(identity: ParsedTradeSearchIdentity): string {
  return `${identity.gameVersion}:${identity.league.trim().toLowerCase()}:${identity.searchId.trim()}`;
}

/** Base64URL 形式的 gzip magic header（0x1f 0x8b 0x08）。官方目前所有有效的搜尋 ID 都以此開頭。 */
const GZIP_SEARCH_ID_PREFIX = 'H4sI';

/**
 * 判斷搜尋 ID 是否為 Legacy Search ID（官方已不再解析的伺服器短碼）。見 ADR-0008。
 */
export function isLegacySearchId(searchId: string): boolean {
  const trimmed = typeof searchId === 'string' ? searchId.trim() : '';
  return trimmed !== '' && !trimmed.startsWith(GZIP_SEARCH_ID_PREFIX);
}

/**
 * 判斷 Trade 網址是否為帶有 Legacy Search ID 的物品搜尋。
 * 只判斷 `/search/` 路由；通貨兌換 (`/exchange/`) 的 ID 格式尚未確認，一律視為有效。
 */
export function isLegacyTradeSearchUrl(urlValue: string): boolean {
  const identity = parseTradeSearchUrl(urlValue);
  if (!identity) return false;
  try {
    const path = parseTradePath(new URL(urlValue).pathname);
    if (path?.parts[1] !== 'search') return false;
  } catch {
    return false;
  }
  return isLegacySearchId(identity.searchId);
}

const SEARCH_FORM_ROUTE = /\/trade2?\/search\//;

/** 只有官方搜尋路由有可寫入網址的搜尋表單（通貨兌換不適用）。 */
export function isTradeSearchFormUrl(url: string): boolean {
  return SEARCH_FORM_ROUTE.test(url);
}
