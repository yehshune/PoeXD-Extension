/**
 * 把 PoB 物品文字裡的英文詞綴翻成顯示語言，供購物清單顯示。
 *
 * 句型來自 poexd-data 的官方資料：市集漢化的 `mod-lines.json`（ADR-0012）與
 * `stat-text-items.json`（物品詞綴描述檔裡 mod-lines 沒收錄的句子，ADR-0015），都是每個 stat hash 的
 * 英文句型與官方譯文句型，所以譯文就是該區服遊戲內的寫法。先以骨架找出可能的句型，再由
 * `translateModLine` 把數值填進同一個變體的譯文。整句對不到時依序嘗試：
 *
 * 1. PoB 會在輔助寶石名稱後多寫一個「Support」，去掉再比一次。
 * 2. 句中帶寶石名稱的兩種句型（插槽中的寶石被輔助、賦予技能）：對照資料只收錄了部分寶石，
 *    從已收錄的句子學出「名稱以外的框架」，再套上物品表裡的寶石譯名。
 * 3. 固定前綴加上一句普通詞綴（例如 `Bonded: …`、`… also grant …`）：後半句照常翻譯，
 *    前綴的譯文從對照資料裡同前綴的句子學出來，學不到再查標籤表，都沒有就保留英文前綴。
 *
 * 舊英文寫法：GGG 改寫英文後（例如 3.30 的 `+#% to Item Rarity`），之前匯出的物品文字仍是
 * 舊寫法。`stat-aliases.json` 記錄每個 hash 的「舊英文 → 現行英文」，舊寫法因此也對到同一個
 * 譯文；兩邊的增加／減少寫法不同時，由 `translateModLine` 換算正負號。
 *
 * 最後的備援是市集 `trade-stats.json`（英文與譯文以同一個代碼對齊）：它收錄了選項型詞綴
 * （塗油的 `Allocates …`、星團珠寶附魔）。描述檔裡一個 stat 寫成多行的句子（例如藥劑的
 * 免疫流血／腐化之血），PoB 會拆成多行，所以兩邊行數相同時每一行也各自當成一個句型。
 *
 * 所有中文都來自官方資料，沒有手寫的字典。只有 zh-TW、zh-CN 有對照資料；其他語言沒有
 * 翻譯器。翻不了的詞綴回傳 undefined，由呼叫端顯示英文原文。
 */
import { tradeTextToModTemplate, translateModLine, type ModLinePairs } from './market-mod-lines';
import { modLineSkeleton, modTemplateSkeleton } from './pob-stat-matcher';
import { loadPairedLineShard } from './paired-line-shards';
import {
  getLocaleItemsAssetPath,
  getLocaleResultLabelsAssetPath,
  getLocaleTradeStatsAssetPath,
  getStatAliasesAssetPath,
  type PoeVersion,
} from './trade-context';

/** 市集 stat 代碼 → 文字；同一代碼有多種寫法時是陣列 */
export type TradeStatTexts = Readonly<Record<string, string | readonly string[]>>;

export interface ModLineTranslatorOptions {
  /**
   * 前綴翻不出來時保留英文前綴、只翻後半句（預設 true）。合併多行一起翻時要關掉：
   * 保留英文前綴會把「前幾行英文 + 最後一行的前綴」當成前綴，讓整組看起來翻譯成功。
   */
  keepEnglishPrefix?: boolean;
}

export interface ModLineTranslator {
  translate(englishLine: string, options?: ModLineTranslatorOptions): string | undefined;
}

export interface ModLineTranslatorExtras {
  /** 英文物品名（含寶石）→ 譯名 */
  toLocalizedName?: (english: string) => string | undefined;
  /** 介面標籤（英文 → 譯文），用來翻前綴 */
  labels?: Readonly<Record<string, string>>;
  /** 市集 stat 文字（英文、譯文），補 mod-lines 沒收錄的句型 */
  tradeStats?: { english: TradeStatTexts; localized: TradeStatTexts };
  /** 物品 stat 文字（stat-text-items.json 的 lines），排在 mod-lines 之後 */
  statText?: Readonly<Record<string, ModLinePairs>>;
  /** 舊英文寫法（stat hash → [舊英文模板, 現行英文模板]） */
  aliases?: Readonly<Record<string, ReadonlyArray<readonly [string, string]>>>;
}

