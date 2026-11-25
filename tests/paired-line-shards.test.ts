import { describe, expect, it, vi } from 'vitest';
import {
  joinAlignedLines,
  loadEnglishLines,
  loadPairedLineShard,
} from '@/utils/paired-line-shards';

const aligned = (locale: string, lines: Record<string, unknown>, patch = '1.0') => ({
  schemaVersion: 2,
  patch,
  locale,
  lines,
});

const loaderFor = (files: Record<string, unknown>) =>
  vi.fn(async (path: string) => {
    if (!(path in files)) throw new Error(`${path}: HTTP 404`);
    return files[path];
  });

describe('joinAlignedLines', () => {
  it('依位置把英文與譯文配成句型對，略過 null 與對不齊的 hash', () => {
    expect(
      joinAlignedLines(
        { '1': ['A', 'B'], '2': ['C'], '3': ['D'] },
        { '1': ['甲', null], '2': ['丙', '多'], '3': [null] },
      ),
    ).toEqual({ '1': [['A', '甲']] });
  });
});

describe('loadPairedLineShard', () => {
  it('讀取語系分片與 en 分片，還原成 [英文, 譯文] 句型對', async () => {
    const loadJson = loaderFor({
      'json/poe1/locales/zh-TW/mod-lines.json': aligned('zh-TW', { '1': ['甲', null] }),
      'json/poe1/locales/en/mod-lines.json': aligned('en', { '1': ['A', 'B'] }),
    });
    await expect(loadPairedLineShard(loadJson, 'mod-lines', 'poe1', 'zh-TW')).resolves.toEqual({
      patch: '1.0',
      locale: 'zh-TW',
      lines: { '1': [['A', '甲']] },
    });
  });

  it('stat-text-items 與 stat-text-passives 使用各自的檔名', async () => {
    const loadJson = loaderFor({
      'json/poe2/locales/zh-CN/stat-text-passives.json': aligned('zh-CN', { '9': ['甲'] }),
      'json/poe2/locales/en/stat-text-passives.json': aligned('en', { '9': ['A'] }),
    });
    const shard = await loadPairedLineShard(loadJson, 'stat-text-passives', 'poe2', 'zh-CN');
    expect(shard.lines).toEqual({ '9': [['A', '甲']] });
  });

  it('語系分片不是 schemaVersion 2 或語系不符時拒絕', async () => {
    const en = aligned('en', { '1': ['A'] });
    const load = (zh: unknown) =>
      loadPairedLineShard(
        loaderFor({
          'json/poe1/locales/zh-TW/mod-lines.json': zh,
          'json/poe1/locales/en/mod-lines.json': en,
        }),
        'mod-lines',
        'poe1',
        'zh-TW',
      );
    await expect(load({ schemaVersion: 1, patch: '1.0', locale: 'zh-TW', lines: {} })).rejects.toThrow('格式不符');
    await expect(load(aligned('zh-CN', { '1': ['甲'] }))).rejects.toThrow('語系不符');
  });

  it('en 分片缺少、來自不同 patch 或格式不符時拒絕', async () => {
    const zh = aligned('zh-TW', { '1': ['甲'] });
    await expect(
      loadPairedLineShard(loaderFor({ 'json/poe1/locales/zh-TW/mod-lines.json': zh }), 'mod-lines', 'poe1', 'zh-TW'),
    ).rejects.toThrow();
    await expect(
      loadPairedLineShard(
        loaderFor({
          'json/poe1/locales/zh-TW/mod-lines.json': zh,
          'json/poe1/locales/en/mod-lines.json': aligned('en', { '1': ['A'] }, '0.9'),
        }),
        'mod-lines',
        'poe1',
        'zh-TW',
      ),
    ).rejects.toThrow('patch');
  });
});

describe('loadEnglishLines', () => {
  it('只讀 en 分片的英文模板', async () => {
    const loadJson = loaderFor({
      'json/poe1/locales/en/mod-lines.json': aligned('en', { '1': ['A', 'B'] }),
    });
    await expect(loadEnglishLines(loadJson, 'mod-lines', 'poe1')).resolves.toEqual({ '1': ['A', 'B'] });
  });
});
