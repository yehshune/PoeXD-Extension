/**
 * 匯入的 PoB build 與購物清單進度只存在本機（chrome.storage.local），依遊戲版本各存一份清單，
 * 不上傳、也不納入書籤匯出。存的是原始代碼，讀出時重新解碼，資料模型改版時不必搬遷。
 */
import { isValidPoeCdnImageUrl } from './poe-cdn-url';
import type { EntrySearchSelection, StatSelection } from './pob-shopping-list';
import { isGzipHash } from './trade-url-codec';
import type { PoeVersion } from './trade-context';

export interface PobBuildStorage {
  get(keys: readonly string[]): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
  /** 訂閱鍵值變更（含其他分頁的寫入）；回傳取消訂閱。沒有提供時不做跨分頁同步 */
  onChanged?(listener: (changedKeys: readonly string[]) => void): () => void;
}

export interface StoredPobBuild {
  id: string;
  /** 使用者可以改的顯示名稱 */
  name: string;
  code: string;
  importedAt: number;
  /** 清單收合 */
  collapsed: boolean;
  /** 隱藏已完成的項目 */
  hideDone: boolean;
  itemSetId?: string;
  skillSetId?: string;
  /** 已完成、已移除的項目（ShoppingEntry.key） */
  done: string[];
  removed: string[];
  /** 項目的圖片（ShoppingEntry.key → 官方 CDN 圖片網址），由搜尋結果擷取 */
  icons: Record<string, string>;
  /** 使用者調整過的搜尋條件（ShoppingEntry.key → 調整內容） */
  searchSelections: Record<string, EntrySearchSelection>;
  /**
   * 從市集頁面存回的搜尋（ShoppingEntry.key → 官方搜尋代碼）。有覆寫時開啟搜尋改用這個代碼，
   * 聯盟不跟著存，開啟時用目前頁面的聯盟。
   */
  searchOverrides: Record<string, string>;
}

export type StoredPobBuildPatch = Partial<Omit<StoredPobBuild, 'id' | 'code' | 'importedAt'>>;

/** 已達可保留的 build 數量上限（以本機最新的清單判斷，其他分頁新增的也算） */
export class PobBuildLimitError extends Error {
  constructor() {
    super('PoB build limit reached');
    this.name = 'PobBuildLimitError';
  }
}

export interface PobBuildStore {
  list(): Promise<StoredPobBuild[]>;
  /** 新增一份 build，放在清單最前面；已達上限時丟出 PobBuildLimitError，不會擠掉既有的 build */
  add(entry: { name: string; code: string }): Promise<StoredPobBuild>;
  /** 更新指定 build；該 build 已不存在時不做事 */
  update(id: string, patch: StoredPobBuildPatch): Promise<void>;
  /**
   * 以本機最新的 build 內容計算 patch 再寫回（讀出、修改、寫回在同一個排隊步驟內），
   * 其他分頁剛寫入的進度不會被這個分頁記憶體裡的舊資料蓋掉。該 build 已不存在時不做事。
   */
  mutate(id: string, change: (current: StoredPobBuild) => StoredPobBuildPatch): Promise<void>;
  /** 訂閱這個遊戲版本清單的變更（含其他分頁）；回傳取消訂閱 */
  subscribe(listener: () => void): () => void;
  /**
   * 換成新的 PoB 代碼，名稱、進度與搜尋調整保留，同時套用 patch（清掉已不存在的項目）。
   * 該 build 已不存在時回傳 false。
   */
  replaceCode(
    id: string,
    code: string,
    patch: StoredPobBuildPatch | ((current: StoredPobBuild) => StoredPobBuildPatch),
  ): Promise<boolean>;
  remove(id: string): Promise<void>;
}

export const POB_BUILD_NAME_MAX_LENGTH = 60;
export const MAX_POB_BUILDS = 20;
const MAX_MARKED_ENTRIES = 2000;
const MAX_ICONS = 500;
const MAX_SEARCH_SELECTIONS = 500;
const MAX_STATS_PER_SELECTION = 80;
const MAX_STAT_ID_LENGTH = 160;
const MAX_COUNT_MIN = 80;
const MAX_STAT_BOUND = 1e9;
const MAX_SEARCH_OVERRIDES = 500;
/** 官方搜尋代碼通常數百字元；條件很多時也遠低於這個上限 */
const MAX_SEARCH_CODE_LENGTH = 8192;

