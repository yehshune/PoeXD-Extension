/**
 * 官方 `/api/trade/fetch`（PoE 1 & PoE 2）物品詞綴的共用解析模組。
 *
 * 統一封裝官方 `item` JSON 的新舊詞綴格式：
 * - Patch 3.29.0 新版：`implicitMods` / `explicitMods` 等為結構化 `ItemMod` 物件陣列
 *   （含 `description`、`domain`、`hash`、`flags`、`mods[]`），且 `fractured` / `crafted` /
 *   `desecrated` 等整併進 `explicitMods`；複合詞以 `extended.hashes[category]` 的 mod index 關聯。
 * - 舊版：`*Mods` 為純字串陣列，獨立詞綴與階級位於 `item.extended.mods`，stat hash 位於 `extended.hashes`。
 *
 * 看板、釘選卡片、釘選搜尋與 PoB 複製都共用此模組，避免官方格式變動時各處分散維護。
 */

export type TradeItemModAffixKind = 'prefix' | 'suffix';

/** 物品上的一行詞綴（對應 `*Mods` 陣列中的單一項目，已正規化分類、文字與 stat hash） */
export interface TradeItemModLine {
  /** 實際分類（優先取 `domain` / `flags`，例如 `explicit`、`fractured`、`crafted`、`implicit`） */
  category: string;
  /** 來源欄位對應的預設分類（例如 `explicitMods` → `explicit`） */
  fieldCategory: string;
  /** 原始詞綴字串（保留 PoE 2 `[標籤|文字]` 標記，供需要偵測特殊標記的呼叫端使用） */
  rawText: string;
  /** 移除 PoE 2 `[標籤|文字]` 標記並 trim 後的詞綴文字 */
  text: string;
  /** 不含 `stat.` 前綴的 stat id（例如 `explicit.stat_1509134228`） */
  statId?: string;
  /** 含 `stat.` 前綴且通過安全格式驗證的官方 `data-field` 值（例如 `stat.explicit.stat_1509134228`） */
  statField?: string;
}

/** 物品上的一條獨立詞綴（複合詞會合併所有對應的 stat hashes） */
export interface TradeItemModRoll {
  /** 唯一識別鍵（`category:hash1+hash2`） */
  key: string;
  /** 所屬分類，例如 `explicit`、`fractured`、`implicit`、`crafted`、`enchant` */
  category: string;
  /** 排序去重後的 stat id 列表；長度 > 1 表示複合詞綴 */
  hashes: readonly string[];
  isHybrid: boolean;
  /** 官方階級代碼，例如 `P1`、`S2` */
  tier?: string;
  /** 階級數字（1 = T1, 2 = T2...）；無數字階級時為 undefined */
  tierNumber?: number;
  affixKind?: TradeItemModAffixKind;
  /** 詞綴原名，例如 `Merciless`、`Dictator's` */
  name?: string;
}

export interface TradeItemExtendedModData {
  modTiers?: readonly string[];
  modRolls?: readonly TradeItemModRoll[];
}

export interface ReadTradeItemModLinesOptions {
  /** 單行原始詞綴上限長度；超過時略過（防禦不可信輸入） */
  maxLineLength?: number;
}

/** 物品頂層詞綴欄位與預設分類對照表 */
export const TRADE_ITEM_MOD_FIELDS: readonly (readonly [field: string, category: string])[] = [
  ['enchantMods', 'enchant'],
  ['scourgeMods', 'scourge'],
  ['runeMods', 'rune'],
  ['implicitMods', 'implicit'],
  ['fracturedMods', 'fractured'],
  ['explicitMods', 'explicit'],
  ['craftedMods', 'crafted'],
  ['crucibleMods', 'crucible'],
  ['desecratedMods', 'desecrated'],
  ['mutatedMods', 'mutated'],
  ['utilityMods', 'utility'],
  ['sanctumMods', 'sanctum'],
  ['veiledMods', 'veiled'],
];

