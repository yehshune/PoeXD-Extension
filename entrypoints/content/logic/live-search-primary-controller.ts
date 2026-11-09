import {
  createLiveSearchSubscriptionFromUrl,
  type AddSubscriptionOutcome,
  type LiveSearchPrimaryController,
  type LiveSearchPrimaryViewSnapshot,
} from '@/utils/live-search-contract';
import { getTradeLeague } from '@/utils/trade-context';
import type { LiveSearchPrimaryRuntime } from './live-search-primary-runtime';
import { buildFakeTradeResults, buildFallbackDevOwners } from './live-search-dev-fixtures';

/**
 * LiveSearch Primary View 專屬之 Narrow Controller
 *
 * 核心邊界：
 * 1. 隔離 UI 與 Runtime 內部實體，僅暴露唯讀 snapshot 與使用者意圖操作
 * 2. 嚴格透過 canonical domain factory (createLiveSearchSubscriptionFromUrl) 建立 subscription
 * 3. 封裝 URL 解析與格式驗證，無效 URL 零 Host 介入、零 WebSocket 副作用
 */
export function createLiveSearchPrimaryController(
  runtime: LiveSearchPrimaryRuntime,
): LiveSearchPrimaryController {
  return {
    read(): Readonly<LiveSearchPrimaryViewSnapshot> {
      return runtime.getSnapshot();
    },

    subscribe(listener: (snapshot: Readonly<LiveSearchPrimaryViewSnapshot>) => void): () => void {
      return runtime.subscribe(listener);
    },

    async addFromUrl(
      url: string,
      options?: { name?: string; sourceBookmarkId?: string },
    ): Promise<AddSubscriptionOutcome> {
      if (typeof url !== 'string' || !url.trim()) {
        return { success: false, error: '請提供有效的 Trade 搜尋網址' };
      }

      const subscription = createLiveSearchSubscriptionFromUrl(url.trim(), options);
      if (!subscription) {
        return {
          success: false,
          error: '無效的 Trade 搜尋網址，請確認網址格式正確且包含版本、聯盟與搜尋代碼',
        };
      }

      return runtime.addSubscription(subscription);
    },

    retry(subscriptionId: string) {
      if (typeof subscriptionId === 'string' && subscriptionId.trim()) {
        return runtime.retrySubscription(subscriptionId.trim());
      }
      return { success: false, error: '請提供有效的訂閱 ID' };
    },

    remove(subscriptionId: string): void {
      if (typeof subscriptionId === 'string' && subscriptionId.trim()) {
        runtime.removeSubscription(subscriptionId.trim());
      }
    },

    async teardownAll(options?: { targetLeague?: string }): Promise<void> {
      await runtime.teardownAllSubscriptions(options);
    },

    setResultFilter(canonicalKey: string | null): void {
      runtime.setResultFilter(canonicalKey);
    },

    ...(import.meta.env.DEV
      ? {
          async injectDevResults(count, owners) {
            const league =
              runtime.getSubscriptions()[0]?.league ??
              (typeof window !== 'undefined' ? getTradeLeague() : undefined) ??
              runtime.getRuntimeLeague() ??
              '';
            if (!league) return { rendered: 0, failed: 0, error: '無法判斷聯盟' };
            const gameVersion = runtime.getRuntimeGameVersion();
            const resolvedOwners =
              owners && owners.length > 0 ? owners : buildFallbackDevOwners(gameVersion, league);
            return runtime.renderSyntheticResults(
              league,
              buildFakeTradeResults(count, league, gameVersion, resolvedOwners),
            );
          },
        }
      : {}),
  };
}
