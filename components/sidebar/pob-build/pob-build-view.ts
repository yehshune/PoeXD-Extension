/**
 * PoB 購物清單的畫面投影：把一份 build 的工作階段（選用的套裝、進度、搜尋調整）
 * 與對照資料（名稱、詞綴翻譯、物品圖片）轉成面板要顯示的分組與列。純函式，不碰 Vue 狀態。
 */
import { findAscendancyFolderIcon } from '@/utils/folder-icons';
import { t } from '@/utils/i18n';
import type { PobBuild } from '@/utils/pob-build';
import { itemArtFor, type ItemArtData } from '@/utils/pob-item-art';
import {
  resolveEntrySearch,
  type BuildSearchDefaults,
  type EntrySearchSelection,
  type RareSearchMode,
  type ShoppingStatFilter,
} from '@/utils/pob-entry-search';
import {
  buildShoppingList,
  gemKey,
  type ShoppingEntry,
  type ShoppingMod,
  type TradeNameCatalog,
  type VisceraModIndex,
} from '@/utils/pob-shopping-list';
import type { ModLineTranslator } from '@/utils/pob-mod-translator';
import type { StatMatcher } from '@/utils/pob-stat-matcher';
import type { PoeVersion } from '@/utils/trade-context';

export interface ShoppingRow extends ShoppingEntry {
  done: boolean;
  /** 物品圖片（官方 CDN）；對照表沒有時省略 */
  icon?: string;
  /** 圖片的背包格數（畫孔洞用） */
  iconSize?: { width: number; height: number };
  /** 圖片是三格 sprite（藥劑、寶石）時由下往上疊的格子 */
  iconLayers?: readonly number[];
  /** 圖片已是官方穢生造型（不必再染色） */
  iconFoulborn?: true;
  /** 裝備插槽裡的東西（PoE 1 寶石與深淵珠寶、PoE 2 符文），與插槽一一對應，空孔為 null；全空時省略 */
  socketContents?: (SocketContent | null)[];
  /** 可以勾選的搜尋條件（同一個代碼的多行已合併），已套用使用者的調整 */
  filters: ShoppingStatFilter[];
  /** 參與「至少符合 N 項」的已啟用條件數（已涵蓋合成臟器例外） */
  countableFilterCount?: number;
  /** 「至少符合 N 項」；未設定時為全部符合 */
  countMin?: number;
  /** 抗性、生命、能力值改用總和條件 */
  pseudo: boolean;
  /** 實際帶入搜尋的連結數下限（單件設定或 build 整體設定）；不限時省略 */
  linksMin?: number;
  /** 實際的搜尋方式（沒有類別的項目一律是基底） */
  searchBy?: RareSearchMode;
  /** 寶石實際帶入搜尋的等級／品質下限；不限時省略 */
  gemLevelMin?: number;
  gemQualityMin?: number;
  /** PoE 2 寶石實際帶入的插槽數下限 */
  gemSocketsMin?: number;
  /** 使用者調整過這一項的搜尋條件，或存回了市集搜尋 */
  searchCustomized: boolean;
  /** 目前已儲存的條件調整（供 Popover 建立暫存草稿使用） */
  searchSelection?: EntrySearchSelection;
  /** 這一項使用從市集頁面存回的搜尋（詞綴條件不套用） */
  searchOverride: boolean;
}

/** 插在裝備插槽裡的寶石、符文或深淵珠寶 */
export interface SocketContent {
  kind: 'gem' | 'rune' | 'jewel';
  /** 顯示語言的名稱 */
  label: string;
  /** 寶石的等級／品質、所屬連線 */
  detail?: string;
  support?: boolean;
  icon?: string;
  iconLayers?: readonly number[];
  /** 寶石、深淵珠寶在清單裡的列（點插槽時開它的設定框） */
  rowKey?: string;
}

export type StatBound = 'min' | 'max';

/** 清單分組：全部裝備一組（依部位排序）；寶石依插的部位一組，沒有部位的以連線一組 */
export interface ShoppingGroup {
  id: string;
  kind: 'equipment' | 'gem';
  /** 寶石分組的部位（PoB 部位名稱） */
  slot?: string;
  /** 沒有部位的寶石分組：連線名稱（已換成顯示語言） */
  skill?: string;
  rows: ShoppingRow[];
}

export interface SetOption {
  id: string;
  /** 使用者在 PoB 取的標題；空字串時由介面顯示「套裝 N」 */
  title: string;
  /** 從 1 起算的順序，沒有標題時用來顯示 */
  position: number;
}

