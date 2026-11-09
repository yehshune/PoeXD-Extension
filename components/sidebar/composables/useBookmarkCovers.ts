import { ref, onMounted, onUnmounted, getCurrentInstance, type Ref } from 'vue';
import type { Bookmark } from '../bookmark-types';
import type { BookmarkMutationIntent } from '../bookmark-model';
import { dispatchPoeEvent, listenPoeEvent } from '@/utils/event-contracts';
import { parseTradeSearchUrl, stripLiveSuffix } from '@/utils/trade-search-identity';
import { isValidPoeCdnImageUrl } from '@/utils/poe-cdn-url';

export interface UseBookmarkCoversOptions {
  executeBookmarkIntent: (intent: BookmarkMutationIntent) => Promise<boolean>;
  activeBookmarkMenuId: Ref<string | null>;
  isMoveSubMenu: Ref<boolean>;
  isCoverSubMenu: Ref<boolean>;
  closeAllMenus: () => void;
}

export function useBookmarkCovers(options: UseBookmarkCoversOptions) {
  const {
    executeBookmarkIntent,
    activeBookmarkMenuId,
    isMoveSubMenu,
    isCoverSubMenu,
    closeAllMenus,
  } = options;

  const resultImagesUrl = ref('');
  const resultImages = ref<string[]>([]);
  const currentTabInfo = ref({ title: '', url: '' });
  const isCoverSubmenuChecking = ref(false);

  let stopResultImageListener: (() => void) | undefined;

  if (getCurrentInstance()) {
    onMounted(() => {
      stopResultImageListener = listenPoeEvent('poexd-result-images', (detail) => {
        resultImagesUrl.value = detail.url;
        resultImages.value = Array.isArray(detail.images)
          ? detail.images.filter((img): img is string => isValidPoeCdnImageUrl(img))
          : [];
      });
      dispatchPoeEvent('poexd-request-result-images');
    });

    onUnmounted(() => {
      stopResultImageListener?.();
      stopResultImageListener = undefined;
    });
  }

  const fetchCurrentTab = async (): Promise<void> => {
    try {
      if (typeof document !== 'undefined') {
        currentTabInfo.value.title = document.title || '未命名網頁';
      }
      if (typeof window !== 'undefined') {
        currentTabInfo.value.url = window.location.href || '';
      }
    } catch (err) {
      console.error('無法取得分頁資訊:', err);
    }
  };

  const sameSearchPage = (leftUrl: string, rightUrl: string): boolean => {
    if (!leftUrl || !rightUrl) return false;
    const cleanLeft = stripLiveSuffix(leftUrl).split('?')[0].split('#')[0];
    const cleanRight = stripLiveSuffix(rightUrl).split('?')[0].split('#')[0];
    if (cleanLeft === cleanRight) return true;
    const left = parseTradeSearchUrl(cleanLeft);
    const right = parseTradeSearchUrl(cleanRight);
    return (
      !!left &&
      !!right &&
      left.gameVersion === right.gameVersion &&
      left.league === right.league &&
      left.searchId === right.searchId
    );
  };

  const isValidCoverUrl = isValidPoeCdnImageUrl;

  const extractCoverImagesFromDom = (): string[] => {
    const images: string[] = [];
    try {
      if (typeof document === 'undefined') return images;
      const resultsRoot = document.querySelector('.results');
      if (!resultsRoot) return images;
      const imgElements = resultsRoot.querySelectorAll<HTMLImageElement>('.row .left .icon > img');
      for (const img of imgElements) {
        if (img.closest('.sockets, .socket, .right, .price, .currency-image')) continue;
        const src = img.currentSrc || img.src || img.getAttribute('src');
        if (src && isValidCoverUrl(src)) {
          if (!images.includes(src)) images.push(src);
        }
      }
    } catch (e) {
      console.error('[PoeXD BookmarkPane] 從 DOM 提取封面圖片失敗:', e);
    }
    return images;
  };

  const getResultImagesForUrl = (url: string): string[] => {
    const candidates: string[] = [];
    if (sameSearchPage(resultImagesUrl.value, url)) {
      candidates.push(...resultImages.value);
    }
    const currentUrl =
      currentTabInfo.value.url || (typeof window !== 'undefined' ? window.location.href : '');
    if (sameSearchPage(currentUrl, url)) {
      const domImages = extractCoverImagesFromDom();
      for (const img of domImages) {
        if (!candidates.includes(img)) candidates.push(img);
      }
    }
    if (candidates.length === 0) {
      const left = parseTradeSearchUrl(currentUrl);
      const right = parseTradeSearchUrl(url);
      if (!left || !right || left.gameVersion === right.gameVersion) {
        // 只沿用「目前頁面」的結果圖片；舊搜尋留下的快取不可當作封面候選
        if (resultImages.value.length > 0 && sameSearchPage(resultImagesUrl.value, currentUrl)) {
          for (const img of resultImages.value) {
            if (!candidates.includes(img)) candidates.push(img);
          }
        }
        const domImages = extractCoverImagesFromDom();
        for (const img of domImages) {
          if (!candidates.includes(img)) candidates.push(img);
        }
      }
    }
    return candidates;
  };

  const getResultImagesForBookmark = (bookmark: Bookmark): string[] =>
    getResultImagesForUrl(bookmark.url);

  const requestOpenCoverSubMenu = async (bookmark: Bookmark): Promise<void> => {
    if (isCoverSubmenuChecking.value) return;
    isCoverSubmenuChecking.value = true;
    try {
      await fetchCurrentTab();
      dispatchPoeEvent('poexd-request-result-images');

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
      !(await executeBookmarkIntent({
        type: 'set-bookmark-cover',
        bookmarkId: bookmark.id,
        coverImageUrl: imageUrl,
      }))
    )
      return;
    closeAllMenus();
  };

  const removeBookmarkCover = async (bookmark: Bookmark): Promise<void> => {
    if (
      !(await executeBookmarkIntent({
        type: 'set-bookmark-cover',
        bookmarkId: bookmark.id,
      }))
    )
      return;
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
    fetchCurrentTab,
    sameSearchPage,
    isValidCoverUrl,
    extractCoverImagesFromDom,
    getResultImagesForUrl,
    getResultImagesForBookmark,
    requestOpenCoverSubMenu,
    handleCoverSubmenuKeydown,
    selectBookmarkCover,
    removeBookmarkCover,
    handleCoverImageError,
  };
}
