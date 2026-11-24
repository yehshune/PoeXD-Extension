/**
 * 購物清單：把匯入的 PoB build 轉成一筆筆可以直接開啟的官方市集搜尋。
 *
 * - 傳奇：以名稱加基底搜尋；永恆珠寶另外帶入種子編號。
 * - 稀有、魔法、普通：以基底搜尋，並把對得到市集代碼的固定詞綴與一般詞綴帶入條件（下限預設取八成，
 *   方便找到相近而不必完全相同的裝備）；工藝詞綴可以自己做，不列入條件。附魔只有星團珠寶預設帶入。
 * - 寶石：以名稱搜尋，等級與品質帶入下限（PoE 1、PoE 2 都有）。
 * - 身甲與雙手武器有五連以上時帶入連結數下限。
 * - 身外 Wickerman 的臟器（3.30）：放在 Wickerman 部位的臟器是普通物品，以基底搜尋、詞綴是固定詞綴。
 *   PoB 只給合併後的臟器詞綴（自訂詞綴區塊）時，依詞綴資料把每一行分到頭部／身體／手部／腿部，
 *   每個部位一列、以市集的部位分類搜尋。分不出部位的詞綴合成一個「臟器」項目，以臟器分類搜尋、
 *   預設至少符合 1 項（詞綴分屬不同件，全部符合找不到東西）。
 *
 * 每一行詞綴對到的市集代碼都記在 `ShoppingMod.stat`，使用者可以在清單上自行勾選、改數值、改成
 * 「至少符合 N 項」或總和條件（`EntrySearchSelection`），由 `buildEntryQuery` 組出實際的搜尋。
 *
 * PoB 的名稱是英文；市集搜尋要用頁面所在區服的名稱，由 `TradeNameCatalog` 轉換。對不到
 * 市集名稱的項目仍列出，但沒有搜尋（`query` 為 null），不會用猜的名稱去搜。
 */
import {
  FOULBORN_NAME,
  VISCERA_BUNDLE_NAME,
  VISCERA_BUNDLE_SLOT,
  type PobBuild,
  type PobBuildGem,
  type PobBuildItem,
  type PobItemRarity,
  type PobItemSet,
} from './pob-build';
import {
  categoryOfItem,
  categorySearchBase,
  defencesOfItem,
  NON_UNIQUE_RARITY,
  DEFAULT_RARE_SEARCH,
  OFF_HAND_SLOT,
  RARE_SEARCH_MODES,
  type EntryCategory,
  type EntryDefences,
  type RareSearchMode,
} from './pob-category-search';
import {
  modLineSkeleton,
  type LocalPreference,
  type StatDomain,
  type StatMatcher,
} from './pob-stat-matcher';
import { statDomainOf, withStatDomain } from './stat-domain-order';
import { getLocaleItemsAssetPath, tradeVersionProfiles, type PoeVersion } from './trade-context';

export interface TradeNameCatalog {
  /** 英文物品名 → 頁面區服的市集名稱；不是市集上的物品時為 undefined */
  toTradeName(english: string): string | undefined;
  /** 從含詞綴的完整名稱裡找出基底（取最長的相符名稱） */
  findBaseType(fullName: string): string | undefined;
}

export type ShoppingEntryKind = 'unique' | 'equipment' | 'gem';

/** 清單要用哪一組裝備套裝與技能組；省略時用 PoB 匯出當下選用的那一組 */
export interface ShoppingSelection {
  itemSetId?: string;
  skillSetId?: string;
}

export type ShoppingModKind = 'implicit' | 'enchant' | 'explicit' | 'crafted';

/** 一行詞綴對到的總和條件（pseudo）與它在總和裡的倍數（全抗算三次） */
export interface PseudoContribution {
  id: string;
  weight: number;
}

/** 一行詞綴對到的市集條件 */
export interface ShoppingStat {
  id: string;
  /** 這一行的數值（保留正負號） */
  value?: number;
  /** 選項型代碼的選項 */
  option?: number;
  /** 數值必須完全相同（永恆珠寶的種子編號、附魔） */
  exact?: boolean;
  /** 預設是否帶入搜尋 */
  defaultEnabled: boolean;
  pseudo?: readonly PseudoContribution[];
  /** 可以切換的網域前綴（含目前的；市集上這個代碼後綴有兩種以上前綴時才有） */
  domains?: readonly string[];
}

export interface ShoppingMod {
  /** PoB 的英文詞綴 */
  text: string;
  kind: ShoppingModKind;
  /** 對得到市集代碼時才有；沒有的行不能勾選 */
  stat?: ShoppingStat;
  /** 這一行目前有帶入搜尋條件（套用使用者的選擇後） */
  searched: boolean;
}

export interface ShoppingEntry {
  /**
   * 由內容決定的識別字串，用來記住「已完成」與「已刪除」。同一件裝備出現在不同套裝時
   * 是同一個 key，買過一次就不必在每個階段重新勾選。
   */
  key: string;
  kind: ShoppingEntryKind;
  /** 頁面區服的市集名稱（搜尋用的就是這個）；對不到時為 PoB 的英文名稱 */
  label: string;
  /** 英文名稱，介面用它換成顯示語言的名稱（顯示語言可以和頁面區服不同） */
  englishName: string;
  /** 名稱後的補充（永恆珠寶的種子編號） */
  suffix?: string;
  /** 同一套裡完全相同的項目數（兩顆一樣的珠寶、兩組連結各用一顆相同的寶石） */
  count: number;
  /** 寶石才有：所屬的分組（同一部位或同一連線） */
  gemGroup?: ShoppingGemGroup;
  /** 部位（裝備）或等級／品質（寶石），依 kind 由介面決定怎麼顯示 */
  slot?: string;
  level?: number;
  quality?: number;
  /** PoE 2 技能寶石：PoB 裡連結的輔助寶石數（搜尋時當插槽數下限，0 為不限）；其他寶石省略 */
  gemSockets?: number;
  /** 寶石品質在市集 query 的過濾區塊（PoE 1 為 misc_filters，PoE 2 為 type_filters） */
  gemQualitySection?: GemQualitySection;
  /** 裝備才有：稀有度與詞綴，供介面顯示 */
  rarity?: PobItemRarity;
  mods?: ShoppingMod[];
  /**
   * 從 PoB 自訂詞綴合成的臟器項目：詞綴來自多件臟器，搜尋一律是「至少符合 N 項」（預設 1），
   * 固定詞綴也算進 N 項。
   */
  visceraBundle?: true;
  /** 從合成臟器拆出、只含單一部位詞綴的項目：以市集的部位分類搜尋，詞綴全部符合 */
  visceraPart?: VisceraPart;
  /** PoB 的插槽文字（`R-R-G B`），裝備欄畫孔洞用 */
  sockets?: string;
  /** 傳奇的英文底材名稱，查圖片尺寸用 */
  artBase?: string;
  /** PoE 2 插槽內容物的英文名稱（符文、靈魂核心），依插槽順序 */
  socketed?: string[];
  /** PoB 裡這件是已汙染的 */
  corrupted?: true;
  /** 穢生傳奇（englishName 是去掉前綴的一般名稱） */
  foulborn?: true;
  /** PoB 裝備的連結數；五連以上才有（實際是否帶入搜尋由 `effectiveLinks` 決定） */
  links?: number;
  /** 非傳奇裝備依部位推得的市集類別；有才能改用「類別＋防禦類型」搜尋 */
  category?: EntryCategory;
  /** 基底有的防禦與 PoB 的數值；整體設定開啟「防禦數值下限」時帶入 */
  defences?: EntryDefences;
  /** 不含詞綴與連結條件的搜尋（名稱、基底、分類）；null 表示無法搜尋 */
  searchBase: Record<string, unknown> | null;
  /** 官方市集的 query 物件（套用使用者的選擇後）；null 表示無法搜尋 */
  query: Record<string, unknown> | null;
}

/** 寶石的分組：插在同一部位的寶石一組；沒有指定部位的以連線為一組 */
export interface ShoppingGemGroup {
  /** 分組識別（部位名稱，或 `link:` 加連線名稱） */
  id: string;
  /** PoB 部位名稱；沒有指定部位時省略 */
  slot?: string;
  /** 沒有部位時的連線名稱：PoB 的技能標籤或第一顆主動寶石的英文名稱 */
  skill?: string;
}

/** 使用者對單一條件的調整；min / max 為 null 表示清掉該邊界 */
export interface StatSelection {
  enabled?: boolean;
  /** 改用的網域前綴（例如把 `explicit.stat_1` 換成 `fractured.stat_1`） */
  domain?: string;
  min?: number | null;
  max?: number | null;
}

