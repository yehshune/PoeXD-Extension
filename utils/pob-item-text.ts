/**
 * 把官方 fetch API 的物品 JSON 轉成 Path of Building 可匯入的英文物品文字。
 *
 * 輸出採用 PoB 自己的儲存格式（`Implicits: N` 加上 `{crafted}` 這類行首標記），而不是遊戲內
 * Ctrl+C 的格式：官方市集的複製文字不區分工藝、破裂詞綴，PoB 格式可以保留這些資訊。
 *
 * PoB 只認得英文。頁面不是英文時由 `lexicon` 把基底、傳奇名稱與詞綴轉回英文；轉不回來的
 * 詞綴保留原文並計數，由呼叫端告知使用者，不會默默產生錯的英文。
 */
import type { PoeVersion } from './trade-context';

/** 把頁面語系的文字轉回英文（見 pob-text-lexicon.ts） */
export interface PobTextLexicon {
  /** 詞綴整句轉成英文；查不到回傳 null */
  toEnglishModLine(line: string, statHash: string | undefined): string | null;
  /** 物品名（基底或傳奇名稱）的英文候選；同名多個基底時會有多筆 */
  toEnglishNames(localized: string): readonly string[];
}

export interface PobItemTextOptions {
  version: PoeVersion;
  /** 頁面是英文時省略 */
  lexicon?: PobTextLexicon;
}

export interface PobItemText {
  text: string;
  /** 無法轉成英文、以原文輸出的詞綴數 */
  untranslatedLines: number;
  /** 基底名稱查不到，或對到多個英文基底 */
  baseTypeUncertain: boolean;
}

type Json = Record<string, unknown>;
type Rarity = 'NORMAL' | 'MAGIC' | 'RARE' | 'UNIQUE';
type ModKind =
  | 'enchant'
  | 'scourge'
  | 'rune'
  | 'implicit'
  | 'fractured'
  | 'explicit'
  | 'crafted'
  | 'crucible'
  | 'desecrated';

const RARITY_BY_NAME: Readonly<Record<string, Rarity>> = {
  normal: 'NORMAL',
  magic: 'MAGIC',
  rare: 'RARE',
  unique: 'UNIQUE',
};
const RARITY_BY_FRAME_TYPE: readonly Rarity[] = ['NORMAL', 'MAGIC', 'RARE', 'UNIQUE'];

/** 物品上的詞綴欄位與預設類別；詞綴本身帶 `domain` 時以它為準 */
const MOD_FIELDS: ReadonlyArray<readonly [field: string, kind: ModKind]> = [
  ['enchantMods', 'enchant'],
  ['scourgeMods', 'scourge'],
  ['runeMods', 'rune'],
  ['implicitMods', 'implicit'],
  ['fracturedMods', 'fractured'],
  ['explicitMods', 'explicit'],
  ['craftedMods', 'crafted'],
  ['crucibleMods', 'crucible'],
  ['desecratedMods', 'desecrated'],
];
const MOD_KINDS = new Set<string>(MOD_FIELDS.map(([, kind]) => kind));
/** PoB 的 `Implicits: N` 涵蓋這幾類，依此順序輸出在其他詞綴之前 */
const IMPLICIT_KINDS: readonly ModKind[] = ['enchant', 'scourge', 'rune', 'implicit'];
/** PoB 認得的行首標記；沒列出的類別（例如褻瀆）當一般詞綴輸出 */
const MOD_TAGS: Readonly<Partial<Record<ModKind, string>>> = {
  enchant: '{enchant}',
  scourge: '{scourge}',
  rune: '{rune}',
  fractured: '{fractured}',
  crafted: '{crafted}',
  crucible: '{crucible}',
};

const INFLUENCE_LINES: ReadonlyArray<readonly [key: string, line: string]> = [
  ['shaper', 'Shaper Item'],
  ['elder', 'Elder Item'],
  ['crusader', 'Crusader Item'],
  ['redeemer', 'Redeemer Item'],
  ['hunter', 'Hunter Item'],
  ['warlord', 'Warlord Item'],
];
const HEADER_FLAG_LINES: ReadonlyArray<readonly [key: string, line: string]> = [
  ['searing', 'Searing Exarch Item'],
  ['tangled', 'Eater of Worlds Item'],
  ['synthesised', 'Synthesised Item'],
  ['fractured', 'Fractured Item'],
];
const TRAILING_FLAG_LINES: ReadonlyArray<readonly [key: string, line: string]> = [
  ['corrupted', 'Corrupted'],
  ['duplicated', 'Mirrored'],
  ['split', 'Split'],
];

