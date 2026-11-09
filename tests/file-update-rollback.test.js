import { describe, expect, it, vi } from 'vitest';
import { replaceFilesWithRollback } from '../scripts/file-update-rollback.mjs';

describe('file update rollback', () => {
  it('restores every destination when a commit rename fails', async () => {
    const files = new Map([
      ['first.json', 'old-first'],
      ['second.json', 'old-second'],
    ]);
    const rename = vi.fn(async (from, to) => {
      if (from.includes(`.tmp-${process.pid}`) && to === 'second.json') {
        throw new Error('rename failed');
      }
      if (!files.has(from)) throw new Error(`missing: ${from}`);
      files.set(to, files.get(from));
      files.delete(from);
    });
    const operations = {
      mkdir: vi.fn(async () => {}),
      writeFile: vi.fn(async (path, content) => files.set(path, content)),
      rename,
      rm: vi.fn(async (path) => files.delete(path)),
    };

    await expect(
      replaceFilesWithRollback(
        [
          { path: 'first.json', content: 'new-first' },
          { path: 'second.json', content: 'new-second' },
        ],
        operations,
      ),
    ).rejects.toThrow('rename failed');

    expect(files.get('first.json')).toBe('old-first');
    expect(files.get('second.json')).toBe('old-second');
    expect(
      [...files.keys()].filter((path) => path.includes('.tmp-') || path.includes('.bak-')),
    ).toEqual([]);
  });

  it('creates files that do not exist yet and removes them on rollback', async () => {
    const files = new Map([['existing.json', 'old']]);
    let failCommit = false;
    const rename = vi.fn(async (from, to) => {
      if (failCommit && from.includes('.tmp-') && to === 'existing.json') {
        throw new Error('rename failed');
      }
      if (!files.has(from)) throw Object.assign(new Error(`missing: ${from}`), { code: 'ENOENT' });
      files.set(to, files.get(from));
      files.delete(from);
    });
    const operations = {
      mkdir: vi.fn(async () => {}),
      writeFile: vi.fn(async (path, content) => files.set(path, content)),
      rename,
      rm: vi.fn(async (path) => files.delete(path)),
    };
    const writes = [
      { path: 'new.json', content: 'created' },
      { path: 'existing.json', content: 'new' },
    ];

    await replaceFilesWithRollback(writes, operations);
    expect(Object.fromEntries(files)).toEqual({ 'new.json': 'created', 'existing.json': 'new' });

    files.clear();
    files.set('existing.json', 'old');
    failCommit = true;
    await expect(replaceFilesWithRollback(writes, operations)).rejects.toThrow('rename failed');
    expect(Object.fromEntries(files)).toEqual({ 'existing.json': 'old' });
  });
});
