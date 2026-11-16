/**
 * 匯入的 PoB build 與購物清單進度只存在本機（chrome.storage.local），依遊戲版本各存一份清單，
 * 不上傳、也不納入書籤匯出。存的是原始代碼，讀出時重新解碼，資料模型改版時不必搬遷。
 */
import { isValidPoeCdnImageUrl } from './poe-cdn-url';
import type { PoeVersion } from './trade-context';

export interface PobBuildStorage {
  get(keys: readonly string[]): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
}

export interface StoredPobBuild {
  id: string;
  /** 使用者可以改的顯示名稱 */
  name: string;
  code: string;
  importedAt: number;
  /** 清單收合 */
  collapsed: boolean;
  itemSetId?: string;
  skillSetId?: string;
  /** 已完成、已移除的項目（ShoppingEntry.key） */
  done: string[];
  removed: string[];
  /** 項目的圖片（ShoppingEntry.key → 官方 CDN 圖片網址），由搜尋結果擷取 */
  icons: Record<string, string>;
}

export type StoredPobBuildPatch = Partial<Omit<StoredPobBuild, 'id' | 'code' | 'importedAt'>>;

export interface PobBuildStore {
  list(): Promise<StoredPobBuild[]>;
  /** 新增一份 build，放在清單最前面 */
  add(entry: { name: string; code: string }): Promise<StoredPobBuild>;
  /** 更新指定 build；該 build 已不存在時不做事 */
  update(id: string, patch: StoredPobBuildPatch): Promise<void>;
  remove(id: string): Promise<void>;
}

export const POB_BUILD_NAME_MAX_LENGTH = 60;
export const MAX_POB_BUILDS = 20;
const MAX_MARKED_ENTRIES = 2000;
const MAX_ICONS = 500;

export function pobBuildsStorageKey(version: PoeVersion): string {
  return `poexdPobBuildsV2_${version}`;
}

function createChromeLocalStorage(): PobBuildStorage {
  return {
    get: (keys) => chrome.storage.local.get([...keys]),
    set: (values) => chrome.storage.local.set(values),
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
    itemSetId: toOptionalId(value.itemSetId),
    skillSetId: toOptionalId(value.skillSetId),
    done: toKeyList(value.done),
    removed: toKeyList(value.removed),
    icons: toIcons(value.icons),
  };
}

function applyPatch(build: StoredPobBuild, patch: StoredPobBuildPatch): StoredPobBuild {
  return {
    ...build,
    ...('name' in patch ? { name: toName(patch.name) || build.name } : {}),
    ...('collapsed' in patch ? { collapsed: patch.collapsed === true } : {}),
    ...('itemSetId' in patch ? { itemSetId: toOptionalId(patch.itemSetId) } : {}),
    ...('skillSetId' in patch ? { skillSetId: toOptionalId(patch.skillSetId) } : {}),
    ...('done' in patch ? { done: toKeyList(patch.done) } : {}),
    ...('removed' in patch ? { removed: toKeyList(patch.removed) } : {}),
    ...('icons' in patch ? { icons: toIcons(patch.icons) } : {}),
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
          done: [],
          removed: [],
          icons: {},
        };
        await write([build, ...(await list())].slice(0, MAX_POB_BUILDS));
        return build;
      }),
    update: (id, patch) =>
      enqueue(async () => {
        const builds = await list();
        if (!builds.some((build) => build.id === id)) return;
        await write(builds.map((build) => (build.id === id ? applyPatch(build, patch) : build)));
      }),
    remove: (id) =>
      enqueue(async () => {
        await write((await list()).filter((build) => build.id !== id));
      }),
  };
}
