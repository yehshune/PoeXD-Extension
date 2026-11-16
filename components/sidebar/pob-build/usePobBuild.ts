/**
 * PoB 購物清單的狀態：多份 build 並存，各自記住選用的套裝、已完成與已移除的項目，以及從
 * 搜尋結果擷取的圖片。代碼與進度都存在本機。
 */
import { computed, shallowRef, ref, type ComputedRef, type Ref } from 'vue';
import { dispatchPoeEvent, listenPoeEvent } from '@/utils/event-contracts';
import { enqueueLiveSearchConnections, extensionMessaging } from '@/utils/extension-protocol';
import type {
  LiveSearchEnqueueRequest,
  LiveSearchEnqueueResponse,
} from '@/utils/live-search-contract';
import { getActiveDisplayLocale, t, type I18nKey } from '@/utils/i18n';
import { resolvePageLocale } from '@/utils/locale-resolution';
import { isValidPoeCdnImageUrl } from '@/utils/poe-cdn-url';
import { parsePobBuildXml, PobBuildError, type PobBuild } from '@/utils/pob-build';
import { decodePobBuildCode, PobBuildCodeError } from '@/utils/pob-build-code';
import type { PobShareFetchError, PobShareFetchOutcome } from '@/utils/pob-share-fetch';
import { looksLikePobShareUrl } from '@/utils/pob-share-url';
import {
  createPobBuildStore,
  isValidSearchCode,
  MAX_POB_BUILDS,
  toEntrySearchSelection,
  type PobBuildStore,
  type StoredPobBuild,
  type StoredPobBuildPatch,
} from '@/utils/pob-build-store';
import {
  createPendingIconStore,
  type PendingIconStore,
  type PobSearchOpenMode,
} from '@/utils/pob-icon-pending';
import {
  applyEntrySelection,
  buildShoppingList,
  buildTradeCodeUrl,
  buildTradeSearchUrl,
  entryStatFilters,
  loadTradeNameCatalog,
  migrateLegacyGemKeys,
  type EntrySearchSelection,
  type ShoppingEntry,
  type ShoppingMod,
  type ShoppingStatFilter,
  type TradeNameCatalog,
} from '@/utils/pob-shopping-list';
import { loadModLineTranslator, type ModLineTranslator } from '@/utils/pob-mod-translator';
import { loadStatMatcher, type StatMatcher } from '@/utils/pob-stat-matcher';
import { getTradeLeague, type PoeVersion } from '@/utils/trade-context';
import { parseTradeSearchUrl } from '@/utils/trade-search-identity';
import { encodeQueryToGzipBase64Url } from '@/utils/trade-url-codec';
import { resolveSingleEnqueueToast } from '../live-search-presentation';
import {
  createPobBookmarkBridge,
  type PobBookmarkBridge,
  type PobBookmarkFolder,
} from './pob-bookmark-bridge';

export interface UsePobBuildDeps {
  store: PobBuildStore;
  pendingIcon: PendingIconStore;
  loadCatalog: (version: PoeVersion, locale: string) => Promise<TradeNameCatalog>;
  loadMatcher: (version: PoeVersion) => Promise<StatMatcher>;
  /** 把 PoB 的英文詞綴翻成顯示語言；該語言沒有對照資料時回傳 undefined */
  loadModTranslator: (
    version: PoeVersion,
    locale: string,
  ) => Promise<ModLineTranslator | undefined>;
  getDisplayLocale: () => string;
  getPageLocale: () => string;
  getLeague: () => string | undefined;
  getOrigin: () => string;
  /** 在目前分頁開啟 */
  navigate: (url: string) => void;
  /** 在新分頁開啟 */
  openUrl: (url: string) => void;
  /** 訂閱目前頁面搜尋結果的圖片；回傳取消訂閱 */
  onResultImages: (listener: (images: string[]) => void) => () => void;
  /** 顯示短暫提示 */
  showToast: (message: string, tone?: 'default' | 'error') => void;
  /** 目前頁面的網址（存回搜尋時讀取） */
  getCurrentUrl: () => string;
  /** 送進線上搜尋主控台 */
  enqueueLiveSearch: (request: LiveSearchEnqueueRequest) => Promise<LiveSearchEnqueueResponse>;
  bookmarks: PobBookmarkBridge;
  /** 在 background 取回分享網址的原始代碼 */
  fetchShareCode: (url: string) => Promise<PobShareFetchOutcome>;
  /** 開啟選用權限的授權頁 */
  openSharePermissionPage: () => Promise<boolean>;
}

