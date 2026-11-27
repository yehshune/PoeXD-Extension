import type { PoeVersion } from './trade-context';
import { getTradeMapping } from '@/components/sidebar/mapping-registry';
import {
  resolveClusterSubcategoryPoe1,
  resolveTabletSubcategoryPoe2,
} from '@/components/sidebar/typeMaps';

export type OfficialTierCategoryResolution =
  | { status: 'known_category'; category: string }
  | { status: 'known_cleared' }
  | { status: 'unavailable' };

function extractRefinementText(target: unknown): string {
  if (!target) return '';
  if (typeof target === 'string') return target.trim().toLowerCase();
  if (typeof target === 'object' && target !== null) {
    const obj = target as Record<string, any>;
    if (typeof obj.option === 'string') return obj.option.trim().toLowerCase();
    if (typeof obj.discriminator === 'string') return obj.discriminator.trim().toLowerCase();
  }
  return '';
}

/**
 * Single Canonical Pure Resolver for Official Item Category
 *
 * 根據 PoE 官方 structured query 解析出對應的 PoeXD internal category，
 * 嚴格回傳三態語意 (known_category / known_cleared / unavailable)。
 */
export function resolveOfficialTierCategory(
  version: PoeVersion,
  rawQuery: unknown,
): OfficialTierCategoryResolution {
  if (!rawQuery || typeof rawQuery !== 'object') {
    return { status: 'unavailable' };
  }

  let query = rawQuery as Record<string, any>;
  if ('query' in query && query.query && typeof query.query === 'object') {
    query = query.query;
  }

  // 驗證是否為已初始化且包含 filters 結構的合法搜尋物件
  if (!query.filters || typeof query.filters !== 'object') {
    return { status: 'unavailable' };
  }

  const categoryFilter = query.filters?.type_filters?.filters?.category;

  const combinedRefinementText =
    `${extractRefinementText(query.type)} ${extractRefinementText(query.name)}`.trim();
  const resolveClusterRefinement = (): string | null =>
    version === 'poe1' && combinedRefinementText
      ? resolveClusterSubcategoryPoe1(combinedRefinementText)
      : null;

  const rawOption = categoryFilter?.option;
  const machineOption =
    rawOption === undefined || rawOption === null ? '' : String(rawOption).trim().toLowerCase();

  // 1. 若 category 欄位不存在，或 option 為 null/undefined/空字串
  if (!machineOption) {
    const refinedCluster = resolveClusterRefinement();
    if (refinedCluster) {
      return { status: 'known_category', category: refinedCluster };
    }
    return { status: 'known_cleared' };
  }

  // 2. 從既有 mapping infrastructure 查詢 machine option
  const mapping = getTradeMapping(version);
  const internalCategory = mapping?.machineOptionLookup?.[machineOption];

  // 嚴格落實 Mapping fail semantics：
  // 泛用 'jewel' 搭配明確星團底材時允許細分；其餘未知的非空 machine option 判定為 unavailable
  if (!internalCategory) {
    if (machineOption === 'jewel') {
      const refinedCluster = resolveClusterRefinement();
      if (refinedCluster) {
        return { status: 'known_category', category: refinedCluster };
      }
    }
    return { status: 'unavailable' };
  }

  // 3. Structured Refinement（如 PoE1 星團珠寶尺寸、PoE2 碑牌 Tablet 細分）
  if (internalCategory === 'cluster_jewel' && version === 'poe1') {
    const refined = resolveClusterRefinement();
    return { status: 'known_category', category: refined ?? 'cluster_jewel' };
  }

  if (internalCategory === 'tablet' && version === 'poe2') {
    if (combinedRefinementText) {
      const refined = resolveTabletSubcategoryPoe2(combinedRefinementText);
      if (refined) {
        return { status: 'known_category', category: refined };
      }
    }

    // 未知 refinement 時安全降級為通用 tablet，絕不誤判為 clear
    return { status: 'known_category', category: 'tablet' };
  }

  return { status: 'known_category', category: internalCategory };
}

const SPECIAL_SUBTYPE_TO_MAIN: Readonly<Record<string, string>> = {
  wands_minion: 'wand',
  rings_minion: 'ring',
  unset_ring: 'ring',
};

/**
 * 將 PoeXD 內部類別鍵（含子屬性基底，如 body_armours_str_dex、helmets_ward）
 * 反查為官方市集 `type_filters.filters.category.option` 代碼與對應主類別鍵。
 */
export function resolveOfficialCategoryOption(
  version: PoeVersion,
  internalCategory: string,
): { option: string; mainCategory: string } | null {
  if (!internalCategory) return null;
  const mapping = getTradeMapping(version);
  if (!mapping) return null;

  let mainCategory = SPECIAL_SUBTYPE_TO_MAIN[internalCategory] ?? internalCategory;
  if (mainCategory === internalCategory) {
    const parentRow = mapping.typeRowConfigs.find((row) =>
      Object.prototype.hasOwnProperty.call(row.subKeys, internalCategory),
    );
    if (parentRow) {
      mainCategory = parentRow.mainKey;
    }
  }

  const lookup = mapping.machineOptionLookup;
  for (const candidate of [internalCategory, mainCategory]) {
    const found = Object.entries(lookup).find(([, mapped]) => mapped === candidate);
    if (found) {
      return { option: found[0], mainCategory: candidate };
    }
  }

  return null;
}
