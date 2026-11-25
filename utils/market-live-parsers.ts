/**
 * 官方即時資料的解析與驗證：把官方 translate.js 與 trade data API 的回應轉成字典片段，
 * 並以國際服英文資料對齊、拒絕退回英文的在地化內容。全部是純函式。
 */
import { parseLiveTradeFilters } from './live-trade-data';
import type { MarketTradeDictionary } from './market-translation-data';
import type { MarketLiveDiscItemsRaw, MarketLiveEnglishItems } from './market-live-cache';

const MIN_UI_STRINGS = 100;
const MIN_STATS_COUNT = 500;
const MIN_STATIC_GROUPS = 3;
const MIN_STATIC_ENTRIES = 20;

const CJK_RE = /[\u4e00-\u9fff]/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function hasAnyCjk(values: Iterable<string>): boolean {
  for (const value of values) {
    if (CJK_RE.test(value)) return true;
  }
  return false;
}

/** 解碼 JS 單/雙引號字串內容（不含外層引號）；遇到不支援的跳脫時回傳 null */
function unescapeJsString(raw: string): string | null {
  let out = '';
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    i += 1;
    if (i >= raw.length) return null;
    const esc = raw[i];
    if (esc === "'" || esc === '"' || esc === '\\' || esc === '/') out += esc;
    else if (esc === 'n') out += '\n';
    else if (esc === 'r') out += '\r';
    else if (esc === 't') out += '\t';
    else if (esc === 'b') out += '\b';
    else if (esc === 'f') out += '\f';
    else if (esc === 'x') {
      const hex = raw.slice(i + 1, i + 3);
      if (!/^[0-9a-fA-F]{2}$/.test(hex)) return null;
      out += String.fromCharCode(parseInt(hex, 16));
      i += 2;
    } else if (esc === 'u') {
      if (raw[i + 1] === '{') {
        const end = raw.indexOf('}', i + 2);
        if (end < 0) return null;
        const hex = raw.slice(i + 2, end);
        if (!/^[0-9a-fA-F]{1,6}$/.test(hex)) return null;
        out += String.fromCodePoint(parseInt(hex, 16));
        i = end;
      } else {
        const hex = raw.slice(i + 1, i + 5);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) return null;
        out += String.fromCharCode(parseInt(hex, 16));
        i += 4;
      }
    } else {
      out += esc;
    }
  }
  return out;
}

/** 從行首開始讀取一個 JS 單引號或雙引號字串字面值，回傳解碼文字與結束後索引 */
function readJsStringLiteral(line: string, start: number): { value: string; next: number } | null {
  const quote = line[start];
  if (quote !== "'" && quote !== '"') return null;
  let i = start + 1;
  while (i < line.length) {
    const ch = line[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === quote) {
      const value = unescapeJsString(line.slice(start + 1, i));
      return value === null ? null : { value, next: i + 1 };
    }
    i += 1;
  }
  return null;
}

/**
 * 嚴格解析官方 `translate.zh_TW.js` / `translate.zh_CN.js`（不使用 eval）：
 * 僅允許空白、註解、宣告 `__` 的標頭與 `__['k'] = 'v';` 賦值行；任何無法辨識的行都整份拒絕。
 */
export function parseOfficialTranslateJs(source: string): Record<string, string> | null {
  const cleaned = source.replace(/^\uFEFF/, '');
  if (!cleaned || /^\s*</.test(cleaned.slice(0, 64))) return null;

  const strings: Record<string, string> = {};
  const lines = cleaned.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('//')) continue;
    if (/^(?:var\s+)?(?:window\.)?__\s*=\s*(?:(?:window\.)?__\s*\|\|\s*)?\{\}\s*;?$/.test(line)) {
      continue;
    }
    if (!line.startsWith('__[')) return null;
    const keyPart = readJsStringLiteral(line, 3);
    if (!keyPart) return null;
    const midMatch = line.slice(keyPart.next).match(/^\]\s*=\s*/);
    if (!midMatch) return null;
    const valStart = keyPart.next + midMatch[0].length;
    const valPart = readJsStringLiteral(line, valStart);
    if (!valPart) return null;
    const tail = line.slice(valPart.next).trim();
    if (tail && tail !== ';') return null;

    if (keyPart.value && valPart.value && valPart.value !== keyPart.value) {
      strings[keyPart.value] = valPart.value;
    }
  }

  const values = Object.values(strings);
  if (values.length < MIN_UI_STRINGS || !hasAnyCjk(values)) return null;
  return strings;
}

