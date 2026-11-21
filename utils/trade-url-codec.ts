import { parseTradeSearchUrl, type ParsedTradeSearchIdentity } from './trade-search-identity';
import {
  extractFilterOptionValue,
  formatFilterValue,
  loadTradeDictionaries,
  translateItemName,
  translateStatLines,
} from './trade-stat-dictionary';
import { getTradeVersionProfile, type PoeVersion } from './trade-context';
import { t } from './i18n';

/**
 * 檢查 Base64URL 字串是否為合法的 Gzip 格式（包含 0x1f, 0x8b, 0x08 magic header）
 */
export function isGzipHash(hash: string): boolean {
  if (typeof hash !== 'string' || hash.length < 4) return false;
  try {
    let base64 = hash.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) base64 += '=';
    const binary = atob(base64);
    if (binary.length < 3) return false;
    return (
      binary.charCodeAt(0) === 0x1f &&
      binary.charCodeAt(1) === 0x8b &&
      binary.charCodeAt(2) === 0x08
    );
  } catch {
    return false;
  }
}

/**
 * 利用瀏覽器原生的 DecompressionStream('gzip') 將 Gzip-Base64URL 解碼為 query 物件
 * 若為舊版短網址（非 Gzip 格式）或解碼失敗，回傳 null（明確不支援舊版短網址）
 */
