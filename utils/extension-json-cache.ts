/**
 * 擴充內建 JSON 資產（`public/json/**`）的共用載入器。
 *
 * 同一份資產會被多個模組使用（市集漢化、結果列 PoB 複製、詞綴字典、PoB build…），
 * 各自 fetch 與 JSON.parse 時，一次頁面載入會重複下載與解析十幾 MB，記憶體裡也各留一份。
 * 這裡讓同一個 isolated world 內的所有模組共用：
 *
 * - 進行中的請求共用同一個 Promise。
 * - 解析後的資料以 WeakRef 保留：仍有模組持有時直接重用，沒人持有時可被回收，不會因為快取而常駐。
 * - 資料一律深度凍結：多個模組共用同一份物件，任何原地修改都會直接拋錯，不會默默影響其他模組。
 *
 * 快取掛在 `globalThis`，因此同一頁的多個 content script（各自打包）也共用同一份。
 */

const CACHE_KEY = Symbol.for('poexd.extensionJsonCache');

interface ExtensionJsonCache {
  pending: Map<string, Promise<unknown>>;
  settled: Map<string, WeakRef<object>>;
}

function getCache(): ExtensionJsonCache {
  const holder = globalThis as typeof globalThis & { [CACHE_KEY]?: ExtensionJsonCache };
  holder[CACHE_KEY] ??= { pending: new Map(), settled: new Map() };
  return holder[CACHE_KEY];
}

function resolveAssetUrl(path: string): string {
  const normalized = `/${path.replace(/^\/+/, '')}`;
  const getUrl = (globalThis as any).chrome?.runtime?.getURL;
  return typeof getUrl === 'function' ? getUrl(normalized) : normalized;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  return value;
}

/**
 * 載入擴充內建的 JSON 資產（路徑相對於擴充根目錄，例如 `json/poe1/locales/en/items.json`）。
 * 回傳的資料已深度凍結，呼叫端只能讀取；HTTP 錯誤或 JSON 格式錯誤時 reject。
 */
export function loadExtensionJson(path: string): Promise<unknown> {
  const url = resolveAssetUrl(path);
  const cache = getCache();

  const cached = cache.settled.get(url)?.deref();
  if (cached !== undefined) return Promise.resolve(cached);
  const inflight = cache.pending.get(url);
  if (inflight) return inflight;

  const request = (async () => {
    const response = await fetch(url);
    if (!response?.ok) throw new Error(`${path}: HTTP ${response?.status ?? 'no response'}`);
    const data = deepFreeze((await response.json()) as unknown);
    if (data !== null && typeof data === 'object') cache.settled.set(url, new WeakRef(data));
    return data;
  })().finally(() => {
    cache.pending.delete(url);
  });
  cache.pending.set(url, request);
  return request;
}

/** 測試用：清除共用快取，避免不同測試之間沿用上一個測試的假資料 */
export function resetExtensionJsonCacheForTests(): void {
  const cache = getCache();
  cache.pending.clear();
  cache.settled.clear();
}
