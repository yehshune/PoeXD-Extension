/**
 * 把 PoB 物品文字裡的英文詞綴翻成顯示語言，供購物清單顯示。
 *
 * 用的是市集漢化的同一份對照（ADR-0012 的 `mod-lines.json`：每個 stat hash 的英文句型與
 * 官方譯文句型），所以譯文就是該區服遊戲內的寫法。先以骨架找出可能的句型，再由
 * `translateModLine` 把數值填進同一個變體的譯文。整句對不到時依序嘗試：
 *
 * 1. PoB 會在輔助寶石名稱後多寫一個「Support」，去掉再比一次。
 * 2. 句中帶寶石名稱的兩種句型（插槽中的寶石被輔助、賦予技能）：對照資料只收錄了部分寶石，
 *    從已收錄的句子學出「名稱以外的框架」，再套上物品表裡的寶石譯名。
 * 3. 固定前綴加上一句普通詞綴（例如 `Bonded: …`、`… also grant …`）：後半句照常翻譯，
 *    前綴的譯文從對照資料裡同前綴的句子學出來，學不到再查標籤表，都沒有就保留英文前綴。
 *
 * 所有中文都來自官方資料，沒有手寫的字典。只有 zh-TW、zh-CN 有對照資料；其他語言沒有
 * 翻譯器。翻不了的詞綴回傳 undefined，由呼叫端顯示英文原文。
 */
import { translateModLine, type ModLinePairs } from './market-mod-lines';
import { modLineSkeleton, modTemplateSkeleton } from './pob-stat-matcher';
import {
  getLocaleItemsAssetPath,
  getLocaleModLinesAssetPath,
  getLocaleResultLabelsAssetPath,
  type PoeVersion,
} from './trade-context';

export interface ModLineTranslator {
  translate(englishLine: string): string | undefined;
}

export interface ModLineTranslatorExtras {
  /** 英文物品名（含寶石）→ 譯名 */
  toLocalizedName?: (english: string) => string | undefined;
  /** 介面標籤（英文 → 譯文），用來翻前綴 */
  labels?: Readonly<Record<string, string>>;
}

type Pair = readonly [english: string, localized: string];

const TRANSLATED_LOCALES: readonly string[] = ['zh-TW', 'zh-CN'];
const SUPPORT_SUFFIX = ' Support';
const NAME_SLOT = '\u0001';
const LEVEL_PLACEHOLDER = '{0:d}';
/** 前綴與後半句之間的分隔；依序嘗試，前綴含分隔字本身 */
const PREFIX_SEPARATORS: readonly string[] = [': ', ' also grant '];
const MAX_LEARNING_SAMPLES = 40;

/** 句中帶寶石名稱的句型：名稱在等級之後，結尾可能有固定字 */
const NAMED_PATTERNS: ReadonlyArray<{
  line: RegExp;
  template: RegExp;
  /** 名稱在物品表裡可能多一個後綴（輔助寶石） */
  nameSuffix: string;
}> = [
  {
    line: /^(Socketed Gems are Supported by Level )(\d+) (.+?)(?: Support)?$/,
    template: /^(Socketed Gems are Supported by Level )\{0:d\} (.+)$/,
    nameSuffix: SUPPORT_SUFFIX,
  },
  {
    line: /^(Grants Level )(\d+) (.+?) Skill$/,
    template: /^(Grants Level )\{0:d\} (.+?) Skill$/,
    nameSuffix: '',
  },
];

/** 出現最多次的那個值 */
function mostCommon(values: readonly string[]): string | undefined {
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
}

