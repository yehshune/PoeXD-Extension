import { describe, expect, it } from 'vitest';
import { toBoardEntry } from '@/utils/result-board/board-entry';
import {
  buildStashRegex,
  escapeStashText,
  STASH_SEARCH_MAX_LENGTH,
  type StashRegexItem,
} from '@/utils/result-board/stash-regex';
import { rawResult } from './helpers/result-board-fixtures';

const item = (
  id: string,
  name: string,
  note: string | undefined,
  typeLine = 'Vaal Regalia',
): StashRegexItem => ({ id, name, typeLine, ...(note !== undefined ? { note } : {}) });

/** 模擬遊戲：每個雙引號條件都要比對到物品的某一行 */
function gameLightsUp(part: string, target: StashRegexItem): boolean {
  const groups = Array.from(part.matchAll(/"([^"]*)"/g), (match) => match[1]);
  const lines = [target.name, target.typeLine, target.baseType ?? '', target.note ?? ''].filter(
    Boolean,
  );
  return groups.every((group) => lines.some((line) => new RegExp(group, 'i').test(line)));
}

describe('escapeStashText', () => {
  it('escapes regex special characters and replaces quotes', () => {
    expect(escapeStashText('a.b|c(d)[e]{f}*+?^$\\!')).toBe(
      'a\\.b\\|c\\(d\\)\\[e\\]\\{f\\}\\*\\+\\?\\^\\$\\\\\\!',
    );
    expect(escapeStashText('Say "hi"')).toBe('Say .hi.');
  });

  it('keeps Chinese and plain text unchanged', () => {
    expect(escapeStashText('末日護衛 魔血')).toBe('末日護衛 魔血');
  });
});

