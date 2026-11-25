/**
 * 官方即時搜尋端點契約：WebSocket 推播網址、推播 token 的有效期限，以及經 Rate Gate 呼叫
 * HTTP /fetch 取回單筆物品。網址格式、必要標頭與回應形狀都封裝在這裡；呼叫端只拿到
 * 「物品資料或分類過的失敗原因」。
 */
import type { PoeVersion } from '@/utils/trade-context';
import type { ILiveSearchFetchRateGate } from './live-search-fetch-rate-gate';

/**
 * 抓取失敗的分類：
 * - `token-rejected`：官方回 400「Token is invalid」，推播 token 已過期（約收到後數秒）
 * - `item-gone`：token 有效但所有物品都已售出或下架（官方回 `result: [null]` 或空陣列）
 * - `http`：其他 HTTP 錯誤（含 429）
 * - `cancelled`：等待 Rate Gate 期間被取消
 * - `network`：網路或解析例外
 */
export type LiveSearchItemFetchFailure =
  | 'token-rejected'
  | 'item-gone'
  | 'http'
  | 'cancelled'
  | 'network';

export type LiveSearchItemFetchResult =
  | { ok: true; items: readonly object[]; serverDateMs?: number }
  | {
      ok: false;
      kind: LiveSearchItemFetchFailure;
      status?: number;
      error: string;
      serverDateMs?: number;
    };

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

/**
 * 推播 token 是官方簽發的 JWT，`exp` 為過期時間（秒，官方時鐘）。
 * 回傳毫秒；不是 JWT 或沒有 `exp` 時回傳 null。
 */
export function readLiveSearchTokenExpiry(token: string): number | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const claims: unknown = JSON.parse(atob(padded));
    const exp =
      claims && typeof claims === 'object' ? (claims as { exp?: unknown }).exp : undefined;
    return typeof exp === 'number' && Number.isFinite(exp) && exp > 0 ? exp * 1000 : null;
  } catch {
    return null;
  }
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

/** 官方回應的 `Date` 標頭（秒精度）；用來換算 token `exp` 對應的本地時間 */
function readServerDate(response: Pick<Response, 'headers'>): number | undefined {
  const raw = response.headers?.get?.('date');
  if (!raw) return undefined;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function readErrorMessage(response: Pick<Response, 'json'>): Promise<string | undefined> {
  try {
    const body: unknown = await response.json();
    const message =
      body && typeof body === 'object'
        ? (body as { error?: { message?: unknown } }).error?.message
        : undefined;
    return typeof message === 'string' ? message : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 經 Rate Gate 呼叫官方 /fetch（帶 query 與 X-Requested-With），取回推播 token 對應的物品。
 * 一個 token 可能對應多件物品（推播訊息的 `count`），回傳其中仍在架上的全部物品。
 * 所有失敗都轉成分類過的 `{ ok: false }`，不會拋出。
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
      return { ok: false, kind: 'cancelled', error: 'Fetch cancelled' };
    }
    const serverDateMs = readServerDate(response);
    const dated = serverDateMs !== undefined ? { serverDateMs } : {};
    if (!response.ok) {
      const message = await readErrorMessage(response);
      const tokenRejected = response.status === 400 && /token is invalid/i.test(message ?? '');
      return {
        ok: false,
        kind: tokenRejected ? 'token-rejected' : 'http',
        status: response.status,
        error: message ? `HTTP ${response.status}: ${message}` : `HTTP ${response.status}`,
        ...dated,
      };
    }

    const json: unknown = await response.json();
    const result =
      json && typeof json === 'object' ? (json as { result?: unknown }).result : undefined;
    const items = Array.isArray(result)
      ? result.filter((entry): entry is object => Boolean(entry) && typeof entry === 'object')
      : [];
    if (items.length === 0) {
      return { ok: false, kind: 'item-gone', error: 'Item no longer available', ...dated };
    }
    return { ok: true, items, ...dated };
  } catch (err) {
    return {
      ok: false,
      kind: 'network',
      error: err instanceof Error ? err.message : 'Fetch failed',
    };
  }
}
