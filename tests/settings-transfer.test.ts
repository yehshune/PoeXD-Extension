import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFERENCES, type Preferences } from '@/utils/preferences-contract';
import type { PreferencesModule, PreferencesUpdateOutcome } from '@/utils/preferences';
import {
  SETTINGS_EXPORT_FORMAT,
  applySettingsImport,
  createSettingsExport,
  parseSettingsImport,
  resetSettingsToDefaults,
} from '@/utils/settings-transfer';

function createFakeModule(
  initial: Partial<Preferences> = {},
  reject: ReadonlySet<string> = new Set(),
): PreferencesModule & { calls: Partial<Preferences>[] } {
  let snapshot: Preferences = { ...DEFAULT_PREFERENCES, ...initial };
  const calls: Partial<Preferences>[] = [];
  return {
    calls,
    read: () => snapshot,
    subscribe: () => () => {},
    async update(changes): Promise<PreferencesUpdateOutcome> {
      calls.push(changes);
      const bad = Object.keys(changes).find((key) => reject.has(key));
      if (bad)
        return { ok: false, error: { code: 'invalid', message: `Invalid Preference: ${bad}` } };
      snapshot = { ...snapshot, ...changes };
      return { ok: true, changed: true };
    },
  };
}

describe('createSettingsExport', () => {
  it('wraps the full preference snapshot with format metadata', () => {
    const snapshot = { ...DEFAULT_PREFERENCES, theme: 'caffeine' } as Preferences;
    const exported = createSettingsExport(snapshot, 'poe2', new Date('2026-11-19T08:00:00Z'));
    expect(exported).toEqual({
      format: SETTINGS_EXPORT_FORMAT,
      schemaVersion: 1,
      gameVersion: 'poe2',
      exportedAt: '2026-11-19T08:00:00.000Z',
      preferences: snapshot,
    });
  });
});

describe('parseSettingsImport', () => {
  const wrap = (preferences: unknown) =>
    JSON.stringify({ format: SETTINGS_EXPORT_FORMAT, schemaVersion: 1, preferences });

  it('rejects text that is not JSON', () => {
    expect(parseSettingsImport('not json')).toEqual({ ok: false, error: 'invalid-json' });
  });

  it('rejects JSON that is not a PoeXD settings export', () => {
    expect(parseSettingsImport('{"bookmarks":[]}')).toEqual({ ok: false, error: 'wrong-format' });
    expect(parseSettingsImport(wrap(null))).toEqual({ ok: false, error: 'wrong-format' });
    expect(parseSettingsImport('[1,2]')).toEqual({ ok: false, error: 'wrong-format' });
  });

  it('keeps known preference names and reports unknown ones', () => {
    const outcome = parseSettingsImport(wrap({ theme: 'caffeine', notAPreference: 1 }));
    expect(outcome).toEqual({
      ok: true,
      preferences: { theme: 'caffeine' },
      unknown: ['notAPreference'],
    });
  });
});

describe('applySettingsImport', () => {
  it('applies every value in one update when all are valid', async () => {
    const mod = createFakeModule();
    const result = await applySettingsImport(mod, { theme: 'caffeine', enableHotkeys: false });
    expect(result).toEqual({ applied: ['theme', 'enableHotkeys'], rejected: [] });
    expect(mod.calls).toHaveLength(1);
    expect(mod.read().theme).toBe('caffeine');
  });

  it('falls back to one value at a time and reports rejected names', async () => {
    const mod = createFakeModule({}, new Set(['sidebarWidth']));
    const result = await applySettingsImport(mod, {
      theme: 'caffeine',
      sidebarWidth: 99999,
      enableHotkeys: false,
    } as Partial<Preferences>);
    expect(result).toEqual({ applied: ['theme', 'enableHotkeys'], rejected: ['sidebarWidth'] });
    expect(mod.read().theme).toBe('caffeine');
    expect(mod.read().enableHotkeys).toBe(false);
  });

  it('does nothing for an empty import', async () => {
    const mod = createFakeModule();
    expect(await applySettingsImport(mod, {})).toEqual({ applied: [], rejected: [] });
    expect(mod.calls).toHaveLength(0);
  });
});

describe('resetSettingsToDefaults', () => {
  it('writes every default preference back', async () => {
    const mod = createFakeModule({ theme: 'caffeine', enableHotkeys: false });
    const outcome = await resetSettingsToDefaults(mod);
    expect(outcome.ok).toBe(true);
    expect(mod.read()).toEqual(DEFAULT_PREFERENCES);
  });
});
