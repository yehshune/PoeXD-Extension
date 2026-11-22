import type { BookmarkCollectionView, BookmarkReadOutcome } from '@/utils/bookmark-coordinator';
import type { PoeVersion } from '@/utils/trade-context';
import type { ParsedTradeSearchIdentity } from '@/utils/trade-search-identity';
import type {
  AddSubscriptionOutcome,
  LiveSearchEnqueueItem,
  LiveSearchEnqueueResponse,
  LiveSearchRetryOutcome,
  LiveSearchSubscription,
  LiveSearchSubscriptionStatus,
} from '@/utils/live-search-contract';
import type { LiveSearchResumeStore } from '@/utils/live-search-resume-store';
import type { TradeLeague } from '@/utils/trade-leagues';
import type { PreferencesModule } from '@/utils/preferences';
import type { TradeSearchCriteriaKeyResolver } from '@/utils/trade-search-criteria-key';
import type { DedupEntry } from './connection-dedup';

export interface LiveSearchSourceControllerOptions {
  resumeStore?: LiveSearchResumeStore | null;
  preferences?: PreferencesModule | null;
  fetchLeagues?: (version: PoeVersion) => Promise<TradeLeague[]>;
  initialLeague?: string;
  /** 搜尋條件鍵解析器（相同搜尋條件去重用），預設以解碼 search ID 取得 */
  criteriaKeyResolver?: TradeSearchCriteriaKeyResolver;
}

/**
 * 最小唯讀 Bookmark Port 介面
 * 避免依賴肥大的 BookmarkModel，由 createChromeBookmarkClient 結構性滿足
 */
export interface LiveSearchBookmarkSourcePort {
  readCollection(): Promise<BookmarkReadOutcome<BookmarkCollectionView>>;
  subscribe(listener: () => void): () => void;
}

export type LiveSearchSourceKind = 'bookmark' | 'custom';

export type LiveSearchSourceStatusFilter = 'all' | 'enabled' | 'disabled' | 'error';

export type LiveSearchSourceCompatibility =
  | 'compatible'
  | 'invalid-url'
  | 'wrong-version'
  | 'wrong-league';

export type LiveSearchBatchRejectReason = 'disposed' | 'not-ready' | 'mixed-league';

export interface LiveSearchBatchSkipCounts {
  alreadyActive: number;
  pending: number;
  incompatible: number;
  duplicateInBatch: number;
  notFound: number;
  inactive: number;
}

export interface LiveSearchBatchIncompatibleBreakdown {
  invalidUrl: number;
  wrongVersion: number;
  wrongLeague: number;
}

export interface LiveSearchBatchOutcome {
  success: boolean;
  requested: number;
  succeeded: number;
  skipped: number;
  failed: number;
  rejectReason?: LiveSearchBatchRejectReason;
  involvedLeagues?: string[];
  error?: string;
  skipReasons: LiveSearchBatchSkipCounts;
  incompatibleBreakdown: LiveSearchBatchIncompatibleBreakdown;
  runtimeFailureCount: number;
}

export const TEMPORARY_SOURCE_GROUP_ID = 'custom_sources';
export const TEMPORARY_SOURCE_GROUP_NAME = '暫時搜尋';
export const SESSION_CONNECTIONS_GROUP_ID = 'session_connections';
export const SESSION_CONNECTIONS_GROUP_NAME = '本次連線';
export const PREVIOUS_CONNECTIONS_GROUP_ID = 'previous_connections';
export const PREVIOUS_CONNECTIONS_GROUP_NAME = '上次連線';
export const SESSION_SOURCE_ID_PREFIX = 'session_';
export const PREVIOUS_SOURCE_ID_PREFIX = 'prev_';

export type LiveSearchSourceProvenance = 'origin-bookmark-removed';

export interface LiveSearchSourceItem {
  kind: LiveSearchSourceKind;
  id: string;
  name: string;
  url: string;
  canonicalIdentity: ParsedTradeSearchIdentity | null;
  canonicalKey: string | null;
  compatibility: LiveSearchSourceCompatibility;
  compatibilityMessage?: string;
  groupId: string;
  groupName: string;
  status?: LiveSearchSubscriptionStatus;
  pending: boolean;
  subscriptionId?: string;
  errorMessage?: string;
  reconnectInSeconds?: number;
  removable: boolean;
  provenance?: LiveSearchSourceProvenance;
  provenanceMessage?: string;
  coverImageUrl?: string;
}

export interface LiveSearchSourceGroup {
  id: string;
  name: string;
  kind: LiveSearchSourceKind;
  parentId?: string;
  order?: number;
  depth?: number;
  items: LiveSearchSourceItem[];
}

export interface LiveSearchSourceSnapshot {
  loading: boolean;
  error?: string;
  groups: LiveSearchSourceGroup[];
  sessionConnections?: LiveSearchSourceItem[];
  previousConnections?: LiveSearchSourceItem[];
  selectedLeague: string;
  availableLeagues: readonly string[];
  isSwitchingLeague: boolean;
  leagueResolved: boolean;
}