/** 使用者對一個項目的搜尋調整，存在本機 */
export interface EntrySearchSelection {
  /** 以 PoB 對到的市集代碼為鍵（切換網域後仍用原代碼）：同一個代碼的多行是同一個條件 */
  stats?: Readonly<Record<string, StatSelection>>;
  /** 設定時改為「至少符合 N 項」 */
  countMin?: number;
  /** 抗性、生命、能力值合併成總和條件；省略時依 build 整體設定 */
  pseudo?: boolean;
  /** 單件的連結條件：數字為連結數下限，null 為不限；省略時依 build 整體設定 */
  links?: number | null;
  /** 單件的稀有裝搜尋方式；省略時依 build 整體設定 */
  searchBy?: RareSearchMode;
  /** 寶石的等級／品質下限：數字為下限，null 為不限；省略時用 PoB 的數值 */
  gemLevel?: number | null;
  gemQuality?: number | null;
  /** PoE 2 寶石的插槽數下限：數字為下限，null 為不限；省略時用 PoB 連結的輔助寶石數 */
  gemSockets?: number | null;
}

/** 寶石等級與品質下限可以設定的範圍 */
export const MAX_GEM_LEVEL = 40;
export const MAX_GEM_QUALITY = 100;
/** PoE 2 技能寶石最多的輔助寶石插槽數 */
export const MAX_GEM_SOCKETS = 6;

/** build 整體設定的連結條件：照 PoB（五連以上）、只帶六連、一律不帶 */
export type LinkPolicy = 'pob' | 'six' | 'none';
export const LINK_POLICIES: readonly LinkPolicy[] = ['pob', 'six', 'none'];
/** 詞綴數值下限可選的比例（原數值的百分比） */
export const STAT_PERCENT_OPTIONS: readonly number[] = [100, 90, 80, 70, 60, 50];
export const DEFAULT_STAT_PERCENT = 80;
export const DEFAULT_LINK_POLICY: LinkPolicy = 'pob';
/** 單件可以選的連結數下限 */
export const LINK_OPTIONS: readonly number[] = [5, 6];

/** 一份 build 的整體搜尋設定；只存和預設不同的欄位，單件調整優先 */
export interface BuildSearchDefaults {
  /** 沒調整過的詞綴下限取原數值的幾 %（預設 80） */
  statPercent?: number;
  links?: LinkPolicy;
  /** 稀有裝（非傳奇）以基底或類別＋防禦類型搜尋 */
  rareSearch?: RareSearchMode;
  /** 防具帶入基底防禦的數值下限（依詞綴數值比例） */
  defenceMin?: boolean;
  /** 抗性、生命、能力值預設改用總和條件 */
  pseudo?: boolean;
}

/** 只留下和預設不同、而且合法的欄位 */
export function normalizeSearchDefaults(value: BuildSearchDefaults): BuildSearchDefaults {
  const { statPercent, links, rareSearch, defenceMin, pseudo } = value;
  return {
    ...(statPercent !== undefined &&
    statPercent !== DEFAULT_STAT_PERCENT &&
    STAT_PERCENT_OPTIONS.includes(statPercent)
      ? { statPercent }
      : {}),
    ...(links !== undefined && links !== DEFAULT_LINK_POLICY && LINK_POLICIES.includes(links)
      ? { links }
      : {}),
    ...(rareSearch !== undefined &&
    rareSearch !== DEFAULT_RARE_SEARCH &&
    RARE_SEARCH_MODES.includes(rareSearch)
      ? { rareSearch }
      : {}),
    ...(defenceMin === true ? { defenceMin } : {}),
    ...(pseudo === true ? { pseudo } : {}),
  };
}

const statRatioOf = (defaults?: BuildSearchDefaults): number =>
  (defaults?.statPercent ?? DEFAULT_STAT_PERCENT) / 100;

/** 介面顯示的一個條件：同一個代碼的多行已合併 */
export interface ShoppingStatFilter {
  /** 搜尋用的代碼（套用使用者切換的網域） */
  id: string;
  /** PoB 對到的原代碼，也是使用者調整的鍵 */
  key: string;
  /** 可以切換的網域前綴；只有一種時省略 */
  domains?: readonly string[];
  /** 合併後的數值；選項型與沒有數值的條件省略 */
  value?: number;
  option?: number;
  enabled: boolean;
  min?: number;
  max?: number;
  /** 使用者改過這個條件 */
  customized: boolean;
}

const INSTANT_BUYOUT_STATUS = { option: 'securable' } as const;
/** 非傳奇裝備只搜非傳奇：同基底的傳奇不會混進結果 */
const NON_UNIQUE_FILTERS = {
  type_filters: { filters: { rarity: { option: NON_UNIQUE_RARITY } } },
} as const;
const SUPPORT_SUFFIX = ' Support';
/** 異變傳奇在 PoB 的名稱多一個前綴，市集上仍是原名 */
const MUTATED_UNIQUE_PREFIX = FOULBORN_NAME;
/** 箭袋在 PoB 放在 Weapon 2，但沒有任何 `(Local)` 詞綴 */
const QUIVER_BASE = /\bQuiver$/i;
/** PoB 的永恆珠寶名稱後面接種子編號等資訊：`Lethal Pride 16137; 8; Duelist` */
const TIMELESS_NAME_SUFFIX = /\s+\d+;.*$/;
/** 基底名稱後的種類說明：`Two-Stone Ring (Cold/Lightning)`，市集上只有基底名稱 */
const BASE_VARIANT_SUFFIX = /\s*\([^)]*\)$/;
const TIMELESS_STAT = /\.pseudo_timeless_jewel_/;
const CLUSTER_JEWEL_BASE = /Cluster Jewel$/;
const MIN_BASE_NAME_LENGTH = 4;
/** 連結數到這個數量才帶入搜尋（四連以下很容易自己做） */
const MIN_SEARCHED_LINKS = 5;
/** 武器：同一句詞綴優先對到市集標 `(Local)` 的代碼 */
const WEAPON_SLOT = /^Weapon \d(?: Swap)?$/;
/** 防具：只有防禦類詞綴是 Local（攻擊速度、命中這類 Local 只有武器才有） */
const ARMOUR_SLOT = /^(Helmet|Body Armour|Gloves|Boots)$/;
const KEY_SEPARATOR = '\u0000';
/** 清單的部位順序；有編號的部位（戒指、藥劑、護符）以前綴比對，深淵插槽跟在所屬部位後面 */
const SLOT_ORDER: readonly string[] = [
  'Weapon 1',
  'Weapon 2',
  'Weapon 1 Swap',
  'Weapon 2 Swap',
  'Helmet',
  'Body Armour',
  'Gloves',
  'Boots',
  'Amulet',
  'Ring',
  'Belt',
  'Flask',
  'Charm',
  'Wickerman Head',
  'Wickerman Torso',
  'Wickerman Upper Limb',
  'Wickerman Lower Limb',
  VISCERA_BUNDLE_SLOT,
];
/** 市集的臟器分類（`viscera`） */
const VISCERA_CATEGORY = 'viscera';

/** 臟器部位（市集子分類 `viscera.head` 等） */
export type VisceraPart = 'head' | 'body' | 'arm' | 'leg';

/** 一條臟器詞綴：所在部位與它的所有交易代碼（多行詞綴有多個代碼，一定一起出現） */
export interface VisceraModCandidate {
  readonly part: VisceraPart;
  readonly statIds: readonly string[];
}

/** 依交易代碼查出含有它的臟器詞綴 */
export type VisceraModIndex = (statId: string) => readonly VisceraModCandidate[];

/** 部位 → PoB 的 Wickerman 部位名稱（排序與標籤沿用 PoB 原生部位） */
const VISCERA_PART_SLOTS: Readonly<Record<VisceraPart, string>> = {
  head: 'Wickerman Head',
  body: 'Wickerman Torso',
  arm: 'Wickerman Upper Limb',
  leg: 'Wickerman Lower Limb',
};
const VISCERA_PARTS = Object.keys(VISCERA_PART_SLOTS) as VisceraPart[];
const visceraPartOfSlot = (slot: string): VisceraPart | undefined =>
  VISCERA_PARTS.find((part) => VISCERA_PART_SLOTS[part] === slot);

/** 詞綴資料裡臟器詞綴的部位標籤 */
const VISCERA_PART_TAGS: Readonly<Record<string, VisceraPart>> = {
  viscera_head: 'head',
  viscera_body: 'body',
  viscera_arm: 'arm',
  viscera_leg: 'leg',
};
/** 窮舉組合的上限；超過時只採用已找到的組合（實際的臟器組合遠少於此） */
const MAX_VISCERA_SOLUTIONS = 64;

