/**
 * 釘選卡片上的動作：前往藏身處（直購刊登）、複製密語、跳回來源搜尋。
 *
 * 前往藏身處與官方「Travel to Hideout」按鈕相同：呼叫 `POST /api/trade/whisper { token }`。
 * token 綁定搜尋且約 5 分鐘過期，所以快照不保存；按下時優先使用當次頁面快取中未過期的 token，
 * 否則用來源搜尋重新 `/fetch` 一次取得新 token。一次點擊最多一次 whisper 請求，不重試、不排程。
 * token 只存在記憶體，不寫入儲存、log 或錯誤訊息。
 */
import type { PinnedItemSnapshot } from './pinned-items';
import { tradeVersionProfiles } from './trade-context';
import { findTradeRealm } from './trade-realms';

/** token 剩餘有效時間不足這麼久就重新取得，避免送出途中過期 */
const TOKEN_EXPIRY_MARGIN_MS = 15_000;

export type HideoutTravelPhase = 'refreshing' | 'traveling';

export type HideoutTravelOutcome =
  | { status: 'teleporting' }
  /** 有人搶先；再按一次會帶 `continue: true` */
  | { status: 'in-demand' }
  /**
   * 已售出或下架：`/fetch` 回傳 null 或物品帶 `gone: true`（此時 listing 仍帶 token），
   * 或 whisper 回錯誤 code 1（HTTP 404「Item no longer available」）
   */
  | { status: 'sold' }
  /** 拿得到物品但沒有 token：來源搜尋已失效 */
  | { status: 'refresh-required' }
  | { status: 'realm-mismatch' }
  | { status: 'error'; message: string };

export interface PinnedItemFetcher {
  /** 經過限速閘門的 GET；被取消時回傳 null */
  fetch(url: string, init?: RequestInit): Promise<Response | null>;
}