export function pobBuildsStorageKey(version: PoeVersion): string {
  return `poexdPobBuildsV2_${version}`;
}

function createChromeLocalStorage(): PobBuildStorage {
  return {
    get: (keys) => chrome.storage.local.get([...keys]),
    set: (values) => chrome.storage.local.set(values),
    onChanged: (listener) => {
      const handle = (changes: Record<string, unknown>, areaName: string) => {
        if (areaName === 'local') listener(Object.keys(changes));
      };
      chrome.storage.onChanged.addListener(handle);
      return () => chrome.storage.onChanged.removeListener(handle);
    },
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const toKeyList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === 'string')
        .slice(0, MAX_MARKED_ENTRIES)
    : [];

const toOptionalId = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

const toName = (value: unknown): string =>
  typeof value === 'string' ? value.trim().slice(0, POB_BUILD_NAME_MAX_LENGTH) : '';

/** 圖片網址來自頁面，只收官方 CDN 的 https 網址 */
const toIcons = (value: unknown): Record<string, string> =>
  isRecord(value)
    ? Object.fromEntries(
        Object.entries(value)
          .filter((entry): entry is [string, string] => isValidPoeCdnImageUrl(entry[1]))
          .slice(0, MAX_ICONS),
      )
    : {};

const toBound = (value: unknown): number | null | undefined => {
  if (value === null) return null;
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_STAT_BOUND
    ? value
    : undefined;
};

function toStatSelection(value: unknown): StatSelection | undefined {
  if (!isRecord(value)) return undefined;
  const min = toBound(value.min);
  const max = toBound(value.max);
  const selection: StatSelection = {
    ...(typeof value.enabled === 'boolean' ? { enabled: value.enabled } : {}),
    ...('min' in value && min !== undefined ? { min } : {}),
    ...('max' in value && max !== undefined ? { max } : {}),
  };
  return Object.keys(selection).length > 0 ? selection : undefined;
}

/** 搜尋調整來自本機儲存，仍逐欄驗證：代碼長度、數值範圍、筆數 */
export function toEntrySearchSelection(value: unknown): EntrySearchSelection | undefined {
  if (!isRecord(value)) return undefined;
  const stats = isRecord(value.stats)
    ? Object.fromEntries(
        Object.entries(value.stats)
          .filter(([statId]) => statId !== '' && statId.length <= MAX_STAT_ID_LENGTH)
          .map(([statId, stat]) => [statId, toStatSelection(stat)] as const)
          .filter((entry): entry is readonly [string, StatSelection] => entry[1] !== undefined)
          .slice(0, MAX_STATS_PER_SELECTION),
      )
    : {};
  const { countMin } = value;
  const selection: EntrySearchSelection = {
    ...(Object.keys(stats).length > 0 ? { stats } : {}),
    ...(typeof countMin === 'number' &&
    Number.isInteger(countMin) &&
    countMin >= 1 &&
    countMin <= MAX_COUNT_MIN
      ? { countMin }
      : {}),
    ...(value.pseudo === true ? { pseudo: true } : {}),
  };
  return Object.keys(selection).length > 0 ? selection : undefined;
}

const toSearchSelections = (value: unknown): Record<string, EntrySearchSelection> =>
  isRecord(value)
    ? Object.fromEntries(
        Object.entries(value)
          .map(([key, selection]) => [key, toEntrySearchSelection(selection)] as const)
          .filter(
            (entry): entry is readonly [string, EntrySearchSelection] => entry[1] !== undefined,
          )
          .slice(0, MAX_SEARCH_SELECTIONS),
      )
    : {};

/** 搜尋代碼來自頁面網址：只收 gzip 格式、長度合理的代碼 */
export const isValidSearchCode = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= MAX_SEARCH_CODE_LENGTH && isGzipHash(value);

const toSearchOverrides = (value: unknown): Record<string, string> =>
  isRecord(value)
    ? Object.fromEntries(
        Object.entries(value)
          .filter(
            (entry): entry is [string, string] => entry[0] !== '' && isValidSearchCode(entry[1]),
          )
          .slice(0, MAX_SEARCH_OVERRIDES),
      )
    : {};

function parseStored(value: unknown): StoredPobBuild | undefined {
  if (!isRecord(value)) return undefined;
  const { id, code, importedAt } = value;
  if (typeof id !== 'string' || id === '' || typeof code !== 'string' || code === '') {
    return undefined;
  }
  return {
    id,
    name: toName(value.name),
    code,
    importedAt: typeof importedAt === 'number' ? importedAt : 0,
    collapsed: value.collapsed === true,
    hideDone: value.hideDone === true,
    itemSetId: toOptionalId(value.itemSetId),
    skillSetId: toOptionalId(value.skillSetId),
    done: toKeyList(value.done),
    removed: toKeyList(value.removed),
    icons: toIcons(value.icons),
    searchSelections: toSearchSelections(value.searchSelections),
    searchOverrides: toSearchOverrides(value.searchOverrides),
  };
}

function applyPatch(build: StoredPobBuild, patch: StoredPobBuildPatch): StoredPobBuild {
  return {
    ...build,
    ...('name' in patch ? { name: toName(patch.name) || build.name } : {}),
    ...('collapsed' in patch ? { collapsed: patch.collapsed === true } : {}),
    ...('hideDone' in patch ? { hideDone: patch.hideDone === true } : {}),
    ...('itemSetId' in patch ? { itemSetId: toOptionalId(patch.itemSetId) } : {}),
    ...('skillSetId' in patch ? { skillSetId: toOptionalId(patch.skillSetId) } : {}),
    ...('done' in patch ? { done: toKeyList(patch.done) } : {}),
    ...('removed' in patch ? { removed: toKeyList(patch.removed) } : {}),
    ...('icons' in patch ? { icons: toIcons(patch.icons) } : {}),
    ...('searchSelections' in patch
      ? { searchSelections: toSearchSelections(patch.searchSelections) }
      : {}),
    ...('searchOverrides' in patch
      ? { searchOverrides: toSearchOverrides(patch.searchOverrides) }
      : {}),
  };
}

export function createPobBuildStore(
  version: PoeVersion,
  deps: { storage?: PobBuildStorage; now?: () => number; createId?: () => string } = {},
): PobBuildStore {
  const storage = deps.storage ?? createChromeLocalStorage();
  const now = deps.now ?? Date.now;
  const createId = deps.createId ?? (() => crypto.randomUUID());
  const key = pobBuildsStorageKey(version);

  const list = async (): Promise<StoredPobBuild[]> => {
    const raw = (await storage.get([key]))[key];
    return Array.isArray(raw)
      ? raw.map(parseStored).filter((build): build is StoredPobBuild => build !== undefined)
      : [];
  };
  const write = (builds: readonly StoredPobBuild[]) => storage.set({ [key]: builds });
  // 每次變更都是「讀出、修改、寫回」，連續操作要排隊，否則後寫的會蓋掉先寫的
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const result = queue.then(task, task);
    queue = result.catch(() => undefined);
    return result;
  };

  const mutate = (id: string, change: (current: StoredPobBuild) => StoredPobBuildPatch) =>
    enqueue(async () => {
      const builds = await list();
      const current = builds.find((build) => build.id === id);
      if (!current) return;
      const next = applyPatch(current, change(current));
      await write(builds.map((build) => (build.id === id ? next : build)));
    });

  return {
    list,
    add: ({ name, code }) =>
      enqueue(async () => {
        const build: StoredPobBuild = {
          id: createId(),
          name: toName(name),
          code,
          importedAt: now(),
          collapsed: false,
          hideDone: false,
          done: [],
          removed: [],
          icons: {},
          searchSelections: {},
          searchOverrides: {},
        };
        const builds = await list();
        if (builds.length >= MAX_POB_BUILDS) throw new PobBuildLimitError();
        await write([build, ...builds]);
        return build;
      }),
    update: (id, patch) => mutate(id, () => patch),
    mutate,
    subscribe: (listener) =>
      storage.onChanged?.((changedKeys) => {
        if (changedKeys.includes(key)) listener();
      }) ?? (() => undefined),
    replaceCode: (id, code, patch) =>
      enqueue(async () => {
        const builds = await list();
        const current = builds.find((build) => build.id === id);
        if (typeof code !== 'string' || code === '' || !current) return false;
        const resolved = typeof patch === 'function' ? patch(current) : patch;
        const next = { ...applyPatch(current, resolved), code };
        await write(builds.map((build) => (build.id === id ? next : build)));
        return true;
      }),
    remove: (id) =>
      enqueue(async () => {
        await write((await list()).filter((build) => build.id !== id));
      }),
  };
}