const TIER_CODE_PATTERN = /^([PS])(\d+)$/i;
/** 官方詞綴代碼，例如 `stat.explicit.stat_3261801346`；格式不符的一律不寫進 DOM 屬性 */
const STAT_FIELD_PATTERN = /^stat\.[a-z_]+\.[A-Za-z0-9_|.+-]{1,120}$/;
const MAX_MOD_META_LENGTH = 256;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** PoE 2 的 `[標籤|顯示文字]` 或 `[標籤]` 標記只保留顯示文字 */
export const unwrapItemMarkup = (value: string): string =>
  value.replace(/\[(?:[^\]|]*\|)?([^\]]*)\]/g, '$1');

/** 移除官方詞綴代碼前的 `stat.` 前綴（`stat.explicit.stat_xxx` → `explicit.stat_xxx`） */
export const normalizeStatHash = (raw: string): string => {
  const trimmed = raw.trim();
  return trimmed.startsWith('stat.') ? trimmed.slice(5) : trimmed;
};

/** 驗證並正規化為官方 DOM `data-field` 格式（`stat.<category>.<id>`） */
function toSafeStatField(rawHash: string): string | undefined {
  if (!rawHash) return undefined;
  const candidate = rawHash.startsWith('stat.') ? rawHash : `stat.${rawHash}`;
  return STAT_FIELD_PATTERN.test(candidate) ? candidate : undefined;
}

/** 解析單一詞綴階級字串（例如 `P1` → prefix #1、`S3` → suffix #3） */
export function parseModTierCode(
  tier: string | undefined,
): { affixKind: TradeItemModAffixKind; tierNumber: number } | undefined {
  if (!tier) return undefined;
  const match = TIER_CODE_PATTERN.exec(tier.trim());
  if (!match) return undefined;
  const tierNumber = Number(match[2]);
  if (!Number.isInteger(tierNumber) || tierNumber <= 0) return undefined;
  return {
    affixKind: match[1].toUpperCase() === 'P' ? 'prefix' : 'suffix',
    tierNumber,
  };
}

/** 判斷單筆 `ItemMod` 實際分類：優先取 `domain`，其次取 `flags`，最後退回欄位預設分類 */
function resolveEntryCategory(entry: Record<string, unknown>, fallback: string): string {
  const domain = typeof entry.domain === 'string' ? entry.domain.trim() : '';
  if (domain) return domain;
  if (isRecord(entry.flags)) {
    for (const flag of ['fractured', 'crafted', 'desecrated', 'mutated', 'enchant'] as const) {
      if (entry.flags[flag] === true) return flag;
    }
  }
  return fallback;
}

/** 讀取官方 `item` JSON 上所有 `*Mods` 的詞綴行（同時相容舊版字串與 3.29.0 `ItemMod` 物件） */
export function readTradeItemModLines(
  item: Record<string, unknown>,
  options: ReadTradeItemModLinesOptions = {},
): TradeItemModLine[] {
  const maxLineLength = options.maxLineLength;
  const extended = isRecord(item.extended) ? item.extended : undefined;
  const extendedHashes = extended && isRecord(extended.hashes) ? extended.hashes : undefined;

  const lines: TradeItemModLine[] = [];
  for (const [field, fieldCategory] of TRADE_ITEM_MOD_FIELDS) {
    const list = item[field];
    if (!Array.isArray(list) || list.length === 0) continue;
    const rawHashList =
      extendedHashes && Array.isArray(extendedHashes[fieldCategory])
        ? (extendedHashes[fieldCategory] as unknown[])
        : [];

    for (let index = 0; index < list.length; index += 1) {
      const entry = list[index];
      let rawText = '';
      let category = fieldCategory;
      let rawHash = '';

      if (typeof entry === 'string') {
        rawText = entry;
        const hashTuple = rawHashList[index];
        if (Array.isArray(hashTuple) && typeof hashTuple[0] === 'string') {
          rawHash = hashTuple[0];
        }
      } else if (isRecord(entry)) {
        rawText = typeof entry.description === 'string' ? entry.description : '';
        category = resolveEntryCategory(entry, fieldCategory);
        if (typeof entry.hash === 'string') {
          rawHash = entry.hash;
        } else {
          const hashTuple = rawHashList[index];
          if (Array.isArray(hashTuple) && typeof hashTuple[0] === 'string') {
            rawHash = hashTuple[0];
          }
        }
      }

      if (!rawText) continue;
      if (maxLineLength !== undefined && rawText.length > maxLineLength) continue;
      const text = unwrapItemMarkup(rawText).trim();
      if (!text) continue;

      const statId = rawHash ? normalizeStatHash(rawHash) : '';
      const statField = toSafeStatField(rawHash);
      lines.push({
        category,
        fieldCategory,
        rawText,
        text,
        ...(statId ? { statId } : {}),
        ...(statField ? { statField } : {}),
      });
    }
  }
  return lines;
}

