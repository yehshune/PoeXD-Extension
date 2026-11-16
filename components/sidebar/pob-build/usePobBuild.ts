/**
 * PoB build 匯入與購物清單的狀態：解碼、解析、轉成市集搜尋，並記住上次匯入的代碼。
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue';
import type { I18nKey } from '@/utils/i18n';
import { resolvePageLocale } from '@/utils/locale-resolution';
import { parsePobBuildXml, PobBuildError, type PobBuild } from '@/utils/pob-build';
import { decodePobBuildCode, PobBuildCodeError } from '@/utils/pob-build-code';
import { createPobBuildStore, type PobBuildStore } from '@/utils/pob-build-store';
import {
  buildShoppingList,
  buildTradeSearchUrl,
  loadTradeNameCatalog,
  type ShoppingEntry,
  type ShoppingEntryKind,
  type TradeNameCatalog,
} from '@/utils/pob-shopping-list';
import { getTradeLeague, type PoeVersion } from '@/utils/trade-context';

export interface UsePobBuildDeps {
  store: PobBuildStore;
  loadCatalog: (version: PoeVersion, locale: string) => Promise<TradeNameCatalog>;
  getPageLocale: () => string;
  getLeague: () => string | undefined;
  getOrigin: () => string;
  openUrl: (url: string) => void;
}

export interface ShoppingGroup {
  kind: ShoppingEntryKind;
  entries: ShoppingEntry[];
}

export interface UsePobBuild {
  build: Ref<PobBuild | null>;
  groups: ComputedRef<ShoppingGroup[]>;
  errorKey: Ref<I18nKey | null>;
  isBusy: Ref<boolean>;
  /** 讀回上次匯入的 build；沒有或讀取失敗時維持空白 */
  restore(): Promise<void>;
  /** 匯入成功回傳 true；失敗時 errorKey 說明原因，原本的 build 不受影響 */
  importCode(code: string): Promise<boolean>;
  clear(): Promise<void>;
  /** 開啟該項目的市集搜尋；頁面沒有聯盟或項目無法搜尋時回傳 false */
  openSearch(entry: ShoppingEntry): boolean;
}

const GROUP_ORDER: readonly ShoppingEntryKind[] = ['unique', 'equipment', 'gem'];

async function loadExtensionJson(path: string): Promise<unknown> {
  const response = await fetch(chrome.runtime.getURL(`/${path}`));
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

function createDefaultDeps(version: PoeVersion): UsePobBuildDeps {
  return {
    store: createPobBuildStore(version),
    loadCatalog: (catalogVersion, locale) =>
      loadTradeNameCatalog(loadExtensionJson, { version: catalogVersion, locale }),
    getPageLocale: () => resolvePageLocale(),
    getLeague: () => getTradeLeague(window.location.pathname),
    getOrigin: () => window.location.origin,
    openUrl: (url) => {
      window.open(url, '_blank', 'noopener,noreferrer');
    },
  };
}

function toErrorKey(error: unknown): I18nKey {
  if (error instanceof PobBuildCodeError) {
    if (error.code === 'empty') return 'tools.pobBuild.error.empty';
    if (error.code === 'too-large') return 'tools.pobBuild.error.tooLarge';
    return 'tools.pobBuild.error.invalid';
  }
  if (error instanceof PobBuildError) return 'tools.pobBuild.error.invalid';
  return 'tools.pobBuild.error.catalog';
}

export function usePobBuild(
  version: PoeVersion,
  overrides: Partial<UsePobBuildDeps> = {},
): UsePobBuild {
  const deps = { ...createDefaultDeps(version), ...overrides };
  const build = ref<PobBuild | null>(null);
  const entries = ref<ShoppingEntry[]>([]);
  const errorKey = ref<I18nKey | null>(null);
  const isBusy = ref(false);

  const groups = computed(() =>
    GROUP_ORDER.map((kind) => ({
      kind,
      entries: entries.value.filter((entry) => entry.kind === kind),
    })).filter((group) => group.entries.length > 0),
  );

  /** 解碼並套用；任何一步失敗都丟出錯誤，不改動目前的狀態 */
  const apply = async (code: string): Promise<void> => {
    const parsed = parsePobBuildXml(await decodePobBuildCode(code));
    if (parsed.gameVersion !== version) throw new VersionMismatchError();
    const catalog = await deps.loadCatalog(version, deps.getPageLocale());
    build.value = parsed;
    entries.value = buildShoppingList(parsed, catalog);
  };

  const run = async (task: () => Promise<void>): Promise<boolean> => {
    isBusy.value = true;
    errorKey.value = null;
    try {
      await task();
      return true;
    } catch (error) {
      errorKey.value =
        error instanceof VersionMismatchError
          ? 'tools.pobBuild.error.versionMismatch'
          : toErrorKey(error);
      return false;
    } finally {
      isBusy.value = false;
    }
  };

  return {
    build,
    groups,
    errorKey,
    isBusy,
    async restore() {
      const stored = await deps.store.load().catch(() => undefined);
      if (!stored) return;
      // 上次存的代碼現在解不開（例如資料分片載入失敗）時不顯示錯誤，維持空白即可
      const restored = await run(() => apply(stored.code));
      if (!restored) errorKey.value = null;
    },
    importCode: (code) =>
      run(async () => {
        await apply(code);
        await deps.store.save(code.replace(/\s+/g, ''));
      }),
    async clear() {
      build.value = null;
      entries.value = [];
      errorKey.value = null;
      await deps.store.clear().catch(() => undefined);
    },
    openSearch(entry) {
      const league = deps.getLeague();
      if (!entry.query) return false;
      if (!league) {
        errorKey.value = 'tools.pobBuild.error.noLeague';
        return false;
      }
      errorKey.value = null;
      deps.openUrl(
        buildTradeSearchUrl({ origin: deps.getOrigin(), version, league, query: entry.query }),
      );
      return true;
    },
  };
}

class VersionMismatchError extends Error {}
