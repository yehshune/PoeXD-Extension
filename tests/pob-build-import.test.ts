// @vitest-environment happy-dom
import { deflateSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PobBuildError, parsePobBuildXml } from '@/utils/pob-build';
import { PobBuildCodeError, decodePobBuildCode } from '@/utils/pob-build-code';
import {
  buildShoppingList,
  buildTradeSearchUrl,
  createTradeNameCatalog,
  loadTradeNameCatalog,
} from '@/utils/pob-shopping-list';

// 結構取自 PoB Community 與 PoB PoE 2 的實際匯出檔（內容為測試用的精簡版）
const buildXml = (
  options: { root?: string; activeItemSet?: string } = {},
) => `<?xml version="1.0" encoding="UTF-8"?>
<${options.root ?? 'PathOfBuilding'}>
	<Build ascendClassName="Chieftain" className="Marauder" level="97" targetVersion="3_0">
		<PlayerStat stat="Life" value="5000"/>
	</Build>
	<Items activeItemSet="${options.activeItemSet ?? '1'}">
		<Item id="1">
			Rarity: RARE
Soul Joy
Crimson Jewel
Unique ID: 75fd5ab5
Item Level: 70
Implicits: 0
7% increased maximum Life
			<ModRange id="1" range="0.5"/>
		</Item>
		<Item id="2">
			Rarity: UNIQUE
Rise of the Phoenix
Mosaic Kite Shield
Unique ID: abc
Implicits: 0
+8% to maximum Fire Resistance
		</Item>
		<Item id="3">
			Rarity: MAGIC
Flagellant&apos;s Amethyst Flask of the Owl
Unique ID: 287f
Item Level: 84
		</Item>
		<Item id="4">
			Rarity: UNIQUE
Foulborn Xoph&apos;s Heart
Amber Amulet
		</Item>
		<Item id="5">
			Rarity: RARE
Unused Spare
Vaal Regalia
		</Item>
		<ItemSet id="1">
			<Slot itemId="2" itemPbURL="" name="Weapon 2"/>
			<Slot itemId="0" itemPbURL="" name="Weapon 2 Swap"/>
			<Slot itemId="3" itemPbURL="" name="Flask 1"/>
			<Slot itemId="4" itemPbURL="" name="Amulet"/>
		</ItemSet>
		<ItemSet id="2">
			<Slot itemId="5" itemPbURL="" name="Body Armour"/>
		</ItemSet>
	</Items>
	<Skills activeSkillSet="1">
		<SkillSet id="1">
			<Skill enabled="true" label="Explode" source="Explode">
				<Gem enabled="true" level="1" nameSpec="" quality="0" skillId="EnemyExplode"/>
			</Skill>
			<Skill enabled="true" slot="Gloves">
				<Gem enabled="true" gemId="Metadata/Items/Gems/SkillGemPunishment" level="20" nameSpec="Punishment" quality="0"/>
				<Gem enabled="true" gemId="Metadata/Items/Gems/SupportGemLifetap" level="1" nameSpec="Lifetap" quality="0"/>
				<Gem enabled="true" gemId="Metadata/Items/Gems/SupportGemBlessedCall" level="20" nameSpec="Blessed Call" quality="20"/>
				<Gem enabled="false" gemId="Metadata/Items/Gems/SkillGemDisabled" level="20" nameSpec="Disabled Gem" quality="0"/>
			</Skill>
			<Skill enabled="true" slot="Weapon 1">
				<Gem enabled="true" gemId="Metadata/Items/Gems/SupportGemLifetap" level="1" nameSpec="Lifetap" quality="0"/>
			</Skill>
			<Skill enabled="false" slot="Boots">
				<Gem enabled="true" gemId="Metadata/Items/Gems/SkillGemOff" level="20" nameSpec="Skill Off" quality="0"/>
			</Skill>
		</SkillSet>
	</Skills>
	<Tree activeSpec="1">
		<Spec>
			<URL>https://example.invalid/tree</URL>
			<Sockets>
				<Socket itemId="1" nodeId="26196"/>
				<Socket itemId="0" nodeId="7960"/>
			</Sockets>
		</Spec>
	</Tree>
</${options.root ?? 'PathOfBuilding'}>`;

const toCode = (xml: string) =>
  deflateSync(Buffer.from(xml, 'utf8')).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');

const ENGLISH_ITEMS = [
  'Crimson Jewel',
  'Rise of the Phoenix',
  'Mosaic Kite Shield',
  'Amethyst Flask',
  "Xoph's Heart",
  'Amber Amulet',
  'Punishment',
  'Lifetap Support',
  'Blessed Call Support',
  'Flask',
];
const TW_ITEMS = [
  '緋紅珠寶',
  '鳳凰之昇',
  '馬賽克鳶盾',
  '紫晶藥劑',
  '索伏之心',
  '琥珀護身符',
  '懲戒',
  '賭血輔助',
  '神聖呼喚輔助',
  '藥劑',
];

