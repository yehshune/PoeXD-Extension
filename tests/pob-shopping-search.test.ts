// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { parsePobBuildXml } from '@/utils/pob-build';
import {
  applyEntrySelection,
  buildEntryQuery,
  buildShoppingList,
  createTradeNameCatalog,
  defaultStatBounds,
  entryStatFilters,
  pseudoContributions,
  type ShoppingEntry,
} from '@/utils/pob-shopping-list';
import { createStatMatcher } from '@/utils/pob-stat-matcher';

// 取自 PoE1 3.30 的 mod-lines.json 與國際服 trade-stats.json（節錄）
const matcher = createStatMatcher({
  modLines: {
    '3299347043': [['{0:+d} to maximum Life', '{0:+d} 最大生命']],
    '1509134228': [['{0:d}% increased Physical Damage', '增加 {0:d}% 物理傷害']],
    '3372524247': [['{0:+d}% to Fire Resistance', '{0:+d}% 火焰抗性']],
    '4277795662': [['{0:+d}% to Cold and Lightning Resistances', '{0:+d}% 冰冷與閃電抗性']],
    '2901986750': [['{0:+d}% to all Elemental Resistances', '{0:+d}% 全部元素抗性']],
    '2923486259': [['{0:+d}% to Chaos Resistance', '{0:+d}% 混沌抗性']],
    '3086156145': [['Adds {0:d} Passive Skills', '附加 {0:d} 個天賦']],
    '1': [['{0:d} to Strength Requirement', '{0:d} 力量需求']],
    '2': [['{0:d}% to Critical Strike Chance', '{0:d}% 暴擊率']],
  },
  tradeStats: {
    'explicit.stat_3299347043': '+# to maximum Life',
    'implicit.stat_3299347043': '+# to maximum Life',
    'explicit.stat_1509134228': '#% increased Physical Damage (Local)',
    'explicit.stat_3372524247': '+#% to Fire Resistance',
    'implicit.stat_4277795662': '+#% to Cold and Lightning Resistances',
    'explicit.stat_2901986750': '+#% to all Elemental Resistances',
    'explicit.stat_2923486259': '+#% to Chaos Resistance',
    'enchant.stat_3086156145': 'Adds # Passive Skills',
    'enchant.stat_4079888060': '# Added Passive Skills are Jewel Sockets',
    'enchant.stat_3948993189|8':
      'Added Small Passive Skills grant: 12% increased Attack Damage while holding a Shield',
    'enchant.stat_3948993189|9': 'Added Small Passive Skills grant: 10% increased Attack Damage',
    'explicit.stat_3944525413': '1 Added Passive Skill is Feed the Fury',
    'explicit.pseudo_timeless_jewel_kaom': 'Commanded leadership over # warriors under Kaom',
    'explicit.stat_1': '# to Strength Requirement',
    'explicit.stat_2': '#% to Critical Strike Chance',
    'explicit.stat_5': '#% increased Attack Speed (Local)',
  },
});

describe('createStatMatcher：網域與市集寫法', () => {
  it('依網域對到固定詞綴與附魔的代碼', () => {
    expect(
      matcher.match('+16% to Cold and Lightning Resistances', {
        preferLocal: false,
        domain: 'implicit',
      }),
    ).toEqual({ statId: 'implicit.stat_4277795662', value: 16 });
    expect(
      matcher.match('+16% to Cold and Lightning Resistances', { preferLocal: false }),
    ).toBeUndefined();
    expect(
      matcher.match('Adds 8 Passive Skills', { preferLocal: false, domain: 'enchant' }),
    ).toEqual({ statId: 'enchant.stat_3086156145', value: 8 });
  });

  it('保留數值的正負號', () => {
    expect(matcher.match('-12 to Strength Requirement', { preferLocal: false })).toEqual({
      statId: 'explicit.stat_1',
      value: -12,
    });
  });

  it('mod-lines 對不到時以市集寫法比對：沒有 hash 的代碼、選項型代碼、標 (Local) 的代碼', () => {
    expect(
      matcher.match('Commanded leadership over 16137 warriors under Kaom', { preferLocal: false }),
    ).toEqual({ statId: 'explicit.pseudo_timeless_jewel_kaom', value: 16137 });
    expect(
      matcher.match(
        'Added Small Passive Skills grant: 12% increased Attack Damage while holding a Shield',
        { preferLocal: false, domain: 'enchant' },
      ),
    ).toEqual({ statId: 'enchant.stat_3948993189', option: 8 });
    // 選項型寫法的數字寫死，數字不同就不是同一個選項
    expect(
      matcher.match(
        'Added Small Passive Skills grant: 99% increased Attack Damage while holding a Shield',
        { preferLocal: false, domain: 'enchant' },
      ),
    ).toBeUndefined();
    expect(
      matcher.match('2 Added Passive Skills are Jewel Sockets', {
        preferLocal: false,
        domain: 'enchant',
      }),
    ).toEqual({ statId: 'enchant.stat_4079888060', value: 2 });
    expect(matcher.match('1 Added Passive Skill is Feed the Fury', { preferLocal: false })).toEqual(
      { statId: 'explicit.stat_3944525413' },
    );
    expect(matcher.match('15% increased Attack Speed', { preferLocal: true })).toEqual({
      statId: 'explicit.stat_5',
      value: 15,
    });
  });
});