export interface LiveSearchSourceController {
  read(): Readonly<LiveSearchSourceSnapshot>;
  subscribe(listener: (snapshot: Readonly<LiveSearchSourceSnapshot>) => void): () => void;
  /**
   * 啟用指定搜尋來源 (Bookmark、本次連線、上次連線或 Temporary Search)
   */
  enable(sourceId: string): Promise<AddSubscriptionOutcome>;
  /**
   * 批次啟用多筆搜尋來源（含相容性 preflight、canonical dedup 與未鎖聯盟 mixed-league 原子拒絕）
   */
  enableMany(sourceIds: readonly string[]): Promise<LiveSearchBatchOutcome>;
  /**
   * 批次停止多筆搜尋來源之 Runtime 連線（保留於本次連線為已暫停，並維持已鎖定聯盟）
   */
  stopMany(sourceIds: readonly string[]): LiveSearchBatchOutcome;
  /**
   * 建立自訂 URL 搜尋來源並立即加入本次連線與啟用
   */
  addTemporarySearch(
    url: string,
    options?: { name?: string; coverImageUrl?: string },
  ): Promise<AddSubscriptionOutcome>;
  /**
   * 接收由一般頁面背景派送的搜尋連線清單，加入本次連線並啟動監聽
   */
  enqueueIncomingConnections?(
    items: readonly LiveSearchEnqueueItem[],
  ): Promise<LiveSearchEnqueueResponse>;
  /**
   * 停止指定來源或訂閱之 Runtime 連線（保留於本次連線中顯示為已暫停）
   */
  stop(sourceOrSubscriptionId: string): void;
  /**
   * 重試處於 error 狀態的來源連線
   */
  retry(sourceOrSubscriptionId: string): LiveSearchRetryOutcome;
  /**
   * 移除自訂 URL 來源；若移除時仍 active，先安全停止其 Runtime subscription 再移除來源
   */
  removeTemporarySearch(sourceId: string): boolean;
  /**
   * 從「本次連線」移除項目；若仍在監聽中則先安全停止 WebSocket
   */
  removeSessionConnection?(sourceOrSubscriptionId: string): boolean;
  /**
   * 從「上次連線」移除單筆紀錄
   */
  removePreviousConnection?(sourceIdOrCanonicalKey: string): Promise<boolean>;
  /**
   * 一鍵恢復目前聯盟所有「上次連線」至「本次連線」
   */
  restoreAllPreviousConnections?(): Promise<LiveSearchBatchOutcome>;
  /**
   * 清空「上次連線」紀錄
   */
  clearPreviousConnections?(): Promise<boolean>;
  /**
   * 系統性切換工作區聯盟（teardown 目前連線、解鎖 runtimeLeague、保留 Resume Intent 並切換 context）
   */
  switchLeague(targetLeague: string): Promise<boolean>;
  getSelectedLeague(): string;
  getAvailableLeagues(): readonly string[];
  readonly resumeStore?: LiveSearchResumeStore | null;
  dispose(): void;
}

export interface LiveSearchSourceFilterOptions {
  query?: string;
  statusFilter?: LiveSearchSourceStatusFilter;
}

export interface LiveSearchPrimaryContext {
  gameVersion: PoeVersion;
  runtimeLeague: string | null;
}

export interface TemporarySearchRecord {
  id: string;
  name: string;
  url: string;
  canonicalIdentity: ParsedTradeSearchIdentity;
  canonicalKey: string;
  createdAt: number;
  provenance?: LiveSearchSourceProvenance;
  coverImageUrl?: string;
}

export interface SessionConnectionMeta {
  canonicalKey: string;
  canonicalIdentity: ParsedTradeSearchIdentity;
  name: string;
  url: string;
  coverImageUrl?: string;
  sourceBookmarkId?: string;
}

export type CriteriaRedirect =
  | { kind: 'error'; error: string }
  | { kind: 'source'; sourceId: string }
  | { kind: 'adopt-meta'; entry: DedupEntry };

/**
 * Controller 核心狀態與通知 Port，供 league-manager 共用
 */
export interface LiveSearchControllerBasePort {
  readonly hasSource: boolean;
  isDisposed(): boolean;
  isReloadPending(): boolean;
  waitForReconciliationDrain(): Promise<void>;
  getGameVersion(): PoeVersion;
  getCurrentCollection(): BookmarkCollectionView | null;
  notify(): void;
}

/**
 * 內部操作協作上下文（供 activator / batch-executor / source-intake 共用）
 * 僅提供生命週期守衛、聯盟世代與通知，不暴露任何裸露可變集合
 */
export interface LiveSearchOperationContext {
  isDisposed(): boolean;
  isSwitchingLeague(): boolean;
  ensureReady(): Promise<void> | undefined;
  waitForReloadDrain(): Promise<void> | undefined;
  getGameVersion(): PoeVersion;
  getSelectedLeague(): string;
  getTransitionGeneration(): number;
  getPrimaryContext(): LiveSearchPrimaryContext;
  getCurrentCollection(): BookmarkCollectionView | null;
  getCurrentLiveSubscriptions(): readonly Readonly<LiveSearchSubscription>[];
  findActiveSubByCanonicalKey(canonicalKey: string): Readonly<LiveSearchSubscription> | undefined;
  resolveSubscriptionId(sourceOrSubscriptionId: string): string | undefined;
  resolveCriteriaRedirect(
    identity: ParsedTradeSearchIdentity,
    canonicalKey: string,
    incomingCover: string | undefined,
  ): Promise<CriteriaRedirect | null>;
  notify(): void;
}
