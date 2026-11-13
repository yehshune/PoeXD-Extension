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

export interface RawItemMod {
  description?: string;
  domain?: string;
  hash?: string;
}

export type RawModEntry = RawItemMod | string;

/** 鑲嵌在裝備上的物品：增幅 (符文/靈魂核心/插槽綁定增幅) 或技能寶石 */
export interface RawSocketedItem {
  socket?: number;
  frameType?: number;
  frameTypeId?: string;
  support?: boolean;
  runeMods?: RawModEntry[];
  explicitMods?: RawModEntry[];
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
  runeMods?: RawModEntry[];
  explicitMods?: RawModEntry[];
  implicitMods?: RawModEntry[];
  craftedMods?: RawModEntry[];
  fracturedMods?: RawModEntry[];
  desecratedMods?: RawModEntry[];
  enchantMods?: RawModEntry[];
  desecrated?: boolean;
  socketedItems?: RawSocketedItem[];
  extended?: {
    dps?: number;
    pdps?: number;
    edps?: number;
    dps_aug?: boolean;
    pdps_aug?: boolean;
    ar?: number;
    ev?: number;
    es?: number;
    ar_aug?: boolean;
    ev_aug?: boolean;
    es_aug?: boolean;
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
        w.includes('staff') ||
        w.includes('talisman')
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
    name.includes('maul') ||
    name.includes('talisman')
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
  const iconPath = decodePoeIconArtPath(raw.icon);
  if (iconPath) {
    const normalizedPath = `/${iconPath}/`;
    if (/\/(Wands|Staves|Sceptres)\//i.test(normalizedPath)) {
      return true;
    }
    if (/\/Warstaves\//i.test(normalizedPath)) {
      return false;
    }
  }

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
  const currentAps = extractAps(raw.properties);
  const equipmentMods = collectEquipmentMods(raw);

  // 1. 裝備自身詞綴：局部物傷 %、局部攻速 %、增幅效果放大係數
  const explicitIncPhys = extractIncPhysPercent(equipmentMods);
  const explicitIncAps = extractLocalIncAttackSpeedPercent(equipmentMods);
  const augmentEffect = extractAugmentEffectPercent(equipmentMods);
  const augmentMultiplier = 1 + augmentEffect / 100;

  // 2. 現有符文詞綴：物傷 %、元素點傷、局部攻速 %
  const runeIncPhys = extractIncPhysPercent(raw.runeMods);
  const runeFlatElemAvg = extractRuneFlatElemAvg(raw.runeMods);
  const runeFlatElemDps = roundToTwo(runeFlatElemAvg * currentAps);
  const runeIncAps = extractLocalIncAttackSpeedPercent(raw.runeMods);

  // 3. 插槽綁定增幅 (不可移除/覆寫) 的固有貢獻，上限受現有 runeMods 總值約束
  const lockedAugments = getSocketedAugments(raw).filter(isSocketBoundAugment);
  const lockedAugmentMods = collectSocketedWeaponMods(lockedAugments);
  const lockedIncPhys = Math.min(
    runeIncPhys,
    Math.round(extractIncPhysPercent(lockedAugmentMods) * augmentMultiplier),
  );
  const lockedFlatElemAvg = Math.min(
    runeFlatElemAvg,
    extractRuneFlatElemAvg(lockedAugmentMods) * augmentMultiplier,
  );
  const lockedIncAps = Math.min(
    runeIncAps,
    Math.round(extractLocalIncAttackSpeedPercent(lockedAugmentMods) * augmentMultiplier),
  );

  // 4. 攻速倍率換算 (當現有符文含攻速時，覆寫為目標符文會失去可替換孔的攻速加成)
  const totalApsScale = 1 + (explicitIncAps + runeIncAps) / 100;
  const cleanApsScale = 1 + explicitIncAps / 100;
  const potentialApsScale = 1 + (explicitIncAps + lockedIncAps) / 100;
  const cleanApsRatio = totalApsScale > 0 ? cleanApsScale / totalApsScale : 1;
  const potentialApsRatio = totalApsScale > 0 ? potentialApsScale / totalApsScale : 1;
  const potentialAps = currentAps * potentialApsRatio;

  // 5. 物理與元素淨底子 (扣除全部現存符文石)
  const totalPhysScale = 1 + (explicitIncPhys + runeIncPhys) / 100;
  const cleanPhysScale = 1 + explicitIncPhys / 100;
  let cleanPdps = currentPdps;
  if (currentPdps > 0 && totalPhysScale > 0) {
    cleanPdps = roundToTwo(((currentPdps * cleanPhysScale) / totalPhysScale) * cleanApsRatio);
  }

  const baseEdpsWithoutRuneFlat = Math.max(0, currentEdps - runeFlatElemDps);
  const cleanEdps = Math.max(0, roundToTwo(baseEdpsWithoutRuneFlat * cleanApsRatio));
  const otherDps = Math.max(0, roundToTwo(currentDps - currentPdps - currentEdps));
  const cleanDps = roundToTwo(cleanPdps + cleanEdps + otherDps);

  // 6. 滿孔潛力試算：保留插槽綁定增幅，將可覆寫孔全部替換為使用者自選目標符文
  const targetSockets = socketAnalysis.overridableSockets;
  const weaponRune = config.weaponRune;

  const targetRuneIncPhys =
    targetSockets > 0 && weaponRune.type === 'phys_percent'
      ? Math.round(targetSockets * weaponRune.value * augmentMultiplier)
      : 0;
  const potentialPhysScale = 1 + (explicitIncPhys + lockedIncPhys + targetRuneIncPhys) / 100;
  const potentialPdps =
    currentPdps > 0 && totalPhysScale > 0
      ? roundToTwo(((currentPdps * potentialPhysScale) / totalPhysScale) * potentialApsRatio)
      : cleanPdps;

  const addedFlatElemDps =
    targetSockets > 0 &&
    (weaponRune.type === 'flat_fire' ||
      weaponRune.type === 'flat_cold' ||
      weaponRune.type === 'flat_lightning')
      ? targetSockets * weaponRune.value * augmentMultiplier * potentialAps
      : 0;
  const lockedFlatElemDps = lockedFlatElemAvg * potentialAps;
  const potentialEdps = Math.max(
    0,
    roundToTwo(baseEdpsWithoutRuneFlat * potentialApsRatio + lockedFlatElemDps + addedFlatElemDps),
  );

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

interface DefencePercentBreakdown {
  armour: number;
  evasion: number;
  energyShield: number;
}

function scaleDefenceValue(
  currentVal: number,
  explicitInc: number,
  currentRuneInc: number,
  targetRuneInc: number,
): number {
  if (currentVal <= 0) return 0;
  const totalScale = 1 + (explicitInc + currentRuneInc) / 100;
  const targetScale = 1 + (explicitInc + targetRuneInc) / 100;
  return totalScale > 0 ? Math.round((currentVal * targetScale) / totalScale) : currentVal;
}

function resolveTargetQuality(currentQuality: number, isCorrupted: boolean): number {
  // PoE 2 滿品質基準為 20%；已超過 20% 依實際品質計算，已污染則無法再打磨品質
  if (isCorrupted) return currentQuality;
  return currentQuality < 20 ? 20 : currentQuality;
}

function resolveBaselineDefence(
  rawPropVal: number,
  extendedVal: number | undefined,
  currentQuality: number,
  targetQuality: number,
): number {
  if (rawPropVal <= 0) return 0;
  // 官方 Trade API 的 extended.ar/ev/es 在未污染且品質 < 20% 時已自動換算為 20% 品質（>=20% 或已污染則為實際品質），
  // 由伺服器端直接用未進位底值計算最精準；缺少 extended 時則以品質倍率公式換算。
  if (typeof extendedVal === 'number' && extendedVal > 0) {
    return extendedVal;
  }
  if (targetQuality === currentQuality) return rawPropVal;
  const currentQualScale = 1 + currentQuality / 100;
  const targetQualScale = 1 + targetQuality / 100;
  return Math.round((rawPropVal * targetQualScale) / currentQualScale);
}

function normalizeArmour(
  raw: RawPoeItem,
  socketAnalysis: SocketAnalysis,
  config: RuneSubstitutionConfig,
): ArmourNormalizedStats {
  const currentQuality = extractQualityPercent(raw.properties);
  const targetQuality = resolveTargetQuality(currentQuality, Boolean(raw.corrupted));

  const currentArmour = resolveBaselineDefence(
    extractPropertyValue(raw.properties, 16, 'Armour'),
    raw.extended?.ar,
    currentQuality,
    targetQuality,
  );
  const currentEvasion = resolveBaselineDefence(
    extractPropertyValue(raw.properties, 17, 'Evasion'),
    raw.extended?.ev,
    currentQuality,
    targetQuality,
  );
  const currentEnergyShield = resolveBaselineDefence(
    extractPropertyValue(raw.properties, 18, 'Energy Shield'),
    raw.extended?.es,
    currentQuality,
    targetQuality,
  );
  const currentTotal = currentArmour + currentEvasion + currentEnergyShield;
  const equipmentMods = collectEquipmentMods(raw);

  // 1. 護甲 / 閃避 / 能量護盾各自獨立解析現有符文 % 與裝備詞綴 %
  const runeIncDef = extractIncDefPercentMap(raw.runeMods);
  const explicitIncDef = extractIncDefPercentMap(equipmentMods);

  const cleanArmour = scaleDefenceValue(currentArmour, explicitIncDef.armour, runeIncDef.armour, 0);
  const cleanEvasion = scaleDefenceValue(
    currentEvasion,
    explicitIncDef.evasion,
    runeIncDef.evasion,
    0,
  );
  const cleanEnergyShield = scaleDefenceValue(
    currentEnergyShield,
    explicitIncDef.energyShield,
    runeIncDef.energyShield,
    0,
  );
  const cleanTotal = cleanArmour + cleanEvasion + cleanEnergyShield;

  // 2. 符文效果放大係數與插槽綁定增幅固有貢獻
  const augmentEffect = extractAugmentEffectPercent(equipmentMods);
  const augmentMultiplier = 1 + augmentEffect / 100;
  const lockedAugments = getSocketedAugments(raw).filter(isSocketBoundAugment);
  const lockedAugmentMods = collectSocketedArmourMods(lockedAugments);
  const lockedIncRaw = extractIncDefPercentMap(lockedAugmentMods);
  const lockedIncDef: DefencePercentBreakdown = {
    armour: Math.min(runeIncDef.armour, Math.round(lockedIncRaw.armour * augmentMultiplier)),
    evasion: Math.min(runeIncDef.evasion, Math.round(lockedIncRaw.evasion * augmentMultiplier)),
    energyShield: Math.min(
      runeIncDef.energyShield,
      Math.round(lockedIncRaw.energyShield * augmentMultiplier),
    ),
  };

  // 3. 滿孔潛力試算：保留插槽綁定增幅，直接從 current 數值換算避免二次四捨五入誤差
  const targetSockets = socketAnalysis.overridableSockets;
  const armourRune = config.armourRune;
  const targetRuneIncDef =
    targetSockets > 0 && armourRune.type === 'def_percent'
      ? Math.round(targetSockets * armourRune.value * augmentMultiplier)
      : 0;

  const potentialArmour = scaleDefenceValue(
    currentArmour,
    explicitIncDef.armour,
    runeIncDef.armour,
    lockedIncDef.armour + targetRuneIncDef,
  );
  const potentialEvasion = scaleDefenceValue(
    currentEvasion,
    explicitIncDef.evasion,
    runeIncDef.evasion,
    lockedIncDef.evasion + targetRuneIncDef,
  );
  const potentialEnergyShield = scaleDefenceValue(
    currentEnergyShield,
    explicitIncDef.energyShield,
    runeIncDef.energyShield,
    lockedIncDef.energyShield + targetRuneIncDef,
  );

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
      incDefPercent: Math.max(runeIncDef.armour, runeIncDef.evasion, runeIncDef.energyShield),
    },
  };
}