function collectTradeStatsEntries(raw: unknown) {
  if (!isRecord(raw) || !Array.isArray(raw.result)) return null;
  const labels: Record<string, string> = {};
  const groupedTexts = new Map<string, string[]>();
  const options: Record<string, Record<string, string>> = {};
  let hasPseudo = false;
  let totalEntries = 0;

  for (const group of raw.result) {
    if (!isRecord(group) || typeof group.id !== 'string' || !group.id) return null;
    if (group.id === 'pseudo') hasPseudo = true;
    if (typeof group.label === 'string' && group.label.trim()) {
      labels[group.id] = group.label.trim();
    }
    if (!Array.isArray(group.entries)) return null;
    for (const entry of group.entries) {
      if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id) return null;
      if (typeof entry.text !== 'string') continue;
      const text = entry.text.trim();
      if (!text) continue;
      totalEntries += 1;
      const list = groupedTexts.get(entry.id);
      if (list) list.push(text);
      else groupedTexts.set(entry.id, [text]);

      if (isRecord(entry.option) && Array.isArray(entry.option.options)) {
        const optionMap: Record<string, string> = options[entry.id] ?? {};
        for (const opt of entry.option.options) {
          if (!isRecord(opt)) continue;
          if (
            (typeof opt.id === 'string' || typeof opt.id === 'number') &&
            typeof opt.text === 'string'
          ) {
            const optText = opt.text.trim();
            if (optText) optionMap[String(opt.id)] = optText;
          }
        }
        if (Object.keys(optionMap).length > 0) options[entry.id] = optionMap;
      }
    }
  }

  if (!hasPseudo || totalEntries < MIN_STATS_COUNT) return null;
  const stats: Record<string, string | string[]> = {};
  for (const [id, list] of groupedTexts) {
    stats[id] = list.length === 1 ? list[0] : list;
  }
  return { labels, stats, options };
}

function hasCjkStatValues(stats: Record<string, string | string[]>): boolean {
  for (const val of Object.values(stats)) {
    if (typeof val === 'string' ? CJK_RE.test(val) : val.some((item) => CJK_RE.test(item))) {
      return true;
    }
  }
  return false;
}

export function parseOfficialTradeStats(
  raw: unknown,
): NonNullable<MarketTradeDictionary['stats']> | null {
  const parsed = collectTradeStatsEntries(raw);
  if (!parsed) return null;
  if (!hasCjkStatValues(parsed.stats)) return null;
  return parsed;
}

export function parseOfficialEnglishTradeStats(
  raw: unknown,
): Record<string, string | string[]> | null {
  const parsed = collectTradeStatsEntries(raw);
  return parsed ? parsed.stats : null;
}

export function parseOfficialTradeStatic(
  raw: unknown,
): NonNullable<MarketTradeDictionary['static']> | null {
  if (!isRecord(raw) || !Array.isArray(raw.result)) return null;
  const labels: Record<string, string> = {};
  const entries: Record<string, Record<string, string>> = {};
  let entryCount = 0;

  for (const group of raw.result) {
    if (!isRecord(group) || typeof group.id !== 'string' || !group.id) return null;
    if (typeof group.label === 'string' && group.label.trim()) {
      labels[group.id] = group.label.trim();
    }
    if (!Array.isArray(group.entries)) return null;
    const groupEntries: Record<string, string> = {};
    for (const entry of group.entries) {
      if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id) continue;
      // sep 僅為視覺分隔標題，同群組可能有多筆重複 id，不可覆蓋寫入
      if (entry.id === 'sep' || typeof entry.text !== 'string') continue;
      const text = entry.text.trim();
      if (!text) continue;
      groupEntries[entry.id] = text;
      entryCount += 1;
    }
    if (Object.keys(groupEntries).length > 0) entries[group.id] = groupEntries;
  }

  if (Object.keys(entries).length < MIN_STATIC_GROUPS || entryCount < MIN_STATIC_ENTRIES) {
    return null;
  }
  const hasCjkEntries = Object.values(entries).some((group) => hasAnyCjk(Object.values(group)));
  if (!hasCjkEntries) return null;
  return { labels, entries };
}

