import { describe, expect, it } from 'vitest';
import {
  BATCH_IDS,
  batchOfDataPath,
  parseArgs,
  parseManifest,
  planSync,
  selectBatches,
  sha256Of,
  validateBatchContent,
} from '../scripts/sync-data.mjs';

const json = (value) => Buffer.from(JSON.stringify(value));

/** 一份最小但完整、批次一致的發布內容 */
function publishedFiles() {
  const files = {};
  for (const version of ['poe1', 'poe2']) {
    files[`${version}/mods-tiers.json`] = json({ patch: '1.0', tiers: [{}, {}] });
    files[`${version}/locales/en/stats.json`] = json({ patch: '1.0', tierTemplates: [0, 1] });
    files[`${version}/locales/zh-TW/stats.json`] = json({ patch: '1.0', tierTemplates: [0, 1] });
    files[`${version}/locales/en/items.json`] = json({ patch: '1.0', items: ['A'] });
    files[`${version}/locales/en/trade-filters.json`] = json({ schemaVersion: 3, fields: {} });
    files[`${version}/locales/en/trade-stats.json`] = json({ schemaVersion: 1, stats: {} });
  }
  files['poe1/mercenary.json'] = json({ patch: '1.0', builds: [{}], skills: [{}], supports: [{}] });
  files['poe1/locales/en/mercenary.json'] = json({
    patch: '1.0',
    builds: ['B'],
    skills: ['S'],
    supports: ['U'],
  });
  files['locales/zh-TW/trade-ui.json'] = json({ schemaVersion: 1, strings: {} });
  files['poe2/atlas_maps.json'] = json([]);
  return files;
}

function manifestOf(files, extra = {}) {
  return {
    manifestVersion: 1,
    generatedAt: '2026-11-13T00:00:00.000Z',
    sourceCommit: 'a'.repeat(40),
    batches: {
      'poe1/trade-filters': { builtAt: 'x', staleLocales: ['ko'] },
      'poe2/game': { patch: '1.0' },
    },
    files: Object.fromEntries(
      Object.entries(files)
        .filter(([path]) => batchOfDataPath(path))
        .map(([path, bytes]) => [
          path,
          { batch: batchOfDataPath(path), sha256: sha256Of(bytes), bytes: bytes.length },
        ]),
    ),
    ...extra,
  };
}

const io = (files, local = {}) => ({
  readFile: async (path) => {
    if (!(path in files)) throw new Error(`missing ${path}`);
    return files[path];
  },
  readLocal: async (path) => local[path] ?? null,
});

describe('batchOfDataPath', () => {
  it('maps every bundled data file to its batch', () => {
    expect(batchOfDataPath('poe1/mods-tiers.json')).toBe('poe1/game');
    expect(batchOfDataPath('poe2/locales/zh-CN/mod-lines.json')).toBe('poe2/game');
    expect(batchOfDataPath('poe1/locales/ja/mercenary.json')).toBe('poe1/mercenary');
    expect(batchOfDataPath('poe2/locales/ko/trade-filters.json')).toBe('poe2/trade-filters');
    expect(batchOfDataPath('locales/zh-CN/trade-ui.json')).toBe('market');
    expect(batchOfDataPath('poe1/locales/en/trade-static.json')).toBe('market');
  });

  it('rejects anything outside the whitelist, including traversal attempts', () => {
    for (const path of [
      'manifest.json',
      'version.json',
      'poe2/atlas_maps.json',
      'poe2/mercenary.json',
      '../package.json',
      'poe1/locales/../../package.json',
      'poe1/locales/en/stats.json/../../x.json',
      '/etc/passwd',
      'poe1\\mods-tiers.json',
    ]) {
      expect(batchOfDataPath(path), path).toBeNull();
    }
  });
});