/**
 * 由詞綴資料建立臟器詞綴索引：`lookup` 回傳含有該代碼的所有詞綴階級（類別與代碼）。
 * 只收有部位標籤的臟器詞綴；同部位、同一組代碼的不同階級合併成一筆。
 */
export function createVisceraModIndex(
  lookup: (statId: string) =>
    | readonly {
        readonly types?: readonly string[];
        readonly id?: string;
        readonly ids?: readonly string[];
      }[]
    | null
    | undefined,
): VisceraModIndex {
  return (statId) => {
    const found = new Map<string, VisceraModCandidate>();
    for (const tier of lookup(statId) ?? []) {
      const statIds = tier.ids ?? (tier.id ? [tier.id] : []);
      if (!statIds.includes(statId)) continue;
      const parts = new Set(
        (tier.types ?? []).map((type) => VISCERA_PART_TAGS[type]).filter((part) => !!part),
      );
      for (const part of parts) {
        const key = [part, ...[...statIds].sort()].join(KEY_SEPARATOR);
        if (!found.has(key)) found.set(key, { part, statIds: [...statIds] });
      }
    }
    return [...found.values()];
  };
}

/**
 * 判斷合成臟器每一行屬於哪個部位。每件臟器只有一條詞綴（可能有多行），四個部位各一件，
 * 所以找出「每行剛好被一條詞綴涵蓋、每個部位最多用一次」的組合：
 * - 有組合時，所有組合都同意的部位才採用（例如火／冰／電三行一起出現時，是頭部那條三行詞綴，
 *   而不是手部的冰電詞綴加另一條火焰詞綴，因為手部已經被別的詞綴占用）。
 * - 沒有組合時（例如自訂詞綴不是完整的四件），逐行判斷：只出現在單一部位的詞綴才採用。
 */
export function assignVisceraParts(
  statIds: readonly (string | undefined)[],
  index: VisceraModIndex,
): (VisceraPart | undefined)[] {
  const candidatesOf = statIds.map((statId) => (statId ? index(statId) : []));
  const solutions: (VisceraPart | undefined)[][] = [];
  const assigned: (VisceraPart | undefined)[] = statIds.map(() => undefined);
  const usedParts = new Set<VisceraPart>();

  // 一條詞綴要涵蓋的行：每個代碼各取一個尚未分配的行；有代碼找不到行時這條詞綴不成立
  const linesFor = (candidate: VisceraModCandidate): number[] | undefined => {
    const lines: number[] = [];
    for (const statId of candidate.statIds) {
      const line = statIds.findIndex(
        (id, index) => id === statId && assigned[index] === undefined && !lines.includes(index),
      );
      if (line < 0) return undefined;
      lines.push(line);
    }
    return lines;
  };

  const search = (): void => {
    if (solutions.length >= MAX_VISCERA_SOLUTIONS) return;
    const next = statIds.findIndex(
      (id, index) => id !== undefined && assigned[index] === undefined,
    );
    if (next < 0) {
      solutions.push([...assigned]);
      return;
    }
    for (const candidate of candidatesOf[next]) {
      if (usedParts.has(candidate.part)) continue;
      const lines = linesFor(candidate);
      if (!lines || !lines.includes(next)) continue;
      usedParts.add(candidate.part);
      lines.forEach((line) => (assigned[line] = candidate.part));
      search();
      lines.forEach((line) => (assigned[line] = undefined));
      usedParts.delete(candidate.part);
    }
  };
  search();

  if (solutions.length > 0) {
    return statIds.map((_, line) => {
      const parts = new Set(solutions.map((solution) => solution[line]));
      return parts.size === 1 ? [...parts][0] : undefined;
    });
  }
  return candidatesOf.map((candidates) => {
    const parts = new Set(candidates.map((candidate) => candidate.part));
    return parts.size === 1 ? [...parts][0] : undefined;
  });
}

const isVisceraBundleItem = (item: PobBuildItem): boolean =>
  item.slot === VISCERA_BUNDLE_SLOT && item.name === VISCERA_BUNDLE_NAME;

/**
 * 合成的臟器項目依詞綴分到各部位：每個部位一件，分不出部位的詞綴留在合成項目。
 * 沒有詞綴對應或臟器詞綴資料時原樣保留。
 */
function splitVisceraBundle(
  item: PobBuildItem,
  matcher: StatMatcher | undefined,
  index: VisceraModIndex | undefined,
): PobBuildItem[] {
  if (!matcher || !index) return [item];
  const statIds = item.implicitMods.map(
    (mod) => matcher.match(mod.text, { preferLocal: false, domain: 'implicit' })?.statId,
  );
  const parts = assignVisceraParts(statIds, index);
  const modsOf = (part: VisceraPart | undefined) =>
    item.implicitMods.filter((_, line) => parts[line] === part);
  const split = VISCERA_PARTS.filter((part) => parts.includes(part)).map((part) => ({
    ...item,
    slot: VISCERA_PART_SLOTS[part],
    implicitMods: modsOf(part),
  }));
  const rest = modsOf(undefined);
  return rest.length > 0 ? [...split, { ...item, implicitMods: rest }] : split;
}
const NUMBERED_SLOT = /^(.+?) (\d+)$/;
const ABYSSAL_SLOT = /^(.+) Abyssal Socket (\d+)$/;
const JEWEL_SLOT = 'Jewel';
const LINK_GROUP_PREFIX = 'link:';

const PSEUDO = {
  elemental: 'pseudo.pseudo_total_elemental_resistance',
  chaos: 'pseudo.pseudo_total_chaos_resistance',
  life: 'pseudo.pseudo_total_life',
  strength: 'pseudo.pseudo_total_strength',
  dexterity: 'pseudo.pseudo_total_dexterity',
  intelligence: 'pseudo.pseudo_total_intelligence',
} as const;
const ELEMENTS = new Set(['fire', 'cold', 'lightning']);
const RESISTANCE_LINE =
  /^#% to (fire|cold|lightning|chaos)(?: and (fire|cold|lightning|chaos))? resistances?$/;
const ATTRIBUTE_LINE =
  /^# to (strength|dexterity|intelligence)(?: and (strength|dexterity|intelligence))?$/;

/** 英文詞綴對到的總和條件；同時適用 PoE 1 與 PoE 2 */
export function pseudoContributions(text: string): PseudoContribution[] | undefined {
  const skeleton = modLineSkeleton(text);
  if (skeleton === '#% to all elemental resistances') return [{ id: PSEUDO.elemental, weight: 3 }];
  if (skeleton === '# to maximum life') return [{ id: PSEUDO.life, weight: 1 }];
  if (skeleton === '# to all attributes') {
    return [PSEUDO.strength, PSEUDO.dexterity, PSEUDO.intelligence].map((id) => ({
      id,
      weight: 1,
    }));
  }
  const resistance = RESISTANCE_LINE.exec(skeleton);
  if (resistance) {
    const parts = [resistance[1], resistance[2]].filter(Boolean);
    const elemental = parts.filter((part) => ELEMENTS.has(part)).length;
    return [
      ...(elemental > 0 ? [{ id: PSEUDO.elemental, weight: elemental }] : []),
      ...(parts.includes('chaos') ? [{ id: PSEUDO.chaos, weight: 1 }] : []),
    ];
  }
  const attribute = ATTRIBUTE_LINE.exec(skeleton);
  if (attribute) {
    return [attribute[1], attribute[2]]
      .filter(Boolean)
      .map((name) => ({ id: PSEUDO[name as keyof typeof PSEUDO], weight: 1 }));
  }
  return undefined;
}

export function createTradeNameCatalog(data: {
  englishItems: readonly string[];
  /** 與 englishItems 以索引對齊；頁面是英文時省略 */
  localizedItems?: readonly string[];
}): TradeNameCatalog {
  const tradeNames = new Map<string, string>();
  data.englishItems.forEach((english, index) => {
    const tradeName = data.localizedItems ? data.localizedItems[index] : english;
    if (english && tradeName && !tradeNames.has(english)) tradeNames.set(english, tradeName);
  });
  // 長的排前面，「Amethyst Flask」才不會先對到別的短名稱
  const namesByLength = [...tradeNames.keys()]
    .filter((name) => name.length >= MIN_BASE_NAME_LENGTH)
    .sort((left, right) => right.length - left.length);

  return {
    toTradeName: (english) => tradeNames.get(english),
    findBaseType: (fullName) => namesByLength.find((name) => fullName.includes(name)),
  };
}

