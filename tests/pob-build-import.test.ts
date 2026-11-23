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
  migrateLegacyGemKeys,
  slotRank,
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
		<Item id="6">
			Rarity: RARE
Early Gem
Viridian Jewel
		</Item>
		<ItemSet id="1" title="Endgame">
			<Slot itemId="2" itemPbURL="" name="Weapon 2"/>
			<Slot itemId="0" itemPbURL="" name="Weapon 2 Swap"/>
			<Slot itemId="3" itemPbURL="" name="Flask 1"/>
			<Slot itemId="4" itemPbURL="" name="Amulet"/>
		</ItemSet>
		<ItemSet id="2" title="Leveling">
			<Slot itemId="5" itemPbURL="" name="Body Armour"/>
			<Slot itemId="4" itemPbURL="" name="Amulet"/>
		</ItemSet>
	</Items>
	<Skills activeSkillSet="1">
		<SkillSet id="1" title="Endgame">
			<Skill enabled="true" label="Explode" source="Explode">
				<Gem enabled="true" level="1" nameSpec="" quality="0" skillId="EnemyExplode"/>
			</Skill>
			<Skill enabled="true" slot="Gloves">
				<Gem enabled="true" gemId="Metadata/Items/Gems/SkillGemPunishment" level="20" nameSpec="Punishment" quality="0"/>
				<Gem enabled="true" gemId="Metadata/Items/Gems/SupportGemLifetap" level="1" nameSpec="Lifetap" quality="0"/>
				<Gem enabled="true" gemId="Metadata/Items/Gems/SupportGemBlessedCall" level="20" nameSpec="Blessed Call" quality="20"/>
			</Skill>
			<Skill enabled="true">
				<Gem enabled="false" gemId="Metadata/Items/Gems/SkillGemDisabled" level="20" nameSpec="Disabled Gem" quality="0"/>
			</Skill>
			<Skill enabled="true" slot="Weapon 1">
				<Gem enabled="true" gemId="Metadata/Items/Gems/SupportGemLifetap" level="1" nameSpec="Lifetap" quality="0"/>
			</Skill>
			<Skill enabled="false">
				<Gem enabled="true" gemId="Metadata/Items/Gems/SkillGemOff" level="20" nameSpec="Skill Off" quality="0"/>
			</Skill>
		</SkillSet>
		<SkillSet id="2" title="Leveling">
			<Skill enabled="true" slot="Body Armour">
				<Gem enabled="true" gemId="Metadata/Items/Gems/SkillGemPunishment" level="8" nameSpec="Punishment" quality="0"/>
			</Skill>
		</SkillSet>
	</Skills>
	<Tree activeSpec="1">
		<Spec title="Endgame">
			<URL>https://example.invalid/tree</URL>
			<Sockets>
				<Socket itemId="1" nodeId="26196"/>
				<Socket itemId="0" nodeId="7960"/>
			</Sockets>
		</Spec>
		<Spec title="Leveling">
			<Sockets>
				<Socket itemId="6" nodeId="26196"/>
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
  'Vaal Regalia',
  'Viridian Jewel',
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
  '瓦爾法衣',
  '翠綠珠寶',
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
  it('讀出角色摘要與每一組裝備套裝的裝備', () => {
    const build = parsePobBuildXml(buildXml());
    expect(build).toMatchObject({
      gameVersion: 'poe1',
      className: 'Marauder',
      ascendancy: 'Chieftain',
      level: 97,
      activeItemSetId: '1',
      activeSkillSetId: '1',
      activeTreeSpecId: '1',
    });
    expect(build.itemSets).toMatchObject([
      {
        id: '1',
        title: 'Endgame',
        items: [
          {
            slot: 'Weapon 2',
            rarity: 'UNIQUE',
            name: 'Rise of the Phoenix',
            baseType: 'Mosaic Kite Shield',
          },
          { slot: 'Flask 1', rarity: 'MAGIC', name: "Flagellant's Amethyst Flask of the Owl" },
          {
            slot: 'Amulet',
            rarity: 'UNIQUE',
            name: "Foulborn Xoph's Heart",
            baseType: 'Amber Amulet',
          },
        ],
      },
      {
        id: '2',
        title: 'Leveling',
        items: [
          { slot: 'Body Armour', rarity: 'RARE', name: 'Unused Spare', baseType: 'Vaal Regalia' },
          {
            slot: 'Amulet',
            rarity: 'UNIQUE',
            name: "Foulborn Xoph's Heart",
            baseType: 'Amber Amulet',
          },
        ],
      },
    ]);
  });

  it('每份天賦樹各自記錄插上的珠寶，以順序當 id', () => {
    expect(parsePobBuildXml(buildXml()).treeSpecs).toMatchObject([
      {
        id: '1',
        title: 'Endgame',
        jewels: [{ slot: 'Jewel', rarity: 'RARE', name: 'Soul Joy', baseType: 'Crimson Jewel' }],
      },
      {
        id: '2',
        title: 'Leveling',
        jewels: [{ slot: 'Jewel', rarity: 'RARE', name: 'Early Gem', baseType: 'Viridian Jewel' }],
      },
    ]);
  });

  it('沒插在裝備上的寶石只取啟用的，略過裝備給的技能；不同連結各用一顆的寶石各列一次', () => {
    const gloves = (name: string, level: number, quality: number, support: boolean) => ({
      name,
      level,
      quality,
      support,
      slot: 'Gloves',
      skill: 'Punishment',
    });
    expect(parsePobBuildXml(buildXml()).skillSets).toEqual([
      {
        id: '1',
        title: 'Endgame',
        gems: [
          gloves('Punishment', 20, 0, false),
          gloves('Lifetap', 1, 0, true),
          gloves('Blessed Call', 20, 20, true),
          // 只有輔助寶石的連線以第一顆寶石命名
          {
            name: 'Lifetap',
            level: 1,
            quality: 0,
            support: true,
            slot: 'Weapon 1',
            skill: 'Lifetap',
          },
        ],
      },
      {
        id: '2',
        title: 'Leveling',
        gems: [
          {
            name: 'Punishment',
            level: 8,
            quality: 0,
            support: false,
            slot: 'Body Armour',
            skill: 'Punishment',
          },
        ],
      },
    ]);
  });

  it('插在裝備上的寶石即使在 PoB 停用（手動施放等）也實際佔著插槽，照樣列出', () => {
    const xml = buildXml().replace(
      '<Skill enabled="true" slot="Weapon 1">',
      `<Skill enabled="false" slot="Helmet">
				<Gem enabled="false" gemId="Metadata/Items/Gems/SkillGemSteelskin" level="20" nameSpec="Steelskin" quality="20"/>
			</Skill>
			<Skill enabled="true" slot="Weapon 1">`,
    );
    expect(parsePobBuildXml(xml).skillSets[0].gems).toContainEqual({
      name: 'Steelskin',
      level: 20,
      quality: 20,
      support: false,
      slot: 'Helmet',
      skill: 'Steelskin',
    });
  });

  it('記下匯出當下選用的套裝；屬性對不到時退回第一組；依根元素判斷遊戲版本', () => {
    const build = parsePobBuildXml(buildXml({ root: 'PathOfBuilding2', activeItemSet: '2' }));
    expect(build.gameVersion).toBe('poe2');
    expect(build.activeItemSetId).toBe('2');
    expect(parsePobBuildXml(buildXml({ activeItemSet: '99' })).activeItemSetId).toBe('1');
  });

  it('沒有任何套裝的 build 也能解析', () => {
    const build = parsePobBuildXml(
      '<PathOfBuilding><Build className="Witch" level="1"/></PathOfBuilding>',
    );
    expect(build).toMatchObject({
      itemSets: [],
      skillSets: [],
      treeSpecs: [],
      activeItemSetId: '',
    });
  });

  it('不是 PoB build 或 XML 壞掉時丟出錯誤', () => {
    expect(() => parsePobBuildXml('<Other><Build/></Other>')).toThrow(PobBuildError);
    expect(() => parsePobBuildXml('<PathOfBuilding></PathOfBuilding>')).toThrow(PobBuildError);
    expect(() => parsePobBuildXml('<PathOfBuilding><Build>')).toThrow(PobBuildError);
  });
});

