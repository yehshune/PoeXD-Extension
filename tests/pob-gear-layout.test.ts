import { describe, expect, it } from 'vitest';
import {
  GEAR_CELLS,
  fitItemInTile,
  gearLayout,
} from '@/components/sidebar/pob-build/pob-gear-layout';
import { formatPobSlot } from '@/components/sidebar/pob-build/pob-slot-label';
import { resetI18nStateForTests } from '@/utils/i18n';

const row = (slot: string, englishName = slot, kind: 'equipment' | 'unique' = 'equipment') => ({
  key: `k-${slot}-${englishName}`,
  slot,
  englishName,
  kind,
});

describe('gearLayout：PoB 部位放到遊戲裝備欄的格子', () => {
  const rows = [
    row('Weapon 1', 'The Covetous Dark', 'unique'),
    row('Weapon 2', 'Bitterbind Point', 'unique'),
    row('Weapon 1 Swap', 'Blood Sceptre'),
    row('Weapon 2 Swap', "Tyrant's Sekhem", 'unique'),
    row('Helmet'),
    row('Body Armour'),
    row('Gloves'),
    row('Boots'),
    row('Amulet'),
    row('Ring 1'),
    row('Ring 2'),
    row('Ring 3'),
    row('Belt'),
    row('Flask 3'),
    row('Flask 1'),
    row('Head'),
    row('Body'),
    row('Arm'),
    row('Leg'),
    row('Graft 1'),
    row('Jewel', 'Large Cluster Jewel'),
    row('Jewel', 'Cobalt Jewel'),
    row('Jewel', "Watcher's Eye", 'unique'),
    row('Belt Abyssal Socket 1', 'Hypnotic Eye Jewel'),
  ];
  const layout = gearLayout(rows);

  it('裝備欄：主手、副手、頭、身體、手、腳、項鍊、戒指、腰帶各一格', () => {
    expect(
      Object.fromEntries(
        Object.entries(layout.equipped).map(([cell, entry]) => [cell, entry.slot]),
      ),
    ).toEqual({
      weapon1: 'Weapon 1',
      weapon2: 'Weapon 2',
      helmet: 'Helmet',
      bodyArmour: 'Body Armour',
      gloves: 'Gloves',
      boots: 'Boots',
      amulet: 'Amulet',
      ring1: 'Ring 1',
      ring2: 'Ring 2',
      ring3: 'Ring 3',
      belt: 'Belt',
    });
  });

  it('備用武器另外分出，有備用武器時才需要切換', () => {
    expect(layout.swap.weapon1?.slot).toBe('Weapon 1 Swap');
    expect(layout.swap.weapon2?.slot).toBe('Weapon 2 Swap');
    expect(layout.hasSwap).toBe(true);
    expect(gearLayout([row('Weapon 1')]).hasSwap).toBe(false);
  });

  it('藥劑依編號放到五格，沒有的格子留空', () => {
    expect(layout.flasks.map((entry) => entry?.slot ?? null)).toEqual([
      'Flask 1',
      null,
      'Flask 3',
      null,
      null,
    ]);
  });

  it('柳條人四個部位、移植物、珠寶分成星團、一般、深淵', () => {
    expect(layout.wickerman.map((entry) => entry.slot)).toEqual(['Head', 'Body', 'Arm', 'Leg']);
    expect(layout.grafts.map((entry) => entry.slot)).toEqual(['Graft 1']);
    expect(layout.jewels.cluster.map((entry) => entry.englishName)).toEqual([
      'Large Cluster Jewel',
    ]);
    expect(layout.jewels.regular.map((entry) => entry.englishName)).toEqual([
      'Cobalt Jewel',
      "Watcher's Eye",
    ]);
    expect(layout.jewels.abyssal.map((entry) => entry.englishName)).toEqual(['Hypnotic Eye Jewel']);
  });

  it('護符（PoE2）一列；認不得的部位放到其他，不會遺失', () => {
    const layout = gearLayout([row('Charm 2'), row('Charm 1'), row('Mystery')]);
    expect(layout.charms.map((entry) => entry.slot)).toEqual(['Charm 1', 'Charm 2']);
    expect(layout.others.map((entry) => entry.slot)).toEqual(['Mystery']);
  });

  it('舊版 Wickerman 部位名稱與合成臟器也放在柳條人區', () => {
    const layout = gearLayout([
      row('Wickerman', 'Viscera'),
      row('Wickerman Lower Limb'),
      row('Wickerman Head'),
    ]);
    expect(layout.wickerman.map((entry) => entry.slot)).toEqual([
      'Wickerman Head',
      'Wickerman Lower Limb',
      'Wickerman',
    ]);
  });

  it('格子位置涵蓋 8×6 的裝備欄，彼此不重疊', () => {
    const occupied = new Set<string>();
    for (const cell of Object.values(GEAR_CELLS)) {
      for (let column = cell.column; column < cell.column + cell.width; column += 1) {
        for (let line = cell.row; line < cell.row + cell.height; line += 1) {
          const key = `${column},${line}`;
          expect(occupied.has(key)).toBe(false);
          occupied.add(key);
          expect(column).toBeLessThanOrEqual(8);
          expect(line).toBeLessThanOrEqual(6);
        }
      }
    }
  });

  it('新版 PoB 的柳條人部位名稱顯示為臟器部位', () => {
    resetI18nStateForTests('zh-TW');
    expect(['Head', 'Body', 'Arm', 'Leg'].map(formatPobSlot)).toEqual(
      ['Wickerman Head', 'Wickerman Torso', 'Wickerman Upper Limb', 'Wickerman Lower Limb'].map(
        formatPobSlot,
      ),
    );
    expect(formatPobSlot('Head')).not.toBe('Head');
  });

  it('fitItemInTile 依物品格數與裝備格數等比縮放，不超過原格佔比', () => {
    // 1×3 法杖放入 2×4 武器欄：不放大超過自身格數
    expect(fitItemInTile(1, 3, 2, 4)).toEqual({ width: 0.5, height: 0.75 });
    // 2×4 雙手武放入 2×4 武器欄：剛好填滿
    expect(fitItemInTile(2, 4, 2, 4)).toEqual({ width: 1, height: 1 });
    // 物品大於格子時等比縮小不溢出
    expect(fitItemInTile(2, 4, 1, 2)).toEqual({ width: 1, height: 1 });
  });
});