export async function loadTradeNameCatalog(
  loadJson: (path: string) => Promise<unknown>,
  options: { version: PoeVersion; locale: string },
): Promise<TradeNameCatalog> {
  const readItems = async (locale: string): Promise<string[]> => {
    const data = await loadJson(getLocaleItemsAssetPath(options.version, locale));
    const items =
      typeof data === 'object' && data !== null ? (data as { items?: unknown }).items : 0;
    if (!Array.isArray(items) || !items.every((entry) => typeof entry === 'string')) {
      throw new Error(`items.json (${locale}) 格式錯誤`);
    }
    return items as string[];
  };
  const englishItems = await readItems('en');
  if (options.locale === 'en') return createTradeNameCatalog({ englishItems });
  const localizedItems = await readItems(options.locale);
  // 長度不同代表兩份不是同一次建置，索引對不上
  if (localizedItems.length !== englishItems.length) throw new Error('items.json 索引無法對齊');
  return createTradeNameCatalog({ englishItems, localizedItems });
}

/**
 * 預設的數值範圍：正數取 percent%（預設八成）當下限、負數（減少、降低需求）當上限；整數無條件捨去到整數，
 * 小於 10 的非整數保留一位小數（0.5% 暴擊率不會變成「有就好」）。
 */
export function defaultStatBounds(
  value: number | undefined,
  exact = false,
  percent = DEFAULT_STAT_PERCENT,
): { min?: number; max?: number } {
  if (value === undefined || !Number.isFinite(value) || value === 0) return {};
  if (exact) return { min: value, max: value };
  const scaled = (value * percent) / 100;
  const keepDecimal = !Number.isInteger(value) && Math.abs(value) < 10;
  const factor = keepDecimal ? 10 : 1;
  const rounded =
    value > 0 ? Math.floor(scaled * factor) / factor : Math.ceil(scaled * factor) / factor;
  if (rounded === 0) return {};
  return value > 0 ? { min: rounded } : { max: rounded };
}

interface ModPlan {
  text: string;
  kind: ShoppingModKind;
  domain?: StatDomain;
  eldritch?: true;
}

function modPlans(item: PobBuildItem): ModPlan[] {
  return [
    ...item.implicitMods.map((mod) =>
      mod.crafted
        ? { text: mod.text, kind: 'enchant' as const, domain: 'enchant' as const }
        : {
            text: mod.text,
            kind: 'implicit' as const,
            domain: 'implicit' as const,
            ...(mod.eldritch ? { eldritch: true as const } : {}),
          },
    ),
    ...item.explicitMods.map((mod) =>
      mod.crafted
        ? { text: mod.text, kind: 'crafted' as const, domain: 'crafted' as const }
        : { text: mod.text, kind: 'explicit' as const, domain: 'explicit' as const },
    ),
  ];
}

function localPreferenceFor(item: PobBuildItem): LocalPreference {
  if (OFF_HAND_SLOT.test(item.slot)) {
    if (item.baseDefences?.length || item.defenceValues) return 'defence';
    if (QUIVER_BASE.test(item.baseType ?? item.name)) return false;
    return true;
  }
  if (WEAPON_SLOT.test(item.slot)) return true;
  return ARMOUR_SLOT.test(item.slot) && 'defence';
}

function itemMods(
  item: PobBuildItem,
  matcher: StatMatcher | undefined,
  options: { isUnique: boolean; isClusterJewel: boolean },
): ShoppingMod[] {
  const preferLocal = localPreferenceFor(item);
  return modPlans(item).map(({ text, kind, domain, eldritch }) => {
    // 工藝詞綴只對市集的 crafted 代碼：退回一般詞綴的代碼會和同代碼的隨機詞綴合併成一個條件
    const match = domain && matcher?.match(text, { preferLocal, domain });
    if (!match) return { text, kind, searched: false };
    const isTimeless = TIMELESS_STAT.test(match.statId);
    // 附魔的數值是固定的（星團珠寶的天賦數、插槽數），不取八成
    const exact = isTimeless || kind === 'enchant';
    // 工藝詞綴可以自己做、Eldritch 固定詞綴很難剛好對到，預設不帶入搜尋
    const defaultEnabled = options.isUnique
      ? isTimeless
      : kind === 'enchant'
        ? options.isClusterJewel
        : kind !== 'crafted' && !eldritch;
    const domains = matcher?.domainsOf?.(match.statId) ?? [];
    const pseudo = match.option === undefined && !exact ? pseudoContributions(text) : undefined;
    const stat: ShoppingStat = {
      id: match.statId,
      ...(match.value !== undefined ? { value: match.value } : {}),
      ...(match.option !== undefined ? { option: match.option } : {}),
      ...(exact ? { exact } : {}),
      defaultEnabled,
      ...(pseudo?.length ? { pseudo } : {}),
      ...(domains.length > 1 ? { domains } : {}),
    };
    return { text, kind, stat, searched: defaultEnabled };
  });
}

const sumValues = (stats: readonly ShoppingStat[]): number | undefined => {
  const values = stats.map((stat) => stat.value).filter((value) => value !== undefined);
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) : undefined;
};

const finiteOrUndefined = (value: number | null | undefined): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/** 使用者選的網域在可切換清單裡才採用；和原代碼相同時視為沒有切換 */
function validDomain(
  stat: { id: string; domains?: readonly string[] },
  domain: string | undefined,
): string | undefined {
  return domain && domain !== statDomainOf(stat.id) && stat.domains?.includes(domain)
    ? domain
    : undefined;
}

/** 同一個代碼的多行合併成一個條件（數值加總），再套用使用者的調整 */
export function entryStatFilters(
  entry: Pick<ShoppingEntry, 'mods'>,
  selection?: EntrySearchSelection,
  defaults?: BuildSearchDefaults,
): ShoppingStatFilter[] {
  const groups = new Map<string, ShoppingStat[]>();
  for (const mod of entry.mods ?? []) {
    if (mod.stat) groups.set(mod.stat.id, [...(groups.get(mod.stat.id) ?? []), mod.stat]);
  }
  const percent = defaults?.statPercent ?? DEFAULT_STAT_PERCENT;
  return [...groups.entries()].map(([key, stats]) => {
    const [first] = stats;
    const value = first.option === undefined ? sumValues(stats) : undefined;
    const bounds = defaultStatBounds(value, first.exact, percent);
    const custom = selection?.stats?.[key];
    const id = withStatDomain(key, validDomain(first, custom?.domain));
    const pick = (key: 'min' | 'max') =>
      custom && key in custom ? finiteOrUndefined(custom[key]) : bounds[key];
    const min = pick('min');
    const max = pick('max');
    return {
      id,
      key,
      ...(first.domains ? { domains: first.domains } : {}),
      ...(value !== undefined ? { value } : {}),
      ...(first.option !== undefined ? { option: first.option } : {}),
      enabled: custom?.enabled ?? first.defaultEnabled,
      ...(min !== undefined ? { min } : {}),
      ...(max !== undefined ? { max } : {}),
      customized: custom !== undefined,
    };
  });
}

interface QueryStatFilter {
  id: string;
  value?: { min?: number; max?: number; option?: number };
}

function toQueryFilter(filter: {
  id: string;
  option?: number;
  min?: number;
  max?: number;
}): QueryStatFilter {
  const value = {
    ...(filter.option !== undefined ? { option: filter.option } : {}),
    ...(filter.min !== undefined ? { min: filter.min } : {}),
    ...(filter.max !== undefined ? { max: filter.max } : {}),
  };
  return { id: filter.id, ...(Object.keys(value).length > 0 ? { value } : {}) };
}

const IMPLICIT_PREFIX = 'implicit.';
const ENCHANT_PREFIX = 'enchant.';

/**
 * 「至少符合 N 項」時仍必須符合的條件：固定詞綴與附魔決定基底的種類（雙玉戒指的抗性、
 * 星團珠寶的天賦數），只有一般詞綴參與 N 項的計算。
 */
export const isRequiredInCountMode = (statId: string): boolean =>
  statId.startsWith(IMPLICIT_PREFIX) || statId.startsWith(ENCHANT_PREFIX);

