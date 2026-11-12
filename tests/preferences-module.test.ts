import { describe, expect, it } from 'vitest';
import { createInMemoryPreferencesStorage, createPreferencesModule } from '@/utils/preferences';

describe('Preferences module interface', () => {
  it('opens an empty game-version store with canonical defaults', async () => {
    const outcome = await createPreferencesModule('poe2', createInMemoryPreferencesStorage());

    expect(outcome).toMatchObject({
      ok: true,
      value: {
        read: expect.any(Function),
      },
    });
    if (!outcome.ok) throw new Error(outcome.error.message);
    expect(outcome.value.read()).toEqual({
      addBookmarkBtnPosition: 'top',
      customFontSizeScale: null,
      customSidebarWidth: null,
      densityScale: 1,
      displayLocale: 'auto',
      enableAffixSelector: true,
      enableAutoTitle: true,
      enableBookmarkTooltip: true,
      enableFilterTilde: true,
      enableHotkeys: true,
      enableItemNormalizer: true,
      enablePriceComparison: true,
      enablePureBackground: true,
      enableResultModHighlight: true,
      enableSearchTilde: true,
      enableTierHelper: true,
      fontSizeMode: 'medium',
      fontSizeScale: 1,
      hotkeyClear: '\\',
      hotkeyFocus: '/',
      liveSearchMaxDisplayedResults: 100,
      liveSearchResumeMode: 'prompt',
      liveSearchSelectedLeague: '',
      marketTranslation: false,
      marketTranslationBilingual: true,
      searchEntryClickAction: 'preview',
      sidebarPosition: 'left',
      sidebarSize: 'medium',
      sidebarWidth: 380,
      theme: 'modern-dark',
    });
  });

  it('reads committed values from the selected game version', async () => {
    const outcome = await createPreferencesModule(
      'poe1',
      createInMemoryPreferencesStorage({
        sidebarPosition_poe1: 'right',
        enableAutoTitle_poe1: false,
        enablePureBackground_poe1: false,
        sidebarPosition_poe2: 'left',
      }),
    );

    if (!outcome.ok) throw new Error(outcome.error.message);
    expect(outcome.value.read()).toMatchObject({
      sidebarPosition: 'right',
      enableAutoTitle: false,
      enablePureBackground: false,
    });
  });

  it('repairs invalid committed values to canonical defaults', async () => {
    const storage = createInMemoryPreferencesStorage({
      sidebarPosition_poe2: 'center',
      sidebarWidth_poe2: 1200,
      fontSizeScale_poe2: 'large',
      enableHotkeys_poe2: 'yes',
    });
    const outcome = await createPreferencesModule('poe2', storage);

    if (!outcome.ok) throw new Error(outcome.error.message);
    expect({
      snapshot: outcome.value.read(),
      stored: storage.inspect(),
    }).toMatchObject({
      snapshot: {
        sidebarPosition: 'left',
        sidebarWidth: 380,
        fontSizeScale: 1,
        enableHotkeys: true,
      },
      stored: {
        sidebarPosition_poe2: 'left',
        sidebarWidth_poe2: 380,
        fontSizeScale_poe2: 1,
        enableHotkeys_poe2: true,
      },
    });
  });

  it('migrates legacy values without deleting the recovery snapshot', async () => {
    const storage = createInMemoryPreferencesStorage({
      sidebarPosition: 'right',
      enableAutoTitle: false,
    });
    const outcome = await createPreferencesModule('poe2', storage);

    if (!outcome.ok) throw new Error(outcome.error.message);
    expect({
      snapshot: outcome.value.read(),
      stored: storage.inspect(),
    }).toMatchObject({
      snapshot: {
        sidebarPosition: 'right',
        enableAutoTitle: false,
      },
      stored: {
        sidebarPosition: 'right',
        enableAutoTitle: false,
        sidebarPosition_poe2: 'right',
        enableAutoTitle_poe2: false,
      },
    });
  });

  it('delivers the current committed snapshot when a caller subscribes', async () => {
    const outcome = await createPreferencesModule(
      'poe1',
      createInMemoryPreferencesStorage({ sidebarPosition_poe1: 'right' }),
    );
    if (!outcome.ok) throw new Error(outcome.error.message);
    const positions: string[] = [];

    const unsubscribe = outcome.value.subscribe((snapshot) => {
      positions.push(snapshot.sidebarPosition);
    });
    unsubscribe();

    expect(positions).toEqual(['right']);
  });

  it('commits a typed change set and publishes one new snapshot', async () => {
    const storage = createInMemoryPreferencesStorage();
    const outcome = await createPreferencesModule('poe2', storage);
    if (!outcome.ok) throw new Error(outcome.error.message);
    const widths: number[] = [];
    outcome.value.subscribe((snapshot) => widths.push(snapshot.sidebarWidth));

    const update = await outcome.value.update({
      sidebarSize: 'large',
      sidebarWidth: 420,
    });

    expect({
      update,
      snapshot: outcome.value.read(),
      widths,
      stored: storage.inspect(),
    }).toMatchObject({
      update: { ok: true, changed: true },
      snapshot: { sidebarSize: 'large', sidebarWidth: 420 },
      widths: [380, 420],
      stored: { sidebarSize_poe2: 'large', sidebarWidth_poe2: 420 },
    });
  });

  it('keeps the committed snapshot when storage rejects an update', async () => {
    const storage = createInMemoryPreferencesStorage({}, { setError: 'quota exceeded' });
    const outcome = await createPreferencesModule('poe1', storage);
    if (!outcome.ok) throw new Error(outcome.error.message);
    const widths: number[] = [];
    outcome.value.subscribe((snapshot) => widths.push(snapshot.sidebarWidth));

    const update = await outcome.value.update({ sidebarWidth: 420 });

    expect({ update, snapshot: outcome.value.read(), widths }).toEqual({
      update: {
        ok: false,
        error: { code: 'unavailable', message: 'quota exceeded' },
      },
      snapshot: expect.objectContaining({ sidebarWidth: 380 }),
      widths: [380],
    });
  });

  it('publishes one validated snapshot for an external multi-key change', async () => {
    const storage = createInMemoryPreferencesStorage();
    const outcome = await createPreferencesModule('poe2', storage);
    if (!outcome.ok) throw new Error(outcome.error.message);
    const snapshots: Array<{ position: string; scale: number }> = [];
    outcome.value.subscribe((snapshot) =>
      snapshots.push({
        position: snapshot.sidebarPosition,
        scale: snapshot.fontSizeScale,
      }),
    );

    await storage.setExternal({
      sidebarPosition_poe2: 'right',
      fontSizeScale_poe2: 1.2,
    });

    expect(snapshots).toEqual([
      { position: 'left', scale: 1 },
      { position: 'right', scale: 1.2 },
    ]);
  });

  it('returns unavailable instead of exposing defaults after a load failure', async () => {
    const outcome = await createPreferencesModule(
      'poe1',
      createInMemoryPreferencesStorage({}, { getError: 'storage offline' }),
    );

    expect(outcome).toEqual({
      ok: false,
      error: { code: 'unavailable', message: 'storage offline' },
    });
  });

  it('rejects invalid changes without altering committed state', async () => {
    const storage = createInMemoryPreferencesStorage();
    const outcome = await createPreferencesModule('poe1', storage);
    if (!outcome.ok) throw new Error(outcome.error.message);

    const update = await outcome.value.update({ sidebarWidth: 250 });

    expect({ update, width: outcome.value.read().sidebarWidth, stored: storage.inspect() }).toEqual(
      {
        update: {
          ok: false,
          error: { code: 'invalid', message: 'Invalid Preference: sidebarWidth' },
        },
        width: 380,
        stored: {},
      },
    );
  });

  it('keeps a versioned value when a different legacy value exists', async () => {
    const storage = createInMemoryPreferencesStorage({
      sidebarPosition: 'left',
      sidebarPosition_poe2: 'right',
    });
    const outcome = await createPreferencesModule('poe2', storage);

    if (!outcome.ok) throw new Error(outcome.error.message);
    expect(outcome.value.read().sidebarPosition).toBe('right');
  });

  it('isolates a failing subscriber from committed delivery', async () => {
    const outcome = await createPreferencesModule('poe1', createInMemoryPreferencesStorage());
    if (!outcome.ok) throw new Error(outcome.error.message);
    outcome.value.subscribe(() => {
      throw new Error('broken caller');
    });
    const widths: number[] = [];
    outcome.value.subscribe((snapshot) => widths.push(snapshot.sidebarWidth));

    await outcome.value.update({ sidebarWidth: 420 });

    expect(widths).toEqual([380, 420]);
  });

  it('prevents callers from mutating a committed snapshot', async () => {
    const outcome = await createPreferencesModule('poe1', createInMemoryPreferencesStorage());
    if (!outcome.ok) throw new Error(outcome.error.message);
    outcome.value.subscribe((snapshot) => {
      (snapshot as Preferences).sidebarWidth = 500;
    });
    const widths: number[] = [];
    outcome.value.subscribe((snapshot) => widths.push(snapshot.sidebarWidth));

    expect({ frozen: Object.isFrozen(outcome.value.read()), widths }).toEqual({
      frozen: true,
      widths: [380],
    });
  });

  it('repairs an invalid external value without publishing an invalid snapshot', async () => {
    const storage = createInMemoryPreferencesStorage();
    const outcome = await createPreferencesModule('poe2', storage);
    if (!outcome.ok) throw new Error(outcome.error.message);
    const positions: string[] = [];
    outcome.value.subscribe((snapshot) => positions.push(snapshot.sidebarPosition));

    await storage.setExternal({ sidebarPosition_poe2: 'center' });

    expect({ positions, stored: storage.inspect() }).toMatchObject({
      positions: ['left'],
      stored: { sidebarPosition_poe2: 'left' },
    });
  });

  it('normalizes legacy densityScale values to canonical standards', async () => {
    const storage = createInMemoryPreferencesStorage({
      densityScale_poe1: 0.85,
      densityScale_poe2: 1.15,
    });
    const poe1Module = await createPreferencesModule('poe1', storage);
    const poe2Module = await createPreferencesModule('poe2', storage);
    if (!poe1Module.ok || !poe2Module.ok) throw new Error('failed to load preferences');

    expect(poe1Module.value.read().densityScale).toBe(0.8);
    expect(poe2Module.value.read().densityScale).toBe(1);

    const updateOutcome = await poe2Module.value.update({ densityScale: 0.8 });
    expect(updateOutcome).toEqual({ ok: true, changed: true });
    expect(poe2Module.value.read().densityScale).toBe(0.8);
  });

  it('accepts valid fontSizeMode values and rejects invalid values', async () => {
    const storage = createInMemoryPreferencesStorage();
    const outcome = await createPreferencesModule('poe2', storage);
    if (!outcome.ok) throw new Error(outcome.error.message);

    for (const mode of ['small', 'medium', 'large', 'custom'] as const) {
      const update = await outcome.value.update({ fontSizeMode: mode });
      expect(update).toEqual({ ok: true, changed: true });
      expect(outcome.value.read().fontSizeMode).toBe(mode);
    }

    const invalidUpdate = await outcome.value.update({ fontSizeMode: 'huge' as any });
    expect(invalidUpdate).toEqual({
      ok: false,
      error: { code: 'invalid', message: 'Invalid Preference: fontSizeMode' },
    });
  });

  it('repairs invalid committed fontSizeMode to canonical default', async () => {
    const storage = createInMemoryPreferencesStorage({
      fontSizeMode_poe2: 'huge',
    });
    const outcome = await createPreferencesModule('poe2', storage);
    if (!outcome.ok) throw new Error(outcome.error.message);

    expect(outcome.value.read().fontSizeMode).toBe('medium');
    expect(storage.inspect().fontSizeMode_poe2).toBe('medium');
  });

  it('infers fontSizeMode from legacy fontSizeScale and persists to versioned storage', async () => {
    const cases = [
      { scale: 0.85, expectedMode: 'small' },
      { scale: 1, expectedMode: 'medium' },
      { scale: 1.2, expectedMode: 'large' },
      { scale: 1.35, expectedMode: 'custom' },
    ] as const;

    for (const { scale, expectedMode } of cases) {
      const storage = createInMemoryPreferencesStorage({
        fontSizeScale_poe2: scale,
      });
      const outcome = await createPreferencesModule('poe2', storage);
      if (!outcome.ok) throw new Error(outcome.error.message);

      expect(outcome.value.read().fontSizeMode).toBe(expectedMode);
      expect(outcome.value.read().fontSizeScale).toBe(scale);
      expect(storage.inspect().fontSizeMode_poe2).toBe(expectedMode);
      expect(storage.inspect().fontSizeScale_poe2).toBe(scale);
    }
  });

  it('persists and normalizes versioned LiveSearch console display preferences', async () => {
    const storage = createInMemoryPreferencesStorage({
      liveSearchMaxDisplayedResults_poe1: 123,
      liveSearchMaxDisplayedResults_poe2: 500,
    });
    const poe1Outcome = await createPreferencesModule('poe1', storage);
    const poe2Outcome = await createPreferencesModule('poe2', storage);
    if (!poe1Outcome.ok || !poe2Outcome.ok) throw new Error('failed to load preferences');

    expect(poe1Outcome.value.read().liveSearchMaxDisplayedResults).toBe(100);
    expect(poe2Outcome.value.read().liveSearchMaxDisplayedResults).toBe(500);

    const updateRes = await poe1Outcome.value.update({ liveSearchMaxDisplayedResults: 200 });
    expect(updateRes).toEqual({ ok: true, changed: true });
    expect(storage.inspect()).toMatchObject({
      liveSearchMaxDisplayedResults_poe1: 200,
      liveSearchMaxDisplayedResults_poe2: 500,
    });
  });

  it('rejects removed showLiveSearchDiagnostics preference and ignores its stored value', async () => {
    const storage = createInMemoryPreferencesStorage({ showLiveSearchDiagnostics_poe1: true });
    const poe1Outcome = await createPreferencesModule('poe1', storage);
    if (!poe1Outcome.ok) throw new Error('failed to load preferences');

    expect('showLiveSearchDiagnostics' in poe1Outcome.value.read()).toBe(false);
    const updateRes = await poe1Outcome.value.update({ showLiveSearchDiagnostics: true } as any);
    expect(updateRes).toEqual({
      ok: false,
      error: { code: 'invalid', message: 'Invalid Preference: showLiveSearchDiagnostics' },
    });
  });

  it('rejects removed transitional affixDisplayLocale preference as invalid', async () => {
    const storage = createInMemoryPreferencesStorage();
    const poe1Outcome = await createPreferencesModule('poe1', storage);
    if (!poe1Outcome.ok) throw new Error('failed to load preferences');

    expect('affixDisplayLocale' in poe1Outcome.value.read()).toBe(false);

    const updateRes = await poe1Outcome.value.update({
      affixDisplayLocale: 'zh-CN',
    } as any);
    expect(updateRes).toEqual({
      ok: false,
      error: { code: 'invalid', message: 'Invalid Preference: affixDisplayLocale' },
    });
  });

  it('persists displayLocale as an unversioned global key and notifies subscribers across game versions', async () => {
    const storage = createInMemoryPreferencesStorage();
    const poe1Outcome = await createPreferencesModule('poe1', storage);
    const poe2Outcome = await createPreferencesModule('poe2', storage);
    if (!poe1Outcome.ok || !poe2Outcome.ok) throw new Error('failed to load preferences');

    const poe2Locales: string[] = [];
    poe2Outcome.value.subscribe((snapshot) => poe2Locales.push(snapshot.displayLocale));

    expect(poe1Outcome.value.read().displayLocale).toBe('auto');
    expect(poe2Outcome.value.read().displayLocale).toBe('auto');

    const updateRes = await poe1Outcome.value.update({ displayLocale: 'zh-CN' });
    expect(updateRes).toEqual({ ok: true, changed: true });
    expect(storage.inspect().displayLocale).toBe('zh-CN');
    expect(storage.inspect().displayLocale_poe1).toBeUndefined();
    expect(poe1Outcome.value.read().displayLocale).toBe('zh-CN');
    expect(poe2Outcome.value.read().displayLocale).toBe('zh-CN');
    expect(poe2Locales).toEqual(['auto', 'zh-CN']);

    const invalidUpdate = await poe2Outcome.value.update({ displayLocale: 'klingon' as any });
    expect(invalidUpdate).toEqual({
      ok: false,
      error: { code: 'invalid', message: 'Invalid Preference: displayLocale' },
    });
  });

  it('migrates legacy affixDisplayLocale_poe2 / affixDisplayLocale_poe1 to global displayLocale when unset without deleting recovery snapshots', async () => {
    // Case 1: poe2 has non-auto ('ja'), poe1 has 'auto' -> prefers non-auto ('ja')
    const storage1 = createInMemoryPreferencesStorage({
      affixDisplayLocale_poe1: 'auto',
      affixDisplayLocale_poe2: 'ja',
    });
    const outcome1 = await createPreferencesModule('poe1', storage1);
    if (!outcome1.ok) throw new Error(outcome1.error.message);
    expect(outcome1.value.read().displayLocale).toBe('ja');
    expect(storage1.inspect()).toMatchObject({
      displayLocale: 'ja',
      affixDisplayLocale_poe1: 'auto',
      affixDisplayLocale_poe2: 'ja',
    });

    // Case 2: poe1 has non-auto ('zh-CN'), poe2 is unset -> migrates 'zh-CN'
    const storage2 = createInMemoryPreferencesStorage({
      affixDisplayLocale_poe1: 'zh-CN',
    });
    const outcome2 = await createPreferencesModule('poe2', storage2);
    if (!outcome2.ok) throw new Error(outcome2.error.message);
    expect(outcome2.value.read().displayLocale).toBe('zh-CN');
    expect(storage2.inspect()).toMatchObject({
      displayLocale: 'zh-CN',
      affixDisplayLocale_poe1: 'zh-CN',
    });

    // Case 3: displayLocale already set -> does not overwrite with legacy value
    const storage3 = createInMemoryPreferencesStorage({
      displayLocale: 'en',
      affixDisplayLocale_poe2: 'ru',
    });
    const outcome3 = await createPreferencesModule('poe2', storage3);
    if (!outcome3.ok) throw new Error(outcome3.error.message);
    expect(outcome3.value.read().displayLocale).toBe('en');
    expect(storage3.inspect().displayLocale).toBe('en');
  });
});
