import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  LIVE_TRADE_DATA_LIMITS,
  parseLiveStatLabels,
  parseLiveTradeFilters,
} from '../utils/live-trade-data';

const readJson = (path: string): any =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

/**
 * 2026-11-14 取自官方市集頁面的 static_.propertyFilters 與裁切過的 static_.knownStats
 * （ADR-0014 第 0 階段；國際服擷取時市集漢化已關閉）。對照同一天由 poexd-data 自同一網域產生並同步的打包檔。
 */
const CASES = [
  { name: 'poe1-en', version: 'poe1', locale: 'en' },
  { name: 'poe1-zh-TW', version: 'poe1', locale: 'zh-TW' },
  { name: 'poe2-zh-TW', version: 'poe2', locale: 'zh-TW' },
].map((entry) => ({
  ...entry,
  filters: readJson(`./fixtures/live-trade-data/${entry.name}-property-filters.json`),
  stats: readJson(`./fixtures/live-trade-data/${entry.name}-known-stats.json`),
  bundled: readJson(`../public/json/${entry.version}/locales/${entry.locale}/trade-filters.json`),
}));

const enStats = CASES[0].stats;

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

/** 足以通過最少欄位數的 filters 群組 */
const makeFilters = (extra: Record<string, unknown>[] = []) => [
  {
    id: 'misc_filters',
    title: 'Miscellaneous',
    filters: [
      ...Array.from({ length: LIVE_TRADE_DATA_LIMITS.minFieldCount }, (_, i) => ({
        id: `field_${i}`,
        text: `Field ${i}`,
      })),
      ...extra,
    ],
  },
];

describe('parseLiveTradeFilters', () => {
  it.each(CASES)('$name：轉出與打包 trade-filters.json 相同的群組、欄位與選項', (entry) => {
    const result = parseLiveTradeFilters(deepFreeze(structuredClone(entry.filters)));
    expect(result).not.toBeNull();
    expect(result!.groups).toEqual(entry.bundled.groups);
    expect(result!.fields).toEqual(entry.bundled.fields);
    expect(result!.options).toEqual(entry.bundled.options);
  });

  it('只在沒有明確選項時把 sale_type 的 null 選項對應到 priced', () => {
    const implicit = parseLiveTradeFilters(
      makeFilters([
        {
          id: 'sale_type',
          text: 'Sale Type',
          option: { options: [{ id: null, text: 'Buyout or Fixed Price' }] },
        },
      ]),
    );
    expect(implicit!.options.sale_type).toEqual({ priced: 'Buyout or Fixed Price' });

    const explicit = parseLiveTradeFilters(
      makeFilters([
        {
          id: 'sale_type',
          text: 'Sale Type',
          option: {
            options: [
              { id: null, text: 'Any' },
              { id: 'priced', text: 'Priced' },
            ],
          },
        },
      ]),
    );
    expect(explicit!.options.sale_type).toEqual({ priced: 'Priced' });
  });

  it('略過其他欄位的 null 選項，數字 id 轉成字串，並去掉零寬空白後的提示', () => {
    const result = parseLiveTradeFilters(
      makeFilters([
        {
          id: 'corrupted',
          text: 'Corrupted​Tip text',
          option: {
            options: [
              { id: null, text: 'Any' },
              { id: 1, text: '  Yes ' },
            ],
          },
        },
      ]),
    );
    expect(result!.fields.corrupted).toBe('Corrupted');
    expect(result!.options.corrupted).toEqual({ 1: 'Yes' });
  });

  it.each([
    ['不是陣列', { result: [] }],
    ['群組缺少 id', [{ title: 'x', filters: [] }]],
    ['欄位缺少 id', makeFilters([{ text: 'no id' }])],
    ['文字不是字串', makeFilters([{ id: 'bad', text: 42 }])],
    [
      '文字過長',
      makeFilters([{ id: 'long', text: 'x'.repeat(LIVE_TRADE_DATA_LIMITS.maxTextLength + 1) }]),
    ],
    [
      '選項 id 型別不符',
      makeFilters([{ id: 'o', text: 'O', option: { options: [{ id: {}, text: 'x' }] } }]),
    ],
    ['同 id 文字不同', makeFilters([{ id: 'field_0', text: 'Other' }])],
    ['欄位過少', [{ id: 'g', title: 'G', filters: [{ id: 'a', text: 'A' }] }]],
    [
      '群組過多',
      Array.from({ length: LIVE_TRADE_DATA_LIMITS.maxFilterGroups + 1 }, (_, i) => ({
        id: `g${i}`,
        title: `G${i}`,
      })),
    ],
  ])('%s時整份回傳 null', (_label, input) => {
    expect(parseLiveTradeFilters(input)).toBeNull();
  });
});

