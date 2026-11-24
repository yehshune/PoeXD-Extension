// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { parsePobBuildXml } from '@/utils/pob-build';
import {
  cloneEntrySearchSelection,
  isSelectionDraftModified,
  normalizeSelectionForEntry,
  resolveEntrySearch,
  selectionFromRowState,
} from '@/utils/pob-entry-search';
import {
  assignVisceraParts,
  buildShoppingList,
  createTradeNameCatalog,
  createVisceraModIndex,
  pseudoContributions,
  type ShoppingEntry,
} from '@/utils/pob-shopping-list';
import { createStatMatcher } from '@/utils/pob-stat-matcher';

/** 非傳奇裝備的搜尋都帶「非傳奇」稀有度條件 */
const NON_UNIQUE = { type_filters: { filters: { rarity: { option: 'nonunique' } } } };

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

describe('resolveEntrySearch：預設數值範圍', () => {
  const boundsOf = (value: number | undefined, exact = false, statPercent?: number) => {
    const [filter] = resolveEntrySearch(
      {
        searchBase: { type: 'Ring' },
        mods: [
          {
            text: 'mod',
            kind: 'explicit',
            searched: true,
            stat: {
              id: 'explicit.stat_test',
              ...(value !== undefined ? { value } : {}),
              ...(exact ? { exact } : {}),
              defaultEnabled: true,
            },
          },
        ],
      },
      undefined,
      statPercent !== undefined ? { statPercent } : undefined,
    ).filters;
    return {
      ...(filter.min !== undefined ? { min: filter.min } : {}),
      ...(filter.max !== undefined ? { max: filter.max } : {}),
    };
  };

  it('正數取八成當下限，整數捨去到整數', () => {
    expect(boundsOf(100)).toEqual({ min: 80 });
    expect(boundsOf(40.5)).toEqual({ min: 32 });
  });

  it('小於 10 的非整數保留一位小數，不會變成沒有數值', () => {
    expect(boundsOf(0.5)).toEqual({ min: 0.4 });
    expect(boundsOf(1.5)).toEqual({ min: 1.2 });
  });

  it('負數取八成當上限', () => {
    expect(boundsOf(-12)).toEqual({ max: -9 });
    expect(boundsOf(-0.5)).toEqual({ max: -0.4 });
  });

  it('精確數值上下限相同；沒有數值或算出 0 時不設範圍', () => {
    expect(boundsOf(16137, true)).toEqual({ min: 16137, max: 16137 });
    expect(boundsOf(undefined)).toEqual({});
    expect(boundsOf(1)).toEqual({});
  });

  it('依整體比例計算下限；100% 為原值', () => {
    expect(boundsOf(129, false, 50)).toEqual({ min: 64 });
    expect(boundsOf(129, false, 100)).toEqual({ min: 129 });
    expect(boundsOf(-12, false, 50)).toEqual({ max: -6 });
    expect(boundsOf(0.5, false, 50)).toEqual({ min: 0.2 });
    expect(boundsOf(8, true, 50)).toEqual({ min: 8, max: 8 });
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
      filters: { ...NON_UNIQUE, socket_filters: { filters: { links: { min: 6 } } } },
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
      filters: NON_UNIQUE,
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
      resolveEntrySearch(kaom, { stats: { 'explicit.stat_3299347043': { enabled: true } } }).query,
    ).toMatchObject({
      stats: [{ type: 'and', filters: [{ id: 'explicit.stat_3299347043', value: { min: 400 } }] }],
    });
  });
});

