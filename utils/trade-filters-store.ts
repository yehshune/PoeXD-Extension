import { ref } from 'vue';
import type { SupportedLocale, SupportedUiLocale } from './preferences-contract';
import { getLocaleTradeFiltersAssetPath, type PoeVersion } from './trade-context';
import { getActiveDisplayLocale, getActiveUiLocale } from './i18n';
import poe1En from '../public/json/poe1/locales/en/trade-filters.json';
import poe1ZhTw from '../public/json/poe1/locales/zh-TW/trade-filters.json';
import poe1ZhCn from '../public/json/poe1/locales/zh-CN/trade-filters.json';
import poe2En from '../public/json/poe2/locales/en/trade-filters.json';
import poe2ZhTw from '../public/json/poe2/locales/zh-TW/trade-filters.json';
import poe2ZhCn from '../public/json/poe2/locales/zh-CN/trade-filters.json';

/**
 * 市集篩選翻譯（官方 /api/{trade,trade2}/data/filters 產生，由 poexd-data 產生，見 docs/trade-filter-data.md）。
 * 欄位以 API 的穩定 id 為 key，各語系獨立，不需索引對齊。
 */
export interface TradeFiltersData {
  /** 產生此檔的語系（官方網域語言） */
  readonly locale?: string;
  readonly groups?: Readonly<Record<string, string>>;
  readonly fields?: Readonly<Record<string, string>>;
  readonly options?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** 官方 /data/stats 的 pseudo 偽屬性文字，key 為完整 stat id（例如 `pseudo.pseudo_total_life`） */
  readonly pseudoStats?: Readonly<Record<string, string>>;
}

/** UI 語系隨程式打包（同步可用，en 為最終後備）；其他顯示語系按需載入 */
const BUNDLED: Readonly<Record<PoeVersion, Readonly<Record<SupportedUiLocale, TradeFiltersData>>>> =
  {
    poe1: { en: poe1En, 'zh-TW': poe1ZhTw, 'zh-CN': poe1ZhCn },
    poe2: { en: poe2En, 'zh-TW': poe2ZhTw, 'zh-CN': poe2ZhCn },
  };

const getBundled = (version: PoeVersion, locale: SupportedLocale): TradeFiltersData | undefined =>
  (BUNDLED[version] as Partial<Record<SupportedLocale, TradeFiltersData>>)[locale];

interface VersionFiltersState {
  shards: Map<SupportedLocale, TradeFiltersData>;
  pending: Map<SupportedLocale, Promise<TradeFiltersData | null>>;
  /** 載入失敗的語系（例如尚未產生的 ko），不重複請求 */
  unavailable: Set<SupportedLocale>;
  mock: TradeFiltersData | null;
}

const stateByVersion = new Map<PoeVersion, VersionFiltersState>();
/** 分片載入完成時遞增，讓讀取篩選翻譯的 Vue 元件重新渲染 */
const filtersRevision = ref(0);

function getState(version: PoeVersion): VersionFiltersState {
  let state = stateByVersion.get(version);
  if (!state) {
    state = { shards: new Map(), pending: new Map(), unavailable: new Set(), mock: null };
    stateByVersion.set(version, state);
  }
  return state;
}

function resolveAssetUrl(assetPath: string): string {
  const runtimeGetUrl = (globalThis as any).chrome?.runtime?.getURL;
  return typeof runtimeGetUrl === 'function' ? runtimeGetUrl(assetPath) : assetPath;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function isTradeFiltersData(value: unknown): value is TradeFiltersData {
  return isRecord(value) && isRecord(value.groups) && isRecord(value.fields);
}

export async function ensureTradeFiltersLoaded(
  version: PoeVersion,
  locale: SupportedLocale,
): Promise<TradeFiltersData | null> {
  const bundled = getBundled(version, locale);
  if (bundled) return bundled;
  const state = getState(version);
  const cached = state.shards.get(locale);
  if (cached) return cached;
  if (state.unavailable.has(locale)) return null;
  const inflight = state.pending.get(locale);
  if (inflight) return inflight;

  const promise = (async () => {
    try {
      const res = await fetch(resolveAssetUrl(getLocaleTradeFiltersAssetPath(version, locale)));
      const json: unknown = res?.ok ? await res.json() : null;
      if (!isTradeFiltersData(json)) {
        state.unavailable.add(locale);
        return null;
      }
      state.shards.set(locale, json);
      filtersRevision.value += 1;
      return json;
    } catch {
      state.unavailable.add(locale);
      return null;
    } finally {
      state.pending.delete(locale);
    }
  })();
  state.pending.set(locale, promise);
  return promise;
}

/**
 * 依優先順序回傳可用的篩選翻譯：測試 mock → 顯示語系 → UI 語系 → en。
 * 顯示語系尚未載入時會在背景載入，完成後透過 revision 觸發重新渲染。
 */
export function getTradeFiltersSources(version: PoeVersion): TradeFiltersData[] {
  void filtersRevision.value;
  const state = getState(version);
  const sources: TradeFiltersData[] = [];
  if (state.mock) sources.push(state.mock);
  for (const locale of new Set<SupportedLocale>([getActiveDisplayLocale(), getActiveUiLocale()])) {
    const shard = getBundled(version, locale) ?? state.shards.get(locale);
    if (shard) sources.push(shard);
    else void ensureTradeFiltersLoaded(version, locale);
  }
  sources.push(BUNDLED[version].en);
  return sources;
}

/** 測試用：以指定資料覆蓋所有語系；傳入 null 清除 */
export function setMockTradeFilters(version: PoeVersion, filters: TradeFiltersData | null): void {
  getState(version).mock = filters;
  filtersRevision.value += 1;
}

/** 測試用：清除所有已載入與失敗紀錄 */
export function resetTradeFiltersForTests(): void {
  stateByVersion.clear();
  filtersRevision.value += 1;
}