const readMetaText = (value: unknown): string =>
  typeof value === 'string' && value.length <= MAX_MOD_META_LENGTH ? value.trim() : '';

function buildModRoll(
  category: string,
  hashSet: ReadonlySet<string>,
  tier: string | undefined,
  name: string | undefined,
): TradeItemModRoll | undefined {
  if (hashSet.size === 0) return undefined;
  const hashes = Array.from(hashSet).sort();
  const parsedTier = parseModTierCode(tier);
  return {
    key: `${category}:${hashes.join('+')}`,
    category,
    hashes,
    isHybrid: hashes.length > 1,
    ...(tier ? { tier } : {}),
    ...(parsedTier ? parsedTier : {}),
    ...(name ? { name } : {}),
  };
}

function readLegacyExtendedMods(
  extendedMods: Record<string, unknown>,
  tierTokens: Set<string>,
  rolls: TradeItemModRoll[],
): void {
  for (const [category, list] of Object.entries(extendedMods)) {
    if (!Array.isArray(list)) continue;
    for (const rawMod of list) {
      if (!isRecord(rawMod)) continue;
      const tier = readMetaText(rawMod.tier);
      const name = readMetaText(rawMod.name);
      if (tier) tierTokens.add(tier);
      if (name) tierTokens.add(name);

      if (!Array.isArray(rawMod.magnitudes)) continue;
      const hashSet = new Set<string>();
      for (const mag of rawMod.magnitudes) {
        if (isRecord(mag) && typeof mag.hash === 'string' && mag.hash.trim()) {
          hashSet.add(normalizeStatHash(mag.hash));
        }
      }
      const roll = buildModRoll(category, hashSet, tier, name);
      if (roll) rolls.push(roll);
    }
  }
}

/**
 * 解析 3.29.0 新版官方 `/fetch` 的 `*Mods` 物件陣列（每筆含 `hash`、`domain`、`flags` 與 `mods[]`），
 * 並以 `item.extended.hashes[category]` 的 mod index 將多行複合詞重新歸組為同一條獨立詞綴。
 */
