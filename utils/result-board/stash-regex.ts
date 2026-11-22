/**
 * 倉庫搜尋 regex（GLOSSARY.md「Stash Search Regex」、ADR-0018）：貼到遊戲內賣家藏身處的倉庫搜尋，
 * 一次標出所有要買的物品。純函式，不依賴看板，之後可重用到單件結果列與釘選物品。
 *
 * 遊戲內實測（2026-11-20，維護者回報）：
 * - 漢化客戶端只有物品名稱、基底與備註標價（例如 `~b/o 2 chaos`）能用英文比對，詞綴、物品等級等不行，
 *   所以只用這三種文字。
 * - 直購物品的標價可用市集寫法比對到。
 * - PoE 1 與 PoE 2 倉庫搜尋的字數上限都是 250。
 *
 * 一段的形狀是 `"名稱1|名稱2" "基底1|基底2" "標價1|標價2"`：以空白分開的條件全部成立才會標出，
 * 每個條件內用 `|` 表示任一。遊戲沒有跨條件的「或」，所以名稱、基底、標價是分開比對的，
 * 「名稱 A 配標價 B」的組合也會被標出；基底條件讓這種組合還得對上基底才會誤中。
 * 每段都會拿同賣家其他已載入物品實際比對一次，標得到的就回報為無法區分。
 *
 * 優先一次貼完：超過字數上限時依序合併標價開頭、縮短名稱、拿掉基底條件，仍超過才拆段；
 * 拆段後每段再各自換回放得下的最精確寫法。
 */
import type { PoeVersion } from '@/utils/trade-context';

/** 倉庫搜尋框的字數上限（依遊戲版本） */
export const STASH_SEARCH_MAX_LENGTH: Readonly<Record<PoeVersion, number>> = {
  poe1: 250,
  poe2: 250,
};

/** 縮短名稱時至少保留的字數 */
const MIN_NAME_LENGTH = 4;

export interface StashRegexItem {
  id: string;
  /** 稀有／傳奇物品的名稱；其他物品為空字串 */
  name: string;
  typeLine: string;
  /** 基底名稱；魔法物品的 `typeLine` 含詞綴，基底只有這裡有 */
  baseType?: string;
  /** 遊戲內物品的標價備註，市集寫法（例如 `~b/o 2 chaos`）；沒有標價時為 undefined */
  note?: string;
}

export interface StashRegexInput {
  /** 要標出的物品 */
  picked: readonly StashRegexItem[];
  /** 同賣家其他已載入、不要標出的物品 */
  others: readonly StashRegexItem[];
  maxLength: number;
}

export interface StashRegexResult {
  /** 依序貼上的各段；空陣列表示沒有可產生的物品 */
  parts: readonly string[];
  /** 也會被標出、無法和勾選物品區分的其他物品 id */
  ambiguousIds: readonly string[];
  /** 沒有標價、只用名稱比對的勾選物品 id */
  unpricedIds: readonly string[];
  /** 單獨一件就超過字數上限、沒有放進任何一段的勾選物品 id */
  tooLongIds: readonly string[];
}

/** 遊戲的 regex 特殊字元；`!` 在條件開頭代表排除，一併跳脫 */
const SPECIAL_CHARACTERS = /[\\^$.|?*+()[\]{}!]/g;

