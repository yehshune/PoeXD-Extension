/**
 * 購物清單：把匯入的 PoB build 轉成一筆筆可以直接開啟的官方市集搜尋。
 *
 * - 傳奇：以名稱加基底搜尋。
 * - 稀有、魔法、普通：以基底搜尋，並把對得到市集代碼的一般詞綴帶入條件（下限取八成，
 *   方便找到相近而不必完全相同的裝備）；工藝詞綴可以自己做，不列入條件。
 * - 寶石：以名稱搜尋，等級與品質帶入下限；PoE 2 的技能寶石不在市集交易，不列入。
 *
 * PoB 的名稱是英文；市集搜尋要用頁面所在區服的名稱，由 `TradeNameCatalog` 轉換。對不到
 * 市集名稱的項目仍列出，但沒有搜尋（`query` 為 null），不會用猜的名稱去搜。
 */
import type { PobBuild, PobBuildGem, PobBuildItem, PobItemRarity, PobItemSet } from './pob-build';
import type { StatMatcher } from './pob-stat-matcher';
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

export type ShoppingModKind = 'implicit' | 'explicit' | 'crafted';

export interface ShoppingMod {
  /** PoB 的英文詞綴 */
  text: string;
  kind: ShoppingModKind;
  /** 這一行有帶入搜尋條件 */
  searched: boolean;
}

export interface ShoppingEntry {
  /**
   * 由內容決定的識別字串，用來記住「已完成」與「已刪除」。同一件裝備出現在不同套裝時
   * 是同一個 key，買過一次就不必在每個階段重新勾選。
   */
  key: string;
  kind: ShoppingEntryKind;
  /** 顯示名稱（頁面區服的名稱；對不到時為 PoB 的英文名稱） */
  label: string;
  /** 部位（裝備）或等級／品質（寶石），依 kind 由介面決定怎麼顯示 */
  slot?: string;
  level?: number;
  quality?: number;
  /** 裝備才有：稀有度與詞綴，供介面顯示 */
  rarity?: PobItemRarity;
  mods?: ShoppingMod[];
  /** 官方市集的 query 物件；null 表示無法搜尋 */
  query: Record<string, unknown> | null;
}

const ONLINE_STATUS = { option: 'online' } as const;
const SUPPORT_SUFFIX = ' Support';
/** 異變傳奇在 PoB 的名稱多一個前綴，市集上仍是原名 */
const MUTATED_UNIQUE_PREFIX = /^Foulborn\s+/;
const MIN_BASE_NAME_LENGTH = 4;
/** 類似裝備的數值下限：原數值的八成 */
const STAT_MIN_RATIO = 0.8;
/** 裝備本身有數值的部位：同一句詞綴優先對到市集標 `(Local)` 的代碼 */
const LOCAL_STAT_SLOT = /^(Weapon|Helmet|Body Armour|Gloves|Boots)(?: |$)/;

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

const KEY_SEPARATOR = '\u0000';

interface StatFilter {
  id: string;
  value?: { min: number };
}

/** 一般詞綴轉成搜尋條件；回傳每一行是否有對到代碼 */
function matchExplicitMods(
  item: PobBuildItem,
  matcher: StatMatcher | undefined,
): { filters: StatFilter[]; searched: boolean[] } {
  const filters = new Map<string, StatFilter>();
  const searched = item.explicitMods.map((mod) => {
    if (!matcher || mod.crafted) return false;
    const match = matcher.match(mod.text, { preferLocal: LOCAL_STAT_SLOT.test(item.slot) });
    if (!match || filters.has(match.statId)) return false;
    const min = match.value !== undefined ? Math.floor(match.value * STAT_MIN_RATIO) : 0;
    filters.set(match.statId, { id: match.statId, ...(min >= 1 ? { value: { min } } : {}) });
    return true;
  });
  return { filters: [...filters.values()], searched };
}