/** 有效的句型對：兩邊都是字串 */
const validPairs = (pairs: unknown): Pair[] =>
  Array.isArray(pairs)
    ? pairs.filter(
        (pair): pair is Pair =>
          Array.isArray(pair) && typeof pair[0] === 'string' && typeof pair[1] === 'string',
      )
    : [];

/**
 * 舊英文寫法的句型：在同一個 hash 的句型裡找到現行英文的譯文，讓舊英文也對到它。
 * 找不到現行英文（該語系沒有譯文）的別名略過。
 */
export function aliasPairs(
  aliases: Readonly<Record<string, ReadonlyArray<readonly [string, string]>>>,
  sources: ReadonlyArray<Readonly<Record<string, ModLinePairs>>>,
): Pair[] {
  return Object.entries(aliases).flatMap(([hash, entries]) => {
    const candidates = sources.flatMap((source) => validPairs(source[hash]));
    return validPairs(entries).flatMap(([legacy, current]) => {
      const localized = candidates.find(([english]) => english === current)?.[1];
      return localized === undefined ? [] : [[legacy, localized] as const];
    });
  });
}

type Pair = readonly [english: string, localized: string];

/** mod-lines 以字面的 `\n` 分行，市集文字用真的換行 */
const LINE_BREAK = /\\n|\n/;
const TRADE_PLACEHOLDER = /#/g;
/** 市集文字的佔位符只依出現順序編號，兩個以上時無法確定譯文的數值順序，不採用 */
const MAX_TRADE_PLACEHOLDERS = 1;
const SKIPPED_TRADE_DOMAIN = 'pseudo.';

/** 句型本身，加上行數相同時的每一行 */
function expandPair(pair: Pair): Pair[] {
  const englishLines = pair[0].split(LINE_BREAK);
  const localizedLines = pair[1].split(LINE_BREAK);
  if (englishLines.length < 2 || englishLines.length !== localizedLines.length) return [pair];
  return [pair, ...englishLines.map((line, index) => [line, localizedLines[index]] as const)];
}

const asTextList = (value: string | readonly string[] | undefined): readonly string[] =>
  typeof value === 'string' ? [value] : (value ?? []);

const countPlaceholders = (text: string) => text.match(TRADE_PLACEHOLDER)?.length ?? 0;

/** 市集文字轉成 [英文句型, 譯文句型]；寫法數量或佔位符數量對不上的略過 */
export function tradeStatPairs(english: TradeStatTexts, localized: TradeStatTexts): Pair[] {
  return Object.entries(english).flatMap(([id, value]) => {
    if (id.startsWith(SKIPPED_TRADE_DOMAIN)) return [];
    const englishTexts = asTextList(value);
    const localizedTexts = asTextList(localized[id]);
    if (englishTexts.length === 0 || englishTexts.length !== localizedTexts.length) return [];
    return englishTexts.flatMap((text, index) => {
      const translated = localizedTexts[index];
      const placeholders = countPlaceholders(text);
      if (placeholders > MAX_TRADE_PLACEHOLDERS || placeholders !== countPlaceholders(translated)) {
        return [];
      }
      return [[tradeTextToModTemplate(text), tradeTextToModTemplate(translated)] as const];
    });
  });
}