export interface ShoppingRow extends ShoppingEntry {
  done: boolean;
  icon?: string;
  /** 可以勾選的搜尋條件（同一個代碼的多行已合併），已套用使用者的調整 */
  filters: ShoppingStatFilter[];
  /** 「至少符合 N 項」；未設定時為全部符合 */
  countMin?: number;
  /** 抗性、生命、能力值改用總和條件 */
  pseudo: boolean;
  /** 使用者調整過這一項的搜尋條件，或存回了市集搜尋 */
  searchCustomized: boolean;
  /** 這一項使用從市集頁面存回的搜尋（詞綴條件不套用） */
  searchOverride: boolean;
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
}

export interface UsePobBuild {
  builds: ComputedRef<BuildView[]>;
  errorKey: Ref<I18nKey | null>;
  isBusy: Ref<boolean>;
  /** 讀回上次匯入的 build 與進度；解不開的 build 略過 */
  restore(): Promise<void>;
  /**
   * 新增一份 build（PoB 代碼或分享網址）；成功回傳 true，失敗時 errorKey 說明原因，既有的
   * build 不受影響
   */
  importCode(code: string): Promise<boolean>;
  /** 開啟分享網址的授權頁（pobb.in、pastebin 需要使用者同意） */
  openSharePermissionPage(): void;
  /**
   * 換成新的 PoB 代碼，保留名稱、進度與搜尋調整，清掉新代碼裡已不存在的項目；成功回傳 true，
   * 失敗時 errorKey 說明原因，原本的清單不受影響。
   */
  updateCode(buildId: string, code: string): Promise<boolean>;
  setHideDone(buildId: string, on: boolean): void;
  rename(buildId: string, name: string): void;
  removeBuild(buildId: string): void;
  toggleCollapsed(buildId: string): void;
  selectItemSet(buildId: string, setId: string): void;
  selectSkillSet(buildId: string, setId: string): void;
  toggleDone(buildId: string, key: string): void;
  removeEntry(buildId: string, key: string): void;
  /** 把目前套裝中移除的項目全部放回清單 */
  restoreRemoved(buildId: string): void;
  /** 勾選或取消某個搜尋條件 */
  setStatEnabled(buildId: string, key: string, statId: string, enabled: boolean): void;
  /** 修改某個搜尋條件的下限或上限；null 表示不設 */
  setStatBound(
    buildId: string,
    key: string,
    statId: string,
    bound: StatBound,
    value: number | null,
  ): void;
  /** 設定「至少符合 N 項」；undefined 表示全部符合 */
  setCountMin(buildId: string, key: string, countMin: number | undefined): void;
  setPseudo(buildId: string, key: string, on: boolean): void;
  /** 清掉這一項的搜尋調整，回到預設 */
  resetSearch(buildId: string, key: string): void;
  /** 開啟該項目的市集搜尋；頁面沒有聯盟或項目無法搜尋時回傳 false */
  openSearch(buildId: string, entry: ShoppingEntry, mode: PobSearchOpenMode): boolean;
  /** 在新分頁以線上搜尋開啟 */
  openLiveSearch(buildId: string, entry: ShoppingEntry): Promise<boolean>;
  /** 送進線上搜尋主控台，結果以提示訊息告知 */
  sendToLiveSearch(buildId: string, entry: ShoppingEntry): Promise<boolean>;
  /** 把目前頁面的市集搜尋存回這一格；目前頁面不是同版本的搜尋時回傳 false */
  saveCurrentSearch(buildId: string, entry: ShoppingEntry): boolean;
  listBookmarkFolders(): Promise<PobBookmarkFolder[]>;
  addToBookmarks(buildId: string, entry: ShoppingEntry, groupId: string): Promise<boolean>;
  /** 停止等待搜尋結果圖片（元件卸載時呼叫） */
  dispose(): void;
}

