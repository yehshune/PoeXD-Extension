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
      bookmarkClickAction: 'preview',
      collapsedTabTop: 100,
      densityScale: 1,
      displayLocale: 'auto',
      enableAffixSelector: true,
      enableAutoHideOfficialHeader: false,
      enableAutoTitle: true,
      enableFilterTilde: true,
      enableHotkeys: true,
      enableItemNormalizer: true,
      enablePriceComparison: true,
      enablePureBackground: false,
      enableResultExternalLinks: true,
      enableResultModHighlight: true,
      enableResultModQuickFilter: true,
      enableResultPobCopy: true,
      enableSearchTilde: true,
      enableTierHelper: true,
      enableTwoColumnLayout: false,
      fontSizeScale: 1,
      historyClickAction: 'preview',
      hotkeyClear: '\\',
      hotkeyFocus: '/',
      liveSearchDesktopNotificationEnabled: false,
      liveSearchFetchOrder: 'newest',
      liveSearchMaxDisplayedResults: 100,
      liveSearchResumeMode: 'prompt',
      liveSearchSelectedLeague: '',
      liveSearchSoundEnabled: true,
      liveSearchTokenMaxAgeSec: 1,
      marketTranslation: false,
      marketTranslationBilingual: true,
      marketTranslationResultBilingual: false,
      resultModHighlightColor: 'indigo',
      resultModHighlightStyle: 'glow',
      sidebarModuleBookmarks: true,
      sidebarModuleHistory: true,
      sidebarModuleLiveSearch: true,
      sidebarModulePinnedItems: true,
      sidebarModulePobBuild: true,
      sidebarModuleResultBoard: true,
      sidebarModuleStatGroupTemplates: true,
      sidebarPosition: 'left',
      sidebarWidth: 380,
      similarSearchScope: 'category',
      similarSearchTolerance: 80,
      similarSearchWeaponMode: 'auto',
      theme: 'modern-dark',
      themeCustomOverrides: '{}',
      twoColumnFilterWidth: 560,
      twoColumnMaxWidth: 'full',
    });
  });

  it('reads committed values from the selected game version and shared global keys', async () => {
    const outcome = await createPreferencesModule(
      'poe1',
      createInMemoryPreferencesStorage({
        sidebarPosition: 'right',
        enableAutoTitle: false,
        enablePureBackground: true,
        enableTierHelper: false,
        sidebarModuleBookmarks_poe1: false,
        sidebarModuleBookmarks_poe2: true,
      }),
    );

    if (!outcome.ok) throw new Error(outcome.error.message);
    expect(outcome.value.read()).toMatchObject({
      sidebarPosition: 'right',
      enableAutoTitle: false,
      enablePureBackground: true,
      enableTierHelper: false,
      sidebarModuleBookmarks: false,
    });
  });

  it('repairs invalid committed values to canonical defaults', async () => {
    const storage = createInMemoryPreferencesStorage({
      sidebarPosition: 'center',
      sidebarWidth: 1200,
      fontSizeScale: 'large',
      enableHotkeys: 'yes',
      sidebarModuleBookmarks_poe2: 'nope',
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
        sidebarModuleBookmarks: true,
      },
      stored: {
        sidebarPosition: 'left',
        sidebarWidth: 380,
        fontSizeScale: 1,
        enableHotkeys: true,
        sidebarModuleBookmarks_poe2: true,
      },
    });
  });

  it('migrates legacy unversioned values for versioned preferences without deleting the recovery snapshot', async () => {
    const storage = createInMemoryPreferencesStorage({
      sidebarModuleBookmarks: false,
      sidebarModuleHistory: false,
    });
    const outcome = await createPreferencesModule('poe2', storage);

    if (!outcome.ok) throw new Error(outcome.error.message);
    expect({
      snapshot: outcome.value.read(),
      stored: storage.inspect(),
    }).toMatchObject({
      snapshot: {
        sidebarModuleBookmarks: false,
        sidebarModuleHistory: false,
      },
      stored: {
        sidebarModuleBookmarks: false,
        sidebarModuleHistory: false,
        sidebarModuleBookmarks_poe2: false,
        sidebarModuleHistory_poe2: false,
      },
    });
  });

  it('migrates legacy versioned cross-game toggles into shared global keys', async () => {
    const storage = createInMemoryPreferencesStorage({
      enableTierHelper_poe1: false,
      enablePriceComparison_poe2: false,
    });
    const outcome = await createPreferencesModule('poe1', storage);

    if (!outcome.ok) throw new Error(outcome.error.message);
    expect(outcome.value.read()).toMatchObject({
      enableTierHelper: false,
      enablePriceComparison: false,
    });
    expect(storage.inspect()).toMatchObject({
      enableTierHelper: false,
      enablePriceComparison: false,
    });
  });

  it('delivers the current committed snapshot when a caller subscribes', async () => {
    const outcome = await createPreferencesModule(
      'poe1',
      createInMemoryPreferencesStorage({ sidebarPosition: 'right' }),
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
      sidebarWidth: 420,
      sidebarModuleBookmarks: false,
    });

    expect({
      update,
      snapshot: outcome.value.read(),
      widths,
      stored: storage.inspect(),
    }).toMatchObject({
      update: { ok: true, changed: true },
      snapshot: { sidebarWidth: 420, sidebarModuleBookmarks: false },
      widths: [380, 420],
      stored: { sidebarWidth: 420, sidebarModuleBookmarks_poe2: false },
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
      sidebarPosition: 'right',
      fontSizeScale: 1.2,
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
      sidebarModuleBookmarks: true,
      sidebarModuleBookmarks_poe2: false,
    });
    const outcome = await createPreferencesModule('poe2', storage);

    if (!outcome.ok) throw new Error(outcome.error.message);
    expect(outcome.value.read().sidebarModuleBookmarks).toBe(false);
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

    await storage.setExternal({ sidebarPosition: 'center' });

    expect({ positions, stored: storage.inspect() }).toMatchObject({
      positions: ['left'],
      stored: { sidebarPosition: 'left' },
    });
  });

  it('normalizes legacy densityScale values to canonical standards', async () => {
    const storage1 = createInMemoryPreferencesStorage({
      densityScale: 0.85,
    });
    const storage2 = createInMemoryPreferencesStorage({
      densityScale: 1.15,
    });
    const poe1Module = await createPreferencesModule('poe1', storage1);
    const poe2Module = await createPreferencesModule('poe2', storage2);
    if (!poe1Module.ok || !poe2Module.ok) throw new Error('failed to load preferences');

    expect(poe1Module.value.read().densityScale).toBe(0.8);
    expect(poe2Module.value.read().densityScale).toBe(1);

    const updateOutcome = await poe2Module.value.update({ densityScale: 0.8 });
    expect(updateOutcome).toEqual({ ok: true, changed: true });
    expect(poe2Module.value.read().densityScale).toBe(0.8);
  });

  it('accepts valid fontSizeScale values and rejects out-of-range values', async () => {
    const storage = createInMemoryPreferencesStorage();
    const outcome = await createPreferencesModule('poe2', storage);
    if (!outcome.ok) throw new Error(outcome.error.message);

    for (const scale of [0.8, 0.85, 1, 1.2, 1.35, 2] as const) {
      const update = await outcome.value.update({ fontSizeScale: scale });
      expect(update).toEqual({ ok: true, changed: true });
      expect(outcome.value.read().fontSizeScale).toBe(scale);
    }

    for (const invalidScale of [0.75, 2.05, Number.NaN, '1.2' as any]) {
      const invalidUpdate = await outcome.value.update({ fontSizeScale: invalidScale });
      expect(invalidUpdate).toEqual({
        ok: false,
        error: { code: 'invalid', message: 'Invalid Preference: fontSizeScale' },
      });
    }
  });

  it('repairs invalid committed fontSizeScale to canonical default', async () => {
    const storage = createInMemoryPreferencesStorage({
      fontSizeScale: 99,
    });
    const outcome = await createPreferencesModule('poe2', storage);
    if (!outcome.ok) throw new Error(outcome.error.message);

    expect(outcome.value.read().fontSizeScale).toBe(1);
    expect(storage.inspect().fontSizeScale).toBe(1);
  });

  it('migrates legacy fontSizeScale_poe2 to global storage', async () => {
    const cases = [0.85, 1, 1.2, 1.35] as const;

    for (const scale of cases) {
      const storage = createInMemoryPreferencesStorage({
        fontSizeScale_poe2: scale,
      });
      const outcome = await createPreferencesModule('poe2', storage);
      if (!outcome.ok) throw new Error(outcome.error.message);

      expect(outcome.value.read().fontSizeScale).toBe(scale);
      expect(storage.inspect().fontSizeScale).toBe(scale);
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

  it('shares layout, hotkey, and bookmark UI preferences globally across poe1 and poe2', async () => {
    const storage = createInMemoryPreferencesStorage();
    const poe1Outcome = await createPreferencesModule('poe1', storage);
    const poe2Outcome = await createPreferencesModule('poe2', storage);
    if (!poe1Outcome.ok || !poe2Outcome.ok) throw new Error('failed to load preferences');

    const receivedCollapsedTops: number[] = [];
    poe2Outcome.value.subscribe((snapshot) => receivedCollapsedTops.push(snapshot.collapsedTabTop));

    const updateRes = await poe1Outcome.value.update({
      collapsedTabTop: 280,
      sidebarPosition: 'right',
      sidebarWidth: 480,
      fontSizeScale: 1.3,
      densityScale: 0.8,
      enablePureBackground: true,
      enableAutoTitle: false,
      enableHotkeys: false,
      hotkeyFocus: 'k',
      hotkeyClear: 'x',
      enableSearchTilde: false,
      enableFilterTilde: false,
      addBookmarkBtnPosition: 'bottom',
      bookmarkClickAction: 'open',
      historyClickAction: 'preview',
    });

    expect(updateRes).toEqual({ ok: true, changed: true });
    expect(receivedCollapsedTops).toEqual([100, 280]);
    expect(poe2Outcome.value.read()).toMatchObject({
      collapsedTabTop: 280,
      sidebarPosition: 'right',
      sidebarWidth: 480,
      fontSizeScale: 1.3,
      densityScale: 0.8,
      enablePureBackground: true,
      enableAutoTitle: false,
      enableHotkeys: false,
      hotkeyFocus: 'k',
      hotkeyClear: 'x',
      enableSearchTilde: false,
      enableFilterTilde: false,
      addBookmarkBtnPosition: 'bottom',
      bookmarkClickAction: 'open',
      historyClickAction: 'preview',
    });
    expect(storage.inspect().collapsedTabTop_poe1).toBeUndefined();
    expect(storage.inspect().collapsedTabTop_poe2).toBeUndefined();
  });

  it('migrates legacy versioned global preferences and legacy searchEntryClickAction without deleting recovery snapshots', async () => {
    const storage = createInMemoryPreferencesStorage({
      collapsedTabTop_poe2: 240,
      hotkeyFocus_poe1: 'f',
      addBookmarkBtnPosition_poe2: 'bottom',
      searchEntryClickAction_poe1: 'open',
      fontSizeScale_poe1: 1.35,
      fontSizeScale_poe2: 1.2,
      sidebarWidth_poe1: 340,
      sidebarWidth_poe2: 520,
    });

    const poe1Outcome = await createPreferencesModule('poe1', storage);
    if (!poe1Outcome.ok) throw new Error(poe1Outcome.error.message);

    expect(poe1Outcome.value.read()).toMatchObject({
      collapsedTabTop: 240,
      hotkeyFocus: 'f',
      addBookmarkBtnPosition: 'bottom',
      bookmarkClickAction: 'open',
      historyClickAction: 'open',
      fontSizeScale: 1.35,
      sidebarWidth: 340,
    });
    expect(storage.inspect()).toMatchObject({
      collapsedTabTop: 240,
      collapsedTabTop_poe2: 240,
      hotkeyFocus: 'f',
      hotkeyFocus_poe1: 'f',
      addBookmarkBtnPosition: 'bottom',
      addBookmarkBtnPosition_poe2: 'bottom',
      bookmarkClickAction: 'open',
      historyClickAction: 'open',
      searchEntryClickAction_poe1: 'open',
      fontSizeScale: 1.35,
      sidebarWidth: 340,
    });
  });

  it('migrates legacy global searchEntryClickAction into missing per-pane keys without overwriting explicit ones', async () => {
    const storage = createInMemoryPreferencesStorage({
      searchEntryClickAction: 'open',
      bookmarkClickAction: 'preview',
    });

    const outcome = await createPreferencesModule('poe1', storage);
    if (!outcome.ok) throw new Error(outcome.error.message);

    expect(outcome.value.read().bookmarkClickAction).toBe('preview');
    expect(outcome.value.read().historyClickAction).toBe('open');
  });
});
