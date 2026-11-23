/**
 * 搜尋結果看板的獨立詞條解析、彙整與條件篩選（階段 2）。
 *
 * 依官方 `/fetch` 的 `item.extended.mods` 拆出每條獨立詞綴（含 stat hash 組合、是否複合詞、階級），
 * 讓玩家可以區分純詞（如純 T1 物理 % 傷）與複合詞加總（如物理 % 傷 + 命中）。
 */
import type { BoardEntry } from './board-entry';

export type BoardModAffixKind = 'prefix' | 'suffix';

/** 物品上的一條獨立詞綴（對應 `item.extended.mods[category][i]`） */
export interface BoardModRoll {
  /** 唯一識別鍵（category + 排序去重後的 stat hash 組合） */
  key: string;
  /** 所屬分類，例如 `explicit`、`fractured`、`implicit`、`crafted`、`enchant` */
  category: string;
  /** 排序去重後的 stat hash 列表；長度 > 1 表示複合詞綴 */
  hashes: readonly string[];
  isHybrid: boolean;
  /** 官方階級代碼，例如 `P1`、`S2` */
  tier?: string;
  /** 階級數字（1 = T1, 2 = T2...）；無數字階級時為 undefined */
  tierNumber?: number;
  affixKind?: BoardModAffixKind;
  /** 詞綴原名，例如 `Merciless`、`Dictator's` */
  name?: string;
}

/** 可供篩選的累積階級上限 */
export const BOARD_MOD_TIER_CAPS = [1, 2, 3] as const;
export type BoardModTierCap = (typeof BOARD_MOD_TIER_CAPS)[number];

/** 看板「必含獨立詞綴」條件；`maxTier` 未設表示不限階級，設為 1/2/3 表示 T1 / ≤T2 / ≤T3 */
export interface BoardModCondition {
  key: string;
  maxTier?: BoardModTierCap;
}

/** 從目前看板結果彙整出來的獨立詞條選項 */
export interface BoardModOption {
  key: string;
  category: string;
  hashes: readonly string[];
  isHybrid: boolean;
  label: string;
  searchText: string;
  /** 擁有此獨立詞條的物品件數 */
  itemCount: number;
  /** 是否有任何一筆帶數字階級（決定 UI 是否顯示階級按鈕） */
  hasTiers: boolean;
  /** 累積階級件數：T1 (≤1)、≤T2、≤T3 各符合幾件物品 */
  tierCounts: Readonly<Record<BoardModTierCap, number>>;
}

