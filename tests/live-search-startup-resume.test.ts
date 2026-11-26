// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { BookmarkCollectionView, BookmarkReadOutcome } from '@/utils/bookmark-coordinator';
import {
  createLiveSearchSourceController,
  type LiveSearchBookmarkSourcePort,
} from '@/entrypoints/content/logic/live-search-sources';
import type {
  AddSubscriptionOutcome,
  LiveSearchPrimaryController,
  LiveSearchPrimaryViewSnapshot,
  LiveSearchSubscription,
} from '@/utils/live-search-contract';
import {
  createLiveSearchResumeStore,
  type LiveSearchResumePlanData,
  type LiveSearchResumeStorage,
} from '@/utils/live-search-resume-store';
import { createInMemoryPreferencesStorage, createPreferencesModule } from '@/utils/preferences';
import { createTradeSearchCriteriaKeyResolver } from '@/utils/trade-search-criteria-key';
import { parseTradeSearchUrl } from '@/utils/trade-search-identity';

function createFakeBookmarkPort(
  initial: BookmarkCollectionView,
  options?: {
    readImpl?: () => Promise<BookmarkReadOutcome<BookmarkCollectionView>>;
  },
) {
  let collection = initial;
  const listeners = new Set<() => void>();
  const port: LiveSearchBookmarkSourcePort = {
    readCollection: options?.readImpl ?? (async () => ({ ok: true, value: collection })),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return {
    port,
    setCollection(next: BookmarkCollectionView) {
      collection = next;
      for (const listener of Array.from(listeners)) listener();
    },
    emitChange() {
      for (const listener of Array.from(listeners)) listener();
    },
  };
}

function createFakePrimaryController(
  version: 'poe1' | 'poe2' = 'poe1',
  options?: {
    addFromUrlImpl?: (url: string, opts?: { name?: string }) => Promise<AddSubscriptionOutcome>;
  },
) {
  let subscriptions: Readonly<LiveSearchSubscription>[] = [];
  let runtimeLeague: string | null = null;
  let seq = 0;
  const listeners = new Set<(snap: Readonly<LiveSearchPrimaryViewSnapshot>) => void>();

  const buildSnap = (): Readonly<LiveSearchPrimaryViewSnapshot> => ({
    gameVersion: version,
    runtimeLeague,
    cumulativeRenderedTotal: 0,
    subscriptions: [...subscriptions],
    rateLimit: {
      policy: null,
      rules: {},
      nextAllowedAtMs: 0,
    },
  });

  const notify = () => {
    const snap = buildSnap();
    for (const listener of Array.from(listeners)) listener(snap);
  };

  const addFromUrl = vi.fn(
    options?.addFromUrlImpl ??
      (async (url: string, opts?: { name?: string }): Promise<AddSubscriptionOutcome> => {
        const parsed = parseTradeSearchUrl(url);
        if (!parsed) return { success: false, error: 'Invalid URL' };
        const id = `sub_${++seq}`;
        runtimeLeague = parsed.league;
        subscriptions = [
          ...subscriptions,
          {
            id,
            url,
            name: opts?.name ?? parsed.searchId,
            gameVersion: parsed.gameVersion,
            league: parsed.league,
            searchId: parsed.searchId,
            status: 'active',
            createdAt: Date.now(),
          },
        ];
        notify();
        return { success: true };
      }),
  );

  const controller: LiveSearchPrimaryController = {
    read: buildSnap,
    subscribe(listener) {
      listeners.add(listener);
      listener(buildSnap());
      return () => {
        listeners.delete(listener);
      };
    },
    addFromUrl,
    retry: vi.fn(() => ({ success: true })),
    remove: vi.fn((id: string) => {
      subscriptions = subscriptions.filter((s) => s.id !== id);
      if (subscriptions.length === 0) runtimeLeague = null;
      notify();
    }),
    teardownAll: vi.fn(async () => {
      subscriptions = [];
      runtimeLeague = null;
      notify();
    }),
    setResultFilter: vi.fn(),
  };

  return { controller, addFromUrl };
}

function readKeysFromRecord(
  store: Record<string, unknown>,
  keys: string | readonly string[],
): Record<string, unknown> {
  const list = typeof keys === 'string' ? [keys] : keys;
  const out: Record<string, unknown> = {};
  for (const key of list) {
    if (key in store) out[key] = structuredClone(store[key]);
  }
  return out;
}

function removeKeysFromRecord(
  store: Record<string, unknown>,
  keys: string | readonly string[],
): void {
  const list = typeof keys === 'string' ? [keys] : keys;
  for (const key of list) delete store[key];
}

function createInMemoryResumeStorage(
  initialData?: Record<string, unknown>,
  overrides?: Partial<LiveSearchResumeStorage>,
) {
  const store: Record<string, unknown> = initialData ? { ...initialData } : {};
  const storage: LiveSearchResumeStorage = {
    async get(keys) {
      return readKeysFromRecord(store, keys);
    },
    async set(items) {
      for (const [k, v] of Object.entries(items)) {
        store[k] = structuredClone(v);
      }
    },
    async remove(keys) {
      removeKeysFromRecord(store, keys);
    },
    ...overrides,
  };
  return { storage, store };
}

function makeFolder(id = 'grp_1', name = 'Main') {
  return { id, name, order: 0, gameVersion: 'poe1' as const };
}

function makeBookmark(id: string, name: string, league: string, searchId: string) {
  return {
    id,
    name,
    url: `https://www.pathofexile.com/trade/search/${league}/${searchId}`,
    leaguePinned: true as const,
    groupId: 'grp_1',
    searchRecordId: `rec_${id}`,
    gameVersion: 'poe1' as const,
    order: 0,
  };
}

describe('Source Engine Startup Resume & Resume Plan Lifecycle', () => {
  it('exposes hasPersistedPlan across all leagues and clearResumePlan clears the entire version', async () => {
    const plan: LiveSearchResumePlanData = {
      version: 2,
      identities: [
        { gameVersion: 'poe1', league: 'Standard', searchId: 'H4sIstd1' },
        { gameVersion: 'poe1', league: 'Hardcore', searchId: 'H4sIhc1' },
      ],
    };
    const { storage, store } = createInMemoryResumeStorage({
      liveSearchResumePlan_poe1: plan,
    });
    const resumeStore = createLiveSearchResumeStore('poe1', storage);
    const prefOutcome = await createPreferencesModule(
      'poe1',
      createInMemoryPreferencesStorage({ liveSearchResumeMode_poe1: 'prompt' }),
    );
    if (!prefOutcome.ok) throw new Error(prefOutcome.error.message);

    const { port } = createFakeBookmarkPort({
      groups: [makeFolder()],
      bookmarks: [
        makeBookmark('bm_std', 'Std Bow', 'Standard', 'H4sIstd1'),
        makeBookmark('bm_hc', 'HC Belt', 'Hardcore', 'H4sIhc1'),
      ],
    });
    const { controller } = createFakePrimaryController('poe1');

    const sourceCtrl = createLiveSearchSourceController(port, controller, {
      resumeStore,
      preferences: prefOutcome.value,
      initialLeague: 'Standard',
    });

    await vi.waitFor(() => {
      const snap = sourceCtrl.read();
      expect(snap.loading).toBe(false);
      expect(snap.hasPersistedPlan).toBe(true);
      expect(snap.previousConnections).toHaveLength(1);
    });

    // Clearing current league keeps Hardcore entry, so hasPersistedPlan stays true
    const clearedCurrent = await sourceCtrl.clearPreviousConnections!();
    expect(clearedCurrent).toBe(true);
    await vi.waitFor(() => {
      const snap = sourceCtrl.read();
      expect(snap.previousConnections).toHaveLength(0);
      expect(snap.hasPersistedPlan).toBe(true);
    });

    // Clearing the entire version removes all leagues and sets hasPersistedPlan to false
    const clearedAll = await sourceCtrl.clearResumePlan!();
    expect(clearedAll).toBe(true);
    expect(store.liveSearchResumePlan_poe1).toBeUndefined();
    expect(sourceCtrl.read().hasPersistedPlan).toBe(false);

    sourceCtrl.dispose();
  });

  it('clearResumePlan returns false and does not fake empty state when storage removal fails', async () => {
    const plan: LiveSearchResumePlanData = {
      version: 2,
      identities: [{ gameVersion: 'poe1', league: 'Standard', searchId: 'H4sIstd1' }],
    };
    const { storage } = createInMemoryResumeStorage(
      { liveSearchResumePlan_poe1: plan },
      {
        async remove() {
          throw new Error('storage remove failed');
        },
      },
    );
    const resumeStore = createLiveSearchResumeStore('poe1', storage);
    const prefOutcome = await createPreferencesModule(
      'poe1',
      createInMemoryPreferencesStorage({ liveSearchResumeMode_poe1: 'prompt' }),
    );
    if (!prefOutcome.ok) throw new Error(prefOutcome.error.message);

    const { port } = createFakeBookmarkPort({
      groups: [makeFolder()],
      bookmarks: [makeBookmark('bm_std', 'Std Bow', 'Standard', 'H4sIstd1')],
    });
    const { controller } = createFakePrimaryController('poe1');

    const sourceCtrl = createLiveSearchSourceController(port, controller, {
      resumeStore,
      preferences: prefOutcome.value,
      initialLeague: 'Standard',
    });

    await vi.waitFor(() => {
      expect(sourceCtrl.read().hasPersistedPlan).toBe(true);
      expect(sourceCtrl.read().previousConnections).toHaveLength(1);
    });

    const cleared = await sourceCtrl.clearResumePlan!();
    expect(cleared).toBe(false);
    expect(sourceCtrl.read().hasPersistedPlan).toBe(true);
    expect(sourceCtrl.read().previousConnections).toHaveLength(1);

    sourceCtrl.dispose();
  });

  it('startup off mode clears only current selectedLeague once and does not re-clear after switchLeague', async () => {
    const plan: LiveSearchResumePlanData = {
      version: 2,
      identities: [
        { gameVersion: 'poe1', league: 'Standard', searchId: 'H4sIstd1' },
        { gameVersion: 'poe1', league: 'Hardcore', searchId: 'H4sIhc1' },
      ],
    };
    const { storage, store } = createInMemoryResumeStorage({
      liveSearchResumePlan_poe1: plan,
    });
    const resumeStore = createLiveSearchResumeStore('poe1', storage);
    const prefOutcome = await createPreferencesModule(
      'poe1',
      createInMemoryPreferencesStorage({ liveSearchResumeMode_poe1: 'off' }),
    );
    if (!prefOutcome.ok) throw new Error(prefOutcome.error.message);

    const { port } = createFakeBookmarkPort({
      groups: [makeFolder()],
      bookmarks: [
        makeBookmark('bm_std', 'Std Bow', 'Standard', 'H4sIstd1'),
        makeBookmark('bm_hc', 'HC Belt', 'Hardcore', 'H4sIhc1'),
      ],
    });
    const { controller, addFromUrl } = createFakePrimaryController('poe1');

    const sourceCtrl = createLiveSearchSourceController(port, controller, {
      resumeStore,
      preferences: prefOutcome.value,
      initialLeague: 'Standard',
    });

    await vi.waitFor(() => {
      const snap = sourceCtrl.read();
      expect(snap.loading).toBe(false);
      expect(snap.previousConnections).toHaveLength(0);
      expect(snap.hasPersistedPlan).toBe(true);
    });

    // Only Standard was cleared; Hardcore remains persisted
    const persisted = store.liveSearchResumePlan_poe1 as LiveSearchResumePlanData;
    expect(persisted.identities.map((i) => i.league.toLowerCase())).toEqual(['hardcore']);
    expect(addFromUrl).not.toHaveBeenCalled();

    // Switching to Hardcore does NOT re-run startup off clearing
    await sourceCtrl.switchLeague('Hardcore');
    await vi.waitFor(() => {
      const snap = sourceCtrl.read();
      expect(snap.selectedLeague).toBe('Hardcore');
      expect(snap.previousConnections).toHaveLength(1);
    });
    expect(
      (store.liveSearchResumePlan_poe1 as LiveSearchResumePlanData).identities.map((i) =>
        i.league.toLowerCase(),
      ),
    ).toEqual(['hardcore']);

    sourceCtrl.dispose();
  });

  it('startup prompt mode keeps previousConnections without auto-enabling and prunes deleted bookmark entries once after league resolves', async () => {
    const plan: LiveSearchResumePlanData = {
      version: 2,
      identities: [
        { gameVersion: 'poe1', league: 'Standard', searchId: 'H4sIalive1' },
        { gameVersion: 'poe1', league: 'Standard', searchId: 'H4sIdeleted1' },
        {
          gameVersion: 'poe1',
          league: 'Standard',
          searchId: 'H4sItemp1',
          name: 'Temp Search',
          url: 'https://www.pathofexile.com/trade/search/Standard/H4sItemp1',
        },
        { gameVersion: 'poe1', league: 'Hardcore', searchId: 'H4sIhcOther' },
      ],
    };
    const { storage, store } = createInMemoryResumeStorage({
      liveSearchResumePlan_poe1: plan,
    });
    const resumeStore = createLiveSearchResumeStore('poe1', storage);
    const pruneSpy = vi.spyOn(resumeStore, 'pruneToAuthoritative');
    const prefOutcome = await createPreferencesModule(
      'poe1',
      createInMemoryPreferencesStorage({ liveSearchResumeMode_poe1: 'prompt' }),
    );
    if (!prefOutcome.ok) throw new Error(prefOutcome.error.message);

    const { port } = createFakeBookmarkPort({
      groups: [makeFolder()],
      bookmarks: [makeBookmark('bm_alive', 'Alive Bow', 'Standard', 'H4sIalive1')],
    });
    const { controller, addFromUrl } = createFakePrimaryController('poe1');

    // No initialLeague passed: league resolves asynchronously from Resume Store / Bookmarks
    const sourceCtrl = createLiveSearchSourceController(port, controller, {
      resumeStore,
      preferences: prefOutcome.value,
    });

    await vi.waitFor(() => {
      const snap = sourceCtrl.read();
      expect(snap.loading).toBe(false);
      expect(snap.leagueResolved).toBe(true);
      expect(pruneSpy).toHaveBeenCalledTimes(1);
    });

    expect(addFromUrl).not.toHaveBeenCalled();
    expect(sourceCtrl.read().autoRestoreOutcome).toBeNull();

    // Deleted bookmark entry was pruned from Standard; live bookmark, Temporary Search, and Hardcore remain
    const persisted = store.liveSearchResumePlan_poe1 as LiveSearchResumePlanData;
    expect(persisted.identities.map((i) => i.searchId)).toEqual([
      'H4sIalive1',
      'H4sItemp1',
      'H4sIhcOther',
    ]);
    expect(sourceCtrl.read().previousConnections?.map((i) => i.name)).toEqual([
      'Alive Bow',
      'Temp Search',
    ]);

    sourceCtrl.dispose();
  });

  it('startup auto mode enables actionable previousConnections once, projects autoRestoreOutcome, and does not re-run after switchLeague', async () => {
    const plan: LiveSearchResumePlanData = {
      version: 2,
      identities: [
        { gameVersion: 'poe1', league: 'Standard', searchId: 'H4sIstd1' },
        {
          gameVersion: 'poe1',
          league: 'Standard',
          searchId: 'H4sItemp1',
          name: 'Temp Wand',
          url: 'https://www.pathofexile.com/trade/search/Standard/H4sItemp1',
        },
        { gameVersion: 'poe1', league: 'Hardcore', searchId: 'H4sIhc1' },
      ],
    };
    const { storage } = createInMemoryResumeStorage({
      liveSearchResumePlan_poe1: plan,
    });
    const resumeStore = createLiveSearchResumeStore('poe1', storage);
    const prefOutcome = await createPreferencesModule(
      'poe1',
      createInMemoryPreferencesStorage({ liveSearchResumeMode_poe1: 'auto' }),
    );
    if (!prefOutcome.ok) throw new Error(prefOutcome.error.message);

    const { port } = createFakeBookmarkPort({
      groups: [makeFolder()],
      bookmarks: [
        makeBookmark('bm_std', 'Std Bow', 'Standard', 'H4sIstd1'),
        makeBookmark('bm_hc', 'HC Belt', 'Hardcore', 'H4sIhc1'),
      ],
    });
    const { controller, addFromUrl } = createFakePrimaryController('poe1');

    const sourceCtrl = createLiveSearchSourceController(port, controller, {
      resumeStore,
      preferences: prefOutcome.value,
      initialLeague: 'Standard',
    });

    await vi.waitFor(() => {
      const outcome = sourceCtrl.read().autoRestoreOutcome;
      expect(outcome).not.toBeNull();
      expect(outcome?.succeeded).toBe(2);
      expect(outcome?.failed).toBe(0);
    });

    expect(addFromUrl).toHaveBeenCalledTimes(2);
    expect(sourceCtrl.read().sessionConnections).toHaveLength(2);
    expect(sourceCtrl.read().previousConnections).toHaveLength(0);

    // Switching to Hardcore must NOT auto-restore Hardcore connections
    await sourceCtrl.switchLeague('Hardcore');
    await vi.waitFor(() => {
      expect(sourceCtrl.read().selectedLeague).toBe('Hardcore');
      expect(sourceCtrl.read().previousConnections).toHaveLength(1);
    });
    expect(addFromUrl).toHaveBeenCalledTimes(2);

    sourceCtrl.dispose();
  });

  it('startup auto mode stays silent with autoRestoreOutcome null when zero items are actionable', async () => {
    const plan: LiveSearchResumePlanData = {
      version: 2,
      identities: [{ gameVersion: 'poe1', league: 'Hardcore', searchId: 'H4sIhc1' }],
    };
    const { storage } = createInMemoryResumeStorage({
      liveSearchResumePlan_poe1: plan,
    });
    const resumeStore = createLiveSearchResumeStore('poe1', storage);
    const prefOutcome = await createPreferencesModule(
      'poe1',
      createInMemoryPreferencesStorage({ liveSearchResumeMode_poe1: 'auto' }),
    );
    if (!prefOutcome.ok) throw new Error(prefOutcome.error.message);

    const { port } = createFakeBookmarkPort({
      groups: [makeFolder()],
      bookmarks: [makeBookmark('bm_hc', 'HC Belt', 'Hardcore', 'H4sIhc1')],
    });
    const { controller, addFromUrl } = createFakePrimaryController('poe1');

    const sourceCtrl = createLiveSearchSourceController(port, controller, {
      resumeStore,
      preferences: prefOutcome.value,
      initialLeague: 'Standard',
    });

    await vi.waitFor(() => {
      expect(sourceCtrl.read().loading).toBe(false);
      expect(sourceCtrl.read().hasPersistedPlan).toBe(true);
    });
    await new Promise((r) => setTimeout(r, 40));

    expect(addFromUrl).not.toHaveBeenCalled();
    expect(sourceCtrl.read().autoRestoreOutcome).toBeNull();

    sourceCtrl.dispose();
  });

  it('startup auto mode skips connections already active in sessionConnections', async () => {
    const plan: LiveSearchResumePlanData = {
      version: 2,
      identities: [
        { gameVersion: 'poe1', league: 'Standard', searchId: 'H4sIstd1' },
        { gameVersion: 'poe1', league: 'Standard', searchId: 'H4sIstd2' },
      ],
    };
    const { storage } = createInMemoryResumeStorage({
      liveSearchResumePlan_poe1: plan,
    });
    const resumeStore = createLiveSearchResumeStore('poe1', storage);
    const prefOutcome = await createPreferencesModule(
      'poe1',
      createInMemoryPreferencesStorage({ liveSearchResumeMode_poe1: 'auto' }),
    );
    if (!prefOutcome.ok) throw new Error(prefOutcome.error.message);

    const { port } = createFakeBookmarkPort({
      groups: [makeFolder()],
      bookmarks: [
        makeBookmark('bm_std1', 'Std Bow', 'Standard', 'H4sIstd1'),
        makeBookmark('bm_std2', 'Std Ring', 'Standard', 'H4sIstd2'),
      ],
    });
    const { controller, addFromUrl } = createFakePrimaryController('poe1');
    // Pre-activate H4sIstd1 before Source Engine initializes (e.g. already active on runtime)
    await controller.addFromUrl('https://www.pathofexile.com/trade/search/Standard/H4sIstd1', {
      name: 'Std Bow',
    });
    addFromUrl.mockClear();

    const sourceCtrl = createLiveSearchSourceController(port, controller, {
      resumeStore,
      preferences: prefOutcome.value,
      initialLeague: 'Standard',
    });

    await vi.waitFor(() => {
      const outcome = sourceCtrl.read().autoRestoreOutcome;
      expect(outcome).not.toBeNull();
      expect(outcome?.requested).toBe(1);
      expect(outcome?.succeeded).toBe(1);
    });

    expect(addFromUrl).toHaveBeenCalledTimes(1);
    expect(addFromUrl.mock.calls[0][0]).toContain('H4sIstd2');

    sourceCtrl.dispose();
  });

  it('startup auto mode records failure outcome when enabling throws unexpectedly', async () => {
    const plan: LiveSearchResumePlanData = {
      version: 2,
      identities: [{ gameVersion: 'poe1', league: 'Standard', searchId: 'H4sIstd1' }],
    };
    const { storage } = createInMemoryResumeStorage({
      liveSearchResumePlan_poe1: plan,
    });
    const resumeStore = createLiveSearchResumeStore('poe1', storage);
    const prefOutcome = await createPreferencesModule(
      'poe1',
      createInMemoryPreferencesStorage({ liveSearchResumeMode_poe1: 'auto' }),
    );
    if (!prefOutcome.ok) throw new Error(prefOutcome.error.message);

    const { port } = createFakeBookmarkPort({
      groups: [makeFolder()],
      bookmarks: [makeBookmark('bm_std', 'Std Bow', 'Standard', 'H4sIstd1')],
    });
    const { controller } = createFakePrimaryController('poe1', {
      addFromUrlImpl: async () => {
        throw new Error('socket boom');
      },
    });

    const sourceCtrl = createLiveSearchSourceController(port, controller, {
      resumeStore,
      preferences: prefOutcome.value,
      initialLeague: 'Standard',
    });

    await vi.waitFor(() => {
      const outcome = sourceCtrl.read().autoRestoreOutcome;
      expect(outcome).not.toBeNull();
      expect(outcome?.success).toBe(false);
      expect(outcome?.failed).toBe(1);
    });

    sourceCtrl.dispose();
  });

  it('does not prune, clear, or auto-restore when bookmark read fails, and recovers once bookmarks succeed', async () => {
    const plan: LiveSearchResumePlanData = {
      version: 2,
      identities: [{ gameVersion: 'poe1', league: 'Standard', searchId: 'H4sIstd1' }],
    };
    const { storage, store } = createInMemoryResumeStorage({
      liveSearchResumePlan_poe1: plan,
    });
    const resumeStore = createLiveSearchResumeStore('poe1', storage);
    const pruneSpy = vi.spyOn(resumeStore, 'pruneToAuthoritative');
    const prefOutcome = await createPreferencesModule(
      'poe1',
      createInMemoryPreferencesStorage({ liveSearchResumeMode_poe1: 'auto' }),
    );
    if (!prefOutcome.ok) throw new Error(prefOutcome.error.message);

    let shouldFail = true;
    const { port, emitChange } = createFakeBookmarkPort(
      { groups: [], bookmarks: [] },
      {
        readImpl: async () =>
          shouldFail
            ? {
                ok: false,
                error: { code: 'storage-failure' as const, message: 'bookmark read failed' },
              }
            : {
                ok: true,
                value: {
                  groups: [makeFolder()],
                  bookmarks: [makeBookmark('bm_std', 'Std Bow', 'Standard', 'H4sIstd1')],
                },
              },
      },
    );
    const { controller, addFromUrl } = createFakePrimaryController('poe1');

    const sourceCtrl = createLiveSearchSourceController(port, controller, {
      resumeStore,
      preferences: prefOutcome.value,
      initialLeague: 'Standard',
    });

    await vi.waitFor(() => {
      expect(sourceCtrl.read().loading).toBe(false);
      expect(sourceCtrl.read().error).toBe('bookmark read failed');
    });
    await new Promise((r) => setTimeout(r, 40));

    // Must not prune, destroy persisted plan, or auto-restore while bookmark read is failed
    expect(pruneSpy).not.toHaveBeenCalled();
    expect(addFromUrl).not.toHaveBeenCalled();
    expect((store.liveSearchResumePlan_poe1 as LiveSearchResumePlanData).identities).toHaveLength(
      1,
    );

    // Once bookmark read recovers, startup decision executes cleanly
    shouldFail = false;
    emitChange();

    await vi.waitFor(() => {
      const outcome = sourceCtrl.read().autoRestoreOutcome;
      expect(outcome).not.toBeNull();
      expect(outcome?.succeeded).toBe(1);
    });
    expect(pruneSpy).toHaveBeenCalledTimes(1);
    expect(addFromUrl).toHaveBeenCalledTimes(1);

    sourceCtrl.dispose();
  });

  it('does not prune, clear, or lock out startup when resumeStore.read fails initially, and recovers on retry', async () => {
    const plan: LiveSearchResumePlanData = {
      version: 2,
      identities: [{ gameVersion: 'poe1', league: 'Standard', searchId: 'H4sIstd1' }],
    };
    let failGet = true;
    const { storage } = createInMemoryResumeStorage(
      { liveSearchResumePlan_poe1: plan },
      {
        async get(keys) {
          if (failGet) throw new Error('storage unavailable');
          return readKeysFromRecord({ liveSearchResumePlan_poe1: plan }, keys);
        },
      },
    );
    const resumeStore = createLiveSearchResumeStore('poe1', storage);
    const pruneSpy = vi.spyOn(resumeStore, 'pruneToAuthoritative');
    const prefOutcome = await createPreferencesModule(
      'poe1',
      createInMemoryPreferencesStorage({ liveSearchResumeMode_poe1: 'auto' }),
    );
    if (!prefOutcome.ok) throw new Error(prefOutcome.error.message);

    const { port, emitChange } = createFakeBookmarkPort({
      groups: [makeFolder()],
      bookmarks: [makeBookmark('bm_std', 'Std Bow', 'Standard', 'H4sIstd1')],
    });
    const { controller, addFromUrl } = createFakePrimaryController('poe1');

    const sourceCtrl = createLiveSearchSourceController(port, controller, {
      resumeStore,
      preferences: prefOutcome.value,
      initialLeague: 'Standard',
    });

    await vi.waitFor(() => expect(sourceCtrl.read().loading).toBe(false));
    await new Promise((r) => setTimeout(r, 40));

    expect(pruneSpy).not.toHaveBeenCalled();
    expect(addFromUrl).not.toHaveBeenCalled();
    expect(sourceCtrl.read().autoRestoreOutcome).toBeNull();

    // Storage recovers and a bookmark reload triggers re-evaluation
    failGet = false;
    emitChange();

    await vi.waitFor(() => {
      const outcome = sourceCtrl.read().autoRestoreOutcome;
      expect(outcome).not.toBeNull();
      expect(outcome?.succeeded).toBe(1);
    });
    expect(pruneSpy).toHaveBeenCalledTimes(1);

    sourceCtrl.dispose();
  });

  it('re-evaluates against latest authoritative bookmarks when collection changes during delayed resumeStore.read', async () => {
    const plan: LiveSearchResumePlanData = {
      version: 2,
      identities: [
        { gameVersion: 'poe1', league: 'Standard', searchId: 'H4sIold1' },
        { gameVersion: 'poe1', league: 'Standard', searchId: 'H4sInew2' },
      ],
    };
    let releaseFirstRead!: () => void;
    let firstReadBlocked = true;
    const firstReadGate = new Promise<void>((resolve) => {
      releaseFirstRead = resolve;
    });
    const { storage, store: backingStore } = createInMemoryResumeStorage(
      { liveSearchResumePlan_poe1: plan },
      {
        async get(keys) {
          if (firstReadBlocked) {
            firstReadBlocked = false;
            await firstReadGate;
          }
          return readKeysFromRecord(backingStore, keys);
        },
      },
    );
    const resumeStore = createLiveSearchResumeStore('poe1', storage);
    const prefOutcome = await createPreferencesModule(
      'poe1',
      createInMemoryPreferencesStorage({ liveSearchResumeMode_poe1: 'auto' }),
    );
    if (!prefOutcome.ok) throw new Error(prefOutcome.error.message);

    // Initially only H4sIold1 exists in bookmarks
    const { port, setCollection } = createFakeBookmarkPort({
      groups: [makeFolder()],
      bookmarks: [makeBookmark('bm_old', 'Old Bow', 'Standard', 'H4sIold1')],
    });
    const { controller, addFromUrl } = createFakePrimaryController('poe1');

    const sourceCtrl = createLiveSearchSourceController(port, controller, {
      resumeStore,
      preferences: prefOutcome.value,
      initialLeague: 'Standard',
    });

    await vi.waitFor(() => expect(sourceCtrl.read().loading).toBe(false));

    // While resumeStore.read() is still in flight, bookmarks update to replace H4sIold1 with H4sInew2
    setCollection({
      groups: [makeFolder()],
      bookmarks: [makeBookmark('bm_new', 'New Ring', 'Standard', 'H4sInew2')],
    });
    await new Promise((r) => setTimeout(r, 20));

    releaseFirstRead();

    await vi.waitFor(() => {
      const outcome = sourceCtrl.read().autoRestoreOutcome;
      expect(outcome).not.toBeNull();
      expect(outcome?.succeeded).toBe(1);
    });

    // Only the latest authoritative bookmark (H4sInew2) was restored, and H4sIold1 was pruned
    expect(addFromUrl).toHaveBeenCalledTimes(1);
    expect(addFromUrl.mock.calls[0][0]).toContain('H4sInew2');
    expect(
      (backingStore.liveSearchResumePlan_poe1 as LiveSearchResumePlanData).identities.map(
        (i) => i.searchId,
      ),
    ).toEqual(['H4sInew2']);

    sourceCtrl.dispose();
  });

  it('startup auto mode skips different-searchId criteria-equivalent entries covered by enqueueIncomingConnections and stays silent', async () => {
    const plan: LiveSearchResumePlanData = {
      version: 2,
      identities: [{ gameVersion: 'poe1', league: 'Standard', searchId: 'H4sIprevDup' }],
    };
    const { storage } = createInMemoryResumeStorage({
      liveSearchResumePlan_poe1: plan,
    });
    const resumeStore = createLiveSearchResumeStore('poe1', storage);
    const prefOutcome = await createPreferencesModule(
      'poe1',
      createInMemoryPreferencesStorage({ liveSearchResumeMode_poe1: 'auto' }),
    );
    if (!prefOutcome.ok) throw new Error(prefOutcome.error.message);

    // Hold initial bookmark load briefly so enqueueIncomingConnections lands before startup auto runs
    let releaseBookmarks!: () => void;
    const bookmarkGate = new Promise<void>((resolve) => {
      releaseBookmarks = resolve;
    });
    const { port } = createFakeBookmarkPort(
      { groups: [], bookmarks: [] },
      {
        readImpl: async () => {
          await bookmarkGate;
          return {
            ok: true,
            value: {
              groups: [makeFolder()],
              bookmarks: [makeBookmark('bm_prev', 'Prev Bow', 'Standard', 'H4sIprevDup')],
            },
          };
        },
      },
    );
    const { controller, addFromUrl } = createFakePrimaryController('poe1');

    // Both search IDs decode asynchronously to the exact same criteria
    const criteriaKeyResolver = createTradeSearchCriteriaKeyResolver(async () => ({
      query: { type: 'Spine Bow' },
    }));

    const sourceCtrl = createLiveSearchSourceController(port, controller, {
      resumeStore,
      preferences: prefOutcome.value,
      initialLeague: 'Standard',
      criteriaKeyResolver,
    });

    // Enqueue a criteria-equivalent search while bookmarks are loading
    const enqueuePromise = sourceCtrl.enqueueIncomingConnections!([
      {
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIincomingDup',
        name: 'Incoming Bow',
      },
    ]);
    releaseBookmarks();
    const enqueueOutcome = await enqueuePromise;
    expect(enqueueOutcome.success).toBe(true);
    expect(enqueueOutcome.addedCount).toBe(1);

    await vi.waitFor(() => {
      expect(sourceCtrl.read().loading).toBe(false);
    });
    await new Promise((r) => setTimeout(r, 60));

    // Only the incoming search was enabled; startup auto skipped the criteria-equivalent previous entry silently
    expect(addFromUrl).toHaveBeenCalledTimes(1);
    expect(addFromUrl.mock.calls[0][0]).toContain('H4sIincomingDup');
    expect(sourceCtrl.read().autoRestoreOutcome).toBeNull();

    sourceCtrl.dispose();
  });
});