describe('buildStashRegex', () => {
  it('writes one name group and one price group', () => {
    const result = buildStashRegex({
      picked: [item('a', 'Doom Ward', '~b/o 2 chaos'), item('b', 'Grim Coat', '~b/o 1 divine')],
      others: [],
      maxLength: 250,
    });
    expect(result.parts).toEqual(['"Doom Ward|Grim Coat" "~b/o 2 chaos|~b/o 1 divine"']);
    expect(result.ambiguousIds).toEqual([]);
  });

  it('uses the type line for items without a name', () => {
    const result = buildStashRegex({
      picked: [item('a', '', '~price 5 chaos', 'Divine Orb')],
      others: [],
      maxLength: 250,
    });
    expect(result.parts).toEqual(['"Divine Orb" "~price 5 chaos"']);
  });

  it('escapes decimal prices and special characters in names', () => {
    const result = buildStashRegex({
      picked: [item('a', "Kaom's Heart (Legacy)", '~b/o 1.5 divine')],
      others: [],
      maxLength: 250,
    });
    expect(result.parts).toEqual(['"Kaom\'s Heart \\(Legacy\\)" "~b/o 1\\.5 divine"']);
    expect(
      gameLightsUp(result.parts[0], item('x', "Kaom's Heart (Legacy)", '~b/o 1.5 divine')),
    ).toBe(true);
    expect(
      gameLightsUp(result.parts[0], item('y', "Kaom's Heart (Legacy)", '~b/o 105 divine')),
    ).toBe(false);
  });

  it('handles Chinese item text', () => {
    const picked = [item('a', '末日護衛', '~b/o 2 chaos', '瓦爾法衣')];
    const result = buildStashRegex({ picked, others: [], maxLength: 250 });
    expect(result.parts).toEqual(['"末日護衛" "~b/o 2 chaos"']);
    expect(gameLightsUp(result.parts[0], picked[0])).toBe(true);
  });

  it('lights up every picked item and tells apart the seller’s other items', () => {
    const picked = [item('a', 'Doom Ward', '~b/o 2 chaos'), item('b', 'Grim Coat', '~b/o 3 chaos')];
    const others = [
      item('c', 'Doom Ward', '~b/o 9 chaos'),
      item('d', 'Storm Hide', '~b/o 2 chaos'),
    ];
    const result = buildStashRegex({ picked, others, maxLength: 250 });
    expect(picked.every((target) => result.parts.some((part) => gameLightsUp(part, target)))).toBe(
      true,
    );
    expect(result.ambiguousIds).toEqual([]);
  });

  it('reports other items it cannot tell apart', () => {
    const result = buildStashRegex({
      picked: [item('a', 'Headhunter', '~b/o 50 divine', 'Leather Belt')],
      others: [item('b', 'Headhunter', '~b/o 50 divine', 'Leather Belt')],
      maxLength: 250,
    });
    expect(result.ambiguousIds).toEqual(['b']);
  });

  it('reports name/price cross matches as ambiguous', () => {
    const result = buildStashRegex({
      picked: [item('a', 'Doom Ward', '~b/o 2 chaos'), item('b', 'Grim Coat', '~b/o 3 chaos')],
      others: [item('c', 'Doom Ward', '~b/o 3 chaos')],
      maxLength: 250,
    });
    expect(result.ambiguousIds).toEqual(['c']);
  });

  it('matches items without a price by name only and reports them', () => {
    const result = buildStashRegex({
      picked: [item('a', 'Doom Ward', '~b/o 2 chaos'), item('b', 'Grim Coat', undefined)],
      others: [],
      maxLength: 250,
    });
    expect(result.parts).toEqual(['"Doom Ward" "~b/o 2 chaos"', '"Grim Coat"']);
    expect(result.unpricedIds).toEqual(['b']);
  });

  it('returns nothing when nothing is picked', () => {
    expect(buildStashRegex({ picked: [], others: [], maxLength: 250 })).toEqual({
      parts: [],
      ambiguousIds: [],
      unpricedIds: [],
      tooLongIds: [],
    });
  });

  it('merges prices of the same type before splitting', () => {
    const picked = [
      item('a', 'Doom Ward', '~b/o 2 chaos'),
      item('b', 'Grim Coat', '~b/o 3 chaos'),
      item('c', 'Storm Hide', '~b/o 4 chaos'),
    ];
    const full = '"Doom Ward|Grim Coat|Storm Hide" "~b/o 2 chaos|~b/o 3 chaos|~b/o 4 chaos"';
    const result = buildStashRegex({ picked, others: [], maxLength: full.length - 1 });
    expect(result.parts).toEqual([
      '"Doom Ward|Grim Coat|Storm Hide" "~b/o (2 chaos|3 chaos|4 chaos)"',
    ]);
  });

  it('shortens names to distinguishing prefixes before splitting', () => {
    const picked = [item('a', 'Doom Ward', '~b/o 2 chaos'), item('b', 'Grim Coat', '~b/o 3 chaos')];
    const merged = '"Doom Ward|Grim Coat" "~b/o (2 chaos|3 chaos)"';
    const result = buildStashRegex({
      picked,
      others: [item('c', 'Dooms Day', '~b/o 9 chaos')],
      maxLength: merged.length - 1,
    });
    expect(result.parts).toEqual(['"Doom W|Grim" "~b/o (2 chaos|3 chaos)"']);
    expect(result.ambiguousIds).toEqual([]);
  });

  it('splits into parts that each stay within the limit', () => {
    const picked = Array.from({ length: 30 }, (_, index) =>
      item(`p${index}`, `Unique Name Number ${index}`, `~b/o ${index + 1} chaos`),
    );
    const others = Array.from({ length: 30 }, (_, index) =>
      item(`o${index}`, `Unique Name Number ${index}`, `~b/o ${index + 100} chaos`),
    );
    const maxLength = STASH_SEARCH_MAX_LENGTH.poe1;
    const result = buildStashRegex({ picked, others, maxLength });
    expect(result.parts.length).toBeGreaterThan(1);
    expect(result.parts.every((part) => part.length <= maxLength)).toBe(true);
    expect(picked.every((target) => result.parts.some((part) => gameLightsUp(part, target)))).toBe(
      true,
    );
    expect(result.tooLongIds).toEqual([]);
  });

  it('reports a single item longer than the limit', () => {
    const result = buildStashRegex({
      picked: [item('a', 'x'.repeat(40), '~b/o 2 chaos')],
      others: [item('b', 'x'.repeat(40), '~b/o 3 chaos')],
      maxLength: 30,
    });
    expect(result.parts).toEqual([]);
    expect(result.tooLongIds).toEqual(['a']);
  });
});

