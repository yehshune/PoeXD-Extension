import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PREFERENCES,
  GLOBAL_PREFERENCE_NAMES,
  type Preferences,
} from '@/utils/preferences-contract';
import {
  createInMemoryPreferencesStorage,
  createPreferencesModule,
  type PreferencesModule,
  type PreferencesUpdateOutcome,
} from '@/utils/preferences';
import {
  SETTINGS_EXPORT_FORMAT,
  applyParsedSettingsImport,
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
  it('exports v2 bundle splitting global, poe1, and poe2 without duplicating global keys', () => {
    const poe1 = {
      ...DEFAULT_PREFERENCES,
      theme: 'caffeine',
      collapsedTabTop: 220,
      sidebarModuleBookmarks: false,
      liveSearchMaxDisplayedResults: 200,
    } as Preferences;
    const poe2 = {
      ...DEFAULT_PREFERENCES,
      theme: 'caffeine',
      collapsedTabTop: 220,
      sidebarModuleBookmarks: true,
      enableItemNormalizer: false,
      liveSearchMaxDisplayedResults: 500,
    } as Preferences;

    const exported = createSettingsExport({ poe1, poe2 }, 'poe2', new Date('2026-11-19T08:00:00Z'));

    expect(exported.format).toBe(SETTINGS_EXPORT_FORMAT);
    expect(exported.schemaVersion).toBe(2);
    expect(exported.exportedAt).toBe('2026-11-19T08:00:00.000Z');
    expect(exported.global).toMatchObject({
      theme: 'caffeine',
      collapsedTabTop: 220,
    });
    expect(Object.keys(exported.global).sort()).toEqual([...GLOBAL_PREFERENCE_NAMES].sort());
    expect(exported.poe1).toMatchObject({
      sidebarModuleBookmarks: false,
      liveSearchMaxDisplayedResults: 200,
    });
    expect(exported.poe2).toMatchObject({
      sidebarModuleBookmarks: true,
      enableItemNormalizer: false,
      liveSearchMaxDisplayedResults: 500,
    });
    expect('theme' in exported.poe1).toBe(false);
    expect('theme' in exported.poe2).toBe(false);
  });
});

describe('parseSettingsImport', () => {
  const wrapV1 = (preferences: unknown) =>
    JSON.stringify({ format: SETTINGS_EXPORT_FORMAT, schemaVersion: 1, preferences });

  const wrapV2 = (payload: Record<string, unknown>) =>
    JSON.stringify({ format: SETTINGS_EXPORT_FORMAT, schemaVersion: 2, ...payload });

  it('rejects text that is not JSON', () => {
    expect(parseSettingsImport('not json')).toEqual({ ok: false, error: 'invalid-json' });
  });

  it('rejects JSON that is not a PoeXD settings export', () => {
    expect(parseSettingsImport('{"bookmarks":[]}')).toEqual({ ok: false, error: 'wrong-format' });
    expect(parseSettingsImport(wrapV1(null))).toEqual({ ok: false, error: 'wrong-format' });
    expect(parseSettingsImport('[1,2]')).toEqual({ ok: false, error: 'wrong-format' });
    expect(parseSettingsImport(wrapV2({}))).toEqual({ ok: false, error: 'wrong-format' });
    expect(parseSettingsImport(wrapV2({ global: null, poe1: {} }))).toEqual({
      ok: false,
      error: 'wrong-format',
    });
  });

  it('parses legacy v1 exports and reports unknown keys', () => {
    const outcome = parseSettingsImport(wrapV1({ theme: 'caffeine', notAPreference: 1 }));
    expect(outcome).toEqual({
      ok: true,
      data: {
        version: 1,
        preferences: { theme: 'caffeine' },
      },
      unknown: ['notAPreference'],
    });
  });

  it('parses v2 exports, validates section scopes, and reports unknown or misplaced keys', () => {
    const outcome = parseSettingsImport(
      wrapV2({
        global: { theme: 'caffeine', sidebarModuleBookmarks: false, bogus: 1 },
        poe1: { sidebarModuleBookmarks: false, theme: 'catppuccin' },
        poe2: { enableItemNormalizer: false, unknownPoe2: true },
      }),
    );

    expect(outcome).toEqual({
      ok: true,
      data: {
        version: 2,
        global: { theme: 'caffeine' },
        poe1: { sidebarModuleBookmarks: false },
        poe2: { enableItemNormalizer: false },
      },
      unknown: ['global.sidebarModuleBookmarks', 'global.bogus', 'poe1.theme', 'poe2.unknownPoe2'],
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

describe('applyParsedSettingsImport', () => {
  it('applies v2 bundle across global, poe1, and poe2 while reporting version-qualified rejections', async () => {
    const storage = createInMemoryPreferencesStorage();
    const poe1Res = await createPreferencesModule('poe1', storage);
    const poe2Res = await createPreferencesModule('poe2', storage);
    if (!poe1Res.ok || !poe2Res.ok) throw new Error('failed to initialize preferences');
    const modules = { poe1: poe1Res.value, poe2: poe2Res.value };

    const result = await applyParsedSettingsImport(
      modules,
      {
        version: 2,
        global: { theme: 'catppuccin', collapsedTabTop: 260 },
        poe1: { sidebarModuleBookmarks: false, liveSearchMaxDisplayedResults: 200 },
        poe2: {
          enableItemNormalizer: false,
          liveSearchMaxDisplayedResults: 999 as any,
        },
      },
      'poe2',
    );

    expect(result).toEqual({
      applied: [
        'theme',
        'collapsedTabTop',
        'poe1.sidebarModuleBookmarks',
        'poe1.liveSearchMaxDisplayedResults',
        'poe2.enableItemNormalizer',
      ],
      rejected: ['poe2.liveSearchMaxDisplayedResults'],
    });
    expect(modules.poe1.read()).toMatchObject({
      theme: 'catppuccin',
      collapsedTabTop: 260,
      sidebarModuleBookmarks: false,
      liveSearchMaxDisplayedResults: 200,
    });
    expect(modules.poe2.read()).toMatchObject({
      theme: 'catppuccin',
      collapsedTabTop: 260,
      enableItemNormalizer: false,
      liveSearchMaxDisplayedResults: 100,
    });
  });

  it('applies legacy v1 import to the current game version module', async () => {
    const storage = createInMemoryPreferencesStorage();
    const poe1Res = await createPreferencesModule('poe1', storage);
    const poe2Res = await createPreferencesModule('poe2', storage);
    if (!poe1Res.ok || !poe2Res.ok) throw new Error('failed to initialize preferences');
    const modules = { poe1: poe1Res.value, poe2: poe2Res.value };

    const result = await applyParsedSettingsImport(
      modules,
      {
        version: 1,
        preferences: { theme: 'caffeine', sidebarModuleBookmarks: false },
      },
      'poe1',
    );

    expect(result).toEqual({
      applied: ['theme', 'sidebarModuleBookmarks'],
      rejected: [],
    });
    expect(modules.poe1.read().sidebarModuleBookmarks).toBe(false);
    expect(modules.poe2.read().sidebarModuleBookmarks).toBe(true);
    expect(modules.poe2.read().theme).toBe('caffeine');
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
