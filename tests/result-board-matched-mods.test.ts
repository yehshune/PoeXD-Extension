import { describe, expect, it } from 'vitest';
import { formatConvertedAmount } from '@/utils/price-comparison';
import { toBoardEntry, type BoardEntry } from '@/utils/result-board/board-entry';
import { describeMatchedMods, fillStatTemplate } from '@/utils/result-board/board-mods';
import { projectBoardView } from '@/utils/result-board/board-projection';
import { rawResult } from './helpers/result-board-fixtures';

const LIFE = 'explicit.stat_3299347043';
const FIRE = 'explicit.stat_3372524247';
const PHYS = 'explicit.stat_1509134228';
const ACC = 'explicit.stat_691932474';

const TEMPLATES: Record<string, string> = {
  [LIFE]: '+# 最大生命',
  [FIRE]: '+#% 火焰抗性',
  [PHYS]: '增加 #% 物理傷害',
  [ACC]: '+# 命中值',
};
const resolveTemplate = (statId: string) => TEMPLATES[statId];

function entry(overrides: Partial<BoardEntry>): BoardEntry {
  return {
    id: 'e1',
    order: 0,
    name: '',
    typeLine: 'Vaal Regalia',
    instantBuyout: true,
    seller: { account: 'Seller#0001', presence: 'online' },
    ...overrides,
  };
}

describe('fillStatTemplate', () => {
  it('fills numbers from the source line into each # in order', () => {
    expect(fillStatTemplate('+#% 火焰抗性', '+40% to Fire Resistance')).toBe('+40% 火焰抗性');
    expect(fillStatTemplate('增加 #% 物理傷害', '179% increased Physical Damage')).toBe(
      '增加 179% 物理傷害',
    );
    expect(fillStatTemplate('附加 # - # 火焰傷害', 'Adds 12 to 24.5 Fire Damage')).toBe(
      '附加 12 - 24.5 火焰傷害',
    );
  });

  it('keeps the source sign when the template has none before the placeholder', () => {
    expect(fillStatTemplate('# 最大魔力', '+59 to maximum Mana')).toBe('+59 最大魔力');
    expect(fillStatTemplate('#% 火焰抗性', '-10% to Fire Resistance')).toBe('-10% 火焰抗性');
    expect(fillStatTemplate('+#% 火焰抗性', '+40% to Fire Resistance')).toBe('+40% 火焰抗性');
  });

  it('uses the template as-is when it has no placeholder', () => {
    expect(fillStatTemplate('無法被冰凍', 'Cannot be Frozen')).toBe('無法被冰凍');
  });

  it('falls back to the source text when there is no template or the number count differs', () => {
    expect(fillStatTemplate(undefined, '+92 to maximum Life')).toBe('+92 to maximum Life');
    expect(fillStatTemplate('附加 # - # 火焰傷害', 'Adds 12 Fire Damage')).toBe(
      'Adds 12 Fire Damage',
    );
  });
});