export function parseOfficialTradeFilters(
  raw: unknown,
): NonNullable<MarketTradeDictionary['filters']> | null {
  if (!isRecord(raw) || !Array.isArray(raw.result)) return null;
  const parsed = parseLiveTradeFilters(raw.result);
  if (!parsed) return null;
  if (!hasAnyCjk(Object.values(parsed.groups)) && !hasAnyCjk(Object.values(parsed.fields))) {
    return null;
  }
  return parsed;
}

export function parseOfficialEnglishTradeFilters(raw: unknown): Record<string, string> | null {
  if (!isRecord(raw) || !Array.isArray(raw.result)) return null;
  const parsed = parseLiveTradeFilters(raw.result);
  return parsed ? parsed.fields : null;
}

function collectTradeDiscItems(raw: unknown): MarketLiveDiscItemsRaw | null {
  if (!isRecord(raw) || !Array.isArray(raw.result) || raw.result.length === 0) return null;
  const byDisc: Record<string, Array<{ type: string; text: string }>> = {};
  const suffixCounts = new Map<string, Map<string, number>>();
  let hasGroupEntries = false;

  for (const group of raw.result) {
    if (!isRecord(group) || !Array.isArray(group.entries)) return null;
    if (group.entries.length > 0) hasGroupEntries = true;
    for (const entry of group.entries) {
      if (!isRecord(entry)) continue;
      const disc = typeof entry.disc === 'string' ? entry.disc.trim() : '';
      const type = typeof entry.type === 'string' ? entry.type.trim() : '';
      const text = typeof entry.text === 'string' ? entry.text.trim() : '';
      if (!disc || !type || !text) continue;
      (byDisc[disc] ??= []).push({ type, text });

      const name = typeof entry.name === 'string' ? entry.name.trim() : '';
      if (name) {
        const prefix = `${name} ${type}`;
        if (text.startsWith(prefix) && text.length > prefix.length) {
          const suffix = text.slice(prefix.length);
          let counts = suffixCounts.get(disc);
          if (!counts) {
            counts = new Map();
            suffixCounts.set(disc, counts);
          }
          counts.set(suffix, (counts.get(suffix) ?? 0) + 1);
        }
      }
    }
  }

  if (!hasGroupEntries) return null;
  const discSuffixes: Record<string, string> = {};
  for (const [disc, counts] of suffixCounts) {
    let bestSuffix = '';
    let bestCount = 0;
    for (const [suffix, count] of counts) {
      if (count > bestCount) {
        bestSuffix = suffix;
        bestCount = count;
      }
    }
    if (bestSuffix) discSuffixes[disc] = bestSuffix;
  }
  return { byDisc, discSuffixes };
}

export function parseOfficialTradeItems(raw: unknown): MarketLiveDiscItemsRaw | null {
  const parsed = collectTradeDiscItems(raw);
  if (!parsed) return null;
  const hasCjkEntries = Object.values(parsed.byDisc).some((entries) =>
    entries.some((entry) => CJK_RE.test(entry.text)),
  );
  const hasCjkSuffix = hasAnyCjk(Object.values(parsed.discSuffixes));
  if (!hasCjkEntries && !hasCjkSuffix) return null;
  return parsed;
}

export function parseOfficialEnglishTradeItems(raw: unknown): MarketLiveEnglishItems | null {
  const parsed = collectTradeDiscItems(raw);
  if (!parsed) return null;
  const byDisc: Record<string, Record<string, string>> = {};
  for (const [disc, entries] of Object.entries(parsed.byDisc)) {
    const map: Record<string, string> = {};
    for (const entry of entries) map[entry.type] = entry.text;
    if (Object.keys(map).length > 0) byDisc[disc] = map;
  }
  return {
    byDisc,
    ...(parsed.discSuffixes.legacy ? { legacySuffix: parsed.discSuffixes.legacy } : {}),
  };
}

const MIN_ENGLISH_RATIO_SAMPLE = 10;
const MAX_IDENTICAL_TO_ENGLISH_RATIO = 0.5;

function isMostlyIdenticalToEnglish(compared: number, identical: number): boolean {
  return (
    compared >= MIN_ENGLISH_RATIO_SAMPLE && identical / compared > MAX_IDENTICAL_TO_ENGLISH_RATIO
  );
}