export function createModLineTranslator(
  modLines: Readonly<Record<string, ModLinePairs>>,
  extras: ModLineTranslatorExtras = {},
): ModLineTranslator {
  // 骨架 → 英文句型相符的 [英文, 譯文]；同一句英文在不同 hash 下譯文相同，留第一筆即可
  const pairsBySkeleton = new Map<string, Pair[]>();
  const allPairs: Pair[] = [];
  for (const pairs of Object.values(modLines)) {
    if (!Array.isArray(pairs)) continue;
    for (const [english, localized] of pairs) {
      if (typeof english !== 'string' || typeof localized !== 'string') continue;
      const skeleton = modTemplateSkeleton(english);
      const known = pairsBySkeleton.get(skeleton) ?? [];
      if (known.some(([knownEnglish]) => knownEnglish === english)) continue;
      pairsBySkeleton.set(skeleton, [...known, [english, localized]]);
      allPairs.push([english, localized]);
    }
  }

  const translateWhole = (line: string): string | undefined => {
    const pairs = pairsBySkeleton.get(modLineSkeleton(line));
    return (pairs && translateModLine(line, pairs)) || undefined;
  };

  const localizedName = (english: string, suffix: string): string | undefined =>
    (suffix ? extras.toLocalizedName?.(`${english}${suffix}`) : undefined) ??
    extras.toLocalizedName?.(english);

  /** 從已收錄的句子學出每種句型的框架：譯文裡把寶石譯名換成名稱欄位 */
  const namedFrames = NAMED_PATTERNS.map((pattern) => {
    const frames = allPairs.flatMap(([english, localized]) => {
      const match = pattern.template.exec(english);
      const name = match && localizedName(match[2], pattern.nameSuffix);
      if (!name || !localized.includes(name) || !localized.includes(LEVEL_PLACEHOLDER)) return [];
      return [localized.replace(name, NAME_SLOT)];
    });
    return mostCommon(frames);
  });

  const translateNamed = (line: string): string | undefined => {
    for (const [index, pattern] of NAMED_PATTERNS.entries()) {
      const match = pattern.line.exec(line);
      const frame = namedFrames[index];
      const name = match && localizedName(match[3], pattern.nameSuffix);
      if (!match || !frame || !name) continue;
      return frame.replace(LEVEL_PLACEHOLDER, match[2]).replace(NAME_SLOT, name);
    }
    return undefined;
  };

  /** 前綴（含分隔字）的譯文：找同前綴、後半句翻得出來的句子，取譯文裡後半句之前的部分 */
  const learnedPrefixes = new Map<string, string | undefined>();
  const learnPrefix = (prefix: string): string | undefined => {
    if (learnedPrefixes.has(prefix)) return learnedPrefixes.get(prefix);
    const samples = allPairs
      .filter(([english]) => english.startsWith(prefix))
      .slice(0, MAX_LEARNING_SAMPLES)
      .flatMap(([english, localized]) => {
        const tail = allPairs.find(([candidate]) => candidate === english.slice(prefix.length));
        return tail && localized.endsWith(tail[1])
          ? [localized.slice(0, localized.length - tail[1].length)]
          : [];
      });
    const learned = mostCommon(samples);
    learnedPrefixes.set(prefix, learned);
    return learned;
  };

  const translatePrefixed = (line: string): string | undefined => {
    for (const separator of PREFIX_SEPARATORS) {
      const at = line.indexOf(separator);
      if (at <= 0) continue;
      const prefix = line.slice(0, at + separator.length);
      const tail = translateLine(line.slice(prefix.length));
      if (!tail) continue;
      const label = extras.labels?.[prefix.trim()];
      return `${learnPrefix(prefix) ?? (label ? `${label} ` : prefix)}${tail}`;
    }
    return undefined;
  };

  const cache = new Map<string, string | undefined>();
  function translateLine(line: string): string | undefined {
    if (cache.has(line)) return cache.get(line);
    cache.set(line, undefined);
    const translated =
      translateWhole(line) ??
      (line.endsWith(SUPPORT_SUFFIX)
        ? translateWhole(line.slice(0, -SUPPORT_SUFFIX.length))
        : undefined) ??
      translateNamed(line) ??
      translatePrefixed(line);
    cache.set(line, translated);
    return translated;
  }

  return { translate: translateLine };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string');

/** 兩份以索引對齊的物品名做成「英文 → 譯名」；對不齊時不提供名稱翻譯 */
function buildNameLookup(english: unknown, localized: unknown) {
  const en = isRecord(english) ? english.items : undefined;
  const loc = isRecord(localized) ? localized.items : undefined;
  if (!isStringArray(en) || !isStringArray(loc) || en.length !== loc.length) return undefined;
  const names = new Map<string, string>();
  en.forEach((name, index) => {
    if (name && loc[index] && !names.has(name)) names.set(name, loc[index]);
  });
  return (name: string) => names.get(name);
}

function readLabels(data: unknown): Record<string, string> | undefined {
  const labels = isRecord(data) ? data.labels : undefined;
  if (!isRecord(labels)) return undefined;
  return Object.fromEntries(
    Object.entries(labels).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

/** 該語言沒有對照資料時回傳 undefined（不是錯誤） */
export async function loadModLineTranslator(
  loadJson: (path: string) => Promise<unknown>,
  options: { version: PoeVersion; locale: string },
): Promise<ModLineTranslator | undefined> {
  const { version, locale } = options;
  if (!TRANSLATED_LOCALES.includes(locale)) return undefined;
  // 句型對照是必要的；物品名與標籤只用來補強，載不到就少翻幾種句子
  const optional = (path: string) => loadJson(path).catch(() => undefined);
  const [data, englishItems, localizedItems, labels] = await Promise.all([
    loadJson(getLocaleModLinesAssetPath(version, locale)),
    optional(getLocaleItemsAssetPath(version, 'en')),
    optional(getLocaleItemsAssetPath(version, locale)),
    optional(getLocaleResultLabelsAssetPath(version, locale)),
  ]);
  const lines = isRecord(data) ? data.lines : undefined;
  if (!isRecord(lines)) throw new Error('mod-lines.json 格式錯誤');
  return createModLineTranslator(lines as Record<string, ModLinePairs>, {
    toLocalizedName: buildNameLookup(englishItems, localizedItems),
    labels: readLabels(labels),
  });
}
