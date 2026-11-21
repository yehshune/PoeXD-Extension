import type { PoeVersion } from './trade-context';
import {
  BOOKMARK_BUTTON_POSITIONS,
  COLLAPSED_TAB_TOP_BOUNDS,
  SEARCH_ENTRY_CLICK_ACTIONS,
  DENSITY_SCALE_VALUES,
  DISPLAY_LOCALE_VALUES,
  DEFAULT_PREFERENCES,
  LEGACY_DISPLAY_LOCALE_KEYS,
  LEGACY_VERSIONED_GLOBAL_PREFERENCE_NAMES,
  migrateLegacyDisplayLocale,
  FONT_SIZE_SCALE_BOUNDS,
  LIVE_SEARCH_MAX_DISPLAYED_RESULTS_VALUES,
  LIVE_SEARCH_RESUME_MODES,
  SIDEBAR_POSITIONS,
  SIDEBAR_WIDTH_BOUNDS,
  getPreferenceStorageKey,
  isGlobalPreference,
  isValidThemeId,
  isValidThemeOverridesJson,
  normalizeThemeId,
  normalizeThemeOverridesJson,
  type BookmarkButtonPosition,
  type DisplayLocalePreference,
  type Preferences,
  type SidebarPosition,
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

const PREFERENCE_NAMES = Object.keys(DEFAULT_PREFERENCES) as Array<keyof Preferences>;
const BOOLEAN_PREFERENCES = new Set<keyof Preferences>([
  'enableAffixSelector',
  'enableAutoTitle',
  'enableBookmarkTooltip',
  'enableFilterTilde',
  'enableHotkeys',
  'enableItemNormalizer',
  'enablePriceComparison',
  'enablePureBackground',
  'enableResultExternalLinks',
  'enableResultModHighlight',
  'enableResultModQuickFilter',
  'enableResultPobCopy',
  'enableSearchTilde',
  'enableTierHelper',
  'liveSearchSoundEnabled',
  'marketTranslation',
  'marketTranslationBilingual',
  'marketTranslationResultBilingual',
  'sidebarModuleBookmarks',
  'sidebarModuleHistory',
  'sidebarModuleLiveSearch',
  'sidebarModulePinnedItems',
  'sidebarModulePobBuild',
  'sidebarModuleResultBoard',
  'sidebarModuleStatGroupTemplates',
]);

function isValidPreference(name: keyof Preferences, value: unknown) {
  if (BOOLEAN_PREFERENCES.has(name)) return typeof value === 'boolean';
  if (name === 'theme') return isValidThemeId(value);
  if (name === 'themeCustomOverrides') return isValidThemeOverridesJson(value);
  if (name === 'displayLocale')
    return (DISPLAY_LOCALE_VALUES as readonly unknown[]).includes(value);
  if (name === 'liveSearchMaxDisplayedResults')
    return (LIVE_SEARCH_MAX_DISPLAYED_RESULTS_VALUES as readonly unknown[]).includes(value);
  if (name === 'liveSearchResumeMode')
    return (LIVE_SEARCH_RESUME_MODES as readonly unknown[]).includes(value);
  if (name === 'searchEntryClickAction')
    return (SEARCH_ENTRY_CLICK_ACTIONS as readonly unknown[]).includes(value);
  if (name === 'addBookmarkBtnPosition')
    return (BOOKMARK_BUTTON_POSITIONS as readonly unknown[]).includes(value);
  if (name === 'sidebarPosition') return (SIDEBAR_POSITIONS as readonly unknown[]).includes(value);
  if (name === 'densityScale') return (DENSITY_SCALE_VALUES as readonly unknown[]).includes(value);
  if (name === 'fontSizeScale')
    return (
      typeof value === 'number' &&
      value >= FONT_SIZE_SCALE_BOUNDS.min &&
      value <= FONT_SIZE_SCALE_BOUNDS.max
    );
  if (name === 'sidebarWidth')
    return (
      typeof value === 'number' &&
      value >= SIDEBAR_WIDTH_BOUNDS.min &&
      value <= SIDEBAR_WIDTH_BOUNDS.max
    );
  if (name === 'collapsedTabTop')
    return (
      typeof value === 'number' &&
      Number.isFinite(value) &&
      value >= COLLAPSED_TAB_TOP_BOUNDS.min &&
      value <= COLLAPSED_TAB_TOP_BOUNDS.max
    );
  if (name === 'hotkeyFocus' || name === 'hotkeyClear' || name === 'liveSearchSelectedLeague')
    return typeof value === 'string';
  return typeof value === 'string' && value.length > 0;
}

function normalizePreference(name: keyof Preferences, value: unknown) {
  if (name === 'theme') return normalizeThemeId(value);
  if (name === 'themeCustomOverrides') return normalizeThemeOverridesJson(value);
  if (name === 'densityScale') {
    if ((DENSITY_SCALE_VALUES as readonly unknown[]).includes(value)) return value;
    if (value === 0.7 || value === 0.85) return 0.8;
    if (value === 1.15) return 1;
    return DEFAULT_PREFERENCES.densityScale;
  }
  return isValidPreference(name, value) ? value : DEFAULT_PREFERENCES[name];
}

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

type LegacyVersionedGlobalPreferenceName =
  (typeof LEGACY_VERSIONED_GLOBAL_PREFERENCE_NAMES)[number];

const OTHER_VERSION: Readonly<Record<PoeVersion, PoeVersion>> = {
  poe1: 'poe2',
  poe2: 'poe1',
};

function migrateLegacyGlobalField(
  name: LegacyVersionedGlobalPreferenceName,
  candidateVersions: readonly PoeVersion[],
  stored: Readonly<Record<string, unknown>>,
  loaded: Preferences,
  repairs: Record<string, unknown>,
): boolean {
  if (stored[name] !== undefined) return false;
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
        ...LEGACY_DISPLAY_LOCALE_KEYS,
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
    if (stored.displayLocale === undefined) {
      const migrated = migrateLegacyDisplayLocale(stored);
      if (migrated !== undefined) {
        loaded.displayLocale = migrated;
        repairs.displayLocale = migrated;
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