const PROPERTY_TYPE_QUALITY = 6;
const REQUIREMENT_TYPE_LEVEL = 62;
const FALLBACK_ITEM_NAME = 'New Item';
/** PoE 2 的 `[標籤|顯示文字]` 或 `[標籤]` 標記 */
const BRACKET_MARKUP = /\[(?:[^\]|]*\|)?([^\]]*)\]/g;
/** PoE 2 只對特定昇華生效的 Bonded 行，PoB 無法解析 */
const BONDED_LINE = /^\[ShamanOnlyMods\|/;
const STAT_HASH = /stat_(\d+)/;

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const unwrapBrackets = (value: string): string => value.replace(BRACKET_MARKUP, '$1');

function resolveRarity(item: Json): Rarity | undefined {
  const byName = RARITY_BY_NAME[text(item.rarity).toLowerCase()];
  if (byName) return byName;
  return typeof item.frameType === 'number' ? RARITY_BY_FRAME_TYPE[item.frameType] : undefined;
}

/** 只有裝備類物品（普通、魔法、稀有、傳奇）有 PoB 物品文字 */
export function isPobExportableItem(raw: unknown): boolean {
  return isRecord(raw) && resolveRarity(raw) !== undefined;
}

/**
 * 物品在資料庫網站上的英文頁面名稱：傳奇用傳奇名稱，其餘用基底。
 * 在地化頁面查不到英文時回傳 null；同名多個基底時取第一個。
 */
export function resolveEnglishItemName(raw: unknown, lexicon?: PobTextLexicon): string | null {
  if (!isRecord(raw)) return null;
  const isUnique = resolveRarity(raw) === 'UNIQUE';
  const name = unwrapBrackets(text(raw.name));
  const base = unwrapBrackets(text(raw.baseType) || text(raw.typeLine));
  const localized = isUnique && name ? name : base;
  if (!localized) return null;
  return lexicon ? (lexicon.toEnglishNames(localized)[0] ?? null) : localized;
}

/** 讀出 `properties` / `requirements` 中指定 type 的第一個數值 */
function readTypedNumber(entries: unknown, type: number): number | undefined {
  if (!Array.isArray(entries)) return undefined;
  for (const entry of entries) {
    if (!isRecord(entry) || entry.type !== type || !Array.isArray(entry.values)) continue;
    const first: unknown = entry.values[0];
    const match = /\d+/.exec(Array.isArray(first) ? String(first[0]) : '');
    if (match) return Number(match[0]);
  }
  return undefined;
}

function formatSockets(sockets: unknown, version: PoeVersion): string | undefined {
  if (!Array.isArray(sockets) || sockets.length === 0) return undefined;
  const entries = sockets.filter(isRecord);
  if (version === 'poe2') return entries.map(() => 'S').join(' ');
  return entries
    .map((socket, index) => {
      const colour = text(socket.sColour) || 'W';
      if (index === 0) return colour;
      return `${socket.group === entries[index - 1].group ? '-' : ' '}${colour}`;
    })
    .join('');
}

interface NameLines {
  lines: string[];
  baseTypeUncertain: boolean;
}

function buildNameLines(item: Json, rarity: Rarity, lexicon?: PobTextLexicon): NameLines {
  const name = unwrapBrackets(text(item.name));
  const baseType = unwrapBrackets(text(item.baseType));
  const typeLine = unwrapBrackets(text(item.typeLine));
  const hasOwnName = (rarity === 'RARE' || rarity === 'UNIQUE') && name !== '';

  if (!lexicon) {
    const lines = hasOwnName ? [name, baseType || typeLine] : [typeLine || baseType];
    return { lines: lines.filter(Boolean), baseTypeUncertain: false };
  }

  // 在地化頁面：魔法物品的 typeLine 含詞綴名稱無法還原，一律只用基底
  const localizedBase = baseType || typeLine;
  const candidates = lexicon.toEnglishNames(localizedBase);
  const englishBase = candidates[0] ?? localizedBase;
  const englishName =
    rarity === 'UNIQUE'
      ? (lexicon.toEnglishNames(name)[0] ?? FALLBACK_ITEM_NAME)
      : FALLBACK_ITEM_NAME;
  return {
    lines: (hasOwnName ? [englishName, englishBase] : [englishBase]).filter(Boolean),
    baseTypeUncertain: candidates.length !== 1,
  };
}

function resolveModKind(entry: unknown, fallback: ModKind): ModKind {
  if (!isRecord(entry)) return fallback;
  const domain = text(entry.domain);
  if (MOD_KINDS.has(domain)) return domain as ModKind;
  const flags = isRecord(entry.flags) ? entry.flags : {};
  if (flags.crafted === true) return 'crafted';
  if (flags.fractured === true) return 'fractured';
  if (flags.desecrated === true) return 'desecrated';
  return fallback;
}

interface ModOutput {
  kind: ModKind;
  lines: string[];
  untranslated: boolean;
}

function buildModOutput(
  entry: unknown,
  fallback: ModKind,
  lexicon?: PobTextLexicon,
): ModOutput | null {
  const rawDescription = isRecord(entry) ? text(entry.description) : text(entry);
  if (!rawDescription || BONDED_LINE.test(rawDescription)) return null;

  const description = unwrapBrackets(rawDescription);
  const statHash = isRecord(entry) ? STAT_HASH.exec(text(entry.hash))?.[1] : undefined;
  const english = lexicon ? lexicon.toEnglishModLine(description, statHash) : description;
  const lines = (english ?? description)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return { kind: resolveModKind(entry, fallback), lines, untranslated: english === null };
}

function collectMods(item: Json, lexicon?: PobTextLexicon): ModOutput[] {
  const seen = new Set<string>();
  const mods: ModOutput[] = [];
  for (const [field, fallback] of MOD_FIELDS) {
    const entries = item[field];
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const mod = buildModOutput(entry, fallback, lexicon);
      if (!mod) continue;
      const key = `${mod.kind}\u0000${mod.lines.join('\n')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      mods.push(mod);
    }
  }
  return mods;
}

const formatMod = (mod: ModOutput): string[] =>
  mod.lines.map((line) => `${MOD_TAGS[mod.kind] ?? ''}${line}`);

const flagLines = (
  source: unknown,
  table: ReadonlyArray<readonly [key: string, line: string]>,
): string[] =>
  isRecord(source) ? table.filter(([key]) => source[key] === true).map(([, line]) => line) : [];

export function buildPobItemText(raw: unknown, options: PobItemTextOptions): PobItemText | null {
  if (!isRecord(raw)) return null;
  const rarity = resolveRarity(raw);
  if (!rarity) return null;

  const { version, lexicon } = options;
  const names = buildNameLines(raw, rarity, lexicon);
  const mods = collectMods(raw, lexicon);
  const isImplicit = (mod: ModOutput) => IMPLICIT_KINDS.includes(mod.kind);
  const implicitMods = IMPLICIT_KINDS.flatMap((kind) => mods.filter((mod) => mod.kind === kind));
  const explicitMods = mods.filter((mod) => !isImplicit(mod));

  const quality = readTypedNumber(raw.properties, PROPERTY_TYPE_QUALITY);
  const levelRequirement = readTypedNumber(raw.requirements, REQUIREMENT_TYPE_LEVEL);
  const sockets = formatSockets(raw.sockets, version);
  const implicitLines = implicitMods.flatMap(formatMod);

  const lines = [
    `Rarity: ${rarity}`,
    ...names.lines,
    ...(typeof raw.ilvl === 'number' && raw.ilvl > 0 ? [`Item Level: ${raw.ilvl}`] : []),
    ...(quality !== undefined ? [`Quality: ${quality}`] : []),
    ...(sockets ? [`Sockets: ${sockets}`] : []),
    ...(levelRequirement !== undefined ? [`LevelReq: ${levelRequirement}`] : []),
    ...flagLines(raw.influences, INFLUENCE_LINES),
    ...flagLines(raw, HEADER_FLAG_LINES),
    `Implicits: ${implicitLines.length}`,
    ...implicitLines,
    ...explicitMods.flatMap(formatMod),
    ...flagLines(raw, TRAILING_FLAG_LINES),
  ];

  return {
    text: lines.join('\n'),
    untranslatedLines: mods.filter((mod) => mod.untranslated).length,
    baseTypeUncertain: names.baseTypeUncertain,
  };
}
