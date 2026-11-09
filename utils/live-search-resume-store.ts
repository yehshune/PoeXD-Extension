import type { PoeVersion } from './trade-context';
import { isValidPoeCdnImageUrl } from './poe-cdn-url';

export interface LiveSearchResumeIdentity {
  gameVersion: PoeVersion;
  league: string;
  searchId: string;
  name?: string;
  url?: string;
  coverImageUrl?: string;
}

export interface LiveSearchResumePlanData {
  version: 1 | 2;
  identities: LiveSearchResumeIdentity[];
}

export interface LiveSearchResumeStorage {
  get(keys: readonly string[]): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
  remove(keys: readonly string[]): Promise<void>;
}

export function getResumePlanStorageKey(version: PoeVersion): string {
  return `liveSearchResumePlan_${version}`;
}

export function getResumeCanonicalKey(identity: {
  gameVersion: string;
  league: string;
  searchId: string;
}): string {
  return `${identity.gameVersion}:${identity.league.trim().toLowerCase()}:${identity.searchId.trim()}`;
}

export function normalizeResumeIdentity(
  raw: unknown,
  expectedVersion: PoeVersion,
): LiveSearchResumeIdentity | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  if (item.gameVersion !== expectedVersion) return null;
  if (typeof item.league !== 'string' || !item.league.trim()) return null;
  if (typeof item.searchId !== 'string' || !item.searchId.trim()) return null;

  const normalized: LiveSearchResumeIdentity = {
    gameVersion: expectedVersion,
    league: item.league.trim().toLowerCase(),
    searchId: item.searchId.trim(),
  };

  if (typeof item.name === 'string' && item.name.trim()) {
    normalized.name = item.name.trim();
  }
  if (typeof item.url === 'string' && item.url.trim()) {
    normalized.url = item.url.trim();
  }
  if (
    typeof item.coverImageUrl === 'string' &&
    item.coverImageUrl.trim() &&
    isValidPoeCdnImageUrl(item.coverImageUrl.trim())
  ) {
    normalized.coverImageUrl = item.coverImageUrl.trim();
  }

  return normalized;
}

export function normalizeResumePlanData(
  raw: unknown,
  expectedVersion: PoeVersion,
): LiveSearchResumePlanData {
  if (!raw || typeof raw !== 'object') {
    return { version: 2, identities: [] };
  }
  const obj = raw as Record<string, unknown>;
  if ((obj.version !== 1 && obj.version !== 2) || !Array.isArray(obj.identities)) {
    return { version: 2, identities: [] };
  }

  const seenKeys = new Set<string>();
  const normalizedIdentities: LiveSearchResumeIdentity[] = [];

  for (const entry of obj.identities) {
    const norm = normalizeResumeIdentity(entry, expectedVersion);
    if (!norm) continue;
    const key = getResumeCanonicalKey(norm);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    normalizedIdentities.push(norm);
  }

  return {
    version: 2,
    identities: normalizedIdentities,
  };
}

function getDefaultStorage(): LiveSearchResumeStorage {
  return {
    async get(keys: readonly string[]) {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        return chrome.storage.local.get(keys as string[]);
      }
      return {};
    },
    async set(values: Record<string, unknown>) {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        await chrome.storage.local.set(values);
      }
    },
    async remove(keys: readonly string[]) {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        await chrome.storage.local.remove(keys as string[]);
      }
    },
  };
}

export type LiveSearchResumeReadOutcome =
  | { ok: true; value: LiveSearchResumePlanData }
  | { ok: false; error: { code: 'storage-failure'; message: string } };

export interface LiveSearchResumeStore {
  readonly version: PoeVersion;
  read(): Promise<LiveSearchResumeReadOutcome>;
  addIdentities(identities: readonly LiveSearchResumeIdentity[]): Promise<boolean>;
  removeIdentities(
    identitiesOrKeys: readonly (LiveSearchResumeIdentity | string)[],
  ): Promise<boolean>;
  pruneToAuthoritative(
    validCanonicalKeys: ReadonlySet<string>,
    options?: { league?: string },
  ): Promise<boolean>;
  clear(): Promise<boolean>;
  subscribe(listener: (plan: LiveSearchResumePlanData) => void): () => void;
}

