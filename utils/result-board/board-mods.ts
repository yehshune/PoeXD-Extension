/**
 * 搜尋結果看板的獨立詞條彙整與條件篩選（階段 2）。
 *
 * 詞綴與複合詞的原始 JSON 解析統一委託給 `@/utils/trade-item-mods`，
 * 此模組專責看板選項彙整、累積階級統計與條件篩選比對。
 */
import {
  parseModTierCode,
  readTradeItemModData,
  type TradeItemModAffixKind,
  type TradeItemModRoll,
} from '@/utils/trade-item-mods';
import type { BoardEntry } from './board-entry';

export type BoardModAffixKind = TradeItemModAffixKind;
export type BoardModRoll = TradeItemModRoll;

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

/** 解析單一詞綴階級字串（例如 `P1` → prefix #1、`S3` → suffix #3） */
export const parseTierCode = parseModTierCode;

/** 從官方物品 JSON 擷取獨立詞條與階級／詞綴名索引 */
export const readExtendedModData = readTradeItemModData;

/** 從官方物品 JSON 擷取獨立詞條陣列 */
export function readBoardModRolls(
  item: Record<string, unknown>,
): readonly BoardModRoll[] | undefined {
  return readTradeItemModData(item).modRolls;
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