describe('使用者調整搜尋條件', () => {
  const list = buildShoppingList(parsePobBuildXml(xml), catalog, {}, matcher);
  const ring = list.find((item) => item.label === 'Two-Stone Ring')!;

  it('resolveEntrySearch 列出合併後的條件與預設範圍', () => {
    expect(resolveEntrySearch(ring).filters).toEqual([
      {
        id: 'implicit.stat_4277795662',
        key: 'implicit.stat_4277795662',
        value: 16,
        enabled: true,
        min: 12,
        customized: false,
      },
      {
        id: 'explicit.stat_3299347043',
        key: 'explicit.stat_3299347043',
        domains: ['explicit', 'implicit'],
        value: 114,
        enabled: true,
        min: 91,
        customized: false,
      },
      {
        id: 'explicit.stat_3372524247',
        key: 'explicit.stat_3372524247',
        value: 46,
        enabled: true,
        min: 36,
        customized: false,
      },
      {
        id: 'explicit.stat_2923486259',
        key: 'explicit.stat_2923486259',
        value: 30,
        enabled: true,
        min: 24,
        customized: false,
      },
      {
        id: 'explicit.stat_2901986750',
        key: 'explicit.stat_2901986750',
        value: 15,
        enabled: true,
        min: 12,
        customized: false,
      },
    ]);
  });

  it('切換網域：搜尋改用新前綴、以原代碼記住；不在可切換清單的前綴不採用', () => {
    const life = 'explicit.stat_3299347043';
    const switched = { stats: { [life]: { domain: 'implicit' } } };
    const resolved = resolveEntrySearch(ring, switched);
    expect(resolved.filters[1]).toMatchObject({
      id: 'implicit.stat_3299347043',
      key: life,
    });
    expect(
      (resolved.query?.stats as Array<{ filters: Array<{ id: string }> }>)[0].filters[1].id,
    ).toBe('implicit.stat_3299347043');
    // 切換後勾選狀態仍對應原本那一行
    expect(resolved.mods?.find((mod) => mod.stat?.id === life)?.searched).toBe(true);
    expect(normalizeSelectionForEntry(ring, switched)).toEqual(switched);
    // 從畫面狀態推回草稿時保留切換
    const row = { ...ring, filters: resolved.filters };
    expect(selectionFromRowState(row)).toEqual(switched);

    // 清單外的前綴、切回原前綴：都視為沒有切換
    for (const domain of ['fractured', 'explicit']) {
      const selection = { stats: { [life]: { domain } } };
      expect(resolveEntrySearch(ring, selection).filters[1].id).toBe(life);
      expect(normalizeSelectionForEntry(ring, selection)).toBeUndefined();
    }
  });

  it('取消勾選、改下限、清掉下限、設定上限', () => {
    const { query } = resolveEntrySearch(ring, {
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
    const resolved = resolveEntrySearch(ring, { countMin: 3 });
    expect(resolved.countableFilterCount).toBe(4);
    expect(resolved.query?.stats).toEqual([
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
    expect(resolveEntrySearch(ring, { countMin: 99 }).query?.stats).toMatchObject([
      { type: 'and' },
      { type: 'count', value: { min: 4 } },
    ]);
  });

  it('至少符合 N 項：只有固定詞綴或附魔時沒有 count 群組', () => {
    const cluster = buildShoppingList(parsePobBuildXml(xml), catalog, {}, matcher).find(
      (item) => item.label === 'Large Cluster Jewel',
    )!;
    const stats = resolveEntrySearch(cluster, {
      countMin: 1,
      stats: { 'explicit.stat_3944525413': { enabled: false } },
    }).query?.stats as Array<{ type: string }>;
    expect(stats.map((group) => group.type)).toEqual(['and']);
  });

  it('總和條件：勾選的抗性與生命換成總和，下限取八成；固定詞綴另外保留', () => {
    expect(resolveEntrySearch(ring, { pseudo: true }).query?.stats).toEqual([
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

  it('總和條件：使用者切換過網域的那一行保留成獨立條件，數值仍計入總和', () => {
    const life = 'explicit.stat_3299347043';
    const withFractured = {
      ...ring,
      mods: ring.mods?.map((mod) =>
        mod.stat?.id === life
          ? { ...mod, stat: { ...mod.stat, domains: ['explicit', 'fractured'] } }
          : mod,
      ),
    };
    const filters = (
      resolveEntrySearch(withFractured, {
        pseudo: true,
        stats: { [life]: { domain: 'fractured' } },
      }).query?.stats as Array<{ filters: Array<{ id: string; value?: { min?: number } }> }>
    )[0].filters;
    expect(filters).toContainEqual({ id: 'pseudo.pseudo_total_life', value: { min: 91 } });
    expect(filters).toContainEqual({ id: 'fractured.stat_3299347043', value: { min: 91 } });
  });

  it('總和條件：使用者調整過的那一行以他填的下限計入總和，清空視為 0', () => {
    const fire = resolveEntrySearch(ring).filters.find((filter) => filter.value === 46)!;
    const totalResist = (min: number | null) =>
      (
        resolveEntrySearch(ring, { pseudo: true, stats: { [fire.id]: { min } } }).query
          ?.stats as Array<{
          filters: Array<{ id: string; value?: { min?: number } }>;
        }>
      )[0].filters.find((filter) => filter.id === 'pseudo.pseudo_total_elemental_resistance');
    // 16×2×0.8 + 40 + 15×3×0.8 = 101.6
    expect(totalResist(40)).toEqual({
      id: 'pseudo.pseudo_total_elemental_resistance',
      value: { min: 101 },
    });
    // 清空下限：這一行不再要求數值，16×2×0.8 + 0 + 36 = 61.6
    expect(totalResist(null)).toEqual({
      id: 'pseudo.pseudo_total_elemental_resistance',
      value: { min: 61 },
    });
  });

  it('全部取消勾選時只剩基底搜尋', () => {
    const stats = Object.fromEntries(
      resolveEntrySearch(ring).filters.map((filter) => [filter.id, { enabled: false }]),
    );
    expect(resolveEntrySearch(ring, { stats }).query).toEqual({
      status: { option: 'securable' },
      type: 'Two-Stone Ring',
      filters: NON_UNIQUE,
    });
  });

  it('resolveEntrySearch 同步每一行是否帶入搜尋', () => {
    const resolved = resolveEntrySearch(ring, {
      stats: { 'explicit.stat_3299347043': { enabled: false } },
    });
    expect(resolved.mods?.map((mod) => mod.searched)).toEqual([true, false, true, true, true]);
    expect(resolved.query).toMatchObject({
      type: 'Two-Stone Ring',
    });
    expect(resolveEntrySearch(ring, undefined).query).toEqual(ring.query);
  });

  it('cloneEntrySearchSelection / selectionFromRowState / normalizeSelectionForEntry / isSelectionDraftModified 處理草稿與預設比較', () => {
    const original = {
      stats: { 'explicit.stat_3299347043': { enabled: false, min: 100 } },
      countMin: 2,
      pseudo: true as const,
    };
    const cloned = cloneEntrySearchSelection(original);
    expect(cloned).toEqual(original);
    expect(cloned).not.toBe(original);
    expect(cloned.stats).not.toBe(original.stats);

    const baseFilters = resolveEntrySearch(ring).filters;
    const derived = selectionFromRowState({
      mods: ring.mods,
      searchBase: ring.searchBase,
      filters: baseFilters.map((f) =>
        f.id === 'explicit.stat_3299347043' ? { ...f, min: 105, customized: true } : f,
      ),
      countMin: 1,
      pseudo: false,
    });
    expect(derived).toEqual({
      stats: { 'explicit.stat_3299347043': { min: 105 } },
      countMin: 1,
    });

    // 等於預設值的邊界與未啟用 pseudo 在 normalize 時會被精簡；全部回到預設則為 undefined
    expect(
      normalizeSelectionForEntry(ring, {
        stats: { 'explicit.stat_3299347043': { enabled: true, min: 91 } },
      }),
    ).toBeUndefined();
    expect(
      normalizeSelectionForEntry(ring, {
        stats: { 'explicit.stat_3299347043': { min: 91 }, 'explicit.stat_3372524247': { min: 50 } },
        pseudo: true,
      }),
    ).toEqual({
      stats: { 'explicit.stat_3372524247': { min: 50 } },
      pseudo: true,
    });

    expect(
      isSelectionDraftModified(
        { filters: baseFilters, countMin: undefined, pseudo: false },
        { filters: baseFilters, countMin: undefined, pseudo: false },
      ),
    ).toBe(false);
    expect(
      isSelectionDraftModified(
        { filters: baseFilters, countMin: undefined, pseudo: false },
        { filters: baseFilters, countMin: 2, pseudo: false },
      ),
    ).toBe(true);
  });
});

describe('Wickerman 臟器（3.30）', () => {
  const visceraMatcher = createStatMatcher({
    modLines: {
      '2250533757': [['{0:d}% increased Movement Speed', '增加 {0:d}% 移動速度']],
      '1': [
        [
          'Gain {0:d}% of Physical Damage as Extra Fire Damage',
          '獲得 {0:d}% 物理傷害的額外火焰傷害',
        ],
      ],
    },
    tradeStats: {
      'implicit.stat_2250533757': '#% increased Movement Speed',
      'implicit.stat_1': 'Gain #% of Physical Damage as Extra Fire Damage',
    },
  });
  const visceraCatalog = createTradeNameCatalog({ englishItems: ["Thaumaturge's Head"] });
  const build = (items: string, slots: string, config = '') =>
    parsePobBuildXml(`<PathOfBuilding>
	<Build className="Witch" level="90"/>
	<Items activeItemSet="1">${items}<ItemSet id="1">${slots}</ItemSet></Items>
	${config}
</PathOfBuilding>`);
  const visceraConfig = (enabled = 'true') => `<Config activeConfigSet="2">
		<ConfigSet id="1" title="Other"><CustomModifierBlock title="Viscera" enabled="true">99% increased Movement Speed</CustomModifierBlock></ConfigSet>
		<ConfigSet id="2" title="Default"><CustomModifierBlock title="Viscera" enabled="${enabled}">
4% increased Movement Speed
Gain 5% of Physical Damage as Extra Fire Damage
		</CustomModifierBlock></ConfigSet>
	</Config>`;

  // 下限照一般預設（PoB 數值的 80%）
  it('自訂詞綴區塊合成一個臟器項目：臟器分類、至少符合 1 項、固定詞綴不強制', () => {
    const list = buildShoppingList(
      build('', '', visceraConfig()),
      visceraCatalog,
      {},
      visceraMatcher,
    );
    const bundle = list.find((entry) => entry.visceraBundle)!;
    expect(bundle).toMatchObject({ slot: 'Wickerman', englishName: 'Viscera' });
    expect(bundle.query).toEqual({
      status: { option: 'securable' },
      filters: { type_filters: { filters: { category: { option: 'viscera' } } } },
      stats: [
        {
          type: 'count',
          value: { min: 1 },
          filters: [
            { id: 'implicit.stat_2250533757', value: { min: 3 } },
            { id: 'implicit.stat_1', value: { min: 4 } },
          ],
        },
      ],
    });
    // 使用者改成至少 2 項時照用；合成臟器的固定詞綴也算進 countableFilterCount
    const resolvedBundle = resolveEntrySearch(bundle, { countMin: 2 });
    expect(resolvedBundle.countableFilterCount).toBe(2);
    expect(resolvedBundle.query?.stats).toMatchObject([{ type: 'count', value: { min: 2 } }]);
    // 等於預設的至少 1 項不算自訂，存回時拿掉
    expect(normalizeSelectionForEntry(bundle, { countMin: 1 })).toBeUndefined();
    expect(normalizeSelectionForEntry(bundle, { countMin: 2 })).toEqual({ countMin: 2 });
  });

  it('依詞綴資料拆成部位：每個部位一列、部位分類、詞綴全部符合；分不出部位的留在合成項目', () => {
    const index = createVisceraModIndex(
      (statId) =>
        ({
          // 移動速度同時是靴子的詞綴：只看臟器的部位標籤
          'implicit.stat_2250533757': [
            { types: ['boots'], id: statId },
            { types: ['viscera', 'viscera_leg'], id: statId },
          ],
          'implicit.stat_1': [
            { types: ['viscera', 'viscera_head'], id: statId },
            { types: ['viscera', 'viscera_arm'], id: statId },
          ],
        })[statId],
    );
    const list = buildShoppingList(
      build('', '', visceraConfig()),
      visceraCatalog,
      {},
      visceraMatcher,
      { visceraMods: index },
    );
    const leg = list.find((entry) => entry.visceraPart === 'leg')!;
    expect(leg).toMatchObject({ slot: 'Wickerman Lower Limb', englishName: 'Viscera' });
    expect(leg.query).toEqual({
      status: { option: 'securable' },
      filters: { type_filters: { filters: { category: { option: 'viscera.leg' } } } },
      stats: [{ type: 'and', filters: [{ id: 'implicit.stat_2250533757', value: { min: 3 } }] }],
    });
    // 物理轉火焰可以是頭部或手部，兩種組合都成立，判斷不出來，留在合成項目
    const rest = list.find((entry) => entry.visceraBundle)!;
    expect(rest.mods?.map((mod) => mod.text)).toEqual([
      'Gain 5% of Physical Damage as Extra Fire Damage',
    ]);
    expect(list.filter((entry) => entry.slot?.startsWith('Wickerman'))).toHaveLength(2);
  });

  it('區塊停用時不列；套裝已有 Wickerman 部位的臟器時不合成，臟器以基底與固定詞綴搜尋', () => {
    expect(
      buildShoppingList(
        build('', '', visceraConfig('false')),
        visceraCatalog,
        {},
        visceraMatcher,
      ).some((entry) => entry.visceraBundle),
    ).toBe(false);

    const native = build(
      `<Item id="1">
Rarity: NORMAL
Greater Thaumaturge's Head
Implicits: 1
4% increased Movement Speed
		</Item>`,
      '<Slot name="Wickerman Head" itemId="1"/>',
      visceraConfig(),
    );
    const list = buildShoppingList(native, visceraCatalog, {}, visceraMatcher);
    expect(list.some((entry) => entry.visceraBundle)).toBe(false);
    const head = list.find((entry) => entry.slot === 'Wickerman Head')!;
    expect(head.query).toEqual({
      status: { option: 'securable' },
      type: "Thaumaturge's Head",
      filters: NON_UNIQUE,
      stats: [{ type: 'and', filters: [{ id: 'implicit.stat_2250533757', value: { min: 3 } }] }],
    });
  });

  it('多行詞綴一起比對：每部位一條詞綴，所有組合都同意的部位才採用', () => {
    const mod = (part: 'head' | 'body' | 'arm' | 'leg', ...statIds: string[]) => ({
      part,
      statIds,
    });
    // 取自 3.30：Piety（頭，火冰電）、Prayer Leader（頭，火）、Tsoagoth（手，冰電）、
    // Tukohama（手，打擊距離）、Harbinger（手，冰）、General Adus（頭，電）
    const mods = [
      mod('head', 'fire', 'cold', 'lightning'),
      mod('head', 'fire'),
      mod('arm', 'cold', 'lightning'),
      mod('arm', 'strike'),
      mod('arm', 'cold'),
      mod('head', 'lightning'),
      mod('body', 'ailment'),
      mod('leg', 'speed'),
    ];
    const index = (statId: string) => mods.filter((entry) => entry.statIds.includes(statId));

    // 手部已經是打擊距離，冰電只能是頭部的三行詞綴
    expect(
      assignVisceraParts(['ailment', 'speed', 'strike', 'fire', 'cold', 'lightning'], index),
    ).toEqual(['body', 'leg', 'arm', 'head', 'head', 'head']);
    // 沒有打擊距離時，火冰電可以是「頭部三行」或「頭部火 + 手部冰電」，冰電判斷不出來
    expect(assignVisceraParts(['fire', 'cold', 'lightning'], index)).toEqual([
      'head',
      undefined,
      undefined,
    ]);
    // 沒有可以完整涵蓋的組合時逐行判斷；對不到代碼的行不影響其他行
    expect(assignVisceraParts(['speed', 'speed', undefined], index)).toEqual([
      'leg',
      'leg',
      undefined,
    ]);
  });
});

describe('工藝詞綴', () => {
  const craftedMatcher = createStatMatcher({
    modLines: { '3299347043': [['{0:+d} to maximum Life', '{0:+d} 最大生命']] },
    tradeStats: {
      'explicit.stat_3299347043': '+# to maximum Life',
      'crafted.stat_3299347043': '+# to maximum Life',
      'pseudo.stat_3299347043': '+# total maximum Life',
    },
  });
  const ringXml = `<PathOfBuilding>
	<Build className="Duelist" level="100"/>
	<Items activeItemSet="1">
		<Item id="1">
			Rarity: RARE
Doom Loop
Two-Stone Ring
Implicits: 0
+40 to maximum Life
{crafted}+25 to maximum Life
		</Item>
		<ItemSet id="1"><Slot name="Ring 1" itemId="1"/></ItemSet>
	</Items>
</PathOfBuilding>`;
  const ring = buildShoppingList(parsePobBuildXml(ringXml), catalog, {}, craftedMatcher)[0];

  it('對到 crafted 代碼、預設不勾，和同代碼的隨機詞綴分開；可切換的網域不含總和代碼', () => {
    expect(ring.mods?.[1]).toMatchObject({
      kind: 'crafted',
      searched: false,
      stat: {
        id: 'crafted.stat_3299347043',
        value: 25,
        defaultEnabled: false,
        domains: ['explicit', 'crafted'],
      },
    });
    expect(resolveEntrySearch(ring).filters.map((filter) => [filter.id, filter.enabled])).toEqual([
      ['explicit.stat_3299347043', true],
      ['crafted.stat_3299347043', false],
    ]);
    // 勾選後帶入搜尋
    expect(
      resolveEntrySearch(ring, { stats: { 'crafted.stat_3299347043': { enabled: true } } }).query
        ?.stats,
    ).toEqual([
      {
        type: 'and',
        filters: [
          { id: 'explicit.stat_3299347043', value: { min: 32 } },
          { id: 'crafted.stat_3299347043', value: { min: 20 } },
        ],
      },
    ]);
  });
});

describe('build 整體設定：詞綴數值比例與連結條件', () => {
  const list = buildShoppingList(parsePobBuildXml(xml), catalog, {}, matcher);
  const axe = list.find((item) => item.label === 'Reaver Axe')!;
  const kaom = list.find((item) => item.label === "Kaom's Heart")!;
  const PHYS = 'explicit.stat_1509134228';
  const sixLink = { socket_filters: { filters: { links: { min: 6 } } } };

  it('連結數記在項目上，不再寫死在 searchBase；五連以下沒有', () => {
    expect(axe.links).toBe(6);
    expect(axe.searchBase).not.toHaveProperty('filters.socket_filters');
    expect(kaom.links).toBeUndefined();
    expect(resolveEntrySearch(axe).linksMin).toBe(6);
    expect(resolveEntrySearch(kaom).linksMin).toBeUndefined();
  });

  it('數值比例套用到沒調整過的條件，調整過的維持使用者填的值', () => {
    expect(resolveEntrySearch(axe, undefined, { statPercent: 50 }).query).toEqual({
      status: { option: 'securable' },
      type: 'Reaver Axe',
      filters: { ...NON_UNIQUE, ...sixLink },
      stats: [
        {
          type: 'and',
          filters: [
            { id: PHYS, value: { min: 64 } },
            { id: 'explicit.stat_2', value: { min: 0.2 } },
            { id: 'explicit.stat_1', value: { max: -6 } },
          ],
        },
      ],
    });
    const { filters } = resolveEntrySearch(
      axe,
      { stats: { [PHYS]: { min: 120 } } },
      { statPercent: 50 },
    );
    expect(filters.find((filter) => filter.key === PHYS)).toMatchObject({
      min: 120,
    });
    expect(filters.find((filter) => filter.key === 'explicit.stat_2')).toMatchObject({ min: 0.2 });
  });

  it('總和條件的下限也依比例計算', () => {
    const ring = list.find((item) => item.label === 'Two-Stone Ring')!;
    const life = resolveEntrySearch(ring).filters.find(
      (filter) => filter.key === 'explicit.stat_3299347043',
    )!;
    const query = resolveEntrySearch(ring, { pseudo: true }, { statPercent: 50 }).query as {
      stats: { filters: { id: string; value?: { min?: number } }[] }[];
    };
    expect(query.stats[0].filters).toContainEqual({
      id: 'pseudo.pseudo_total_life',
      value: { min: Math.floor(life.value! * 0.5) },
    });
  });

  it('連結條件：照 PoB、只帶六連、一律不帶', () => {
    const fiveLink = { ...axe, links: 5 };
    expect(resolveEntrySearch(fiveLink, undefined, { links: 'pob' }).linksMin).toBe(5);
    expect(resolveEntrySearch(fiveLink, undefined, { links: 'six' }).linksMin).toBeUndefined();
    expect(resolveEntrySearch(axe, undefined, { links: 'six' }).linksMin).toBe(6);
    const noLinks = resolveEntrySearch(axe, undefined, { links: 'none' });
    expect(noLinks.linksMin).toBeUndefined();
    expect(noLinks.query).not.toHaveProperty('filters.socket_filters');
  });

  it('單件的連結設定優先於 build 預設：null 為不限，數字為下限', () => {
    const anyLinks = resolveEntrySearch(axe, { links: null });
    expect(anyLinks.linksMin).toBeUndefined();
    expect(anyLinks.query).not.toHaveProperty('filters.socket_filters');
    const forcedFive = resolveEntrySearch(axe, { links: 5 }, { links: 'none' });
    expect(forcedFive.linksMin).toBe(5);
    expect(forcedFive.query).toMatchObject({
      filters: { socket_filters: { filters: { links: { min: 5 } } } },
    });
  });

  it('連結條件和既有的分類條件合併，不會蓋掉', () => {
    const entry = {
      ...axe,
      searchBase: {
        status: { option: 'securable' },
        filters: {
          type_filters: { filters: { category: { option: 'weapon' } } },
        },
      },
    };
    expect(resolveEntrySearch(entry).query).toMatchObject({
      filters: {
        type_filters: { filters: { category: { option: 'weapon' } } },
        ...sixLink,
      },
    });
  });

  it('resolveEntrySearch：沒有調整但 build 設定不是預設時重新計算搜尋', () => {
    const resolved = resolveEntrySearch(axe, undefined, { statPercent: 50 });
    expect(resolved.query).toMatchObject({
      stats: [
        {
          type: 'and',
          filters: [{ id: PHYS, value: { min: 64 } }, expect.anything(), expect.anything()],
        },
      ],
    });
    expect(resolveEntrySearch(axe, undefined).query).toEqual(axe.query);
  });

  it('normalizeSelectionForEntry：等於 build 預設的連結與下限會被精簡', () => {
    expect(normalizeSelectionForEntry(axe, { links: 6 })).toBeUndefined();
    expect(normalizeSelectionForEntry(axe, { links: 6 }, { links: 'none' })).toEqual({ links: 6 });
    expect(normalizeSelectionForEntry(axe, { links: null })).toEqual({
      links: null,
    });
    expect(normalizeSelectionForEntry(kaom, { links: null })).toBeUndefined();
    expect(
      normalizeSelectionForEntry(axe, { stats: { [PHYS]: { min: 64 } } }, { statPercent: 50 }),
    ).toBeUndefined();
    expect(normalizeSelectionForEntry(axe, { stats: { [PHYS]: { min: 64 } } })).toEqual({
      stats: { [PHYS]: { min: 64 } },
    });
  });

  it('草稿：複製保留連結設定，連結不同時視為已修改', () => {
    expect(cloneEntrySearchSelection({ links: null })).toEqual({ links: null });
    expect(cloneEntrySearchSelection({ links: 5 })).toEqual({ links: 5 });
    expect(
      isSelectionDraftModified(
        { filters: [], countMin: undefined, pseudo: false, linksMin: 6 },
        {
          filters: [],
          countMin: undefined,
          pseudo: false,
          linksMin: undefined,
        },
      ),
    ).toBe(true);
  });
});

describe('Local 代碼：只有武器的攻擊類詞綴與防具的防禦類詞綴是裝備本身的數值', () => {
  // 取自國際服 trade-stats.json：同一句話有全域與 (Local) 兩個代碼
  const localMatcher = createStatMatcher({
    modLines: {},
    tradeStats: {
      'explicit.stat_681332047': '#% increased Attack Speed',
      'explicit.stat_210067635': '#% increased Attack Speed (Local)',
      'explicit.stat_803737631': '+# to Accuracy Rating',
      'explicit.stat_691932474': '+# to Accuracy Rating (Local)',
      'explicit.stat_809229260': '+# to Armour',
      'explicit.stat_3484657501': '+# to Armour (Local)',
      'explicit.stat_4052037485': '+# to maximum Energy Shield (Local)',
      'explicit.stat_3489782002': '+# to maximum Energy Shield',
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
Implicits: 0
16% increased Attack Speed
+489 to Accuracy Rating
+120 to Armour
+40 to maximum Energy Shield
		</Item>
		<Item id="2">
			Rarity: RARE
Doom Edge
Reaver Axe
Implicits: 0
16% increased Attack Speed
+489 to Accuracy Rating
		</Item>
		<Item id="3">
			Rarity: RARE
Agony Loop
Amethyst Ring
Implicits: 0
+489 to Accuracy Rating
+120 to Armour
		</Item>
		<ItemSet id="1">
			<Slot itemId="1" name="Gloves"/>
			<Slot itemId="2" name="Weapon 1"/>
			<Slot itemId="3" name="Ring 1"/>
		</ItemSet>
	</Items>
</PathOfBuilding>`;
  const list = buildShoppingList(
    parsePobBuildXml(xml),
    createTradeNameCatalog({ englishItems: ['Legion Gloves', 'Reaver Axe', 'Amethyst Ring'] }),
    {},
    localMatcher,
  );
  const statsOf = (label: string) =>
    list.find((entry) => entry.label === label)!.mods!.map((mod) => mod.stat?.id);

  it('防具：攻擊速度與命中是全域代碼，護甲與能量護盾是 Local', () => {
    expect(statsOf('Legion Gloves')).toEqual([
      'explicit.stat_681332047',
      'explicit.stat_803737631',
      'explicit.stat_3484657501',
      'explicit.stat_4052037485',
    ]);
  });

  it('武器：攻擊類詞綴是 Local', () => {
    expect(statsOf('Reaver Axe')).toEqual(['explicit.stat_210067635', 'explicit.stat_691932474']);
  });

  it('飾品一律是全域代碼', () => {
    expect(statsOf('Amethyst Ring')).toEqual([
      'explicit.stat_803737631',
      'explicit.stat_809229260',
    ]);
  });

  it('副手盾牌僅防禦為 Local、箭袋全為全域代碼', () => {
    const offhandXml = `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
	<Build level="90"/>
	<Items activeItemSet="1">
		<Item id="1">
			Rarity: RARE
Viper Ward
Titanium Spirit Shield
EnergyShieldBasePercentile: 1
Implicits: 0
10% increased Attack Speed
+100 to maximum Energy Shield
		</Item>
		<Item id="2">
			Rarity: RARE
Bramble Quiver
Broadhead Arrow Quiver
Implicits: 0
10% increased Attack Speed
+489 to Accuracy Rating
		</Item>
		<ItemSet id="1">
			<Slot itemId="1" name="Weapon 2"/>
			<Slot itemId="2" name="Weapon 2 Swap"/>
		</ItemSet>
	</Items>
</PathOfBuilding>`;
    const offhandList = buildShoppingList(
      parsePobBuildXml(offhandXml),
      createTradeNameCatalog({
        englishItems: ['Titanium Spirit Shield', 'Broadhead Arrow Quiver'],
      }),
      {},
      localMatcher,
    );
    const of = (label: string) =>
      offhandList.find((entry) => entry.label === label)!.mods!.map((mod) => mod.stat?.id);
    expect(of('Titanium Spirit Shield')).toEqual([
      'explicit.stat_681332047',
      'explicit.stat_4052037485',
    ]);
    expect(of('Broadhead Arrow Quiver')).toEqual([
      'explicit.stat_681332047',
      'explicit.stat_803737631',
    ]);
  });
});
