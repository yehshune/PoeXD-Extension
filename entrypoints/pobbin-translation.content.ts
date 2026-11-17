import { defineContentScript } from 'wxt/utils/define-content-script';
import { extensionMessaging } from '@/utils/extension-protocol';
import { detectBrowserLocale } from '@/utils/locale-resolution';
import { startPobbinTranslation } from '@/utils/pobbin-translator';

/**
 * pobb.in 分享頁漢化腳本（registration: 'runtime'）：
 * 維持 `https://pobb.in/*` 為選用權限，由 background 在使用者授權後以 `chrome.scripting` 動態註冊。
 */
export default defineContentScript({
  registration: 'runtime',
  matches: [],
  runAt: 'document_idle',
  main() {
    // 資料檔不開放給 pobb.in 直接讀取（避免網站偵測擴充），改由 background 讀取後傳回
    const loadJson = (path: string) => extensionMessaging.sendMessage('pobbin:loadAsset', { path });
    void startPobbinTranslation({
      doc: document,
      browserLocale: detectBrowserLocale(),
      readStorage: (keys) => chrome.storage.local.get([...keys]),
      loadJson,
    }).catch((error) => console.warn('[PoeXD] pobb.in 漢化啟動失敗:', error));
  },
});