const TIER_CODE_PATTERN = /^([PS])(\d+)$/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** 解析單一詞綴階級字串（例如 `P1` → prefix #1、`S3` → suffix #3） */
export function parseTierCode(
  tier: string | undefined,
): { affixKind: BoardModAffixKind; tierNumber: number } | undefined {
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

/** 從官方 `item.extended.mods` 單次走訪擷取獨立詞條與階級／詞綴名索引 */
export function readExtendedModData(item: Record<string, unknown>): {
  modTiers?: readonly string[];
  modRolls?: readonly BoardModRoll[];
} {
  const extended = isRecord(item.extended) ? item.extended : undefined;
  const extendedMods = extended && isRecord(extended.mods) ? extended.mods : undefined;
  if (!extendedMods) return {};

  const tierTokens = new Set<string>();
  const rolls: BoardModRoll[] = [];
  for (const [category, list] of Object.entries(extendedMods)) {
    if (!Array.isArray(list)) continue;
    for (const rawMod of list) {
      if (!isRecord(rawMod)) continue;
      const tier = typeof rawMod.tier === 'string' && rawMod.tier.length <= 256 ? rawMod.tier.trim() : '';
      const name = typeof rawMod.name === 'string' && rawMod.name.length <= 256 ? rawMod.name.trim() : '';
      if (tier) tierTokens.add(tier);
      if (name) tierTokens.add(name);

      if (!Array.isArray(rawMod.magnitudes)) continue;
      const hashSet = new Set<string>();
      for (const mag of rawMod.magnitudes) {
        if (isRecord(mag) && typeof mag.hash === 'string' && mag.hash.trim()) {
          hashSet.add(mag.hash.trim());
        }
      }
      if (hashSet.size === 0) continue;
      const hashes = Array.from(hashSet).sort();
      const parsedTier = parseTierCode(tier);
      rolls.push({
        key: `${category}:${hashes.join('+')}`,
        category,
        hashes,
        isHybrid: hashes.length > 1,
        ...(tier ? { tier } : {}),
        ...(parsedTier ? parsedTier : {}),
        ...(name ? { name } : {}),
      });
    }
  }
  return {
    ...(tierTokens.size > 0 ? { modTiers: Array.from(tierTokens) } : {}),
    ...(rolls.length > 0 ? { modRolls: rolls } : {}),
  };
}

/** 從官方 `item.extended.mods` 擷取獨立詞條陣列 */
export function readBoardModRolls(item: Record<string, unknown>): readonly BoardModRoll[] | undefined {
  return readExtendedModData(item).modRolls;
}

/** 判斷單件物品是否同時符合所有「必含獨立詞綴」條件 */
export function matchesModConditions(
  entry: BoardEntry,
  conditions: readonly BoardModCondition[],
): boolean {
  if (conditions.length === 0) return true;
  const rolls = entry.modRolls;
  if (!rolls || rolls.length === 0) return false;
  return conditions.every((cond) =>
    rolls.some(
      (roll) =>
        roll.key === cond.key &&
        (cond.maxTier === undefined ||
          (roll.tierNumber !== undefined && roll.tierNumber <= cond.maxTier)),
    ),
  );
}

/** 從已載入的看板結果彙整獨立詞條選項，依出現件數降冪排序 */
export function aggregateBoardModOptions(
  entries: readonly BoardEntry[],
  resolveStatLabel: (hash: string) => string,
): BoardModOption[] {
  interface Bucket {
    key: string;
    category: string;
    hashes: readonly string[];
    isHybrid: boolean;
    names: Set<string>;
    entryIds: Set<string>;
    hasTiers: boolean;
    tierEntryIds: Record<BoardModTierCap, Set<string>>;
  }

  const buckets = new Map<string, Bucket>();
  for (const entry of entries) {
    if (!entry.modRolls) continue;
    for (const roll of entry.modRolls) {
      let bucket = buckets.get(roll.key);
      if (!bucket) {
        bucket = {
          key: roll.key,
          category: roll.category,
          hashes: roll.hashes,
          isHybrid: roll.isHybrid,
          names: new Set(),
          entryIds: new Set(),
          hasTiers: false,
          tierEntryIds: { 1: new Set(), 2: new Set(), 3: new Set() },
        };
        buckets.set(roll.key, bucket);
      }
      bucket.entryIds.add(entry.id);
      if (roll.name) bucket.names.add(roll.name);
      if (roll.tierNumber !== undefined) {
        bucket.hasTiers = true;
        for (const cap of BOARD_MOD_TIER_CAPS) {
          if (roll.tierNumber <= cap) bucket.tierEntryIds[cap].add(entry.id);
        }
      }
    }
  }

  const options: BoardModOption[] = [];
  for (const bucket of buckets.values()) {
    const label = bucket.hashes.map((hash) => resolveStatLabel(hash)).join(' / ');
    const searchParts = [
      label,
      ...bucket.names,
      ...bucket.hashes,
      bucket.isHybrid ? 'hybrid 複合 复合' : 'pure 純詞 纯词',
    ];
    options.push({
      key: bucket.key,
      category: bucket.category,
      hashes: bucket.hashes,
      isHybrid: bucket.isHybrid,
      label,
      searchText: searchParts.join(' ').toLowerCase(),
      itemCount: bucket.entryIds.size,
      hasTiers: bucket.hasTiers,
      tierCounts: {
        1: bucket.tierEntryIds[1].size,
        2: bucket.tierEntryIds[2].size,
        3: bucket.tierEntryIds[3].size,
      },
    });
  }

  return options.sort(
    (a, b) =>
      b.itemCount - a.itemCount ||
      Number(a.isHybrid) - Number(b.isHybrid) ||
      a.label.localeCompare(b.label),
  );
}

/** 單行子序列模糊比對（例如「物理傷」命中「增加 179% 物理傷害」、「混抗」命中「+35% 混沌抗性」） */
export function isSubsequence(needle: string, haystack: string): boolean {
  if (needle.length > haystack.length) return false;
  let j = 0;
  for (let i = 0; i < haystack.length && j < needle.length; i += 1) {
    if (haystack[i] === needle[j]) j += 1;
  }
  return j === needle.length;
}

/** 篩選詞條選擇器清單（支援空白多詞＋模糊子序列比對） */
export function filterModOptions(
  options: readonly BoardModOption[],
  query: string,
): BoardModOption[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [...options];
  return options.filter((opt) =>
    tokens.every(
      (token) =>
        opt.searchText.includes(token) ||
        (token.length >= 2 && isSubsequence(token, opt.searchText)),
    ),
  );
}
