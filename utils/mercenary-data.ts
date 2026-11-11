/**
 * 傭兵（Mercenary Warrant）遊戲資料的執行期載入與目錄。
 *
 * 資料由 poexd-data 產生、`pnpm run data:sync` 同步（僅 PoE 1）：
 * - `json/poe1/mercenary.json`：語系無關的 Build 技能池、技能可連輔助與輔助階級。
 * - `json/poe1/locales/<locale>/mercenary.json`：與結構檔索引對齊的名稱。
 *
 * 名稱依「顯示語系 → UI 語系 → en」逐一嘗試；沒有該語系檔（例如 zh-CN）時退回下一個。
 */
import { ref } from 'vue';
import type { SupportedLocale } from './preferences-contract';
import { getActiveDisplayLocale, getActiveUiLocale } from './i18n';

export type MercenarySupportSlots = 'none' | 'low' | 'medium' | 'high';

export interface MercenaryDataFile {
  patch: string;
  builds: Array<{
    tradeType: string;
    infamous: boolean;
    core: number[];
    main: number[];
    mainCount: number;
    utility: number[];
    utilityCount: number;
  }>;
  skills: Array<{ tradeId: string; slots: MercenarySupportSlots; supports: number[] }>;
  supports: Array<{ tradeId: string; tier: number; family: string | null }>;
}

export interface MercenaryNamesFile {
  patch: string;
  builds: string[];
  skills: string[];
  supports: string[];
}

export interface MercenarySupport {
  index: number;
  tradeId: string;
  tier: number;
  family: string | null;
  name: string;
}

export interface MercenarySkill {
  index: number;
  tradeId: string;
  slots: MercenarySupportSlots;
  supports: number[];
  name: string;
}

export interface MercenaryBuild {
  index: number;
  tradeType: string;
  infamous: boolean;
  name: string;
  core: number[];
  main: number[];
  mainCount: number;
  utility: number[];
  utilityCount: number;
}

export interface MercenaryCatalog {
  patch: string;
  builds: MercenaryBuild[];
  skills: MercenarySkill[];
  supports: MercenarySupport[];
  skillByTradeId: ReadonlyMap<string, MercenarySkill>;
  supportByTradeId: ReadonlyMap<string, MercenarySupport>;
  buildByTradeType: ReadonlyMap<string, MercenaryBuild>;
}

const DATA_PATH = 'json/poe1/mercenary.json';
const namesPath = (locale: string) => `json/poe1/locales/${locale}/mercenary.json`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function isDataFile(value: unknown): value is MercenaryDataFile {
  return (
    isRecord(value) &&
    typeof value.patch === 'string' &&
    Array.isArray(value.builds) &&
    Array.isArray(value.skills) &&
    Array.isArray(value.supports)
  );
}

/** 名稱檔必須與結構檔同一 patch、長度對齊，否則視為不可用。 */
export function isAlignedNamesFile(
  value: unknown,
  data: MercenaryDataFile,
): value is MercenaryNamesFile {
  return (
    isRecord(value) &&
    value.patch === data.patch &&
    Array.isArray(value.builds) &&
    value.builds.length === data.builds.length &&
    Array.isArray(value.skills) &&
    value.skills.length === data.skills.length &&
    Array.isArray(value.supports) &&
    value.supports.length === data.supports.length
  );
}

/** 由結構檔與名稱檔組成目錄；名稱缺漏時以 trade id 代替。 */
export function createMercenaryCatalog(
  data: MercenaryDataFile,
  names: MercenaryNamesFile | null,
): MercenaryCatalog {
  const supports = data.supports.map((s, index) => ({
    index,
    ...s,
    name: names?.supports[index] || s.tradeId,
  }));
  const skills = data.skills.map((s, index) => ({
    index,
    ...s,
    name: names?.skills[index] || s.tradeId,
  }));
  const builds = data.builds.map((b, index) => ({
    index,
    ...b,
    name: names?.builds[index] || b.tradeType,
  }));
  return {
    patch: data.patch,
    builds,
    skills,
    supports,
    skillByTradeId: new Map(skills.map((s) => [s.tradeId, s])),
    supportByTradeId: new Map(supports.map((s) => [s.tradeId, s])),
    buildByTradeType: new Map(builds.map((b) => [b.tradeType, b])),
  };
}

