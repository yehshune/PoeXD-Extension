import type { BookmarkCollectionView } from '@/utils/bookmark-coordinator';
import { t } from '@/utils/i18n';
import {
  getTradeSearchCanonicalKey,
  parseTradeSearchUrl,
  stripLiveSuffix,
} from '@/utils/trade-search-identity';
import type { LiveSearchSubscription } from '@/utils/live-search-contract';
import type { LiveSearchResumeIdentity } from '@/utils/live-search-resume-store';
import { hasValidCover } from './connection-dedup';
import type { TemporarySearchRecord, SessionConnectionMeta } from './types';

/**
 * 內部輔助：調和 Temporary Search 與 Bookmark 之間的歸屬關係
 * （僅由 LiveSearchConnectionRegistry 呼叫）
 */
export function reconcileRegistryOwnership(
  collection: BookmarkCollectionView | null,
  liveSubscriptions: readonly Readonly<LiveSearchSubscription>[],
  temporarySearches: TemporarySearchRecord[],
  sessionEntriesByKey: Map<string, SessionConnectionMeta>,
  findActiveSub: (canonicalKey: string) => Readonly<LiveSearchSubscription> | undefined,
): LiveSearchResumeIdentity[] {
  const bookmarkCanonicalKeys = new Set<string>();
  if (collection) {
    const bookmarksByKey = new Map<string, typeof collection.bookmarks>();
    for (const b of collection.bookmarks) {
      const parsed = parseTradeSearchUrl(stripLiveSuffix(b.url));
      if (parsed) {
        const key = getTradeSearchCanonicalKey(parsed);
        bookmarkCanonicalKeys.add(key);
        const list = bookmarksByKey.get(key);
        if (list) list.push(b);
        else bookmarksByKey.set(key, [b]);
      }
    }

    for (const [key, sessionMeta] of sessionEntriesByKey.entries()) {
      const candidates = bookmarksByKey.get(key);
      if (!candidates || candidates.length === 0) {
        // 來源書籤已被刪除或覆蓋為其他搜尋時，清除過期 sourceBookmarkId，改以暫時搜尋／session 身分運作
        sessionMeta.sourceBookmarkId = undefined;
        continue;
      }
      const preferred =
        (sessionMeta.sourceBookmarkId
          ? candidates.find((c) => c.id === sessionMeta.sourceBookmarkId)
          : undefined) ?? candidates[0];
      if (preferred) {
        sessionMeta.name = preferred.name;
        sessionMeta.url = preferred.url;
        sessionMeta.sourceBookmarkId = preferred.id;
        if (hasValidCover(preferred.coverImageUrl)) {
          sessionMeta.coverImageUrl = preferred.coverImageUrl;
        }
      }
    }
  }

  const promotedResumeIdentities: LiveSearchResumeIdentity[] = [];

  // 1. Temporary Search -> Bookmark Promotion
  for (let i = temporarySearches.length - 1; i >= 0; i--) {
    if (bookmarkCanonicalKeys.has(temporarySearches[i].canonicalKey)) {
      const promoted = temporarySearches[i];
      const activeSub = findActiveSub(promoted.canonicalKey);
      if (activeSub && activeSub.status !== 'closed') {
        promotedResumeIdentities.push({
          gameVersion: promoted.canonicalIdentity.gameVersion,
          league: promoted.canonicalIdentity.league,
          searchId: promoted.canonicalIdentity.searchId,
        });
      }
      temporarySearches.splice(i, 1);
    }
  }

  // 2. Active Bookmark Deletion / Canonical Split Fallback -> Temporary Search
  for (const sub of liveSubscriptions) {
    if (sub.status === 'closed') continue;
    const subKey = getTradeSearchCanonicalKey({
      gameVersion: sub.gameVersion,
      league: sub.league,
      searchId: sub.searchId,
    });
    if (bookmarkCanonicalKeys.has(subKey)) continue;
    if (!temporarySearches.some((c) => c.canonicalKey === subKey)) {
      temporarySearches.push({
        id: `custom_fallback_${sub.id}`,
        name: sub.name || t('liveSearch.defaultSearchName'),
        url: sub.url,
        canonicalIdentity: {
          gameVersion: sub.gameVersion,
          league: sub.league,
          searchId: sub.searchId,
        },
        canonicalKey: subKey,
        createdAt: Date.now(),
        provenance: 'origin-bookmark-removed',
      });
    }
  }

  return promotedResumeIdentities;
}