const TRANSLATED_LOCALES: readonly string[] = ['zh-TW', 'zh-CN'];
const SUPPORT_SUFFIX = ' Support';
const NAME_SLOT = '\u0001';
const LEVEL_PLACEHOLDER = '{0:d}';
/** pobb.in 懸浮框保留的數值範圍（例如 `(100-129)`、`(-20--10)`）；以暫代數值比對句型後還原 */
const VALUE_RANGE = /\((-?\d+(?:\.\d+)?--?\d+(?:\.\d+)?)\)/g;
const RANGE_SENTINEL_BASE = 98765401;
/** 前綴與後半句之間的分隔；依序嘗試，前綴含分隔字本身 */
const PREFIX_SEPARATORS: readonly string[] = [': ', ' also grant '];
const MAX_LEARNING_SAMPLES = 40;
/** 不保留英文前綴的翻譯結果另外快取，鍵加上這個前綴（英文句子不會含 NUL） */
const STRICT_CACHE_PREFIX = '\u0000';

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

interface PairIndex {
  /** 去重後的句型（含多行拆出的每一行），依加入順序 */
  pairs: readonly Pair[];
  translateWhole(line: string): string | undefined;
}

/** 骨架 → 英文句型相符的 [英文, 譯文]；同一句英文在不同 hash 下譯文相同，留第一筆即可 */
function createPairIndex(source: readonly Pair[]): PairIndex {
  const bySkeleton = new Map<string, Pair[]>();
  const pairs: Pair[] = [];
  for (const pair of source.flatMap(expandPair)) {
    const skeleton = modTemplateSkeleton(pair[0]);
    const known = bySkeleton.get(skeleton) ?? [];
    if (known.some(([english]) => english === pair[0])) continue;
    bySkeleton.set(skeleton, [...known, pair]);
    pairs.push(pair);
  }
  return {
    pairs,
    translateWhole: (line) => {
      const candidates = bySkeleton.get(modLineSkeleton(line));
      return (candidates && translateModLine(line, candidates)) || undefined;
    },
  };
}