export interface BuildView {
  id: string;
  name: string;
  /** 依流派昇華／基礎職業解析出的寬版圖示 ID */
  icon?: string;
  collapsed: boolean;
  itemSetOptions: SetOption[];
  skillSetOptions: SetOption[];
  itemSetId: string;
  skillSetId: string;
  /** 目前套裝的清單，不含已移除的項目；隱藏已完成時也不含已完成的項目 */
  groups: ShoppingGroup[];
  /** 進度一律計算全部項目（含隱藏的已完成項目） */
  progress: { done: number; total: number };
  hideDone: boolean;
  /** 目前套裝中被移除的項目數 */
  removedCount: number;
  /** build 整體搜尋設定；只含和預設不同的欄位 */
  searchDefaults: BuildSearchDefaults;
}

/** 裝備上的深淵插槽部位：`Belt Abyssal Socket 1` */
const ABYSSAL_SLOT = /^(.+) Abyssal Socket (\d+)$/;
/** PoB 插槽文字裡的深淵孔 */
const ABYSS_SOCKET = 'A';

/** 裝備部位 → 插在它深淵孔裡的珠寶（依孔的順序） */
type AbyssJewels = ReadonlyMap<string, readonly SocketContent[]>;

/** PoB 的輔助寶石名稱不含「Support」，市集與圖片對照用的英文名稱有 */
const SUPPORT_NAME_SUFFIX = ' Support';

/** 一份 build 在這個分頁的工作狀態 */
export interface PobBuildSession {
  id: string;
  name: string;
  /** 目前的 PoB 代碼；跨分頁同步時用來判斷要不要重新解碼 */
  code: string;
  build: PobBuild;
  collapsed: boolean;
  hideDone: boolean;
  itemSetId: string;
  skillSetId: string;
  done: ReadonlySet<string>;
  removed: ReadonlySet<string>;
  searchSelections: Readonly<Record<string, EntrySearchSelection>>;
  searchDefaults: BuildSearchDefaults;
  searchOverrides: Readonly<Record<string, string>>;
}

/** 畫面投影需要的對照資料；尚未載入的欄位為 undefined（catalog 為 null） */
export interface PobBuildViewData {
  version: PoeVersion;
  catalog: TradeNameCatalog | null;
  matcher: StatMatcher | undefined;
  visceraMods: VisceraModIndex | undefined;
  modTranslator: ModLineTranslator | undefined;
  displayNames: TradeNameCatalog | undefined;
  itemArt: ItemArtData | undefined;
}

export interface PobBuildView {
  /** 目前選用套裝與技能組的清單項目（含已移除的） */
  entriesOf(session: PobBuildSession): ShoppingEntry[];
  /** 一份 build 所有套裝、技能組會出現的 key */
  allKeysOf(build: PobBuild): Set<string>;
  /** 書籤與主控台的封面圖；三格 sprite 不當封面 */
  coverOf(entry: ShoppingEntry): string | undefined;
  toView(session: PobBuildSession): BuildView;
}

const toOptions = (sets: ReadonlyArray<{ id: string; title: string }>): SetOption[] =>
  sets.map((set, index) => ({ id: set.id, title: set.title, position: index + 1 }));