describe('defaultStatBounds', () => {
  it('正數取八成當下限，整數捨去到整數', () => {
    expect(defaultStatBounds(100)).toEqual({ min: 80 });
    expect(defaultStatBounds(40.5)).toEqual({ min: 32 });
  });

  it('小於 10 的非整數保留一位小數，不會變成沒有數值', () => {
    expect(defaultStatBounds(0.5)).toEqual({ min: 0.4 });
    expect(defaultStatBounds(1.5)).toEqual({ min: 1.2 });
  });

  it('負數取八成當上限', () => {
    expect(defaultStatBounds(-12)).toEqual({ max: -9 });
    expect(defaultStatBounds(-0.5)).toEqual({ max: -0.4 });
  });

  it('精確數值上下限相同；沒有數值或算出 0 時不設範圍', () => {
    expect(defaultStatBounds(16137, true)).toEqual({ min: 16137, max: 16137 });
    expect(defaultStatBounds(undefined)).toEqual({});
    expect(defaultStatBounds(1)).toEqual({});
  });
});

describe('pseudoContributions', () => {
  it('抗性、生命、能力值對到總和條件，雙抗與全抗依倍數計算', () => {
    expect(pseudoContributions('+46% to Fire Resistance')).toEqual([
      { id: 'pseudo.pseudo_total_elemental_resistance', weight: 1 },
    ]);
    expect(pseudoContributions('+16% to Cold and Lightning Resistances')).toEqual([
      { id: 'pseudo.pseudo_total_elemental_resistance', weight: 2 },
    ]);
    expect(pseudoContributions('+15% to all Elemental Resistances')).toEqual([
      { id: 'pseudo.pseudo_total_elemental_resistance', weight: 3 },
    ]);
    expect(pseudoContributions('+15% to Fire and Chaos Resistances')).toEqual([
      { id: 'pseudo.pseudo_total_elemental_resistance', weight: 1 },
      { id: 'pseudo.pseudo_total_chaos_resistance', weight: 1 },
    ]);
    expect(pseudoContributions('+22 to Strength and Dexterity')).toEqual([
      { id: 'pseudo.pseudo_total_strength', weight: 1 },
      { id: 'pseudo.pseudo_total_dexterity', weight: 1 },
    ]);
    expect(pseudoContributions('+100 to maximum Life')).toEqual([
      { id: 'pseudo.pseudo_total_life', weight: 1 },
    ]);
    expect(pseudoContributions('15% increased Attack Speed')).toBeUndefined();
  });
});

const xml = `<PathOfBuilding>
	<Build className="Duelist" level="100"/>
	<Items activeItemSet="1">
		<Item id="1">
			Rarity: RARE
Doom Edge
Reaver Axe
Sockets: R-R-R-R-R-R
Implicits: 0
79% increased Physical Damage
50% increased Physical Damage
+0.5% to Critical Strike Chance
-12 to Strength Requirement
{crafted}20% increased Physical Damage
		</Item>
		<Item id="2">
			Rarity: RARE
Storm Loop
Two-Stone Ring (Cold/Lightning)
Implicits: 1
+16% to Cold and Lightning Resistances
+114 to maximum Life
+46% to Fire Resistance
+30% to Chaos Resistance
+15% to all Elemental Resistances
		</Item>
		<Item id="3">
			Rarity: RARE
New Item
Large Cluster Jewel
Implicits: 3
{crafted}Adds 8 Passive Skills
{crafted}2 Added Passive Skills are Jewel Sockets
{crafted}Added Small Passive Skills grant: 12% increased Attack Damage while holding a Shield
1 Added Passive Skill is Feed the Fury
		</Item>
		<Item id="4">
			Rarity: UNIQUE
Lethal Pride 16137; 8; Duelist
Timeless Jewel
Selected Variant: 1
Implicits: 0
{variant:1}Commanded leadership over 16137 warriors under Kaom
{variant:2}Commanded leadership over 16137 warriors under Rakiata
Passives in radius are Conquered by the Karui
		</Item>
		<Item id="5">
			Rarity: UNIQUE
Kaom's Heart
Glorious Plate
Sockets: R-R-R
Implicits: 0
+500 to maximum Life
		</Item>
		<ItemSet id="1">
			<Slot itemId="1" name="Weapon 1"/>
			<Slot itemId="2" name="Ring 1"/>
			<Slot itemId="5" name="Body Armour"/>
		</ItemSet>
	</Items>
	<Tree activeSpec="1">
		<Spec>
			<Sockets>
				<Socket itemId="3" nodeId="1"/>
				<Socket itemId="3" nodeId="2"/>
				<Socket itemId="4" nodeId="3"/>
			</Sockets>
		</Spec>
	</Tree>
</PathOfBuilding>`;

