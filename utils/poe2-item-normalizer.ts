/**
 * PoE 2 裝備數值標準化器 (PoE 2 Item Normalizer)
 *
 * 還原裝備在扣除符文後的「淨底子數值 (Clean Stats)」
 * 以及在插滿指定目標符文下的「最大潛力數值 (Max Potential Stats)」。
 */

export type EquipmentSlot =
  | 'two_hand_weapon'
  | 'one_hand_weapon'
  | 'offhand'
  | 'body_armour'
  | 'helmet'
  | 'gloves'
  | 'boots'
  | 'accessory'
  | 'unknown';

export interface WeaponRuneConfig {
  type: 'phys_percent' | 'flat_fire' | 'flat_cold' | 'flat_lightning' | 'none';
  value: number; // 例如 20 代表 20% 物傷，或 12 代表平均 12 點傷
}

export interface ArmourRuneConfig {
  type: 'def_percent' | 'none';
  value: number; // 例如 20 代表 20% 防禦
}

export interface RuneSubstitutionConfig {
  weaponRune: WeaponRuneConfig;
  armourRune: ArmourRuneConfig;
}

export const DEFAULT_RUNE_CONFIG: RuneSubstitutionConfig = {
  weaponRune: { type: 'phys_percent', value: 20 },
  armourRune: { type: 'def_percent', value: 20 },
};

export interface SocketAnalysis {
  currentSockets: number;
  filledSockets: number;
  emptySockets: number;
  /** 部位基礎孔數上限 (卓越裝備會在此基礎上 +1) */
  baseLimit: number;
  /** 實際可達孔數上限 (含卓越裝備加成) */
  defaultLimit: number;
  targetSockets: number;
  isCorrupted: boolean;
  isExceptional: boolean;
  /** 被插槽綁定增幅永久佔用、無法取代的孔數 */
  lockedSockets: number;
  /** 滿孔試算時可替換為目標符文的孔數 (= targetSockets - lockedSockets) */
  overridableSockets: number;
  isOvercapped: boolean;
  canAddSockets: boolean;
  slot: EquipmentSlot;
}

export interface WeaponNormalizedStats {
  type: 'weapon';
  socketsCount: number;
  filledSocketsCount: number;
  emptySocketsCount: number;
  socketAnalysis: SocketAnalysis;
  current: {
    pdps: number;
    edps: number;
    dps: number;
  };
  clean: {
    pdps: number;
    edps: number;
    dps: number;
  };
  potential: {
    pdps: number;
    edps: number;
    dps: number;
    diffDps: number;
  };
  runeModifiers: {
    incPhysPercent: number;
    flatElemDps: number;
  };
}

export interface ArmourNormalizedStats {
  type: 'armour';
  socketsCount: number;
  filledSocketsCount: number;
  emptySocketsCount: number;
  socketAnalysis: SocketAnalysis;
  current: {
    armour: number;
    evasion: number;
    energyShield: number;
    totalDefense: number;
  };
  clean: {
    armour: number;
    evasion: number;
    energyShield: number;
    totalDefense: number;
  };
  potential: {
    armour: number;
    evasion: number;
    energyShield: number;
    totalDefense: number;
    diffTotalDefense: number;
  };
  runeModifiers: {
    incDefPercent: number;
  };
}

export type NormalizedItemStats = WeaponNormalizedStats | ArmourNormalizedStats;

interface RawItemProperty {
  name: string;
  values: Array<[string, number]>;
  displayMode?: number;
  type?: number;
}

interface RawItemMod {
  description: string;
  domain?: string;
  hash?: string;
}

/** 鑲嵌在裝備上的物品：增幅 (符文/靈魂核心/插槽綁定增幅) 或技能寶石 */
export interface RawSocketedItem {
  socket?: number;
  frameType?: number;
  frameTypeId?: string;
  support?: boolean;
  runeMods?: unknown[];
}