export async function decodeGzipBase64UrlToQuery(hash: string): Promise<any | null> {
  if (!isGzipHash(hash)) return null;
  try {
    let base64 = hash.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) base64 += '=';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const stream = new Blob([bytes]).stream();
    const decompressedStream = stream.pipeThrough(new DecompressionStream('gzip'));
    const response = new Response(decompressedStream);
    const text = await response.text();
    const parsed = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * decodeGzipBase64UrlToQuery 的反向：query 物件轉成官方市集的搜尋代碼（gzip 後的 Base64URL）。
 * 官網接受本機產生的代碼（國際服、台服、PoE 1 與 PoE 2 皆已實測），可直接放在搜尋網址路徑。
 */
export async function encodeQueryToGzipBase64Url(query: unknown): Promise<string> {
  const json = JSON.stringify(query);
  if (typeof json !== 'string') throw new TypeError('query 無法轉成 JSON');
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface DecodedTradeSearchResult extends ParsedTradeSearchIdentity {
  query: any;
}

/**
 * 從官方市集搜尋網址中離線解碼搜尋條件（Query JSON）
 */
export async function decodeTradeSearchUrl(
  urlString: string,
): Promise<DecodedTradeSearchResult | null> {
  const parsed = parseTradeSearchUrl(urlString);
  if (!parsed) return null;

  const query = await decodeGzipBase64UrlToQuery(parsed.searchId);
  if (!query) return null;

  return {
    ...parsed,
    query,
  };
}

export interface ExtractedFilterItem {
  sectionKey: string;
  fieldKey: string;
  value: any;
}

export interface ExtractedQueryMetadata {
  suggestedName: string;
  name?: string;
  type?: string;
  stats: Array<{ id: string; min?: number; max?: number }>;
  filters: ExtractedFilterItem[];
}

/**
 * 判斷單一過濾欄位值是否真正生效且具備實質搜尋條件。
 * 若節點自身或內部 option 標註 disabled === true，或僅包含空值/無效結構，則回傳 false。
 */
function isEffectiveFilterField(val: any): boolean {
  if (val === undefined || val === null) return false;
  if (typeof val !== 'object') {
    return String(val).trim() !== '';
  }
  if (Array.isArray(val)) {
    return val.length > 0;
  }
  if (val.disabled === true) return false;
  let hasOption = false;
  if (val.option !== undefined && val.option !== null) {
    const extracted = extractFilterOptionValue(val.option);
    if (extracted?.disabled) return false;
    hasOption =
      extracted !== null &&
      extracted.value !== undefined &&
      extracted.value !== null &&
      extracted.value !== '';
  }

  const hasMin = val.min !== undefined && val.min !== null && val.min !== '';
  const hasMax = val.max !== undefined && val.max !== null && val.max !== '';

  if (hasMin || hasMax || hasOption) return true;

  const otherKeys = Object.keys(val).filter((k) => k !== 'disabled');
  if (otherKeys.length === 0) return false;
  return otherKeys.some((k) => val[k] !== undefined && val[k] !== null && val[k] !== '');
}

/**
 * 讀取 query.filters[sectionKey].filters[fieldKey] 的有效 option 字串。
 * 若有效性鏈上任一層（filters、section、section.filters、field 或 option 物件）標記 disabled === true，則視為未生效並回傳空字串。
 */
function getEffectiveFilterOption(query: any, sectionKey: string, fieldKey: string): string {
  if (!query || typeof query !== 'object') return '';
  const filtersRoot = query.filters;
  if (!filtersRoot || typeof filtersRoot !== 'object' || filtersRoot.disabled === true) return '';
  const section = filtersRoot[sectionKey];
  if (!section || typeof section !== 'object' || section.disabled === true) return '';
  const sectionFilters = section.filters;
  if (!sectionFilters || typeof sectionFilters !== 'object' || sectionFilters.disabled === true) {
    return '';
  }
  const field = sectionFilters[fieldKey];
  if (!field || typeof field !== 'object' || field.disabled === true) return '';
  const extracted = extractFilterOptionValue(field.option);
  if (
    !extracted ||
    extracted.disabled ||
    extracted.value === undefined ||
    extracted.value === null
  ) {
    return '';
  }
  return String(extracted.value).trim();
}

/**
 * 從市集 query 物件中提取名稱、基底類型與條件摘要
 */
export function extractQueryMetadata(
  queryPayload: any,
  version: PoeVersion = 'poe1',
): ExtractedQueryMetadata {
  const q = queryPayload?.query || queryPayload || {};
  const rawName =
    typeof q.name === 'string'
      ? q.name.trim()
      : q.name?.option && q.name?.disabled !== true
        ? String(q.name.option).trim()
        : '';
  const rawType =
    typeof q.type === 'string'
      ? q.type.trim()
      : q.type?.option && q.type?.disabled !== true
        ? String(q.type.option).trim()
        : '';

  const name = translateItemName(rawName, version);
  const type = translateItemName(rawType, version);

  let itemLabel = '';
  if (name && type) {
    itemLabel = name === type ? name : `${name} (${type})`;
  } else if (name) {
    itemLabel = name;
  } else if (type) {
    itemLabel = type;
  }

  const category = getEffectiveFilterOption(q, 'type_filters', 'category');
  const rarity = getEffectiveFilterOption(q, 'type_filters', 'rarity');
  const categoryLabel = category ? formatFilterValue(category, 'category', version).trim() : '';
  const rarityLabel = rarity ? formatFilterValue(rarity, 'rarity', version).trim() : '';

  const suggestedName = itemLabel
    ? [itemLabel, rarityLabel].filter(Boolean).join(' ')
    : [categoryLabel, rarityLabel].filter(Boolean).join(' ');

  const statsList: Array<{ id: string; min?: number; max?: number }> = [];
  if (Array.isArray(q.stats)) {
    for (const group of q.stats) {
      if (group?.disabled === true) continue;
      if (Array.isArray(group.filters)) {
        for (const f of group.filters) {
          if (!f || f.disabled === true) continue;
          if (f.id) {
            statsList.push({
              id: f.id,
              min: f.value?.min,
              max: f.value?.max,
            });
          }
        }
      }
    }
  }

  const filtersList: ExtractedFilterItem[] = [];
  const filtersRoot = q.filters;
  if (filtersRoot && typeof filtersRoot === 'object' && filtersRoot.disabled !== true) {
    for (const [sectionKey, sectionVal] of Object.entries(filtersRoot)) {
      if (sectionKey === 'disabled') continue;
      if (!sectionVal || typeof sectionVal !== 'object' || (sectionVal as any).disabled === true) {
        continue;
      }

      const sectionFilters = (sectionVal as any).filters;
      if (
        !sectionFilters ||
        typeof sectionFilters !== 'object' ||
        sectionFilters.disabled === true
      ) {
        continue;
      }

      for (const [fieldKey, fieldVal] of Object.entries(sectionFilters)) {
        if (fieldKey === 'disabled') continue;
        if (!isEffectiveFilterField(fieldVal)) continue;

        filtersList.push({
          sectionKey,
          fieldKey,
          value: fieldVal,
        });
      }
    }
  }

  return {
    suggestedName,
    name: name || undefined,
    type: type || undefined,
    stats: statsList,
    filters: filtersList,
  };
}

/**
 * 判斷網頁標題是否為官方預設或未命名的通用標題。
 */
const GENERIC_OFFICIAL_TITLES = new Set([
  'Path of Exile - Trade',
  'Trade - Path of Exile',
  '流亡黯道 - 交易',
  '交易 - 流亡黯道',
  '流亡黯道 - 交易市集',
  '流亡黯道2 - 交易',
  '交易 - 流亡黯道2',
]);

export function isGenericTradePageTitle(rawTitle: string, version: PoeVersion = 'poe1'): boolean {
  const trimmed = rawTitle.trim();
  if (!trimmed) return true;
  if (GENERIC_OFFICIAL_TITLES.has(trimmed)) return true;
  const defaultPageTitle = t('bookmark.defaultPageTitle');
  const unnamedSearch = t('injectedControls.unnamedSearch');
  const officialDefault = getTradeVersionProfile(version).defaultTitle;
  return trimmed === defaultPageTitle || trimmed === unnamedSearch || trimmed === officialDefault;
}

/**
 * 當網頁標題為通用預設值時，嘗試從市集搜尋 URL 解碼並推導可讀的書籤標題：
 * 1. 優先使用 extractQueryMetadata 的 suggestedName（傳奇名／基底／分類／稀有度）
 * 2. 若僅有詞綴條件，取前 2 條詞綴的翻譯名稱拼裝
 */
export async function deriveSearchTitleFromUrl(url: string): Promise<string> {
  try {
    const decoded = await decodeTradeSearchUrl(url);
    if (!decoded) return '';
    try {
      await loadTradeDictionaries(decoded.gameVersion);
    } catch {
      // 字典載入失敗時仍可退回未翻譯或 ID
    }
    const meta = extractQueryMetadata(decoded.query, decoded.gameVersion);
    if (meta.suggestedName?.trim()) return meta.suggestedName.trim();
    if (meta.stats.length > 0) {
      const statNames = meta.stats
        .slice(0, 2)
        .map((s) => translateStatLines(s.id, decoded.gameVersion)[0] ?? s.id)
        .filter(Boolean);
      if (statNames.length > 0) return statNames.join(' · ');
    }
  } catch {
    // Best-effort title derivation
  }
  return '';
}