interface Session {
  id: string;
  name: string;
  build: PobBuild;
  collapsed: boolean;
  hideDone: boolean;
  itemSetId: string;
  skillSetId: string;
  done: ReadonlySet<string>;
  removed: ReadonlySet<string>;
  icons: Readonly<Record<string, string>>;
  searchSelections: Readonly<Record<string, EntrySearchSelection>>;
  searchOverrides: Readonly<Record<string, string>>;
}

class VersionMismatchError extends Error {}
class ShareFetchError extends Error {
  constructor(readonly code: PobShareFetchError) {
    super(`PoB share: ${code}`);
  }
}

const SHARE_ERROR_KEYS: Readonly<Record<PobShareFetchError, I18nKey>> = {
  'invalid-url': 'pobBuild.error.share.invalidUrl',
  permission: 'pobBuild.error.share.permission',
  'not-found': 'pobBuild.error.share.notFound',
  http: 'pobBuild.error.share.http',
  timeout: 'pobBuild.error.share.timeout',
  network: 'pobBuild.error.share.network',
  'too-large': 'pobBuild.error.tooLarge',
  invalid: 'pobBuild.error.share.invalid',
};
class TooManyBuildsError extends Error {}

async function loadExtensionJson(path: string): Promise<unknown> {
  const response = await fetch(chrome.runtime.getURL(`/${path}`));
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

function createDefaultDeps(version: PoeVersion): UsePobBuildDeps {
  return {
    store: createPobBuildStore(version),
    pendingIcon: createPendingIconStore(version),
    loadCatalog: (catalogVersion, locale) =>
      loadTradeNameCatalog(loadExtensionJson, { version: catalogVersion, locale }),
    loadMatcher: (matcherVersion) => loadStatMatcher(loadExtensionJson, matcherVersion),
    loadModTranslator: (translatorVersion, locale) =>
      loadModLineTranslator(loadExtensionJson, { version: translatorVersion, locale }),
    getDisplayLocale: () => getActiveDisplayLocale(),
    getPageLocale: () => resolvePageLocale(),
    getLeague: () => getTradeLeague(window.location.pathname),
    getOrigin: () => window.location.origin,
    navigate: (url) => {
      window.location.href = url;
    },
    openUrl: (url) => {
      window.open(url, '_blank', 'noopener,noreferrer');
    },
    onResultImages: (listener) => {
      const stop = listenPoeEvent('poexd-result-images', (detail) =>
        listener(Array.isArray(detail.images) ? detail.images : []),
      );
      dispatchPoeEvent('poexd-request-result-images');
      return stop;
    },
    showToast: (message, tone = 'default') => {
      dispatchPoeEvent('poexd-toast', { message, tone, durationMs: 4000 });
    },
    getCurrentUrl: () => window.location.href,
    enqueueLiveSearch: (request) =>
      enqueueLiveSearchConnections(request, {
        timeoutMessage: t('pobBuild.toast.consoleFailed'),
      }),
    bookmarks: createPobBookmarkBridge(version),
    fetchShareCode: (url) => extensionMessaging.sendMessage('pobShare:fetchCode', { url }),
    openSharePermissionPage: () => extensionMessaging.sendMessage('pobShare:openPermissionPage'),
  };
}

function toErrorKey(error: unknown): I18nKey {
  if (error instanceof VersionMismatchError) return 'pobBuild.error.versionMismatch';
  if (error instanceof ShareFetchError) return SHARE_ERROR_KEYS[error.code];
  if (error instanceof TooManyBuildsError) return 'pobBuild.error.tooMany';
  if (error instanceof PobBuildCodeError) {
    if (error.code === 'empty') return 'pobBuild.error.empty';
    if (error.code === 'too-large') return 'pobBuild.error.tooLarge';
    return 'pobBuild.error.invalid';
  }
  if (error instanceof PobBuildError) return 'pobBuild.error.invalid';
  return 'pobBuild.error.catalog';
}

const toOptions = (sets: ReadonlyArray<{ id: string; title: string }>): SetOption[] =>
  sets.map((set, index) => ({ id: set.id, title: set.title, position: index + 1 }));

const defaultName = (build: PobBuild): string =>
  `${build.ascendancy || build.className || 'Build'} Lv.${build.level}`;

/** 以 key 為鍵的物件只留下 keep 裡的 key */
const pickKeys = <T>(source: Readonly<Record<string, T>>, keep: ReadonlySet<string>) =>
  Object.fromEntries(Object.entries(source).filter(([key]) => keep.has(key)));

/** 舊版存下的寶石 key 換成新格式；icons 這類以 key 為鍵的物件一併換 */
const migrateKeyedRecord = <T>(build: PobBuild, source: Readonly<Record<string, T>>) =>
  Object.fromEntries(
    Object.entries(source).flatMap(([key, value]) =>
      migrateLegacyGemKeys(build, [key]).map((next) => [next, value] as const),
    ),
  );

const sameList = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const withToggled = (source: ReadonlySet<string>, key: string, on: boolean): Set<string> => {
  const next = new Set(source);
  if (on) next.add(key);
  else next.delete(key);
  return next;
};

export function usePobBuild(
  version: PoeVersion,
  overrides: Partial<UsePobBuildDeps> = {},
): UsePobBuild {
  const deps = { ...createDefaultDeps(version), ...overrides };
  const sessions = shallowRef<Session[]>([]);
  const catalog = shallowRef<TradeNameCatalog | null>(null);
  const matcher = shallowRef<StatMatcher | undefined>(undefined);
  const modTranslator = shallowRef<ModLineTranslator | undefined>(undefined);
  const displayNames = shallowRef<TradeNameCatalog | undefined>(undefined);
  const errorKey = ref<I18nKey | null>(null);
  const isBusy = ref(false);
  let stopWaitingForIcon: (() => void) | undefined;

  /**
   * 名稱資料必要（載不到就無法搜尋）。詞綴對應與翻譯載不到時仍可用，只是稀有裝少了詞綴條件、
   * 詞綴維持英文。
   */
  const ensureData = async (): Promise<void> => {
    if (catalog.value) return;
    const pageLocale = deps.getPageLocale();
    const displayLocale = deps.getDisplayLocale();
    const [loadedCatalog, loadedMatcher, loadedTranslator, loadedDisplayNames] = await Promise.all([
      deps.loadCatalog(version, pageLocale),
      deps.loadMatcher(version).catch(() => undefined),
      deps.loadModTranslator(version, displayLocale).catch(() => undefined),
      // 顯示語言和頁面區服不同時（例如國際服頁面配中文介面），名稱另外用顯示語言呈現
      displayLocale === pageLocale
        ? undefined
        : deps.loadCatalog(version, displayLocale).catch(() => undefined),
    ]);
    displayNames.value = loadedDisplayNames;
    catalog.value = loadedCatalog;
    matcher.value = loadedMatcher;
    modTranslator.value = loadedTranslator;
  };

  const listFor = (build: PobBuild, itemSetId: string, skillSetId: string): ShoppingEntry[] =>
    catalog.value
      ? buildShoppingList(build, catalog.value, { itemSetId, skillSetId }, matcher.value)
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
    (displayNames.value ?? catalog.value)?.toTradeName(skill) ?? skill;

  /** 詞綴顯示用顯示語言；翻不了的維持 PoB 的英文 */
  const localizeMod = (mod: ShoppingMod): ShoppingMod => {
    const translated = modTranslator.value?.translate(mod.text);
    return translated ? { ...mod, text: translated } : mod;
  };

  const toRow = (session: Session, entry: ShoppingEntry): ShoppingRow => {
    const selection = session.searchSelections[entry.key];
    const applied = applyEntrySelection(entry, selection);
    return {
      ...applied,
      label: displayNames.value?.toTradeName(entry.englishName) ?? entry.label,
      ...(applied.mods ? { mods: applied.mods.map(localizeMod) } : {}),
      done: session.done.has(entry.key),
      ...(session.icons[entry.key] ? { icon: session.icons[entry.key] } : {}),
      filters: entryStatFilters(entry, selection),
      ...(selection?.countMin !== undefined ? { countMin: selection.countMin } : {}),
      pseudo: selection?.pseudo === true,
      searchCustomized: selection !== undefined || session.searchOverrides[entry.key] !== undefined,
      searchOverride: session.searchOverrides[entry.key] !== undefined,
    };
  };

  /** 依清單順序切成分組；已完成的項目沉到所屬分組最下面，隱藏已完成時直接略過 */
  const toGroups = (session: Session, entries: readonly ShoppingEntry[]): ShoppingGroup[] => {
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
      groups.set(id, { ...group, rows: [...group.rows, toRow(session, entry)] });
    }
    return [...groups.values()]
      .map((group) => ({
        ...group,
        rows: session.hideDone
          ? group.rows.filter((row) => !row.done)
          : [...group.rows.filter((row) => !row.done), ...group.rows.filter((row) => row.done)],
      }))
      .filter((group) => group.rows.length > 0);
  };

  const toView = (session: Session): BuildView => {
    const entries = entriesOf(session);
    const visible = entries.filter((entry) => !session.removed.has(entry.key));
    return {
      id: session.id,
      name: session.name,
      collapsed: session.collapsed,
      itemSetOptions: toOptions(session.build.itemSets),
      skillSetOptions: toOptions(session.build.skillSets),
      itemSetId: session.itemSetId,
      skillSetId: session.skillSetId,
      groups: toGroups(session, visible),
      progress: {
        done: visible.filter((entry) => session.done.has(entry.key)).length,
        total: visible.length,
      },
      hideDone: session.hideDone,
      removedCount: entries.length - visible.length,
    };
  };

  const find = (buildId: string) => sessions.value.find((session) => session.id === buildId);

  /** 更新一份 build 的畫面狀態並存回本機；存不進去不影響目前畫面 */
  const update = (buildId: string, change: Partial<Session>, patch: StoredPobBuildPatch) => {
    if (!find(buildId)) return;
    sessions.value = sessions.value.map((session) =>
      session.id === buildId ? { ...session, ...change } : session,
    );
    void deps.store.update(buildId, patch).catch(() => undefined);
  };

  /** 輸入是分享網址時先取回原始代碼；其餘視為 PoB 代碼，去掉空白 */
  const resolveInputCode = async (input: unknown): Promise<string> => {
    const text = typeof input === 'string' ? input : '';
    if (!looksLikePobShareUrl(text)) return text.replace(/\s+/g, '');
    const outcome = await deps
      .fetchShareCode(text.trim())
      .catch((): PobShareFetchOutcome => ({ ok: false, error: 'network' }));
    if (!outcome?.ok) throw new ShareFetchError(outcome?.error ?? 'network');
    return outcome.code.replace(/\s+/g, '');
  };

  /** 解開代碼並確認遊戲版本與目前頁面相同 */
  const decodeBuild = async (code: string): Promise<PobBuild> => {
    const build = parsePobBuildXml(await decodePobBuildCode(code));
    if (build.gameVersion !== version) throw new VersionMismatchError();
    return build;
  };

  /** 舊版的寶石 key 不含分組，讀回時換成新格式並存回本機 */
  const migrateStored = (stored: StoredPobBuild, build: PobBuild): StoredPobBuild => {
    const done = migrateLegacyGemKeys(build, stored.done);
    const removed = migrateLegacyGemKeys(build, stored.removed);
    const icons = migrateKeyedRecord(build, stored.icons);
    if (
      sameList(done, stored.done) &&
      sameList(removed, stored.removed) &&
      sameList(Object.keys(icons), Object.keys(stored.icons))
    ) {
      return stored;
    }
    void deps.store.update(stored.id, { done, removed, icons }).catch(() => undefined);
    return { ...stored, done, removed, icons };
  };

  const toSession = async (source: StoredPobBuild): Promise<Session> => {
    const build = await decodeBuild(source.code);
    const stored = migrateStored(source, build);
    const pick = (
      sets: ReadonlyArray<{ id: string }>,
      wanted: string | undefined,
      active: string,
    ) => (wanted && sets.some((set) => set.id === wanted) ? wanted : active);
    return {
      id: stored.id,
      name: stored.name || defaultName(build),
      build,
      collapsed: stored.collapsed,
      hideDone: stored.hideDone,
      itemSetId: pick(build.itemSets, stored.itemSetId, build.activeItemSetId),
      skillSetId: pick(build.skillSets, stored.skillSetId, build.activeSkillSetId),
      done: new Set(stored.done),
      removed: new Set(stored.removed),
      icons: stored.icons,
      searchSelections: stored.searchSelections,
      searchOverrides: stored.searchOverrides,
    };
  };

  /** 修改一個項目的搜尋調整；調整完沒有內容時移除，回到預設 */
  const updateSelection = (
    buildId: string,
    key: string,
    change: (current: EntrySearchSelection) => EntrySearchSelection,
  ) => {
    const session = find(buildId);
    if (!session) return;
    const next = toEntrySearchSelection(change(session.searchSelections[key] ?? {}));
    const { [key]: _previous, ...rest } = session.searchSelections;
    const searchSelections = next ? { ...rest, [key]: next } : rest;
    update(buildId, { searchSelections }, { searchSelections });
  };

  const updateStat = (
    buildId: string,
    key: string,
    statId: string,
    change: Record<string, unknown>,
  ) =>
    updateSelection(buildId, key, (current) => ({
      ...current,
      stats: { ...current.stats, [statId]: { ...current.stats?.[statId], ...change } },
    }));

  /** 目前頁面的聯盟；沒有時記下錯誤並回傳 undefined */
  const requireLeague = (): string | undefined => {
    const league = deps.getLeague();
    if (!league) {
      errorKey.value = 'pobBuild.error.noLeague';
      return undefined;
    }
    errorKey.value = null;
    return league;
  };

  /**
   * 以搜尋代碼組成的固定網址（主控台、書籤、線上搜尋用）：有存回的搜尋就用它，否則把目前條件
   * 編成代碼。項目無法搜尋或頁面沒有聯盟時回傳 undefined。
   */
  const resolveCodeUrl = async (
    buildId: string,
    entry: ShoppingEntry,
  ): Promise<string | undefined> => {
    const session = find(buildId);
    const override = session?.searchOverrides[entry.key];
    if (!session || (!override && !entry.query)) return undefined;
    const league = requireLeague();
    if (!league) return undefined;
    const code = override ?? (await encodeQueryToGzipBase64Url(entry.query));
    return buildTradeCodeUrl({ origin: deps.getOrigin(), version, league, code });
  };

  const iconOf = (buildId: string, key: string): string | undefined => find(buildId)?.icons[key];

  const updateOverrides = (
    buildId: string,
    change: (current: Record<string, string>) => Record<string, string>,
  ) => {
    const session = find(buildId);
    if (!session) return;
    const searchOverrides = change({ ...session.searchOverrides });
    update(buildId, { searchOverrides }, { searchOverrides });
  };

  /** 這個頁面是從某個項目開啟的搜尋：第一批結果圖片就是那個項目的圖片 */
  const captureIconFromResults = async (): Promise<void> => {
    const pending = await deps.pendingIcon.take();
    if (!pending || !find(pending.buildId)) return;
    stopWaitingForIcon?.();
    stopWaitingForIcon = deps.onResultImages((images) => {
      const icon = images.find((image) => isValidPoeCdnImageUrl(image));
      const session = find(pending.buildId);
      if (!icon || !session) return;
      stopWaitingForIcon?.();
      stopWaitingForIcon = undefined;
      const icons = { ...session.icons, [pending.entryKey]: icon };
      update(pending.buildId, { icons }, { icons });
    });
  };

  return {
    builds: computed(() => sessions.value.map(toView)),
    errorKey,
    isBusy,
    async restore() {
      const stored = await deps.store.list().catch(() => []);
      if (stored.length === 0) return;
      try {
        await ensureData();
      } catch {
        // 名稱資料載不到時沒有清單可顯示；維持空白，使用者重新匯入時會看到錯誤
        return;
      }
      const restored = await Promise.all(
        stored.map((entry) => toSession(entry).catch(() => undefined)),
      );
      sessions.value = restored.filter((session): session is Session => session !== undefined);
      await captureIconFromResults();
    },
    async importCode(code) {
      isBusy.value = true;
      errorKey.value = null;
      try {
        if (sessions.value.length >= MAX_POB_BUILDS) throw new TooManyBuildsError();
        const compactCode = await resolveInputCode(code);
        const build = await decodeBuild(compactCode);
        await ensureData();
        const stored = await deps.store.add({ name: defaultName(build), code: compactCode });
        sessions.value = [await toSession(stored), ...sessions.value];
        return true;
      } catch (error) {
        errorKey.value = toErrorKey(error);
        return false;
      } finally {
        isBusy.value = false;
      }
    },
    async updateCode(buildId, code) {
      isBusy.value = true;
      errorKey.value = null;
      try {
        const session = find(buildId);
        if (!session) return false;
        const compactCode = await resolveInputCode(code);
        const build = await decodeBuild(compactCode);
        await ensureData();
        const keep = allKeysOf(build);
        const patch = {
          done: [...session.done].filter((key) => keep.has(key)),
          removed: [...session.removed].filter((key) => keep.has(key)),
          icons: pickKeys(session.icons, keep),
          searchSelections: pickKeys(session.searchSelections, keep),
          searchOverrides: pickKeys(session.searchOverrides, keep),
        };
        if (!(await deps.store.replaceCode(buildId, compactCode, patch))) return false;
        const before = new Set(entriesOf(session).map((entry) => entry.key));
        const next = await toSession({
          id: session.id,
          name: session.name,
          code: compactCode,
          importedAt: 0,
          collapsed: session.collapsed,
          hideDone: session.hideDone,
          itemSetId: session.itemSetId,
          skillSetId: session.skillSetId,
          ...patch,
        });
        sessions.value = sessions.value.map((entry) => (entry.id === buildId ? next : entry));
        const after = entriesOf(next).map((entry) => entry.key);
        deps.showToast(
          t('pobBuild.updateCode.summary', {
            kept: after.filter((key) => before.has(key) && next.done.has(key)).length,
            added: after.filter((key) => !before.has(key)).length,
            removed: [...before].filter((key) => !after.includes(key)).length,
          }),
        );
        return true;
      } catch (error) {
        errorKey.value = toErrorKey(error);
        return false;
      } finally {
        isBusy.value = false;
      }
    },
    openSharePermissionPage() {
      void deps.openSharePermissionPage().catch(() => false);
    },
    setHideDone(buildId, on) {
      update(buildId, { hideDone: on }, { hideDone: on });
    },
    rename(buildId, name) {
      const trimmed = name.trim();
      if (!trimmed) return;
      update(buildId, { name: trimmed }, { name: trimmed });
    },
    removeBuild(buildId) {
      sessions.value = sessions.value.filter((session) => session.id !== buildId);
      void deps.store.remove(buildId).catch(() => undefined);
    },
    toggleCollapsed(buildId) {
      const collapsed = !find(buildId)?.collapsed;
      update(buildId, { collapsed }, { collapsed });
    },
    selectItemSet(buildId, setId) {
      if (!find(buildId)?.build.itemSets.some((set) => set.id === setId)) return;
      update(buildId, { itemSetId: setId }, { itemSetId: setId });
    },
    selectSkillSet(buildId, setId) {
      if (!find(buildId)?.build.skillSets.some((set) => set.id === setId)) return;
      update(buildId, { skillSetId: setId }, { skillSetId: setId });
    },
    toggleDone(buildId, key) {
      const session = find(buildId);
      if (!session) return;
      const done = withToggled(session.done, key, !session.done.has(key));
      update(buildId, { done }, { done: [...done] });
    },
    removeEntry(buildId, key) {
      const session = find(buildId);
      if (!session) return;
      const removed = withToggled(session.removed, key, true);
      update(buildId, { removed }, { removed: [...removed] });
    },
    restoreRemoved(buildId) {
      const session = find(buildId);
      if (!session) return;
      const current = new Set(entriesOf(session).map((entry) => entry.key));
      const removed = new Set([...session.removed].filter((key) => !current.has(key)));
      update(buildId, { removed }, { removed: [...removed] });
    },
    setStatEnabled(buildId, key, statId, enabled) {
      updateStat(buildId, key, statId, { enabled });
    },
    setStatBound(buildId, key, statId, bound, value) {
      if (value !== null && !Number.isFinite(value)) return;
      updateStat(buildId, key, statId, { [bound]: value });
    },
    setCountMin(buildId, key, countMin) {
      updateSelection(buildId, key, ({ countMin: _previous, ...current }) =>
        countMin === undefined ? current : { ...current, countMin },
      );
    },
    setPseudo(buildId, key, on) {
      updateSelection(buildId, key, ({ pseudo: _previous, ...current }) =>
        on ? { ...current, pseudo: true } : current,
      );
    },
    resetSearch(buildId, key) {
      updateSelection(buildId, key, () => ({}));
      if (find(buildId)?.searchOverrides[key] !== undefined) {
        updateOverrides(buildId, ({ [key]: _removed, ...rest }) => rest);
      }
    },
    openSearch(buildId, entry, mode) {
      const session = find(buildId);
      const override = session?.searchOverrides[entry.key];
      if (!session || (!override && !entry.query)) return false;
      const league = requireLeague();
      if (!league) return false;
      const origin = deps.getOrigin();
      const url = override
        ? buildTradeCodeUrl({ origin, version, league, code: override })
        : buildTradeSearchUrl({ origin, version, league, query: entry.query! });
      deps.pendingIcon.save({ buildId, entryKey: entry.key }, mode, url);
      if (mode === 'current') deps.navigate(url);
      else deps.openUrl(url);
      return true;
    },
    async openLiveSearch(buildId, entry) {
      const url = await resolveCodeUrl(buildId, entry);
      if (!url) return false;
      deps.openUrl(`${url}/live`);
      return true;
    },
    async sendToLiveSearch(buildId, entry) {
      const url = await resolveCodeUrl(buildId, entry);
      const session = find(buildId);
      if (!url || !session) return false;
      const name = `${session.name} · ${entry.label}`;
      const icon = iconOf(buildId, entry.key);
      try {
        const response = await deps.enqueueLiveSearch({
          gameVersion: version,
          items: [{ url, name, ...(icon ? { coverImageUrl: icon } : {}) }],
        });
        const toast = resolveSingleEnqueueToast(response, name);
        deps.showToast(toast.message, toast.tone === 'error' ? 'error' : 'default');
        return response.success;
      } catch (error) {
        deps.showToast(
          error instanceof Error && error.message
            ? error.message
            : t('pobBuild.toast.consoleFailed'),
          'error',
        );
        return false;
      }
    },
    saveCurrentSearch(buildId, entry) {
      if (!find(buildId)) return false;
      const parsed = parseTradeSearchUrl(deps.getCurrentUrl());
      const code = parsed?.searchId;
      if (!parsed || parsed.gameVersion !== version || !isValidSearchCode(code)) {
        deps.showToast(t('pobBuild.toast.overrideInvalid'), 'error');
        return false;
      }
      updateOverrides(buildId, (current) => ({ ...current, [entry.key]: code }));
      deps.showToast(t('pobBuild.toast.overrideSaved', { name: entry.label }));
      return true;
    },
    listBookmarkFolders() {
      return deps.bookmarks.listFolders().catch(() => []);
    },
    async addToBookmarks(buildId, entry, groupId) {
      const url = await resolveCodeUrl(buildId, entry);
      if (!url) return false;
      const icon = iconOf(buildId, entry.key);
      const result = await deps.bookmarks
        .add({ groupId, name: entry.label, url, ...(icon ? { coverImageUrl: icon } : {}) })
        .catch(() => ({ ok: false as const }));
      deps.showToast(
        result.ok
          ? t('pobBuild.toast.bookmarkAdded', { name: result.name })
          : t('pobBuild.toast.bookmarkFailed'),
        result.ok ? 'default' : 'error',
      );
      return result.ok;
    },
    dispose() {
      stopWaitingForIcon?.();
      stopWaitingForIcon = undefined;
      deps.bookmarks.dispose();
    },
  };
}
