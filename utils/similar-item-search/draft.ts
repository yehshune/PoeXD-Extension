/**
 * 從官方 `/fetch` 物品推導 Similar Search Draft。
 */
import { categoryOfTradeItem } from './category';
import { deriveArmourProperties, deriveWeaponProperties } from './properties';
import { deriveDraftStats } from './stats';
import {
  DEFAULT_SIMILAR_TOLERANCE,
  type SimilarSearchContext,
  type SimilarSearchDraft,
} from './types';

const RARE_FRAME_TYPE = 2;
const INSTANT_BUYOUT = 'securable';
const WEAPON_PREFIX = 'weapon.';
const ARMOUR_PREFIX = 'armour.';

const isRare = (item: Record<string, unknown>): boolean =>
  item.rarity === 'Rare' || (item.rarity === undefined && item.frameType === RARE_FRAME_TYPE);

/** 稀有、已鑑定、類別是武器／防具／飾品／珠寶的物品才能找相似 */
export function isSimilarSearchEligible(
  item: unknown,
  version: SimilarSearchContext['version'],
): boolean {
  if (typeof item !== 'object' || item === null || Array.isArray(item)) return false;
  const record = item as Record<string, unknown>;
  return (
    isRare(record) && record.identified !== false && Boolean(categoryOfTradeItem(record, version))
  );
}

/** 稀有的武器、防具、飾品與珠寶才產生草稿；其他物品回傳 null */
export function createSimilarSearchDraft(
  item: Record<string, unknown>,
  context: SimilarSearchContext,
): SimilarSearchDraft | null {
  if (!isSimilarSearchEligible(item, context.version)) return null;
  const category = categoryOfTradeItem(item, context.version) as string;
  const tolerance = context.tolerance ?? DEFAULT_SIMILAR_TOLERANCE;
  const weapon = category.startsWith(WEAPON_PREFIX)
    ? deriveWeaponProperties(item, tolerance, context.weaponMode)
    : undefined;
  return {
    version: context.version,
    category,
    baseType: typeof item.baseType === 'string' ? item.baseType : '',
    scope: context.scope ?? 'category',
    tolerance,
    status: context.status ?? INSTANT_BUYOUT,
    stats: deriveDraftStats(item, {
      version: context.version,
      tolerance,
      englishStatText: context.englishStatText,
    }),
    ...(weapon ? { weaponMode: weapon.weaponMode } : {}),
    properties: weapon
      ? weapon.properties
      : category.startsWith(ARMOUR_PREFIX)
        ? deriveArmourProperties(item, tolerance)
        : [],
  };
}