const catalog = createTradeNameCatalog({
  englishItems: [
    'Reaver Axe',
    'Two-Stone Ring',
    'Large Cluster Jewel',
    'Lethal Pride',
    'Timeless Jewel',
    "Kaom's Heart",
    'Glorious Plate',
  ],
});

describe('buildShoppingList：搜尋條件', () => {
  const list = buildShoppingList(parsePobBuildXml(xml), catalog, {}, matcher);
  const entry = (label: string): ShoppingEntry => list.find((item) => item.label === label)!;

  it('同一個代碼的多行數值加總；小數保留、負數用上限；六連帶入連結數；工藝詞綴不列入', () => {
    expect(entry('Reaver Axe').query).toEqual({
      status: { option: 'securable' },
      type: 'Reaver Axe',
      filters: { socket_filters: { filters: { links: { min: 6 } } } },
      stats: [
        {
          type: 'and',
          filters: [
            { id: 'explicit.stat_1509134228', value: { min: 103 } },
            { id: 'explicit.stat_2', value: { min: 0.4 } },
            { id: 'explicit.stat_1', value: { max: -9 } },
          ],
        },
      ],
    });
    expect(entry('Reaver Axe').mods?.map((mod) => mod.searched)).toEqual([
      true,
      true,
      true,
      true,
      false,
    ]);
  });

  it('基底名稱帶種類說明時以基底搜尋，種類由固定詞綴決定', () => {
    const ring = entry('Two-Stone Ring');
    expect(ring.englishName).toBe('Two-Stone Ring');
    expect(ring.query).toMatchObject({
      type: 'Two-Stone Ring',
      stats: [
        {
          filters: expect.arrayContaining([{ id: 'implicit.stat_4277795662', value: { min: 12 } }]),
        },
      ],
    });
  });

  it('星團珠寶：附魔帶入精確數值與選項，兩顆相同的合併計數', () => {
    const cluster = entry('Large Cluster Jewel');
    expect(cluster.count).toBe(2);
    expect(cluster.query).toEqual({
      status: { option: 'securable' },
      type: 'Large Cluster Jewel',
      stats: [
        {
          type: 'and',
          filters: [
            { id: 'enchant.stat_3086156145', value: { min: 8, max: 8 } },
            { id: 'enchant.stat_4079888060', value: { min: 2, max: 2 } },
            { id: 'enchant.stat_3948993189', value: { option: 8 } },
            { id: 'explicit.stat_3944525413' },
          ],
        },
      ],
    });
  });

  it('永恆珠寶：去掉名稱後的種子資訊，以種子編號精確搜尋', () => {
    const timeless = entry('Lethal Pride');
    expect(timeless.suffix).toBe('16137');
    expect(timeless.query).toEqual({
      status: { option: 'securable' },
      name: 'Lethal Pride',
      type: 'Timeless Jewel',
      stats: [
        {
          type: 'and',
          filters: [
            { id: 'explicit.pseudo_timeless_jewel_kaom', value: { min: 16137, max: 16137 } },
          ],
        },
      ],
    });
  });

  it('傳奇的詞綴預設不帶入但可以勾選；連結數不到五連不帶入', () => {
    const kaom = entry("Kaom's Heart");
    expect(kaom.query).toEqual({
      status: { option: 'securable' },
      name: "Kaom's Heart",
      type: 'Glorious Plate',
    });
    expect(kaom.mods?.[0].stat).toMatchObject({ id: 'explicit.stat_3299347043', value: 500 });
    expect(
      buildEntryQuery(kaom, { stats: { 'explicit.stat_3299347043': { enabled: true } } }),
    ).toMatchObject({
      stats: [{ type: 'and', filters: [{ id: 'explicit.stat_3299347043', value: { min: 400 } }] }],
    });
  });
});

