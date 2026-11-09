export function isTradePageReady(root: Pick<Document, 'querySelector'>) {
  return root.querySelector('.content') !== null;
}

export { isCloudflareChallenge } from '@/utils/trade-interstitial-classifier';

export interface WhenTradePageReadyOptions {
  isDisposed?: () => boolean;
}

export function whenTradePageReady(
  doc: Document,
  onReady: () => void,
  options?: WhenTradePageReadyOptions,
): () => void {
  let tradePageObserver: MutationObserver | null = null;
  let domReadyListener: (() => void) | null = null;
  let finished = false;

  const cleanup = () => {
    if (finished) return;
    finished = true;
    if (domReadyListener) {
      doc.removeEventListener('DOMContentLoaded', domReadyListener);
      domReadyListener = null;
    }
    if (tradePageObserver) {
      tradePageObserver.disconnect();
      tradePageObserver = null;
    }
  };

  const trigger = () => {
    cleanup();
    onReady();
  };

  const checkAndRun = () => {
    if (finished || options?.isDisposed?.()) return;
    if (isTradePageReady(doc)) {
      trigger();
      return;
    }
    if (!tradePageObserver && doc.documentElement) {
      tradePageObserver = new MutationObserver(() => {
        if (finished || options?.isDisposed?.()) {
          cleanup();
          return;
        }
        if (isTradePageReady(doc)) {
          trigger();
        }
      });
      tradePageObserver.observe(doc.documentElement, { childList: true, subtree: true });
    }
  };

  if (doc.readyState === 'loading') {
    domReadyListener = () => {
      domReadyListener = null;
      checkAndRun();
    };
    doc.addEventListener('DOMContentLoaded', domReadyListener, { once: true });
  } else {
    checkAndRun();
  }

  return cleanup;
}
