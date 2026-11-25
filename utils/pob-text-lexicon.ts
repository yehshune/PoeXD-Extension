/**
 * PoB 物品文字用的英文反查字典：把在地化頁面的詞綴與物品名轉回英文。
 *
 * 資料與市集漢化共用（ADR-0012 的 `mod-lines.json` 與兩份索引對齊的 `items.json`），
 * 只是方向相反：以譯文模板比對頁面上的句子，再把數值填回同一個變體的英文模板。
 * `mod-lines.json` 只有 zh-TW、zh-CN，其他語系載入會失敗，呼叫端據此告知不支援。
 */
import { translateModLine, type ModLinePairs } from './market-mod-lines';
import type { PobTextLexicon } from './pob-item-text';
import { loadPairedLineShard } from './paired-line-shards';
import { getLocaleItemsAssetPath, type PoeVersion } from './trade-context';

export interface PobTextLexiconData {
  /** stat hash → [英文模板, 譯文模板] */
  modLines: Readonly<Record<string, ModLinePairs>>;
  /** 兩份物品名以索引對齊 */
  englishItems: readonly string[];
  localizedItems: readonly string[];
}

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string');

function buildEnglishNameIndex(data: PobTextLexiconData): ReadonlyMap<string, readonly string[]> {
  const index = new Map<string, string[]>();
  data.localizedItems.forEach((localized, position) => {
    const english = data.englishItems[position];
    if (!localized || !english) return;
    const candidates = index.get(localized) ?? [];
    if (!candidates.includes(english)) index.set(localized, [...candidates, english]);
  });
  return index;
}

export function createPobTextLexicon(data: PobTextLexiconData): PobTextLexicon {
  const englishNames = buildEnglishNameIndex(data);
  const reversedPairs = new Map<string, ModLinePairs>();

  const pairsFor = (statHash: string): ModLinePairs | undefined => {
    const cached = reversedPairs.get(statHash);
    if (cached) return cached;
    const pairs = data.modLines[statHash];
    if (!Array.isArray(pairs)) return undefined;
    const reversed = pairs.map(([english, localized]) => [localized, english] as const);
    reversedPairs.set(statHash, reversed);
    return reversed;
  };

  return {
    toEnglishModLine: (line, statHash) =>
      statHash ? translateModLine(line, pairsFor(statHash)) : null,
    toEnglishNames: (localized) => englishNames.get(localized) ?? [],
  };
}

function readItems(data: unknown, name: string): string[] {
  const items = isRecord(data) ? data.items : undefined;
  if (!isStringArray(items)) throw new Error(`${name} 格式錯誤`);
  return items;
}

export async function loadPobTextLexicon(
  loadJson: (path: string) => Promise<unknown>,
  options: { version: PoeVersion; locale: string },
): Promise<PobTextLexicon> {
  const { version, locale } = options;
  const [modLines, english, localized] = await Promise.all([
    loadPairedLineShard(loadJson, 'mod-lines', version, locale),
    loadJson(getLocaleItemsAssetPath(version, 'en')),
    loadJson(getLocaleItemsAssetPath(version, locale)),
  ]);
  if (!isRecord(modLines) || modLines.locale !== locale || !isRecord(modLines.lines)) {
    throw new Error('mod-lines.json 格式或語系不符');
  }
  const englishItems = readItems(english, 'items.json (en)');
  const localizedItems = readItems(localized, `items.json (${locale})`);
  // 長度不同代表兩份不是同一次建置，索引對不上
  if (englishItems.length !== localizedItems.length) {
    throw new Error('items.json 索引無法對齊');
  }
  return createPobTextLexicon({
    modLines: modLines.lines as Record<string, ModLinePairs>,
    englishItems,
    localizedItems,
  });
}