function collectEquipmentMods(raw: RawPoeItem): RawModEntry[] {
  return [
    ...(raw.explicitMods || []),
    ...(raw.implicitMods || []),
    ...(raw.craftedMods || []),
    ...(raw.fracturedMods || []),
    ...(raw.desecratedMods || []),
    ...(raw.enchantMods || []),
  ];
}

function collectSocketedMods(
  augments: RawSocketedItem[],
  includePrefixRe: RegExp,
  excludePrefixRe: RegExp,
): RawModEntry[] {
  const collected: RawModEntry[] = [];
  for (const aug of augments) {
    for (const mod of [...(aug.explicitMods || []), ...(aug.runeMods || [])]) {
      const text = unwrapPoeBrackets(extractRawModText(mod));
      if (!text) continue;
      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || isBondedModLine(line)) continue;
        const prefixMatch = line.match(includePrefixRe);
        if (prefixMatch) {
          collected.push(prefixMatch[1].trim());
        } else if (!excludePrefixRe.test(line)) {
          collected.push(line);
        }
      }
    }
  }
  return collected;
}

function collectSocketedWeaponMods(augments: RawSocketedItem[]): RawModEntry[] {
  return collectSocketedMods(
    augments,
    /^(?:Martial\s+Weapon|Weapon|武器|近戰武器)\s*[:：]\s*(.+)$/i,
    /^(?:Wand|Staff|Armour|Shield|Focus|法杖|長杖|防具|護甲|盾牌)/i,
  );
}

