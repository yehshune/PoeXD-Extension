import { parseTradeSearchUrl, type ParsedTradeSearchIdentity } from './trade-search-identity';
import {
  extractFilterOptionValue,
  formatFilterValue,
  translateItemName,
} from './trade-stat-dictionary';
import type { PoeVersion } from './trade-context';

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
