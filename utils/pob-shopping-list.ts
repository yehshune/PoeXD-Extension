/**
 * 購物清單：把匯入的 PoB build 轉成一筆筆可以直接開啟的官方市集搜尋。
 *
 * - 傳奇：以名稱加基底搜尋。
 * - 稀有、魔法、普通：只能以基底搜尋（詞綴條件不在這個功能的範圍）。
 * - 寶石：以名稱搜尋，等級與品質帶入下限；PoE 2 的技能寶石不在市集交易，不列入。
 *
 * PoB 的名稱是英文；市集搜尋要用頁面所在區服的名稱，由 `TradeNameCatalog` 轉換。對不到
 * 市集名稱的項目仍列出，但沒有搜尋（`query` 為 null），不會用猜的名稱去搜。
 */
import type { PobBuild, PobBuildGem, PobBuildItem } from './pob-build';
import { getLocaleItemsAssetPath, tradeVersionProfiles, type PoeVersion } from './trade-context';

export interface TradeNameCatalog {
  /** 英文物品名 → 頁面區服的市集名稱；不是市集上的物品時為 undefined */
  toTradeName(english: string): string | undefined;
  /** 從含詞綴的完整名稱裡找出基底（取最長的相符名稱） */
  findBaseType(fullName: string): string | undefined;
}

export type ShoppingEntryKind = 'unique' | 'equipment' | 'gem';

export interface ShoppingEntry {
  kind: ShoppingEntryKind;
  /** 顯示名稱（頁面區服的名稱；對不到時為 PoB 的英文名稱） */
  label: string;
  /** 部位（裝備）或等級／品質（寶石），依 kind 由介面決定怎麼顯示 */
  slot?: string;
  level?: number;
  quality?: number;
  /** 官方市集的 query 物件；null 表示無法搜尋 */
  query: Record<string, unknown> | null;
}

const ONLINE_STATUS = { option: 'online' } as const;
const SUPPORT_SUFFIX = ' Support';
/** 異變傳奇在 PoB 的名稱多一個前綴，市集上仍是原名 */
const MUTATED_UNIQUE_PREFIX = /^Foulborn\s+/;
const MIN_BASE_NAME_LENGTH = 4;

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

function itemEntry(item: PobBuildItem, catalog: TradeNameCatalog): ShoppingEntry {
  const isUnique = item.rarity === 'UNIQUE' || item.rarity === 'RELIC';
  const englishBase = item.baseType ?? catalog.findBaseType(item.name);
  const tradeBase = englishBase ? catalog.toTradeName(englishBase) : undefined;

  if (!isUnique) {
    return {
      kind: 'equipment',
      label: tradeBase ?? englishBase ?? item.name,
      slot: item.slot,
      query: tradeBase ? { status: ONLINE_STATUS, type: tradeBase } : null,
    };
  }
  const englishName = item.name.replace(MUTATED_UNIQUE_PREFIX, '');
  const tradeName = catalog.toTradeName(englishName);
  return {
    kind: 'unique',
    label: tradeName ?? item.name,
    slot: item.slot,
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

export function buildShoppingList(build: PobBuild, catalog: TradeNameCatalog): ShoppingEntry[] {
  const items = build.items.map((item) => itemEntry(item, catalog));
  const gems = build.gameVersion === 'poe1' ? build.gems.map((gem) => gemEntry(gem, catalog)) : [];
  const order: readonly ShoppingEntryKind[] = ['unique', 'equipment', 'gem'];
  return order.flatMap((kind) => [...items, ...gems].filter((entry) => entry.kind === kind));
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
