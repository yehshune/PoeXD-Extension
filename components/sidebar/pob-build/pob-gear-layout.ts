/**
 * 把購物清單的裝備項目依 PoB 部位放到「遊戲裝備欄」的位置：主要裝備在 8×6 的格子裡
 * （武器左右、頭與身體在中間、戒指與項鍊在身體兩側、手腳在下方），其餘部位（藥劑、護符、
 * 柳條人、移植物、珠寶）各自一列。純函式，不碰介面。
 */

/** 只需要部位、英文名稱與種類就能排版 */
export interface GearLayoutEntry {
  slot?: string;
  englishName: string;
}

export type GearCellId =
  | 'weapon1'
  | 'weapon2'
  | 'helmet'
  | 'bodyArmour'
  | 'gloves'
  | 'boots'
  | 'amulet'
  | 'ring1'
  | 'ring2'
  | 'ring3'
  | 'belt';

export interface GearCell {
  /** 從 1 起算的欄與列（CSS grid） */
  column: number;
  row: number;
  width: number;
  height: number;
}

/** 8 欄 × 6 列的裝備欄 */
export const GEAR_COLUMNS = 8;
export const GEAR_ROWS = 6;

export const GEAR_CELLS: Readonly<Record<GearCellId, GearCell>> = {
  weapon1: { column: 1, row: 1, width: 2, height: 4 },
  helmet: { column: 4, row: 1, width: 2, height: 2 },
  weapon2: { column: 7, row: 1, width: 2, height: 4 },
  ring3: { column: 3, row: 3, width: 1, height: 1 },
  bodyArmour: { column: 4, row: 3, width: 2, height: 3 },
  amulet: { column: 6, row: 3, width: 1, height: 1 },
  ring1: { column: 3, row: 4, width: 1, height: 1 },
  ring2: { column: 6, row: 4, width: 1, height: 1 },
  gloves: { column: 1, row: 5, width: 2, height: 2 },
  belt: { column: 4, row: 6, width: 2, height: 1 },
  boots: { column: 7, row: 5, width: 2, height: 2 },
};

const CELL_SLOTS: Readonly<Record<string, GearCellId>> = {
  'Weapon 1': 'weapon1',
  'Weapon 2': 'weapon2',
  Helmet: 'helmet',
  'Body Armour': 'bodyArmour',
  Gloves: 'gloves',
  Boots: 'boots',
  Amulet: 'amulet',
  'Ring 1': 'ring1',
  'Ring 2': 'ring2',
  'Ring 3': 'ring3',
  Belt: 'belt',
};

const SWAP_SLOTS: Readonly<Record<string, 'weapon1' | 'weapon2'>> = {
  'Weapon 1 Swap': 'weapon1',
  'Weapon 2 Swap': 'weapon2',
};

export const FLASK_COUNT = 5;
const FLASK_SLOT = /^Flask (\d+)$/;
const CHARM_SLOT = /^Charm (\d+)$/;
const GRAFT_SLOT = /^Graft \d+$/;
const ABYSSAL_SLOT = / Abyssal Socket \d+$/;
const CLUSTER_JEWEL = /Cluster Jewel$/;
const ABYSS_JEWEL_BASES = /^(?:Murderous|Searching|Hypnotic|Ghastly) Eye Jewel$/;
const JEWEL_SLOT = 'Jewel';
/** 柳條人部位依 頭 → 身體 → 上肢 → 下肢 排序，合成臟器在最後；新舊 PoB 的名稱都認得 */
const WICKERMAN_ORDER: readonly string[] = [
  'Head',
  'Wickerman Head',
  'Body',
  'Wickerman Torso',
  'Arm',
  'Wickerman Upper Limb',
  'Leg',
  'Wickerman Lower Limb',
  'Wickerman',
];

export interface GearLayout<T extends GearLayoutEntry> {
  equipped: Partial<Record<GearCellId, T>>;
  swap: Partial<Record<'weapon1' | 'weapon2', T>>;
  hasSwap: boolean;
  /** 固定五格，沒有的格子為 undefined */
  flasks: (T | undefined)[];
  charms: T[];
  wickerman: T[];
  grafts: T[];
  jewels: { cluster: T[]; regular: T[]; abyssal: T[] };
  others: T[];
}

const numberOf = (pattern: RegExp, slot: string): number => Number(pattern.exec(slot)?.[1] ?? 0);

function jewelKind(entry: GearLayoutEntry): 'cluster' | 'regular' | 'abyssal' | undefined {
  const slot = entry.slot ?? '';
  if (ABYSSAL_SLOT.test(slot)) return 'abyssal';
  if (slot !== JEWEL_SLOT) return undefined;
  if (CLUSTER_JEWEL.test(entry.englishName)) return 'cluster';
  if (ABYSS_JEWEL_BASES.test(entry.englishName)) return 'abyssal';
  return 'regular';
}

export function gearLayout<T extends GearLayoutEntry>(entries: readonly T[]): GearLayout<T> {
  const equipped: Partial<Record<GearCellId, T>> = {};
  const swap: Partial<Record<'weapon1' | 'weapon2', T>> = {};
  const flasks: (T | undefined)[] = Array.from({ length: FLASK_COUNT }, () => undefined);
  const charms: T[] = [];
  const wickerman: T[] = [];
  const grafts: T[] = [];
  const jewels: GearLayout<T>['jewels'] = { cluster: [], regular: [], abyssal: [] };
  const others: T[] = [];

  for (const entry of entries) {
    const slot = entry.slot ?? '';
    const cell = Object.hasOwn(CELL_SLOTS, slot) ? CELL_SLOTS[slot] : undefined;
    const swapCell = Object.hasOwn(SWAP_SLOTS, slot) ? SWAP_SLOTS[slot] : undefined;
    const flask = numberOf(FLASK_SLOT, slot);
    const jewel = jewelKind(entry);
    if (cell && !equipped[cell]) equipped[cell] = entry;
    else if (swapCell && !swap[swapCell]) swap[swapCell] = entry;
    else if (flask >= 1 && flask <= FLASK_COUNT && !flasks[flask - 1]) flasks[flask - 1] = entry;
    else if (CHARM_SLOT.test(slot)) charms.push(entry);
    else if (WICKERMAN_ORDER.includes(slot)) wickerman.push(entry);
    else if (GRAFT_SLOT.test(slot)) grafts.push(entry);
    else if (jewel) jewels[jewel].push(entry);
    else others.push(entry);
  }

  const bySlotOrder = (a: T, b: T) =>
    WICKERMAN_ORDER.indexOf(a.slot ?? '') - WICKERMAN_ORDER.indexOf(b.slot ?? '');
  const byCharm = (a: T, b: T) =>
    numberOf(CHARM_SLOT, a.slot ?? '') - numberOf(CHARM_SLOT, b.slot ?? '');

  return {
    equipped,
    swap,
    hasSwap: Boolean(swap.weapon1 || swap.weapon2),
    flasks,
    charms: [...charms].sort(byCharm),
    wickerman: [...wickerman].sort(bySlotOrder),
    grafts,
    jewels,
    others,
  };
}