function itemMods(item: PobBuildItem, searched: readonly boolean[]): ShoppingMod[] {
  return [
    ...item.implicitMods.map((text) => ({ text, kind: 'implicit' as const, searched: false })),
    ...item.explicitMods.map((mod, index) => ({
      text: mod.text,
      kind: mod.crafted ? ('crafted' as const) : ('explicit' as const),
      searched: searched[index] ?? false,
    })),
  ];
}

function itemEntry(
  item: PobBuildItem,
  catalog: TradeNameCatalog,
  matcher: StatMatcher | undefined,
): ShoppingEntry {
  const isUnique = item.rarity === 'UNIQUE' || item.rarity === 'RELIC';
  const englishBase = item.baseType ?? catalog.findBaseType(item.name);
  const tradeBase = englishBase ? catalog.toTradeName(englishBase) : undefined;
  const key = ['item', item.slot, item.rarity, item.name, item.baseType ?? ''].join(KEY_SEPARATOR);

  if (!isUnique) {
    const { filters, searched } = matchExplicitMods(item, matcher);
    return {
      key,
      kind: 'equipment',
      label: tradeBase ?? englishBase ?? item.name,
      slot: item.slot,
      rarity: item.rarity,
      mods: itemMods(item, searched),
      query: tradeBase
        ? {
            status: ONLINE_STATUS,
            type: tradeBase,
            ...(filters.length > 0 ? { stats: [{ type: 'and', filters }] } : {}),
          }
        : null,
    };
  }
  const englishName = item.name.replace(MUTATED_UNIQUE_PREFIX, '');
  const tradeName = catalog.toTradeName(englishName);
  return {
    key,
    kind: 'unique',
    label: tradeName ?? item.name,
    slot: item.slot,
    rarity: item.rarity,
    mods: itemMods(item, []),
    query: tradeName
      ? { status: ONLINE_STATUS, name: tradeName, ...(tradeBase ? { type: tradeBase } : {}) }
      : null,
  };
}

function gemEntry(gem: PobBuildGem, catalog: TradeNameCatalog): ShoppingEntry {
  // PoB 的輔助寶石名稱不含「Support」，市集上有
  const tradeName =
    (gem.support ? catalog.toTradeName(`${gem.name}${SUPPORT_SUFFIX}`) : undefined) ??
    catalog.toTradeName(gem.name);
  const gemFilters = {
    ...(gem.level > 1 ? { gem_level: { min: gem.level } } : {}),
    ...(gem.quality > 0 ? { quality: { min: gem.quality } } : {}),
  };
  return {
    key: ['gem', gem.name, gem.level, gem.quality].join(KEY_SEPARATOR),
    kind: 'gem',
    label: tradeName ?? gem.name,
    level: gem.level,
    quality: gem.quality,
    query: tradeName
      ? {
          status: ONLINE_STATUS,
          type: tradeName,
          ...(Object.keys(gemFilters).length > 0
            ? { filters: { misc_filters: { filters: gemFilters } } }
            : {}),
        }
      : null,
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
  // 同一套裝裡內容完全相同的項目（例如兩顆一樣的珠寶）共用一個 key，只列一次
  const unique = new Map([...items, ...gems].map((entry) => [entry.key, entry] as const));
  const order: readonly ShoppingEntryKind[] = ['unique', 'equipment', 'gem'];
  return order.flatMap((kind) => [...unique.values()].filter((entry) => entry.kind === kind));
}

/** 官方市集支援以 `?q=` 帶入查詢條件，開啟後由官網自己執行搜尋 */
export function buildTradeSearchUrl(options: {
  origin: string;
  version: PoeVersion;
  league: string;
  query: Record<string, unknown>;
}): string {
  const profile = tradeVersionProfiles[options.version];
  const path = [profile.routeRoot, 'search', profile.searchVersionSegment, options.league]
    .filter((segment): segment is string => Boolean(segment))
    .map(encodeURIComponent)
    .join('/');
  const payload = JSON.stringify({ query: options.query, sort: { price: 'asc' } });
  return `${options.origin}/${path}?q=${encodeURIComponent(payload)}`;
}