describe('decodePobBuildCode', () => {
  it('解出 base64url + zlib 的 XML，忽略代碼中的空白與換行', async () => {
    const xml = buildXml();
    const code = toCode(xml);
    expect(await decodePobBuildCode(code)).toBe(xml);
    expect(await decodePobBuildCode(`  ${code.slice(0, 40)}\n${code.slice(40)}  `)).toBe(xml);
  });

  it('空白、非 base64、不是 zlib 資料時丟出對應錯誤', async () => {
    await expect(decodePobBuildCode('   ')).rejects.toMatchObject({ code: 'empty' });
    await expect(decodePobBuildCode('not a code!')).rejects.toMatchObject({ code: 'invalid' });
    await expect(decodePobBuildCode('aGVsbG8gd29ybGQ')).rejects.toBeInstanceOf(PobBuildCodeError);
    await expect(decodePobBuildCode('a'.repeat(400_001))).rejects.toMatchObject({
      code: 'too-large',
    });
  });
});

describe('parsePobBuildXml', () => {
  it('讀出角色摘要、目前裝備組的裝備與天賦樹珠寶', () => {
    const build = parsePobBuildXml(buildXml());
    expect(build).toMatchObject({
      gameVersion: 'poe1',
      className: 'Marauder',
      ascendancy: 'Chieftain',
      level: 97,
    });
    expect(build.items).toEqual([
      {
        slot: 'Weapon 2',
        rarity: 'UNIQUE',
        name: 'Rise of the Phoenix',
        baseType: 'Mosaic Kite Shield',
      },
      { slot: 'Flask 1', rarity: 'MAGIC', name: "Flagellant's Amethyst Flask of the Owl" },
      { slot: 'Amulet', rarity: 'UNIQUE', name: "Foulborn Xoph's Heart", baseType: 'Amber Amulet' },
      { slot: 'Jewel', rarity: 'RARE', name: 'Soul Joy', baseType: 'Crimson Jewel' },
    ]);
  });

  it('只取目前技能組中啟用的寶石，略過裝備給的技能並去除重複', () => {
    expect(parsePobBuildXml(buildXml()).gems).toEqual([
      { name: 'Punishment', level: 20, quality: 0, support: false },
      { name: 'Lifetap', level: 1, quality: 0, support: true },
      { name: 'Blessed Call', level: 20, quality: 20, support: true },
    ]);
  });

  it('依 activeItemSet 選裝備組，依根元素判斷遊戲版本', () => {
    const build = parsePobBuildXml(buildXml({ root: 'PathOfBuilding2', activeItemSet: '2' }));
    expect(build.gameVersion).toBe('poe2');
    expect(build.items[0]).toMatchObject({ slot: 'Body Armour', baseType: 'Vaal Regalia' });
  });

  it('不是 PoB build 或 XML 壞掉時丟出錯誤', () => {
    expect(() => parsePobBuildXml('<Other><Build/></Other>')).toThrow(PobBuildError);
    expect(() => parsePobBuildXml('<PathOfBuilding></PathOfBuilding>')).toThrow(PobBuildError);
    expect(() => parsePobBuildXml('<PathOfBuilding><Build>')).toThrow(PobBuildError);
  });
});

