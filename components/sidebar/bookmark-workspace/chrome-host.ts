import { dispatchPoeEvent, listenPoeEvent } from '@/utils/event-contracts';
import { fetchTradeLeagues } from '@/utils/trade-leagues';
import { enqueueLiveSearchConnections } from '@/utils/extension-protocol';
import { isValidPoeCdnImageUrl } from '@/utils/poe-cdn-url';
import { TRADE_RESULTS_SELECTOR } from '@/utils/trade-results-root';
import { syncSearchFormToUrl } from '@/entrypoints/content/logic/criteria-overlay-manager';
import type { BookmarkWorkspaceHost } from './host';

function readResultCoverImagesFromDom(): string[] {
  const images: string[] = [];
  try {
    if (typeof document === 'undefined') return images;
    const resultsRoot = document.querySelector(TRADE_RESULTS_SELECTOR);
    if (!resultsRoot) return images;
    const imgElements = resultsRoot.querySelectorAll<HTMLImageElement>('.row .left .icon > img');
    for (const img of imgElements) {
      if (img.closest('.sockets, .socket, .right, .price, .currency-image')) continue;
      const src = img.currentSrc || img.src || img.getAttribute('src');
      if (src && isValidPoeCdnImageUrl(src)) {
        if (!images.includes(src)) images.push(src);
      }
    }
  } catch (e) {
    console.error('[PoeXD BookmarkPane] 從 DOM 提取封面圖片失敗:', e);
  }
  return images;
}

/** 正式環境 adapter：瀏覽器 window / Chrome 擴充功能 / 官方 Trade 頁面。 */
export function createChromeBookmarkWorkspaceHost(): BookmarkWorkspaceHost {
  return {
    navigation: {
      navigate(url, target) {
        if (target === 'current') window.location.href = url;
        else window.open(url, '_blank');
      },
      syncUrl: () => syncSearchFormToUrl(),
      readLocation() {
        return {
          url: typeof window !== 'undefined' ? window.location.href || '' : '',
          title: typeof document !== 'undefined' ? document.title || '' : '',
        };
      },
      subscribeRouteChange(listener) {
        window.addEventListener('popstate', listener);
        const stopHistory = listenPoeEvent('poexd-history-changed', listener);
        return () => {
          window.removeEventListener('popstate', listener);
          stopHistory();
        };
      },
    },
    feedback: {
      confirm: async (message, title) =>
        Boolean(await (window as any).poexdConfirm?.(message, title)),
      alert: async (message, title) => {
        await (window as any).poexdAlert(message, title);
      },
      toast(message, tone = 'default') {
        dispatchPoeEvent('poexd-toast', {
          message,
          tone,
          ...(tone === 'default' ? { durationMs: 3000 } : {}),
        });
      },
    },
    sources: {
      fetchLeagues: (version) => fetchTradeLeagues(version),
      subscribeCoverCapture: (listener) =>
        listenPoeEvent('poexd-result-images', (detail) => listener(detail)),
      requestCoverCapture: () => dispatchPoeEvent('poexd-request-result-images'),
      readResultCoverImages: readResultCoverImagesFromDom,
      enqueue: (request, options) => enqueueLiveSearchConnections(request, options),
    },
  };
}
