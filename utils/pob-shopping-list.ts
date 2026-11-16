/**
 * 購物清單：把匯入的 PoB build 轉成一筆筆可以直接開啟的官方市集搜尋。
 *
 * - 傳奇：以名稱加基底搜尋；永恆珠寶另外帶入種子編號。
 * - 稀有、魔法、普通：以基底搜尋，並把對得到市集代碼的固定詞綴與一般詞綴帶入條件（下限取八成，
 *   方便找到相近而不必完全相同的裝備）；工藝詞綴可以自己做，不列入條件。附魔只有星團珠寶預設帶入。
 * - 寶石：以名稱搜尋，等級與品質帶入下限；PoE 2 的技能寶石不在市集交易，不列入。
 * - 身甲與雙手武器有五連以上時帶入連結數下限。
 *
 * 每一行詞綴對到的市集代碼都記在 `ShoppingMod.stat`，使用者可以在清單上自行勾選、改數值、改成
 * 「至少符合 N 項」或總和條件（`EntrySearchSelection`），由 `buildEntryQuery` 組出實際的搜尋。
 *
 * PoB 的名稱是英文；市集搜尋要用頁面所在區服的名稱，由 `TradeNameCatalog` 轉換。對不到
 * 市集名稱的項目仍列出，但沒有搜尋（`query` 為 null），不會用猜的名稱去搜。
 */
import type { PobBuild, PobBuildGem, PobBuildItem, PobItemRarity, PobItemSet } from './pob-build';
import { modLineSkeleton, type StatDomain, type StatMatcher } from './pob-stat-matcher';
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
  /** 裝備才有：稀有度與詞綴，供介面顯示 */
  rarity?: PobItemRarity;
  mods?: ShoppingMod[];
  /** 不含詞綴條件的搜尋（名稱、基底、連結）；null 表示無法搜尋 */
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
  min?: number | null;
  max?: number | null;
}

/** 使用者對一個項目的搜尋調整，存在本機 */
export interface EntrySearchSelection {
  /** 以市集代碼為鍵：同一個代碼的多行是同一個條件 */
  stats?: Readonly<Record<string, StatSelection>>;
  /** 設定時改為「至少符合 N 項」 */
  countMin?: number;
  /** 抗性、生命、能力值合併成總和條件 */
  pseudo?: boolean;
}

/** 介面顯示的一個條件：同一個代碼的多行已合併 */
export interface ShoppingStatFilter {
  id: string;
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
const SUPPORT_SUFFIX = ' Support';
/** 異變傳奇在 PoB 的名稱多一個前綴，市集上仍是原名 */
const MUTATED_UNIQUE_PREFIX = /^Foulborn\s+/;
/** PoB 的永恆珠寶名稱後面接種子編號等資訊：`Lethal Pride 16137; 8; Duelist` */
const TIMELESS_NAME_SUFFIX = /\s+\d+;.*$/;
/** 基底名稱後的種類說明：`Two-Stone Ring (Cold/Lightning)`，市集上只有基底名稱 */
const BASE_VARIANT_SUFFIX = /\s*\([^)]*\)$/;
const TIMELESS_STAT = /\.pseudo_timeless_jewel_/;
const CLUSTER_JEWEL_BASE = /Cluster Jewel$/;
const MIN_BASE_NAME_LENGTH = 4;
/** 類似裝備的數值下限：原數值的八成 */
const STAT_MIN_RATIO = 0.8;
/** 連結數到這個數量才帶入搜尋（四連以下很容易自己做） */
const MIN_SEARCHED_LINKS = 5;
/** 裝備本身有數值的部位：同一句詞綴優先對到市集標 `(Local)` 的代碼 */
const LOCAL_STAT_SLOT = /^(Weapon|Helmet|Body Armour|Gloves|Boots)(?: |$)/;
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
];
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
 * 預設的數值範圍：正數取八成當下限、負數（減少、降低需求）取八成當上限；整數無條件捨去到整數，
 * 小於 10 的非整數保留一位小數（0.5% 暴擊率不會變成「有就好」）。
 */
export function defaultStatBounds(
  value: number | undefined,
  exact = false,
): { min?: number; max?: number } {
  if (value === undefined || !Number.isFinite(value) || value === 0) return {};
  if (exact) return { min: value, max: value };
  const scaled = value * STAT_MIN_RATIO;
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
}