export function createLiveSearchResumeStore(
  version: PoeVersion,
  customStorage?: LiveSearchResumeStorage,
): LiveSearchResumeStore {
  const storage = customStorage ?? getDefaultStorage();
  const storageKey = getResumePlanStorageKey(version);
  const listeners = new Set<(plan: LiveSearchResumePlanData) => void>();

  type StoreLoadState = 'unloaded' | 'loaded' | 'error';
  let loadState: StoreLoadState = 'unloaded';
  let cachedPlan: LiveSearchResumePlanData | null = null;
  let writeChain = Promise.resolve();

  function notify(plan: LiveSearchResumePlanData) {
    const frozen: LiveSearchResumePlanData = {
      version: 2,
      identities: plan.identities.map((id) => Object.freeze({ ...id })),
    };
    for (const listener of Array.from(listeners)) {
      try {
        listener(frozen);
      } catch (err) {
        console.error('[PoeXD ResumeStore] Error in listener:', err);
      }
    }
  }

  async function loadInternal(): Promise<LiveSearchResumeReadOutcome> {
    try {
      const data = await storage.get([storageKey]);
      const raw = data[storageKey];
      cachedPlan = normalizeResumePlanData(raw, version);
      loadState = 'loaded';
      notify(cachedPlan);
      return { ok: true, value: cachedPlan };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[PoeXD ResumeStore] Failed to read ${storageKey}:`, err);
      loadState = 'error';
      // Storage read failure: DO NOT overwrite storage, do NOT set fake empty cachedPlan
      return {
        ok: false,
        error: { code: 'storage-failure', message: msg },
      };
    }
  }

  function enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
    const next = writeChain.then(task, task);
    writeChain = next.then(
      () => {},
      () => {},
    );
    return next;
  }

  return {
    version,

    async read(): Promise<LiveSearchResumeReadOutcome> {
      return enqueueWrite(async () => {
        if (loadState === 'loaded' && cachedPlan) {
          return { ok: true, value: cachedPlan };
        }
        return loadInternal();
      });
    },

    async addIdentities(identities: readonly LiveSearchResumeIdentity[]): Promise<boolean> {
      if (!Array.isArray(identities) || identities.length === 0) return false;

      return enqueueWrite(async () => {
        if (loadState !== 'loaded') {
          const readOutcome = await loadInternal();
          if (!readOutcome.ok) return false;
        }
        const current = cachedPlan!;

        const validIncoming: LiveSearchResumeIdentity[] = [];
        for (const item of identities) {
          const norm = normalizeResumeIdentity(item, version);
          if (norm) {
            validIncoming.push(norm);
          }
        }
        if (validIncoming.length === 0) return false;

        // Per-League Invariant:
        // 同一 PoeVersion 下，可同時保存多個 league 的 Resume Intents。
        // 追加新啟用的項目，保留既有各聯盟的 intents，不覆蓋其他聯盟。
        const existingIndexByKey = new Map<string, number>();
        current.identities.forEach((id, idx) => {
          existingIndexByKey.set(getResumeCanonicalKey(id), idx);
        });
        const nextIdentities = [...current.identities];
        let mutated = false;

        for (const item of validIncoming) {
          const key = getResumeCanonicalKey(item);
          const existingIdx = existingIndexByKey.get(key);
          if (existingIdx === undefined) {
            existingIndexByKey.set(key, nextIdentities.length);
            nextIdentities.push(item);
            mutated = true;
          } else {
            const existing = nextIdentities[existingIdx];
            const nextName = item.name ?? existing.name;
            const nextUrl = item.url ?? existing.url;
            const nextCover = item.coverImageUrl ?? existing.coverImageUrl;
            if (
              nextName !== existing.name ||
              nextUrl !== existing.url ||
              nextCover !== existing.coverImageUrl
            ) {
              nextIdentities[existingIdx] = {
                ...existing,
                ...(nextName ? { name: nextName } : {}),
                ...(nextUrl ? { url: nextUrl } : {}),
                ...(nextCover ? { coverImageUrl: nextCover } : {}),
              };
              mutated = true;
            }
          }
        }

        if (!mutated) {
          return false;
        }

        const nextPlan: LiveSearchResumePlanData = {
          version: 2,
          identities: nextIdentities,
        };

        try {
          await storage.set({ [storageKey]: nextPlan });
          cachedPlan = nextPlan;
          notify(nextPlan);
          return true;
        } catch (err) {
          console.warn(`[PoeXD ResumeStore] Failed to save additions to ${storageKey}:`, err);
          return false;
        }
      });
    },

    async removeIdentities(
      identitiesOrKeys: readonly (LiveSearchResumeIdentity | string)[],
    ): Promise<boolean> {
      if (!Array.isArray(identitiesOrKeys) || identitiesOrKeys.length === 0) return false;

      return enqueueWrite(async () => {
        if (loadState !== 'loaded') {
          const readOutcome = await loadInternal();
          if (!readOutcome.ok) return false;
        }
        const current = cachedPlan!;
        const removeKeys = new Set<string>();

        for (const item of identitiesOrKeys) {
          if (typeof item === 'string') {
            removeKeys.add(item.trim());
          } else {
            const norm = normalizeResumeIdentity(item, version);
            if (norm) {
              removeKeys.add(getResumeCanonicalKey(norm));
            }
          }
        }

        if (removeKeys.size === 0) return false;

        const remaining = current.identities.filter(
          (id) => !removeKeys.has(getResumeCanonicalKey(id)),
        );
        if (remaining.length === current.identities.length) {
          return false;
        }

        const nextPlan: LiveSearchResumePlanData = {
          version: 2,
          identities: remaining,
        };

        try {
          await storage.set({ [storageKey]: nextPlan });
          cachedPlan = nextPlan;
          notify(nextPlan);
          return true;
        } catch (err) {
          console.warn(`[PoeXD ResumeStore] Failed to save removals to ${storageKey}:`, err);
          return false;
        }
      });
    },

    async pruneToAuthoritative(
      validCanonicalKeys: ReadonlySet<string>,
      options?: { league?: string },
    ): Promise<boolean> {
      return enqueueWrite(async () => {
        if (loadState !== 'loaded') {
          const readOutcome = await loadInternal();
          if (!readOutcome.ok) return false;
        }
        const current = cachedPlan!;
        const targetLeagueLower = options?.league?.trim().toLowerCase();
        const remaining = current.identities.filter((id) => {
          if (targetLeagueLower && id.league.trim().toLowerCase() !== targetLeagueLower) {
            return true;
          }
          if (id.url || id.name) {
            return true;
          }
          return validCanonicalKeys.has(getResumeCanonicalKey(id));
        });

        if (remaining.length === current.identities.length) {
          return false;
        }

        const nextPlan: LiveSearchResumePlanData = {
          version: 2,
          identities: remaining,
        };

        try {
          await storage.set({ [storageKey]: nextPlan });
          cachedPlan = nextPlan;
          notify(nextPlan);
          return true;
        } catch (err) {
          console.warn(`[PoeXD ResumeStore] Failed to prune ${storageKey}:`, err);
          return false;
        }
      });
    },

    async clear(): Promise<boolean> {
      return enqueueWrite(async () => {
        const nextPlan: LiveSearchResumePlanData = { version: 2, identities: [] };
        try {
          await storage.remove([storageKey]);
          cachedPlan = nextPlan;
          loadState = 'loaded';
          notify(nextPlan);
          return true;
        } catch (err) {
          console.warn(`[PoeXD ResumeStore] Failed to clear ${storageKey}:`, err);
          return false;
        }
      });
    },

    subscribe(listener: (plan: LiveSearchResumePlanData) => void): () => void {
      listeners.add(listener);
      if (loadState === 'loaded' && cachedPlan) {
        try {
          listener(cachedPlan);
        } catch (err) {
          console.error('[PoeXD ResumeStore] Error in initial listener:', err);
        }
      }
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export async function clearLiveSearchResumePlan(
  version: PoeVersion,
  customStorage?: LiveSearchResumeStorage,
): Promise<boolean> {
  const store = createLiveSearchResumeStore(version, customStorage);
  return store.clear();
}