describe('parseManifest', () => {
  it('groups whitelisted files by batch and ignores the rest', () => {
    const manifest = parseManifest(manifestOf(publishedFiles()));
    expect(Object.keys(manifest.batches).sort()).toEqual([...BATCH_IDS].sort());
    expect(manifest.sourceCommit).toBe('a'.repeat(40));
    expect(
      Object.values(manifest.batches)
        .flat()
        .some((file) => file.path.includes('atlas')),
    ).toBe(false);
  });

  it('rejects unknown manifest versions and mismatched batches', () => {
    expect(() => parseManifest({ ...manifestOf({}), manifestVersion: 2 })).toThrow(
      'manifestVersion',
    );
    const tampered = manifestOf(publishedFiles());
    tampered.files['poe1/mods-tiers.json'].batch = 'market';
    expect(() => parseManifest(tampered)).toThrow('預期 poe1/game');
  });

  it('rejects invalid hashes and sizes', () => {
    const badHash = manifestOf(publishedFiles());
    badHash.files['poe1/mods-tiers.json'].sha256 = 'nope';
    expect(() => parseManifest(badHash)).toThrow('sha256');
    const huge = manifestOf(publishedFiles());
    huge.files['poe1/mods-tiers.json'].bytes = 64 * 1024 * 1024;
    expect(() => parseManifest(huge)).toThrow('大小無效');
  });
});

describe('planSync', () => {
  it('writes only changed files of valid batches and reports stale locales', async () => {
    const files = publishedFiles();
    const manifest = parseManifest(manifestOf(files));
    const local = { 'poe1/mods-tiers.json': files['poe1/mods-tiers.json'] };
    const plan = await planSync(manifest, ['poe1/game', 'poe1/trade-filters'], io(files, local));
    expect(plan.failures).toEqual([]);
    expect(plan.unchanged).toBe(1);
    expect(plan.writes.map((write) => write.path).sort()).toEqual([
      'poe1/locales/en/items.json',
      'poe1/locales/en/stats.json',
      'poe1/locales/en/trade-filters.json',
      'poe1/locales/zh-TW/stats.json',
    ]);
    expect(plan.notes.find((note) => note.startsWith('poe1/trade-filters'))).toContain('ko');
  });

  it('skips a batch whose download does not match the manifest, keeping the others', async () => {
    const files = publishedFiles();
    const manifest = parseManifest(manifestOf(files));
    const corrupted = { ...files, 'poe2/locales/en/stats.json': json({ patch: '9.9' }) };
    const plan = await planSync(manifest, ['poe1/game', 'poe2/game'], io(corrupted));
    expect(plan.synced).toEqual(['poe1/game']);
    expect(plan.failures).toHaveLength(1);
    expect(plan.failures[0]).toMatch(/^poe2\/game: .*(大小|sha256)/);
    expect(plan.writes.every((write) => write.path.startsWith('poe1/'))).toBe(true);
  });

  it('skips a batch that is internally inconsistent even when hashes match', async () => {
    const files = {
      ...publishedFiles(),
      'poe2/locales/zh-TW/stats.json': json({ patch: '0.9', tierTemplates: [0, 1] }),
    };
    const plan = await planSync(parseManifest(manifestOf(files)), ['poe2/game'], io(files));
    expect(plan.writes).toEqual([]);
    expect(plan.failures[0]).toContain('stats.json (zh-TW) patch 0.9 ≠ 1.0');
  });

  it('reports batches missing from the manifest', async () => {
    const plan = await planSync(parseManifest(manifestOf({})), ['market'], io({}));
    expect(plan.failures).toEqual(['market: manifest 中沒有這個批次']);
  });
});

describe('validateBatchContent', () => {
  it('requires the English fallback for trade batches', () => {
    expect(validateBatchContent('poe2/trade-filters', {})).toEqual([
      '缺少 poe2/locales/en/trade-filters.json',
    ]);
    expect(validateBatchContent('market', { 'poe1/locales/en/trade-stats.json': {} })).toEqual([
      '缺少 poe2/locales/en/trade-stats.json',
    ]);
  });
});

describe('arguments', () => {
  it('selects all batches by default and filters by batch or game version', () => {
    expect(selectBatches(parseArgs([]))).toEqual([...BATCH_IDS]);
    expect(selectBatches(parseArgs(['--version', 'poe1']))).toEqual([
      'poe1/game',
      'poe1/mercenary',
      'poe1/trade-filters',
    ]);
    expect(selectBatches(parseArgs(['--batch', 'market']))).toEqual(['market']);
  });

  it('validates refs, batches and conflicting sources', () => {
    expect(() => parseArgs(['--ref', 'main'])).toThrow('commit SHA');
    expect(() => parseArgs(['--batch', 'poe3/game'])).toThrow('未知的批次');
    expect(() => parseArgs(['--ref', 'a'.repeat(40), '--source', 'x'])).toThrow('不能同時使用');
    expect(() => parseArgs(['--version'])).toThrow('需要參數');
  });
});
