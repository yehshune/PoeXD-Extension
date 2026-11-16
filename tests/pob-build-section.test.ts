// @vitest-environment happy-dom
import { deflateSync } from 'node:zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePobBuild, type UsePobBuildDeps } from '@/components/sidebar/pob-build/usePobBuild';
import {
  createPobBuildStore,
  pobBuildStorageKey,
  type PobBuildStorage,
} from '@/utils/pob-build-store';
import { createTradeNameCatalog } from '@/utils/pob-shopping-list';

const buildXml = (root = 'PathOfBuilding') => `<?xml version="1.0" encoding="UTF-8"?>
<${root}>
	<Build ascendClassName="Chieftain" className="Marauder" level="97" targetVersion="3_0"/>
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
		<ItemSet id="1">
			<Slot itemId="1" name="Weapon 2"/>
			<Slot itemId="2" name="Helmet"/>
		</ItemSet>
	</Items>
	<Skills activeSkillSet="1">
		<SkillSet id="1">
			<Skill enabled="true">
				<Gem enabled="true" gemId="Metadata/Items/Gems/SkillGemPunishment" level="20" nameSpec="Punishment" quality="0"/>
			</Skill>
		</SkillSet>
	</Skills>
</${root}>`;

const toCode = (xml: string) =>
  deflateSync(Buffer.from(xml, 'utf8')).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');

function createMemoryStorage(): PobBuildStorage & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: async (keys) => Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]])),
    set: async (values) => {
      Object.assign(data, values);
    },
    remove: async (keys) => {
      keys.forEach((key) => delete data[key]);
    },
  };
}

describe('usePobBuild', () => {
  let storage: ReturnType<typeof createMemoryStorage>;
  let deps: UsePobBuildDeps;
  let loadCatalog: ReturnType<typeof vi.fn>;
  let getLeague: ReturnType<typeof vi.fn>;
  let openUrl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    storage = createMemoryStorage();
    loadCatalog = vi.fn().mockResolvedValue(
      createTradeNameCatalog({
        englishItems: ['Rise of the Phoenix', 'Mosaic Kite Shield', 'Punishment'],
      }),
    );
    getLeague = vi.fn().mockReturnValue('Standard');
    openUrl = vi.fn();
    deps = {
      store: createPobBuildStore('poe1', { storage, now: () => 1234 }),
      loadCatalog: loadCatalog as unknown as UsePobBuildDeps['loadCatalog'],
      getPageLocale: () => 'en',
      getLeague: getLeague as unknown as UsePobBuildDeps['getLeague'],
      getOrigin: () => 'https://www.pathofexile.com',
      openUrl: openUrl as unknown as UsePobBuildDeps['openUrl'],
    };
  });

  it('匯入後依類別分組，並把代碼存到本機', async () => {
    const pob = usePobBuild('poe1', deps);
    expect(await pob.importCode(`  ${toCode(buildXml())}\n`)).toBe(true);

    expect(pob.build.value).toMatchObject({ ascendancy: 'Chieftain', level: 97 });
    expect(pob.groups.value.map((group) => [group.kind, group.entries.length])).toEqual([
      ['unique', 2],
      ['gem', 1],
    ]);
    expect(loadCatalog).toHaveBeenCalledWith('poe1', 'en');
    expect(storage.data[pobBuildStorageKey('poe1')]).toEqual({
      code: toCode(buildXml()),
      importedAt: 1234,
    });
    expect(pob.errorKey.value).toBeNull();
  });

  it('代碼無效時回報錯誤，原本的 build 與儲存不受影響', async () => {
    const pob = usePobBuild('poe1', deps);
    await pob.importCode(toCode(buildXml()));

    expect(await pob.importCode('not a code!')).toBe(false);
    expect(pob.errorKey.value).toBe('tools.pobBuild.error.invalid');
    expect(pob.build.value?.level).toBe(97);
    expect(storage.data[pobBuildStorageKey('poe1')]).toMatchObject({ code: toCode(buildXml()) });

    expect(await pob.importCode('   ')).toBe(false);
    expect(pob.errorKey.value).toBe('tools.pobBuild.error.empty');
  });

  it('另一個遊戲版本的代碼不匯入', async () => {
    const pob = usePobBuild('poe1', deps);
    expect(await pob.importCode(toCode(buildXml('PathOfBuilding2')))).toBe(false);
    expect(pob.errorKey.value).toBe('tools.pobBuild.error.versionMismatch');
    expect(pob.build.value).toBeNull();
    expect(storage.data).toEqual({});
  });

  it('物品名稱資料載入失敗時回報錯誤且不儲存', async () => {
    loadCatalog.mockRejectedValue(new Error('HTTP 404'));
    const pob = usePobBuild('poe1', deps);
    expect(await pob.importCode(toCode(buildXml()))).toBe(false);
    expect(pob.errorKey.value).toBe('tools.pobBuild.error.catalog');
    expect(storage.data).toEqual({});
  });

  it('開啟搜尋：用目前頁面的來源與聯盟組網址', async () => {
    const pob = usePobBuild('poe1', deps);
    await pob.importCode(toCode(buildXml()));
    const [phoenix, notOnTrade] = pob.groups.value[0].entries;

    expect(pob.openSearch(phoenix)).toBe(true);
    const url = new URL(openUrl.mock.calls[0][0] as string);
    expect(url.origin + url.pathname).toBe('https://www.pathofexile.com/trade/search/Standard');
    expect(JSON.parse(url.searchParams.get('q') ?? '').query).toEqual({
      status: { option: 'online' },
      name: 'Rise of the Phoenix',
      type: 'Mosaic Kite Shield',
    });

    expect(pob.openSearch(notOnTrade)).toBe(false);
    expect(openUrl).toHaveBeenCalledTimes(1);
  });

  it('頁面沒有聯盟時不開啟並說明', async () => {
    getLeague.mockReturnValue(undefined);
    const pob = usePobBuild('poe1', deps);
    await pob.importCode(toCode(buildXml()));

    expect(pob.openSearch(pob.groups.value[0].entries[0])).toBe(false);
    expect(openUrl).not.toHaveBeenCalled();
    expect(pob.errorKey.value).toBe('tools.pobBuild.error.noLeague');
  });

  it('重新開啟時讀回上次匯入的 build；清除後不再讀回', async () => {
    await usePobBuild('poe1', deps).importCode(toCode(buildXml()));

    const reopened = usePobBuild('poe1', deps);
    await reopened.restore();
    expect(reopened.build.value?.ascendancy).toBe('Chieftain');

    await reopened.clear();
    expect(reopened.build.value).toBeNull();
    expect(reopened.groups.value).toEqual([]);
    expect(storage.data).toEqual({});

    const afterClear = usePobBuild('poe1', deps);
    await afterClear.restore();
    expect(afterClear.build.value).toBeNull();
  });

  it('讀回失敗時維持空白、不顯示錯誤', async () => {
    storage.data[pobBuildStorageKey('poe1')] = { code: 'broken!', importedAt: 1 };
    const pob = usePobBuild('poe1', deps);
    await pob.restore();
    expect(pob.build.value).toBeNull();
    expect(pob.errorKey.value).toBeNull();
  });
});
