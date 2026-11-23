import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  decodePobBuildCached,
  loadPobReferenceData,
  prewarmPobData,
  resetPobPrewarmCacheForTests,
  schedulePobIdlePrewarm,
} from '@/components/sidebar/pob-build/pob-prewarm';
import type { PobBuild } from '@/utils/pob-build';
import type { PobBuildStore, StoredPobBuild } from '@/utils/pob-build-store';
import type { TradeNameCatalog } from '@/utils/pob-shopping-list';

const fakeCatalog: TradeNameCatalog = {
  toTradeName: (name) => name,
  findBaseType: () => undefined,
};

const fakeBuild: PobBuild = {
  gameVersion: 'poe1',
  className: 'Duelist',
  ascendancy: 'Slayer',
  level: 100,
  activeItemSetId: '1',
  activeSkillSetId: '1',
  activeTreeSpecId: '1',
  itemSets: [{ id: '1', title: 'Endgame', items: [] }],
  skillSets: [{ id: '1', title: 'Endgame', gems: [] }],
  treeSpecs: [{ id: '1', title: 'Endgame', jewels: [] }],
};

const makeStored = (id: string, code: string): StoredPobBuild => ({
  id,
  name: `Build ${id}`,
  code,
  importedAt: 1,
  collapsed: false,
  hideDone: false,
  done: [],
  removed: [],
  searchSelections: {},
  searchDefaults: {},
  searchOverrides: {},
});

const makeStore = (builds: StoredPobBuild[]): PobBuildStore => ({
  list: vi.fn(async () => builds),
  add: vi.fn(async () => builds[0]),
  update: vi.fn(async () => undefined),
  mutate: vi.fn(async () => undefined),
  subscribe: vi.fn(() => () => undefined),
  replaceCode: vi.fn(async () => true),
  remove: vi.fn(async () => undefined),
});

describe('pob-prewarm', () => {
  afterEach(() => {
    resetPobPrewarmCacheForTests();
  });

  it('skips loading reference data and decoding when no builds are stored', async () => {
    const loadCatalog = vi.fn(async () => fakeCatalog);
    const loadMatcher = vi.fn(async () => ({ match: () => undefined }));
    const loadModTranslator = vi.fn(async () => undefined);
    const decodeBuild = vi.fn(async () => fakeBuild);

    await prewarmPobData('poe1', {
      store: makeStore([]),
      loadCatalog,
      loadMatcher,
      loadModTranslator,
      loadVisceraMods: vi.fn(async () => undefined),
      getPageLocale: () => 'en',
      getDisplayLocale: () => 'zh-TW',
      decodeBuild,
    });

    expect(loadCatalog).not.toHaveBeenCalled();
    expect(loadMatcher).not.toHaveBeenCalled();
    expect(loadModTranslator).not.toHaveBeenCalled();
    expect(decodeBuild).not.toHaveBeenCalled();
  });

  it('prewarms reference data and decodes stored builds, reusing cache across calls', async () => {
    const loadCatalog = vi.fn(async () => fakeCatalog);
    const loadMatcher = vi.fn(async () => ({ match: () => undefined }));
    const loadModTranslator = vi.fn(async () => undefined);
    const loadVisceraMods = vi.fn(async () => undefined);
    const decodeBuild = vi.fn(async () => fakeBuild);

    const deps = {
      store: makeStore([makeStored('b1', 'CODE_1')]),
      loadCatalog,
      loadMatcher,
      loadModTranslator,
      loadVisceraMods,
      getPageLocale: () => 'en',
      getDisplayLocale: () => 'en',
      decodeBuild,
    };

    await prewarmPobData('poe1', deps);
    // Second call hits both reference data cache and decoded build cache
    const data = await loadPobReferenceData('poe1', deps);
    const decoded = await decodePobBuildCached('CODE_1', decodeBuild);

    expect(data.catalog).toBe(fakeCatalog);
    expect(decoded).toBe(fakeBuild);
    expect(loadCatalog).toHaveBeenCalledTimes(1);
    expect(loadMatcher).toHaveBeenCalledTimes(1);
    expect(decodeBuild).toHaveBeenCalledTimes(1);
  });

  it('evicts failed reference data load so a retry can succeed', async () => {
    let attempt = 0;
    const loadCatalog = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('temporary failure');
      return fakeCatalog;
    });
    const deps = {
      loadCatalog,
      loadMatcher: vi.fn(async () => ({ match: () => undefined })),
      loadModTranslator: vi.fn(async () => undefined),
      loadVisceraMods: vi.fn(async () => undefined),
      getPageLocale: () => 'en',
      getDisplayLocale: () => 'en',
    };

    await expect(loadPobReferenceData('poe1', deps)).rejects.toThrow('temporary failure');
    const recovered = await loadPobReferenceData('poe1', deps);
    expect(recovered.catalog).toBe(fakeCatalog);
    expect(loadCatalog).toHaveBeenCalledTimes(2);
  });
});

describe('schedulePobIdlePrewarm', () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('等官方頁面首批結果處理完，才排入閒置預熱', async () => {
    let markLoaded!: () => void;
    const pageLoaded = new Promise<void>((resolve) => {
      markLoaded = resolve;
    });
    const idleCallbacks: (() => void)[] = [];
    const run = vi.fn();
    schedulePobIdlePrewarm(run, {
      waitForInitialPageLoad: () => pageLoaded,
      requestIdle: (callback) => {
        idleCallbacks.push(callback);
        return () => undefined;
      },
    });
    await flush();
    expect(idleCallbacks).toHaveLength(0);

    markLoaded();
    await flush();
    expect(idleCallbacks).toHaveLength(1);
    idleCallbacks[0]();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('等待期間取消就不再排程；排程後取消會取消閒置回呼', async () => {
    let markLoaded!: () => void;
    const pageLoaded = new Promise<void>((resolve) => {
      markLoaded = resolve;
    });
    const requestIdle = vi.fn(() => () => undefined);
    const cancel = schedulePobIdlePrewarm(vi.fn(), {
      waitForInitialPageLoad: () => pageLoaded,
      requestIdle,
    });
    cancel();
    markLoaded();
    await flush();
    expect(requestIdle).not.toHaveBeenCalled();

    const cancelIdle = vi.fn();
    const cancelLater = schedulePobIdlePrewarm(vi.fn(), {
      waitForInitialPageLoad: async () => undefined,
      requestIdle: () => cancelIdle,
    });
    await flush();
    cancelLater();
    expect(cancelIdle).toHaveBeenCalledTimes(1);
  });
});
