import { defineContentScript } from 'wxt/utils/define-content-script';
import { extensionMessaging } from '@/utils/extension-protocol';
import { detectBrowserLocale } from '@/utils/locale-resolution';
import { startMarketTranslationBridge } from '@/utils/market-translation-bridge';
import { loadResultTranslatorData } from '@/utils/market-translation-assets';
import { createResultTranslator } from '@/utils/market-result-translator';
import { MARKET_TRANSLATION_MATCH_PATTERNS } from '@/utils/market-translation-protocol';
import { markMarketTranslationActive } from '@/utils/market-translation';

/**
 * 市集漢化 isolated world 腳本（ADR-0012）：讀偏好、擴充內建分片與快取的官方即時譯文，
 * 交給 MAIN world；快取過期時背景觸發官方 API 更新，結果列的文字翻譯也在這裡執行。
 */
export default defineContentScript({
  matches: MARKET_TRANSLATION_MATCH_PATTERNS,
  runAt: 'document_start',
  main() {
    const loadJson = async (path: string) => {
      const response = await fetch(chrome.runtime.getURL(`/${path}`));
      if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
      return response.json();
    };
    void startMarketTranslationBridge({
      hostname: window.location.hostname,
      pathname: window.location.pathname,
      browserLocale: detectBrowserLocale(),
      readStorage: (keys) => chrome.storage.local.get([...keys]),
      loadJson,
      post: (message) => window.postMessage(message, window.location.origin),
      subscribe: (handler) => {
        const listener = (event: MessageEvent) => {
          if (event.source === window) handler(event.data);
        };
        window.addEventListener('message', listener);
        return () => window.removeEventListener('message', listener);
      },
      requestLiveRefresh: (request) =>
        extensionMessaging.sendMessage('marketTranslation:refresh', request),
      // 第 4 階段：結果列（詞綴、物品名、屬性標籤）在 isolated world 直接改 DOM 文字
      onPayload: (payload, version, liveEn) => {
        markMarketTranslationActive(document, payload);
        void loadResultTranslatorData(loadJson, {
          version,
          locale: payload.locale,
          dictionary: payload.data ?? {},
          ui: payload.ui,
          liveEn,
        })
          .then((data) => createResultTranslator(data).observe(document))
          .catch((error) => console.warn('[PoeXD] 市集漢化結果列翻譯啟動失敗:', error));
      },
    });
  },
});
