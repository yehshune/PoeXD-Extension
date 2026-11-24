/**
 * 搜尋結果看板的獨立詞條彙整與條件篩選（階段 2）。
 *
 * 詞綴與複合詞的原始 JSON 解析統一委託給 `@/utils/trade-item-mods`，
 * 此模組專責看板選項彙整、累積階級統計與條件篩選比對。
 */
import type { TradeItemModAffixKind, TradeItemModRoll } from '@/utils/trade-item-mods';
import type { BoardEntry } from './board-entry';

export type BoardModAffixKind = TradeItemModAffixKind;
export type BoardModRoll = TradeItemModRoll;

/** 可供篩選的累積階級上限 */
export const BOARD_MOD_TIER_CAPS = [1, 2, 3] as const;
export type BoardModTierCap = (typeof BOARD_MOD_TIER_CAPS)[number];

/** 獨立詞綴選擇器的快速分類切換 */
export const BOARD_MOD_QUICK_FILTERS = ['all', 'pure', 'hybrid', 't1'] as const;
export type BoardModQuickFilter = (typeof BOARD_MOD_QUICK_FILTERS)[number];

/** 看板「必含獨立詞綴」條件；`maxTier` 未設表示不限階級，設為 1/2/3 表示 T1 / T1–T2 / T1–T3 */
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
  /** 符合其餘已選條件交集後，擁有此獨立詞條的物品件數 */
  itemCount: number;
  /** 是否有任何一筆帶數字階級 */
  hasTiers: boolean;
  /** 累積階級件數：T1、T1–T2、T1–T3 各符合幾件物品（已套用其餘條件交集） */
  tierCounts: Readonly<Record<BoardModTierCap, number>>;
  /** 目前結果中出現的最高階級代碼（例如 `P1`、`S2`），供 tooltip 提示 */
  bestTier?: string;
  /** 目前結果中出現過的詞綴原名（如 `Merciless`、`Conqueror's`），供 tooltip 提示 */
  sampleNames: readonly string[];
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

const MAX_SAMPLE_NAMES = 4;

const compareModOptions = (a: BoardModOption, b: BoardModOption): number =>
  b.itemCount - a.itemCount ||
  Number(a.isHybrid) - Number(b.isHybrid) ||
  a.label.localeCompare(b.label);

/**
 * 從已載入的看板結果彙整獨立詞條選項，並依其餘已選條件計算即時交集件數（faceted counts）。
 * 即使交集為 0，選項仍保留在清單中（件數為 0），方便玩家看清全貌並即時調整條件。
 */
