/**
 * 市集漢化啟用時，把背景從目標服官方 API 更新的快取（ADR-0012 的執行期更新）
 * 也接給我們自己的側邊欄：篩選標籤與詞綴的市集寫法。
 *
 * 快取只由背景寫入、市集漢化啟用時才更新，所以這裡同樣只在市集漢化啟用時採用；
 * 停用時清空，側邊欄退回打包分片，避免久未更新的快取蓋過較新的打包資料。
 * 只換顯示文字，不產生 id，也不影響送給 Trade API 的值（同 ADR-0014 的規則）。
 */
import type { LiveStatLabels } from './live-trade-data';
import type { LiveTradeDataSnapshot } from './trade-label-resolver';
import { resolveMarketTranslationLocale, type MarketTranslationLocale } from './market-translation';
import { MARKET_TRANSLATION_STORAGE_KEYS } from './market-translation-bridge';
import {
  getMarketLiveDataCacheKey,
  readValidMarketLiveDataCache,
  type MarketLiveDataCache,
} from './market-translation-live';
import { resolveStoredDisplayLocale } from './preferences-contract';
import type { PoeVersion } from './trade-context';

const PSEUDO_PREFIX = 'pseudo.';

/** 同 poexd-data 產生 `pseudoStats` 的清理：合併連續空白 */
const cleanPseudoText = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** 重複 id 取第一次出現的寫法，與打包 `trade-stats.json` 的查法一致 */
function toStatLabels(stats: NonNullable<MarketLiveDataCache['stats']>['stats']): LiveStatLabels {
  const flat: Record<string, string> = {};
  const pseudoStats: Record<string, string> = {};
  for (const [id, value] of Object.entries(stats)) {
    const text = typeof value === 'string' ? value : value[0];
    if (typeof text !== 'string' || !text) continue;
    flat[id] = text;
    if (id.startsWith(PSEUDO_PREFIX)) pseudoStats[id] = cleanPseudoText(text);
  }
  return { stats: flat, pseudoStats };
}

/** 把驗證過的快取轉成側邊欄使用的快照；篩選與詞綴都沒有時回傳 null */
export function toMarketLiveSnapshot(cache: MarketLiveDataCache): LiveTradeDataSnapshot | null {
  const filters = cache.filters ?? null;
  const statLabels = cache.stats ? toStatLabels(cache.stats.stats) : null;
  if (!filters && !statLabels) return null;
  return { pageLocale: cache.locale, filters, statLabels };
}

export interface MarketLiveLabelsSyncDeps {
  version: PoeVersion;
  hostname: string;
  browserLocale: string;
  readStorage(keys: readonly string[]): Promise<Record<string, unknown>>;
  /** 訂閱 chrome.storage.local 的變更（回報變更的 key）；回傳取消訂閱 */
  subscribeStorage(handler: (changedKeys: readonly string[]) => void): () => void;
  /** 套用快照；null 表示沒有可用資料，側邊欄退回打包分片 */
  apply(snapshot: LiveTradeDataSnapshot | null): void;
}

/**
 * 讀取快取並持續同步：背景更新完成、或市集漢化偏好與顯示語系改變時重新讀取。
 * 回傳停止函式。讀取失敗時清空並記錄，不影響其他功能。
 */
export function startMarketLiveLabelsSync(deps: MarketLiveLabelsSyncDeps): () => void {
  let stopped = false;
  let generation = 0;
  let watchedCacheKey: string | null = null;

  const resolveLocale = async (): Promise<MarketTranslationLocale | null> => {
    const stored = await deps.readStorage(MARKET_TRANSLATION_STORAGE_KEYS);
    return resolveMarketTranslationLocale({
      enabled: stored.marketTranslation === true,
      displayLocale: resolveStoredDisplayLocale(stored),
      hostname: deps.hostname,
      browserLocale: deps.browserLocale,
    });
  };

  const load = async () => {
    const current = ++generation;
    const isCurrent = () => !stopped && current === generation;
    try {
      const locale = await resolveLocale();
      if (!isCurrent()) return;
      if (!locale) {
        watchedCacheKey = null;
        deps.apply(null);
        return;
      }
      const cacheKey = getMarketLiveDataCacheKey(deps.version, locale);
      watchedCacheKey = cacheKey;
      const stored = await deps.readStorage([cacheKey]);
      if (!isCurrent()) return;
      const cache = readValidMarketLiveDataCache(stored[cacheKey], deps.version, locale);
      deps.apply(cache ? toMarketLiveSnapshot(cache) : null);
    } catch (error) {
      if (!isCurrent()) return;
      console.warn('[PoeXD] 讀取市集漢化即時資料失敗，側邊欄改用打包資料:', error);
      deps.apply(null);
    }
  };

  const preferenceKeys = new Set<string>(MARKET_TRANSLATION_STORAGE_KEYS);
  const unsubscribe = deps.subscribeStorage((changedKeys) => {
    if (changedKeys.some((key) => key === watchedCacheKey || preferenceKeys.has(key))) void load();
  });
  void load();

  return () => {
    stopped = true;
    unsubscribe();
  };
}
