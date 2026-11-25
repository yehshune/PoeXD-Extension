import {
  DEFAULT_PREFERENCES,
  PREFERENCE_NAMES,
  isGlobalPreference,
  type GlobalPreferences,
  type Preferences,
  type VersionedPreferences,
} from './preferences-contract';
import type { PreferencesModule, PreferencesUpdateOutcome } from './preferences';
import type { PoeVersion } from './trade-context';

export const SETTINGS_EXPORT_FORMAT = 'poexd-settings';
const SCHEMA_VERSION = 2;
const PREFERENCE_NAME_SET = new Set<string>(PREFERENCE_NAMES);

export interface SettingsExportV1 {
  format: typeof SETTINGS_EXPORT_FORMAT;
  schemaVersion: 1;
  gameVersion: PoeVersion;
  exportedAt: string;
  preferences: Readonly<Preferences>;
}

export interface SettingsExportV2 {
  format: typeof SETTINGS_EXPORT_FORMAT;
  schemaVersion: typeof SCHEMA_VERSION;
  exportedAt: string;
  global: GlobalPreferences;
  poe1: VersionedPreferences;
  poe2: VersionedPreferences;
}

export type SettingsExport = SettingsExportV2;

export type ParsedSettingsImport =
  | {
      version: 1;
      preferences: Partial<Preferences>;
    }
  | {
      version: 2;
      global: Partial<GlobalPreferences>;
      poe1: Partial<VersionedPreferences>;
      poe2: Partial<VersionedPreferences>;
    };

export type SettingsImportParseOutcome =
  | { ok: true; data: ParsedSettingsImport; unknown: string[] }
  | { ok: false; error: 'invalid-json' | 'wrong-format' };

export interface SettingsImportResult {
  applied: string[];
  rejected: string[];
}

function pickPreferencesByScope<T extends Partial<Preferences>>(
  snapshot: Readonly<Preferences>,
  predicate: (name: keyof Preferences) => boolean,
): T {
  return Object.fromEntries(
    PREFERENCE_NAMES.filter(predicate).map((name) => [name, snapshot[name]]),
  ) as T;
}

/** 匯出全域與 PoE 1 / PoE 2 所有設定（不含書籤、歷史等資料）。 */
export function createSettingsExport(
  snapshots: Readonly<Record<PoeVersion, Readonly<Preferences>>>,
  currentVersion: PoeVersion = 'poe1',
  now: Date = new Date(),
): SettingsExportV2 {
  return {
    format: SETTINGS_EXPORT_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    global: pickPreferencesByScope<GlobalPreferences>(snapshots[currentVersion], (name) =>
      isGlobalPreference(name),
    ),
    poe1: pickPreferencesByScope<VersionedPreferences>(
      snapshots.poe1,
      (name) => !isGlobalPreference(name),
    ),
    poe2: pickPreferencesByScope<VersionedPreferences>(
      snapshots.poe2,
      (name) => !isGlobalPreference(name),
    ),
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatScopedName(name: string, prefix = ''): string {
  return prefix ? `${prefix}.${name}` : name;
}

function filterKnownEntries<T extends object>(
  source: Record<string, unknown>,
  accept: (name: string) => boolean,
  prefix = '',
): { picked: Partial<T>; unknown: string[] } {
  const entries = Object.entries(source);
  return {
    picked: Object.fromEntries(entries.filter(([name]) => accept(name))) as Partial<T>,
    unknown: entries
      .map(([name]) => name)
      .filter((name) => !accept(name))
      .map((name) => formatScopedName(name, prefix)),
  };
}

function parseScopedSection<T extends object>(
  raw: unknown,
  prefix: string,
  accept: (name: string) => boolean,
): { picked: Partial<T>; unknown: string[] } {
  return isPlainObject(raw)
    ? filterKnownEntries<T>(raw, accept, prefix)
    : { picked: {}, unknown: [] };
}

/** 解析匯入檔：支援 v2（全域＋PoE 1＋PoE 2）與舊版 v1（單一版本），值的合法性交給 Preferences 模組驗證。 */
export function parseSettingsImport(text: string): SettingsImportParseOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'invalid-json' };
  }
  if (!isPlainObject(parsed) || parsed.format !== SETTINGS_EXPORT_FORMAT) {
    return { ok: false, error: 'wrong-format' };
  }

  if (parsed.schemaVersion === 2) {
    const sections = ['global', 'poe1', 'poe2'] as const;
    const hasAnySection = sections.some((key) => parsed[key] !== undefined);
    const allPresentAreObjects = sections.every(
      (key) => parsed[key] === undefined || isPlainObject(parsed[key]),
    );
    if (!hasAnySection || !allPresentAreObjects) {
      return { ok: false, error: 'wrong-format' };
    }
    const isKnownGlobal = (name: string) =>
      PREFERENCE_NAME_SET.has(name) && isGlobalPreference(name);
    const isKnownVersioned = (name: string) =>
      PREFERENCE_NAME_SET.has(name) && !isGlobalPreference(name);
    const globalRes = parseScopedSection<GlobalPreferences>(parsed.global, 'global', isKnownGlobal);
    const poe1Res = parseScopedSection<VersionedPreferences>(parsed.poe1, 'poe1', isKnownVersioned);
    const poe2Res = parseScopedSection<VersionedPreferences>(parsed.poe2, 'poe2', isKnownVersioned);

    return {
      ok: true,
      data: {
        version: 2,
        global: globalRes.picked,
        poe1: poe1Res.picked,
        poe2: poe2Res.picked,
      },
      unknown: [...globalRes.unknown, ...poe1Res.unknown, ...poe2Res.unknown],
    };
  }

  if (
    (parsed.schemaVersion === undefined || parsed.schemaVersion === 1) &&
    isPlainObject(parsed.preferences)
  ) {
    const res = filterKnownEntries<Preferences>(parsed.preferences, (name) =>
      PREFERENCE_NAME_SET.has(name),
    );
    return {
      ok: true,
      data: {
        version: 1,
        preferences: res.picked,
      },
      unknown: res.unknown,
    };
  }

  return { ok: false, error: 'wrong-format' };
}