describe('使用者調整搜尋條件', () => {
  const list = buildShoppingList(parsePobBuildXml(xml), catalog, {}, matcher);
  const ring = list.find((item) => item.label === 'Two-Stone Ring')!;

  it('entryStatFilters 列出合併後的條件與預設範圍', () => {
    expect(entryStatFilters(ring)).toEqual([
      { id: 'implicit.stat_4277795662', value: 16, enabled: true, min: 12, customized: false },
      { id: 'explicit.stat_3299347043', value: 114, enabled: true, min: 91, customized: false },
      { id: 'explicit.stat_3372524247', value: 46, enabled: true, min: 36, customized: false },
      { id: 'explicit.stat_2923486259', value: 30, enabled: true, min: 24, customized: false },
      { id: 'explicit.stat_2901986750', value: 15, enabled: true, min: 12, customized: false },
    ]);
  });

  it('取消勾選、改下限、清掉下限、設定上限', () => {
    const query = buildEntryQuery(ring, {
      stats: {
        'implicit.stat_4277795662': { enabled: false },
        'explicit.stat_3299347043': { min: 100 },
        'explicit.stat_3372524247': { min: null },
        'explicit.stat_2923486259': { max: 40 },
      },
    });
    expect(query?.stats).toEqual([
      {
        type: 'and',
        filters: [
          { id: 'explicit.stat_3299347043', value: { min: 100 } },
          { id: 'explicit.stat_3372524247' },
          { id: 'explicit.stat_2923486259', value: { min: 24, max: 40 } },
          { id: 'explicit.stat_2901986750', value: { min: 12 } },
        ],
      },
    ]);
  });

  it('至少符合 N 項：固定詞綴仍必須符合，N 超過一般詞綴數時以一般詞綴數為準', () => {
    expect(buildEntryQuery(ring, { countMin: 3 })?.stats).toEqual([
      { type: 'and', filters: [{ id: 'implicit.stat_4277795662', value: { min: 12 } }] },
      {
        type: 'count',
        value: { min: 3 },
        filters: [
          { id: 'explicit.stat_3299347043', value: { min: 91 } },
          { id: 'explicit.stat_3372524247', value: { min: 36 } },
          { id: 'explicit.stat_2923486259', value: { min: 24 } },
          { id: 'explicit.stat_2901986750', value: { min: 12 } },
        ],
      },
    ]);
    expect(buildEntryQuery(ring, { countMin: 99 })?.stats).toMatchObject([
      { type: 'and' },
      { type: 'count', value: { min: 4 } },
    ]);
  });

  it('至少符合 N 項：只有固定詞綴或附魔時沒有 count 群組', () => {
    const cluster = buildShoppingList(parsePobBuildXml(xml), catalog, {}, matcher).find(
      (item) => item.label === 'Large Cluster Jewel',
    )!;
    const stats = buildEntryQuery(cluster, {
      countMin: 1,
      stats: { 'explicit.stat_3944525413': { enabled: false } },
    })?.stats as Array<{ type: string }>;
    expect(stats.map((group) => group.type)).toEqual(['and']);
  });

  it('總和條件：勾選的抗性與生命換成總和，下限取八成；固定詞綴另外保留', () => {
    expect(buildEntryQuery(ring, { pseudo: true })?.stats).toEqual([
      {
        type: 'and',
        filters: [
          // 16×2 + 46 + 15×3 = 123
          { id: 'pseudo.pseudo_total_elemental_resistance', value: { min: 98 } },
          { id: 'pseudo.pseudo_total_life', value: { min: 91 } },
          { id: 'pseudo.pseudo_total_chaos_resistance', value: { min: 24 } },
          // 固定詞綴決定雙玉戒指的種類，仍保留
          { id: 'implicit.stat_4277795662', value: { min: 12 } },
        ],
      },
    ]);
  });

  it('全部取消勾選時只剩基底搜尋', () => {
    const stats = Object.fromEntries(
      entryStatFilters(ring).map((filter) => [filter.id, { enabled: false }]),
    );
    expect(buildEntryQuery(ring, { stats })).toEqual({
      status: { option: 'securable' },
      type: 'Two-Stone Ring',
    });
  });

  it('applyEntrySelection 同步每一行是否帶入搜尋', () => {
    const applied = applyEntrySelection(ring, {
      stats: { 'explicit.stat_3299347043': { enabled: false } },
    });
    expect(applied.mods?.map((mod) => mod.searched)).toEqual([true, false, true, true, true]);
    expect(applied.query).toEqual(
      buildEntryQuery(ring, { stats: { 'explicit.stat_3299347043': { enabled: false } } }),
    );
    expect(applyEntrySelection(ring, undefined)).toBe(ring);
  });
});
