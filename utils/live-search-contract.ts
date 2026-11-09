import type { PoeVersion } from './trade-context';
import { parseTradeSearchUrl, stripLiveSuffix } from './trade-search-identity';

/**
 * PoeXD 內部頁面角色契約 (與官方 TradePageMode 'search' | 'live' 分離)
 */
export type TradePageRole = 'normal' | 'live-search-primary';

export const LIVE_SEARCH_PRIMARY_STORAGE_KEY_POE1 = 'poexd_live_search_primary_poe1';
export const LIVE_SEARCH_PRIMARY_STORAGE_KEY_POE2 = 'poexd_live_search_primary_poe2';

export function getLiveSearchPrimaryStorageKey(version: PoeVersion): string {
  return version === 'poe1'
    ? LIVE_SEARCH_PRIMARY_STORAGE_KEY_POE1
    : LIVE_SEARCH_PRIMARY_STORAGE_KEY_POE2;
}

export interface LiveSearchPrimaryStorageRecord {
  tabId: number;
  gameVersion: PoeVersion;
  createdAt: number;
}

export interface LiveSearchOpenPrimaryRequest {
  gameVersion?: PoeVersion;
  active?: boolean;
}

export interface LiveSearchOpenPrimaryResponse {
  success: boolean;
  tabId?: number;
  created?: boolean;
  error?: string;
}

export interface LiveSearchGetPageRoleRequest {
  gameVersion?: PoeVersion;
}

export interface LiveSearchArrivalSignal {
  timestamp: number;
}

export interface LiveSearchGetPageRoleResponse {
  role: TradePageRole;
  primaryTabId?: number;
  arrivalSignal?: boolean;
}

export interface LiveSearchEnqueueItem {
  url: string;
  name?: string;
  coverImageUrl?: string;
  sourceBookmarkId?: string;
}

export interface LiveSearchEnqueueRequest {
  gameVersion?: PoeVersion;
  items: LiveSearchEnqueueItem[];
}

export interface LiveSearchEnqueueResponse {
  success: boolean;
  tabId?: number;
  created?: boolean;
  addedCount?: number;
  skippedCount?: number;
  error?: string;
  rejectReason?: 'mixed-league' | 'wrong-league' | 'wrong-version' | 'invalid-url' | 'failed';
}

export interface LiveSearchConsumePendingEnqueueRequest {
  gameVersion?: PoeVersion;
}

export interface LiveSearchConsumePendingEnqueueResponse {
  items: LiveSearchEnqueueItem[];
}

/**
 * LiveSearch 訂閱狀態
 */
export type LiveSearchSubscriptionStatus =
  | 'idle'
  | 'connecting'
  | 'active'
  | 'reconnecting'
  | 'error'
  | 'closed';

/**
 * LiveSearch 訂閱實體 (純記憶體 Runtime Entity)
 * 嚴格遵守 ADR-0004：不可持久化，不可存入 chrome.storage
 */
export interface LiveSearchSubscription {
  id: string; // 獨立 UUID/unique id，由 domain 產生，絕對不可等於 bookmarkId
  gameVersion: PoeVersion;
  league: string;
  searchId: string;
  url: string; // canonical Trade URL
  name?: string; // 來源搜尋名稱
  sourceBookmarkId?: string; // 僅作為 provenance/reference
  status: LiveSearchSubscriptionStatus;
  errorMessage?: string;
  reconnectInSeconds?: number;
  createdAt: number;
}

/**
 * 依據官方 Trade 網址解析並建立 LiveSearch 訂閱實體
 * 透過既有的 stripLiveSuffix 與 parseTradeSearchUrl 解析，杜絕自創 URL parser
 * 訂閱 ID 由 domain 內部自建，無 customId escape hatch
 */
export function createLiveSearchSubscriptionFromUrl(
  urlValue: string,
  options?: {
    sourceBookmarkId?: string;
    name?: string;
  },
): LiveSearchSubscription | undefined {
  if (typeof urlValue !== 'string' || !urlValue.trim()) return undefined;
  const cleanUrl = stripLiveSuffix(urlValue.trim());
  const parsed = parseTradeSearchUrl(cleanUrl);
  if (!parsed) return undefined;

  const id = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  return {
    id,
    gameVersion: parsed.gameVersion,
    league: parsed.league,
    searchId: parsed.searchId,
    url: cleanUrl,
    name: options?.name,
    sourceBookmarkId: options?.sourceBookmarkId,
    status: 'idle',
    createdAt: Date.now(),
  };
}