export function aggregateBoardModOptions(
  entries: readonly BoardEntry[],
  resolveStatLabel: (hash: string) => string,
  activeConditions: readonly BoardModCondition[] = [],
): BoardModOption[] {
  interface Bucket {
    key: string;
    category: string;
    hashes: readonly string[];
    isHybrid: boolean;
    names: Set<string>;
    entryIds: Set<string>;
    hasTiers: boolean;
    bestTierNumber?: number;
    bestTier?: string;
    tierEntryIds: Record<BoardModTierCap, Set<string>>;
  }

  const buckets = new Map<string, Bucket>();
  const recordRoll = (bucket: Bucket, entryId: string, roll: BoardModRoll) => {
    bucket.entryIds.add(entryId);
    if (roll.tierNumber !== undefined) {
      bucket.hasTiers = true;
      if (bucket.bestTierNumber === undefined || roll.tierNumber < bucket.bestTierNumber) {
        bucket.bestTierNumber = roll.tierNumber;
        bucket.bestTier = roll.tier;
      }
      for (const cap of BOARD_MOD_TIER_CAPS) {
        if (roll.tierNumber <= cap) bucket.tierEntryIds[cap].add(entryId);
      }
    }
  };

  // 先建立所有曾出現詞條的靜態欄位（label、原名、是否帶階級）
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
      if (roll.name) bucket.names.add(roll.name);
      if (roll.tierNumber !== undefined) bucket.hasTiers = true;
      if (activeConditions.length === 0) {
        recordRoll(bucket, entry.id, roll);
      }
    }
  }

  if (activeConditions.length > 0) {
    const activeKeySet = new Set(activeConditions.map((cond) => cond.key));
    // 非已選詞條共用「全部已選條件」篩選結果；已選詞條各自排除自身條件後重算
    const allMatched = entries.filter((entry) => matchesModConditions(entry, activeConditions));
    for (const entry of allMatched) {
      if (!entry.modRolls) continue;
      for (const roll of entry.modRolls) {
        if (activeKeySet.has(roll.key)) continue;
        const bucket = buckets.get(roll.key);
        if (bucket) recordRoll(bucket, entry.id, roll);
      }
    }
    for (const cond of activeConditions) {
      const bucket = buckets.get(cond.key);
      if (!bucket) continue;
      const others = activeConditions.filter((item) => item.key !== cond.key);
      const scoped =
        others.length === 0
          ? entries
          : entries.filter((entry) => matchesModConditions(entry, others));
      for (const entry of scoped) {
        if (!entry.modRolls) continue;
        for (const roll of entry.modRolls) {
          if (roll.key === cond.key) recordRoll(bucket, entry.id, roll);
        }
      }
    }
  }

  const options: BoardModOption[] = [];
  for (const bucket of buckets.values()) {
    const label = bucket.hashes.map((hash) => resolveStatLabel(hash)).join(' / ');
    const sampleNames = Array.from(bucket.names).slice(0, MAX_SAMPLE_NAMES);
    const searchParts = [
      label,
      ...bucket.names,
      ...bucket.hashes,
      bucket.isHybrid ? 'hybrid 複合 复合' : 'single pure 單詞 单词 純詞 纯词',
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
      ...(bucket.bestTier ? { bestTier: bucket.bestTier } : {}),
      sampleNames,
    });
  }

  return options.sort(compareModOptions);
}

/** 單行子序列模糊比對（例如「物理傷」命中「增加 179% 物理傷害」、「混抗」命中「+35% 混沌抗性」） */
function isSubsequence(needle: string, haystack: string): boolean {
  if (needle.length > haystack.length) return false;
  let j = 0;
  for (let i = 0; i < haystack.length && j < needle.length; i += 1) {
    if (haystack[i] === needle[j]) j += 1;
  }
  return j === needle.length;
}

/** 篩選詞條選擇器清單（支援快速分類、空白多詞＋模糊子序列比對，並將已選條件置頂、0 件交集排後） */
export function filterModOptions(
  options: readonly BoardModOption[],
  query: string,
  quickFilter: BoardModQuickFilter = 'all',
  selectedKeys?: ReadonlySet<string>,
): BoardModOption[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = options.filter((opt) => {
    if (quickFilter === 'pure' && opt.isHybrid) return false;
    if (quickFilter === 'hybrid' && !opt.isHybrid) return false;
    if (quickFilter === 't1' && opt.tierCounts[1] === 0) return false;
    if (tokens.length === 0) return true;
    return tokens.every(
      (token) =>
        opt.searchText.includes(token) ||
        (token.length >= 2 && isSubsequence(token, opt.searchText)),
    );
  });

  if (!selectedKeys || selectedKeys.size === 0) return filtered;
  return filtered.sort((a, b) => {
    const aSelected = selectedKeys.has(a.key) ? 0 : 1;
    const bSelected = selectedKeys.has(b.key) ? 0 : 1;
    if (aSelected !== bSelected) return aSelected - bSelected;
    const aNonZero = a.itemCount > 0 ? 0 : 1;
    const bNonZero = b.itemCount > 0 ? 0 : 1;
    if (aNonZero !== bNonZero) return aNonZero - bNonZero;
    return compareModOptions(a, b);
  });
}