describe('buildShoppingList', () => {
  const build = parsePobBuildXml(buildXml());

  it('英文頁面：傳奇用名稱加基底、其餘用基底、寶石帶等級與品質下限', () => {
    const list = buildShoppingList(build, createTradeNameCatalog({ englishItems: ENGLISH_ITEMS }));
    expect(list).toEqual([
      {
        kind: 'unique',
        label: 'Rise of the Phoenix',
        slot: 'Weapon 2',
        query: {
          status: { option: 'online' },
          name: 'Rise of the Phoenix',
          type: 'Mosaic Kite Shield',
        },
      },
      {
        kind: 'unique',
        label: "Xoph's Heart",
        slot: 'Amulet',
        query: { status: { option: 'online' }, name: "Xoph's Heart", type: 'Amber Amulet' },
      },
      {
        kind: 'equipment',
        label: 'Amethyst Flask',
        slot: 'Flask 1',
        query: { status: { option: 'online' }, type: 'Amethyst Flask' },
      },
      {
        kind: 'equipment',
        label: 'Crimson Jewel',
        slot: 'Jewel',
        query: { status: { option: 'online' }, type: 'Crimson Jewel' },
      },
      {
        kind: 'gem',
        label: 'Punishment',
        level: 20,
        quality: 0,
        query: {
          status: { option: 'online' },
          type: 'Punishment',
          filters: { misc_filters: { filters: { gem_level: { min: 20 } } } },
        },
      },
      {
        kind: 'gem',
        label: 'Lifetap Support',
        level: 1,
        quality: 0,
        query: { status: { option: 'online' }, type: 'Lifetap Support' },
      },
      {
        kind: 'gem',
        label: 'Blessed Call Support',
        level: 20,
        quality: 20,
        query: {
          status: { option: 'online' },
          type: 'Blessed Call Support',
          filters: { misc_filters: { filters: { gem_level: { min: 20 }, quality: { min: 20 } } } },
        },
      },
    ]);
  });

  it('在地化頁面：名稱換成該區服的市集名稱', () => {
    const list = buildShoppingList(
      build,
      createTradeNameCatalog({ englishItems: ENGLISH_ITEMS, localizedItems: TW_ITEMS }),
    );
    expect(list[0]).toMatchObject({
      label: '鳳凰之昇',
      query: { name: '鳳凰之昇', type: '馬賽克鳶盾' },
    });
    expect(list.find((entry) => entry.slot === 'Flask 1')?.query).toEqual({
      status: { option: 'online' },
      type: '紫晶藥劑',
    });
    expect(list.at(-1)?.query).toMatchObject({ type: '神聖呼喚輔助' });
  });

  it('對不到市集名稱的項目仍列出，但沒有搜尋', () => {
    const list = buildShoppingList(
      build,
      createTradeNameCatalog({ englishItems: ['Amber Amulet'] }),
    );
    expect(list[0]).toEqual({
      kind: 'unique',
      label: 'Rise of the Phoenix',
      slot: 'Weapon 2',
      query: null,
    });
    expect(list.find((entry) => entry.kind === 'gem')).toMatchObject({
      label: 'Punishment',
      query: null,
    });
  });

  it('PoE 2 的技能寶石不在市集交易，不列入', () => {
    const poe2 = parsePobBuildXml(buildXml({ root: 'PathOfBuilding2' }));
    const list = buildShoppingList(poe2, createTradeNameCatalog({ englishItems: ENGLISH_ITEMS }));
    expect(list.some((entry) => entry.kind === 'gem')).toBe(false);
    expect(list.length).toBe(4);
  });
});

describe('buildTradeSearchUrl', () => {
  const query = { status: { option: 'online' }, type: '紫晶藥劑' };

  it('PoE 1 與 PoE 2 的路徑不同，聯盟與查詢都做編碼', () => {
    const poe1 = buildTradeSearchUrl({
      origin: 'https://pathofexile.tw',
      version: 'poe1',
      league: '巫影密會',
      query,
    });
    const url = new URL(poe1);
    expect(url.pathname).toBe(`/trade/search/${encodeURIComponent('巫影密會')}`);
    expect(JSON.parse(url.searchParams.get('q') ?? '')).toEqual({ query, sort: { price: 'asc' } });

    expect(
      new URL(
        buildTradeSearchUrl({
          origin: 'https://www.pathofexile.com',
          version: 'poe2',
          league: 'Forbidden Rites',
          query,
        }),
      ).pathname,
    ).toBe('/trade2/search/poe2/Forbidden%20Rites');
  });
});

describe('loadTradeNameCatalog：隨擴充發佈的資料分片', () => {
  const loadJson = async (path: string) =>
    JSON.parse(await readFile(resolve(__dirname, '../public', path), 'utf8')) as unknown;

  it('PoE 1 英文：輔助寶石與魔法藥劑基底都對得到', async () => {
    const catalog = await loadTradeNameCatalog(loadJson, { version: 'poe1', locale: 'en' });
    expect(catalog.toTradeName('Lifetap Support')).toBe('Lifetap Support');
    expect(catalog.toTradeName('Lifetap')).toBeUndefined();
    expect(catalog.findBaseType("Flagellant's Amethyst Flask of the Owl")).toBe('Amethyst Flask');
  });

  it('PoE 1 台服與 PoE 2 英文可載入', async () => {
    const tw = await loadTradeNameCatalog(loadJson, { version: 'poe1', locale: 'zh-TW' });
    expect(tw.toTradeName('Opal Wand')).toBe('靈石法杖');
    const poe2 = await loadTradeNameCatalog(loadJson, { version: 'poe2', locale: 'en' });
    expect(poe2.toTradeName('Heart of the Well')).toBe('Heart of the Well');
  });
});