/**
 * 依國際服英文 stats 過濾與驗證在地化 stats：
 * 1. 只保留國際服存在的 id，且重複出現次數需完全一致（避免 `localizeStats` 依索引對位錯亂）。
 * 2. 若重疊條目與英文完全相同的比例超過 50%，視為目標網域退回英文而拒絕整份。
 */
export function alignLiveStatsWithEnglish(
  localized: NonNullable<MarketTradeDictionary['stats']>,
  enStats: Readonly<Record<string, string | string[]>>,
): NonNullable<MarketTradeDictionary['stats']> | null {
  const alignedStats: Record<string, string | string[]> = {};
  let compared = 0;
  let identical = 0;

  for (const [id, locVal] of Object.entries(localized.stats)) {
    const enVal = enStats[id];
    if (enVal === undefined) continue;
    if (typeof locVal === 'string' && typeof enVal === 'string') {
      compared += 1;
      if (locVal === enVal) identical += 1;
      alignedStats[id] = locVal;
      continue;
    }
    if (Array.isArray(locVal) && Array.isArray(enVal) && locVal.length === enVal.length) {
      for (let i = 0; i < locVal.length; i += 1) {
        compared += 1;
        if (locVal[i] === enVal[i]) identical += 1;
      }
      alignedStats[id] = locVal;
    }
  }

  if (
    Object.keys(alignedStats).length < MIN_STATS_COUNT ||
    isMostlyIdenticalToEnglish(compared, identical)
  ) {
    return null;
  }

  const alignedOptions: Record<string, Record<string, string>> = {};
  for (const [id, opts] of Object.entries(localized.options)) {
    if (id in alignedStats) alignedOptions[id] = opts;
  }
  return { labels: localized.labels, stats: alignedStats, options: alignedOptions };
}

export function isFiltersMostlyEnglish(
  localized: NonNullable<MarketTradeDictionary['filters']>,
  enFields: Readonly<Record<string, string>>,
): boolean {
  let compared = 0;
  let identical = 0;
  for (const [id, locText] of Object.entries(localized.fields)) {
    const enText = enFields[id];
    if (typeof enText !== 'string') continue;
    compared += 1;
    if (locText === enText) identical += 1;
  }
  return isMostlyIdenticalToEnglish(compared, identical);
}

/**
 * 依國際服英文 items 過濾並驗證在地化 `disc` 群組：
 * 只收錄半數以上條目的 `type` 與英文相同且 `text` 已翻譯的群組（排除以在地化基底名為 type 的 `legacy`/`alt_x` 等），
 * 同時驗證 `legacy` 後綴未退回英文。
 */
export function alignLiveTradeItemsWithEnglish(
  localized: MarketLiveDiscItemsRaw,
  enItems: MarketLiveEnglishItems,
): NonNullable<MarketTradeDictionary['tradeItems']> | null {
  if (enItems.legacySuffix && localized.discSuffixes.legacy === enItems.legacySuffix) {
    return null;
  }
  const discEntries: Record<string, Record<string, string>> = {};
  let compared = 0;
  let identical = 0;

  for (const [disc, entries] of Object.entries(localized.byDisc)) {
    const enGroup = enItems.byDisc[disc];
    if (!enGroup) continue;
    const matched: Record<string, string> = {};
    let matchedCount = 0;
    for (const entry of entries) {
      const enText = enGroup[entry.type];
      if (!enText) continue;
      compared += 1;
      if (entry.text === enText) {
        identical += 1;
      } else {
        matched[entry.type] = entry.text;
        matchedCount += 1;
      }
    }
    if (matchedCount > 0 && matchedCount * 2 >= entries.length) {
      discEntries[disc] = matched;
    }
  }

  if (Object.keys(discEntries).length > 0 && isMostlyIdenticalToEnglish(compared, identical)) {
    return null;
  }
  // 只收已翻譯的後綴：官方退回英文的後綴不得覆蓋內建的中文後綴（不只 legacy，alt_x 等亦同）
  const discSuffixes = Object.fromEntries(
    Object.entries(localized.discSuffixes).filter(([, suffix]) => CJK_RE.test(suffix)),
  );
  if (Object.keys(discEntries).length === 0 && Object.keys(discSuffixes).length === 0) {
    return null;
  }
  return { discEntries, discSuffixes };
}