export interface RawPoeItem {
  realm?: string;
  baseType?: string;
  typeLine?: string;
  icon?: string;
  rarity?: string;
  corrupted?: boolean;
  category?: Record<string, unknown>;
  sockets?: Array<{ group?: number; type?: string }>;
  properties?: RawItemProperty[];
  runeMods?: RawItemMod[];
  explicitMods?: RawItemMod[];
  implicitMods?: RawItemMod[];
  craftedMods?: RawItemMod[];
  desecrated?: boolean;
  socketedItems?: RawSocketedItem[];
  extended?: {
    dps?: number;
    pdps?: number;
    edps?: number;
  };
}

/**
 * 取得部位預設孔數上限
 * 規則：
 * - 雙手武器 / 弓：預設上限 2 孔
 * - 單手武器 / 盾牌 / 副手：預設上限 1 孔
 * - 胸甲：預設上限 2 孔
 * - 頭盔 / 手套 / 鞋子：預設上限 1 孔
 * - 飾品：預設上限 0 孔
 */
export function getDefaultSocketLimit(slot: EquipmentSlot): number {
  switch (slot) {
    case 'two_hand_weapon':
    case 'body_armour':
      return 2;
    case 'one_hand_weapon':
    case 'offhand':
    case 'helmet':
    case 'gloves':
    case 'boots':
      return 1;
    case 'accessory':
    default:
      return 0;
  }
}

/**
 * 解碼 PoE CDN 動態圖示網址中的美術資源路徑。
 * 例：https://web.poecdn.com/gen/image/<base64url>/<hash>/HelmetIntStr02.png
 * base64 內容為 [版本, 參數, { f: "2DItems/Armours/Helmets/..." }]
 */
