// @vitest-environment happy-dom
import { deflateSync } from 'node:zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPobDataLoader,
  type PobDataLoaderAdapter,
} from '@/components/sidebar/pob-build/pob-data-loader';
import {
  usePobBuild,
  type UsePobBuild,
  type UsePobBuildDeps,
} from '@/components/sidebar/pob-build/usePobBuild';
import type { BuildView } from '@/components/sidebar/pob-build/pob-build-view';
import {
  createPobBuildStore,
  pobBuildsStorageKey,
  type PobBuildStorage,
  type StoredPobBuild,
} from '@/utils/pob-build-store';
import { parseItemArt } from '@/utils/pob-item-art';
import { createModLineTranslator } from '@/utils/pob-mod-translator';
import { createTradeNameCatalog } from '@/utils/pob-shopping-list';
import { createStatMatcher } from '@/utils/pob-stat-matcher';
import { parseTradeSearchUrl } from '@/utils/trade-search-identity';
import { decodeGzipBase64UrlToQuery, encodeQueryToGzipBase64Url } from '@/utils/trade-url-codec';

// 兩個階段：Endgame（匯出當下選用）與 Leveling；護身符兩個階段都有
const buildXml = (
  options: { root?: string; ascendancy?: string } = {},
) => `<?xml version="1.0" encoding="UTF-8"?>
<${options.root ?? 'PathOfBuilding'}>
	<Build ascendClassName="${options.ascendancy ?? 'Chieftain'}" className="Marauder" level="97" targetVersion="3_0"/>
	<Items activeItemSet="1">
		<Item id="1">
			Rarity: UNIQUE
Rise of the Phoenix
Mosaic Kite Shield
		</Item>
		<Item id="2">
			Rarity: UNIQUE
Not On Trade
Mystery Base
		</Item>
		<Item id="3">
			Rarity: UNIQUE
Xoph's Heart
Amber Amulet
		</Item>
		<Item id="4">
			Rarity: RARE
Starter Plate
Plate Vest
Implicits: 0
+100 to maximum Life
{crafted}+20 to maximum Life
		</Item>
		<ItemSet id="1" title="Endgame">
			<Slot itemId="1" name="Weapon 2"/>
			<Slot itemId="2" name="Helmet"/>
			<Slot itemId="3" name="Amulet"/>
		</ItemSet>
		<ItemSet id="2" title="Leveling">
			<Slot itemId="4" name="Body Armour"/>
			<Slot itemId="3" name="Amulet"/>
		</ItemSet>
	</Items>
	<Skills activeSkillSet="1">
		<SkillSet id="1" title="Endgame">
			<Skill enabled="true">
				<Gem enabled="true" gemId="Metadata/Items/Gems/SkillGemPunishment" level="20" nameSpec="Punishment" quality="0"/>
			</Skill>
		</SkillSet>
		<SkillSet id="2" title="Leveling">
			<Skill enabled="true">
				<Gem enabled="true" gemId="Metadata/Items/Gems/SkillGemPunishment" level="8" nameSpec="Punishment" quality="0"/>
			</Skill>
		</SkillSet>
	</Skills>
</${options.root ?? 'PathOfBuilding'}>`;

const toCode = (xml: string) =>
  deflateSync(Buffer.from(xml, 'utf8')).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');

const ICON = 'https://web.poecdn.com/gen/image/abc/Shield.png';
const ART_CDN = 'https://web.poecdn.com/image/Art/2DItems/';
const ITEM_ART = parseItemArt({
  bases: {
    'Mosaic Kite Shield': ['Armours/Shields/ShieldStrDex5', 2, 3],
    'Plate Vest': ['Armours/BodyArmours/BodyStr1A', 2, 3],
    Punishment: ['Gems/Punishment', 1, 1],
  },
  uniques: { 'Rise of the Phoenix': ['Armours/Shields/RiseOfThePhoenix'] },
});

