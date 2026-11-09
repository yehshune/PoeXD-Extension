import type { PoeVersion } from './trade-context';
import { getTradeMapping } from '@/components/sidebar/mapping-registry';
import { resolveTabletSubcategoryPoe2 } from '@/components/sidebar/typeMaps';

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

  // 1. 若 category 欄位不存在，或 option 為 null/undefined/空字串
  if (
    !categoryFilter ||
    categoryFilter.option === undefined ||
    categoryFilter.option === null ||
    categoryFilter.option === ''
  ) {
    return { status: 'known_cleared' };
  }

  const machineOption = String(categoryFilter.option).trim().toLowerCase();
  if (!machineOption) {
    return { status: 'known_cleared' };
  }

  // 2. 從既有 mapping infrastructure 查詢 machine option
  const mapping = getTradeMapping(version);
  const internalCategory = mapping?.machineOptionLookup?.[machineOption];

  // 嚴格落實 Mapping fail semantics：
  // 若為未知的非空 machine option，判定為 unavailable，絕不得誤判為 known_cleared！
  if (!internalCategory) {
    return { status: 'unavailable' };
  }

  // 3. Structured Refinement（如 PoE2 碑牌 Tablet 細分）
  if (internalCategory === 'tablet' && version === 'poe2') {
    const typeText = extractRefinementText(query.type);
    const nameText = extractRefinementText(query.name);
    const combined = `${typeText} ${nameText}`.trim();

    if (combined) {
      const refined = resolveTabletSubcategoryPoe2(combined);
      if (refined) {
        return { status: 'known_category', category: refined };
      }
    }

    // 未知 refinement 時安全降級為通用 tablet，絕不誤判為 clear
    return { status: 'known_category', category: 'tablet' };
  }

  return { status: 'known_category', category: internalCategory };
}