export function decodePoeIconArtPath(icon: string | undefined): string | undefined {
  if (typeof icon !== 'string') return undefined;
  const match = /\/gen\/image\/([A-Za-z0-9_-]+={0,2})\//.exec(icon);
  if (!match) return undefined;
  try {
    const normalized = match[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const decoded: unknown = JSON.parse(atob(padded));
    if (!Array.isArray(decoded)) return undefined;
    for (const part of decoded) {
      if (part && typeof part === 'object' && typeof (part as { f?: unknown }).f === 'string') {
        return (part as { f: string }).f;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

const ICON_PATH_SLOT_RULES: ReadonlyArray<readonly [RegExp, EquipmentSlot]> = [
  [/\/TwoHandWeapons\//i, 'two_hand_weapon'],
  [/\/OneHandWeapons\//i, 'one_hand_weapon'],
  [/\/BodyArmours\//i, 'body_armour'],
  [/\/Helmets\//i, 'helmet'],
  [/\/Gloves\//i, 'gloves'],
  [/\/Boots\//i, 'boots'],
  [/\/(Shields|Bucklers|Foci|Focus|Quivers)\//i, 'offhand'],
  [/\/(Rings|Amulets|Belts)\//i, 'accessory'],
];

function resolveSlotFromIconPath(path: string | undefined): EquipmentSlot | undefined {
  if (!path) return undefined;
  const normalized = `/${path}/`;
  for (const [pattern, slot] of ICON_PATH_SLOT_RULES) {
    if (pattern.test(normalized)) return slot;
  }
  return undefined;
}

/** 各語系卓越裝備 (Exceptional) 於 typeLine 的前綴 */
const EXCEPTIONAL_PREFIXES = ['Exceptional', '卓越'];

/**
 * 判斷是否為卓越裝備：普通物品的 typeLine 會帶「卓越 / Exceptional」前綴。
 * 稀有/魔法物品不一定帶前綴，因此 analyzeSockets 另以「未污染且孔數超出基礎上限」推定。
 */
export function isExceptionalItem(raw: RawPoeItem): boolean {
  const typeLine = (raw.typeLine ?? '').trim();
  const baseType = (raw.baseType ?? '').trim();
  if (!typeLine || typeLine === baseType) return false;
  return EXCEPTIONAL_PREFIXES.some((prefix) => typeLine.startsWith(prefix));
}

/**
 * 解析物品所屬裝備部位 (Equipment Slot)
 */
export function resolveEquipmentSlot(raw: RawPoeItem): EquipmentSlot {
  // 0. 由 CDN 圖示路徑判定 (與語系無關，可正確處理繁中/簡中等在地化 baseType)
  const iconSlot = resolveSlotFromIconPath(decodePoeIconArtPath(raw.icon));
  if (iconSlot) return iconSlot;

  const category = raw.category;
  if (category && typeof category === 'object') {
    const weapons = Array.isArray(category.weapons) ? (category.weapons as string[]) : [];
    if (weapons.length > 0) {
      const w = weapons[0].toLowerCase();
      if (
        w.includes('twohand') ||
        w.includes('bow') ||
        w.includes('crossbow') ||
        w.includes('quarterstaff') ||
        w.includes('staff')
      ) {
        return 'two_hand_weapon';
      }
      return 'one_hand_weapon';
    }

    const armour = Array.isArray(category.armour) ? (category.armour as string[]) : [];
    if (armour.length > 0) {
      const a = armour[0].toLowerCase();
      if (a.includes('chest')) return 'body_armour';
      if (a.includes('shield') || a.includes('quiver') || a.includes('focus')) return 'offhand';
      if (a.includes('helmet')) return 'helmet';
      if (a.includes('gloves')) return 'gloves';
      if (a.includes('boots')) return 'boots';
    }

    const accessories = Array.isArray(category.accessories)
      ? (category.accessories as string[])
      : [];
    if (accessories.length > 0) return 'accessory';
  }

  // 從 baseType 或 typeLine 推斷
  const name = `${raw.baseType || ''} ${raw.typeLine || ''}`.toLowerCase();

  // 1. 雙手武器特徵
  if (
    name.includes('quarterstaff') ||
    name.includes('bow') ||
    name.includes('crossbow') ||
    name.includes('two-hand') ||
    name.includes('two hand') ||
    name.includes('warstaff') ||
    name.includes('staff') ||
    name.includes('greatsword') ||
    name.includes('greataxe') ||
    name.includes('warhammer') ||
    name.includes('maul')
  ) {
    return 'two_hand_weapon';
  }

  // 2. 單手武器特徵
  if (
    name.includes('wand') ||
    name.includes('sceptre') ||
    name.includes('dagger') ||
    name.includes('claw') ||
    name.includes('flail') ||
    name.includes('one-hand') ||
    name.includes('one hand') ||
    name.includes('rapier')
  ) {
    return 'one_hand_weapon';
  }

  // 3. 副手特徵
  if (
    name.includes('shield') ||
    name.includes('focus') ||
    name.includes('quiver') ||
    name.includes('buckler')
  ) {
    return 'offhand';
  }

  // 4. 防具特徵
  if (
    name.includes('body armour') ||
    name.includes('plate') ||
    name.includes('vestment') ||
    name.includes('robe') ||
    name.includes('jacket') ||
    name.includes('coat') ||
    name.includes('tunic') ||
    name.includes('garb')
  ) {
    return 'body_armour';
  }
  if (
    name.includes('helmet') ||
    name.includes('cap') ||
    name.includes('crown') ||
    name.includes('hood') ||
    name.includes('helm') ||
    name.includes('mask') ||
    name.includes('coif')
  ) {
    return 'helmet';
  }
  if (
    name.includes('gloves') ||
    name.includes('gauntlets') ||
    name.includes('mitts') ||
    name.includes('bracers')
  ) {
    return 'gloves';
  }
  if (
    name.includes('boots') ||
    name.includes('greaves') ||
    name.includes('shoes') ||
    name.includes('slippers') ||
    name.includes('sabatons')
  ) {
    return 'boots';
  }

  // 5. 飾品特徵
  if (
    name.includes('ring') ||
    name.includes('amulet') ||
    name.includes('belt') ||
    name.includes('sash')
  ) {
    return 'accessory';
  }

  // 回退：若有武器屬性，預設為雙手武器
  const isWeapon =
    raw.extended?.dps !== undefined ||
    raw.properties?.some((p) => p.type === 13 || p.name.includes('Attacks per Second'));
  if (isWeapon) return 'two_hand_weapon';

  const isArmour = raw.properties?.some(
    (p) =>
      [16, 17, 18].includes(p.type ?? -1) ||
      p.name.includes('Armour') ||
      p.name.includes('Evasion') ||
      p.name.includes('Energy Shield'),
  );
  if (isArmour) return 'body_armour';

  return 'unknown';
}

/**
 * 取得鑲嵌在增幅插槽內的物品。
 * 官方 socketedItems 也會包含裝備附帶的技能寶石 (例如長矛的 Spear Throw)，必須排除。
 */
function getSocketedAugments(raw: RawPoeItem): RawSocketedItem[] {
  if (!Array.isArray(raw.socketedItems)) return [];
  return raw.socketedItems.filter(
    (item): item is RawSocketedItem =>
      !!item &&
      typeof item === 'object' &&
      item.frameTypeId !== 'Gem' &&
      item.frameType !== 4 &&
      item.support === undefined,
  );
}

/**
 * 插槽綁定增幅 (Socket-bound Augment)：鑲嵌後永久佔據該孔，無法取出或被取代。
 * 官方資料於鑲嵌物品的 runeMods 標示 `[SocketBound|<在地化名稱>]`，標籤 key 不隨語系變動。
 */
export function isSocketBoundAugment(item: RawSocketedItem): boolean {
  if (!Array.isArray(item.runeMods)) return false;
  return item.runeMods.some((mod) => {
    const text =
      typeof mod === 'string'
        ? mod
        : mod &&
            typeof mod === 'object' &&
            typeof (mod as { description?: unknown }).description === 'string'
          ? (mod as { description: string }).description
          : '';
    return /\[SocketBound(?:\||\])/i.test(text);
  });
}

/**
 * 分析裝備孔數狀態、預設上限與可打孔潛力
 */
export function analyzeSockets(raw: RawPoeItem, slot: EquipmentSlot): SocketAnalysis {
  const currentSockets = (raw.sockets || []).filter((s) => s.type === 'rune' || !s.type).length;
  const augments = getSocketedAugments(raw);
  const filledSockets = augments.length;
  const emptySockets = Math.max(0, currentSockets - filledSockets);
  const isCorrupted = Boolean(raw.corrupted);
  const baseLimit = getDefaultSocketLimit(slot);

  // 卓越裝備 = 基礎孔數 +1。未污染裝備若孔數已超出基礎上限，也只可能是卓越裝備。
  const isExceptional =
    baseLimit > 0 && (isExceptionalItem(raw) || (!isCorrupted && currentSockets > baseLimit));
  const defaultLimit = isExceptional ? baseLimit + 1 : baseLimit;

  // 已污染裝備孔數不可再變更；未污染裝備可打孔至上限
  const canAddSockets = !isCorrupted && currentSockets < defaultLimit;
  const targetSockets = canAddSockets ? defaultLimit : currentSockets;
  // 超出部位基礎上限 (卓越或污染加孔) 的資訊旗標
  const isOvercapped = currentSockets > baseLimit;
  const lockedSockets = Math.min(targetSockets, augments.filter(isSocketBoundAugment).length);
  const overridableSockets = Math.max(0, targetSockets - lockedSockets);

  return {
    currentSockets,
    filledSockets,
    emptySockets,
    baseLimit,
    defaultLimit,
    targetSockets,
    isCorrupted,
    isExceptional,
    lockedSockets,
    overridableSockets,
    isOvercapped,
    canAddSockets,
    slot,
  };
}

/**
 * 判斷是否為施法武器 (法杖 Wand、長杖 Staff 或 權杖 Sceptre，但不包含打擊類武杖 Quarterstaff)
 * 法杖與長杖在遊戲中吃法術傷害與施法速度，不適用攻擊 DPS 與物理/元素攻擊點傷符文覆寫試算。
 */
export function isCasterWeapon(raw: RawPoeItem): boolean {
  if (raw.category && typeof raw.category === 'object') {
    const weapons = Array.isArray(raw.category.weapons) ? (raw.category.weapons as string[]) : [];
    if (weapons.some((w) => w === 'wand' || w === 'staff' || w === 'sceptre')) {
      return true;
    }
  }

  const name = `${raw.baseType || ''} ${raw.typeLine || ''}`.toLowerCase();
  // 武杖 (Quarterstaff) 是打擊攻擊武器，不屬於施法武器
  if (name.includes('quarterstaff')) {
    return false;
  }
  if (name.includes('wand') || name.includes('staff') || name.includes('sceptre')) {
    return true;
  }
  return false;
}

/**
 * 試算並標準化 PoE 2 裝備數值
 */
export function normalizePoe2Item(
  item: RawPoeItem | unknown,
  config: RuneSubstitutionConfig = DEFAULT_RUNE_CONFIG,
): NormalizedItemStats | null {
  if (!item || typeof item !== 'object') return null;
  const raw = item as RawPoeItem;

  // 0. 施法武器 (法杖或長杖) 排除於攻擊武器標準化試算之外
  if (isCasterWeapon(raw)) {
    return null;
  }

  const slot = resolveEquipmentSlot(raw);
  const socketAnalysis = analyzeSockets(raw, slot);

  // 1. 判斷是否為武器 (包含 dps, pdps 或 Attacks per Second 屬性)
  const isWeapon =
    raw.extended?.dps !== undefined ||
    raw.properties?.some((p) => p.type === 13 || p.name.includes('Attacks per Second'));

  if (isWeapon) {
    return normalizeWeapon(raw, socketAnalysis, config);
  }

  // 2. 判斷是否為防具 (含有 Armour(16), Evasion(17), Energy Shield(18))
  const hasArmourProps = raw.properties?.some(
    (p) =>
      [16, 17, 18].includes(p.type ?? -1) ||
      p.name.includes('Armour') ||
      p.name.includes('Evasion') ||
      p.name.includes('Energy Shield'),
  );

  if (hasArmourProps) {
    return normalizeArmour(raw, socketAnalysis, config);
  }

  return null;
}

/**
 * 批次解析官方 fetch 結果陣列
 */
export function createResultNormalizedItems(
  results: unknown,
  config: RuneSubstitutionConfig = DEFAULT_RUNE_CONFIG,
): Record<string, NormalizedItemStats> {
  if (!Array.isArray(results)) return {};
  const normalized: Record<string, NormalizedItemStats> = {};
  results.forEach((result) => {
    if (!result || typeof result !== 'object') return;
    const { id, item } = result as { id?: unknown; item?: unknown };
    if (typeof id !== 'string' || !item) return;
    const stats = normalizePoe2Item(item, config);
    if (stats) normalized[id] = stats;
  });
  return normalized;
}

function normalizeWeapon(
  raw: RawPoeItem,
  socketAnalysis: SocketAnalysis,
  config: RuneSubstitutionConfig,
): WeaponNormalizedStats {
  const currentPdps = raw.extended?.pdps ?? 0;
  const currentEdps = raw.extended?.edps ?? 0;
  const currentDps = raw.extended?.dps ?? currentPdps + currentEdps;
  const aps = extractAps(raw.properties);

  // 1. 現有符文物傷 % 與元素點傷
  const runeIncPhys = extractIncPhysPercent(raw.runeMods);
  const runeFlatElemAvg = extractRuneFlatElemAvg(raw.runeMods);
  const runeFlatElemDps = roundToTwo(runeFlatElemAvg * aps);

  // 2. 裝備自身詞綴物傷 %
  const explicitIncPhys = extractIncPhysPercent([
    ...(raw.explicitMods || []),
    ...(raw.implicitMods || []),
    ...(raw.craftedMods || []),
  ]);

  // 3. 物理淨底子 (扣除現存符文石)
  let cleanPdps = currentPdps;
  if (currentPdps > 0) {
    const totalPhysScale = 1 + (explicitIncPhys + runeIncPhys) / 100;
    const cleanPhysScale = 1 + explicitIncPhys / 100;
    cleanPdps =
      totalPhysScale > 0
        ? roundToTwo((currentPdps * cleanPhysScale) / totalPhysScale)
        : currentPdps;
  }

  // 4. 元素淨底子 (扣除符文附加之點傷)
  const cleanEdps = Math.max(0, roundToTwo(currentEdps - runeFlatElemDps));
  const otherDps = Math.max(0, roundToTwo(currentDps - currentPdps - currentEdps));
  const cleanDps = roundToTwo(cleanPdps + cleanEdps + otherDps);

  // 5. 符文效果放大係數
  const augmentEffect = extractAugmentEffectPercent([
    ...(raw.explicitMods || []),
    ...(raw.implicitMods || []),
    ...(raw.craftedMods || []),
  ]);
  const augmentMultiplier = 1 + augmentEffect / 100;

  // 6. 滿孔潛力試算：將可覆寫的孔全部替換為使用者自選的目標符文 (插槽綁定增幅佔用的孔不可覆寫)
  let potentialPdps = cleanPdps;
  let potentialEdps = cleanEdps;

  const targetSockets = socketAnalysis.overridableSockets;
  const weaponRune = config.weaponRune;

  if (targetSockets > 0 && weaponRune.type !== 'none') {
    if (weaponRune.type === 'phys_percent') {
      const targetRuneIncPhys = Math.round(targetSockets * weaponRune.value * augmentMultiplier);
      if (currentPdps > 0) {
        const totalPhysScale = 1 + (explicitIncPhys + runeIncPhys) / 100;
        const potentialPhysScale = 1 + (explicitIncPhys + targetRuneIncPhys) / 100;
        potentialPdps =
          totalPhysScale > 0
            ? roundToTwo((currentPdps * potentialPhysScale) / totalPhysScale)
            : currentPdps;
      }
    } else if (
      weaponRune.type === 'flat_fire' ||
      weaponRune.type === 'flat_cold' ||
      weaponRune.type === 'flat_lightning'
    ) {
      const addedFlatElemDps = roundToTwo(
        targetSockets * weaponRune.value * augmentMultiplier * aps,
      );
      potentialEdps = roundToTwo(cleanEdps + addedFlatElemDps);
    }
  }

  const potentialDps = roundToTwo(potentialPdps + potentialEdps + otherDps);
  const diffDps = roundToTwo(potentialDps - currentDps);

  return {
    type: 'weapon',
    socketsCount: socketAnalysis.currentSockets,
    filledSocketsCount: socketAnalysis.filledSockets,
    emptySocketsCount: socketAnalysis.emptySockets,
    socketAnalysis,
    current: {
      pdps: currentPdps,
      edps: currentEdps,
      dps: currentDps,
    },
    clean: {
      pdps: cleanPdps,
      edps: cleanEdps,
      dps: cleanDps,
    },
    potential: {
      pdps: potentialPdps,
      edps: potentialEdps,
      dps: potentialDps,
      diffDps,
    },
    runeModifiers: {
      incPhysPercent: runeIncPhys,
      flatElemDps: runeFlatElemDps,
    },
  };
}

function normalizeArmour(
  raw: RawPoeItem,
  socketAnalysis: SocketAnalysis,
  config: RuneSubstitutionConfig,
): ArmourNormalizedStats {
  const currentArmour = extractPropertyValue(raw.properties, 16, 'Armour');
  const currentEvasion = extractPropertyValue(raw.properties, 17, 'Evasion');
  const currentEnergyShield = extractPropertyValue(raw.properties, 18, 'Energy Shield');
  const currentTotal = currentArmour + currentEvasion + currentEnergyShield;

  // 1. 現有符文防禦 %
  const runeIncDef = extractIncDefPercent(raw.runeMods);

  // 2. 裝備自身詞綴防禦 %
  const explicitIncDef = extractIncDefPercent([
    ...(raw.explicitMods || []),
    ...(raw.implicitMods || []),
    ...(raw.craftedMods || []),
  ]);

  const totalDefScale = 1 + (explicitIncDef + runeIncDef) / 100;
  const cleanDefScale = 1 + explicitIncDef / 100;

  const cleanArmour =
    totalDefScale > 0 ? Math.round((currentArmour * cleanDefScale) / totalDefScale) : currentArmour;
  const cleanEvasion =
    totalDefScale > 0
      ? Math.round((currentEvasion * cleanDefScale) / totalDefScale)
      : currentEvasion;
  const cleanEnergyShield =
    totalDefScale > 0
      ? Math.round((currentEnergyShield * cleanDefScale) / totalDefScale)
      : currentEnergyShield;
  const cleanTotal = cleanArmour + cleanEvasion + cleanEnergyShield;

  // 3. 符文效果放大係數
  const augmentEffect = extractAugmentEffectPercent([
    ...(raw.explicitMods || []),
    ...(raw.implicitMods || []),
    ...(raw.craftedMods || []),
  ]);
  const augmentMultiplier = 1 + augmentEffect / 100;

  // 4. 滿孔潛力試算：將可覆寫的孔全部替換為使用者自選的目標防具符文 (插槽綁定增幅佔用的孔不可覆寫)
  let potentialArmour = cleanArmour;
  let potentialEvasion = cleanEvasion;
  let potentialEnergyShield = cleanEnergyShield;

  const targetSockets = socketAnalysis.overridableSockets;
  const armourRune = config.armourRune;

  if (targetSockets > 0 && armourRune.type === 'def_percent') {
    const targetRuneIncDef = Math.round(targetSockets * armourRune.value * augmentMultiplier);
    const potentialDefScale = 1 + (explicitIncDef + targetRuneIncDef) / 100;

    potentialArmour =
      cleanDefScale > 0
        ? Math.round((cleanArmour * potentialDefScale) / cleanDefScale)
        : cleanArmour;
    potentialEvasion =
      cleanDefScale > 0
        ? Math.round((cleanEvasion * potentialDefScale) / cleanDefScale)
        : cleanEvasion;
    potentialEnergyShield =
      cleanDefScale > 0
        ? Math.round((cleanEnergyShield * potentialDefScale) / cleanDefScale)
        : cleanEnergyShield;
  }

  const potentialTotal = potentialArmour + potentialEvasion + potentialEnergyShield;
  const diffTotalDefense = potentialTotal - currentTotal;

  return {
    type: 'armour',
    socketsCount: socketAnalysis.currentSockets,
    filledSocketsCount: socketAnalysis.filledSockets,
    emptySocketsCount: socketAnalysis.emptySockets,
    socketAnalysis,
    current: {
      armour: currentArmour,
      evasion: currentEvasion,
      energyShield: currentEnergyShield,
      totalDefense: currentTotal,
    },
    clean: {
      armour: cleanArmour,
      evasion: cleanEvasion,
      energyShield: cleanEnergyShield,
      totalDefense: cleanTotal,
    },
    potential: {
      armour: potentialArmour,
      evasion: potentialEvasion,
      energyShield: potentialEnergyShield,
      totalDefense: potentialTotal,
      diffTotalDefense,
    },
    runeModifiers: {
      incDefPercent: runeIncDef,
    },
  };
}

function extractAps(properties?: RawItemProperty[]): number {
  if (!properties) return 1.0;
  for (const prop of properties) {
    if (prop.type === 13 || prop.name.includes('Attacks per Second')) {
      const valStr = prop.values?.[0]?.[0];
      const parsed = parseFloat(valStr || '');
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
  }
  return 1.0;
}

function extractPropertyValue(
  properties: RawItemProperty[] | undefined,
  typeCode: number,
  keyword: string,
): number {
  if (!properties) return 0;
  for (const prop of properties) {
    if (prop.type === typeCode || prop.name.includes(keyword)) {
      const valStr = prop.values?.[0]?.[0];
      const parsed = parseInt(valStr || '', 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
  }
  return 0;
}

function extractIncPhysPercent(mods?: RawItemMod[]): number {
  if (!mods) return 0;
  let total = 0;
  for (const mod of mods) {
    if (!mod?.description) continue;
    const match =
      mod.description.match(/(\d+)%\s+increased\s+(?:\[Physical\]|Physical)\s+Damage/i) ||
      mod.description.match(/(?:增加\s*|)(\d+)%\s*(?:\[物理\]|物理)\s*傷害/i);
    if (match) {
      total += parseInt(match[1], 10);
    }
  }
  return total;
}

function extractRuneFlatElemAvg(runeMods?: RawItemMod[]): number {
  if (!runeMods) return 0;
  let totalAvg = 0;
  for (const mod of runeMods) {
    if (!mod?.description) continue;
    const matchEn = mod.description.match(
      /Adds\s+(\d+)\s+to\s+(\d+)\s+(?:\[(?:Fire|Cold|Lightning)\]|Fire|Cold|Lightning)\s+Damage/i,
    );
    if (matchEn) {
      const min = parseInt(matchEn[1], 10);
      const max = parseInt(matchEn[2], 10);
      totalAvg += (min + max) / 2;
      continue;
    }
    const matchZh = mod.description.match(
      /附加\s*(\d+)\s*至\s*(\d+)\s*(?:\[(?:火焰|冰冷|閃電)\]|火焰|冰冷|閃電)\s*傷害/i,
    );
    if (matchZh) {
      const min = parseInt(matchZh[1], 10);
      const max = parseInt(matchZh[2], 10);
      totalAvg += (min + max) / 2;
    }
  }
  return totalAvg;
}

function extractIncDefPercent(mods?: RawItemMod[]): number {
  if (!mods) return 0;
  let total = 0;
  for (const mod of mods) {
    if (!mod?.description) continue;
    const match =
      mod.description.match(
        /(\d+)%\s+increased\s+(?:Armour|Evasion|Energy\s+Shield|\[Armour\]|\[Evasion\]|\[EnergyShield\])/i,
      ) ||
      mod.description.match(
        /(?:增加\s*|)(\d+)%\s*(?:護甲|閃避|能量護盾|\[護甲\]|\[閃避\]|\[能量護盾\])/i,
      );
    if (match) {
      total += parseInt(match[1], 10);
    }
  }
  return total;
}

function extractAugmentEffectPercent(mods?: RawItemMod[]): number {
  if (!mods) return 0;
  let total = 0;
  for (const mod of mods) {
    if (!mod?.description) continue;
    const match =
      mod.description.match(
        /(\d+)%\s+increased\s+effect\s+of\s+Socketed\s+(?:\[Augment\]|Augment)\s+Items/i,
      ) ||
      mod.description.match(
        /(?:增加\s*|)(\d+)%\s*(?:插槽中|插槽內的?)\s*(?:\[輔助\]|輔助)\s*物品效果/i,
      );
    if (match) {
      total += parseInt(match[1], 10);
    }
  }
  return total;
}

function roundToTwo(num: number): number {
  return Math.round(num * 100) / 100;
}