export function createModLineTranslator(
  modLines: Readonly<Record<string, ModLinePairs>>,
  extras: ModLineTranslatorExtras = {},
): ModLineTranslator {
  // 現行寫法在前：同一句英文以 mod-lines、再以完整目錄的譯文為準，舊寫法最後
  const statText = extras.statText ?? {};
  const primary = createPairIndex([
    ...Object.values(modLines).flatMap(validPairs),
    ...Object.values(statText).flatMap(validPairs),
    ...(extras.aliases ? aliasPairs(extras.aliases, [modLines, statText]) : []),
  ]);
  // 市集文字是最後的備援：它的部分寫法（例如輔助寶石句子）不如從 mod-lines 學出的框架
  const fallback = createPairIndex(
    extras.tradeStats ? tradeStatPairs(extras.tradeStats.english, extras.tradeStats.localized) : [],
  );
  const allPairs = primary.pairs;

  const withoutSupport = (line: string, translate: (text: string) => string | undefined) =>
    translate(line) ??
    (line.endsWith(SUPPORT_SUFFIX) ? translate(line.slice(0, -SUPPORT_SUFFIX.length)) : undefined);

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

  /**
   * 前綴加後半句。前綴學不到也查不到標籤時保留英文前綴，但這樣的結果只在其他方法都失敗時
   * 才採用（`keepEnglishPrefix`），以免蓋過市集文字的完整譯文。
   */
  const translatePrefixed = (line: string, keepEnglishPrefix: boolean): string | undefined => {
    for (const separator of PREFIX_SEPARATORS) {
      const at = line.indexOf(separator);
      if (at <= 0) continue;
      const prefix = line.slice(0, at + separator.length);
      const tail = translateLine(line.slice(prefix.length));
      if (!tail) continue;
      const label = extras.labels?.[prefix.trim()];
      const localizedPrefix = learnPrefix(prefix) ?? (label ? `${label} ` : undefined);
      if (localizedPrefix) return `${localizedPrefix}${tail}`;
      if (keepEnglishPrefix) return `${prefix}${tail}`;
    }
    return undefined;
  };

  const cache = new Map<string, string | undefined>();
  function translateCore(line: string, keepEnglishPrefix: boolean): string | undefined {
    return (
      withoutSupport(line, primary.translateWhole) ??
      translateNamed(line) ??
      translatePrefixed(line, false) ??
      withoutSupport(line, fallback.translateWhole) ??
      (keepEnglishPrefix ? translatePrefixed(line, true) : undefined)
    );
  }

  function translateLine(line: string, options?: ModLineTranslatorOptions): string | undefined {
    const keepEnglishPrefix = options?.keepEnglishPrefix !== false;
    const cacheKey = keepEnglishPrefix ? line : `${STRICT_CACHE_PREFIX}${line}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    cache.set(cacheKey, undefined);
    const ranges: Array<{ sentinel: string; text: string }> = [];
    const normalized = line.replace(VALUE_RANGE, (match) => {
      const sentinel = String(RANGE_SENTINEL_BASE + ranges.length);
      ranges.push({ sentinel, text: match });
      return sentinel;
    });
    const raw = translateCore(normalized, keepEnglishPrefix);
    const translated =
      raw && ranges.length > 0
        ? ranges.reduce((text, { sentinel, text: range }) => text.replace(sentinel, range), raw)
        : raw;
    cache.set(cacheKey, translated);
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

/** `trade-stats.json` 的 `stats`；格式不對時回傳 undefined，只保留字串與字串陣列 */
export function readTradeStats(data: unknown): TradeStatTexts | undefined {
  const stats = isRecord(data) ? data.stats : undefined;
  if (!isRecord(stats)) return undefined;
  return Object.fromEntries(
    Object.entries(stats).filter(
      (entry): entry is [string, string | string[]] =>
        typeof entry[1] === 'string' || isStringArray(entry[1]),
    ),
  );
}

/** stat-text-items.json 的 `lines`；格式不對時回傳 undefined */
export function readStatText(data: unknown): Record<string, ModLinePairs> | undefined {
  const lines = isRecord(data) ? data.lines : undefined;
  return isRecord(lines) ? (lines as Record<string, ModLinePairs>) : undefined;
}

/** stat-aliases.json 的 `aliases`；格式不對時回傳 undefined */
export function readAliases(
  data: unknown,
): Record<string, ReadonlyArray<readonly [string, string]>> | undefined {
  const aliases = isRecord(data) ? data.aliases : undefined;
  return isRecord(aliases)
    ? (aliases as Record<string, ReadonlyArray<readonly [string, string]>>)
    : undefined;
}

/** 該語言沒有對照資料時回傳 undefined（不是錯誤） */
export async function loadModLineTranslator(
  loadJson: (path: string) => Promise<unknown>,
  options: { version: PoeVersion; locale: string },
): Promise<ModLineTranslator | undefined> {
  const { version, locale } = options;
  if (!TRANSLATED_LOCALES.includes(locale)) return undefined;
  // mod-lines 是必要的；其餘只用來補強，載不到就少翻幾種句子
  const optional = (path: string) => loadJson(path).catch(() => undefined);
  const [
    data,
    englishItems,
    localizedItems,
    labels,
    englishStats,
    localizedStats,
    statText,
    aliases,
  ] = await Promise.all([
    loadPairedLineShard(loadJson, 'mod-lines', version, locale),
    optional(getLocaleItemsAssetPath(version, 'en')),
    optional(getLocaleItemsAssetPath(version, locale)),
    optional(getLocaleResultLabelsAssetPath(version, locale)),
    optional(getLocaleTradeStatsAssetPath(version, 'en')),
    optional(getLocaleTradeStatsAssetPath(version, locale)),
    loadPairedLineShard(loadJson, 'stat-text-items', version, locale).catch(() => undefined),
    optional(getStatAliasesAssetPath(version)),
  ]);
  const lines = isRecord(data) ? data.lines : undefined;
  if (!isRecord(lines)) throw new Error('mod-lines.json 格式錯誤');
  const english = readTradeStats(englishStats);
  const localized = readTradeStats(localizedStats);
  return createModLineTranslator(lines as Record<string, ModLinePairs>, {
    toLocalizedName: buildNameLookup(englishItems, localizedItems),
    labels: readLabels(labels),
    ...(english && localized ? { tradeStats: { english, localized } } : {}),
    statText: readStatText(statText),
    aliases: readAliases(aliases),
  });
}
