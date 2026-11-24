// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { parsePobBuildXml } from '@/utils/pob-build';
import {
  cloneEntrySearchSelection,
  normalizeSearchDefaults,
  normalizeSelectionForEntry,
  resolveEntrySearch,
} from '@/utils/pob-entry-search';
import {
  buildShoppingList,
  createTradeNameCatalog,
  type ShoppingEntry,
} from '@/utils/pob-shopping-list';
import { createStatMatcher } from '@/utils/pob-stat-matcher';

// 取自國際服 trade-stats.json（節錄）
const matcher = createStatMatcher({
  modLines: {},
  tradeStats: {
    'implicit.stat_2133341901': '#% of Physical Damage Converted to Cold Damage',
    'implicit.stat_1661253443': 'Non-Vaal Strike Skills target # additional nearby Enemy',
    'implicit.stat_3299347043': '+# to maximum Life',
    'explicit.stat_3299347043': '+# to maximum Life',
    'enchant.stat_3299347043': '+# to maximum Life',
    'explicit.stat_2238019079':
      'Regenerate # Energy Shield per second while a Rare or Unique Enemy is within 6 metres',
    'explicit.effect_1255519432': 'Grants Level # Enduring Cry',
  },
});

const xml = `<?xml version="1.0"?>
<PathOfBuilding>
	<Build className="Duelist" ascendClassName="Slayer" level="100" targetVersion="3_0"/>
	<Items activeItemSet="1">
		<Item id="1">
			Rarity: RARE
Bramble Fist
Legion Gloves
Armour: 145
ArmourBasePercentile: 0.99
Searing Exarch Item
Eater of Worlds Item
Implicits: 2
10% of Physical Damage Converted to Cold Damage
Non-Vaal Strike Skills target 1 additional nearby Enemy
+101 to maximum Life
		</Item>
		<Item id="2">
			Rarity: RARE
Vortex Brow
Paladin Crown
Implicits: 3
{crafted}+20 to maximum Life
{exarch}+30 to maximum Life
{eater}10% of Physical Damage Converted to Cold Damage
+90 to maximum Life
		</Item>
		<Item id="3">
			Rarity: RARE
Plain Loop
Leather Belt
Implicits: 1
+30 to maximum Life
Regenerate 150 Energy Shield per second while a Rare or Unique Enemy is Nearby
Grants Level 22 Enduring Cry Skill
		</Item>
		<Item id="4">
			Rarity: UNIQUE
Kaom's Heart
Glorious Plate
Implicits: 0
+500 to maximum Life
		</Item>
		<ItemSet id="1">
			<Slot itemId="1" name="Gloves"/>
			<Slot itemId="2" name="Helmet"/>
			<Slot itemId="3" name="Belt"/>
			<Slot itemId="4" name="Body Armour"/>
		</ItemSet>
	</Items>
</PathOfBuilding>`;

const build = parsePobBuildXml(xml);
const list = buildShoppingList(
  build,
  createTradeNameCatalog({
    englishItems: [
      'Legion Gloves',
      'Paladin Crown',
      'Leather Belt',
      "Kaom's Heart",
      'Glorious Plate',
    ],
  }),
  {},
  matcher,
);
const entry = (label: string): ShoppingEntry => list.find((item) => item.label === label)!;
const searched = (label: string) =>
  entry(label).mods!.map((mod) => [mod.text, mod.stat?.id, mod.searched]);

describe('Eldritch 固定詞綴：預設不帶入搜尋', () => {
  it('物品標了 Searing Exarch／Eater of Worlds 時，固定詞綴標為 eldritch', () => {
    const gloves = build.itemSets[0].items.find((item) => item.slot === 'Gloves')!;
    expect(gloves.implicitMods.map((mod) => mod.eldritch)).toEqual([true, true]);
    expect(gloves.explicitMods[0].eldritch).toBeUndefined();
  });

  it('{exarch}／{eater} 標記的固定詞綴是 eldritch，附魔不是', () => {
    const helmet = build.itemSets[0].items.find((item) => item.slot === 'Helmet')!;
    expect(helmet.implicitMods.map((mod) => [mod.text, mod.crafted, mod.eldritch])).toEqual([
      ['+20 to maximum Life', true, undefined],
      ['+30 to maximum Life', false, true],
      ['10% of Physical Damage Converted to Cold Damage', false, true],
    ]);
  });

  it('Eldritch 固定詞綴對得到代碼但預設不勾，一般詞綴照常帶入', () => {
    expect(searched('Legion Gloves')).toEqual([
      ['10% of Physical Damage Converted to Cold Damage', 'implicit.stat_2133341901', false],
      [
        'Non-Vaal Strike Skills target 1 additional nearby Enemy',
        'implicit.stat_1661253443',
        false,
      ],
      ['+101 to maximum Life', 'explicit.stat_3299347043', true],
    ]);
    expect(entry('Legion Gloves').query).toMatchObject({
      stats: [{ type: 'and', filters: [{ id: 'explicit.stat_3299347043' }] }],
    });
  });

  it('沒有 Eldritch 標記的一般固定詞綴照常帶入', () => {
    expect(searched('Leather Belt')[0]).toEqual([
      '+30 to maximum Life',
      'implicit.stat_3299347043',
      true,
    ]);
  });
});

