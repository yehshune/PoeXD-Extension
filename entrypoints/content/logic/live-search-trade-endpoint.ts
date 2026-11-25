/**
 * 官方即時搜尋端點契約：WebSocket 推播網址，以及經 Rate Gate 呼叫 HTTP /fetch 取回單筆物品。
 * 網址格式、必要標頭與回應形狀都封裝在這裡；呼叫端只拿到「物品資料或失敗原因」。
 */
import type { PoeVersion } from '@/utils/trade-context';
import type { ILiveSearchFetchRateGate } from './live-search-fetch-rate-gate';

export type LiveSearchItemFetchResult =
  | { ok: true; itemData: unknown }
  | { ok: false; status?: number; error: string };

export interface LiveSearchItemFetchRequest {
  gameVersion: PoeVersion;
  token: string;
  searchId: string;
  shouldAbort: () => boolean;
  onRegisterCancel?: (cancelWait: () => void) => void;
  maxRateLimitRetries?: number;
}

/** 依遊戲版本與 Origin 組裝 WebSocket 推播網址 */
export function buildLiveSearchWebSocketUrl(
  origin: string,
  gameVersion: PoeVersion,
  league: string,
  searchId: string,
): string {
  const wsProto = origin.startsWith('https:') ? 'wss:' : 'ws:';
  const host = origin.replace(/^https?:\/\//, '');
  const encodedLeague = encodeURIComponent(league);
  const encodedSearchId = encodeURIComponent(searchId);

  if (gameVersion === 'poe2') {
    return `${wsProto}//${host}/api/trade2/live/poe2/${encodedLeague}/${encodedSearchId}`;
  }
  return `${wsProto}//${host}/api/trade/live/${encodedLeague}/${encodedSearchId}`;
}

function buildFetchUrl(
  origin: string,
  gameVersion: PoeVersion,
  token: string,
  searchId: string,
): string {
  const encodedToken = encodeURIComponent(token);
  const encodedSearchId = encodeURIComponent(searchId);

  if (gameVersion === 'poe2') {
    return `${origin}/api/trade2/fetch/${encodedToken}?query=${encodedSearchId}&realm=poe2`;
  }
  return `${origin}/api/trade/fetch/${encodedToken}?query=${encodedSearchId}`;
}

/**
 * 經 Rate Gate 呼叫官方 /fetch（帶 query 與 X-Requested-With），取回推播 token 對應的單筆物品。
 * 取消、HTTP 失敗、物品已下架與例外都轉成 `{ ok: false }`，不會拋出。
 */
export async function fetchLiveSearchItem(
  rateGate: ILiveSearchFetchRateGate,
  origin: string,
  request: LiveSearchItemFetchRequest,
): Promise<LiveSearchItemFetchResult> {
  const fetchUrl = buildFetchUrl(origin, request.gameVersion, request.token, request.searchId);
  try {
    const response = await rateGate.fetch(
      fetchUrl,
      {
        method: 'GET',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          Accept: 'application/json',
        },
      },
      {
        shouldAbort: request.shouldAbort,
        onRegisterCancel: request.onRegisterCancel,
        maxRateLimitRetries: request.maxRateLimitRetries,
      },
    );

    if (!response) {
      return { ok: false, error: 'Fetch cancelled' };
    }
    if (!response.ok) {
      return { ok: false, status: response.status, error: `HTTP ${response.status}` };
    }

    const json = await response.json();
    if (
      !json ||
      typeof json !== 'object' ||
      !Array.isArray(json.result) ||
      json.result.length === 0
    ) {
      return { ok: false, error: 'Item no longer available' };
    }
    return { ok: true, itemData: json.result[0] };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Fetch failed' };
  }
}