/** 總和條件：勾選的抗性、生命、能力值換成總和，下限同樣依整體設定的比例 */
function mergeIntoPseudo(
  filters: readonly ShoppingStatFilter[],
  mods: readonly ShoppingMod[],
  ratio: number,
): QueryStatFilter[] {
  const pseudoOf = new Map<string, readonly PseudoContribution[]>();
  for (const mod of mods) if (mod.stat?.pseudo) pseudoOf.set(mod.stat.id, mod.stat.pseudo);
  const totals = new Map<string, number>();
  const rest: QueryStatFilter[] = [];
  for (const filter of filters) {
    const contributions = pseudoOf.get(filter.key);
    if (!contributions || filter.value === undefined) {
      rest.push(toQueryFilter(filter));
      continue;
    }
    // 使用者調整過的那一行以他填的界限計入（正數看下限、負數看上限，清空視為 0），否則依比例
    const customBound = filter.value < 0 ? filter.max : filter.min;
    const lineMinimum = filter.customized ? (customBound ?? 0) : filter.value * ratio;
    for (const { id, weight } of contributions) {
      totals.set(id, (totals.get(id) ?? 0) + lineMinimum * weight);
    }
    // 固定詞綴決定基底的種類（雙玉戒指是哪兩種抗性）；使用者切換過網域（例如改成破裂）的那一行
    // 也是明確要求。兩者都保留成獨立條件，數值仍計入總和
    if (filter.id.startsWith(IMPLICIT_PREFIX) || filter.id !== filter.key) {
      rest.push(toQueryFilter(filter));
    }
  }
  const pseudo = [...totals.entries()].map(([id, total]) => {
    // 先四捨五入到 1e-6 消掉浮點誤差（120 × 0.8 = 96.00000000000001），再往 0 的方向取整
    const settled = Math.round(total * 1e6) / 1e6;
    const bound =
      settled > 0 ? { min: Math.floor(settled) } : settled < 0 ? { max: Math.ceil(settled) } : {};
    return toQueryFilter({ id, ...bound });
  });
  return [...pseudo, ...rest];
}

/** 臟器合成項目預設「至少符合 1 項」 */
export const VISCERA_BUNDLE_COUNT_MIN = 1;

/** 實際套用的「至少符合 N 項」：使用者沒設定時，臟器合成項目用預設值，其餘為全部符合 */
export function effectiveCountMin(
  entry: Pick<ShoppingEntry, 'visceraBundle'>,
  selection?: EntrySearchSelection,
): number | undefined {
  return selection?.countMin ?? (entry.visceraBundle ? VISCERA_BUNDLE_COUNT_MIN : undefined);
}

/**
 * 實際帶入搜尋的連結數下限：單件設定優先（null 為不限），否則依 build 的連結條件；
 * 項目本身沒有五連以上時，只有單件明確指定才帶入。
 */
export function effectiveLinks(
  entry: Pick<ShoppingEntry, 'links'>,
  selection?: EntrySearchSelection,
  defaults?: BuildSearchDefaults,
): number | undefined {
  if (selection && 'links' in selection) return selection.links ?? undefined;
  if (entry.links === undefined) return undefined;
  const policy = defaults?.links ?? DEFAULT_LINK_POLICY;
  if (policy === 'none') return undefined;
  if (policy === 'six') return entry.links >= 6 ? 6 : undefined;
  return entry.links;
}

/** 實際的搜尋方式：單件設定優先，否則依 build 整體設定；項目沒有類別時一律以基底搜尋 */
export function effectiveSearchBy(
  entry: Pick<ShoppingEntry, 'category'>,
  selection?: EntrySearchSelection,
  defaults?: BuildSearchDefaults,
): RareSearchMode {
  if (!entry.category) return 'base';
  return selection?.searchBy ?? defaults?.rareSearch ?? DEFAULT_RARE_SEARCH;
}

/** 把連結條件併進既有的 filters（臟器的分類條件等），不覆蓋其他區塊 */
function withLinks(
  base: Record<string, unknown>,
  links: number | undefined,
): Record<string, unknown> {
  if (links === undefined) return base;
  const filters = (base.filters ?? {}) as Record<string, unknown>;
  return {
    ...base,
    filters: {
      ...filters,
      socket_filters: { filters: { links: { min: links } } },
    },
  };
}

/**
 * 是否改用總和條件：單件設定優先，否則依 build 整體設定；臟器項目的詞綴分屬不同件，
 * 只有單件明確開啟才合併
 */
export function effectivePseudo(
  entry: Pick<ShoppingEntry, 'visceraBundle' | 'visceraPart'>,
  selection?: EntrySearchSelection,
  defaults?: BuildSearchDefaults,
): boolean {
  if (selection && typeof selection.pseudo === 'boolean') return selection.pseudo;
  if (entry.visceraBundle || entry.visceraPart) return false;
  return defaults?.pseudo === true;
}

/** 把防禦數值下限併進防禦條件區塊；類別搜尋已有的「至少 1」改成實際下限 */
function withDefenceMins(
  base: Record<string, unknown>,
  defences: EntryDefences | undefined,
  defaults: BuildSearchDefaults | undefined,
): Record<string, unknown> {
  if (!defences || defaults?.defenceMin !== true) return base;
  const percent = defaults.statPercent ?? DEFAULT_STAT_PERCENT;
  const mins = Object.entries(defences.values).flatMap(([defence, value]) => {
    const { min } = defaultStatBounds(value, false, percent);
    return min !== undefined ? [[defence, { min }] as const] : [];
  });
  if (mins.length === 0) return base;
  const filters = (base.filters ?? {}) as Record<string, { filters?: Record<string, unknown> }>;
  const section = filters[defences.section]?.filters ?? {};
  return {
    ...base,
    filters: {
      ...filters,
      [defences.section]: { filters: { ...section, ...Object.fromEntries(mins) } },
    },
  };
}

/** 寶石品質在市集 query 裡的區塊：PoE 1 是雜項過濾，PoE 2 是類型過濾 */
export type GemQualitySection = 'misc_filters' | 'type_filters';

type GemFilterEntry = Pick<
  ShoppingEntry,
  'kind' | 'level' | 'quality' | 'gemSockets' | 'gemQualitySection'
>;

/** 寶石實際帶入搜尋的等級／品質下限（使用者的調整優先，否則用 PoB 的數值）；不限的欄位省略 */
export function effectiveGemFilters(
  entry: GemFilterEntry,
  selection?: EntrySearchSelection,
): GemFilters {
  if (entry.kind !== 'gem') return {};
  const pick = (custom: number | null | undefined, hasCustom: boolean, pob: number | undefined) => {
    const value = hasCustom ? custom : pob;
    return typeof value === 'number' && value > 0 ? value : undefined;
  };
  const level = pick(
    selection?.gemLevel,
    selection !== undefined && 'gemLevel' in selection,
    entry.level !== undefined && entry.level > 1 ? entry.level : undefined,
  );
  const quality = pick(
    selection?.gemQuality,
    selection !== undefined && 'gemQuality' in selection,
    entry.quality,
  );
  const sockets = pick(
    selection?.gemSockets,
    selection !== undefined && 'gemSockets' in selection,
    entry.gemSockets,
  );
  return {
    ...(level !== undefined ? { level } : {}),
    ...(quality !== undefined ? { quality } : {}),
    ...(sockets !== undefined ? { sockets } : {}),
  };
}

/** 寶石實際帶入搜尋的下限；不限的欄位省略 */
export interface GemFilters {
  level?: number;
  quality?: number;
  /** PoE 2 寶石的輔助寶石插槽數 */
  sockets?: number;
}

/** 換掉寶石搜尋的等級、品質與插槽數條件（其他條件保留） */
function withGemFilters(
  searchBase: Record<string, unknown>,
  gem: GemFilters,
  qualitySection: GemQualitySection = 'misc_filters',
): Record<string, unknown> {
  const { filters, ...rest } = searchBase as { filters?: Record<string, any> };
  const { misc_filters: misc, type_filters: typeGroup, ...otherGroups } = filters ?? {};
  const {
    gem_level: _level,
    quality: _miscQuality,
    gem_sockets: _sockets,
    ...otherMisc
  } = misc?.filters ?? {};
  const miscFilters = {
    ...otherMisc,
    ...gemMiscFilters(gem, qualitySection),
  };
  let nextTypeGroup = typeGroup;
  if (qualitySection === 'type_filters') {
    const { quality: _typeQuality, ...otherType } = typeGroup?.filters ?? {};
    const typeFilters = {
      ...otherType,
      ...(gem.quality !== undefined ? { quality: { min: gem.quality } } : {}),
    };
    nextTypeGroup =
      Object.keys(typeFilters).length > 0 ? { ...typeGroup, filters: typeFilters } : undefined;
  }
  const groups = {
    ...otherGroups,
    ...(nextTypeGroup ? { type_filters: nextTypeGroup } : {}),
    ...(Object.keys(miscFilters).length > 0
      ? { misc_filters: { ...misc, filters: miscFilters } }
      : {}),
  };
  return Object.keys(groups).length > 0 ? { ...rest, filters: groups } : rest;
}

/** 寶石條件 → 市集的雜項條件 */
function gemMiscFilters(
  gem: GemFilters,
  qualitySection: GemQualitySection = 'misc_filters',
): Record<string, { min: number }> {
  return {
    ...(gem.level !== undefined ? { gem_level: { min: gem.level } } : {}),
    ...(qualitySection === 'misc_filters' && gem.quality !== undefined
      ? { quality: { min: gem.quality } }
      : {}),
    ...(gem.sockets !== undefined ? { gem_sockets: { min: gem.sockets } } : {}),
  };
}

