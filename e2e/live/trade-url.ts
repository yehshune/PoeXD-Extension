/**
 * 官方交易搜尋頁網址的解析與組裝（純函式，不依賴 Playwright，可在 vitest 測試）。
 *
 * - PoE1：`/trade/search/{league}/{searchId}[/live]`
 * - PoE2：`/trade2/search/poe2/{league}/{searchId}[/live]`
 * - 台服（pathofexile.tw）同樣是 `/trade/search/...`
 */

export const TRADE_SEARCH_URL = /pathofexile\.(com|tw)\/trade2?\/search\//;

export type TradeGame = 'poe1' | 'poe2';

export interface TradeUrlInfo {
  readonly origin: string;
  readonly game: TradeGame;
  readonly league: string | null;
  readonly searchId: string | null;
  readonly live: boolean;
}

export const DEFAULT_START_URLS: Readonly<Record<TradeGame, string>> = {
  poe1: 'https://www.pathofexile.com/trade/search',
  poe2: 'https://www.pathofexile.com/trade2/search/poe2',
};

export function isTradeSearchUrl(url: string): boolean {
  return TRADE_SEARCH_URL.test(url);
}

export function parseTradeUrl(url: string): TradeUrlInfo | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!isTradeSearchUrl(parsed.href)) return null;
  const segments = parsed.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const game: TradeGame = segments[0] === 'trade2' ? 'poe2' : 'poe1';
  // trade2 多一段 realm（poe2）
  const rest = segments.slice(game === 'poe2' ? 3 : 2);
  const live = rest.at(-1) === 'live';
  const [league = null, searchId = null] = live ? rest.slice(0, -1) : rest;
  return { origin: parsed.origin, game, league, searchId, live };
}

export interface SearchUrlParts {
  readonly origin?: string;
  readonly game: TradeGame;
  readonly league: string;
  readonly searchId?: string | null;
  readonly live?: boolean;
}

export function buildSearchUrl(parts: SearchUrlParts): string {
  const origin = parts.origin ?? 'https://www.pathofexile.com';
  const base = parts.game === 'poe2' ? `${origin}/trade2/search/poe2` : `${origin}/trade/search`;
  const tail = [parts.league, parts.searchId, parts.live ? 'live' : null]
    .filter((segment): segment is string => Boolean(segment))
    .map(encodeURIComponent)
    .join('/');
  return `${base}/${tail}`;
}

/**
 * 把 `pnpm poe open <target>` 的參數轉成網址：
 * - 完整網址：原樣使用
 * - `poe1` / `poe2`：官方預設起始頁
 * - 其他字串視為 searchId，沿用目前分頁的遊戲、聯盟與網域
 */
export function resolveOpenTarget(target: string, current: TradeUrlInfo | null): string {
  if (/^https?:\/\//.test(target)) return target;
  if (target === 'poe1' || target === 'poe2') return DEFAULT_START_URLS[target];
  if (!current?.league) {
    throw new Error(
      `「${target}」看起來是 searchId，但目前沒有可沿用聯盟的官方搜尋頁；請改給完整網址，或先 \`pnpm poe open poe1|poe2\``,
    );
  }
  return buildSearchUrl({ ...current, searchId: target, live: false, league: current.league });
}