/** 非傳奇裝備的搜尋都帶「非傳奇」稀有度條件 */
const NON_UNIQUE = { type_filters: { filters: { rarity: { option: 'nonunique' } } } };

describe('buildShoppingList', () => {
  const build = parsePobBuildXml(buildXml());

  it('英文頁面：傳奇用名稱加基底、其餘用基底、寶石帶等級與品質下限', () => {
    const list = buildShoppingList(build, createTradeNameCatalog({ englishItems: ENGLISH_ITEMS }));
    expect(
      list.map(
        ({
          key: _key,
          mods: _mods,
          rarity: _rarity,
          englishName: _englishName,
          searchBase: _searchBase,
          artBase: _artBase,
          ...rest
        }) => rest,
      ),
    ).toEqual([
      {
        kind: 'unique',
        count: 1,
        label: 'Rise of the Phoenix',
        slot: 'Weapon 2',
        query: {
          status: { option: 'securable' },
          name: 'Rise of the Phoenix',
          type: 'Mosaic Kite Shield',
        },
      },
      {
        kind: 'unique',
        count: 1,
        label: "Xoph's Heart",
        foulborn: true,
        slot: 'Amulet',
        query: { status: { option: 'securable' }, name: "Xoph's Heart", type: 'Amber Amulet' },
      },
      {
        kind: 'equipment',
        count: 1,
        label: 'Amethyst Flask',
        slot: 'Flask 1',
        query: { status: { option: 'securable' }, type: 'Amethyst Flask', filters: NON_UNIQUE },
      },
      {
        kind: 'equipment',
        count: 1,
        label: 'Crimson Jewel',
        slot: 'Jewel',
        query: { status: { option: 'securable' }, type: 'Crimson Jewel', filters: NON_UNIQUE },
      },
      {
        kind: 'gem',
        count: 1,
        label: 'Lifetap Support',
        gemGroup: { id: 'Weapon 1', slot: 'Weapon 1' },
        level: 1,
        quality: 0,
        query: { status: { option: 'securable' }, type: 'Lifetap Support' },
      },
      {
        kind: 'gem',
        count: 1,
        label: 'Punishment',
        gemGroup: { id: 'Gloves', slot: 'Gloves' },
        level: 20,
        quality: 0,
        query: {
          status: { option: 'securable' },
          type: 'Punishment',
          filters: { misc_filters: { filters: { gem_level: { min: 20 } } } },
        },
      },
      {
        kind: 'gem',
        count: 1,
        label: 'Lifetap Support',
        gemGroup: { id: 'Gloves', slot: 'Gloves' },
        level: 1,
        quality: 0,
        query: { status: { option: 'securable' }, type: 'Lifetap Support' },
      },
      {
        kind: 'gem',
        count: 1,
        label: 'Blessed Call Support',
        gemGroup: { id: 'Gloves', slot: 'Gloves' },
        level: 20,
        quality: 20,
        query: {
          status: { option: 'securable' },
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
      status: { option: 'securable' },
      type: '紫晶藥劑',
      filters: NON_UNIQUE,
    });
    expect(list.at(-1)?.query).toMatchObject({ type: '神聖呼喚輔助' });
  });

  it('對不到市集名稱的項目仍列出，但沒有搜尋', () => {
    const list = buildShoppingList(
      build,
      createTradeNameCatalog({ englishItems: ['Amber Amulet'] }),
    );
    expect(list[0]).toMatchObject({
      kind: 'unique',
      label: 'Rise of the Phoenix',
      slot: 'Weapon 2',
      query: null,
    });
    expect(list.find((entry) => entry.kind === 'gem')).toMatchObject({
      label: 'Lifetap',
      query: null,
    });
  });

  it('PoE 2 的寶石也列入；武器預設技能與昇華技能不是道具，略過', () => {
    const xml = buildXml({ root: 'PathOfBuilding2' }).replace(
      '<Skill enabled="true" slot="Weapon 1">',
      `<Skill enabled="true">
				<Gem enabled="true" gemId="Metadata/Items/Gem/SkillGemPlayerDefaultSpearThrow" level="20" nameSpec="Spear Throw" quality="0"/>
				<Gem enabled="true" gemId="Metadata/Items/Gems/SkillGemAscendancyVirtuousBarrier" level="20" nameSpec="Virtuous Barrier" quality="0"/>
			</Skill>
			<Skill enabled="true">
				<Gem enabled="true" gemId="Metadata/Items/Gem/SkillGemPlayerDefaultSpearThrow" level="20" nameSpec="Spear Throw" quality="0"/>
				<Gem enabled="true" gemId="Metadata/Items/Gems/SupportGemAmbush" level="1" nameSpec="Ambush" quality="0"/>
			</Skill>
			<Skill enabled="true" slot="Weapon 1">`,
    );
    const poe2 = parsePobBuildXml(xml);
    const list = buildShoppingList(poe2, createTradeNameCatalog({ englishItems: ENGLISH_ITEMS }));
    const gems = list.filter((entry) => entry.kind === 'gem').map((entry) => entry.englishName);
    expect(gems).toContain('Punishment');
    expect(gems).not.toContain('Spear Throw');
    expect(gems).not.toContain('Virtuous Barrier');
    // 預設技能不列入，但連在它上面的輔助寶石要買，連線仍以預設技能命名
    expect(list.find((entry) => entry.englishName === 'Ambush')?.gemGroup).toMatchObject({
      skill: 'Spear Throw',
    });
    // PoE 2 的輔助寶石插在技能寶石上：技能寶石的插槽數下限是連結的輔助寶石數
    const punishment = list.find((entry) => entry.englishName === 'Punishment');
    expect(punishment?.gemSockets).toBe(2);
    expect(punishment?.searchBase).toMatchObject({
      filters: { misc_filters: { filters: { gem_sockets: { min: 2 } } } },
    });
  });

  it('可指定裝備套裝與技能組；珠寶取自同標題的天賦樹', () => {
    const catalog = createTradeNameCatalog({ englishItems: ENGLISH_ITEMS });
    const list = buildShoppingList(build, catalog, { itemSetId: '2', skillSetId: '2' });
    expect(list.map((entry) => [entry.kind, entry.slot ?? entry.level, entry.label])).toEqual([
      ['equipment', 'Body Armour', 'Vaal Regalia'],
      ['unique', 'Amulet', "Xoph's Heart"],
      ['equipment', 'Jewel', 'Viridian Jewel'],
      ['gem', 8, 'Punishment'],
    ]);
  });

  it('裝備套裝與技能組可以分開選；指定不存在的套裝時用匯出當下那一組', () => {
    const catalog = createTradeNameCatalog({ englishItems: ENGLISH_ITEMS });
    const mixed = buildShoppingList(build, catalog, { itemSetId: '2' });
    expect(mixed.filter((entry) => entry.kind === 'gem').length).toBe(4);
    expect(mixed.some((entry) => entry.label === 'Vaal Regalia')).toBe(true);

    const fallback = buildShoppingList(build, catalog, { itemSetId: 'missing' });
    expect(fallback).toEqual(buildShoppingList(build, catalog));
  });

  it('同一件裝備在不同套裝是同一個 key，不同項目的 key 不重複', () => {
    const catalog = createTradeNameCatalog({ englishItems: ENGLISH_ITEMS });
    const endgame = buildShoppingList(build, catalog, { itemSetId: '1', skillSetId: '1' });
    const leveling = buildShoppingList(build, catalog, { itemSetId: '2', skillSetId: '2' });
    const amuletKey = (list: typeof endgame) => list.find((entry) => entry.slot === 'Amulet')?.key;

    expect(amuletKey(endgame)).toBe(amuletKey(leveling));
    expect(new Set(endgame.map((entry) => entry.key)).size).toBe(endgame.length);
    // 同名但等級不同的寶石是不同項目
    expect(endgame.find((entry) => entry.label === 'Punishment')?.key).not.toBe(
      leveling.find((entry) => entry.label === 'Punishment')?.key,
    );
  });
});

describe('buildTradeSearchUrl', () => {
  const query = { status: { option: 'securable' }, type: '紫晶藥劑' };

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

describe('清單排序與寶石分組', () => {
  it('部位依主手、副手、頭部、胸甲、手套、鞋子、項鍊、戒指、腰帶、藥劑排序，珠寶最後', () => {
    const slots = [
      'Jewel',
      'Flask 2',
      'Belt Abyssal Socket 1',
      'Ring 2',
      'Belt',
      'Flask 1',
      'Amulet',
      'Ring 1',
      'Boots',
      'Gloves',
      'Unknown Slot',
      'Body Armour',
      'Helmet',
      'Weapon 2',
      'Weapon 1',
    ];
    expect([...slots].sort((left, right) => slotRank(left) - slotRank(right))).toEqual([
      'Weapon 1',
      'Weapon 2',
      'Helmet',
      'Body Armour',
      'Gloves',
      'Boots',
      'Amulet',
      'Ring 1',
      'Ring 2',
      'Belt',
      'Belt Abyssal Socket 1',
      'Flask 1',
      'Flask 2',
      'Unknown Slot',
      'Jewel',
    ]);
  });

  const skillsXml = `<PathOfBuilding>
	<Build className="Witch" level="90"/>
	<Skills activeSkillSet="1">
		<SkillSet id="1">
			<Skill enabled="true" slot="Helmet">
				<Gem enabled="true" gemId="Metadata/Items/Gems/SkillGemArc" level="20" nameSpec="Arc" quality="0"/>
				<Gem enabled="true" gemId="Metadata/Items/Gems/SupportGemLifetap" level="1" nameSpec="Lifetap" quality="0"/>
			</Skill>
			<Skill enabled="true" label="Auras">
				<Gem enabled="true" gemId="Metadata/Items/Gems/SkillGemClarity" level="20" nameSpec="Clarity" quality="0"/>
			</Skill>
			<Skill enabled="true">
				<Gem enabled="true" gemId="Metadata/Items/Gems/SupportGemLifetap" level="1" nameSpec="Lifetap" quality="0"/>
				<Gem enabled="true" gemId="Metadata/Items/Gems/SkillGemFrostblink" level="20" nameSpec="Frostblink" quality="0"/>
			</Skill>
			<Skill enabled="true" slot="Helmet">
				<Gem enabled="true" gemId="Metadata/Items/Gems/SupportGemLifetap" level="1" nameSpec="Lifetap" quality="0"/>
			</Skill>
			<Skill enabled="true" slot="Weapon 1">
				<Gem enabled="true" gemId="Metadata/Items/Gems/SkillGemArc" level="20" nameSpec="Arc" quality="0"/>
			</Skill>
		</SkillSet>
	</Skills>
</PathOfBuilding>`;

  it('同一部位的寶石一組（相同寶石合併計數），沒有部位的以連線為一組並排在最後', () => {
    const build = parsePobBuildXml(skillsXml);
    const list = buildShoppingList(build, createTradeNameCatalog({ englishItems: [] }));
    expect(list.map((entry) => [entry.gemGroup?.id, entry.label, entry.count])).toEqual([
      ['Weapon 1', 'Arc', 1],
      ['Helmet', 'Arc', 1],
      ['Helmet', 'Lifetap', 2],
      ['link:Auras', 'Clarity', 1],
      // 沒有標籤的連線以第一顆主動寶石命名
      ['link:Frostblink', 'Lifetap', 1],
      ['link:Frostblink', 'Frostblink', 1],
    ]);
    expect(list.find((entry) => entry.label === 'Clarity')?.gemGroup).toEqual({
      id: 'link:Auras',
      skill: 'Auras',
    });
    expect(new Set(list.map((entry) => entry.key)).size).toBe(list.length);
  });

  it('舊版不分組的寶石 key 換成每個分組各一個，其他 key 原樣保留', () => {
    const build = parsePobBuildXml(skillsXml);
    const list = buildShoppingList(build, createTradeNameCatalog({ englishItems: [] }));
    const keyOf = (group: string, label: string) =>
      list.find((entry) => entry.gemGroup?.id === group && entry.label === label)?.key;
    const legacyLifetap = ['gem', 'Lifetap', 1, 0].join('\u0000');
    const legacyArc = ['gem', 'Arc', 20, 0].join('\u0000');

    expect(migrateLegacyGemKeys(build, [legacyLifetap, 'item-key', legacyArc])).toEqual([
      keyOf('Helmet', 'Lifetap'),
      keyOf('link:Frostblink', 'Lifetap'),
      'item-key',
      keyOf('Helmet', 'Arc'),
      keyOf('Weapon 1', 'Arc'),
    ]);
    const migrated = migrateLegacyGemKeys(build, [legacyLifetap]);
    expect(migrateLegacyGemKeys(build, migrated)).toEqual(migrated);
  });
});

describe('插槽與圖片底材', () => {
  it('保留 PoB 的插槽文字；傳奇記下英文底材', () => {
    const build = parsePobBuildXml(`<PathOfBuilding>
	<Build className="Marauder" level="90" targetVersion="3_0"/>
	<Items activeItemSet="1">
		<Item id="1">
			Rarity: UNIQUE
Rise of the Phoenix
Mosaic Kite Shield
Sockets: r-g  b
Implicits: 0
		</Item>
		<ItemSet id="1"><Slot itemId="1" name="Weapon 2"/></ItemSet>
	</Items>
	<Skills/>
</PathOfBuilding>`);
    expect(build.itemSets[0].items[0].sockets).toBe('R-G B');
    const [entry] = buildShoppingList(
      build,
      createTradeNameCatalog({ englishItems: ENGLISH_ITEMS }),
    );
    expect(entry).toMatchObject({ artBase: 'Mosaic Kite Shield', sockets: 'R-G B' });
  });
});

describe('汙染、穢生與插槽內容物', () => {
  const itemXml = (body: string, root = 'PathOfBuilding') => `<${root}>
	<Build className="Marauder" level="90" targetVersion="3_0"/>
	<Items activeItemSet="1">
		<Item id="1">
${body}
		</Item>
		<ItemSet id="1"><Slot itemId="1" name="Body Armour"/></ItemSet>
	</Items>
	<Skills/>
</${root}>`;

  it('記下汙染（含二次汙染）；二次汙染那一行不算詞綴', () => {
    const [corrupted] = parsePobBuildXml(
      itemXml(`Rarity: RARE
Doom Shell
Astral Plate
Implicits: 0
+50 to maximum Life
Twice Corrupted`),
    ).itemSets[0].items;
    expect(corrupted.corrupted).toBe(true);
    expect(corrupted.explicitMods.map((mod) => mod.text)).toEqual(['+50 to maximum Life']);
    const [clean] = parsePobBuildXml(
      itemXml(`Rarity: RARE
Doom Shell
Astral Plate
Implicits: 0`),
    ).itemSets[0].items;
    expect(clean).not.toHaveProperty('corrupted');
  });

  it('穢生傳奇記下旗標，清單項目沿用一般名稱並標示穢生與汙染', () => {
    const build = parsePobBuildXml(
      itemXml(`Rarity: UNIQUE
Foulborn Rise of the Phoenix
Mosaic Kite Shield
Implicits: 0
Corrupted`),
    );
    expect(build.itemSets[0].items[0]).toMatchObject({ foulborn: true, corrupted: true });
    const [entry] = buildShoppingList(
      build,
      createTradeNameCatalog({ englishItems: ENGLISH_ITEMS }),
    );
    expect(entry).toMatchObject({
      englishName: 'Rise of the Phoenix',
      foulborn: true,
      corrupted: true,
    });
  });

  it('PoE 2 的 `Rune:` 行依序記成插槽內容物', () => {
    const build = parsePobBuildXml(
      itemXml(
        `Rarity: RARE
Doom Shell
Expert Hexer's Robe
Sockets: S S
Rune: Thrud&apos;s Might
Rune: Soul Core of Quipolatl
Implicits: 1
{enchant}{rune}6% increased Attack Speed`,
        'PathOfBuilding2',
      ),
    );
    expect(build.itemSets[0].items[0].socketed).toEqual([
      "Thrud's Might",
      'Soul Core of Quipolatl',
    ]);
  });
});