function readStructuredItemMods(
  item: Record<string, unknown>,
  extendedHashes: Record<string, unknown> | undefined,
  tierTokens: Set<string>,
  rolls: TradeItemModRoll[],
): void {
  interface ModGroup {
    category: string;
    hashes: Set<string>;
    tier?: string;
    name?: string;
  }

  const indexQueuesByCategory = new Map<string, Map<string, (readonly number[])[]>>();
  if (extendedHashes) {
    for (const [hashCategory, rawHashTuples] of Object.entries(extendedHashes)) {
      if (!Array.isArray(rawHashTuples)) continue;
      const hashMap = new Map<string, (readonly number[])[]>();
      for (const tuple of rawHashTuples) {
        if (!Array.isArray(tuple) || typeof tuple[0] !== 'string' || !Array.isArray(tuple[1])) {
          continue;
        }
        const hash = normalizeStatHash(tuple[0]);
        if (!hash) continue;
        const indices = tuple[1].filter(
          (idx): idx is number => typeof idx === 'number' && Number.isInteger(idx) && idx >= 0,
        );
        const queue = hashMap.get(hash);
        if (queue) queue.push(indices);
        else hashMap.set(hash, [indices]);
      }
      if (hashMap.size > 0) indexQueuesByCategory.set(hashCategory, hashMap);
    }
  }

  const groups = new Map<string, ModGroup>();
  const addToGroup = (
    category: string,
    localKey: string,
    hash: string,
    tier: string,
    name: string,
  ) => {
    const fullKey = `${category}:${localKey}`;
    let group = groups.get(fullKey);
    if (!group) {
      group = { category, hashes: new Set() };
      groups.set(fullKey, group);
    }
    group.hashes.add(hash);
    if (tier && !group.tier) group.tier = tier;
    if (name && !group.name) group.name = name;
  };

  for (const [field, fieldCategory] of TRADE_ITEM_MOD_FIELDS) {
    const list = item[field];
    if (!Array.isArray(list) || list.length === 0) continue;

    for (let lineIdx = 0; lineIdx < list.length; lineIdx += 1) {
      const entry = list[lineIdx];
      if (!isRecord(entry)) continue;
      const rawHash = typeof entry.hash === 'string' ? normalizeStatHash(entry.hash) : '';
      if (!rawHash) continue;

      const category = resolveEntryCategory(entry, fieldCategory);
      const indices =
        indexQueuesByCategory.get(category)?.get(rawHash)?.shift() ??
        (category !== fieldCategory
          ? indexQueuesByCategory.get(fieldCategory)?.get(rawHash)?.shift()
          : undefined);
      const entryMods = Array.isArray(entry.mods) ? entry.mods : [];

      if (entryMods.length > 0) {
        for (let modPos = 0; modPos < entryMods.length; modPos += 1) {
          const rawMod = entryMods[modPos];
          if (!isRecord(rawMod)) continue;
          const tier = readMetaText(rawMod.tier);
          const name = readMetaText(rawMod.name);
          const level =
            typeof rawMod.level === 'number' && Number.isFinite(rawMod.level)
              ? rawMod.level
              : undefined;
          if (tier) tierTokens.add(tier);
          if (name) tierTokens.add(name);

          const modIndex = indices && modPos < indices.length ? indices[modPos] : undefined;
          const localKey =
            modIndex !== undefined
              ? `idx:${modIndex}`
              : name
                ? `meta:${name}:${tier}:${level ?? ''}`
                : `solo:${field}:${lineIdx}:${modPos}`;
          addToGroup(category, localKey, rawHash, tier, name);
        }
      } else if (indices && indices.length > 0) {
        for (const modIndex of indices) {
          addToGroup(category, `idx:${modIndex}`, rawHash, '', '');
        }
      }
    }
  }

  for (const group of groups.values()) {
    const roll = buildModRoll(group.category, group.hashes, group.tier, group.name);
    if (roll) rolls.push(roll);
  }
}

/** 從官方 `item.extended.mods`（舊版）或 `*Mods` + `extended.hashes`（新版）擷取獨立詞條與階級／詞綴名索引 */
export function readTradeItemModData(item: Record<string, unknown>): TradeItemExtendedModData {
  const extended = isRecord(item.extended) ? item.extended : undefined;
  const extendedMods = extended && isRecord(extended.mods) ? extended.mods : undefined;
  const extendedHashes = extended && isRecord(extended.hashes) ? extended.hashes : undefined;

  const tierTokens = new Set<string>();
  const rolls: TradeItemModRoll[] = [];

  if (extendedMods) {
    readLegacyExtendedMods(extendedMods, tierTokens, rolls);
  }
  if (rolls.length === 0) {
    readStructuredItemMods(item, extendedHashes, tierTokens, rolls);
  }

  return {
    ...(tierTokens.size > 0 ? { modTiers: Array.from(tierTokens) } : {}),
    ...(rolls.length > 0 ? { modRolls: rolls } : {}),
  };
}