/** 套用使用者的選擇與 build 整體設定組出搜尋；項目無法搜尋時回傳 null */
export function buildEntryQuery(
  entry: Pick<
    ShoppingEntry,
    'mods' | 'searchBase' | 'visceraBundle' | 'visceraPart' | 'links' | 'category' | 'defences'
  > &
    Partial<GemFilterEntry>,
  selection?: EntrySearchSelection,
  defaults?: BuildSearchDefaults,
): Record<string, unknown> | null {
  if (entry.kind === 'gem') {
    return entry.searchBase
      ? withGemFilters(
          entry.searchBase,
          effectiveGemFilters(entry as GemFilterEntry, selection),
          entry.gemQualitySection,
        )
      : null;
  }
  // 類別搜尋不需要基底名稱，對不到市集基底名稱的項目也能搜
  const searchBase =
    entry.category && effectiveSearchBy(entry, selection, defaults) === 'category'
      ? categorySearchBase(entry.category, INSTANT_BUYOUT_STATUS)
      : entry.searchBase;
  if (!searchBase) return null;
  const base = withDefenceMins(
    withLinks(searchBase, effectiveLinks(entry, selection, defaults)),
    entry.defences,
    defaults,
  );
  const enabled = entryStatFilters(entry, selection, defaults).filter((filter) => filter.enabled);
  const filters = effectivePseudo(entry, selection, defaults)
    ? mergeIntoPseudo(enabled, entry.mods ?? [], statRatioOf(defaults))
    : enabled.map(toQueryFilter);
  if (filters.length === 0) return base;
  const countMin = effectiveCountMin(entry, selection);
  if (countMin === undefined || !Number.isInteger(countMin) || countMin < 1) {
    return { ...base, stats: [{ type: 'and', filters }] };
  }
  // 臟器合成項目的固定詞綴分屬不同件，不能全部強制符合
  const isRequired = (id: string) => !entry.visceraBundle && isRequiredInCountMode(id);
  const required = filters.filter((filter) => isRequired(filter.id));
  const countable = filters.filter((filter) => !isRequired(filter.id));
  const groups = [
    ...(required.length > 0 ? [{ type: 'and', filters: required }] : []),
    ...(countable.length > 0
      ? [
          {
            type: 'count',
            value: { min: Math.min(countMin, countable.length) },
            filters: countable,
          },
        ]
      : []),
  ];
  return { ...base, stats: groups };
}

/** 套用使用者的選擇：更新每一行是否帶入搜尋與實際的搜尋條件 */
export function applyEntrySelection(
  entry: ShoppingEntry,
  selection?: EntrySearchSelection,
  defaults?: BuildSearchDefaults,
): ShoppingEntry {
  const hasDefaults = defaults !== undefined && Object.keys(defaults).length > 0;
  if (!selection && !hasDefaults) return entry;
  const enabled = new Set(
    entryStatFilters(entry, selection, defaults)
      .filter((filter) => filter.enabled)
      .map((filter) => filter.key),
  );
  return {
    ...entry,
    ...(entry.mods
      ? {
          mods: entry.mods.map((mod) => ({
            ...mod,
            searched: mod.stat ? enabled.has(mod.stat.id) : false,
          })),
        }
      : {}),
    query: buildEntryQuery(entry, selection, defaults),
  };
}

export interface SelectionRowSnapshot
  extends
    Pick<
      ShoppingEntry,
      'mods' | 'searchBase' | 'visceraBundle' | 'visceraPart' | 'links' | 'category'
    >,
    Partial<GemFilterEntry> {
  filters?: readonly ShoppingStatFilter[];
  countMin?: number;
  pseudo?: boolean;
  /** 實際帶入搜尋的連結數下限 */
  linksMin?: number;
  /** 實際的搜尋方式 */
  searchBy?: RareSearchMode;
  /** 寶石實際帶入的等級／品質下限 */
  gemLevelMin?: number;
  gemQualityMin?: number;
  gemSocketsMin?: number;
  searchSelection?: EntrySearchSelection;
}

/** 深拷貝使用者的項目搜尋調整草稿，避免改動到已儲存的狀態。 */
export function cloneEntrySearchSelection(selection?: EntrySearchSelection): EntrySearchSelection {
  if (!selection) return {};
  const stats = selection.stats
    ? Object.fromEntries(
        Object.entries(selection.stats).map(([id, value]) => [id, { ...value }] as const),
      )
    : undefined;
  return {
    ...(stats && Object.keys(stats).length > 0 ? { stats } : {}),
    ...(selection.countMin !== undefined ? { countMin: selection.countMin } : {}),
    ...(typeof selection.pseudo === 'boolean' ? { pseudo: selection.pseudo } : {}),
    ...('links' in selection ? { links: selection.links ?? null } : {}),
    ...(selection.searchBy ? { searchBy: selection.searchBy } : {}),
    ...('gemLevel' in selection ? { gemLevel: selection.gemLevel ?? null } : {}),
    ...('gemQuality' in selection ? { gemQuality: selection.gemQuality ?? null } : {}),
    ...('gemSockets' in selection ? { gemSockets: selection.gemSockets ?? null } : {}),
  };
}

/** 從購物列目前狀態建立可編輯草稿（優先採用已儲存的 searchSelection，缺乏時由 filters 推導）。 */
export function selectionFromRowState(
  row: SelectionRowSnapshot,
  searchDefaults?: BuildSearchDefaults,
): EntrySearchSelection {
  if (row.searchSelection) return cloneEntrySearchSelection(row.searchSelection);
  const defaults = entryStatFilters(row, undefined, searchDefaults);
  const stats: Record<string, StatSelection> = {};
  row.filters?.forEach((filter, index) => {
    const base = defaults[index];
    if (!base) return;
    const change: StatSelection = {};
    if (filter.enabled !== base.enabled) change.enabled = filter.enabled;
    if (filter.id !== base.id) change.domain = statDomainOf(filter.id);
    if (filter.min !== base.min) change.min = filter.min ?? null;
    if (filter.max !== base.max) change.max = filter.max ?? null;
    if (Object.keys(change).length > 0) stats[base.key] = change;
  });
  const defaultLinks = effectiveLinks(row, undefined, searchDefaults);
  const defaultSearchBy = effectiveSearchBy(row, undefined, searchDefaults);
  const defaultGem = row.kind === 'gem' ? effectiveGemFilters(row as GemFilterEntry) : undefined;
  return {
    ...(Object.keys(stats).length > 0 ? { stats } : {}),
    ...(row.countMin !== undefined ? { countMin: row.countMin } : {}),
    ...(Boolean(row.pseudo) !== effectivePseudo(row, undefined, searchDefaults)
      ? { pseudo: Boolean(row.pseudo) }
      : {}),
    ...((row.links !== undefined || row.linksMin !== undefined) && row.linksMin !== defaultLinks
      ? { links: row.linksMin ?? null }
      : {}),
    ...(row.searchBy && row.searchBy !== defaultSearchBy ? { searchBy: row.searchBy } : {}),
    ...(defaultGem && row.gemLevelMin !== defaultGem.level
      ? { gemLevel: row.gemLevelMin ?? null }
      : {}),
    ...(defaultGem && row.gemQualityMin !== defaultGem.quality
      ? { gemQuality: row.gemQualityMin ?? null }
      : {}),
    ...(defaultGem && row.gemSocketsMin !== defaultGem.sockets
      ? { gemSockets: row.gemSocketsMin ?? null }
      : {}),
  };
}