export interface HideoutTravelDeps {
  /** 目前頁面的 origin（請求只能送往同源，才會帶使用者自己的登入 cookie） */
  currentOrigin: string;
  /** 當次頁面快取中的 listing（可能含 token） */
  getCachedListing(id: string): unknown;
  /** 重新 `/fetch` 取得的結果交回快取，讓結果列與其他功能也看到最新資料 */
  rememberResult?(raw: unknown, sourceSearchId: string): void;
  fetchGate: PinnedItemFetcher;
  whisperGate: PinnedItemFetcher;
  now?: () => number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** 解析 JWT payload 的 `exp`（秒）；格式不符時回傳 undefined。不驗證簽章，只用來判斷是否過期 */
export function readTokenExpiryMs(token: unknown): number | undefined {
  if (typeof token !== 'string') return undefined;
  const part = token.split('.')[1];
  if (!part) return undefined;
  try {
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    const payload: unknown = JSON.parse(json);
    const exp = isRecord(payload) ? payload.exp : undefined;
    return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}

function readUsableHideoutToken(listing: unknown, nowMs: number): string | undefined {
  if (!isRecord(listing) || typeof listing.hideout_token !== 'string') return undefined;
  const expiry = readTokenExpiryMs(listing.hideout_token);
  if (expiry === undefined || expiry - TOKEN_EXPIRY_MARGIN_MS <= nowMs) return undefined;
  return listing.hideout_token;
}

function apiBase(snapshot: PinnedItemSnapshot): string {
  return `${snapshot.origin}/api/${tradeVersionProfiles[snapshot.gameVersion].routeRoot}`;
}

export function buildPinnedItemFetchUrl(snapshot: PinnedItemSnapshot, searchId?: string): string {
  const params = new URLSearchParams();
  if (searchId) params.set('query', searchId);
  if (snapshot.gameVersion === 'poe2') params.set('realm', 'poe2');
  const query = params.toString();
  return `${apiBase(snapshot)}/fetch/${encodeURIComponent(snapshot.id)}${query ? `?${query}` : ''}`;
}

/** 釘選物品的來源搜尋網址（開在釘選當時的 realm，物品在那裡刊登）；沒有來源搜尋時回傳 undefined */
export function buildPinnedItemSourceUrl(snapshot: PinnedItemSnapshot): string | undefined {
  if (!snapshot.sourceSearchId) return undefined;
  const profile = tradeVersionProfiles[snapshot.gameVersion];
  const segments = [
    profile.routeRoot,
    'search',
    ...(profile.searchVersionSegment ? [profile.searchVersionSegment] : []),
    encodeURIComponent(snapshot.league),
    encodeURIComponent(snapshot.sourceSearchId),
  ];
  return `${snapshot.origin}/${segments.join('/')}`;
}

/** 快照所屬 realm 是否就是目前頁面的 realm：密語與前往藏身處都只在同一個 realm 有效 */
export function isSameRealm(snapshot: PinnedItemSnapshot, currentOrigin: string): boolean {
  try {
    return findTradeRealm(new URL(currentOrigin).hostname)?.id === snapshot.realm;
  } catch {
    return false;
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function readApiErrorMessage(body: unknown, fallback: string): string {
  if (isRecord(body) && isRecord(body.error) && typeof body.error.message === 'string') {
    return body.error.message.slice(0, 200);
  }
  return fallback;
}

type TokenResult = { token: string } | { outcome: HideoutTravelOutcome };

async function obtainHideoutToken(
  snapshot: PinnedItemSnapshot,
  deps: HideoutTravelDeps,
  nowMs: number,
  onPhaseChange?: (phase: HideoutTravelPhase) => void,
): Promise<TokenResult> {
  const cached = readUsableHideoutToken(deps.getCachedListing(snapshot.id), nowMs);
  if (cached) return { token: cached };
  if (!snapshot.sourceSearchId) return { outcome: { status: 'refresh-required' } };

  onPhaseChange?.('refreshing');
  const response = await deps.fetchGate.fetch(
    buildPinnedItemFetchUrl(snapshot, snapshot.sourceSearchId),
    {
      method: 'GET',
      headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' },
    },
  );
  if (!response) return { outcome: { status: 'error', message: 'Request cancelled' } };
  const body = await readJson(response);
  if (!response.ok) {
    return {
      outcome: { status: 'error', message: readApiErrorMessage(body, `HTTP ${response.status}`) },
    };
  }
  const result = isRecord(body) && Array.isArray(body.result) ? body.result[0] : undefined;
  if (result === null) return { outcome: { status: 'sold' } };
  if (!isRecord(result)) return { outcome: { status: 'error', message: 'Unexpected response' } };
  // 已售出的物品仍會回傳完整資料與 token，只多一個 `gone: true`；不可拿去送 whisper
  if (result.gone === true) return { outcome: { status: 'sold' } };
  deps.rememberResult?.(result, snapshot.sourceSearchId);
  const token = readUsableHideoutToken(result.listing, nowMs);
  return token ? { token } : { outcome: { status: 'refresh-required' } };
}

export async function travelToHideout(
  snapshot: PinnedItemSnapshot,
  deps: HideoutTravelDeps,
  options: { continueInDemand?: boolean; onPhaseChange?: (phase: HideoutTravelPhase) => void } = {},
): Promise<HideoutTravelOutcome> {
  if (!isSameRealm(snapshot, deps.currentOrigin) || snapshot.origin !== deps.currentOrigin) {
    return { status: 'realm-mismatch' };
  }
  try {
    const nowMs = (deps.now ?? Date.now)();
    const tokenResult = await obtainHideoutToken(snapshot, deps, nowMs, options.onPhaseChange);
    if ('outcome' in tokenResult) return tokenResult.outcome;

    options.onPhaseChange?.('traveling');
    const response = await deps.whisperGate.fetch(`${apiBase(snapshot)}/whisper`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        token: tokenResult.token,
        ...(options.continueInDemand ? { continue: true } : {}),
      }),
    });
    if (!response) return { status: 'error', message: 'Request cancelled' };
    const body = await readJson(response);
    if (isRecord(body) && isRecord(body.error)) {
      // code 1 = HTTP 404「Item no longer available」，官方同樣把卡片標成已售出（gone）
      if (body.error.code === 1) return { status: 'sold' };
      return { status: 'error', message: readApiErrorMessage(body, `HTTP ${response.status}`) };
    }
    if (!response.ok) return { status: 'error', message: `HTTP ${response.status}` };
    if (isRecord(body) && body.success === true) return { status: 'teleporting' };
    if (isRecord(body) && body.success === false) return { status: 'in-demand' };
    return { status: 'error', message: 'Unexpected response' };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : String(error) };
  }
}
