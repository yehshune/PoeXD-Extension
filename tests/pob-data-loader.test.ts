import { describe, expect, it, vi } from 'vitest';
import {
  createPobDataLoader,
  schedulePobIdlePrewarm,
  type PobDataLoaderAdapter,
} from '@/components/sidebar/pob-build/pob-data-loader';
import type { PobBuild } from '@/utils/pob-build';
import { MAX_POB_BUILDS, type StoredPobBuild } from '@/utils/pob-build-store';
import type { ItemArtData } from '@/utils/pob-item-art';
import type { TradeNameCatalog } from '@/utils/pob-shopping-list';

const fakeCatalog: TradeNameCatalog = {
  toTradeName: (name) => name,
  findBaseType: () => undefined,
};

const fakeItemArt: ItemArtData = {
  source: { prefix: 'https://cdn.example/', suffix: '.png', sprites: [] },
  bases: {},
  uniques: {},
  foulborn: {},
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

function makeAdapter(overrides: Partial<PobDataLoaderAdapter> = {}) {
  const listStoredBuilds = vi.fn<PobDataLoaderAdapter['listStoredBuilds']>(async () => []);
  const loadCatalog = vi.fn<PobDataLoaderAdapter['loadCatalog']>(async () => fakeCatalog);
  const loadMatcher = vi.fn<PobDataLoaderAdapter['loadMatcher']>(async () => ({
    match: () => undefined,
  }));
  const loadModTranslator = vi.fn<PobDataLoaderAdapter['loadModTranslator']>(async () => undefined);
  const loadVisceraMods = vi.fn<PobDataLoaderAdapter['loadVisceraMods']>(async () => undefined);
  const loadItemArt = vi.fn<PobDataLoaderAdapter['loadItemArt']>(async () => fakeItemArt);
  const decodeBuild = vi.fn<PobDataLoaderAdapter['decodeBuild']>(async () => fakeBuild);
  return {
    listStoredBuilds,
    loadCatalog,
    loadMatcher,
    loadModTranslator,
    loadVisceraMods,
    loadItemArt,
    decodeBuild,
    adapter: {
      listStoredBuilds,
      loadCatalog,
      loadMatcher,
      loadModTranslator,
      loadVisceraMods,
      loadItemArt,
      getPageLocale: () => 'en',
      getDisplayLocale: () => 'en',
      decodeBuild,
      ...overrides,
    } satisfies PobDataLoaderAdapter,
  };
}

describe('createPobDataLoader', () => {
  it('skips loading reference data, item art, and decoding when no builds are stored', async () => {
    const mocks = makeAdapter({
      listStoredBuilds: vi.fn(async () => []),
      getDisplayLocale: () => 'zh-TW',
    });
    const loader = createPobDataLoader(mocks.adapter);

    await loader.prewarm('poe1');

    expect(mocks.loadCatalog).not.toHaveBeenCalled();
    expect(mocks.loadMatcher).not.toHaveBeenCalled();
    expect(mocks.loadModTranslator).not.toHaveBeenCalled();
    expect(mocks.loadItemArt).not.toHaveBeenCalled();
    expect(mocks.decodeBuild).not.toHaveBeenCalled();
  });

  it('prewarms reference data, item art, and stored builds, reusing cache across calls', async () => {
    const mocks = makeAdapter({
      listStoredBuilds: vi.fn(async () => [makeStored('b1', 'CODE_1')]),
    });
    const loader = createPobDataLoader(mocks.adapter);

    await loader.prewarm('poe1');
    const data = await loader.loadReferenceData('poe1');
    const art = await loader.loadItemArt('poe1');
    const decoded = await loader.decodeBuild('CODE_1');

    expect(data.catalog).toBe(fakeCatalog);
    expect(art).toBe(fakeItemArt);
    expect(decoded).toBe(fakeBuild);
    expect(mocks.loadCatalog).toHaveBeenCalledTimes(1);
    expect(mocks.loadMatcher).toHaveBeenCalledTimes(1);
    expect(mocks.loadItemArt).toHaveBeenCalledTimes(1);
    expect(mocks.decodeBuild).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent in-flight prewarm calls for the same version', async () => {
    let resolveList!: (builds: StoredPobBuild[]) => void;
    const listStoredBuilds = vi.fn(
      () =>
        new Promise<StoredPobBuild[]>((resolve) => {
          resolveList = resolve;
        }),
    );
    const mocks = makeAdapter({ listStoredBuilds });
    const loader = createPobDataLoader(mocks.adapter);

    const first = loader.prewarm('poe1');
    const second = loader.prewarm('poe1');
    expect(second).toBe(first);

    resolveList([makeStored('b1', 'CODE_1')]);
    await Promise.all([first, second]);

    expect(listStoredBuilds).toHaveBeenCalledTimes(1);
    expect(mocks.loadCatalog).toHaveBeenCalledTimes(1);
  });

  it('loads display-locale catalog only when displayLocale differs from pageLocale', async () => {
    const sameLocaleMocks = makeAdapter({
      getPageLocale: () => 'en',
      getDisplayLocale: () => 'en',
    });
    const sameLoader = createPobDataLoader(sameLocaleMocks.adapter);
    const sameData = await sameLoader.loadReferenceData('poe1');
    expect(sameData.displayNames).toBeUndefined();
    expect(sameLocaleMocks.loadCatalog).toHaveBeenCalledTimes(1);

    const diffLocaleMocks = makeAdapter({
      getPageLocale: () => 'en',
      getDisplayLocale: () => 'zh-TW',
    });
    const diffLoader = createPobDataLoader(diffLocaleMocks.adapter);
    const diffData = await diffLoader.loadReferenceData('poe1');
    expect(diffData.displayNames).toBe(fakeCatalog);
    expect(diffLocaleMocks.loadCatalog.mock.calls.map((call) => call[1])).toEqual(['en', 'zh-TW']);
  });

  it('degrades optional reference shards to undefined without blocking catalog', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const visceraError = new Error('viscera unavailable');
      const mocks = makeAdapter({
        getPageLocale: () => 'en',
        getDisplayLocale: () => 'zh-TW',
        loadCatalog: vi.fn(async (_version, locale) => {
          if (locale === 'zh-TW') throw new Error('display catalog unavailable');
          return fakeCatalog;
        }),
        loadMatcher: vi.fn(async () => {
          throw new Error('matcher unavailable');
        }),
        loadModTranslator: vi.fn(async () => {
          throw new Error('translator unavailable');
        }),
        loadVisceraMods: vi.fn(async () => {
          throw visceraError;
        }),
      });
      const loader = createPobDataLoader(mocks.adapter);

      const data = await loader.loadReferenceData('poe1');

      expect(data).toEqual({
        catalog: fakeCatalog,
        matcher: undefined,
        modTranslator: undefined,
        displayNames: undefined,
        visceraMods: undefined,
      });
      expect(warnSpy).toHaveBeenCalledWith('[PoeXD] viscera part data unavailable', visceraError);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('evicts failed reference data and item art loads so retries can succeed', async () => {
    let catalogAttempt = 0;
    const loadCatalog = vi.fn(async () => {
      catalogAttempt += 1;
      if (catalogAttempt === 1) throw new Error('temporary catalog failure');
      return fakeCatalog;
    });
    let artAttempt = 0;
    const loadItemArt = vi.fn(async () => {
      artAttempt += 1;
      if (artAttempt === 1) throw new Error('temporary art failure');
      return fakeItemArt;
    });
    const mocks = makeAdapter({ loadCatalog, loadItemArt });
    const loader = createPobDataLoader(mocks.adapter);

    await expect(loader.loadReferenceData('poe1')).rejects.toThrow('temporary catalog failure');
    const recovered = await loader.loadReferenceData('poe1');
    expect(recovered.catalog).toBe(fakeCatalog);
    expect(loadCatalog).toHaveBeenCalledTimes(2);

    await expect(loader.loadItemArt('poe1')).rejects.toThrow('temporary art failure');
    const recoveredArt = await loader.loadItemArt('poe1');
    expect(recoveredArt).toBe(fakeItemArt);
    expect(loadItemArt).toHaveBeenCalledTimes(2);
  });

  it('evicts failed decodes and drops oldest decoded build once cache reaches capacity', async () => {
    let failFirst = true;
    const decodeBuild = vi.fn(async (code: string) => {
      if (code === 'FLAKY' && failFirst) {
        failFirst = false;
        throw new Error('bad decode');
      }
      return { ...fakeBuild, level: Number(code.replace(/\D/g, '')) || 1 };
    });
    const mocks = makeAdapter({ decodeBuild });
    const loader = createPobDataLoader(mocks.adapter);

    await expect(loader.decodeBuild('FLAKY')).rejects.toThrow('bad decode');
    await expect(loader.decodeBuild('FLAKY')).resolves.toMatchObject({ level: 1 });

    const limit = MAX_POB_BUILDS * 2;
    for (let i = 0; i < limit; i += 1) {
      await loader.decodeBuild(`CODE_${i}`);
    }
    decodeBuild.mockClear();

    // Oldest entry (`FLAKY` was evicted after filling `limit` entries) requires re-decoding
    await loader.decodeBuild('FLAKY');
    expect(decodeBuild).toHaveBeenCalledTimes(1);
    // Most recent entry is still cached
    await loader.decodeBuild(`CODE_${limit - 1}`);
    expect(decodeBuild).toHaveBeenCalledTimes(1);
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