function collectSocketedArmourMods(augments: RawSocketedItem[]): RawModEntry[] {
  return collectSocketedMods(
    augments,
    /^(?:Armour|防具|護甲)\s*[:：]\s*(.+)$/i,
    /^(?:Martial\s+Weapon|Weapon|Wand|Staff|武器|法杖|長杖)/i,
  );
}

function extractRawModText(mod: RawModEntry | unknown): string {
  if (typeof mod === 'string') return mod;
  if (mod && typeof mod === 'object' && typeof (mod as RawItemMod).description === 'string') {
    return (mod as RawItemMod).description as string;
  }
  return '';
}

function extractStatKey(mod: RawModEntry | unknown): string | undefined {
  if (!mod || typeof mod !== 'object') return undefined;
  const hash = (mod as RawItemMod).hash;
  if (typeof hash !== 'string') return undefined;
  const match = hash.match(/(stat_\d+)/);
  return match ? match[1] : undefined;
}

/** 將官方 `[Key|Display]` 與 `[Key]` 詞彙標記還原為純文字 */
function unwrapPoeBrackets(text: string): string {
  return text.replace(/\[(?:[^|\]]+\|)?([^\]]+)\]/g, '$1');
}

function isBondedModLine(line: string): boolean {
  return /^(?:Bonded|命定)\s*[:：]/i.test(line);
}

