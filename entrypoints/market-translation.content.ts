import { defineContentScript } from 'wxt/utils/define-content-script';
import { extensionMessaging } from '@/utils/extension-protocol';
import { detectBrowserLocale } from '@/utils/locale-resolution';
import { startMarketTranslationBridge } from '@/utils/market-translation-bridge';
import { loadResultTranslatorData } from '@/utils/market-translation-assets';
import { receiveResultTranslationRequests } from '@/utils/market-result-translation-request';
import { createResultTranslator } from '@/utils/market-result-translator';
import {
  MARKET_TRANSLATION_MATCH_PATTERNS,
  postMarketTranslationMessage,
} from '@/utils/market-translation-protocol';
import { markMarketTranslationActive } from '@/utils/market-translation';
import { loadExtensionJson } from '@/utils/extension-json-cache';
import {
  observeOfficialTradeToasts,
  setTradeToastUiDictionary,
} from '@/utils/trade-toast-translation';

/** 等主執行緒閒置最多多久就照樣執行，避免頁面一直忙碌時結果列永遠不翻譯 */
const RESULT_TRANSLATOR_IDLE_TIMEOUT_MS = 2000;

function whenMainThreadIdle(task: () => void): void {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(task, { timeout: RESULT_TRANSLATOR_IDLE_TIMEOUT_MS });
  } else {
    setTimeout(task, 0);
  }
}

/**
 * 市集漢化 isolated world 腳本（ADR-0012）：讀偏好、擴充內建分片與快取的官方即時譯文，
 * 交給 MAIN world；快取過期時背景觸發官方 API 更新，結果列的文字翻譯也在這裡執行。
 */
export default defineContentScript({
  matches: MARKET_TRANSLATION_MATCH_PATTERNS,
  runAt: 'document_start',
  main() {
    // 與主要 content script 共用同一份已解析資料（同一個 isolated world）
    const loadJson = loadExtensionJson;
    // Sidebar 釘選物品等自己畫的官方樣式卡片在 shadow root 內，翻譯器準備好後另外監看
    const extraRoots = receiveResultTranslationRequests(document);
    void startMarketTranslationBridge({
      hostname: window.location.hostname,
      pathname: window.location.pathname,
      browserLocale: detectBrowserLocale(),
      readStorage: (keys) => chrome.storage.local.get([...keys]),
      loadJson,
      post: (message) => postMarketTranslationMessage(window, message),
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
      onPayload: (payload, version, loadLiveEn) => {
        markMarketTranslationActive(document, payload);
        setTradeToastUiDictionary(payload.ui);
        observeOfficialTradeToasts(document, {
          locale: payload.locale,
          ui: payload.ui,
          bilingual: payload.bilingual,
        });
        // 結果列翻譯資料約 3 MB，只有結果列用得到；官網此時正在載入、執行自己的腳本，
        // 等主執行緒閒置（通常是官方 search / fetch 的網路等待期間）再解析，
        // observe() 啟動時會補翻已出現的結果列
        whenMainThreadIdle(() => {
          void loadLiveEn()
            .then((liveEn) =>
              loadResultTranslatorData(loadJson, {
                version,
                locale: payload.locale,
                dictionary: payload.data ?? {},
                ui: payload.ui,
                liveEn,
              }),
            )
            .then(async (data) => {
              const stored = await chrome.storage.local
                .get(['marketTranslationResultBilingual'])
                .catch(() => ({}) as Record<string, unknown>);
              const translator = createResultTranslator(data, {
                resultBilingual: stored.marketTranslationResultBilingual === true,
              });
              translator.observe(document);
              extraRoots.attach((root) => translator.observe(root));
              chrome.storage.onChanged.addListener(
                (changes: Record<string, { newValue?: unknown }>, areaName: string) => {
                  if (areaName !== 'local' || !('marketTranslationResultBilingual' in changes)) {
                    return;
                  }
                  translator.setResultBilingual(
                    changes.marketTranslationResultBilingual?.newValue === true,
                  );
                },
              );
            })
            .catch((error) => console.warn('[PoeXD] 市集漢化結果列翻譯啟動失敗:', error));
        });
      },
    });
  },
});