function createMemoryStorage(): PobBuildStorage & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: async (keys) => Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]])),
    set: async (values) => {
      Object.assign(data, values);
    },
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** 非傳奇裝備的搜尋都帶「非傳奇」稀有度條件 */
const NON_UNIQUE = { type_filters: { filters: { rarity: { option: 'nonunique' } } } };
describe('usePobBuild', () => {
  let storage: ReturnType<typeof createMemoryStorage>;
  let deps: UsePobBuildDeps;
  let loadCatalog: ReturnType<typeof vi.fn>;
  let loadMatcher: ReturnType<typeof vi.fn>;
  let loadModTranslator: ReturnType<typeof vi.fn>;
  let getLeague: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;
  let openUrl: ReturnType<typeof vi.fn>;
  let showToast: ReturnType<typeof vi.fn>;
  let enqueueLiveSearch: ReturnType<typeof vi.fn>;
  let bookmarkAdd: ReturnType<typeof vi.fn>;
  let fetchShareCode: ReturnType<typeof vi.fn>;
  let openSharePermissionPage: ReturnType<typeof vi.fn>;
  let currentUrl: string;
  let nextId: number;

  const stored = () => (storage.data[pobBuildsStorageKey('poe1')] ?? []) as StoredPobBuild[];
  const first = (pob: UsePobBuild): BuildView => pob.builds.value[0];
  const labels = (build: BuildView) =>
    build.groups.flatMap((group) => group.rows.map((row) => row.label));
  const rowByLabel = (build: BuildView, label: string) =>
    build.groups.flatMap((group) => group.rows).find((row) => row.label === label)!;

  const makeDataLoader = (overrides: Partial<PobDataLoaderAdapter> = {}) =>
    createPobDataLoader({
      listStoredBuilds: () => deps.store.list(),
      loadItemArt: async () => ITEM_ART,
      loadCatalog: loadCatalog as never,
      loadMatcher: loadMatcher as never,
      loadVisceraMods: async () => undefined,
      loadModTranslator: loadModTranslator as never,
      getDisplayLocale: () => 'zh-TW',
      getPageLocale: () => 'en',
      ...overrides,
    });

  beforeEach(() => {
    storage = createMemoryStorage();
    nextId = 0;
    loadCatalog = vi.fn().mockResolvedValue(
      createTradeNameCatalog({
        englishItems: [
          'Rise of the Phoenix',
          'Mosaic Kite Shield',
          "Xoph's Heart",
          'Amber Amulet',
          'Plate Vest',
          'Punishment',
        ],
      }),
    );
    loadMatcher = vi.fn().mockResolvedValue(
      createStatMatcher({
        modLines: { '3299347043': [['{0:+d} to maximum Life', '{0:+d} 最大生命']] },
        tradeStats: { 'explicit.stat_3299347043': '+# to maximum Life' },
      }),
    );
    loadModTranslator = vi.fn().mockResolvedValue(undefined);
    getLeague = vi.fn().mockReturnValue('Standard');
    navigate = vi.fn();
    openUrl = vi.fn();
    showToast = vi.fn();
    enqueueLiveSearch = vi.fn().mockResolvedValue({ success: true, addedCount: 1 });
    bookmarkAdd = vi.fn(async (input: { name: string }) => ({ ok: true, name: input.name }));
    currentUrl = 'https://www.pathofexile.com/trade/search/Standard';
    fetchShareCode = vi.fn();
    openSharePermissionPage = vi.fn().mockResolvedValue(true);
    const store = createPobBuildStore('poe1', {
      storage,
      now: () => 1234,
      createId: () => `build-${++nextId}`,
    });
    deps = {
      store,
      dataLoader: makeDataLoader({ listStoredBuilds: () => store.list() }),
      getLeague: getLeague as never,
      getOrigin: () => 'https://www.pathofexile.com',
      navigate: navigate as never,
      openUrl: openUrl as never,
      showToast: showToast as never,
      getCurrentUrl: () => currentUrl,
      enqueueLiveSearch: enqueueLiveSearch as never,
      bookmarks: {
        listFolders: async () => [{ id: 'g1', name: 'PoB', depth: 0 }],
        add: bookmarkAdd as never,
        dispose: vi.fn(),
      },
      fetchShareCode: fetchShareCode as never,
      openSharePermissionPage: openSharePermissionPage as never,
      waitForInitialPageLoad: async () => undefined,
    };
  });

  describe('還原時機', () => {
    it('還原本機 build 時，等官方頁面首批結果處理完才載入對照資料', async () => {
      const original = usePobBuild('poe1', deps);
      expect(await original.importCode(toCode(buildXml()))).toBe(true);
      loadCatalog.mockClear();

      let markLoaded!: () => void;
      const pageLoaded = new Promise<void>((resolve) => {
        markLoaded = resolve;
      });
      const reopened = usePobBuild('poe1', {
        ...deps,
        dataLoader: makeDataLoader(),
        waitForInitialPageLoad: () => pageLoaded,
      });
      const restoring = reopened.restore();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(loadCatalog).not.toHaveBeenCalled();
      expect(reopened.builds.value).toHaveLength(0);

      markLoaded();
      await restoring;
      expect(loadCatalog).toHaveBeenCalled();
      expect(reopened.builds.value).toHaveLength(1);
    });

    it('預熱共用 dataLoader 後，usePobBuild.restore() 直接命中快取不再重複載入', async () => {
      const original = usePobBuild('poe1', deps);
      expect(await original.importCode(toCode(buildXml()))).toBe(true);
      loadCatalog.mockClear();
      loadMatcher.mockClear();
      loadModTranslator.mockClear();

      const sharedLoader = makeDataLoader();
      await sharedLoader.prewarm('poe1');
      expect(loadCatalog).toHaveBeenCalledTimes(2);
      expect(loadMatcher).toHaveBeenCalledTimes(1);

      const reopened = usePobBuild('poe1', {
        ...deps,
        dataLoader: sharedLoader,
      });
      await reopened.restore();

      expect(reopened.builds.value).toHaveLength(1);
      expect(loadCatalog).toHaveBeenCalledTimes(2);
      expect(loadMatcher).toHaveBeenCalledTimes(1);
    });

    it('等待期間匯入的 build，還原完成後不會被等待前的舊清單蓋掉', async () => {
      const original = usePobBuild('poe1', deps);
      expect(await original.importCode(toCode(buildXml()))).toBe(true);

      let markLoaded!: () => void;
      const pageLoaded = new Promise<void>((resolve) => {
        markLoaded = resolve;
      });
      const reopened = usePobBuild('poe1', {
        ...deps,
        dataLoader: makeDataLoader(),
        waitForInitialPageLoad: () => pageLoaded,
      });
      const restoring = reopened.restore();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(await reopened.importCode(toCode(buildXml()))).toBe(true);
      expect(reopened.builds.value).toHaveLength(1);

      markLoaded();
      await restoring;
      expect(stored()).toHaveLength(2);
      expect(reopened.builds.value).toHaveLength(2);
    });

    it('本機沒有 build 時不必等待也不載入資料', async () => {
      const waitForInitialPageLoad = vi.fn(() => new Promise<void>(() => {}));
      const pob = usePobBuild('poe1', { ...deps, waitForInitialPageLoad });
      await pob.restore();
      expect(waitForInitialPageLoad).not.toHaveBeenCalled();
      expect(loadCatalog).not.toHaveBeenCalled();
    });

    it('使用者主動匯入不等官方頁面載入', async () => {
      const pob = usePobBuild('poe1', {
        ...deps,
        waitForInitialPageLoad: () => new Promise<void>(() => {}),
      });
      expect(await pob.importCode(toCode(buildXml()))).toBe(true);
    });
  });

  describe('匯入與多份 build', () => {
    it('匯入後顯示匯出當下選用的套裝，依類別分組，並存到本機', async () => {
      const pob = usePobBuild('poe1', deps);
      expect(await pob.importCode(`  ${toCode(buildXml())}\n`)).toBe(true);

      const build = first(pob);
      expect(build).toMatchObject({
        id: 'build-1',
        name: '酋長 Lv.97',
        icon: 'poe1:asc:Chieftain',
        collapsed: false,
        itemSetId: '1',
        itemSetOptions: [
          { id: '1', title: 'Endgame', position: 1 },
          { id: '2', title: 'Leveling', position: 2 },
        ],
        progress: { done: 0, total: 4 },
        removedCount: 0,
      });
      expect(build.groups.map((group) => [group.id, group.rows.length])).toEqual([
        ['equipment', 3],
        ['gem:link:Punishment', 1],
      ]);
      expect(build.groups[1]).toMatchObject({ kind: 'gem', skill: 'Punishment' });
      expect(loadCatalog).toHaveBeenCalledWith('poe1', 'en');
      expect(stored()).toEqual([
        {
          id: 'build-1',
          name: '酋長 Lv.97',
          code: toCode(buildXml()),
          importedAt: 1234,
          collapsed: false,
          hideDone: false,
          done: [],
          removed: [],
          searchSelections: {},
          searchDefaults: {},
          searchOverrides: {},
        },
      ]);
      expect(pob.errorKey.value).toBeNull();
    });

    it('再匯入一份會並存，新的排在最前面，各自的進度互不影響', async () => {
      const pob = usePobBuild('poe1', deps);
      await pob.importCode(toCode(buildXml()));
      await pob.importCode(toCode(buildXml({ ascendancy: 'Juggernaut' })));

      expect(pob.builds.value.map((build) => build.name)).toEqual(['勇士 Lv.97', '酋長 Lv.97']);
      // 名稱資料只載入一次（頁面伺服器與顯示語言各一份），第二次匯入不重複載入
      expect(loadCatalog).toHaveBeenCalledTimes(2);

      pob.toggleDone('build-1', rowByLabel(pob.builds.value[1], 'Punishment').key);
      expect(pob.builds.value[1].progress.done).toBe(1);
      expect(pob.builds.value[0].progress.done).toBe(0);
    });

    it('改名、收合、刪除都會記住', async () => {
      const pob = usePobBuild('poe1', deps);
      await pob.importCode(toCode(buildXml()));
      await pob.importCode(toCode(buildXml({ ascendancy: 'Juggernaut' })));

      pob.rename('build-1', '  RF 酋長  ');
      pob.rename('build-1', '   ');
      pob.toggleCollapsed('build-1');
      pob.removeBuild('build-2');
      await flush();

      expect(pob.builds.value).toHaveLength(1);
      expect(first(pob)).toMatchObject({ id: 'build-1', name: 'RF 酋長', collapsed: true });
      expect(stored()).toMatchObject([{ id: 'build-1', name: 'RF 酋長', collapsed: true }]);
    });

    it('重新開啟時讀回所有 build、選用的套裝與進度', async () => {
      const original = usePobBuild('poe1', deps);
      await original.importCode(toCode(buildXml()));
      original.selectItemSet('build-1', '2');
      original.toggleDone('build-1', rowByLabel(first(original), 'Plate Vest').key);
      original.removeEntry('build-1', rowByLabel(first(original), "Xoph's Heart").key);
      await flush();

      const reopened = usePobBuild('poe1', { ...deps, dataLoader: makeDataLoader() });
      await reopened.restore();
      const build = first(reopened);
      expect(build.itemSetId).toBe('2');
      expect(labels(build)).toEqual(['Plate Vest', 'Punishment']);
      expect(rowByLabel(build, 'Plate Vest').done).toBe(true);
      expect(build.removedCount).toBe(1);
    });

    it('讀回時解不開的 build 略過，其餘照常顯示', async () => {
      const pob = usePobBuild('poe1', deps);
      await pob.importCode(toCode(buildXml()));
      storage.data[pobBuildsStorageKey('poe1')] = [
        { id: 'broken', name: 'x', code: 'broken!', importedAt: 1 },
        ...stored(),
      ];

      const reopened = usePobBuild('poe1', { ...deps, dataLoader: makeDataLoader() });
      await reopened.restore();
      expect(reopened.builds.value.map((build) => build.id)).toEqual(['build-1']);
      expect(reopened.errorKey.value).toBeNull();
    });
  });

  describe('匯入失敗', () => {
    it('代碼無效時回報錯誤，既有的 build 不受影響', async () => {
      const pob = usePobBuild('poe1', deps);
      await pob.importCode(toCode(buildXml()));

      expect(await pob.importCode('not a code!')).toBe(false);
      expect(pob.errorKey.value).toBe('pobBuild.error.invalid');
      expect(await pob.importCode('   ')).toBe(false);
      expect(pob.errorKey.value).toBe('pobBuild.error.empty');
      expect(pob.builds.value).toHaveLength(1);
      expect(stored()).toHaveLength(1);
    });

    it('貼上分享網址時先取回代碼再匯入，代碼中的空白會去掉', async () => {
      const code = toCode(buildXml());
      fetchShareCode.mockResolvedValue({
        ok: true,
        code: `${code.slice(0, 10)}\n${code.slice(10)}\n`,
      });
      const pob = usePobBuild('poe1', deps);
      expect(await pob.importCode('  https://poe.ninja/poe1/pob/abc123  ')).toBe(true);
      expect(fetchShareCode).toHaveBeenCalledWith('https://poe.ninja/poe1/pob/abc123');
      expect(first(pob).name).toBe('酋長 Lv.97');
      expect(stored()[0].code).toBe(code);
    });

    it('分享網址取回失敗時依原因回報錯誤，不新增 build', async () => {
      const pob = usePobBuild('poe1', deps);
      const cases = [
        ['permission', 'pobBuild.error.share.permission'],
        ['not-found', 'pobBuild.error.share.notFound'],
        ['invalid-url', 'pobBuild.error.share.invalidUrl'],
        ['timeout', 'pobBuild.error.share.timeout'],
        ['too-large', 'pobBuild.error.tooLarge'],
        ['invalid', 'pobBuild.error.share.invalid'],
      ] as const;
      for (const [error, key] of cases) {
        fetchShareCode.mockResolvedValueOnce({ ok: false, error });
        expect(await pob.importCode('https://pobb.in/abcdef')).toBe(false);
        expect(pob.errorKey.value).toBe(key);
      }
      fetchShareCode.mockRejectedValueOnce(new Error('disconnected'));
      expect(await pob.importCode('pastebin.com/abcd1234')).toBe(false);
      expect(pob.errorKey.value).toBe('pobBuild.error.share.network');
      expect(pob.builds.value).toEqual([]);
      expect(storage.data).toEqual({});
    });

    it('分享網址取回的代碼仍須是同版本的 PoB 代碼', async () => {
      fetchShareCode.mockResolvedValue({ ok: true, code: 'not-a-code' });
      const pob = usePobBuild('poe1', deps);
      expect(await pob.importCode('https://poe.ninja/pob/abc')).toBe(false);
      expect(pob.errorKey.value).toBe('pobBuild.error.invalid');
    });

    it('開啟授權頁交給 background，失敗不拋錯', async () => {
      openSharePermissionPage.mockRejectedValueOnce(new Error('no receiver'));
      const pob = usePobBuild('poe1', deps);
      expect(() => pob.openSharePermissionPage()).not.toThrow();
      await Promise.resolve();
      expect(openSharePermissionPage).toHaveBeenCalledTimes(1);
    });

    it('另一個遊戲版本的代碼不匯入', async () => {
      const pob = usePobBuild('poe1', deps);
      expect(await pob.importCode(toCode(buildXml({ root: 'PathOfBuilding2' })))).toBe(false);
      expect(pob.errorKey.value).toBe('pobBuild.error.versionMismatch');
      expect(pob.builds.value).toEqual([]);
      expect(storage.data).toEqual({});
    });

    it('物品名稱資料載入失敗時回報錯誤且不儲存', async () => {
      loadCatalog.mockRejectedValue(new Error('HTTP 404'));
      const pob = usePobBuild('poe1', deps);
      expect(await pob.importCode(toCode(buildXml()))).toBe(false);
      expect(pob.errorKey.value).toBe('pobBuild.error.catalog');
      expect(storage.data).toEqual({});
    });

    it('詞綴對應資料載不到時仍可匯入，只是稀有裝沒有詞綴條件', async () => {
      loadMatcher.mockRejectedValue(new Error('HTTP 404'));
      const pob = usePobBuild('poe1', deps);
      expect(await pob.importCode(toCode(buildXml()))).toBe(true);
      pob.selectItemSet('build-1', '2');
      expect(rowByLabel(first(pob), 'Plate Vest').query).toEqual({
        status: { option: 'securable' },
        type: 'Plate Vest',
        filters: NON_UNIQUE,
      });
    });
  });

  describe('套裝、完成與移除', () => {
    it('切換裝備套裝與技能組會換清單，選擇會記住', async () => {
      const pob = usePobBuild('poe1', deps);
      await pob.importCode(toCode(buildXml()));

      pob.selectItemSet('build-1', '2');
      pob.selectSkillSet('build-1', '2');
      await flush();

      expect(labels(first(pob))).toEqual(['Plate Vest', "Xoph's Heart", 'Punishment']);
      expect(rowByLabel(first(pob), 'Punishment').level).toBe(8);
      expect(stored()[0]).toMatchObject({ itemSetId: '2', skillSetId: '2' });

      pob.selectItemSet('build-1', 'does-not-exist');
      expect(first(pob).itemSetId).toBe('2');
    });

    it('稀有裝備帶入對得到的詞綴（下限八成），工藝詞綴不列入', async () => {
      const pob = usePobBuild('poe1', deps);
      await pob.importCode(toCode(buildXml()));
      pob.selectItemSet('build-1', '2');

      const plate = rowByLabel(first(pob), 'Plate Vest');
      expect(plate.query).toEqual({
        status: { option: 'securable' },
        type: 'Plate Vest',
        filters: NON_UNIQUE,
        stats: [{ type: 'and', filters: [{ id: 'explicit.stat_3299347043', value: { min: 80 } }] }],
      });
      expect(plate.rarity).toBe('RARE');
      expect(plate.mods?.map(({ stat: _stat, ...mod }) => mod)).toEqual([
        { text: '+100 to maximum Life', kind: 'explicit', searched: true },
        { text: '+20 to maximum Life', kind: 'crafted', searched: false },
      ]);
    });

    it('詞綴以顯示語言呈現，翻不了的維持英文；搜尋條件不受影響', async () => {
      loadModTranslator.mockResolvedValue(
        createModLineTranslator({
          '3299347043': [['{0:+d} to maximum Life', '{0:+d} 最大生命']],
        }),
      );
      const pob = usePobBuild('poe1', deps);
      await pob.importCode(toCode(buildXml()));
      pob.selectItemSet('build-1', '2');

      const plate = rowByLabel(first(pob), 'Plate Vest');
      expect(loadModTranslator).toHaveBeenCalledWith('poe1', 'zh-TW');
      expect(plate.mods?.map(({ stat: _stat, ...mod }) => mod)).toEqual([
        { text: '+100 最大生命', kind: 'explicit', searched: true },
        { text: '+20 最大生命', kind: 'crafted', searched: false },
      ]);
      expect(plate.query).toMatchObject({
        stats: [{ filters: [{ id: 'explicit.stat_3299347043', value: { min: 80 } }] }],
      });
    });

    it('名稱以顯示語言呈現，搜尋仍用頁面伺服器的名稱', async () => {
      loadCatalog.mockImplementation(async (_version: string, locale: string) =>
        createTradeNameCatalog({
          englishItems: ['Plate Vest', "Xoph's Heart", 'Amber Amulet', 'Punishment'],
          ...(locale === 'zh-TW'
            ? { localizedItems: ['鍍金鎧甲', '索伏之心', '琥珀護身符', '懲戒'] }
            : {}),
        }),
      );
      const pob = usePobBuild('poe1', deps);
      await pob.importCode(toCode(buildXml()));
      pob.selectItemSet('build-1', '2');

      expect(loadCatalog.mock.calls.map((call) => call[1])).toEqual(['en', 'zh-TW']);
      expect(labels(first(pob))).toEqual(['鍍金鎧甲', '索伏之心', '懲戒']);
      expect(rowByLabel(first(pob), '索伏之心').query).toMatchObject({
        name: "Xoph's Heart",
        type: 'Amber Amulet',
      });
      expect(rowByLabel(first(pob), '鍍金鎧甲').query).toMatchObject({ type: 'Plate Vest' });
    });

    it('顯示語言的名稱資料載不到、或該名稱沒有譯名時，維持頁面伺服器的名稱', async () => {
      loadCatalog.mockImplementation(async (_version: string, locale: string) => {
        if (locale !== 'en') throw new Error('HTTP 404');
        return createTradeNameCatalog({ englishItems: ['Plate Vest', 'Punishment'] });
      });
      const pob = usePobBuild('poe1', deps);
      expect(await pob.importCode(toCode(buildXml()))).toBe(true);
      pob.selectItemSet('build-1', '2');
      expect(labels(first(pob))).toContain('Plate Vest');
    });

    it('顯示語言與頁面伺服器相同時不重複載入名稱資料', async () => {
      const sameLocale = usePobBuild('poe1', {
        ...deps,
        dataLoader: makeDataLoader({ getDisplayLocale: () => 'en' }),
      });
      await sameLocale.importCode(toCode(buildXml()));
      expect(loadCatalog).toHaveBeenCalledTimes(1);
    });

    it('翻譯資料載不到時詞綴維持英文', async () => {
      loadModTranslator.mockRejectedValue(new Error('HTTP 404'));
      const pob = usePobBuild('poe1', deps);
      expect(await pob.importCode(toCode(buildXml()))).toBe(true);
      pob.selectItemSet('build-1', '2');
      expect(rowByLabel(first(pob), 'Plate Vest').mods?.[0].text).toBe('+100 to maximum Life');
    });

    it('標記完成會計入進度並記住；同一件裝備在另一個套裝也是已完成', async () => {
      const pob = usePobBuild('poe1', deps);
      await pob.importCode(toCode(buildXml()));
      const amuletKey = rowByLabel(first(pob), "Xoph's Heart").key;

      pob.toggleDone('build-1', amuletKey);
      await flush();
      expect(rowByLabel(first(pob), "Xoph's Heart").done).toBe(true);
      expect(first(pob).progress).toEqual({ done: 1, total: 4 });
      expect(stored()[0].done).toEqual([amuletKey]);

      pob.selectItemSet('build-1', '2');
      expect(rowByLabel(first(pob), "Xoph's Heart").done).toBe(true);
      expect(rowByLabel(first(pob), 'Plate Vest').done).toBe(false);

      pob.toggleDone('build-1', amuletKey);
      await flush();
      expect(stored()[0].done).toEqual([]);
    });

    it('連續操作不會互相覆蓋', async () => {
      const pob = usePobBuild('poe1', deps);
      await pob.importCode(toCode(buildXml()));
      const keys = first(pob).groups.flatMap((group) => group.rows.map((row) => row.key));

      keys.forEach((key) => pob.toggleDone('build-1', key));
      pob.selectItemSet('build-1', '2');
      await flush();

      expect(stored()[0].done).toEqual(keys);
      expect(stored()[0].itemSetId).toBe('2');
    });

    it('移除的項目不再列出也不計入進度，可以全部還原', async () => {
      const pob = usePobBuild('poe1', deps);
      await pob.importCode(toCode(buildXml()));
      const helmetKey = rowByLabel(first(pob), 'Not On Trade').key;

      pob.removeEntry('build-1', helmetKey);
      await flush();
      expect(labels(first(pob))).not.toContain('Not On Trade');
      expect(first(pob).progress.total).toBe(3);
      expect(first(pob).removedCount).toBe(1);
      expect(stored()[0].removed).toEqual([helmetKey]);

      // 另一個套裝沒有這件頭盔，那裡沒有可還原的項目
      pob.selectItemSet('build-1', '2');
      expect(first(pob).removedCount).toBe(0);

      pob.selectItemSet('build-1', '1');
      pob.restoreRemoved('build-1');
      await flush();
      expect(labels(first(pob))).toContain('Not On Trade');
      expect(stored()[0].removed).toEqual([]);
    });
  });

  describe('插槽內容物', () => {
    it('PoE 1 依技能組把插在該部位的寶石依序填進插槽（超過插槽數不顯示）', async () => {
      const supports = [
        '<Skill enabled="true" label="Auras" slot="Weapon 2">',
        '<Gem enabled="true" gemId="Metadata/Items/Gems/SupportGemEmpower" level="4" nameSpec="Empower" quality="0"/>',
        '<Gem enabled="true" gemId="Metadata/Items/Gems/SupportGemEnlighten" level="4" nameSpec="Enlighten" quality="0"/>',
        '<Gem enabled="true" gemId="Metadata/Items/Gems/SupportGemEnhance" level="4" nameSpec="Enhance" quality="0"/>',
        '</Skill>',
      ].join('\n');
      const xml = buildXml()
        .replace('Mosaic Kite Shield\n', 'Mosaic Kite Shield\nSockets: R-B\n')
        .replace(
          '<SkillSet id="1" title="Endgame">',
          `<SkillSet id="1" title="Endgame">\n${supports}`,
        );
      const pob = usePobBuild('poe1', deps);
      await pob.importCode(toCode(xml));
      await flush();
      const shield = rowByLabel(first(pob), 'Rise of the Phoenix');
      expect(shield.socketContents).toEqual([
        expect.objectContaining({
          kind: 'gem',
          label: 'Empower Support',
          support: true,
          detail: 'Lv.4 / 0%',
        }),
        expect.objectContaining({ kind: 'gem', label: 'Enlighten Support', support: true }),
      ]);
      // 沒有插槽的裝備沒有內容物
      expect(rowByLabel(first(pob), "Xoph's Heart").socketContents).toBeUndefined();
    });

    it('PoE 1 深淵孔放 PoB 指定插在那裡的深淵珠寶，其他孔放寶石；空孔為 null', async () => {
      const xml = buildXml()
        .replace('Mosaic Kite Shield\n', 'Mosaic Kite Shield\nSockets: A-R B\n')
        .replace(
          '<ItemSet id="1" title="Endgame">',
          [
            '<Item id="5">',
            'Rarity: RARE',
            'Gloom Hunger',
            'Hypnotic Eye Jewel',
            '</Item>',
            '<ItemSet id="1" title="Endgame">',
            '<Slot itemId="5" name="Weapon 2 Abyssal Socket 1"/>',
          ].join('\n'),
        )
        .replace(
          '<SkillSet id="1" title="Endgame">',
          [
            '<SkillSet id="1" title="Endgame">',
            '<Skill enabled="true" slot="Weapon 2">',
            '<Gem enabled="true" gemId="Metadata/Items/Gems/SupportGemEmpower" level="4" nameSpec="Empower" quality="0"/>',
            '</Skill>',
          ].join('\n'),
        );
      const pob = usePobBuild('poe1', deps);
      await pob.importCode(toCode(xml));
      await flush();
      const jewel = first(pob)
        .groups.flatMap((group) => group.rows)
        .find((row) => row.slot === 'Weapon 2 Abyssal Socket 1');
      expect(jewel).toBeDefined();
      expect(rowByLabel(first(pob), 'Rise of the Phoenix').socketContents).toEqual([
        expect.objectContaining({ kind: 'jewel', rowKey: jewel!.key }),
        expect.objectContaining({ kind: 'gem', label: 'Empower Support' }),
        null,
      ]);
    });
  });

  describe('隱藏已完成與排序', () => {
    it('已完成的項目留在原位；隱藏已完成時不列出但仍計入進度，並記住', async () => {
      const pob = usePobBuild('poe1', deps);
      await pob.importCode(toCode(buildXml()));
      expect(labels(first(pob))).toEqual([
        'Rise of the Phoenix',
        'Not On Trade',
        "Xoph's Heart",
        'Punishment',
      ]);

      pob.toggleDone('build-1', rowByLabel(first(pob), 'Rise of the Phoenix').key);
      expect(labels(first(pob))).toEqual([
        'Rise of the Phoenix',
        'Not On Trade',
        "Xoph's Heart",
        'Punishment',
      ]);

      pob.setHideDone('build-1', true);
      await flush();
      expect(first(pob).hideDone).toBe(true);
      expect(labels(first(pob))).toEqual(['Not On Trade', "Xoph's Heart", 'Punishment']);
      expect(first(pob).progress).toEqual({ done: 1, total: 4 });
      expect(stored()[0].hideDone).toBe(true);

      // 分組全部完成時整組不列出
      pob.toggleDone('build-1', rowByLabel(first(pob), 'Punishment').key);
      expect(first(pob).groups.map((group) => group.id)).toEqual(['equipment']);
    });
  });

  describe('更新代碼', () => {
    // 新版：Endgame 拿掉頭盔、改穿 Plate Vest
    const updatedXml = () =>
      buildXml().replace(
        '<Slot itemId="2" name="Helmet"/>',
        '<Slot itemId="4" name="Body Armour"/>',
      );

    it('保留名稱、進度與搜尋調整，清掉新代碼已沒有的項目，並提示變動', async () => {
      const pob = usePobBuild('poe1', deps);
      await pob.importCode(toCode(buildXml()));
      pob.rename('build-1', '我的 build');
      const phoenixKey = rowByLabel(first(pob), 'Rise of the Phoenix').key;
      const helmetKey = rowByLabel(first(pob), 'Not On Trade').key;
      pob.toggleDone('build-1', phoenixKey);
      pob.toggleDone('build-1', helmetKey);
      pob.selectItemSet('build-1', '2');
      const plateKey = rowByLabel(first(pob), 'Plate Vest').key;
      pob.saveSelection('build-1', plateKey, { pseudo: true });
      pob.selectItemSet('build-1', '1');
      await flush();

      expect(await pob.updateCode('build-1', toCode(updatedXml()))).toBe(true);
      await flush();

      const build = first(pob);
      expect(build.name).toBe('我的 build');
      expect(labels(build)).toEqual([
        'Rise of the Phoenix',
        'Plate Vest',
        "Xoph's Heart",
        'Punishment',
      ]);
      expect(rowByLabel(build, 'Rise of the Phoenix').done).toBe(true);
      expect(rowByLabel(build, 'Plate Vest').pseudo).toBe(true);
      expect(stored()[0]).toMatchObject({
        name: '我的 build',
        code: toCode(updatedXml()),
        done: [phoenixKey],
        searchSelections: { [plateKey]: { pseudo: true } },
      });
      expect(showToast).toHaveBeenCalledWith('已更新代碼：保留 1 項進度，新增 1 項，移除 1 項');
    });

    it('代碼無效或遊戲版本不同時拒絕，原本的清單不變', async () => {
      const pob = usePobBuild('poe1', deps);
      await pob.importCode(toCode(buildXml()));
      await flush();

      expect(await pob.updateCode('build-1', 'not-a-code')).toBe(false);
      expect(pob.errorKey.value).toBe('pobBuild.error.invalid');
      expect(await pob.updateCode('build-1', toCode(buildXml({ root: 'PathOfBuilding2' })))).toBe(
        false,
      );
      expect(pob.errorKey.value).toBe('pobBuild.error.versionMismatch');
      expect(stored()[0].code).toBe(toCode(buildXml()));
      expect(labels(first(pob))).toContain('Not On Trade');
      expect(showToast).not.toHaveBeenCalled();
    });

    it('本機儲存：不存在的 build 或空代碼不寫入', async () => {
      const pob = usePobBuild('poe1', deps);
      await pob.importCode(toCode(buildXml()));
      await flush();
      expect(await deps.store.replaceCode('missing', 'CODE', {})).toBe(false);
      expect(await deps.store.replaceCode('build-1', '', {})).toBe(false);
      expect(stored()[0].code).toBe(toCode(buildXml()));
    });
  });

  describe('舊版進度', () => {
    it('讀回時把不分組的寶石 key 換成新格式並存回本機', async () => {
      const legacyKey = ['gem', 'Punishment', 20, 0].join('\u0000');
      storage.data[pobBuildsStorageKey('poe1')] = [
        {
          id: 'old',
          name: 'Old',
          code: toCode(buildXml()),
          importedAt: 1,
          collapsed: false,
          done: [legacyKey],
          removed: [],
          icons: { [legacyKey]: ICON },
          searchSelections: {},
        },
      ];
      const pob = usePobBuild('poe1', deps);
      await pob.restore();
      await flush();

      const gem = rowByLabel(first(pob), 'Punishment');
      expect(gem.done).toBe(true);
      expect(stored()[0].done).toEqual([gem.key]);
      // 舊版從搜尋結果擷取的圖片不再保存
      expect(stored()[0]).not.toHaveProperty('icons');
    });
  });

  describe('調整搜尋條件', () => {
    const LIFE = 'explicit.stat_3299347043';
    const plateOf = (pob: UsePobBuild) => rowByLabel(first(pob), 'Plate Vest');

    it('取消勾選與改下限會更新搜尋、標示已調整並記住', async () => {
      const pob = usePobBuild('poe1', deps);
      await pob.importCode(toCode(buildXml()));
      pob.selectItemSet('build-1', '2');
      expect(plateOf(pob).filters).toEqual([
        { id: LIFE, key: LIFE, value: 100, enabled: true, min: 80, customized: false },
      ]);

      pob.saveSelection('build-1', plateOf(pob).key, { stats: { [LIFE]: { min: 95 } } });
      expect(plateOf(pob).query).toMatchObject({
        stats: [{ filters: [{ id: LIFE, value: { min: 95 } }] }],
      });
      expect(plateOf(pob).searchCustomized).toBe(true);

      pob.saveSelection('build-1', plateOf(pob).key, {
        stats: { [LIFE]: { min: 95, enabled: false } },
      });
      expect(plateOf(pob).query).toEqual({
        status: { option: 'securable' },
        type: 'Plate Vest',
        filters: NON_UNIQUE,
      });
      expect(plateOf(pob).mods?.[0].searched).toBe(false);
      await flush();
      expect(stored()[0].searchSelections).toEqual({
        [plateOf(pob).key]: { stats: { [LIFE]: { min: 95, enabled: false } } },
      });

      // 重新開啟時讀回調整
      const reopened = usePobBuild('poe1', { ...deps, dataLoader: makeDataLoader() });
      await reopened.restore();
      reopened.selectItemSet('build-1', '2');
      expect(plateOf(reopened).filters[0]).toMatchObject({ enabled: false, min: 95 });
    });

    it('至少符合 N 項與總和條件；還原預設會清掉調整', async () => {
      const pob = usePobBuild('poe1', deps);
      await pob.importCode(toCode(buildXml()));
      pob.selectItemSet('build-1', '2');
      const key = plateOf(pob).key;

      pob.saveSelection('build-1', key, { countMin: 1 });
      expect(plateOf(pob).countMin).toBe(1);
      expect(plateOf(pob).query).toMatchObject({ stats: [{ type: 'count', value: { min: 1 } }] });

      pob.saveSelection('build-1', key, { countMin: 1, pseudo: true });
      expect(plateOf(pob).pseudo).toBe(true);
      expect(plateOf(pob).query).toMatchObject({
        stats: [{ filters: [{ id: 'pseudo.pseudo_total_life', value: { min: 80 } }] }],
      });

      pob.saveSelection('build-1', key, { pseudo: true });
      expect(plateOf(pob).countMin).toBeUndefined();

      pob.resetSearch('build-1', key);
      expect(plateOf(pob).searchCustomized).toBe(false);
      expect(plateOf(pob).pseudo).toBe(false);
      await flush();
      expect(stored()[0].searchSelections).toEqual({});
    });

    it('saveSelection 整批存回條件、更新 searchSelection 與提示，傳入 undefined 則清回預設', async () => {
      const pob = usePobBuild('poe1', deps);
      await pob.importCode(toCode(buildXml()));
      pob.selectItemSet('build-1', '2');
      const key = plateOf(pob).key;

      pob.saveSelection('build-1', key, {
        stats: { [LIFE]: { min: 110 } },
        countMin: 1,
        pseudo: true,
      });
      expect(plateOf(pob).searchCustomized).toBe(true);
      expect(plateOf(pob).searchSelection).toEqual({
        stats: { [LIFE]: { min: 110 } },
        countMin: 1,
        pseudo: true,
      });
      expect(showToast).toHaveBeenCalledWith('已存回「Plate Vest」的搜尋條件');
      await flush();
      expect(stored()[0].searchSelections[key]).toEqual({
        stats: { [LIFE]: { min: 110 } },
        countMin: 1,
        pseudo: true,
      });

      pob.saveSelection('build-1', key, undefined);
      expect(plateOf(pob).searchCustomized).toBe(false);
      expect(plateOf(pob).searchSelection).toBeUndefined();
      await flush();
      expect(stored()[0].searchSelections).toEqual({});
    });

    it('build 整體設定：數值比例套用到沒調整過的條件，存回本機並重新讀回', async () => {
      const pob = usePobBuild('poe1', deps);
      await pob.importCode(toCode(buildXml()));
      pob.selectItemSet('build-1', '2');
      expect(first(pob).searchDefaults).toEqual({});

      pob.setSearchDefaults('build-1', { statPercent: 50, links: 'none' });
      expect(first(pob).searchDefaults).toEqual({
        statPercent: 50,
        links: 'none',
      });
      expect(plateOf(pob).filters[0]).toMatchObject({
        min: 50,
        customized: false,
      });
      expect(plateOf(pob).query).toMatchObject({
        stats: [{ filters: [{ id: LIFE, value: { min: 50 } }] }],
      });

      // 單件調整過的下限不跟著整體設定變
      pob.saveSelection('build-1', plateOf(pob).key, { stats: { [LIFE]: { min: 95 } } });
      pob.setSearchDefaults('build-1', { statPercent: 70 });
      expect(plateOf(pob).filters[0]).toMatchObject({ min: 95 });
      await flush();
      expect(stored()[0].searchDefaults).toEqual({ statPercent: 70 });

      const reopened = usePobBuild('poe1', { ...deps, dataLoader: makeDataLoader() });
      await reopened.restore();
      expect(first(reopened).searchDefaults).toEqual({ statPercent: 70 });

      // 回到預設時不存多餘的欄位
      pob.setSearchDefaults('build-1', { statPercent: 80, links: 'pob' });
      expect(first(pob).searchDefaults).toEqual({});
      await flush();
      expect(stored()[0].searchDefaults).toEqual({});
    });

    it('build 整體設定：稀有裝改以類別搜尋，單件可以改回基底', async () => {
      const pob = usePobBuild('poe1', deps);
      await pob.importCode(toCode(buildXml()));
      pob.selectItemSet('build-1', '2');
      expect(plateOf(pob)).toMatchObject({ searchBy: 'base', category: { id: 'armour.chest' } });

      pob.setSearchDefaults('build-1', { rareSearch: 'category' });
      expect(plateOf(pob).searchBy).toBe('category');
      expect(plateOf(pob).query).not.toHaveProperty('type');
      expect(plateOf(pob).query).toMatchObject({
        filters: { type_filters: { filters: { category: { option: 'armour.chest' } } } },
      });

      pob.saveSelection('build-1', plateOf(pob).key, { searchBy: 'base' });
      expect(plateOf(pob).searchBy).toBe('base');
      expect(plateOf(pob).query).toMatchObject({ type: 'Plate Vest' });
      await flush();
      expect(stored()[0].searchSelections[plateOf(pob).key]).toEqual({ searchBy: 'base' });
    });

    it('build 整體設定：預設改用總和，單件關掉時存成 false，回到預設時不存', async () => {
      const pob = usePobBuild('poe1', deps);
      await pob.importCode(toCode(buildXml()));
      pob.selectItemSet('build-1', '2');
      expect(plateOf(pob).pseudo).toBe(false);

      pob.setSearchDefaults('build-1', { pseudo: true, defenceMin: true });
      expect(first(pob).searchDefaults).toEqual({ defenceMin: true, pseudo: true });
      expect(plateOf(pob).pseudo).toBe(true);

      pob.saveSelection('build-1', plateOf(pob).key, { pseudo: false });
      expect(plateOf(pob).pseudo).toBe(false);
      await flush();
      expect(stored()[0].searchSelections[plateOf(pob).key]).toEqual({ pseudo: false });

      pob.saveSelection('build-1', plateOf(pob).key, undefined);
      expect(plateOf(pob).pseudo).toBe(true);
      await flush();
      expect(stored()[0].searchSelections[plateOf(pob).key]).toBeUndefined();

      const reopened = usePobBuild('poe1', { ...deps, dataLoader: makeDataLoader() });
      await reopened.restore();
      expect(first(reopened).searchDefaults).toEqual({ defenceMin: true, pseudo: true });
    });

    it('本機存的整體設定格式不對時略過該欄', async () => {
      storage.data[pobBuildsStorageKey('poe1')] = [
        {
          id: 'saved',
          name: '',
          code: toCode(buildXml()),
          searchDefaults: { statPercent: 33, links: 'seven', rareSearch: 'name' },
          searchSelections: {
            a: { links: 9, searchBy: 'name' },
            b: { links: null },
            c: { links: 5, searchBy: 'category' },
            d: { pseudo: false },
            e: { pseudo: 'yes' },
          },
        },
        {
          id: 'other',
          name: '',
          code: toCode(buildXml()),
          searchDefaults: { statPercent: 60, links: 'six', rareSearch: 'category' },
        },
      ];
      const list = await createPobBuildStore('poe1', { storage }).list();
      expect(list[0].searchDefaults).toEqual({});
      expect(list[0].searchSelections).toEqual({
        b: { links: null },
        c: { links: 5, searchBy: 'category' },
        d: { pseudo: false },
      });
      expect(list[1].searchDefaults).toEqual({
        statPercent: 60,
        links: 'six',
        rareSearch: 'category',
      });
    });

    it('開啟搜尋使用調整後的條件', async () => {
      const pob = usePobBuild('poe1', deps);
      await pob.importCode(toCode(buildXml()));
      pob.selectItemSet('build-1', '2');
      pob.saveSelection('build-1', plateOf(pob).key, { stats: { [LIFE]: { min: 120 } } });
      pob.openSearch('build-1', plateOf(pob), 'current');
      const url = new URL(navigate.mock.calls[0][0] as string);
      expect(JSON.parse(url.searchParams.get('q')!).query.stats[0].filters).toEqual([
        { id: LIFE, value: { min: 120 } },
      ]);
    });

    it('本機存的調整格式不對時略過該欄，不影響其他資料', async () => {
      storage.data[pobBuildsStorageKey('poe1')] = [
        {
          id: 'saved',
          name: '',
          code: toCode(buildXml()),
          done: [],
          removed: [],
          icons: {},
          searchSelections: {
            good: {
              stats: { [LIFE]: { min: 50, enabled: 'yes', domain: 'Fractured!' } },
              countMin: 0,
              pseudo: 1,
            },
            switched: { stats: { [LIFE]: { domain: 'fractured' } } },
            bad: 'oops',
            empty: { stats: { [LIFE]: { min: Number.NaN } } },
          },
        },
      ];
      const list = await createPobBuildStore('poe1', { storage }).list();
      expect(list[0].searchSelections).toEqual({
        good: { stats: { [LIFE]: { min: 50 } } },
        switched: { stats: { [LIFE]: { domain: 'fractured' } } },
      });
    });
  });

  describe('多個分頁同時開啟與存檔失敗', () => {
    /** 共用同一份本機資料、寫入後通知所有訂閱者（模擬 chrome.storage.onChanged） */
    const sharedStorage = (): PobBuildStorage => {
      const listeners = new Set<(keys: readonly string[]) => void>();
      return {
        get: storage.get,
        set: async (values) => {
          await storage.set(values);
          const keys = Object.keys(values);
          queueMicrotask(() => listeners.forEach((listener) => listener(keys)));
        },
        onChanged: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      };
    };
    const tab = (shared: PobBuildStorage) =>
      usePobBuild('poe1', {
        ...deps,
        store: createPobBuildStore('poe1', {
          storage: shared,
          createId: () => `build-${++nextId}`,
        }),
      });
    const settle = async () => {
      for (let i = 0; i < 5; i++) await flush();
    };

    it('另一個分頁勾的完成不會被這個分頁的舊資料蓋掉，且畫面會同步', async () => {
      const shared = sharedStorage();
      const a = tab(shared);
      await a.importCode(toCode(buildXml()));
      const b = tab(shared);
      await b.restore();
      const phoenix = rowByLabel(first(a), 'Rise of the Phoenix').key;
      const amulet = rowByLabel(first(a), "Xoph's Heart").key;

      a.toggleDone('build-1', phoenix);
      await settle();
      // B 還沒收到通知前就勾了另一項：寫入時以本機最新內容計算，不會丟掉 A 的進度
      b.toggleDone('build-1', amulet);
      await settle();

      expect(stored()[0].done.sort()).toEqual([amulet, phoenix].sort());
      expect(rowByLabel(first(a), "Xoph's Heart").done).toBe(true);
      expect(rowByLabel(first(b), 'Rise of the Phoenix').done).toBe(true);
      a.dispose();
      b.dispose();
    });

    it('同時有多次同步時，較晚算完的舊快照不會蓋掉較新的內容', async () => {
      const listeners = new Set<(keys: readonly string[]) => void>();
      let hold: Promise<void> | undefined;
      const slow: PobBuildStorage = {
        // 先取快照再等待：模擬較早開始、較晚算完的同步
        get: async (keys) => {
          const snapshot = await storage.get(keys);
          if (hold) await hold;
          return snapshot;
        },
        set: storage.set,
        onChanged: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      };
      const a = tab(slow);
      await a.importCode(toCode(buildXml()));
      const phoenix = rowByLabel(first(a), 'Rise of the Phoenix').key;
      const key = pobBuildsStorageKey('poe1');
      const notify = () => listeners.forEach((listener) => listener([key]));

      storage.data[key] = stored().map((build) => ({ ...build, done: [phoenix] }));
      let release!: () => void;
      hold = new Promise((resolve) => (release = resolve));
      notify();
      await flush();
      hold = undefined;
      storage.data[key] = stored().map((build) => ({ ...build, done: [] }));
      notify();
      await settle();
      expect(rowByLabel(first(a), 'Rise of the Phoenix').done).toBe(false);

      release();
      await settle();
      expect(rowByLabel(first(a), 'Rise of the Phoenix').done).toBe(false);
      a.dispose();
    });

    /** 本機資料可由測試直接改寫、再手動送出變更通知 */
    const notifyingStorage = () => {
      const listeners = new Set<(keys: readonly string[]) => void>();
      const shared: PobBuildStorage = {
        get: storage.get,
        set: async (values) => {
          await storage.set(values);
          const keys = Object.keys(values);
          queueMicrotask(() => listeners.forEach((listener) => listener(keys)));
        },
        onChanged: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      };
      const notify = () => listeners.forEach((listener) => listener([pobBuildsStorageKey('poe1')]));
      return { shared, notify };
    };

    it('這個分頁自己的寫入觸發同步時，內容沒變就不重建畫面', async () => {
      const { shared } = notifyingStorage();
      const a = tab(shared);
      await a.importCode(toCode(buildXml()));
      await settle();
      a.toggleDone('build-1', rowByLabel(first(a), 'Rise of the Phoenix').key);
      const afterToggle = a.builds.value;
      await settle();
      expect(stored()[0].done).toHaveLength(1);
      expect(a.builds.value).toBe(afterToggle);
      a.dispose();
    });

    it('同步時解不開的 build 記錄錯誤並保留畫面上原本的版本', async () => {
      const { shared, notify } = notifyingStorage();
      const a = tab(shared);
      await a.importCode(toCode(buildXml()));
      await settle();
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const key = pobBuildsStorageKey('poe1');
      storage.data[key] = stored().map((build) => ({ ...build, code: 'not-a-pob-code' }));
      notify();
      await settle();
      expect(error).toHaveBeenCalledWith(expect.stringContaining('build-1'), expect.anything());
      expect(a.builds.value.map((build) => build.id)).toEqual(['build-1']);
      error.mockRestore();
      a.dispose();
    });

    it('另一個分頁新增的 build 也會出現在這個分頁，且不會重複', async () => {
      const shared = sharedStorage();
      const a = tab(shared);
      const b = tab(shared);
      await a.importCode(toCode(buildXml()));
      await settle();
      expect(a.builds.value.map((build) => build.id)).toEqual(['build-1']);
      expect(b.builds.value.map((build) => build.id)).toEqual(['build-1']);
      a.dispose();
      b.dispose();
    });

    it('本機已達上限時不擠掉既有的 build，顯示數量上限錯誤', async () => {
      storage.data[pobBuildsStorageKey('poe1')] = Array.from({ length: 20 }, (_, index) => ({
        id: `old-${index}`,
        name: `Old ${index}`,
        code: toCode(buildXml()),
      }));
      // 這個分頁的畫面還沒讀到其他分頁新增的 build
      const pob = usePobBuild('poe1', deps);
      expect(await pob.importCode(toCode(buildXml()))).toBe(false);
      expect(pob.errorKey.value).toBe('pobBuild.error.tooMany');
      expect(stored()).toHaveLength(20);
      expect(stored()[19].id).toBe('old-19');
    });

    it('存不進本機時提示使用者並記錄錯誤，畫面回到本機實際內容', async () => {
      const pob = usePobBuild('poe1', deps);
      await pob.importCode(toCode(buildXml()));
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const original = storage.set;
      storage.set = async () => {
        throw new Error('QUOTA_BYTES quota exceeded');
      };
      pob.toggleDone('build-1', rowByLabel(first(pob), 'Rise of the Phoenix').key);
      expect(rowByLabel(first(pob), 'Rise of the Phoenix').done).toBe(true);
      await settle();

      expect(showToast).toHaveBeenCalledWith(expect.any(String), 'error');
      expect(error).toHaveBeenCalled();
      expect(rowByLabel(first(pob), 'Rise of the Phoenix').done).toBe(false);
      storage.set = original;
      error.mockRestore();
    });

    it('授權頁開不起來時提示使用者', async () => {
      openSharePermissionPage.mockResolvedValueOnce(false);
      const pob = usePobBuild('poe1', deps);
      pob.openSharePermissionPage();
      await flush();
      expect(showToast).toHaveBeenCalledWith(expect.any(String), 'error');
    });
  });

  describe('串接主控台、存回搜尋與書籤', () => {
    const codeOf = (url: string) => parseTradeSearchUrl(url)?.searchId ?? '';

    it('送進主控台的網址可被解析，代碼解回該項目的條件，名稱帶清單名與項目名', async () => {
      const pob = usePobBuild('poe1', deps);
      await pob.importCode(toCode(buildXml()));
      const phoenix = rowByLabel(first(pob), 'Rise of the Phoenix');

      expect(await pob.sendToLiveSearch('build-1', phoenix)).toBe(true);
      const request = enqueueLiveSearch.mock.calls[0][0];
      expect(request.gameVersion).toBe('poe1');
      expect(request.items[0].name).toBe('酋長 Lv.97 · Rise of the Phoenix');
      const parsed = parseTradeSearchUrl(request.items[0].url);
      expect(parsed).toMatchObject({ gameVersion: 'poe1', league: 'standard' });
      expect(await decodeGzipBase64UrlToQuery(parsed!.searchId)).toEqual(phoenix.query);
      expect(showToast).toHaveBeenCalledWith(
        '已送入主控台：酋長 Lv.97 · Rise of the Phoenix',
        'default',
      );
    });

    it('主控台拒絕或頁面沒有聯盟時說明原因', async () => {
      const pob = usePobBuild('poe1', deps);
      await pob.importCode(toCode(buildXml()));
      const phoenix = rowByLabel(first(pob), 'Rise of the Phoenix');

      enqueueLiveSearch.mockResolvedValueOnce({ success: false, error: '主控台已滿' });
      expect(await pob.sendToLiveSearch('build-1', phoenix)).toBe(false);
      expect(showToast).toHaveBeenLastCalledWith('主控台已滿', 'error');

      enqueueLiveSearch.mockRejectedValueOnce(new Error(''));
      expect(await pob.sendToLiveSearch('build-1', phoenix)).toBe(false);
      expect(showToast).toHaveBeenLastCalledWith('送進主控台失敗', 'error');

      getLeague.mockReturnValue(undefined);
      expect(await pob.sendToLiveSearch('build-1', phoenix)).toBe(false);
      expect(pob.errorKey.value).toBe('pobBuild.error.noLeague');
      expect(enqueueLiveSearch).toHaveBeenCalledTimes(2);
    });

    it('線上搜尋開啟用代碼網址加 /live', async () => {
      const pob = usePobBuild('poe1', deps);
      await pob.importCode(toCode(buildXml()));
      await pob.openLiveSearch('build-1', rowByLabel(first(pob), 'Rise of the Phoenix'));
      expect(openUrl.mock.calls[0][0]).toMatch(
        /^https:\/\/www\.pathofexile\.com\/trade\/search\/Standard\/[A-Za-z0-9_-]+\/live$/,
      );
    });

    it('存回目前頁面的搜尋：之後開啟改用該代碼與目前聯盟，還原預設會清掉', async () => {
      const pob = usePobBuild('poe1', deps);
      await pob.importCode(toCode(buildXml()));
      const code = await encodeQueryToGzipBase64Url({ status: { option: 'online' }, type: 'X' });
      currentUrl = `https://www.pathofexile.com/trade/search/Hardcore/${code}`;

      expect(pob.saveCurrentSearch('build-1', rowByLabel(first(pob), 'Rise of the Phoenix'))).toBe(
        true,
      );
      await flush();
      const phoenix = rowByLabel(first(pob), 'Rise of the Phoenix');
      expect(phoenix).toMatchObject({ searchOverride: true, searchCustomized: true });
      expect(stored()[0].searchOverrides).toEqual({ [phoenix.key]: code });
      expect(showToast).toHaveBeenLastCalledWith(
        '已存回「Rise of the Phoenix」，之後開啟都會用這個搜尋',
      );

      pob.openSearch('build-1', phoenix, 'current');
      expect(navigate).toHaveBeenLastCalledWith(
        `https://www.pathofexile.com/trade/search/Standard/${code}`,
      );
      await pob.sendToLiveSearch('build-1', phoenix);
      expect(codeOf(enqueueLiveSearch.mock.calls[0][0].items[0].url)).toBe(code);

      pob.resetSearch('build-1', phoenix.key);
      await flush();
      expect(rowByLabel(first(pob), 'Rise of the Phoenix').searchOverride).toBe(false);
      expect(stored()[0].searchOverrides).toEqual({});
    });

    it('目前頁面不是同版本、gzip 代碼的搜尋時不存回', async () => {
      const pob = usePobBuild('poe1', deps);
      await pob.importCode(toCode(buildXml()));
      const phoenix = rowByLabel(first(pob), 'Rise of the Phoenix');
      const code = await encodeQueryToGzipBase64Url({ type: 'X' });

      for (const url of [
        'https://www.pathofexile.com/trade/search/Standard',
        'https://www.pathofexile.com/trade/search/Standard/abc123',
        `https://www.pathofexile.com/trade2/search/poe2/Standard/${code}`,
      ]) {
        currentUrl = url;
        expect(pob.saveCurrentSearch('build-1', phoenix)).toBe(false);
      }
      expect(showToast).toHaveBeenLastCalledWith(
        '目前頁面不是可存回的市集搜尋，請先在同一遊戲版本的市集執行搜尋',
        'error',
      );
      expect(stored()[0].searchOverrides).toEqual({});
    });

    it('更新代碼時清掉已不存在項目的存回搜尋', async () => {
      const pob = usePobBuild('poe1', deps);
      await pob.importCode(toCode(buildXml()));
      currentUrl = `https://www.pathofexile.com/trade/search/Standard/${await encodeQueryToGzipBase64Url({ type: 'X' })}`;
      pob.saveCurrentSearch('build-1', rowByLabel(first(pob), 'Not On Trade'));
      await flush();
      expect(Object.keys(stored()[0].searchOverrides)).toHaveLength(1);

      const updated = buildXml().replace('<Slot itemId="2" name="Helmet"/>', '');
      await pob.updateCode('build-1', toCode(updated));
      expect(stored()[0].searchOverrides).toEqual({});
    });

    it('加入書籤帶入項目名與代碼網址，失敗時提示', async () => {
      const pob = usePobBuild('poe1', deps);
      await pob.importCode(toCode(buildXml()));
      const phoenix = rowByLabel(first(pob), 'Rise of the Phoenix');

      expect(await pob.listBookmarkFolders()).toEqual([{ id: 'g1', name: 'PoB', depth: 0 }]);
      expect(await pob.addToBookmarks('build-1', phoenix, 'g1')).toBe(true);
      const input = bookmarkAdd.mock.calls[0][0];
      expect(input).toMatchObject({ groupId: 'g1', name: 'Rise of the Phoenix' });
      expect(await decodeGzipBase64UrlToQuery(codeOf(input.url))).toEqual(phoenix.query);
      expect(showToast).toHaveBeenLastCalledWith('已加入書籤：Rise of the Phoenix', 'default');

      bookmarkAdd.mockResolvedValueOnce({ ok: false });
      expect(await pob.addToBookmarks('build-1', phoenix, 'g1')).toBe(false);
      expect(showToast).toHaveBeenLastCalledWith('加入書籤失敗，請稍後再試', 'error');
    });
  });

  describe('開啟搜尋', () => {
    it('預設在目前頁面開啟；也可以在新分頁開啟', async () => {
      const pob = usePobBuild('poe1', deps);
      await pob.importCode(toCode(buildXml()));
      const phoenix = rowByLabel(first(pob), 'Rise of the Phoenix');

      expect(pob.openSearch('build-1', phoenix, 'current')).toBe(true);
      const url = new URL(navigate.mock.calls[0][0] as string);
      expect(url.origin + url.pathname).toBe('https://www.pathofexile.com/trade/search/Standard');
      expect(JSON.parse(url.searchParams.get('q') ?? '').query).toEqual({
        status: { option: 'securable' },
        name: 'Rise of the Phoenix',
        type: 'Mosaic Kite Shield',
      });
      expect(openUrl).not.toHaveBeenCalled();

      expect(pob.openSearch('build-1', phoenix, 'new-tab')).toBe(true);
      expect(openUrl).toHaveBeenCalledWith(navigate.mock.calls[0][0]);
      expect(navigate).toHaveBeenCalledTimes(1);
    });

    it('無法搜尋的項目、頁面沒有聯盟時不開啟', async () => {
      const pob = usePobBuild('poe1', deps);
      await pob.importCode(toCode(buildXml()));

      expect(pob.openSearch('build-1', rowByLabel(first(pob), 'Not On Trade'), 'current')).toBe(
        false,
      );
      getLeague.mockReturnValue(undefined);
      expect(
        pob.openSearch('build-1', rowByLabel(first(pob), 'Rise of the Phoenix'), 'current'),
      ).toBe(false);

      expect(navigate).not.toHaveBeenCalled();
      expect(pob.errorKey.value).toBe('pobBuild.error.noLeague');
    });
  });

  describe('物品圖片', () => {
    it('依物品圖片對照給圖片與背包尺寸：傳奇用自己的圖、尺寸取底材；查不到的沒有圖片', async () => {
      const pob = usePobBuild('poe1', deps);
      await pob.importCode(toCode(buildXml()));
      await flush();
      expect(rowByLabel(first(pob), 'Rise of the Phoenix')).toMatchObject({
        icon: `${ART_CDN}Armours/Shields/RiseOfThePhoenix.png`,
        iconSize: { width: 2, height: 3 },
      });
      expect(rowByLabel(first(pob), 'Punishment').icon).toBe(`${ART_CDN}Gems/Punishment.png`);
      expect(rowByLabel(first(pob), 'Not On Trade').icon).toBeUndefined();
    });

    it('送進主控台與加入書籤時以物品圖片當封面', async () => {
      const pob = usePobBuild('poe1', deps);
      await pob.importCode(toCode(buildXml()));
      await flush();
      const phoenix = rowByLabel(first(pob), 'Rise of the Phoenix');
      await pob.addToBookmarks('build-1', phoenix, 'g1');
      expect(bookmarkAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          coverImageUrl: `${ART_CDN}Armours/Shields/RiseOfThePhoenix.png`,
        }),
      );
    });

    it('物品圖片對照載不到時清單照常顯示', async () => {
      const pob = usePobBuild('poe1', {
        ...deps,
        dataLoader: makeDataLoader({ loadItemArt: async () => undefined }),
      });
      await pob.importCode(toCode(buildXml()));
      await flush();
      expect(rowByLabel(first(pob), 'Rise of the Phoenix').icon).toBeUndefined();
    });

    it('resolveSearchUrl 可供 <a href> 中鍵原生開新分頁；沒有聯盟時不報錯', async () => {
      const pob = usePobBuild('poe1', deps);
      await pob.importCode(toCode(buildXml()));
      const build = first(pob);
      const rare = rowByLabel(build, 'Rise of the Phoenix');

      expect(pob.resolveSearchUrl(build.id, rare)).toContain(
        'https://www.pathofexile.com/trade/search/Standard?q=',
      );
      getLeague.mockReturnValue(undefined);
      expect(pob.resolveSearchUrl(build.id, rare)).toBeUndefined();
      expect(pob.errorKey.value).toBeNull();
    });
  });
});
