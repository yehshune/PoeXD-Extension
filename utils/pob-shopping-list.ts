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
 * 單筆條目的條件解析、草稿微調與市集 query 組裝由 `pob-entry-search` 模組負責。
 *
 * PoB 的名稱是英文；市集搜尋要用頁面所在伺服器的名稱，由 `TradeNameCatalog` 轉換。對不到
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
  defencesOfItem,
  NON_UNIQUE_RARITY,
  OFF_HAND_SLOT,
  resolveEntrySearch,
  type EntryCategory,
  type EntryDefences,
  type GemQualitySection,
  type PseudoContribution,
  type ShoppingEntryKind,
  type ShoppingMod,
  type ShoppingModKind,
  type ShoppingStat,
} from './pob-entry-search';
import {
  modLineSkeleton,
  type LocalPreference,
  type StatDomain,
  type StatMatcher,
} from './pob-stat-matcher';
import { getLocaleItemsAssetPath, tradeVersionProfiles, type PoeVersion } from './trade-context';

export type {
  GemQualitySection,
  PseudoContribution,
  ShoppingEntryKind,
  ShoppingMod,
  ShoppingModKind,
  ShoppingStat,
};

export interface TradeNameCatalog {
  /** 英文物品名 → 頁面伺服器的市集名稱；不是市集上的物品時為 undefined */
  toTradeName(english: string): string | undefined;
  /** 從含詞綴的完整名稱裡找出基底（取最長的相符名稱） */
  findBaseType(fullName: string): string | undefined;
}

/** 清單要用哪一組裝備套裝與技能組；省略時用 PoB 匯出當下選用的那一組 */
export interface ShoppingSelection {
  itemSetId?: string;
  skillSetId?: string;
}

export interface ShoppingEntry {
  /**
   * 由內容決定的識別字串，用來記住「已完成」與「已刪除」。同一件裝備出現在不同套裝時
   * 是同一個 key，買過一次就不必在每個階段重新勾選。
   */
  key: string;
  kind: ShoppingEntryKind;
  /** 頁面伺服器的市集名稱（搜尋用的就是這個）；對不到時為 PoB 的英文名稱 */
  label: string;
  /** 英文名稱，介面用它換成顯示語言的名稱（顯示語言可以和頁面伺服器不同） */
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
  /** PoB 裝備的連結數；五連以上才有（實際是否帶入搜尋由 `resolveEntrySearch` 決定） */
  links?: number;
  /** 非傳奇裝備依部位推得的市集類別；有才能改用「類別＋防禦類型」搜尋 */
  category?: EntryCategory;
  /** 基底有的防禦與 PoB 的數值；整體設定開啟「防禦數值下限」時帶入 */
  defences?: EntryDefences;
  /** 不含詞綴與連結條件的搜尋（名稱、基底、分類）；null 表示無法搜尋 */
  searchBase: Record<string, unknown> | null;
  /** 官方市集的 query 物件（套用預設條件後）；null 表示無法搜尋 */
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
 * - 有組合時，所有組合都同意的部位才採用。
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
  if (localizedItems.length !== englishItems.length) throw new Error('items.json 索引無法對齊');
  return createTradeNameCatalog({ englishItems, localizedItems });
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
    const match = domain && matcher?.match(text, { preferLocal, domain });
    if (!match) return { text, kind, searched: false };
    const isTimeless = TIMELESS_STAT.test(match.statId);
    const exact = isTimeless || kind === 'enchant';
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
    return { ...full, query: resolveEntrySearch(full).query };
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
  const baseEntry = {
    key: gemKey(gem),
    kind: 'gem' as const,
    gemGroup: gemGroupOf(gem),
    label: tradeName ?? gem.name,
    englishName,
    count: 1,
    level: gem.level,
    quality: gem.quality,
    ...(gem.sockets !== undefined ? { gemSockets: gem.sockets } : {}),
    ...(qualitySection === 'type_filters' ? { gemQualitySection: qualitySection } : {}),
    searchBase: tradeName ? { status: INSTANT_BUYOUT_STATUS, type: tradeName } : null,
  };
  const query = resolveEntrySearch(baseEntry).query;
  return {
    ...baseEntry,
    searchBase: query,
    query,
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