describe('稀有度：非傳奇裝備只搜非傳奇', () => {
  it('以基底搜尋時帶入非傳奇條件', () => {
    expect(entry('Legion Gloves').query).toMatchObject({
      type: 'Legion Gloves',
      filters: { type_filters: { filters: { rarity: { option: 'nonunique' } } } },
    });
  });

  it('以類別搜尋時，類別與非傳奇條件放在同一個區塊', () => {
    expect(
      resolveEntrySearch(entry('Legion Gloves'), { searchBy: 'category' }).query,
    ).toMatchObject({
      filters: {
        type_filters: {
          filters: { category: { option: 'armour.gloves' }, rarity: { option: 'nonunique' } },
        },
      },
    });
  });

  it('傳奇不帶稀有度條件', () => {
    const query = entry("Kaom's Heart").query as Record<string, unknown>;
    expect(query).toMatchObject({ name: "Kaom's Heart" });
    expect(query).not.toHaveProperty('filters');
  });
});

describe('PoB 舊寫法與市集寫法不同的詞綴', () => {
  it('「Rare or Unique Enemy is Nearby」對到改寫後的「within 6 metres」', () => {
    expect(
      matcher.match(
        'Regenerate 150 Energy Shield per second while a Rare or Unique Enemy is Nearby',
        { preferLocal: false },
      ),
    ).toEqual({ statId: 'explicit.stat_2238019079', value: 150 });
  });

  it('「Grants Level N … Skill」對到市集沒有 Skill 結尾的寫法', () => {
    expect(matcher.match('Grants Level 22 Enduring Cry Skill', { preferLocal: false })).toEqual({
      statId: 'explicit.effect_1255519432',
      value: 22,
    });
  });
});

describe('build 整體設定：防禦數值下限', () => {
  const defenceXml = (root: 'PathOfBuilding' | 'PathOfBuilding2') => `<?xml version="1.0"?>
<${root}>
	<Build className="Marauder" level="100" targetVersion="3_0"/>
	<Items activeItemSet="1">
		<Item id="1">
			Rarity: RARE
Plague Touch
Titan Gauntlets
Armour: 553
ArmourBasePercentile: 0.27
Energy Shield: 40
Implicits: 0
+40 to maximum Energy Shield
		</Item>
		<Item id="2">
			Rarity: RARE
Agony Loop
Amethyst Ring
Implicits: 0
+50 to maximum Life
		</Item>
		<ItemSet id="1">
			<Slot itemId="1" name="Gloves"/>
			<Slot itemId="2" name="Ring 1"/>
		</ItemSet>
	</Items>
</${root}>`;
  const listOf = (root: 'PathOfBuilding' | 'PathOfBuilding2') =>
    buildShoppingList(
      parsePobBuildXml(defenceXml(root)),
      createTradeNameCatalog({ englishItems: ['Titan Gauntlets', 'Amethyst Ring'] }),
      {},
      matcher,
    );
  const gloves = listOf('PathOfBuilding').find((item) => item.label === 'Titan Gauntlets')!;
  const ring = listOf('PathOfBuilding').find((item) => item.label === 'Amethyst Ring')!;

  it('解析 PoB 的防禦數值；項目只記基底有的防禦（詞綴加的能量護盾不算）', () => {
    const item = parsePobBuildXml(defenceXml('PathOfBuilding')).itemSets[0].items[0];
    expect(item.defenceValues).toEqual({ ar: 553, es: 40 });
    expect(gloves.defences).toEqual({ section: 'armour_filters', values: { ar: 553 } });
    expect(ring.defences).toBeUndefined();
  });

  it('預設不帶防禦下限', () => {
    expect(gloves.query).not.toHaveProperty('filters.armour_filters');
  });

  it('開啟後依詞綴數值比例帶入下限', () => {
    expect(resolveEntrySearch(gloves, undefined, { defenceMin: true }).query).toMatchObject({
      filters: { armour_filters: { filters: { ar: { min: 442 } } } },
    });
    expect(
      resolveEntrySearch(gloves, undefined, { defenceMin: true, statPercent: 50 }).query,
    ).toMatchObject({ filters: { armour_filters: { filters: { ar: { min: 276 } } } } });
    expect(resolveEntrySearch(ring, undefined, { defenceMin: true }).query).not.toHaveProperty(
      'filters.armour_filters',
    );
  });

  it('和類別搜尋的防禦條件合併：基底有的防禦改成數值下限，沒有的維持 0', () => {
    expect(
      resolveEntrySearch(gloves, { searchBy: 'category' }, { defenceMin: true }).query,
    ).toMatchObject({
      filters: {
        armour_filters: {
          filters: { ar: { min: 442 }, ev: { max: 0 }, es: { max: 0 }, ward: { max: 0 } },
        },
      },
    });
  });

  it('PoE 2 的防禦條件放在 equipment_filters', () => {
    const poe2 = listOf('PathOfBuilding2').find((item) => item.label === 'Titan Gauntlets')!;
    expect(resolveEntrySearch(poe2, undefined, { defenceMin: true }).query).toMatchObject({
      filters: { equipment_filters: { filters: { ar: { min: 442 } } } },
    });
  });

  it('整體設定只存開啟時的值', () => {
    expect(normalizeSearchDefaults({ defenceMin: false })).toEqual({});
    expect(normalizeSearchDefaults({ defenceMin: true })).toEqual({ defenceMin: true });
  });
});