/** 僅保留相對於預設值（PoB 加上 build 整體設定）有差異的欄位；全部回到預設時回傳 undefined。 */
export function normalizeSelectionForEntry(
  entry: Pick<ShoppingEntry, 'mods' | 'visceraBundle' | 'visceraPart' | 'links' | 'category'> &
    Partial<GemFilterEntry>,
  selection: EntrySearchSelection | undefined,
  searchDefaults?: BuildSearchDefaults,
): EntrySearchSelection | undefined {
  if (!selection) return undefined;
  const defaults = new Map(
    entryStatFilters(entry, undefined, searchDefaults).map((filter) => [filter.key, filter]),
  );
  const stats: Record<string, StatSelection> = {};
  for (const [id, custom] of Object.entries(selection.stats ?? {})) {
    const base = defaults.get(id);
    if (!base) continue;
    const change: StatSelection = {};
    if (custom.enabled !== undefined && custom.enabled !== base.enabled) {
      change.enabled = custom.enabled;
    }
    const domain = validDomain({ id: base.key, domains: base.domains }, custom.domain);
    if (domain) change.domain = domain;
    if ('min' in custom) {
      const nextMin = finiteOrUndefined(custom.min);
      if (nextMin !== base.min) change.min = nextMin ?? null;
    }
    if ('max' in custom) {
      const nextMax = finiteOrUndefined(custom.max);
      if (nextMax !== base.max) change.max = nextMax ?? null;
    }
    if (Object.keys(change).length > 0) stats[id] = change;
  }
  const normalized: EntrySearchSelection = {
    ...(Object.keys(stats).length > 0 ? { stats } : {}),
    // 等於項目本身的預設（臟器合成項目預設至少符合 1 項）時不算自訂
    ...(selection.countMin !== undefined &&
    Number.isInteger(selection.countMin) &&
    selection.countMin >= 1 &&
    selection.countMin !== effectiveCountMin(entry)
      ? { countMin: selection.countMin }
      : {}),
    // 等於 build 預設（或臟器項目的預設不合併）時不算自訂
    ...(typeof selection.pseudo === 'boolean' &&
    selection.pseudo !== effectivePseudo(entry, undefined, searchDefaults)
      ? { pseudo: selection.pseudo }
      : {}),
    ...('links' in selection &&
    effectiveLinks(entry, selection, searchDefaults) !==
      effectiveLinks(entry, undefined, searchDefaults)
      ? { links: selection.links ?? null }
      : {}),
    ...(selection.searchBy &&
    RARE_SEARCH_MODES.includes(selection.searchBy) &&
    effectiveSearchBy(entry, selection, searchDefaults) !==
      effectiveSearchBy(entry, undefined, searchDefaults)
      ? { searchBy: selection.searchBy }
      : {}),
    ...gemSelectionChanges(entry, selection),
  };
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

/** 寶石的等級／品質調整：和 PoB 的數值相同時不算自訂 */
function gemSelectionChanges(
  entry: Partial<GemFilterEntry>,
  selection: EntrySearchSelection,
): Pick<EntrySearchSelection, 'gemLevel' | 'gemQuality' | 'gemSockets'> {
  if (entry.kind !== 'gem') return {};
  const gemEntry = entry as GemFilterEntry;
  const pob = effectiveGemFilters(gemEntry);
  const chosen = effectiveGemFilters(gemEntry, selection);
  return {
    ...('gemLevel' in selection && chosen.level !== pob.level
      ? { gemLevel: chosen.level ?? null }
      : {}),
    ...('gemQuality' in selection && chosen.quality !== pob.quality
      ? { gemQuality: chosen.quality ?? null }
      : {}),
    ...('gemSockets' in selection && chosen.sockets !== pob.sockets
      ? { gemSockets: chosen.sockets ?? null }
      : {}),
  };
}

/** 比較兩個搜尋條件快照，判斷暫存微調是否與已儲存狀態不同。 */
type DraftSnapshot = Pick<
  SelectionRowSnapshot,
  | 'filters'
  | 'countMin'
  | 'pseudo'
  | 'linksMin'
  | 'searchBy'
  | 'gemLevelMin'
  | 'gemQualityMin'
  | 'gemSocketsMin'
>;

export function isSelectionDraftModified(saved: DraftSnapshot, draft: DraftSnapshot): boolean {
  if (saved.gemLevelMin !== draft.gemLevelMin) return true;
  if (saved.gemQualityMin !== draft.gemQualityMin) return true;
  if (saved.gemSocketsMin !== draft.gemSocketsMin) return true;
  if (Boolean(saved.pseudo) !== Boolean(draft.pseudo)) return true;
  if ((saved.searchBy ?? 'base') !== (draft.searchBy ?? 'base')) return true;
  if (saved.linksMin !== draft.linksMin) return true;
  if (saved.countMin !== draft.countMin) return true;
  const left = saved.filters ?? [];
  const right = draft.filters ?? [];
  if (left.length !== right.length) return true;
  return left.some((filter, index) => {
    const target = right[index];
    return (
      !target ||
      filter.id !== target.id ||
      filter.enabled !== target.enabled ||
      filter.min !== target.min ||
      filter.max !== target.max
    );
  });
}

/**
 * 裝備的連結數與外觀：五連以上才記下連結數（四連以下很容易自己做）；插槽、內容物、
 * 汙染與穢生給介面顯示
 */
function itemTraitsOf(
  item: PobBuildItem,
): Pick<ShoppingEntry, 'links' | 'sockets' | 'socketed' | 'corrupted' | 'foulborn'> {
  return {
    ...(item.maxLinks && item.maxLinks >= MIN_SEARCHED_LINKS ? { links: item.maxLinks } : {}),
    ...(item.sockets ? { sockets: item.sockets } : {}),
    ...(item.socketed ? { socketed: [...item.socketed] } : {}),
    ...(item.corrupted ? { corrupted: true as const } : {}),
    ...(item.foulborn ? { foulborn: true as const } : {}),
  };
}

/** 對不到市集名稱時，去掉種類說明再試一次（`Two-Stone Ring (Cold/Lightning)`） */
function resolveBase(
  englishBase: string | undefined,
  catalog: TradeNameCatalog,
): { english?: string; trade?: string } {
  if (!englishBase) return {};
  const direct = catalog.toTradeName(englishBase);
  if (direct) return { english: englishBase, trade: direct };
  const stripped = englishBase.replace(BASE_VARIANT_SUFFIX, '');
  const trade = stripped !== englishBase ? catalog.toTradeName(stripped) : undefined;
  return trade ? { english: stripped, trade } : { english: englishBase };
}

function itemEntry(
  item: PobBuildItem,
  catalog: TradeNameCatalog,
  matcher: StatMatcher | undefined,
  version: PoeVersion,
): ShoppingEntry {
  const isUnique = item.rarity === 'UNIQUE' || item.rarity === 'RELIC';
  const base = resolveBase(item.baseType ?? catalog.findBaseType(item.name), catalog);
  const key = ['item', item.slot, item.rarity, item.name, item.baseType ?? ''].join(KEY_SEPARATOR);
  const mods = itemMods(item, matcher, {
    isUnique,
    isClusterJewel: CLUSTER_JEWEL_BASE.test(base.english ?? ''),
  });
  const finish = (entry: Omit<ShoppingEntry, 'query' | 'count' | 'mods'>): ShoppingEntry => {
    const full = { ...entry, count: 1, mods };
    return { ...full, query: buildEntryQuery(full) };
  };

  const visceraPart = item.name === VISCERA_BUNDLE_NAME ? visceraPartOfSlot(item.slot) : undefined;
  if (visceraPart) {
    return finish({
      key,
      kind: 'equipment',
      label: VISCERA_BUNDLE_NAME,
      englishName: VISCERA_BUNDLE_NAME,
      slot: item.slot,
      rarity: item.rarity,
      visceraPart,
      searchBase: {
        status: INSTANT_BUYOUT_STATUS,
        filters: {
          type_filters: {
            filters: { category: { option: `${VISCERA_CATEGORY}.${visceraPart}` } },
          },
        },
      },
    });
  }
  if (isVisceraBundleItem(item)) {
    return finish({
      key,
      kind: 'equipment',
      label: VISCERA_BUNDLE_NAME,
      englishName: VISCERA_BUNDLE_NAME,
      slot: item.slot,
      rarity: item.rarity,
      visceraBundle: true,
      searchBase: {
        status: INSTANT_BUYOUT_STATUS,
        filters: { type_filters: { filters: { category: { option: VISCERA_CATEGORY } } } },
      },
    });
  }
  if (!isUnique) {
    const category = categoryOfItem(item, version);
    const defences = defencesOfItem(item, version);
    return finish({
      key,
      kind: 'equipment',
      label: base.trade ?? base.english ?? item.name,
      englishName: base.english ?? item.name,
      slot: item.slot,
      rarity: item.rarity,
      searchBase: base.trade
        ? { status: INSTANT_BUYOUT_STATUS, type: base.trade, filters: NON_UNIQUE_FILTERS }
        : null,
      ...itemTraitsOf(item),
      ...(category ? { category } : {}),
      ...(defences ? { defences } : {}),
    });
  }
  const seed = TIMELESS_NAME_SUFFIX.test(item.name)
    ? mods.find((mod) => mod.stat && TIMELESS_STAT.test(mod.stat.id))?.stat?.value
    : undefined;
  const englishName = item.name
    .replace(MUTATED_UNIQUE_PREFIX, '')
    .replace(TIMELESS_NAME_SUFFIX, '');
  const tradeName = catalog.toTradeName(englishName);
  return finish({
    key,
    kind: 'unique',
    label: tradeName ?? item.name,
    englishName,
    ...(seed !== undefined ? { suffix: String(seed) } : {}),
    slot: item.slot,
    rarity: item.rarity,
    ...(base.english ? { artBase: base.english } : {}),
    searchBase: tradeName
      ? {
          status: INSTANT_BUYOUT_STATUS,
          name: tradeName,
          ...(base.trade ? { type: base.trade } : {}),
        }
      : null,
    ...itemTraitsOf(item),
  });
}

/**
 * 部位的排序值：主手 → 副手 → 頭部 → 胸甲 → 手套 → 鞋子 → 項鍊 → 戒指 → 腰帶 → 藥劑 → 護符，
 * 認不得的部位接在後面，天賦樹珠寶最後。
 */
export function slotRank(slot: string): number {
  const abyssal = ABYSSAL_SLOT.exec(slot);
  if (abyssal) return slotRank(abyssal[1]) + 0.5 + Math.min(Number(abyssal[2]), 99) / 1000;
  if (slot === JEWEL_SLOT) return SLOT_ORDER.length + 1;
  const exact = SLOT_ORDER.indexOf(slot);
  if (exact >= 0) return exact;
  const numbered = NUMBERED_SLOT.exec(slot);
  const prefix = numbered ? SLOT_ORDER.indexOf(numbered[1]) : -1;
  if (numbered && prefix >= 0) return prefix + Math.min(Number(numbered[2]), 99) / 1000;
  return SLOT_ORDER.length;
}

const gemGroupOf = (gem: PobBuildGem): ShoppingGemGroup =>
  gem.slot
    ? { id: gem.slot, slot: gem.slot }
    : { id: `${LINK_GROUP_PREFIX}${gem.skill}`, skill: gem.skill };

/** 寶石在購物清單裡的 key（同分組、同等級品質的寶石合併成一列） */
export const gemKey = (gem: PobBuildGem): string =>
  ['gem', gemGroupOf(gem).id, gem.name, gem.level, gem.quality].join(KEY_SEPARATOR);

/** 寶石分組前的 key（不含分組），舊版存下的進度用這個格式 */
const legacyGemKey = (gem: PobBuildGem): string =>
  ['gem', gem.name, gem.level, gem.quality].join(KEY_SEPARATOR);

/**
 * 把舊版（寶石不分組）存下的 key 換成新格式：同一顆寶石在幾個分組出現，就換成幾個 key。
 * 不是舊格式的 key 原樣保留。
 */
export function migrateLegacyGemKeys(build: PobBuild, keys: readonly string[]): string[] {
  const replacements = new Map<string, Set<string>>();
  for (const gem of build.skillSets.flatMap((set) => set.gems)) {
    const legacy = legacyGemKey(gem);
    replacements.set(legacy, new Set([...(replacements.get(legacy) ?? []), gemKey(gem)]));
  }
  return [...new Set(keys.flatMap((key) => [...(replacements.get(key) ?? [key])]))];
}

function gemEntry(
  gem: PobBuildGem,
  catalog: TradeNameCatalog,
  version: PoeVersion = 'poe1',
): ShoppingEntry {
  // PoB 的輔助寶石名稱不含「Support」，市集上有
  const supportName = `${gem.name}${SUPPORT_SUFFIX}`;
  const englishName = gem.support && catalog.toTradeName(supportName) ? supportName : gem.name;
  const tradeName = catalog.toTradeName(englishName);
  const qualitySection: GemQualitySection = version === 'poe2' ? 'type_filters' : 'misc_filters';
  const gemFilters: GemFilters = {
    ...(gem.level > 1 ? { level: gem.level } : {}),
    ...(gem.quality > 0 ? { quality: gem.quality } : {}),
    ...(gem.sockets ? { sockets: gem.sockets } : {}),
  };
  const searchBase = tradeName
    ? withGemFilters({ status: INSTANT_BUYOUT_STATUS, type: tradeName }, gemFilters, qualitySection)
    : null;
  return {
    key: gemKey(gem),
    kind: 'gem',
    gemGroup: gemGroupOf(gem),
    label: tradeName ?? gem.name,
    englishName,
    count: 1,
    level: gem.level,
    quality: gem.quality,
    ...(gem.sockets !== undefined ? { gemSockets: gem.sockets } : {}),
    ...(qualitySection === 'type_filters' ? { gemQualitySection: qualitySection } : {}),
    searchBase,
    query: searchBase,
  };
}

/**
 * 珠寶插在天賦樹上，不屬於裝備套裝。沿用 PoB 配置組合的慣例：與裝備套裝同標題的天賦樹
 * 就是同一個階段；沒有同標題的就用匯出當下選用的那一份。
 */
function jewelsFor(build: PobBuild, itemSet: PobItemSet | undefined): PobBuildItem[] {
  const sameTitle = itemSet?.title
    ? build.treeSpecs.find((spec) => spec.title === itemSet.title)
    : undefined;
  const spec = sameTitle ?? build.treeSpecs.find((entry) => entry.id === build.activeTreeSpecId);
  return spec?.jewels ?? [];
}

export function buildShoppingList(
  build: PobBuild,
  catalog: TradeNameCatalog,
  selection: ShoppingSelection = {},
  matcher?: StatMatcher,
  options: { visceraMods?: VisceraModIndex } = {},
): ShoppingEntry[] {
  const pick = <T extends { id: string }>(
    sets: readonly T[],
    wanted: string | undefined,
    active: string,
  ) => sets.find((set) => set.id === wanted) ?? sets.find((set) => set.id === active);
  const itemSet = pick(build.itemSets, selection.itemSetId, build.activeItemSetId);
  const skillSet = pick(build.skillSets, selection.skillSetId, build.activeSkillSetId);

  const items = [...(itemSet?.items ?? []), ...jewelsFor(build, itemSet)]
    .flatMap((item) =>
      isVisceraBundleItem(item) ? splitVisceraBundle(item, matcher, options.visceraMods) : [item],
    )
    .map((item) => itemEntry(item, catalog, matcher, build.gameVersion));
  const gems = (skillSet?.gems ?? []).map((gem) => gemEntry(gem, catalog, build.gameVersion));
  // 同一套裡內容完全相同的項目（例如兩顆一樣的珠寶）共用一個 key，合併成一列並計數
  const merged = new Map<string, ShoppingEntry>();
  for (const entry of [...items, ...gems]) {
    const existing = merged.get(entry.key);
    merged.set(entry.key, existing ? { ...existing, count: existing.count + 1 } : entry);
  }
  // 裝備依部位排序（傳奇與其他裝備不再分開）；寶石依分組的部位排序，沒有部位的連線在最後，
  // 分組內維持 PoB 的順序。sort 是穩定排序，同部位維持原本的先後
  const entries = [...merged.values()];
  const equipment = entries
    .filter((entry) => entry.kind !== 'gem')
    .sort((left, right) => slotRank(left.slot ?? '') - slotRank(right.slot ?? ''));
  const gemEntries = entries.filter((entry) => entry.kind === 'gem');
  const groupOrder = [...new Set(gemEntries.map((entry) => entry.gemGroup?.id))];
  const groupRank = (entry: ShoppingEntry) =>
    entry.gemGroup?.slot ? slotRank(entry.gemGroup.slot) : Number.MAX_SAFE_INTEGER;
  const sortedGems = [...gemEntries].sort(
    (left, right) =>
      groupRank(left) - groupRank(right) ||
      groupOrder.indexOf(left.gemGroup?.id) - groupOrder.indexOf(right.gemGroup?.id),
  );
  return [...equipment, ...sortedGems];
}

const searchPath = (version: PoeVersion, league: string): string => {
  const profile = tradeVersionProfiles[version];
  return [profile.routeRoot, 'search', profile.searchVersionSegment, league]
    .filter((segment): segment is string => Boolean(segment))
    .map(encodeURIComponent)
    .join('/');
};

/** 官方市集支援以 `?q=` 帶入查詢條件，開啟後由官網自己執行搜尋（含價格排序） */
export function buildTradeSearchUrl(options: {
  origin: string;
  version: PoeVersion;
  league: string;
  query: Record<string, unknown>;
}): string {
  const payload = JSON.stringify({ query: options.query, sort: { price: 'asc' } });
  return `${options.origin}/${searchPath(options.version, options.league)}?q=${encodeURIComponent(payload)}`;
}

/**
 * 以搜尋代碼組成的固定網址（`…/search/<聯盟>/<代碼>`）。線上搜尋主控台與書籤需要這種網址，
 * 代碼由呼叫端產生（市集 query 的 gzip，或使用者存下的代碼）。
 */
export function buildTradeCodeUrl(options: {
  origin: string;
  version: PoeVersion;
  league: string;
  code: string;
}): string {
  return `${options.origin}/${searchPath(options.version, options.league)}/${encodeURIComponent(options.code)}`;
}
