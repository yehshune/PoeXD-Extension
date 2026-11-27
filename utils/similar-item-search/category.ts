/**
 * 從物品 icon 網址解出美術路徑，對應到市集類別。
 * icon 的 `/gen/image/<base64>/` 段落是 `[n, n, { f: '2DItems/…' }]`，兩代都有、與伺服器語言無關。
 */
import type { PoeVersion } from '../trade-context';

const ICON_SEGMENT = /\/gen\/image\/([A-Za-z0-9_\-+/=]+?)\//;
const MAX_ICON_LENGTH = 2048;

/** 美術路徑前綴 → 市集類別；越長的前綴越先比對 */
const CATEGORY_BY_ART: Readonly<Record<string, string>> = {
  'Armours/BodyArmours': 'armour.chest',
  'Armours/Helmets': 'armour.helmet',
  'Armours/Gloves': 'armour.gloves',
  'Armours/Boots': 'armour.boots',
  'Armours/Shields': 'armour.shield',
  Quivers: 'armour.quiver',
  Rings: 'accessory.ring',
  Amulets: 'accessory.amulet',
  Belts: 'accessory.belt',
  Trinkets: 'accessory.trinket',
  Jewels: 'jewel',
  'Weapons/OneHandWeapons/OneHandSwords': 'weapon.onesword',
  'Weapons/OneHandWeapons/Rapiers': 'weapon.onesword',
  'Weapons/OneHandWeapons/OneHandAxes': 'weapon.oneaxe',
  'Weapons/OneHandWeapons/OneHandMaces': 'weapon.onemace',
  'Weapons/OneHandWeapons/Scepters': 'weapon.sceptre',
  'Weapons/OneHandWeapons/Claws': 'weapon.claw',
  'Weapons/OneHandWeapons/Daggers': 'weapon.dagger',
  'Weapons/OneHandWeapons/Wands': 'weapon.wand',
  'Weapons/OneHandWeapons/OneHandSpears': 'weapon.spear',
  'Weapons/OneHandWeapons/Flails': 'weapon.flail',
  'Weapons/TwoHandWeapons/TwoHandSwords': 'weapon.twosword',
  'Weapons/TwoHandWeapons/TwoHandAxes': 'weapon.twoaxe',
  'Weapons/TwoHandWeapons/TwoHandMaces': 'weapon.twomace',
  'Weapons/TwoHandWeapons/Staves': 'weapon.staff',
  'Weapons/TwoHandWeapons/WarStaves': 'weapon.warstaff',
  'Weapons/TwoHandWeapons/Bows': 'weapon.bow',
  'Weapons/TwoHandWeapons/Crossbows': 'weapon.crossbow',
};

/** 只在該版本存在的類別 */
const VERSION_ONLY: Readonly<Record<string, PoeVersion>> = {
  'accessory.trinket': 'poe1',
  'weapon.spear': 'poe2',
  'weapon.flail': 'poe2',
  'weapon.crossbow': 'poe2',
};

const ART_PREFIXES = Object.keys(CATEGORY_BY_ART).sort((a, b) => b.length - a.length);

function artPathOf(icon: unknown): string | undefined {
  if (typeof icon !== 'string' || icon.length > MAX_ICON_LENGTH) return undefined;
  const segment = ICON_SEGMENT.exec(icon)?.[1];
  if (!segment) return undefined;
  try {
    const decoded: unknown = JSON.parse(atob(segment.replace(/-/g, '+').replace(/_/g, '/')));
    const meta = Array.isArray(decoded)
      ? decoded.find((part) => part && typeof part === 'object')
      : undefined;
    const path = meta && typeof meta.f === 'string' ? meta.f : undefined;
    return path?.replace(/^2DItems\//, '');
  } catch {
    return undefined;
  }
}

/** 物品的市集類別；無法辨識或不是裝備時為 undefined */
export function categoryOfTradeItem(
  item: Record<string, unknown>,
  version: PoeVersion,
): string | undefined {
  const path = artPathOf(item.icon);
  if (!path) return undefined;
  const prefix = ART_PREFIXES.find(
    (candidate) => path === candidate || path.startsWith(`${candidate}/`),
  );
  if (!prefix) return undefined;
  const category = CATEGORY_BY_ART[prefix];
  const only = VERSION_ONLY[category];
  return only && only !== version ? undefined : category;
}