function modPlans(item: PobBuildItem): ModPlan[] {
  return [
    ...item.implicitMods.map((mod) =>
      mod.crafted
        ? { text: mod.text, kind: 'enchant' as const, domain: 'enchant' as const }
        : { text: mod.text, kind: 'implicit' as const, domain: 'implicit' as const },
    ),
    ...item.explicitMods.map((mod) =>
      mod.crafted
        ? { text: mod.text, kind: 'crafted' as const }
        : { text: mod.text, kind: 'explicit' as const, domain: 'explicit' as const },
    ),
  ];
}

function itemMods(
  item: PobBuildItem,
  matcher: StatMatcher | undefined,
  options: { isUnique: boolean; isClusterJewel: boolean },
): ShoppingMod[] {
  const preferLocal = LOCAL_STAT_SLOT.test(item.slot);
  return modPlans(item).map(({ text, kind, domain }) => {
    const match = domain && matcher?.match(text, { preferLocal, domain });
    if (!match) return { text, kind, searched: false };
    const isTimeless = TIMELESS_STAT.test(match.statId);
    // 附魔的數值是固定的（星團珠寶的天賦數、插槽數），不取八成
    const exact = isTimeless || kind === 'enchant';
    const defaultEnabled = options.isUnique
      ? isTimeless
      : kind === 'enchant'
        ? options.isClusterJewel
        : true;
    const pseudo = match.option === undefined && !exact ? pseudoContributions(text) : undefined;
    const stat: ShoppingStat = {
      id: match.statId,
      ...(match.value !== undefined ? { value: match.value } : {}),
      ...(match.option !== undefined ? { option: match.option } : {}),
      ...(exact ? { exact } : {}),
      defaultEnabled,
      ...(pseudo?.length ? { pseudo } : {}),
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

/** 同一個代碼的多行合併成一個條件（數值加總），再套用使用者的調整 */
export function entryStatFilters(
  entry: Pick<ShoppingEntry, 'mods'>,
  selection?: EntrySearchSelection,
): ShoppingStatFilter[] {
  const groups = new Map<string, ShoppingStat[]>();
  for (const mod of entry.mods ?? []) {
    if (mod.stat) groups.set(mod.stat.id, [...(groups.get(mod.stat.id) ?? []), mod.stat]);
  }
  return [...groups.entries()].map(([id, stats]) => {
    const [first] = stats;
    const value = first.option === undefined ? sumValues(stats) : undefined;
    const bounds = defaultStatBounds(value, first.exact);
    const custom = selection?.stats?.[id];
    const pick = (key: 'min' | 'max') =>
      custom && key in custom ? finiteOrUndefined(custom[key]) : bounds[key];
    const min = pick('min');
    const max = pick('max');
    return {
      id,
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

/** 總和條件：勾選的抗性、生命、能力值換成總和，下限同樣取八成 */
function mergeIntoPseudo(
  filters: readonly ShoppingStatFilter[],
  mods: readonly ShoppingMod[],
): QueryStatFilter[] {
  const pseudoOf = new Map<string, readonly PseudoContribution[]>();
  for (const mod of mods) if (mod.stat?.pseudo) pseudoOf.set(mod.stat.id, mod.stat.pseudo);
  const totals = new Map<string, number>();
  const rest: QueryStatFilter[] = [];
  for (const filter of filters) {
    const contributions = pseudoOf.get(filter.id);
    if (!contributions || filter.value === undefined) {
      rest.push(toQueryFilter(filter));
      continue;
    }
    for (const { id, weight } of contributions) {
      totals.set(id, (totals.get(id) ?? 0) + filter.value * weight);
    }
    // 固定詞綴決定基底的種類（雙玉戒指是哪兩種抗性），保留成獨立條件，數值仍計入總和
    if (filter.id.startsWith(IMPLICIT_PREFIX)) rest.push(toQueryFilter(filter));
  }
  const pseudo = [...totals.entries()].map(([id, total]) =>
    toQueryFilter({ id, ...defaultStatBounds(total) }),
  );
  return [...pseudo, ...rest];
}

/** 套用使用者的選擇組出搜尋；項目無法搜尋時回傳 null */
export function buildEntryQuery(
  entry: Pick<ShoppingEntry, 'mods' | 'searchBase'>,
  selection?: EntrySearchSelection,
): Record<string, unknown> | null {
  if (!entry.searchBase) return null;
  const enabled = entryStatFilters(entry, selection).filter((filter) => filter.enabled);
  const filters = selection?.pseudo
    ? mergeIntoPseudo(enabled, entry.mods ?? [])
    : enabled.map(toQueryFilter);
  if (filters.length === 0) return entry.searchBase;
  const countMin = selection?.countMin;
  if (countMin === undefined || !Number.isInteger(countMin) || countMin < 1) {
    return { ...entry.searchBase, stats: [{ type: 'and', filters }] };
  }
  const required = filters.filter((filter) => isRequiredInCountMode(filter.id));
  const countable = filters.filter((filter) => !isRequiredInCountMode(filter.id));
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
  return { ...entry.searchBase, stats: groups };
}

/** 套用使用者的選擇：更新每一行是否帶入搜尋與實際的搜尋條件 */
export function applyEntrySelection(
  entry: ShoppingEntry,
  selection?: EntrySearchSelection,
): ShoppingEntry {
  if (!entry.mods || !selection) return entry;
  const enabled = new Set(
    entryStatFilters(entry, selection)
      .filter((filter) => filter.enabled)
      .map((filter) => filter.id),
  );
  return {
    ...entry,
    mods: entry.mods.map((mod) => ({
      ...mod,
      searched: mod.stat ? enabled.has(mod.stat.id) : false,
    })),
    query: buildEntryQuery(entry, selection),
  };
}

function linkFilters(item: PobBuildItem): Record<string, unknown> {
  if (!item.maxLinks || item.maxLinks < MIN_SEARCHED_LINKS) return {};
  return { filters: { socket_filters: { filters: { links: { min: item.maxLinks } } } } };
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

  if (!isUnique) {
    return finish({
      key,
      kind: 'equipment',
      label: base.trade ?? base.english ?? item.name,
      englishName: base.english ?? item.name,
      slot: item.slot,
      rarity: item.rarity,
      searchBase: base.trade
        ? { status: INSTANT_BUYOUT_STATUS, type: base.trade, ...linkFilters(item) }
        : null,
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
    searchBase: tradeName
      ? {
          status: INSTANT_BUYOUT_STATUS,
          name: tradeName,
          ...(base.trade ? { type: base.trade } : {}),
          ...linkFilters(item),
        }
      : null,
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

const gemKey = (gem: PobBuildGem): string =>
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

function gemEntry(gem: PobBuildGem, catalog: TradeNameCatalog): ShoppingEntry {
  // PoB 的輔助寶石名稱不含「Support」，市集上有
  const supportName = `${gem.name}${SUPPORT_SUFFIX}`;
  const englishName = gem.support && catalog.toTradeName(supportName) ? supportName : gem.name;
  const tradeName = catalog.toTradeName(englishName);
  const gemFilters = {
    ...(gem.level > 1 ? { gem_level: { min: gem.level } } : {}),
    ...(gem.quality > 0 ? { quality: { min: gem.quality } } : {}),
  };
  const searchBase = tradeName
    ? {
        status: INSTANT_BUYOUT_STATUS,
        type: tradeName,
        ...(Object.keys(gemFilters).length > 0
          ? { filters: { misc_filters: { filters: gemFilters } } }
          : {}),
      }
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
): ShoppingEntry[] {
  const pick = <T extends { id: string }>(
    sets: readonly T[],
    wanted: string | undefined,
    active: string,
  ) => sets.find((set) => set.id === wanted) ?? sets.find((set) => set.id === active);
  const itemSet = pick(build.itemSets, selection.itemSetId, build.activeItemSetId);
  const skillSet = pick(build.skillSets, selection.skillSetId, build.activeSkillSetId);

  const items = [...(itemSet?.items ?? []), ...jewelsFor(build, itemSet)].map((item) =>
    itemEntry(item, catalog, matcher),
  );
  const gems =
    build.gameVersion === 'poe1' ? (skillSet?.gems ?? []).map((gem) => gemEntry(gem, catalog)) : [];
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