describe('parseLiveStatLabels', () => {
  it('重複 id 取第一次出現的文字（knownStatsFlat 取的是最後一筆）', () => {
    const result = parseLiveStatLabels(deepFreeze(structuredClone(enStats)));
    expect(result).not.toBeNull();
    const explicit = enStats.find((group: any) => group.id === 'explicit').entries;
    const dupId = 'explicit.stat_1365687125';
    const occurrences = explicit.filter((entry: any) => entry.id === dupId);
    expect(occurrences.length).toBeGreaterThan(1);
    expect(occurrences[0].text).not.toBe(occurrences.at(-1).text);
    expect(result!.stats[dupId]).toBe(occurrences[0].text);
  });

  it.each(CASES)('$name：市集寫法與打包 trade-stats.json 的第一筆相同', (entry) => {
    const bundledStats = readJson(
      `../public/json/${entry.version}/locales/${entry.locale}/trade-stats.json`,
    ).stats;
    const result = parseLiveStatLabels(entry.stats);
    const compared = Object.keys(result!.stats).filter((id) => id in bundledStats);
    expect(compared.length).toBeGreaterThan(0);
    for (const id of compared) {
      const bundled = bundledStats[id];
      expect(result!.stats[id]).toBe(Array.isArray(bundled) ? bundled[0] : bundled);
    }
  });

  it.each(CASES)('$name：pseudo 文字與打包 trade-filters.json 的 pseudoStats 相同', (entry) => {
    const result = parseLiveStatLabels(entry.stats);
    const ids = Object.keys(result!.pseudoStats);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(result!.pseudoStats[id]).toBe(entry.bundled.pseudoStats[id]);
    // pseudo 也是市集寫法的一部分
    expect(result!.stats[ids[0]]).toBe(result!.pseudoStats[ids[0]]);
  });

  it.each([
    ['不是陣列', {}],
    ['缺少 pseudo 群組', [{ id: 'explicit', entries: [{ id: 'explicit.stat_1', text: 'x' }] }]],
    ['條目缺少 id', [{ id: 'pseudo', entries: [{ text: 'x' }] }]],
    ['文字不是字串', [{ id: 'pseudo', entries: [{ id: 'pseudo.a', text: ['x'] }] }]],
    [
      'pseudo 同 id 文字不同',
      [
        {
          id: 'pseudo',
          entries: [
            { id: 'pseudo.a', text: 'A' },
            { id: 'pseudo.a', text: 'B' },
          ],
        },
      ],
    ],
    [
      '條目總數過多',
      [
        { id: 'pseudo', entries: [{ id: 'pseudo.a', text: 'A' }] },
        {
          id: 'explicit',
          entries: Array.from({ length: LIVE_TRADE_DATA_LIMITS.maxStatEntries }, (_, i) => ({
            id: `explicit.stat_${i}`,
            text: 'x',
          })),
        },
      ],
    ],
  ])('%s時整份回傳 null', (_label, input) => {
    expect(parseLiveStatLabels(input)).toBeNull();
  });
});
