/**
 * happy-dom 的 navigator.language 預設為 en-US；專案測試以繁中為預設瀏覽器語系。
 * 個別測試仍可用 Object.defineProperty 覆寫（此處設為 configurable）。
 */
const globalWithDom = globalThis as typeof globalThis & { happyDOM?: unknown };

if (typeof navigator !== 'undefined' && globalWithDom.happyDOM !== undefined) {
  Object.defineProperty(navigator, 'language', {
    value: 'zh-TW',
    configurable: true,
    writable: true,
  });
}

/**
 * 元件測試會以相對路徑讀擴充資料（`chrome.runtime.getURL` 被 mock 成原樣回傳），happy-dom 會把它
 * 解析成預設的 `http://localhost:3000/...` 並真的發出連線，在沒有伺服器時印出 ECONNREFUSED。
 * 這裡攔下對 happy-dom 預設來源的請求，直接回 404：程式照樣走「讀不到資料」的路徑，但不碰網路。
 */
interface HappyDomFetchSettings {
  settings?: {
    fetch?: {
      interceptor: unknown;
    };
  };
}

const happyDom = globalWithDom.happyDOM as HappyDomFetchSettings | undefined;
if (happyDom?.settings?.fetch) {
  happyDom.settings.fetch.interceptor = {
    beforeAsyncRequest: async ({
      request,
      window,
    }: {
      request: { url: string };
      window: { Response: typeof Response };
    }) => {
      const { hostname } = new URL(request.url);
      if (hostname !== 'localhost' && hostname !== '127.0.0.1') return undefined;
      return new window.Response(null, { status: 404, statusText: 'Blocked in tests' });
    },
  };
}
