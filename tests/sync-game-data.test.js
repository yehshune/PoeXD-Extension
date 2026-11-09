import { describe, expect, it } from 'vitest';
import { validateGameDataBatch } from '../scripts/sync-game-data.mjs';

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

  it('rejects mods-tiers without a patch', () => {
    expect(validateGameDataBatch(batch({ modsTiers: { tiers: [{}, {}] } }))).toContain(
      'mods-tiers.json 缺少 patch',
    );
  });
});
