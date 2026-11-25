import type { PoeVersion } from './trade-context';
import {
  DEFAULT_PREFERENCES,
  LEGACY_VERSIONED_GLOBAL_PREFERENCE_NAMES,
  PREFERENCE_NAMES,
  PREFERENCE_SCHEMA,
  getPreferenceStorageKey,
  isGlobalPreference,
  isValidPreference,
  normalizePreference,
  type LegacyVersionedGlobalPreferenceName,
  type PreferenceDescriptor,
  type Preferences,
} from './preferences-contract';

export * from './preferences-contract';

export interface PreferencesStorage {
  get(keys: readonly string[]): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
  subscribe(listener: (changes: Record<string, unknown>) => void | Promise<void>): () => void;
}

export interface InMemoryPreferencesStorage extends PreferencesStorage {
  inspect(): Record<string, unknown>;
  setExternal(values: Record<string, unknown>): Promise<void>;
}

interface InMemoryPreferencesStorageOptions {
  getError?: string;
  setError?: string;
}

export interface PreferencesModule {
  read(): Readonly<Preferences>;
  update(changes: Partial<Preferences>): Promise<PreferencesUpdateOutcome>;
  subscribe(listener: (snapshot: Readonly<Preferences>) => void): () => void;
}

export type PreferencesUpdateOutcome =
  | { ok: true; changed: boolean }
  | { ok: false; error: { code: 'invalid' | 'unavailable'; message: string } };

export type PreferencesLoadOutcome =
  | { ok: true; value: PreferencesModule }
  | { ok: false; error: { code: 'unavailable'; message: string } };

function freezePreferences(preferences: Preferences): Readonly<Preferences> {
  return Object.freeze(preferences);
}

export function createInMemoryPreferencesStorage(
  initial: Record<string, unknown> = {},
  options: InMemoryPreferencesStorageOptions = {},
): InMemoryPreferencesStorage {
  const data = { ...initial };
  const listeners = new Set<(changes: Record<string, unknown>) => void | Promise<void>>();
  const commit = async (values: Record<string, unknown>) => {
    const changes: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(values)) {
      if (data[key] === value) continue;
      if (value === undefined) delete data[key];
      else data[key] = value;
      changes[key] = value;
    }
    if (Object.keys(changes).length > 0) {
      await Promise.all([...listeners].map((listener) => listener(changes)));
    }
  };
  return {
    async get(keys) {
      if (options.getError) throw new Error(options.getError);
      return Object.fromEntries(keys.filter((key) => key in data).map((key) => [key, data[key]]));
    },
    async set(values) {
      if (options.setError) throw new Error(options.setError);
      await commit(values);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    inspect() {
      return { ...data };
    },
    async setExternal(values) {
      await commit(values);
    },
  };
}

export function createChromePreferencesStorage(): PreferencesStorage {
  return {
    async get(keys) {
      return chrome.storage.local.get([...keys]);
    },
    async set(values) {
      await chrome.storage.local.set(values);
    },
    subscribe(listener) {
      const handleChanges = (changes: Record<string, { newValue?: unknown }>, areaName: string) => {
        if (areaName !== 'local') return;
        void listener(
          Object.fromEntries(
            Object.entries(changes).map(([key, change]) => [key, change.newValue]),
          ),
        );
      };
      chrome.storage.onChanged.addListener(handleChanges);
      return () => chrome.storage.onChanged.removeListener(handleChanges);
    },
  };
}

const chromeModules = new Map<PoeVersion, Promise<PreferencesLoadOutcome>>();

export function getPreferences(version: PoeVersion): Promise<PreferencesLoadOutcome> {
  const existing = chromeModules.get(version);
  if (existing) return existing;
  const loading = createPreferencesModule(version, createChromePreferencesStorage());
  chromeModules.set(version, loading);
  void loading.then((outcome) => {
    if (!outcome.ok) chromeModules.delete(version);
  });
  return loading;
}

const OTHER_VERSION: Readonly<Record<PoeVersion, PoeVersion>> = {
  poe1: 'poe2',
  poe2: 'poe1',
};

const CUSTOM_LEGACY_KEYS: readonly string[] = PREFERENCE_NAMES.flatMap((name) => {
  const descriptor = PREFERENCE_SCHEMA[name] as PreferenceDescriptor<unknown>;
  return descriptor.legacyKeys ?? [];
});

function migrateLegacyGlobalField(
  name: LegacyVersionedGlobalPreferenceName,
  candidateVersions: readonly PoeVersion[],
  stored: Readonly<Record<string, unknown>>,
  loaded: Preferences,
  repairs: Record<string, unknown>,
): boolean {
  if (stored[name] !== undefined || name in repairs) return false;
  for (const candidateVersion of candidateVersions) {
    const legacyValue = stored[`${name}_${candidateVersion}`];
    if (legacyValue === undefined) continue;
    const normalized = normalizePreference(name, legacyValue);
    loaded[name] = normalized as never;
    repairs[name] = normalized;
    return true;
  }
  return false;
}

