import { decodeRepeatedly, getTradeLeague, parseTradePath } from './trade-context';
import { getSupportedTradeOrigin } from './trade-realms';
import { withTradeLeague } from './trade-search-identity';

/**
 * 書籤聯盟的「自動」哨兵值（與 TFT Trade Extension 的 `league: "Auto"` 相同）。
 * 自動書籤在開啟時改用目前頁面的聯盟；固定書籤（`leaguePinned`）永遠使用自身記錄的聯盟。
 */
export const BOOKMARK_AUTO_LEAGUE = 'Auto';

export interface BookmarkTargetContext {
  /** 目前所在官方市集的 origin（例如 `https://poe.game.qq.com`）。 */
  origin?: string;
  /** 目前頁面的聯盟；未知時自動書籤保留記錄中的聯盟。 */
  league?: string;
}

/**
 * 將書籤記錄的網址解析為可在目前網域、目前聯盟開啟的網址。
 * 書籤本身不綁網域：一律改寫為目前所在的官方市集 origin。
 */
export function resolveBookmarkUrl(
  storedUrl: string,
  options: { leaguePinned?: boolean },
  context: BookmarkTargetContext,
): string {
  if (!storedUrl) return storedUrl;
  let resolved = storedUrl;
  const league = context.league?.trim();
  if (!options.leaguePinned && league) {
    resolved = withTradeLeague(resolved, league) ?? resolved;
  }
  const origin = getSupportedTradeOrigin(context.origin);
  if (origin) {
    try {
      const url = new URL(resolved);
      if (getSupportedTradeOrigin(url.toString()) && url.origin !== origin) {
        resolved = `${origin}${url.pathname}${url.search}${url.hash}`;
      }
    } catch {
      return resolved;
    }
  }
  return resolved;
}

/** 讀取瀏覽器目前頁面作為書籤解析情境。 */
export function readBookmarkTargetContext(
  location: Pick<Location, 'origin' | 'pathname'> | undefined = typeof window !== 'undefined'
    ? window.location
    : undefined,
): BookmarkTargetContext {
  if (!location) return {};
  return {
    origin: location.origin,
    league: getTradeLeague(location.pathname),
  };
}

/** 從市集網址取出原始（保留大小寫）的聯盟名稱。 */
export function readTradeUrlLeague(urlValue: string): string | undefined {
  try {
    const path = parseTradePath(new URL(urlValue).pathname);
    if (path?.leagueIndex === undefined) return undefined;
    const league = decodeRepeatedly(path.parts[path.leagueIndex] || '')
      .trim()
      .replace(/\s+/g, ' ');
    return league || undefined;
  } catch {
    return undefined;
  }
}
