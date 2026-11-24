import type { PoeVersion } from '@/utils/trade-context';
import type { TradeLeague } from '@/utils/trade-leagues';
import type { enqueueLiveSearchConnections } from '@/utils/extension-protocol';

export type BookmarkToastTone = 'default' | 'error';

export type BookmarkEnqueueRequest = Parameters<typeof enqueueLiveSearchConnections>[0];
export type BookmarkEnqueueOptions = NonNullable<
  Parameters<typeof enqueueLiveSearchConnections>[1]
>;
export type BookmarkEnqueueResponse = Awaited<ReturnType<typeof enqueueLiveSearchConnections>>;

/** 結果圖片事件（Trade 頁面回報目前搜尋結果的圖片）。 */
export interface BookmarkCoverCapture {
  url: string;
  images: unknown;
}

/** 目前頁面的位置：網址與原始分頁標題（空字串代表沒有）。 */
export interface BookmarkPageLocation {
  url: string;
  title: string;
}

export interface BookmarkNavigationHost {
  /** 在目前分頁或新分頁開啟網址。 */
  navigate(url: string, target: 'current' | 'new-tab'): void;
  /** 將官方搜尋表單寫入網址並回傳同步後的網址（ADR-0010）；失敗時 reject。 */
  syncUrl(): Promise<string>;
  readLocation(): BookmarkPageLocation;
  /** 目前頁面路由改變（popstate / 官方站內導航）時通知；回傳取消訂閱。 */
  subscribeRouteChange(listener: () => void): () => void;
}

export interface BookmarkFeedbackHost {
  confirm(message: string, title: string): Promise<boolean>;
  alert(message: string, title: string): Promise<void>;
  toast(message: string, tone?: BookmarkToastTone): void;
}

export interface BookmarkSourcesHost {
  /** 取得可選聯盟清單。 */
  fetchLeagues(version: PoeVersion): Promise<TradeLeague[]>;
  /** 訂閱 Trade 頁面的封面圖片事件；回傳取消訂閱。 */
  subscribeCoverCapture(listener: (capture: BookmarkCoverCapture) => void): () => void;
  /** 請 Trade 頁面重新回報封面圖片。 */
  requestCoverCapture(): void;
  /** 直接從目前結果列讀取封面圖片（未驗證）。 */
  readResultCoverImages(): string[];
  /** 送入線上搜尋主控台。 */
  enqueue(
    request: BookmarkEnqueueRequest,
    options: BookmarkEnqueueOptions,
  ): Promise<BookmarkEnqueueResponse>;
}

/**
 * Bookmark Workspace 與瀏覽器、Chrome、DOM 互動的唯一出口，依職責分組。
 * 持久化不在此：Workspace 仍透過既有的 Bookmark model / messaging 路徑寫入。
 */
export interface BookmarkWorkspaceHost {
  navigation: BookmarkNavigationHost;
  feedback: BookmarkFeedbackHost;
  sources: BookmarkSourcesHost;
}
