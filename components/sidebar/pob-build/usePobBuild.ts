/**
 * PoB 購物清單的狀態：多份 build 並存，各自記住選用的套裝、已完成與已移除的項目，以及從
 * 搜尋結果擷取的圖片。代碼與進度都存在本機。
 */
import { computed, shallowRef, ref, type ComputedRef, type Ref } from 'vue';
import { dispatchPoeEvent, listenPoeEvent } from '@/utils/event-contracts';
import { getActiveDisplayLocale, type I18nKey } from '@/utils/i18n';
import { resolvePageLocale } from '@/utils/locale-resolution';
import { isValidPoeCdnImageUrl } from '@/utils/poe-cdn-url';
import { parsePobBuildXml, PobBuildError, type PobBuild } from '@/utils/pob-build';
import { decodePobBuildCode, PobBuildCodeError } from '@/utils/pob-build-code';
import {
  createPobBuildStore,
  MAX_POB_BUILDS,
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
  buildShoppingList,
  buildTradeSearchUrl,
  loadTradeNameCatalog,
  type ShoppingEntry,
  type ShoppingEntryKind,
  type ShoppingMod,
  type TradeNameCatalog,
} from '@/utils/pob-shopping-list';
import { loadModLineTranslator, type ModLineTranslator } from '@/utils/pob-mod-translator';
import { loadStatMatcher, type StatMatcher } from '@/utils/pob-stat-matcher';
import { getTradeLeague, type PoeVersion } from '@/utils/trade-context';

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
}

export interface ShoppingRow extends ShoppingEntry {
  done: boolean;
  icon?: string;
}

export interface ShoppingGroup {
  kind: ShoppingEntryKind;
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
  /** 目前套裝的清單，不含已移除的項目 */
  groups: ShoppingGroup[];
  progress: { done: number; total: number };
  /** 目前套裝中被移除的項目數 */
  removedCount: number;
}

export interface UsePobBuild {
  builds: ComputedRef<BuildView[]>;
  errorKey: Ref<I18nKey | null>;
  isBusy: Ref<boolean>;
  /** 讀回上次匯入的 build 與進度；解不開的 build 略過 */
  restore(): Promise<void>;
  /** 新增一份 build；成功回傳 true，失敗時 errorKey 說明原因，既有的 build 不受影響 */
  importCode(code: string): Promise<boolean>;
  rename(buildId: string, name: string): void;
  removeBuild(buildId: string): void;
  toggleCollapsed(buildId: string): void;
  selectItemSet(buildId: string, setId: string): void;
  selectSkillSet(buildId: string, setId: string): void;
  toggleDone(buildId: string, key: string): void;
  removeEntry(buildId: string, key: string): void;
  /** 把目前套裝中移除的項目全部放回清單 */
  restoreRemoved(buildId: string): void;
  /** 開啟該項目的市集搜尋；頁面沒有聯盟或項目無法搜尋時回傳 false */
  openSearch(buildId: string, entry: ShoppingEntry, mode: PobSearchOpenMode): boolean;
  /** 停止等待搜尋結果圖片（元件卸載時呼叫） */
  dispose(): void;
}

interface Session {
  id: string;
  name: string;
  build: PobBuild;
  collapsed: boolean;
  itemSetId: string;
  skillSetId: string;
  done: ReadonlySet<string>;
  removed: ReadonlySet<string>;
  icons: Readonly<Record<string, string>>;
}

const GROUP_ORDER: readonly ShoppingEntryKind[] = ['unique', 'equipment', 'gem'];

class VersionMismatchError extends Error {}
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
  };
}

function toErrorKey(error: unknown): I18nKey {
  if (error instanceof VersionMismatchError) return 'pobBuild.error.versionMismatch';
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

  const entriesOf = (session: Session): ShoppingEntry[] =>
    catalog.value
      ? buildShoppingList(
          session.build,
          catalog.value,
          { itemSetId: session.itemSetId, skillSetId: session.skillSetId },
          matcher.value,
        )
      : [];

  /** 詞綴顯示用顯示語言；翻不了的維持 PoB 的英文 */
  const localizeMod = (mod: ShoppingMod): ShoppingMod => {
    const translated = modTranslator.value?.translate(mod.text);
    return translated ? { ...mod, text: translated } : mod;
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
      groups: GROUP_ORDER.map((kind) => ({
        kind,
        rows: visible
          .filter((entry) => entry.kind === kind)
          .map((entry) => ({
            ...entry,
            label: displayNames.value?.toTradeName(entry.englishName) ?? entry.label,
            ...(entry.mods ? { mods: entry.mods.map(localizeMod) } : {}),
            done: session.done.has(entry.key),
            ...(session.icons[entry.key] ? { icon: session.icons[entry.key] } : {}),
          })),
      })).filter((group) => group.rows.length > 0),
      progress: {
        done: visible.filter((entry) => session.done.has(entry.key)).length,
        total: visible.length,
      },
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

  const toSession = async (stored: StoredPobBuild): Promise<Session> => {
    const build = parsePobBuildXml(await decodePobBuildCode(stored.code));
    if (build.gameVersion !== version) throw new VersionMismatchError();
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
      itemSetId: pick(build.itemSets, stored.itemSetId, build.activeItemSetId),
      skillSetId: pick(build.skillSets, stored.skillSetId, build.activeSkillSetId),
      done: new Set(stored.done),
      removed: new Set(stored.removed),
      icons: stored.icons,
    };
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
        const compactCode = typeof code === 'string' ? code.replace(/\s+/g, '') : '';
        const build = parsePobBuildXml(await decodePobBuildCode(compactCode));
        if (build.gameVersion !== version) throw new VersionMismatchError();
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
    openSearch(buildId, entry, mode) {
      const league = deps.getLeague();
      if (!entry.query || !find(buildId)) return false;
      if (!league) {
        errorKey.value = 'pobBuild.error.noLeague';
        return false;
      }
      errorKey.value = null;
      const url = buildTradeSearchUrl({
        origin: deps.getOrigin(),
        version,
        league,
        query: entry.query,
      });
      deps.pendingIcon.save({ buildId, entryKey: entry.key }, mode, url);
      if (mode === 'current') deps.navigate(url);
      else deps.openUrl(url);
      return true;
    },
    dispose() {
      stopWaitingForIcon?.();
      stopWaitingForIcon = undefined;
    },
  };
}