export interface SubscriptionIdentityValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * 驗證 Subscription identity 與 canonical URL 的一致性
 * 確保 url, gameVersion, league, searchId 描述同一個 Trade search，且 id !== sourceBookmarkId
 */
export function validateSubscriptionIdentity(
  subscription: LiveSearchSubscription,
): SubscriptionIdentityValidationResult {
  if (!subscription || typeof subscription !== 'object') {
    return { valid: false, error: 'Subscription must be an object' };
  }

  if (typeof subscription.id !== 'string' || !subscription.id.trim()) {
    return { valid: false, error: 'Subscription id must be a non-empty string' };
  }

  if (
    typeof subscription.sourceBookmarkId === 'string' &&
    subscription.sourceBookmarkId.trim() &&
    subscription.id.trim() === subscription.sourceBookmarkId.trim()
  ) {
    return {
      valid: false,
      error: `Subscription identity violation: subscription id '${subscription.id}' cannot equal sourceBookmarkId`,
    };
  }

  if (typeof subscription.url !== 'string' || !subscription.url.trim()) {
    return { valid: false, error: 'Subscription url must be a non-empty string' };
  }

  const cleanUrl = stripLiveSuffix(subscription.url.trim());
  const parsed = parseTradeSearchUrl(cleanUrl);
  if (!parsed) {
    return {
      valid: false,
      error: `Invalid subscription url: unable to parse valid trade search from '${subscription.url}'`,
    };
  }

  if (parsed.gameVersion !== subscription.gameVersion) {
    return {
      valid: false,
      error: `Canonical identity mismatch: url implies gameVersion '${parsed.gameVersion}', but subscription declares '${subscription.gameVersion}'`,
    };
  }

  if (parsed.searchId !== subscription.searchId?.trim()) {
    return {
      valid: false,
      error: `Canonical identity mismatch: url implies searchId '${parsed.searchId}', but subscription declares '${subscription.searchId}'`,
    };
  }

  if (parsed.league.toLowerCase() !== subscription.league?.trim().toLowerCase()) {
    return {
      valid: false,
      error: `Canonical identity mismatch: url implies league '${parsed.league}', but subscription declares '${subscription.league}'`,
    };
  }

  return { valid: true };
}

export interface AddSubscriptionOutcome {
  success: boolean;
  error?: string;
}

export interface LiveSearchRetryOutcome {
  success: boolean;
  error?: string;
}

export interface TradeRateLimitWindow {
  limit: number;
  window: number;
  cooldown: number;
  used: number;
  windowLeft: number;
  cooldownLeft: number;
}

export interface TradeRateLimitStateSnapshot {
  policy: string | null;
  rules: Record<string, TradeRateLimitWindow[]>;
  nextAllowedAtMs: number;
  observedAtMs?: number;
}

export interface LiveSearchPrimaryViewSnapshot {
  gameVersion: PoeVersion;
  runtimeLeague: string | null;
  cumulativeRenderedTotal: number;
  subscriptions: Readonly<LiveSearchSubscription>[];
  rateLimit: Readonly<TradeRateLimitStateSnapshot>;
  /** 目前僅顯示此連線（canonical key）的結果；省略表示顯示全部 */
  resultFilterKey?: string;
}

export interface LiveSearchDevResultOwner {
  canonicalKey: string;
  searchId: string;
}

export interface LiveSearchDevInjectOutcome {
  rendered: number;
  failed: number;
  error?: string;
}

export interface LiveSearchPrimaryController {
  read(): Readonly<LiveSearchPrimaryViewSnapshot>;
  subscribe(listener: (snapshot: Readonly<LiveSearchPrimaryViewSnapshot>) => void): () => void;
  addFromUrl(
    url: string,
    options?: { name?: string; sourceBookmarkId?: string },
  ): Promise<AddSubscriptionOutcome>;
  retry(subscriptionId: string): LiveSearchRetryOutcome;
  remove(subscriptionId: string): void;
  teardownAll(options?: { targetLeague?: string }): Promise<void>;
  /** 僅顯示指定連線（canonical key）的結果；null 顯示全部 */
  setResultFilter?(canonicalKey: string | null): void;
  /** 開發模式專用：注入假結果至官方展示區（不連線、不 fetch） */
  injectDevResults?(
    count: number,
    owners?: readonly LiveSearchDevResultOwner[],
  ): Promise<LiveSearchDevInjectOutcome>;
}