describe('build 整體設定：預設改用總和詞綴', () => {
  const belt = () => entry('Leather Belt');

  it('build 預設開啟時，沒調整過的項目改用總和；單件可以關掉', () => {
    expect(resolveEntrySearch(belt()).pseudo).toBe(false);
    const defaultOn = resolveEntrySearch(belt(), undefined, { pseudo: true });
    expect(defaultOn.pseudo).toBe(true);
    expect(resolveEntrySearch(belt(), { pseudo: false }, { pseudo: true }).pseudo).toBe(false);
    const query = defaultOn.query as {
      stats: { filters: { id: string }[] }[];
    };
    const ids = query.stats[0].filters.map((filter) => filter.id);
    expect(ids).toContain('pseudo.pseudo_total_life');
    // 固定詞綴決定基底種類，合併時仍保留成獨立條件
    expect(ids).toContain('implicit.stat_3299347043');
    expect(query.stats[0].filters[0]).toEqual({
      id: 'pseudo.pseudo_total_life',
      value: { min: 24 },
    });
  });

  it('單件設定等於 build 預設時不存', () => {
    expect(normalizeSelectionForEntry(belt(), { pseudo: true }, { pseudo: true })).toBeUndefined();
    expect(normalizeSelectionForEntry(belt(), { pseudo: false }, { pseudo: true })).toEqual({
      pseudo: false,
    });
    expect(normalizeSelectionForEntry(belt(), { pseudo: false })).toBeUndefined();
    expect(cloneEntrySearchSelection({ pseudo: false })).toEqual({ pseudo: false });
  });

  it('整體設定只存開啟時的值', () => {
    expect(normalizeSearchDefaults({ pseudo: false })).toEqual({});
    expect(normalizeSearchDefaults({ pseudo: true })).toEqual({ pseudo: true });
  });
});

describe('PoB 傳奇資料庫的多重變體（看守之眼）', () => {
  // 看守之眼有上百行變體詞綴，選到的光環詞綴可能在很後面；主變體與兩個替代變體各選一條
  const fillers = Array.from(
    { length: 60 },
    (_, index) => `{variant:${index + 2}}+${index + 1} to Strength while affected by Anger`,
  );
  const watcherXml = `<?xml version="1.0"?>
<PathOfBuilding>
	<Build className="Duelist" level="100" targetVersion="3_0"/>
	<Items activeItemSet="1">
		<Item id="1">
			Rarity: UNIQUE
Watcher's Eye
Prismatic Jewel
Variant: None
Selected Variant: 70
Has Alt Variant: true
Selected Alt Variant: 63
Has Alt Variant Two: true
Selected Alt Variant Two: 1
Limited to: 1
Implicits: 0
{range:0.5}(4-6)% increased maximum Energy Shield
${fillers.join('\n')}
{variant:63}{range:0.5}(10-15)% increased Cast Speed while affected by Zealotry
{variant:70}{range:0.5}(40-60)% increased Attack Damage while affected by Precision
{variant:71}{range:0.5}+(30-50)% to Critical Strike Multiplier while affected by Anger
		</Item>
		<ItemSet id="1">
			<Slot itemId="1" name="Jewel 1"/>
		</ItemSet>
	</Items>
</PathOfBuilding>`;

  it('列出所有選用變體的詞綴，不受前面上百行變體影響', () => {
    const [item] = parsePobBuildXml(watcherXml).itemSets[0].items;
    expect(item.explicitMods.map((mod) => mod.text)).toEqual([
      '5% increased maximum Energy Shield',
      '13% increased Cast Speed while affected by Zealotry',
      '50% increased Attack Damage while affected by Precision',
    ]);
  });
});
