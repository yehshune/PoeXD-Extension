import { defineContentScript } from 'wxt/utils/define-content-script';
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
    const loadJson = async (path: string) => {
      const response = await fetch(chrome.runtime.getURL(`/${path}`));
      if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
      return response.json();
    };
    void startPobbinTranslation({
      doc: document,
      browserLocale: detectBrowserLocale(),
      readStorage: (keys) => chrome.storage.local.get([...keys]),
      loadJson,
    }).catch((error) => console.warn('[PoeXD] pobb.in 漢化啟動失敗:', error));
  },
});