/** 跳脫成字面文字；條件用雙引號包住，引號本身改成任一字元 */
export const escapeStashText = (value: string): string =>
  value.replace(SPECIAL_CHARACTERS, '\\$&').replace(/"/g, '.');

const normalizeText = (value: string): string => value.replace(/\s+/g, ' ').trim();

/** 比對用的名稱：稀有與傳奇用名稱，其他用類型（基底或魔法物品全名） */
export const stashKeyOf = (item: StashRegexItem): string =>
  normalizeText(item.name) || normalizeText(item.typeLine);

const linesOf = (item: StashRegexItem): string[] =>
  [item.name, item.typeLine, item.baseType ?? '', item.note ?? '']
    .map(normalizeText)
    .filter(Boolean);

const unique = <T>(values: readonly T[]): T[] => Array.from(new Set(values));

const NOTE_PATTERN = /^(~b\/o|~price) (.+)$/;

/**
 * 標價條件。`compact` 時依標價類型合併共同的開頭：`~b/o (2 chaos|1 divine)`
 */
function noteAlternation(notes: readonly string[], compact: boolean): string {
  if (!compact) return notes.map(escapeStashText).join('|');
  const groups = new Map<string, string[]>();
  const loose: string[] = [];
  for (const note of notes) {
    const match = NOTE_PATTERN.exec(note);
    if (!match) {
      loose.push(escapeStashText(note));
      continue;
    }
    const [, type, rest] = match;
    groups.set(type, [...(groups.get(type) ?? []), escapeStashText(rest)]);
  }
  const grouped = Array.from(groups, ([type, rests]) =>
    rests.length === 1
      ? `${escapeStashText(type)} ${rests[0]}`
      : `${escapeStashText(type)} (${rests.join('|')})`,
  );
  return [...grouped, ...loose].join('|');
}

const containsIgnoreCase = (text: string, part: string): boolean =>
  text.toLowerCase().includes(part.toLowerCase());

/**
 * 名稱的最短開頭：不會出現在其他物品的名稱或類型中，且至少 `MIN_NAME_LENGTH` 字。
 * 找不到時用完整名稱。
 */
function shortestPrefix(key: string, others: readonly StashRegexItem[]): string {
  const otherTexts = others.flatMap((item) => [item.name, item.typeLine].map(normalizeText));
  const characters = Array.from(key);
  for (let length = MIN_NAME_LENGTH; length < characters.length; length += 1) {
    const prefix = characters.slice(0, length).join('').trimEnd();
    if (prefix.length === 0) continue;
    if (!otherTexts.some((text) => containsIgnoreCase(text, prefix))) return prefix;
  }
  return key;
}

/**
 * 0：完整寫法；1：合併標價開頭；2：再縮短名稱；3：再拿掉基底條件。
 * 精確度由高到低，長度由長到短。
 */
type Level = 0 | 1 | 2 | 3;
const LEVELS: readonly Level[] = [0, 1, 2, 3];

/**
 * 基底條件：每件都要有基底才能加（否則沒有基底的那件標不到）；
 * 名稱本身就是基底或含基底（沒有名稱的物品）時，基底條件不會多排除任何物品，不加
 */
function baseAlternation(items: readonly StashRegexItem[]): string | undefined {
  const bases = items.map((item) => normalizeText(item.baseType ?? ''));
  if (bases.some((base) => !base)) return undefined;
  const narrows = items.some((item, index) => normalizeText(item.name) && bases[index]);
  return narrows ? unique(bases).map(escapeStashText).join('|') : undefined;
}

interface Built {
  text: string;
  groups: readonly string[];
}

function buildPart(
  items: readonly StashRegexItem[],
  others: readonly StashRegexItem[],
  level: Level,
): Built {
  const keys = unique(
    items.map((item) => (level >= 2 ? shortestPrefix(stashKeyOf(item), others) : stashKeyOf(item))),
  );
  const names = keys.map(escapeStashText).join('|');
  const notes = unique(
    items.map((item) => item.note).filter((note): note is string => note !== undefined),
  );
  const bases = level < 3 ? baseAlternation(items) : undefined;
  const groups = [
    names,
    ...(bases !== undefined ? [bases] : []),
    ...(notes.length > 0 ? [noteAlternation(notes, level >= 1)] : []),
  ];
  return { text: groups.map((group) => `"${group}"`).join(' '), groups };
}

/** 依遊戲的規則判斷一件物品會不會被這段標出：每個條件都要比對到物品的某一行 */
function lightsUp(part: Built, item: StashRegexItem): boolean {
  const lines = linesOf(item);
  return part.groups.every((group) => {
    const pattern = new RegExp(group, 'i');
    return lines.some((line) => pattern.test(line));
  });
}

/** 放得下的最精確寫法；都放不下時為 undefined */
function bestFit(
  items: readonly StashRegexItem[],
  others: readonly StashRegexItem[],
  maxLength: number,
): Built | undefined {
  for (const level of LEVELS) {
    const built = buildPart(items, others, level);
    if (built.text.length <= maxLength) return built;
  }
  return undefined;
}

const fits = (
  items: readonly StashRegexItem[],
  others: readonly StashRegexItem[],
  maxLength: number,
): boolean => buildPart(items, others, 3).text.length <= maxLength;

/** 先縮短，仍超過上限才拆成幾段；每段依序填入物品，再各自換回最精確的寫法 */
function packParts(
  items: readonly StashRegexItem[],
  others: readonly StashRegexItem[],
  maxLength: number,
): { parts: Built[]; tooLong: StashRegexItem[] } {
  if (items.length === 0) return { parts: [], tooLong: [] };
  const whole = bestFit(items, others, maxLength);
  if (whole) return { parts: [whole], tooLong: [] };

  const parts: Built[] = [];
  const tooLong: StashRegexItem[] = [];
  let current: StashRegexItem[] = [];
  const flush = () => {
    const built = current.length > 0 ? bestFit(current, others, maxLength) : undefined;
    if (built) parts.push(built);
    current = [];
  };
  for (const item of items) {
    const candidate = [...current, item];
    if (fits(candidate, others, maxLength)) {
      current = candidate;
      continue;
    }
    flush();
    if (fits([item], others, maxLength)) current = [item];
    else tooLong.push(item);
  }
  flush();
  return { parts, tooLong };
}

export function buildStashRegex(input: StashRegexInput): StashRegexResult {
  const { others, maxLength } = input;
  const picked = input.picked.filter((item) => stashKeyOf(item).length > 0);
  const priced = picked.filter((item) => item.note !== undefined);
  const unpriced = picked.filter((item) => item.note === undefined);

  const pricedParts = packParts(priced, others, maxLength);
  const unpricedParts = packParts(unpriced, others, maxLength);
  const parts = [...pricedParts.parts, ...unpricedParts.parts];

  const pickedIds = new Set(picked.map((item) => item.id));
  const ambiguousIds = others
    .filter((item) => !pickedIds.has(item.id))
    .filter((item) => parts.some((part) => lightsUp(part, item)))
    .map((item) => item.id);

  return {
    parts: parts.map((part) => part.text),
    ambiguousIds,
    unpricedIds: unpriced.map((item) => item.id),
    tooLongIds: [...pricedParts.tooLong, ...unpricedParts.tooLong].map((item) => item.id),
  };
}
