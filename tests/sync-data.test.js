import { describe, expect, it } from 'vitest';
import { validateGameDataBatch, validateMercenaryBatch } from '../scripts/sync-data.mjs';

const stats = (locale, patch = '1.0', templates = ['A', 'B']) => ({
  schemaVersion: 2,
  patch,
  locale,
  templates,
});
const lines = (locale, body = {}, patch = '1.0') => ({ schemaVersion: 2, patch, locale, lines: body });

const batch = (overrides = {}) => ({
  modsTiers: {
    schemaVersion: 2,
    patch: '1.0',
    tiers: [{}, {}],
    templateCount: 2,
    tierTemplates: [0, 1],
    statTemplates: {},
  },
  stats: { en: stats('en'), 'zh-TW': stats('zh-TW') },
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
        stats: { en: stats('en', '0.9', ['A']), 'zh-TW': { ...stats('zh-TW'), schemaVersion: 1 } },
        items: {
          en: { patch: '1.0', items: ['A', 'B'] },
          'zh-CN': { patch: '1.0', items: ['甲'] },
        },
      }),
    );
    expect(errors).toEqual([
      'stats.json (en) patch 0.9 ≠ 1.0',
      'stats.json (en) templates 1 筆 ≠ templateCount 2 筆',
      'stats.json (zh-TW) 語系或格式不符',
      'items.json (zh-CN) 1 筆 ≠ en 2 筆',
    ]);
  });

  it('rejects mods-tiers without a shared template index covering every tier', () => {
    const modsTiers = { patch: '1.0', tiers: [{}, {}] };
    expect(validateGameDataBatch(batch({ modsTiers, stats: {} }))).toEqual([
      'mods-tiers.json 缺少共用模板索引',
    ]);
    const partial = { ...batch().modsTiers, tierTemplates: [0] };
    expect(validateGameDataBatch(batch({ modsTiers: partial }))).toEqual([
      'mods-tiers.json tierTemplates 1 筆 ≠ tiers 2 筆',
    ]);
  });

  it('requires localized line shards to align with the shared English shard', () => {
    const modLines = {
      en: lines('en', { 1: ['A', 'B'] }),
      'zh-TW': lines('zh-TW', { 1: ['甲'], 2: ['丙'] }),
    };
    expect(validateGameDataBatch(batch({ modLines }))).toEqual([
      'mod-lines.json (zh-TW) 2 個 hash 與 en 對不齊（例如 1）',
    ]);
    expect(validateGameDataBatch(batch({ statText: { 'zh-TW': lines('zh-TW') } }))).toEqual([
      '缺少 en/stat-text-items.json，無法還原英文',
    ]);
  });

  it('validates optional mod-lines shards (same patch, matching locale, lines object)', () => {
    const modLines = {
      en: lines('en'),
      'zh-TW': lines('zh-TW'),
      'zh-CN': { ...lines('zh-TW', {}, '0.9'), lines: [] },
    };
    expect(validateGameDataBatch(batch({ modLines }))).toEqual([
      'mod-lines.json (zh-CN) patch 0.9 ≠ 1.0',
      'mod-lines.json (zh-CN) 語系或格式不符',
    ]);
  });

  it('驗證 stat-text-items 分片與 stat-aliases 檔', () => {
    const statText = { en: lines('en'), 'zh-TW': lines('zh-TW'), 'zh-CN': lines('zh-CN', {}, '0.9') };
    expect(
      validateGameDataBatch(
        batch({ statText, statAliases: { schemaVersion: 1, patch: '0.9', aliases: [] } }),
      ),
    ).toEqual([
      'stat-text-items.json (zh-CN) patch 0.9 ≠ 1.0',
      'stat-aliases.json patch 0.9 ≠ 1.0',
      'stat-aliases.json 格式不符',
    ]);
    expect(
      validateGameDataBatch(
        batch({ statAliases: { schemaVersion: 1, patch: '1.0', aliases: {} } }),
      ),
    ).toEqual([]);
  });

  it('validates optional result-labels shards (labels object, templates array)', () => {
    const resultLabels = {
      'zh-TW': {
        schemaVersion: 1,
        patch: '1.0',
        locale: 'zh-TW',
        labels: {},
        templates: [],
      },
      'zh-CN': {
        schemaVersion: 1,
        patch: '1.0',
        locale: 'zh-CN',
        labels: {},
        templates: {},
      },
    };
    expect(validateGameDataBatch(batch({ resultLabels }))).toEqual([
      'result-labels.json (zh-CN) 語系或格式不符',
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
