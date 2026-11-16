/**
 * 匯入的 PoB build 只存在本機（chrome.storage.local），依遊戲版本各存一份，
 * 不上傳、也不納入書籤匯出。存的是原始代碼，讀出時重新解碼，資料模型改版時不必搬遷。
 */
import type { PoeVersion } from './trade-context';

export interface PobBuildStorage {
  get(keys: readonly string[]): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
  remove(keys: readonly string[]): Promise<void>;
}

export interface StoredPobBuild {
  code: string;
  importedAt: number;
}

export interface PobBuildStore {
  load(): Promise<StoredPobBuild | undefined>;
  save(code: string): Promise<void>;
  clear(): Promise<void>;
}

export function pobBuildStorageKey(version: PoeVersion): string {
  return `poexdPobBuildV1_${version}`;
}

function createChromeLocalStorage(): PobBuildStorage {
  return {
    get: (keys) => chrome.storage.local.get([...keys]),
    set: (values) => chrome.storage.local.set(values),
    remove: (keys) => chrome.storage.local.remove([...keys]),
  };
}

function parseStored(value: unknown): StoredPobBuild | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const { code, importedAt } = value as Record<string, unknown>;
  if (typeof code !== 'string' || code === '' || typeof importedAt !== 'number') return undefined;
  return { code, importedAt };
}

export function createPobBuildStore(
  version: PoeVersion,
  deps: { storage?: PobBuildStorage; now?: () => number } = {},
): PobBuildStore {
  const storage = deps.storage ?? createChromeLocalStorage();
  const now = deps.now ?? Date.now;
  const key = pobBuildStorageKey(version);
  return {
    load: async () => parseStored((await storage.get([key]))[key]),
    save: (code) => storage.set({ [key]: { code, importedAt: now() } satisfies StoredPobBuild }),
    clear: () => storage.remove([key]),
  };
}
