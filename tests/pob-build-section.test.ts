// @vitest-environment happy-dom
import { deflateSync } from 'node:zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  usePobBuild,
  type BuildView,
  type UsePobBuild,
  type UsePobBuildDeps,
} from '@/components/sidebar/pob-build/usePobBuild';
import {
  createPobBuildStore,
  pobBuildsStorageKey,
  type PobBuildStorage,
  type StoredPobBuild,
} from '@/utils/pob-build-store';
import { createPendingIconStore, type PendingIcon } from '@/utils/pob-icon-pending';
import { createModLineTranslator } from '@/utils/pob-mod-translator';
import { createTradeNameCatalog } from '@/utils/pob-shopping-list';
import { createStatMatcher } from '@/utils/pob-stat-matcher';

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

describe('usePobBuild', () => {
  let storage: ReturnType<typeof createMemoryStorage>;
  let deps: UsePobBuildDeps;
  let loadCatalog: ReturnType<typeof vi.fn>;
  let loadMatcher: ReturnType<typeof vi.fn>;
  let loadModTranslator: ReturnType<typeof vi.fn>;
  let getLeague: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;
  let openUrl: ReturnType<typeof vi.fn>;
  let savePending: ReturnType<typeof vi.fn>;
  let pendingToTake: PendingIcon | undefined;
  let emitResultImages: ((images: string[]) => void) | undefined;
  let nextId: number;

  const stored = () => (storage.data[pobBuildsStorageKey('poe1')] ?? []) as StoredPobBuild[];
  const first = (pob: UsePobBuild): BuildView => pob.builds.value[0];
  const labels = (build: BuildView) =>
    build.groups.flatMap((group) => group.rows.map((row) => row.label));
  const rowByLabel = (build: BuildView, label: string) =>
    build.groups.flatMap((group) => group.rows).find((row) => row.label === label)!;

  beforeEach(() => {
    storage = createMemoryStorage();
    nextId = 0;
    pendingToTake = undefined;
    emitResultImages = undefined;
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
    savePending = vi.fn();
    deps = {
      store: createPobBuildStore('poe1', {
        storage,
        now: () => 1234,
        createId: () => `build-${++nextId}`,
      }),
      pendingIcon: { save: savePending as never, take: async () => pendingToTake },
      loadCatalog: loadCatalog as never,
      loadMatcher: loadMatcher as never,
      loadModTranslator: loadModTranslator as never,
      getDisplayLocale: () => 'zh-TW',
      getPageLocale: () => 'en',
      getLeague: getLeague as never,
      getOrigin: () => 'https://www.pathofexile.com',
      navigate: navigate as never,
      openUrl: openUrl as never,
      onResultImages: (listener) => {
        emitResultImages = listener;
        return () => {
          emitResultImages = undefined;
        };
      },
    };
  });

  describe('匯入與多份 build', () => {
    it('匯入後顯示匯出當下選用的套裝，依類別分組，並存到本機', async () => {
      const pob = usePobBuild('poe1', deps);
      expect(await pob.importCode(`  ${toCode(buildXml())}\n`)).toBe(true);

      const build = first(pob);
      expect(build).toMatchObject({
        id: 'build-1',
        name: 'Chieftain Lv.97',
        collapsed: false,
        itemSetId: '1',
        itemSetOptions: [
          { id: '1', title: 'Endgame', position: 1 },
          { id: '2', title: 'Leveling', position: 2 },
        ],
        progress: { done: 0, total: 4 },
        removedCount: 0,
      });
      expect(build.groups.map((group) => [group.kind, group.rows.length])).toEqual([
        ['unique', 3],
        ['gem', 1],
      ]);
      expect(loadCatalog).toHaveBeenCalledWith('poe1', 'en');
      expect(stored()).toEqual([
        {
          id: 'build-1',
          name: 'Chieftain Lv.97',
          code: toCode(buildXml()),
          importedAt: 1234,
          collapsed: false,
          done: [],
          removed: [],
          icons: {},
        },
      ]);
      expect(pob.errorKey.value).toBeNull();
    });

    it('再匯入一份會並存，新的排在最前面，各自的進度互不影響', async () => {
      const pob = usePobBuild('poe1', deps);
      await pob.importCode(toCode(buildXml()));
      await pob.importCode(toCode(buildXml({ ascendancy: 'Juggernaut' })));

      expect(pob.builds.value.map((build) => build.name)).toEqual([
        'Juggernaut Lv.97',
        'Chieftain Lv.97',
      ]);
      // 名稱資料只載入一次（頁面區服與顯示語言各一份），第二次匯入不重複載入
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

      const reopened = usePobBuild('poe1', deps);
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

      const reopened = usePobBuild('poe1', deps);
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
        status: { option: 'online' },
        type: 'Plate Vest',
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

      expect(labels(first(pob))).toEqual(["Xoph's Heart", 'Plate Vest', 'Punishment']);
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
        status: { option: 'online' },
        type: 'Plate Vest',
        stats: [{ type: 'and', filters: [{ id: 'explicit.stat_3299347043', value: { min: 80 } }] }],
      });
      expect(plate.rarity).toBe('RARE');
      expect(plate.mods).toEqual([
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
      expect(plate.mods).toEqual([
        { text: '+100 最大生命', kind: 'explicit', searched: true },
        { text: '+20 最大生命', kind: 'crafted', searched: false },
      ]);
      expect(plate.query).toMatchObject({
        stats: [{ filters: [{ id: 'explicit.stat_3299347043', value: { min: 80 } }] }],
      });
    });

    it('名稱以顯示語言呈現，搜尋仍用頁面區服的名稱', async () => {
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
      expect(labels(first(pob))).toEqual(['索伏之心', '鍍金鎧甲', '懲戒']);
      expect(rowByLabel(first(pob), '索伏之心').query).toMatchObject({
        name: "Xoph's Heart",
        type: 'Amber Amulet',
      });
      expect(rowByLabel(first(pob), '鍍金鎧甲').query).toMatchObject({ type: 'Plate Vest' });
    });

    it('顯示語言的名稱資料載不到、或該名稱沒有譯名時，維持頁面區服的名稱', async () => {
      loadCatalog.mockImplementation(async (_version: string, locale: string) => {
        if (locale !== 'en') throw new Error('HTTP 404');
        return createTradeNameCatalog({ englishItems: ['Plate Vest', 'Punishment'] });
      });
      const pob = usePobBuild('poe1', deps);
      expect(await pob.importCode(toCode(buildXml()))).toBe(true);
      pob.selectItemSet('build-1', '2');
      expect(labels(first(pob))).toContain('Plate Vest');
    });

    it('顯示語言與頁面區服相同時不重複載入名稱資料', async () => {
      const sameLocale = usePobBuild('poe1', { ...deps, getDisplayLocale: () => 'en' });
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

  describe('開啟搜尋', () => {
    it('預設在目前頁面開啟；也可以在新分頁開啟', async () => {
      const pob = usePobBuild('poe1', deps);
      await pob.importCode(toCode(buildXml()));
      const phoenix = rowByLabel(first(pob), 'Rise of the Phoenix');

      expect(pob.openSearch('build-1', phoenix, 'current')).toBe(true);
      const url = new URL(navigate.mock.calls[0][0] as string);
      expect(url.origin + url.pathname).toBe('https://www.pathofexile.com/trade/search/Standard');
      expect(JSON.parse(url.searchParams.get('q') ?? '').query).toEqual({
        status: { option: 'online' },
        name: 'Rise of the Phoenix',
        type: 'Mosaic Kite Shield',
      });
      expect(openUrl).not.toHaveBeenCalled();

      expect(pob.openSearch('build-1', phoenix, 'new-tab')).toBe(true);
      expect(openUrl).toHaveBeenCalledWith(navigate.mock.calls[0][0]);
      expect(navigate).toHaveBeenCalledTimes(1);
    });

    it('換頁前先記下這次搜尋屬於哪個項目', async () => {
      const pob = usePobBuild('poe1', deps);
      await pob.importCode(toCode(buildXml()));
      const phoenix = rowByLabel(first(pob), 'Rise of the Phoenix');

      pob.openSearch('build-1', phoenix, 'current');
      expect(savePending).toHaveBeenCalledWith(
        { buildId: 'build-1', entryKey: phoenix.key },
        'current',
        navigate.mock.calls[0][0],
      );
      expect(savePending.mock.invocationCallOrder[0]).toBeLessThan(
        navigate.mock.invocationCallOrder[0],
      );
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
      expect(savePending).not.toHaveBeenCalled();
      expect(pob.errorKey.value).toBe('pobBuild.error.noLeague');
    });
  });

  describe('從搜尋結果擷取圖片', () => {
    it('頁面是從某個項目開啟的搜尋時，第一張合法的結果圖片成為該項目的圖片', async () => {
      const original = usePobBuild('poe1', deps);
      await original.importCode(toCode(buildXml()));
      const phoenixKey = rowByLabel(first(original), 'Rise of the Phoenix').key;
      pendingToTake = { buildId: 'build-1', entryKey: phoenixKey };

      const reopened = usePobBuild('poe1', deps);
      await reopened.restore();
      expect(rowByLabel(first(reopened), 'Rise of the Phoenix').icon).toBeUndefined();

      emitResultImages?.([]);
      emitResultImages?.(['https://evil.example/x.png', ICON, 'https://web.poecdn.com/other.png']);
      await flush();

      expect(rowByLabel(first(reopened), 'Rise of the Phoenix').icon).toBe(ICON);
      expect(stored()[0].icons).toEqual({ [phoenixKey]: ICON });
      // 只取一次，之後的結果（例如翻頁）不再覆蓋
      expect(emitResultImages).toBeUndefined();
    });

    it('沒有待領取的項目時不訂閱結果圖片', async () => {
      const original = usePobBuild('poe1', deps);
      await original.importCode(toCode(buildXml()));

      const reopened = usePobBuild('poe1', deps);
      await reopened.restore();
      expect(emitResultImages).toBeUndefined();
    });

    it('元件卸載時停止等待', async () => {
      const original = usePobBuild('poe1', deps);
      await original.importCode(toCode(buildXml()));
      pendingToTake = { buildId: 'build-1', entryKey: 'whatever' };

      const reopened = usePobBuild('poe1', deps);
      await reopened.restore();
      expect(emitResultImages).toBeDefined();
      reopened.dispose();
      expect(emitResultImages).toBeUndefined();
    });
  });
});

describe('createPendingIconStore', () => {
  const pending = { buildId: 'b1', entryKey: 'k1' };
  const searchUrl = 'https://www.pathofexile.com/trade/search/Standard?q=%7B%22a%22%3A1%7D';

  function setup(pageUrl: string) {
    const sessionData = new Map<string, string>();
    const localData: Record<string, unknown> = {};
    let now = 1_000_000;
    const store = createPendingIconStore('poe1', {
      session: {
        getItem: (key) => sessionData.get(key) ?? null,
        setItem: (key, value) => void sessionData.set(key, value),
        removeItem: (key) => void sessionData.delete(key),
      },
      local: {
        get: async (keys) =>
          Object.fromEntries(keys.filter((k) => k in localData).map((k) => [k, localData[k]])),
        set: async (values) => void Object.assign(localData, values),
        remove: async (keys) => keys.forEach((key) => delete localData[key]),
      },
      now: () => now,
      getPageUrl: () => pageUrl,
    });
    return { store, sessionData, localData, advance: (ms: number) => (now += ms) };
  }

  it('目前分頁：同一個分頁領取一次', async () => {
    const { store } = setup('https://www.pathofexile.com/trade/search/Standard/abc');
    store.save(pending, 'current', searchUrl);
    expect(await store.take()).toEqual(pending);
    expect(await store.take()).toBeUndefined();
  });

  it('新分頁：只有網址帶著同一個 q 的分頁領得到', async () => {
    const other = setup('https://www.pathofexile.com/trade/search/Standard/other');
    other.store.save(pending, 'new-tab', searchUrl);
    await Promise.resolve();
    expect(await other.store.take()).toBeUndefined();

    const target = setup(searchUrl);
    Object.assign(target.localData, other.localData);
    expect(await target.store.take()).toEqual(pending);
    expect(await target.store.take()).toBeUndefined();
  });

  it('超過兩分鐘就不再領取', async () => {
    const { store, advance } = setup('https://www.pathofexile.com/trade/search/Standard/abc');
    store.save(pending, 'current', searchUrl);
    advance(2 * 60 * 1000 + 1);
    expect(await store.take()).toBeUndefined();
  });
});
