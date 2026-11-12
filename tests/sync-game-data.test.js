import { describe, expect, it } from 'vitest';
import { validateGameDataBatch, validateMercenaryBatch } from '../scripts/sync-game-data.mjs';

const batch = (overrides = {}) => ({
  modsTiers: { patch: '1.0', tiers: [{}, {}] },
  stats: {
    en: { patch: '1.0', tierTemplates: [0, 1] },
    'zh-TW': { patch: '1.0', tierTemplates: [0, 1] },
  },
  items: {
    en: { patch: '1.0', items: ['A', 'B', 'C'] },
    'zh-CN': { patch: '1.0', items: ['甲', '乙', '丙'] },
  },
  ...overrides,
});

describe('validateGameDataBatch', () => {
  it('accepts a batch built from one patch with aligned lengths', () => {
    expect(validateGameDataBatch(batch())).toEqual([]);
  });

  it('rejects shards from a different patch or with misaligned lengths', () => {
    const errors = validateGameDataBatch(
      batch({
        stats: { en: { patch: '0.9', tierTemplates: [0] } },
        items: {
          en: { patch: '1.0', items: ['A', 'B'] },
          'zh-CN': { patch: '1.0', items: ['甲'] },
        },
      }),
    );
    expect(errors).toEqual([
      'stats.json (en) patch 0.9 ≠ 1.0',
      'stats.json (en) tierTemplates 1 筆 ≠ tiers 2 筆',
      'items.json (zh-CN) 1 筆 ≠ en 2 筆',
    ]);
  });

  it('validates optional mod-lines shards (same patch, matching locale, lines object)', () => {
    const modLines = {
      'zh-TW': { schemaVersion: 1, patch: '1.0', locale: 'zh-TW', lines: {} },
      'zh-CN': { schemaVersion: 1, patch: '0.9', locale: 'zh-TW', lines: [] },
    };
    expect(validateGameDataBatch(batch({ modLines }))).toEqual([
      'mod-lines.json (zh-CN) patch 0.9 ≠ 1.0',
      'mod-lines.json (zh-CN) 語系或格式不符',
    ]);
  });

  it('rejects mods-tiers without a patch', () => {
    expect(validateGameDataBatch(batch({ modsTiers: { tiers: [{}, {}] } }))).toContain(
      'mods-tiers.json 缺少 patch',
    );
  });
});

describe('validateMercenaryBatch', () => {
  const names = (patch, n = 1) => ({
    patch,
    builds: Array(n).fill('B'),
    skills: ['S', 'T'],
    supports: ['U'],
  });
  const mercenary = (overrides = {}) => ({
    data: { patch: '2.0', builds: [{}], skills: [{}, {}], supports: [{}] },
    names: { en: names('2.0'), 'zh-TW': names('2.0') },
    ...overrides,
  });

  it('accepts names aligned with the structure file regardless of the mods patch', () => {
    expect(validateMercenaryBatch(mercenary())).toEqual([]);
  });

  it('rejects names from another patch or with misaligned lengths', () => {
    expect(
      validateMercenaryBatch(mercenary({ names: { en: names('2.0'), ja: names('1.9', 2) } })),
    ).toEqual(['mercenary.json (ja) patch 1.9 ≠ 2.0', 'mercenary.json (ja) builds 2 筆 ≠ 1 筆']);
  });

  it('requires the English names', () => {
    expect(validateMercenaryBatch(mercenary({ names: {} }))).toContain('缺少 en/mercenary.json');
  });
});