describe('buildStashRegex base group', () => {
  const based = (id: string, name: string, baseType: string, note: string): StashRegexItem => ({
    id,
    name,
    typeLine: baseType,
    baseType,
    note,
  });

  it('adds a base group for named items', () => {
    const result = buildStashRegex({
      picked: [
        based('a', 'Doom Ward', 'Vaal Regalia', '~b/o 2 chaos'),
        based('b', 'Grim Coat', 'Astral Plate', '~b/o 3 chaos'),
      ],
      others: [],
      maxLength: 250,
    });
    expect(result.parts).toEqual([
      '"Doom Ward|Grim Coat" "Vaal Regalia|Astral Plate" "~b/o 2 chaos|~b/o 3 chaos"',
    ]);
  });

  it('tells apart a cross match whose base differs', () => {
    const result = buildStashRegex({
      picked: [
        based('a', 'Doom Ward', 'Vaal Regalia', '~b/o 2 chaos'),
        based('b', 'Grim Coat', 'Vaal Regalia', '~b/o 3 chaos'),
      ],
      others: [based('c', 'Doom Ward', 'Leather Belt', '~b/o 3 chaos')],
      maxLength: 250,
    });
    expect(result.ambiguousIds).toEqual([]);
  });

  it('skips the base group when the names already are the bases', () => {
    const result = buildStashRegex({
      picked: [
        {
          id: 'a',
          name: '',
          typeLine: 'Seething Ruby Ring of the Fox',
          baseType: 'Ruby Ring',
          note: '~b/o 2 chaos',
        },
      ],
      others: [],
      maxLength: 250,
    });
    expect(result.parts).toEqual(['"Seething Ruby Ring of the Fox" "~b/o 2 chaos"']);
  });

  it('skips the base group when an item has no base', () => {
    const result = buildStashRegex({
      picked: [
        based('a', 'Doom Ward', 'Vaal Regalia', '~b/o 2 chaos'),
        item('b', 'Grim Coat', '~b/o 3 chaos'),
      ],
      others: [],
      maxLength: 250,
    });
    expect(result.parts).toEqual(['"Doom Ward|Grim Coat" "~b/o 2 chaos|~b/o 3 chaos"']);
  });

  it('drops the base group before splitting', () => {
    const picked = [
      based('a', 'Doom Ward', 'Vaal Regalia', '~b/o 2 chaos'),
      based('b', 'Grim Coat', 'Astral Plate', '~b/o 3 chaos'),
    ];
    const withoutBase = '"Doom|Grim" "~b/o (2 chaos|3 chaos)"';
    const result = buildStashRegex({ picked, others: [], maxLength: withoutBase.length });
    expect(result.parts).toEqual([withoutBase]);
  });

  it('keeps the most precise form that fits in each split part', () => {
    const picked = Array.from({ length: 12 }, (_, index) =>
      based(`p${index}`, `Name ${index}`, 'Vaal Regalia', `~b/o ${index + 1} chaos`),
    );
    const result = buildStashRegex({ picked, others: [], maxLength: 80 });
    expect(result.parts.length).toBeGreaterThan(1);
    expect(result.parts.every((part) => part.length <= 80)).toBe(true);
    expect(result.parts.some((part) => part.includes('"Vaal Regalia"'))).toBe(true);
    expect(picked.every((target) => result.parts.some((part) => gameLightsUp(part, target)))).toBe(
      true,
    );
  });
});

describe('board entry note', () => {
  it('keeps the base type apart from a magic type line', () => {
    const entry = toBoardEntry(
      rawResult({ id: 'a', typeLine: 'Seething Ruby Ring of the Fox', baseType: 'Ruby Ring' }),
      0,
    );
    expect(entry?.typeLine).toBe('Seething Ruby Ring of the Fox');
    expect(entry?.baseType).toBe('Ruby Ring');
  });

  it('prefers the item note', () => {
    const entry = toBoardEntry(
      rawResult({ id: 'a', note: '~b/o  1/2   divine', amount: 0.5, currency: 'divine' }),
      0,
    );
    expect(entry?.note).toBe('~b/o 1/2 divine');
  });

  it('writes the listing price the Trade way when the item has no note', () => {
    const entry = toBoardEntry(
      rawResult({ id: 'a', priceType: '~b/o', amount: 2.5, currency: 'chaos' }),
      0,
    );
    expect(entry?.note).toBe('~b/o 2.5 chaos');
  });

  it('ignores notes that are not prices and unknown price types', () => {
    const entry = toBoardEntry(
      rawResult({ id: 'a', note: 'wtb stuff', priceType: '~skip', amount: 1 }),
      0,
    );
    expect(entry?.note).toBeUndefined();
  });
});