/**
 * 套用單一模組的設定變更。整批合法就一次寫入；有任何不合法的值時改為逐項寫入，
 * 讓合法的設定照樣生效，並回報被拒絕的名稱。
 */
export async function applySettingsImport(
  preferences: PreferencesModule,
  changes: Partial<Preferences>,
  prefix = '',
): Promise<SettingsImportResult> {
  const names = Object.keys(changes);
  if (names.length === 0) return { applied: [], rejected: [] };
  const batch = await preferences.update(changes);
  if (batch.ok)
    return { applied: names.map((name) => formatScopedName(name, prefix)), rejected: [] };

  const results = [];
  for (const name of names) {
    const outcome = await preferences.update({
      [name]: changes[name as keyof Preferences],
    } as Partial<Preferences>);
    results.push({ name: formatScopedName(name, prefix), ok: outcome.ok });
  }
  return {
    applied: results.filter((result) => result.ok).map((result) => result.name),
    rejected: results.filter((result) => !result.ok).map((result) => result.name),
  };
}

/** 套用已解析的匯入資料（v2 同時寫入全域與 PoE 1 / PoE 2；v1 寫入當前版本）。 */
export async function applyParsedSettingsImport(
  modules: Readonly<Record<PoeVersion, PreferencesModule>>,
  data: ParsedSettingsImport,
  currentVersion: PoeVersion,
): Promise<SettingsImportResult> {
  if (data.version === 1) {
    return applySettingsImport(modules[currentVersion], data.preferences);
  }
  const globalResult = await applySettingsImport(modules[currentVersion], data.global);
  const poe1Result = await applySettingsImport(modules.poe1, data.poe1, 'poe1');
  const poe2Result = await applySettingsImport(modules.poe2, data.poe2, 'poe2');
  return {
    applied: [...globalResult.applied, ...poe1Result.applied, ...poe2Result.applied],
    rejected: [...globalResult.rejected, ...poe1Result.rejected, ...poe2Result.rejected],
  };
}

/** 目前版本的設定恢復預設值（全域設定同步恢復，不影響另一代的分版本設定與書籤/歷史）。 */
export function resetSettingsToDefaults(
  preferences: PreferencesModule,
): Promise<PreferencesUpdateOutcome> {
  return preferences.update({ ...DEFAULT_PREFERENCES });
}