export async function createPreferencesModule(
  version: PoeVersion,
  storage: PreferencesStorage,
): Promise<PreferencesLoadOutcome> {
  try {
    const otherVersion = OTHER_VERSION[version];
    const versionOrder: readonly PoeVersion[] = [version, otherVersion];
    const keys = PREFERENCE_NAMES.map((name) => getPreferenceStorageKey(name, version));
    const legacyVersionedGlobalKeys = LEGACY_VERSIONED_GLOBAL_PREFERENCE_NAMES.flatMap((name) => [
      `${name}_${version}`,
      `${name}_${otherVersion}`,
    ]);
    const stored = await storage.get([
      ...new Set([
        ...keys,
        ...PREFERENCE_NAMES,
        ...CUSTOM_LEGACY_KEYS,
        ...legacyVersionedGlobalKeys,
      ]),
    ]);
    const loaded: Preferences = { ...DEFAULT_PREFERENCES };
    const repairs: Record<string, unknown> = {};
    for (const name of PREFERENCE_NAMES) {
      const key = getPreferenceStorageKey(name, version);
      const value = stored[key];
      if (value !== undefined) {
        const normalized = normalizePreference(name, value);
        loaded[name] = normalized as never;
        if (normalized !== value) repairs[key] = normalized;
        continue;
      }
      if (!isGlobalPreference(name)) {
        const legacyValue = stored[name];
        if (legacyValue !== undefined) {
          const normalized = normalizePreference(name, legacyValue);
          loaded[name] = normalized as never;
          repairs[key] = normalized;
        }
      }
    }
    for (const name of PREFERENCE_NAMES) {
      const descriptor = PREFERENCE_SCHEMA[name] as PreferenceDescriptor<unknown>;
      if (!descriptor.legacyMigrate) continue;
      const key = getPreferenceStorageKey(name, version);
      if (stored[key] !== undefined || key in repairs) continue;
      const migrated = descriptor.legacyMigrate(stored);
      if (migrated !== undefined) {
        const normalized = normalizePreference(name, migrated);
        loaded[name] = normalized as never;
        repairs[key] = normalized;
      }
    }

    for (const name of LEGACY_VERSIONED_GLOBAL_PREFERENCE_NAMES) {
      migrateLegacyGlobalField(name, versionOrder, stored, loaded, repairs);
    }

    if (Object.keys(repairs).length > 0) await storage.set(repairs);
    let snapshot = freezePreferences(loaded);
    const listeners = new Set<(snapshot: Readonly<Preferences>) => void>();
    const notify = (listener: (snapshot: Readonly<Preferences>) => void) => {
      try {
        listener(snapshot);
      } catch {
        // One caller cannot interrupt committed Preference delivery.
      }
    };
    storage.subscribe(async (changes) => {
      const changed: Partial<Preferences> = {};
      const repairs: Record<string, unknown> = {};
      for (const name of PREFERENCE_NAMES) {
        const key = getPreferenceStorageKey(name, version);
        if (!(key in changes)) continue;
        const value = changes[key];
        const normalized = normalizePreference(name, value);
        changed[name] = normalized as never;
        if (normalized !== value) repairs[key] = normalized;
      }
      if (Object.keys(repairs).length > 0) {
        try {
          await storage.set(repairs);
        } catch {
          // The validated snapshot remains canonical until storage is available again.
        }
      }
      const changedNames = Object.keys(changed) as Array<keyof Preferences>;
      if (!changedNames.some((name) => snapshot[name] !== changed[name])) return;
      snapshot = freezePreferences({ ...snapshot, ...changed });
      listeners.forEach(notify);
    });
    return {
      ok: true,
      value: {
        read: () => snapshot,
        async update(changes) {
          const changed: Partial<Preferences> = {};
          for (const [rawName, value] of Object.entries(changes)) {
            const name = rawName as keyof Preferences;
            if (!PREFERENCE_NAMES.includes(name) || !isValidPreference(name, value)) {
              return {
                ok: false,
                error: {
                  code: 'invalid',
                  message: `Invalid Preference: ${rawName}`,
                },
              };
            }
            if (snapshot[name] !== value) {
              changed[name] = value as never;
            }
          }
          const changedNames = Object.keys(changed) as Array<keyof Preferences>;
          if (changedNames.length === 0) return { ok: true, changed: false };
          const committed = Object.fromEntries(
            changedNames.map((name) => [getPreferenceStorageKey(name, version), changed[name]]),
          );
          try {
            await storage.set(committed);
          } catch (error) {
            return {
              ok: false,
              error: {
                code: 'unavailable',
                message: error instanceof Error ? error.message : String(error),
              },
            };
          }
          if (changedNames.some((name) => snapshot[name] !== changed[name])) {
            snapshot = freezePreferences({ ...snapshot, ...changed });
            listeners.forEach(notify);
          }
          return { ok: true, changed: true };
        },
        subscribe(listener) {
          listeners.add(listener);
          notify(listener);
          return () => listeners.delete(listener);
        },
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'unavailable',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
