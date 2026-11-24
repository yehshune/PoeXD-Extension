import type { TradeLeague } from '@/utils/trade-leagues';
import type {
  BookmarkCoverCapture,
  BookmarkEnqueueOptions,
  BookmarkEnqueueRequest,
  BookmarkEnqueueResponse,
  BookmarkToastTone,
  BookmarkWorkspaceHost,
} from './host';

export interface FakeBookmarkWorkspaceHost extends BookmarkWorkspaceHost {
  /** 測試可讀寫的內部狀態與呼叫紀錄。 */
  readonly state: {
    location: { url: string; title: string };
    leagues: TradeLeague[] | Error;
    leagueFetchCount: number;
    resultCoverImages: string[];
    confirmAnswer: boolean;
    syncedUrl: string | Error;
    enqueueResponse: BookmarkEnqueueResponse | Error;
    navigations: Array<{ url: string; target: 'current' | 'new-tab' }>;
    confirms: Array<{ message: string; title: string }>;
    alerts: Array<{ message: string; title: string }>;
    toasts: Array<{ message: string; tone: BookmarkToastTone }>;
    enqueues: Array<{ request: BookmarkEnqueueRequest; options: BookmarkEnqueueOptions }>;
    coverCaptureRequests: number;
  };
  /** 模擬 Trade 頁面回報結果圖片。 */
  emitCoverCapture(capture: BookmarkCoverCapture): void;
  /** 模擬頁面路由改變（popstate / 站內導航）。 */
  emitRouteChange(): void;
}

/** In-memory fake adapter：Bookmark Workspace 測試用，不碰 window / DOM / Chrome。 */
export function createFakeBookmarkWorkspaceHost(
  overrides: Partial<FakeBookmarkWorkspaceHost['state']> = {},
): FakeBookmarkWorkspaceHost {
  const state: FakeBookmarkWorkspaceHost['state'] = {
    location: { url: '', title: '' },
    leagues: [],
    leagueFetchCount: 0,
    resultCoverImages: [],
    confirmAnswer: true,
    syncedUrl: '',
    enqueueResponse: { success: true, created: false } as BookmarkEnqueueResponse,
    navigations: [],
    confirms: [],
    alerts: [],
    toasts: [],
    enqueues: [],
    coverCaptureRequests: 0,
    ...overrides,
  };
  const coverListeners = new Set<(capture: BookmarkCoverCapture) => void>();
  const routeListeners = new Set<() => void>();

  return {
    state,
    navigation: {
      navigate: (url, target) => {
        state.navigations.push({ url, target });
      },
      syncUrl: async () => {
        if (state.syncedUrl instanceof Error) throw state.syncedUrl;
        return state.syncedUrl;
      },
      readLocation: () => ({ ...state.location }),
      subscribeRouteChange: (listener) => {
        routeListeners.add(listener);
        return () => routeListeners.delete(listener);
      },
    },
    feedback: {
      confirm: async (message, title) => {
        state.confirms.push({ message, title });
        return state.confirmAnswer;
      },
      alert: async (message, title) => {
        state.alerts.push({ message, title });
      },
      toast: (message, tone = 'default') => {
        state.toasts.push({ message, tone });
      },
    },
    sources: {
      fetchLeagues: async () => {
        state.leagueFetchCount++;
        if (state.leagues instanceof Error) throw state.leagues;
        return state.leagues;
      },
      subscribeCoverCapture: (listener) => {
        coverListeners.add(listener);
        return () => coverListeners.delete(listener);
      },
      requestCoverCapture: () => {
        state.coverCaptureRequests++;
      },
      readResultCoverImages: () => [...state.resultCoverImages],
      enqueue: async (request, options) => {
        state.enqueues.push({ request, options });
        if (state.enqueueResponse instanceof Error) throw state.enqueueResponse;
        return state.enqueueResponse;
      },
    },
    emitCoverCapture: (capture) => coverListeners.forEach((listener) => listener(capture)),
    emitRouteChange: () => routeListeners.forEach((listener) => listener()),
  };
}
