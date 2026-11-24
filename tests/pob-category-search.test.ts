// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { parsePobBuildXml } from '@/utils/pob-build';
import {
  cloneEntrySearchSelection,
  isSelectionDraftModified,
  normalizeSearchDefaults,
  normalizeSelectionForEntry,
  resolveEntrySearch,
} from '@/utils/pob-entry-search';
import {
  buildShoppingList,
  createTradeNameCatalog,
  type ShoppingEntry,
} from '@/utils/pob-shopping-list';

/** PoB 匯出的物品：護甲類物品帶基底防禦（`…BasePercentile`）與算好的防禦數值 */
const xml = (
  root: 'PathOfBuilding' | 'PathOfBuilding2' = 'PathOfBuilding',
) => `<?xml version="1.0"?>
<${root}>
	<Build className="Marauder" ascendClassName="Slayer" level="100" targetVersion="3_0"/>
	<Items activeItemSet="1">
		<Item id="1">
			Rarity: RARE
Vortex Brow
Paladin Crown
Armour: 569
ArmourBasePercentile: 0.6206
Energy Shield: 136
EnergyShieldBasePercentile: 0.7037
Item Level: 85
Implicits: 0
+50 to maximum Life
		</Item>
		<Item id="2">
			Rarity: RARE
Plague Touch
Titan Gauntlets
Armour: 553
ArmourBasePercentile: 0.2734
Energy Shield: 40
Item Level: 86
Implicits: 0
+40 to maximum Energy Shield
		</Item>
		<Item id="3">
			Rarity: RARE
Hypnotic Barrier
Colossal Tower Shield
Armour: 1163
ArmourBasePercentile: 0.4837
Implicits: 0
+80 to maximum Life
		</Item>
		<Item id="4">
			Rarity: RARE
Agony Loop
Amethyst Ring
Implicits: 0
+50 to maximum Life
		</Item>
		<Item id="5">
			Rarity: RARE
Doom Edge
Reaver Axe
Implicits: 0
+50 to maximum Life
		</Item>
		<Item id="6">
			Rarity: UNIQUE
Kaom's Heart
Glorious Plate
Armour: 800
ArmourBasePercentile: 1
Implicits: 0
+500 to maximum Life
		</Item>
		<Item id="7">
			Rarity: RARE
Hand Made
Leather Hood
Evasion: 120
Implicits: 0
+50 to maximum Life
		</Item>
		<ItemSet id="1">
			<Slot itemId="1" name="Helmet"/>
			<Slot itemId="2" name="Gloves"/>
			<Slot itemId="3" name="Weapon 2"/>
			<Slot itemId="4" name="Ring 1"/>
			<Slot itemId="5" name="Weapon 1"/>
			<Slot itemId="6" name="Body Armour"/>
			<Slot itemId="7" name="Boots"/>
		</ItemSet>
	</Items>
</${root}>`;

const catalog = createTradeNameCatalog({
  englishItems: [
    'Paladin Crown',
    'Titan Gauntlets',
    'Colossal Tower Shield',
    'Amethyst Ring',
    'Reaver Axe',
    "Kaom's Heart",
    'Glorious Plate',
    'Leather Hood',
  ],
});

describe('parsePobBuildXml：基底防禦', () => {
  const items = parsePobBuildXml(xml()).itemSets[0].items;
  const bySlot = (slot: string) => items.find((item) => item.slot === slot)!;

  it('依 …BasePercentile 行判斷基底防禦，數值行由詞綴加上的防禦不算', () => {
    expect(bySlot('Helmet').baseDefences).toEqual(['ar', 'es']);
    expect(bySlot('Gloves').baseDefences).toEqual(['ar']);
    expect(bySlot('Weapon 2').baseDefences).toEqual(['ar']);
  });

  it('沒有 BasePercentile 行時退回數值行；沒有防禦時省略', () => {
    expect(bySlot('Boots').baseDefences).toEqual(['ev']);
    expect(bySlot('Ring 1').baseDefences).toBeUndefined();
    expect(bySlot('Weapon 1').baseDefences).toBeUndefined();
  });
});

