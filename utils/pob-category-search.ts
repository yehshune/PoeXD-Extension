/**
 * 稀有裝的「類別＋防禦類型」搜尋：不限定基底，改以市集的物品類別（頭盔、戒指…）搜尋，
 * 護甲類再帶入基底的防禦類型（有的至少 1、沒有的為 0），找到同類型的其他基底。
 *
 * 類別由 PoB 的部位推得；武器、珠寶、臟器與傳奇不提供（基底決定了能力，換基底沒有意義）。
 */
import type { PobBuildItem, PobDefence } from './pob-build';
import type { PoeVersion } from './trade-context';

/** 防禦條件在市集 query 裡的區塊：PoE 1 是護甲過濾，PoE 2 是裝備過濾 */
export type DefenceSection = 'armour_filters' | 'equipment_filters';

export interface EntryCategory {
  /** 市集的物品類別（`armour.helmet`、`accessory.ring`…） */
  id: string;
  /** 基底的防禦類型；飾品沒有 */
  defences?: PobDefence[];
  defenceSection?: DefenceSection;
}

/** build 整體設定與單件的稀有裝搜尋方式：基底（預設）或類別＋防禦類型 */
export type RareSearchMode = 'base' | 'category';
export const RARE_SEARCH_MODES: readonly RareSearchMode[] = ['base', 'category'];
export const DEFAULT_RARE_SEARCH: RareSearchMode = 'base';

const CATEGORY_BY_SLOT: Readonly<Record<string, string>> = {
  Helmet: 'armour.helmet',
  'Body Armour': 'armour.chest',
  Gloves: 'armour.gloves',
  Boots: 'armour.boots',
  Amulet: 'accessory.amulet',
  Belt: 'accessory.belt',
};
const RING_SLOT = /^Ring \d+$/;
const OFF_HAND_SLOT = /^Weapon 2(?: Swap)?$/;

const DEFENCES_BY_SECTION: Readonly<Record<DefenceSection, readonly PobDefence[]>> = {
  armour_filters: ['ar', 'ev', 'es', 'ward'],
  // PoE 2 沒有結界
  equipment_filters: ['ar', 'ev', 'es'],
};

function categoryIdOf(slot: string, item: PobBuildItem, version: PoeVersion): string | undefined {
  if (CATEGORY_BY_SLOT[slot]) return CATEGORY_BY_SLOT[slot];
  if (RING_SLOT.test(slot)) return 'accessory.ring';
  // PoE 2 的副手還有法器與輕盾，不能只憑有防禦就當成盾牌
  if (version === 'poe1' && OFF_HAND_SLOT.test(slot) && item.baseDefences) return 'armour.shield';
  return undefined;
}

/** 非傳奇裝備依部位推得的類別；沒有對應時為 undefined */
export function categoryOfItem(item: PobBuildItem, version: PoeVersion): EntryCategory | undefined {
  if (item.rarity === 'UNIQUE' || item.rarity === 'RELIC') return undefined;
  const id = categoryIdOf(item.slot, item, version);
  if (!id) return undefined;
  if (!id.startsWith('armour.')) return { id };
  const defenceSection: DefenceSection =
    version === 'poe1' ? 'armour_filters' : 'equipment_filters';
  const supported = DEFENCES_BY_SECTION[defenceSection];
  const defences = (item.baseDefences ?? []).filter((defence) => supported.includes(defence));
  return defences.length ? { id, defences, defenceSection } : { id };
}

/** 以類別取代基底的搜尋：拿掉名稱與基底，帶入類別與每一種防禦的有無 */
export function categorySearchBase(
  category: EntryCategory,
  status: unknown,
): Record<string, unknown> {
  const { defences, defenceSection } = category;
  const defenceFilters =
    defences && defenceSection
      ? {
          [defenceSection]: {
            filters: Object.fromEntries(
              DEFENCES_BY_SECTION[defenceSection].map((defence) => [
                defence,
                defences.includes(defence) ? { min: 1 } : { max: 0 },
              ]),
            ),
          },
        }
      : {};
  return {
    status,
    filters: {
      type_filters: { filters: { category: { option: category.id } } },
      ...defenceFilters,
    },
  };
}