describe('describeMatchedMods', () => {
  const item = entry({
    modRolls: [
      {
        key: `explicit:${LIFE}`,
        category: 'explicit',
        hashes: [LIFE],
        isHybrid: false,
        tier: 'P2',
        tierNumber: 2,
      },
      {
        key: `explicit:${FIRE}`,
        category: 'explicit',
        hashes: [FIRE],
        isHybrid: false,
        tier: 'S1',
        tierNumber: 1,
      },
      {
        key: `explicit:${ACC}+${PHYS}`,
        category: 'explicit',
        hashes: [ACC, PHYS],
        isHybrid: true,
        tier: 'P1',
        tierNumber: 1,
      },
    ],
    modStats: [
      { statId: LIFE, text: '+92 to maximum Life' },
      { statId: FIRE, text: '+40% to Fire Resistance' },
      { statId: PHYS, text: '39% increased Physical Damage' },
      { statId: ACC, text: '+120 to Accuracy Rating' },
    ],
  });

  it('lists the matched lines in condition order with translated templates and real values', () => {
    expect(
      describeMatchedMods(
        item,
        [{ key: `explicit:${FIRE}` }, { key: `explicit:${LIFE}` }],
        resolveTemplate,
      ),
    ).toEqual(['+40% 火焰抗性', '+92 最大生命']);
  });

  it('expands a hybrid condition into one line per stat', () => {
    expect(
      describeMatchedMods(item, [{ key: `explicit:${ACC}+${PHYS}` }], resolveTemplate),
    ).toEqual(['+120 命中值', '增加 39% 物理傷害']);
  });

  it('skips conditions whose tier cap the roll does not meet', () => {
    expect(
      describeMatchedMods(item, [{ key: `explicit:${LIFE}`, maxTier: 1 }], resolveTemplate),
    ).toEqual([]);
  });

  it('falls back to the source text without a translation, and is empty without conditions or stats', () => {
    expect(describeMatchedMods(item, [{ key: `explicit:${LIFE}` }], () => undefined)).toEqual([
      '+92 to maximum Life',
    ]);
    expect(describeMatchedMods(item, [], resolveTemplate)).toEqual([]);
    expect(
      describeMatchedMods(
        entry({ modRolls: item.modRolls }),
        [{ key: `explicit:${LIFE}` }],
        resolveTemplate,
      ),
    ).toEqual([]);
  });
});

describe('toBoardEntry mod stats', () => {
  it('keeps each mod line with its stat id from extended.hashes', () => {
    const raw = rawResult({
      id: 'r1',
      explicitMods: ['+92 to maximum Life', '+40% to Fire Resistance'],
    });
    const item = raw.item as Record<string, unknown>;
    item.extended = {
      hashes: {
        explicit: [
          [`stat.${LIFE}`, [0]],
          [`stat.${FIRE}`, [1]],
        ],
      },
    };
    expect(toBoardEntry(raw, 0)?.modStats).toEqual([
      { statId: LIFE, text: '+92 to maximum Life' },
      { statId: FIRE, text: '+40% to Fire Resistance' },
    ]);
  });

  it('omits modStats when no line has a stat id', () => {
    const raw = rawResult({ id: 'r1', explicitMods: ['+92 to maximum Life'] });
    expect(toBoardEntry(raw, 0)?.modStats).toBeUndefined();
  });
});

describe('projectBoardView sellerInstantCounts', () => {
  it('counts instant-buyout listings per seller, including sold ones and excluding whisper-only', () => {
    const list = [
      rawResult({ id: 'a1', account: 'A#1' }),
      rawResult({ id: 'a2', account: 'A#1' }),
      rawResult({ id: 'a3', account: 'A#1', instantBuyout: false }),
      rawResult({ id: 'b1', account: 'B#2' }),
    ].map((raw, index) => toBoardEntry(raw, index)!);
    const projection = projectBoardView({
      entries: list,
      marks: { a2: 'sold' },
      hiddenAccounts: new Set(),
      view: 'items',
      sortMode: 'official',
      instantOnly: false,
      hideSold: true,
      keyword: '',
      minSellerCount: 0,
      modConditions: [],
      modPickerQuery: '',
      modQuickFilter: 'all',
      rates: undefined,
      resolveStatLabel: (hash) => hash,
    });
    expect(projection.sellerInstantCounts.get('A#1')).toBe(2);
    expect(projection.sellerInstantCounts.get('B#2')).toBe(1);
  });
});

describe('formatConvertedAmount', () => {
  it('keeps two decimals at or above 1 and two significant digits below 1', () => {
    expect(formatConvertedAmount(206, 'en')).toBe('206');
    expect(formatConvertedAmount(1.256, 'en')).toBe('1.26');
    expect(formatConvertedAmount(0.1111, 'en')).toBe('0.11');
    expect(formatConvertedAmount(0.56, 'en')).toBe('0.56');
    expect(formatConvertedAmount(0.004321, 'en')).toBe('0.0043');
    expect(formatConvertedAmount(0, 'en')).toBe('0');
  });
});
