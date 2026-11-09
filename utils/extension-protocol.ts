import { defineExtensionMessaging } from '@webext-core/messaging';
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
    gameVersion?: PoeVersion;
    items: LiveSearchEnqueueItem[];
  }) => LiveSearchEnqueueResponse;
  'liveSearch:consumePendingEnqueue': (
    request?: LiveSearchConsumePendingEnqueueRequest,
  ) => LiveSearchConsumePendingEnqueueResponse;
}

export const extensionMessaging = defineExtensionMessaging<ExtensionProtocolMap>();