function parseFirstSignedPercent(text: string): number | null {
  const match = text.match(/(\d+)%/);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  if (Number.isNaN(value)) return null;
  const isReduced = /\breduced\b|減少|降低/i.test(text);
  return isReduced ? -value : value;
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

function extractQualityPercent(properties?: RawItemProperty[]): number {
  if (!properties) return 0;
  for (const prop of properties) {
    if (
      prop.type === 6 ||
      prop.name.includes('Quality') ||
      prop.name.includes('品質') ||
      prop.name.includes('品质')
    ) {
      const valStr = prop.values?.[0]?.[0];
      const parsed = parseInt(valStr || '', 10);
      if (!Number.isNaN(parsed) && parsed > 0) return parsed;
    }
  }
  return 0;
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

interface SignedPercentRule {
  statKey: string;
  enRe: RegExp;
  twRe: RegExp;
  cnRe: RegExp;
}

const INC_PHYS_RULE: SignedPercentRule = {
  statKey: 'stat_1509134228',
  enRe: /^(\d+)%\s+(increased|reduced)\s+Physical\s+Damage(?:\s*\(Local\))?$/i,
  twRe: /^(增加|減少)?\s*(\d+)%\s*物理\s*傷害(?:\s*\((?:部分|局部)\))?$/i,
  cnRe: /^物理伤害(提高|降低)\s*(\d+)%$/i,
};

const INC_APS_RULE: SignedPercentRule = {
  statKey: 'stat_210067635',
  enRe: /^(\d+)%\s+(increased|reduced)\s+Attack\s+Speed(?:\s*\(Local\))?$/i,
  twRe: /^(增加|減少)?\s*(\d+)%\s*攻擊速度(?:\s*\((?:部分|局部)\))?$/i,
  cnRe: /^攻击速度(提高|降低)\s*(\d+)%$/i,
};

const AUGMENT_EFFECT_RULE: SignedPercentRule = {
  statKey: 'stat_2081918629',
  enRe: /^(\d+)%\s+(increased|reduced)\s+effect\s+of\s+Socketed\s+Augment\s+Items$/i,
  twRe: /^(增加|減少)\s*(\d+)%\s*(?:鑲嵌的|插槽中|插槽內的?)\s*(?:增幅|輔助)?\s*物品效果$/i,
  cnRe: /^镶嵌的增幅器物品效果(提高|降低)\s*(\d+)%$/i,
};

function getNonBondedLines(cleanText: string): string[] {
  return cleanText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !isBondedModLine(line));
}

function extractSignedPercentByRule(
  mods: RawModEntry[] | undefined,
  rule: SignedPercentRule,
): number {
  if (!mods) return 0;
  let total = 0;
  for (const mod of mods) {
    const rawText = extractRawModText(mod);
    if (!rawText) continue;
    const lines = getNonBondedLines(unwrapPoeBrackets(rawText));
    if (lines.length === 0) continue;

    const statKey = extractStatKey(mod);
    if (statKey) {
      if (statKey === rule.statKey) {
        const val = parseFirstSignedPercent(lines.join('\n'));
        if (val !== null) total += val;
      }
      continue;
    }

    for (const line of lines) {
      const enMatch = line.match(rule.enRe);
      if (enMatch) {
        const val = parseInt(enMatch[1], 10);
        total += enMatch[2].toLowerCase() === 'reduced' ? -val : val;
        continue;
      }
      const twMatch = line.match(rule.twRe);
      if (twMatch) {
        const val = parseInt(twMatch[2], 10);
        total += twMatch[1] === '減少' ? -val : val;
        continue;
      }
      const cnMatch = line.match(rule.cnRe);
      if (cnMatch) {
        const val = parseInt(cnMatch[2], 10);
        total += cnMatch[1] === '降低' ? -val : val;
      }
    }
  }
  return total;
}

function extractIncPhysPercent(mods?: RawModEntry[]): number {
  return extractSignedPercentByRule(mods, INC_PHYS_RULE);
}

function extractLocalIncAttackSpeedPercent(mods?: RawModEntry[]): number {
  return extractSignedPercentByRule(mods, INC_APS_RULE);
}

const RUNE_FLAT_ELEM_STAT_KEYS = new Set(['stat_709508406', 'stat_1037193709', 'stat_3336890334']);

function parseFlatDamageRangeAvg(line: string): number | null {
  const enMatch = line.match(/^Adds\s+(\d+)\s+to\s+(\d+)\s+(?:Fire|Cold|Lightning)\s+Damage$/i);
  if (enMatch) {
    return (parseInt(enMatch[1], 10) + parseInt(enMatch[2], 10)) / 2;
  }
  const twMatch = line.match(/^附加\s*(\d+)\s*至\s*(\d+)\s*(?:火焰|冰冷|閃電)\s*傷害$/i);
  if (twMatch) {
    return (parseInt(twMatch[1], 10) + parseInt(twMatch[2], 10)) / 2;
  }
  const cnMatch = line.match(/^附加\s*(\d+)\s*[-至]\s*(\d+)\s*(?:火焰|冰霜|闪电)\s*伤害$/i);
  if (cnMatch) {
    return (parseInt(cnMatch[1], 10) + parseInt(cnMatch[2], 10)) / 2;
  }
  return null;
}

function extractRuneFlatElemAvg(runeMods?: RawModEntry[]): number {
  if (!runeMods) return 0;
  let totalAvg = 0;
  for (const mod of runeMods) {
    const rawText = extractRawModText(mod);
    if (!rawText) continue;
    const lines = getNonBondedLines(unwrapPoeBrackets(rawText));
    if (lines.length === 0) continue;

    const statKey = extractStatKey(mod);
    if (statKey) {
      if (RUNE_FLAT_ELEM_STAT_KEYS.has(statKey)) {
        const range = lines.join('\n').match(/(\d+)\s*(?:to|至|-)\s*(\d+)/i);
        if (range) {
          totalAvg += (parseInt(range[1], 10) + parseInt(range[2], 10)) / 2;
        }
      }
      continue;
    }

    for (const line of lines) {
      const avg = parseFlatDamageRangeAvg(line);
      if (avg !== null) totalAvg += avg;
    }
  }
  return totalAvg;
}

const DEF_STAT_KEY_TARGETS: Record<string, ReadonlyArray<keyof DefencePercentBreakdown>> = {
  stat_1062208444: ['armour'],
  stat_124859000: ['evasion'],
  stat_4015621042: ['energyShield'],
  stat_2451402625: ['armour', 'evasion'],
  stat_3321629045: ['armour', 'energyShield'],
  stat_1999113824: ['evasion', 'energyShield'],
  stat_3523867985: ['armour', 'evasion', 'energyShield'],
};

function applyDefenceTargetValue(
  acc: DefencePercentBreakdown,
  targetText: string,
  signedVal: number,
): boolean {
  const norm = targetText.replace(/\s*\((?:Local|部分|局部)\)\s*$/i, '').trim();
  if (
    /^(?:Armour,\s*Evasion(?:\s+Rating)?\s+and\s+Energy\s+Shield|護甲值?、閃避值?和能量護盾|护甲、闪避(?:值)?和能量护盾)$/i.test(
      norm,
    )
  ) {
    acc.armour += signedVal;
    acc.evasion += signedVal;
    acc.energyShield += signedVal;
    return true;
  }
  if (/^(?:Armour\s+and\s+Evasion(?:\s+Rating)?|護甲值?和閃避值?|护甲与闪避(?:值)?)$/i.test(norm)) {
    acc.armour += signedVal;
    acc.evasion += signedVal;
    return true;
  }
  if (/^(?:Armour\s+and\s+Energy\s+Shield|護甲值?和能量護盾|护甲与能量护盾)$/i.test(norm)) {
    acc.armour += signedVal;
    acc.energyShield += signedVal;
    return true;
  }
  if (
    /^(?:Evasion(?:\s+Rating)?\s+and\s+Energy\s+Shield|閃避值?和能量護盾|闪避(?:值)?与能量护盾)$/i.test(
      norm,
    )
  ) {
    acc.evasion += signedVal;
    acc.energyShield += signedVal;
    return true;
  }
  if (/^(?:Armour|護甲值?|护甲)$/i.test(norm)) {
    acc.armour += signedVal;
    return true;
  }
  if (/^(?:Evasion(?:\s+Rating)?|閃避值?|闪避值?)$/i.test(norm)) {
    acc.evasion += signedVal;
    return true;
  }
  if (/^(?:Energy\s+Shield|能量護盾|能量护盾)$/i.test(norm)) {
    acc.energyShield += signedVal;
    return true;
  }
  return false;
}

function extractIncDefPercentMap(mods?: RawModEntry[]): DefencePercentBreakdown {
  const acc: DefencePercentBreakdown = { armour: 0, evasion: 0, energyShield: 0 };
  if (!mods) return acc;

  for (const mod of mods) {
    const rawText = extractRawModText(mod);
    if (!rawText) continue;
    const lines = getNonBondedLines(unwrapPoeBrackets(rawText));
    if (lines.length === 0) continue;

    const statKey = extractStatKey(mod);
    if (statKey) {
      const targets = DEF_STAT_KEY_TARGETS[statKey];
      if (targets) {
        const val = parseFirstSignedPercent(lines.join('\n'));
        if (val !== null) {
          for (const key of targets) acc[key] += val;
        }
      }
      continue;
    }

    for (const line of lines) {
      const enMatch = line.match(/^(\d+)%\s+(increased|reduced)\s+(.+)$/i);
      if (enMatch) {
        const val = parseInt(enMatch[1], 10);
        const signedVal = enMatch[2].toLowerCase() === 'reduced' ? -val : val;
        if (applyDefenceTargetValue(acc, enMatch[3], signedVal)) continue;
      }

      const twMatch = line.match(/^(增加|減少)\s*(\d+)%\s*(.+)$/);
      if (twMatch) {
        const val = parseInt(twMatch[2], 10);
        const signedVal = twMatch[1] === '減少' ? -val : val;
        if (applyDefenceTargetValue(acc, twMatch[3], signedVal)) continue;
      }

      const cnMatch = line.match(/^(.+?)(提高|降低)\s*(\d+)%$/);
      if (cnMatch) {
        const val = parseInt(cnMatch[3], 10);
        const signedVal = cnMatch[2] === '降低' ? -val : val;
        applyDefenceTargetValue(acc, cnMatch[1], signedVal);
      }
    }
  }
  return acc;
}

function extractAugmentEffectPercent(mods?: RawModEntry[]): number {
  return extractSignedPercentByRule(mods, AUGMENT_EFFECT_RULE);
}

function roundToTwo(num: number): number {
  return Math.round(num * 100) / 100;
}
