import { DEFAULT_PREFERENCES, type Preferences } from './preferences-contract';
import type { PreferencesModule, PreferencesUpdateOutcome } from './preferences';
import type { PoeVersion } from './trade-context';

export const SETTINGS_EXPORT_FORMAT = 'poexd-settings';
const SCHEMA_VERSION = 1;
const PREFERENCE_NAMES = new Set(Object.keys(DEFAULT_PREFERENCES));

export interface SettingsExport {
  format: typeof SETTINGS_EXPORT_FORMAT;
  schemaVersion: number;
  gameVersion: PoeVersion;
  exportedAt: string;
  preferences: Readonly<Preferences>;
}

export type SettingsImportParseOutcome =
  | { ok: true; preferences: Partial<Preferences>; unknown: string[] }
  | { ok: false; error: 'invalid-json' | 'wrong-format' };

export interface SettingsImportResult {
  applied: string[];
  rejected: string[];
}

/** 匯出目前版本的所有設定（不含書籤、歷史等資料）。 */
export function createSettingsExport(
  snapshot: Readonly<Preferences>,
  gameVersion: PoeVersion,
  now: Date = new Date(),
): SettingsExport {
  return {
    format: SETTINGS_EXPORT_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    gameVersion,
    exportedAt: now.toISOString(),
    preferences: { ...snapshot },
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 解析匯入檔：只保留已知的設定名稱，值的合法性交給 Preferences 模組驗證。 */
export function parseSettingsImport(text: string): SettingsImportParseOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'invalid-json' };
  }
  if (
    !isPlainObject(parsed) ||
    parsed.format !== SETTINGS_EXPORT_FORMAT ||
    !isPlainObject(parsed.preferences)
  ) {
    return { ok: false, error: 'wrong-format' };
  }
  const entries = Object.entries(parsed.preferences);
  return {
    ok: true,
    preferences: Object.fromEntries(
      entries.filter(([name]) => PREFERENCE_NAMES.has(name)),
    ) as Partial<Preferences>,
    unknown: entries.map(([name]) => name).filter((name) => !PREFERENCE_NAMES.has(name)),
  };
}

/**
 * 套用匯入的設定。整批合法就一次寫入；有任何不合法的值時改為逐項寫入，
 * 讓合法的設定照樣生效，並回報被拒絕的名稱。
 */
export async function applySettingsImport(
  preferences: PreferencesModule,
  changes: Partial<Preferences>,
): Promise<SettingsImportResult> {
  const names = Object.keys(changes);
  if (names.length === 0) return { applied: [], rejected: [] };
  const batch = await preferences.update(changes);
  if (batch.ok) return { applied: names, rejected: [] };

  const results = [];
  for (const name of names) {
    const outcome = await preferences.update({
      [name]: changes[name as keyof Preferences],
    } as Partial<Preferences>);
    results.push({ name, ok: outcome.ok });
  }
  return {
    applied: results.filter((result) => result.ok).map((result) => result.name),
    rejected: results.filter((result) => !result.ok).map((result) => result.name),
  };
}

/** 所有設定恢復預設值（不影響書籤、歷史等資料）。 */
export function resetSettingsToDefaults(
  preferences: PreferencesModule,
): Promise<PreferencesUpdateOutcome> {
  return preferences.update({ ...DEFAULT_PREFERENCES });
}
