import type { ModGroup, ModTier } from './types';
import { negateBounds } from '@/utils/trade-value-sign';

// 靜態數據與輔助計算函數

/**
 * 依詞綴模板拆出各行的上下限。tradeNegated 時回傳市集的帶號數值（取負並交換上下限），
 * 「至少此階」因此落在最大值。
 */
export const getTierMinMaxList = (
  key: string,
  values: string[][],
  tradeNegated = false,
): { mins: string[]; maxs: string[] } => {
  const bounds = getUnsignedTierMinMaxList(key, values);
  if (!tradeNegated) return bounds;
  const signed = bounds.mins.map((min, i) => negateBounds(min, bounds.maxs[i] ?? ''));
  return { mins: signed.map((b) => b.min), maxs: signed.map((b) => b.max) };
};

/** 選取階級時「至少此階」與「上限」各自要填的欄位 */
export const getTierFilterBounds = (key: string, tier: ModTier) => {
  const { mins, maxs } = getTierMinMaxList(key, tier.values, tier.tradeNegated);
  return tier.tradeNegated
    ? { atLeast: { mins: undefined, maxs }, capField: 'mins' as const, cap: mins }
    : { atLeast: { mins, maxs: undefined }, capField: 'maxs' as const, cap: maxs };
};

const getUnsignedTierMinMaxList = (
  key: string,
  values: string[][],
): { mins: string[]; maxs: string[] } => {
  const mins: string[] = [];
  const maxs: string[] = [];
  if (!values || values.length === 0) return { mins, maxs };

  const subKeys = key.split('|||||');
  let valIdx = 0;

  subKeys.forEach((subKey) => {
    const hashCount = (subKey.match(/#/g) || []).length;

    if (hashCount === 2) {
      let subMin = '';
      let subMax = '';

      const range1 = valIdx < values.length ? values[valIdx++] : null;
      const range2 = valIdx < values.length ? values[valIdx++] : null;

      if (range1 && range2) {
        const min1 = Number(range1[0]);
        const max1 = range1.length === 2 ? Number(range1[1]) : Number(range1[0]);
        const min2 = Number(range2[0]);
        const max2 = range2.length === 2 ? Number(range2[1]) : Number(range2[0]);

        subMin = ((min1 + min2) / 2).toString();
        subMax = ((max1 + max2) / 2).toString();
      } else if (range1) {
        subMin = range1[0];
        subMax = range1.length === 2 ? range1[1] : range1[0];
      }

      mins.push(subMin);
      maxs.push(subMax);
    } else if (hashCount === 1) {
      let subMin = '';
      let subMax = '';

      if (valIdx < values.length) {
        const range = values[valIdx];
        if (range.length === 2) {
          subMin = range[0];
          subMax = range[1];
        } else if (range.length === 1) {
          subMin = range[0];
        }
        valIdx++;
      }

      mins.push(subMin);
      maxs.push(subMax);
    } else {
      mins.push('');
      maxs.push('');
    }
  });

  return { mins, maxs };
};

export const isTradeStatId = (id?: string): boolean => {
  if (!id) return false;
  return (
    id.startsWith('stat_') ||
    /^(explicit|implicit|enchant|crafted|fractured|scourge|crucible|sanctum|rune|ultimatum|delve|veiled|pseudo|monster|imbued|mercenary|skill|desecrated)\./.test(
      id,
    )
  );
};

/** 解析物品等級篩選輸入值；空白或負數回傳 null（表示不限） */
export const parseItemLevelFilter = (value: string | number | null | undefined): number | null => {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const num = Number(raw);
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.floor(num);
};

/** 解析階級需求物品等級；無法解析時回傳 null */
export const parseTierLevel = (level: string | number | undefined): number | null => {
  if (level === undefined || level === null || level === '') return null;
  const parsed = typeof level === 'number' ? level : Number.parseInt(String(level), 10);
  return Number.isFinite(parsed) ? parsed : null;
};

export interface ItemLevelRange {
  min: number | null;
  max: number | null;
}

export interface FilterModGroupsOptions {
  /** 保留超出上限 (max) 的更高階詞綴（供介面顯示為物等不足不可勾選） */
  includeHigherTiersAboveMax?: boolean;
}

/** 判斷單一階級是否落在指定物品等級區間內 */
export const isTierEligibleForItemLevel = (
  level: string | number | undefined,
  range: ItemLevelRange | number,
): boolean => {
  const tierLevel = parseTierLevel(level);
  if (tierLevel === null) return true;
  if (typeof range === 'number') {
    return tierLevel <= range;
  }
  if (range.min !== null && tierLevel < range.min) return false;
  if (range.max !== null && tierLevel > range.max) return false;
  return true;
};

/** 判斷單一階級是否因需求物等高於篩選上限而鎖定 */
export const isTierLockedByItemLevelMax = (
  level: string | number | undefined,
  maxItemLevel: number | null | undefined,
): boolean => {
  if (maxItemLevel === null || maxItemLevel === undefined) return false;
  const tierLevel = parseTierLevel(level);
  return tierLevel !== null && tierLevel > maxItemLevel;
};

/** 依物品等級區間篩選可出現的詞綴群組與階級；上下限皆未指定時原樣回傳 */
export const filterModGroupsByItemLevel = (
  groups: ModGroup[],
  range: ItemLevelRange | number | null,
  options?: FilterModGroupsOptions,
): ModGroup[] => {
  if (range === null) return groups;
  const normalized: ItemLevelRange = typeof range === 'number' ? { min: null, max: range } : range;
  if (normalized.min === null && normalized.max === null) return groups;
  const keepHigherTiers = Boolean(options?.includeHigherTiersAboveMax && normalized.max !== null);

  return groups.reduce<ModGroup[]>((acc, mod) => {
    const eligibleTiers = mod.tiers.filter((tier) =>
      isTierEligibleForItemLevel(tier.level, normalized),
    );
    if (eligibleTiers.length === 0) {
      return acc;
    }

    const tiers = keepHigherTiers
      ? mod.tiers.filter((tier) =>
          isTierEligibleForItemLevel(tier.level, { min: normalized.min, max: null }),
        )
      : eligibleTiers;

    acc.push({
      ...mod,
      tiers,
    });
    return acc;
  }, []);
};