export type MercenaryAssetFetcher = (assetPath: string) => Promise<unknown>;

function resolveAssetUrl(assetPath: string): string {
  const runtimeGetUrl = (globalThis as any).chrome?.runtime?.getURL;
  return typeof runtimeGetUrl === 'function' ? runtimeGetUrl(assetPath) : assetPath;
}

const defaultFetcher: MercenaryAssetFetcher = async (assetPath) => {
  const res = await fetch(resolveAssetUrl(assetPath));
  return res?.ok ? res.json() : null;
};

async function tryFetch(fetcher: MercenaryAssetFetcher, assetPath: string): Promise<unknown> {
  try {
    return await fetcher(assetPath);
  } catch {
    return null;
  }
}

/**
 * 載入傭兵目錄；結構檔無法取得時拋出錯誤。
 * @param locales 名稱語系優先順序（預設為顯示語系 → UI 語系 → en）
 */
export async function loadMercenaryCatalog(
  locales: readonly SupportedLocale[] = [getActiveDisplayLocale(), getActiveUiLocale(), 'en'],
  fetcher: MercenaryAssetFetcher = defaultFetcher,
): Promise<MercenaryCatalog> {
  const data = await tryFetch(fetcher, DATA_PATH);
  if (!isDataFile(data)) throw new Error('mercenary data unavailable');

  for (const locale of new Set(locales)) {
    const names = await tryFetch(fetcher, namesPath(locale));
    if (isAlignedNamesFile(names, data)) return createMercenaryCatalog(data, names);
  }
  return createMercenaryCatalog(data, null);
}

const catalogCache = new Map<string, Promise<MercenaryCatalog>>();
/** 已載入完成的目錄，給同步翻譯使用。 */
const resolvedCatalogs = new Map<string, MercenaryCatalog>();
/** 目錄載入完成時遞增，讓同步讀名稱的 Vue 元件重新渲染。 */
const catalogRevision = ref(0);
/** 失敗後暫不重試的語系組合，避免同步翻譯每次渲染都重新請求。 */
const failedKeys = new Set<string>();

const currentLocales = (): SupportedLocale[] => [
  getActiveDisplayLocale(),
  getActiveUiLocale(),
  'en',
];

/**
 * 依名稱語系快取的目錄（預設為目前語系順序）；載入失敗時不快取，下次重試。
 * 傳入 `['en']` 可取得英文名稱，供搜尋比對。
 */
export function getMercenaryCatalog(
  locales: SupportedLocale[] = currentLocales(),
): Promise<MercenaryCatalog> {
  const key = locales.join('|');
  let pending = catalogCache.get(key);
  if (!pending) {
    pending = loadMercenaryCatalog(locales).then(
      (catalog) => {
        failedKeys.delete(key);
        resolvedCatalogs.set(key, catalog);
        catalogRevision.value += 1;
        return catalog;
      },
      (error) => {
        catalogCache.delete(key);
        failedKeys.add(key);
        throw error;
      },
    );
    catalogCache.set(key, pending);
  }
  return pending;
}

/**
 * 同步取得傭兵技能／輔助的目前語系名稱；不是傭兵 id 回傳 null。
 * 目錄尚未載入時在背景載入並先回傳 null，完成後透過 revision 觸發重新渲染。
 */
export function translateMercenaryStat(statId: string): string | null {
  if (!statId.startsWith('mercenary.')) return null;
  void catalogRevision.value;
  const key = currentLocales().join('|');
  const catalog = resolvedCatalogs.get(key);
  if (!catalog) {
    if (!failedKeys.has(key)) getMercenaryCatalog().catch(() => undefined);
    return null;
  }
  return (
    catalog.skillByTradeId.get(statId)?.name ?? catalog.supportByTradeId.get(statId)?.name ?? null
  );
}

/** 測試用：清除所有快取。 */
export function resetMercenaryCatalogForTests(): void {
  catalogCache.clear();
  resolvedCatalogs.clear();
  failedKeys.clear();
  catalogRevision.value += 1;
}