export function createPobBuildView(data: PobBuildViewData): PobBuildView {
  type Session = PobBuildSession;

  const listFor = (build: PobBuild, itemSetId: string, skillSetId: string): ShoppingEntry[] =>
    data.catalog
      ? buildShoppingList(build, data.catalog, { itemSetId, skillSetId }, data.matcher, {
          visceraMods: data.visceraMods,
        })
      : [];

  const entriesOf = (session: Session): ShoppingEntry[] =>
    listFor(session.build, session.itemSetId, session.skillSetId);

  /** 一份 build 所有套裝、技能組會出現的 key；更新代碼時用來判斷哪些進度還用得到 */
  const allKeysOf = (build: PobBuild): Set<string> => {
    const itemSetIds = build.itemSets.length > 0 ? build.itemSets.map((set) => set.id) : [''];
    const skillSetIds = build.skillSets.length > 0 ? build.skillSets.map((set) => set.id) : [''];
    const keys = new Set<string>();
    for (const itemSetId of itemSetIds) {
      listFor(build, itemSetId, skillSetIds[0]).forEach((entry) => keys.add(entry.key));
    }
    for (const skillSetId of skillSetIds) {
      listFor(build, itemSetIds[0], skillSetId).forEach((entry) => keys.add(entry.key));
    }
    return keys;
  };

  /** 沒有部位的寶石分組以連線名稱（英文寶石名稱或 PoB 標籤）顯示，能換成顯示語言就換 */
  const skillLabel = (skill: string): string =>
    (data.displayNames ?? data.catalog)?.toTradeName(skill) ?? skill;

  /** 詞綴顯示用顯示語言；翻不了的維持 PoB 的英文 */
  const localizeMod = (mod: ShoppingMod): ShoppingMod => {
    const translated = data.modTranslator?.translate(mod.text);
    return translated ? { ...mod, text: translated } : mod;
  };

  /** 圖片網址與背包尺寸（臟器組合沒有單一物品，不給圖片） */
  const artOf = (
    entry: ShoppingEntry,
  ): Pick<ShoppingRow, 'icon' | 'iconSize' | 'iconLayers' | 'iconFoulborn'> => {
    if (!data.itemArt || entry.visceraBundle || entry.visceraPart) return {};
    const image = itemArtFor(data.itemArt, entry);
    if (!image) return {};
    return {
      icon: image.url,
      iconSize: { width: image.width, height: image.height },
      ...(image.layers ? { iconLayers: image.layers } : {}),
      ...(image.foulborn ? { iconFoulborn: true } : {}),
    };
  };

  const contentArt = (
    kind: 'gem' | 'equipment',
    names: readonly string[],
  ): Pick<SocketContent, 'icon' | 'iconLayers'> => {
    if (!data.itemArt) return {};
    for (const englishName of names) {
      const image = itemArtFor(data.itemArt, { kind, englishName });
      if (image) return { icon: image.url, ...(image.layers ? { iconLayers: image.layers } : {}) };
    }
    return {};
  };

  const displayName = (englishName: string): string =>
    (data.displayNames ?? data.catalog)?.toTradeName(englishName) ?? englishName;

  /**
   * 插槽內容物：PoE 2 是物品上的 `Rune:` 行；PoE 1 的深淵孔放 PoB 指定插在那裡的深淵珠寶，
   * 其他孔放目前技能組裡指定插在這個部位的寶石。PoB 不記錄寶石在哪個孔，依技能組的順序填入；
   * 放不下的不顯示。
   */
  const socketContentsOf = (
    session: Session,
    entry: ShoppingEntry,
    abyss: AbyssJewels,
  ): Pick<ShoppingRow, 'socketContents'> => {
    if (entry.kind === 'gem' || !entry.sockets || !entry.slot) return {};
    const colors = entry.sockets.replace(/[^A-Z]/g, '').split('');
    const contents: (SocketContent | null)[] = entry.socketed
      ? colors.map((_, index) => {
          const name = entry.socketed?.[index];
          return name
            ? {
                kind: 'rune' as const,
                label: displayName(name),
                ...contentArt('equipment', [name]),
              }
            : null;
        })
      : fillSockets(colors, gemContents(session, entry.slot), abyss.get(entry.slot) ?? []);
    return contents.some(Boolean) ? { socketContents: contents } : {};
  };

  /** 深淵孔依序放深淵珠寶，其他孔依序放寶石 */
  const fillSockets = (
    colors: readonly string[],
    gems: readonly SocketContent[],
    jewels: readonly SocketContent[],
  ): (SocketContent | null)[] => {
    let gemIndex = 0;
    let jewelIndex = 0;
    return colors.map((color) =>
      color === ABYSS_SOCKET ? (jewels[jewelIndex++] ?? null) : (gems[gemIndex++] ?? null),
    );
  };

  const gemContents = (session: Session, slot: string): SocketContent[] =>
    gemsInSlot(session, slot).map((gem) => {
      const englishName = gem.support ? `${gem.name}${SUPPORT_NAME_SUFFIX}` : gem.name;
      return {
        kind: 'gem' as const,
        label: displayName(englishName),
        detail: t('pobBuild.gemDetail', { level: gem.level, quality: gem.quality }),
        ...(gem.support ? { support: true } : {}),
        rowKey: gemKey(gem),
        ...contentArt('gem', gem.support ? [englishName, gem.name] : [gem.name]),
      };
    });

  /** 插在裝備深淵孔裡的珠寶：`<部位> Abyssal Socket N` → 依部位分組、依 N 排序 */
  const abyssJewelsOf = (entries: readonly ShoppingEntry[]): AbyssJewels => {
    const found: { parent: string; order: number; content: SocketContent }[] = [];
    for (const entry of entries) {
      const match = entry.slot ? ABYSSAL_SLOT.exec(entry.slot) : null;
      if (!match) continue;
      const art = artOf(entry);
      found.push({
        parent: match[1],
        order: Number(match[2]),
        content: {
          kind: 'jewel',
          label: data.displayNames?.toTradeName(entry.englishName) ?? entry.label,
          rowKey: entry.key,
          ...(art.icon ? { icon: art.icon } : {}),
          ...(art.iconLayers ? { iconLayers: art.iconLayers } : {}),
        },
      });
    }
    const map = new Map<string, SocketContent[]>();
    for (const { parent, content } of found.sort((a, b) => a.order - b.order)) {
      map.set(parent, [...(map.get(parent) ?? []), content]);
    }
    return map;
  };

  const gemsInSlot = (session: Session, slot: string) => {
    const sets = session.build.skillSets;
    const set =
      sets.find((candidate) => candidate.id === session.skillSetId) ??
      sets.find((candidate) => candidate.id === session.build.activeSkillSetId) ??
      sets[0];
    return set?.gems.filter((gem) => gem.slot === slot) ?? [];
  };

  /** 書籤與主控台的封面只能是一張完整的圖，三格 sprite 不當封面 */
  const coverOf = (entry: ShoppingEntry): string | undefined => {
    const art = artOf(entry);
    return art.iconLayers ? undefined : art.icon;
  };

  const toRow = (session: Session, entry: ShoppingEntry, abyss: AbyssJewels): ShoppingRow => {
    const selection = session.searchSelections[entry.key];
    const resolved = resolveEntrySearch(entry, selection, session.searchDefaults);
    return {
      ...entry,
      ...resolved,
      label:
        entry.visceraBundle || entry.visceraPart
          ? t('pobBuild.viscera.bundle')
          : (data.displayNames?.toTradeName(entry.englishName) ?? entry.label),
      ...(resolved.mods ? { mods: resolved.mods.map(localizeMod) } : {}),
      done: session.done.has(entry.key),
      ...artOf(entry),
      ...socketContentsOf(session, entry, abyss),
      searchCustomized: selection !== undefined || session.searchOverrides[entry.key] !== undefined,
      ...(selection ? { searchSelection: selection } : {}),
      searchOverride: session.searchOverrides[entry.key] !== undefined,
    };
  };

  /** 依清單順序切成分組；隱藏已完成時略過已完成的項目 */
  const toGroups = (
    session: Session,
    entries: readonly ShoppingEntry[],
    abyss: AbyssJewels,
  ): ShoppingGroup[] => {
    const groups = new Map<string, ShoppingGroup>();
    for (const entry of entries) {
      const gemGroup = entry.kind === 'gem' ? entry.gemGroup : undefined;
      const id = entry.kind === 'gem' ? `gem:${gemGroup?.id ?? ''}` : 'equipment';
      const group: ShoppingGroup = groups.get(id) ?? {
        id,
        kind: entry.kind === 'gem' ? 'gem' : 'equipment',
        ...(gemGroup?.slot ? { slot: gemGroup.slot } : {}),
        ...(gemGroup?.skill !== undefined ? { skill: skillLabel(gemGroup.skill) } : {}),
        rows: [],
      };
      groups.set(id, { ...group, rows: [...group.rows, toRow(session, entry, abyss)] });
    }
    return [...groups.values()]
      .map((group) => ({
        ...group,
        // 已完成的項目留在原位（不沉底），開啟「隱藏已完成」時才拿掉
        rows: session.hideDone ? group.rows.filter((row) => !row.done) : group.rows,
      }))
      .filter((group) => group.rows.length > 0);
  };

  const toView = (session: Session): BuildView => {
    const entries = entriesOf(session);
    const visible = entries.filter((entry) => !session.removed.has(entry.key));
    const icon = findAscendancyFolderIcon(
      data.version,
      session.build.ascendancy,
      session.build.className,
    );
    return {
      id: session.id,
      name: session.name,
      ...(icon ? { icon } : {}),
      collapsed: session.collapsed,
      itemSetOptions: toOptions(session.build.itemSets),
      skillSetOptions: toOptions(session.build.skillSets),
      itemSetId: session.itemSetId,
      skillSetId: session.skillSetId,
      // 刪掉的深淵珠寶仍插在裝備上，插槽照樣顯示
      groups: toGroups(session, visible, abyssJewelsOf(entries)),
      progress: {
        done: visible.filter((entry) => session.done.has(entry.key)).length,
        total: visible.length,
      },
      hideDone: session.hideDone,
      removedCount: entries.length - visible.length,
      searchDefaults: session.searchDefaults,
    };
  };

  return { entriesOf, allKeysOf, coverOf, toView };
}
