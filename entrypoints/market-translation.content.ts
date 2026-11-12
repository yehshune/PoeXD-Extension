import { defineContentScript } from 'wxt/utils/define-content-script';
import { detectBrowserLocale } from '@/utils/locale-resolution';
import { startMarketTranslationBridge } from '@/utils/market-translation-bridge';
import { MARKET_TRANSLATION_MATCH_PATTERNS } from '@/utils/market-translation-protocol';

/**
 * 市集漢化 isolated world 腳本（ADR-0012）：讀偏好與擴充內建的翻譯分片，交給 MAIN world。
 */
export default defineContentScript({
  matches: MARKET_TRANSLATION_MATCH_PATTERNS,
  runAt: 'document_start',
  main() {
    void startMarketTranslationBridge({
      hostname: window.location.hostname,
      pathname: window.location.pathname,
      browserLocale: detectBrowserLocale(),
      readStorage: (keys) => chrome.storage.local.get([...keys]),
      loadJson: async (path) => {
        const response = await fetch(chrome.runtime.getURL(`/${path}`));
        if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
        return response.json();
      },
      post: (message) => window.postMessage(message, window.location.origin),
      subscribe: (handler) => {
        const listener = (event: MessageEvent) => {
          if (event.source === window) handler(event.data);
        };
        window.addEventListener('message', listener);
        return () => window.removeEventListener('message', listener);
      },
    });
  },
});
