import { defineExtensionMessaging } from '@webext-core/messaging';
import type { PoeVersion } from './trade-context';
import { withTimeout } from './promise-timeout';
import type {
  BookmarkChange,
  BookmarkCommand,
  BookmarkRead,
  BookmarkReadOutcome,
} from './bookmark-coordinator';
import type {
  EconomyChange,
  EconomyMetadataRequest,
  EconomyRateMetadata,
  EconomyRateOutcome,
  EconomyRateRequest,
} from './economy';
import type {
  SearchRecordChange,
  SearchRecordCommand,
  SearchRecordOutcome,
  SearchRecordRead,
  SearchRecordReadOutcome,
} from './search-records';
import type {
  LiveSearchArrivalSignal,
  LiveSearchConsumePendingEnqueueRequest,
  LiveSearchConsumePendingEnqueueResponse,
  LiveSearchEnqueueItem,
  LiveSearchEnqueueRequest,
  LiveSearchEnqueueResponse,
  LiveSearchGetPageRoleRequest,
  LiveSearchGetPageRoleResponse,
  LiveSearchOpenPrimaryRequest,
  LiveSearchOpenPrimaryResponse,
} from './live-search-contract';
import type { PobbinAssetJson, PobShareFetchOutcome } from './pob-share-fetch';
import type {
  MarketTranslationRefreshOutcome,
  MarketTranslationRefreshRequest,
} from './market-translation-live';

export interface ExtensionProtocolMap {
  'searchRecord:execute': (command: SearchRecordCommand) => SearchRecordOutcome;
  'searchRecord:read': (read: SearchRecordRead) => SearchRecordReadOutcome;
  'searchRecord:change': (change: SearchRecordChange) => void;
  'bookmark:execute': (command: BookmarkCommand) => SearchRecordOutcome;
  'bookmark:read': (read: BookmarkRead) => BookmarkReadOutcome;
  'bookmark:change': (change: BookmarkChange) => void;
  'economy:fetchCurrencyRates': (request: EconomyRateRequest) => EconomyRateOutcome;
  'economy:getRateMetadata': (request: EconomyMetadataRequest) => EconomyRateMetadata;
  'economy:change': (change: EconomyChange) => void;
  'liveSearch:openPrimary': (
    request?: LiveSearchOpenPrimaryRequest,
  ) => LiveSearchOpenPrimaryResponse;
  'liveSearch:getPageRole': (
    request?: LiveSearchGetPageRoleRequest,
  ) => LiveSearchGetPageRoleResponse;
  'liveSearch:notifyArrival': (signal: LiveSearchArrivalSignal) => void;
  'liveSearch:enqueueConnections': (request: LiveSearchEnqueueRequest) => LiveSearchEnqueueResponse;
  'liveSearch:receiveEnqueuedConnections': (request: {
    batchId?: string;
    gameVersion?: PoeVersion;
    items: LiveSearchEnqueueItem[];
  }) => LiveSearchEnqueueResponse;
  'liveSearch:consumePendingEnqueue': (
    request?: LiveSearchConsumePendingEnqueueRequest,
  ) => LiveSearchConsumePendingEnqueueResponse;
  'marketTranslation:refresh': (
    request: MarketTranslationRefreshRequest,
  ) => MarketTranslationRefreshOutcome;
  /** 取回 PoB 分享網址的原始代碼（網址在 background 重新驗證） */
  'pobShare:fetchCode': (request: { url: string }) => PobShareFetchOutcome;
  /** 開啟選用權限的授權頁 */
  'pobShare:openPermissionPage': () => boolean;
  /** pobb.in 翻譯腳本讀取擴充內建的資料檔（路徑與來源分頁在 background 驗證） */
  'pobbin:loadAsset': (request: { path: string }) => PobbinAssetJson;
}

export const extensionMessaging = defineExtensionMessaging<ExtensionProtocolMap>();

export const DEFAULT_ENQUEUE_IPC_TIMEOUT_MS = 10000;

export interface EnqueueLiveSearchConnectionsOptions {
  timeoutMs?: number;
  timeoutMessage?: string;
}

/**
 * Send a live-search enqueue request with a hard client-side timeout so UI buttons
 * cannot remain permanently disabled if the background worker or IPC stalls.
 */
export function enqueueLiveSearchConnections(
  request: LiveSearchEnqueueRequest,
  options: EnqueueLiveSearchConnectionsOptions = {},
): Promise<LiveSearchEnqueueResponse> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_ENQUEUE_IPC_TIMEOUT_MS;
  const timeoutMessage =
    options.timeoutMessage ?? `Live search enqueue request timed out after ${timeoutMs}ms`;
  return withTimeout(
    extensionMessaging.sendMessage('liveSearch:enqueueConnections', request),
    timeoutMs,
    timeoutMessage,
  );
}
