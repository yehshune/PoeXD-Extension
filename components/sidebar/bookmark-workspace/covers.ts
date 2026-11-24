import { ref, type Ref } from 'vue';
import type { Bookmark } from '../bookmark-types';
import type { BookmarkMutationIntent } from '../bookmark-model';
import { isSameTradeSearchPageUrl, parseTradeSearchUrl } from '@/utils/trade-search-identity';
import { isValidPoeCdnImageUrl } from '@/utils/poe-cdn-url';
import { t } from '@/utils/i18n';
import type { BookmarkWorkspaceHost } from './host';

export interface BookmarkCoversDeps {
  host: BookmarkWorkspaceHost;
  execute: (intent: BookmarkMutationIntent) => Promise<boolean>;
  isMoveSubMenu: Ref<boolean>;
  isCoverSubMenu: Ref<boolean>;
  closeAllMenus: () => void;
}

/** Workspace 內部的封面部件（沒有獨立的公開 interface）；DOM 與事件都經由 Host。 */
export function createBookmarkCovers(deps: BookmarkCoversDeps) {
  const { host, execute, isMoveSubMenu, isCoverSubMenu, closeAllMenus } = deps;

  const resultImagesUrl = ref('');
  const resultImages = ref<string[]>([]);
  const currentTabInfo = ref({ title: '', url: '' });
  const isCoverSubmenuChecking = ref(false);

  /** 開始接收 Trade 頁面回報的結果圖片（只保留合法 PoE CDN 網址）。 */
  const startCapture = (): (() => void) => {
    const stop = host.sources.subscribeCoverCapture((capture) => {
      resultImagesUrl.value = capture.url;
      resultImages.value = Array.isArray(capture.images)
        ? capture.images.filter((img): img is string => isValidPoeCdnImageUrl(img))
        : [];
    });
    host.sources.requestCoverCapture();
    return stop;
  };

  const fetchCurrentTab = async (): Promise<void> => {
    try {
      const location = host.navigation.readLocation();
      currentTabInfo.value.title = location.title || t('bookmark.defaultPageTitle');
      currentTabInfo.value.url = location.url || '';
    } catch (err) {
      console.error('無法取得分頁資訊:', err);
    }
  };

  const sameSearchPage = (leftUrl: string, rightUrl: string): boolean =>
    isSameTradeSearchPageUrl(leftUrl, rightUrl);

  const isValidCoverUrl = isValidPoeCdnImageUrl;

  const extractCoverImagesFromDom = (): string[] => {
    const images: string[] = [];
    for (const src of host.sources.readResultCoverImages()) {
      if (isValidCoverUrl(src) && !images.includes(src)) images.push(src);
    }
    return images;
  };

  const getResultImagesForUrl = (url: string): string[] => {
    const candidates: string[] = [];
    const appendUnique = (images: readonly string[]) => {
      for (const img of images) {
        if (!candidates.includes(img)) candidates.push(img);
      }
    };
    let domImages: string[] | null = null;
    const readDomImages = () => (domImages ??= extractCoverImagesFromDom());

    if (sameSearchPage(resultImagesUrl.value, url)) {
      appendUnique(resultImages.value);
    }
    const currentUrl = currentTabInfo.value.url || host.navigation.readLocation().url;
    if (sameSearchPage(currentUrl, url)) {
      appendUnique(readDomImages());
    }
    if (candidates.length === 0) {
      const left = parseTradeSearchUrl(currentUrl);
      const right = parseTradeSearchUrl(url);
      if (!left || !right || left.gameVersion === right.gameVersion) {
        // 只沿用「目前頁面」的結果圖片；舊搜尋留下的快取不可當作封面候選
        if (resultImages.value.length > 0 && sameSearchPage(resultImagesUrl.value, currentUrl)) {
          appendUnique(resultImages.value);
        }
        appendUnique(readDomImages());
      }
    }
    return candidates;
  };

  const getResultImagesForBookmark = (bookmark: Bookmark): string[] =>
    getResultImagesForUrl(bookmark.url);

  const requestOpenCoverSubMenu = async (_bookmark: Bookmark): Promise<void> => {
    if (isCoverSubmenuChecking.value) return;
    isCoverSubmenuChecking.value = true;
    try {
      await fetchCurrentTab();
      host.sources.requestCoverCapture();
      isMoveSubMenu.value = false;
      isCoverSubMenu.value = true;
    } finally {
      isCoverSubmenuChecking.value = false;
    }
  };

  const handleCoverSubmenuKeydown = (event: KeyboardEvent, bookmark: Bookmark): void => {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowRight') {
      event.preventDefault();
      void requestOpenCoverSubMenu(bookmark);
    }
  };

  const selectBookmarkCover = async (bookmark: Bookmark, imageUrl: string): Promise<void> => {
    if (!isValidPoeCdnImageUrl(imageUrl)) return;
    if (
      !(await execute({
        type: 'set-bookmark-cover',
        bookmarkId: bookmark.id,
        coverImageUrl: imageUrl,
      }))
    )
      return;
    closeAllMenus();
  };

  const removeBookmarkCover = async (bookmark: Bookmark): Promise<void> => {
    if (!(await execute({ type: 'set-bookmark-cover', bookmarkId: bookmark.id }))) return;
    closeAllMenus();
  };

  const handleCoverImageError = (event: Event): void => {
    (event.currentTarget as HTMLImageElement).style.visibility = 'hidden';
  };

  return {
    resultImagesUrl,
    resultImages,
    currentTabInfo,
    isCoverSubmenuChecking,
    startCapture,
    fetchCurrentTab,
    getResultImagesForUrl,
    getResultImagesForBookmark,
    requestOpenCoverSubMenu,
    handleCoverSubmenuKeydown,
    selectBookmarkCover,
    removeBookmarkCover,
    handleCoverImageError,
  };
}
