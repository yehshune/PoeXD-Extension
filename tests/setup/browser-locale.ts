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