describe('buildShoppingList：類別搜尋', () => {
  const list = buildShoppingList(parsePobBuildXml(xml()), catalog);
  const entry = (label: string): ShoppingEntry => list.find((item) => item.label === label)!;

  it('依部位推得類別；PoE 1 副手有防禦基底時是盾牌；武器與傳奇沒有類別', () => {
    expect(entry('Paladin Crown').category).toEqual({
      id: 'armour.helmet',
      defences: ['ar', 'es'],
      defenceSection: 'armour_filters',
    });
    expect(entry('Colossal Tower Shield').category).toMatchObject({ id: 'armour.shield' });
    expect(entry('Amethyst Ring').category).toEqual({ id: 'accessory.ring' });
    expect(entry('Reaver Axe').category).toBeUndefined();
    expect(entry("Kaom's Heart").category).toBeUndefined();
  });

  it('預設仍以基底搜尋', () => {
    expect(resolveEntrySearch(entry('Paladin Crown')).searchBy).toBe('base');
    expect(entry('Paladin Crown').query).toMatchObject({ type: 'Paladin Crown' });
  });

  it('類別模式：拿掉基底，帶入類別與防禦類型（有的至少 1、沒有的為 0）', () => {
    const helmet = entry('Paladin Crown');
    const { query } = resolveEntrySearch(helmet, { searchBy: 'category' });
    expect(query).not.toHaveProperty('type');
    expect(query).toMatchObject({
      status: { option: 'securable' },
      filters: {
        type_filters: { filters: { category: { option: 'armour.helmet' } } },
        armour_filters: {
          filters: { ar: { min: 1 }, es: { min: 1 }, ev: { max: 0 }, ward: { max: 0 } },
        },
      },
    });
  });

  it('飾品的類別搜尋沒有防禦條件', () => {
    const { query } = resolveEntrySearch(entry('Amethyst Ring'), undefined, {
      rareSearch: 'category',
    });
    expect(query).toMatchObject({
      filters: { type_filters: { filters: { category: { option: 'accessory.ring' } } } },
    });
    expect((query as { filters: Record<string, unknown> }).filters).not.toHaveProperty(
      'armour_filters',
    );
  });

  it('build 預設為類別時，沒有類別的項目維持基底；單件設定優先', () => {
    const defaults = { rareSearch: 'category' as const };
    expect(resolveEntrySearch(entry('Reaver Axe'), undefined, defaults).searchBy).toBe('base');
    expect(resolveEntrySearch(entry('Paladin Crown'), undefined, defaults).searchBy).toBe(
      'category',
    );
    const overridden = resolveEntrySearch(entry('Paladin Crown'), { searchBy: 'base' }, defaults);
    expect(overridden.searchBy).toBe('base');
    expect(overridden.query).toMatchObject({
      type: 'Paladin Crown',
    });
  });

  it('類別模式也保留連結條件', () => {
    const helmet = { ...entry('Paladin Crown'), links: 6 };
    expect(resolveEntrySearch(helmet, { searchBy: 'category' }).query).toMatchObject({
      filters: {
        type_filters: { filters: { category: { option: 'armour.helmet' } } },
        socket_filters: { filters: { links: { min: 6 } } },
      },
    });
  });

  it('PoE 2：防禦條件放在 equipment_filters、沒有結界；副手不推斷盾牌', () => {
    const poe2 = buildShoppingList(parsePobBuildXml(xml('PathOfBuilding2')), catalog);
    const helmet = poe2.find((item) => item.label === 'Paladin Crown')!;
    expect(helmet.category).toEqual({
      id: 'armour.helmet',
      defences: ['ar', 'es'],
      defenceSection: 'equipment_filters',
    });
    const resolved = resolveEntrySearch(helmet, { searchBy: 'category' });
    expect(resolved.query).toMatchObject({
      filters: {
        equipment_filters: { filters: { ar: { min: 1 }, es: { min: 1 }, ev: { max: 0 } } },
      },
    });
    const section = (
      resolved.query as {
        filters: { equipment_filters: { filters: Record<string, unknown> } };
      }
    ).filters.equipment_filters.filters;
    expect(section).not.toHaveProperty('ward');
    expect(poe2.find((item) => item.label === 'Colossal Tower Shield')!.category).toBeUndefined();
  });

  it('選擇的正規化、複製與草稿比較包含搜尋方式', () => {
    const helmet = entry('Paladin Crown');
    expect(normalizeSelectionForEntry(helmet, { searchBy: 'base' })).toBeUndefined();
    expect(normalizeSelectionForEntry(helmet, { searchBy: 'category' })).toEqual({
      searchBy: 'category',
    });
    expect(
      normalizeSelectionForEntry(helmet, { searchBy: 'category' }, { rareSearch: 'category' }),
    ).toBeUndefined();
    expect(normalizeSelectionForEntry(entry('Reaver Axe'), { searchBy: 'category' })).toBe(
      undefined,
    );
    expect(cloneEntrySearchSelection({ searchBy: 'category' })).toEqual({ searchBy: 'category' });
    expect(
      isSelectionDraftModified(
        { filters: [], pseudo: false, searchBy: 'base' },
        { filters: [], pseudo: false, searchBy: 'category' },
      ),
    ).toBe(true);
  });

  it('整體設定只留非預設的搜尋方式', () => {
    expect(normalizeSearchDefaults({ rareSearch: 'base' })).toEqual({});
    expect(normalizeSearchDefaults({ rareSearch: 'category' })).toEqual({
      rareSearch: 'category',
    });
    expect(normalizeSearchDefaults({ rareSearch: 'other' as never })).toEqual({});
  });
});
