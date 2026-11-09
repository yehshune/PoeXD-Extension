import { describe, expect, it } from 'vitest';
import { buildReleaseNotes, parseCommitSubject } from '../scripts/release-notes.mjs';

describe('release-notes', () => {
  it('parses conventional commit subjects with optional scope and breaking marker', () => {
    expect(parseCommitSubject('feat(bookmark): add folders')).toEqual({
      type: 'feat',
      scope: 'bookmark',
      breaking: false,
      description: 'add folders',
    });
    expect(parseCommitSubject('fix!: drop legacy store')).toEqual({
      type: 'fix',
      scope: undefined,
      breaking: true,
      description: 'drop legacy store',
    });
    expect(parseCommitSubject('Merge branch main')).toEqual({
      type: 'other',
      scope: undefined,
      breaking: false,
      description: 'Merge branch main',
    });
  });

  it('groups commits by type in a fixed order and skips noise', () => {
    const notes = buildReleaseNotes(
      [
        'chore: bump deps',
        'fix(live-search): reconnect after sleep',
        'feat(bookmark): add folders',
        'feat: support Firefox MV3',
        'perf: cache stat dictionary',
        'ci: add release workflow',
        'docs: update readme',
        'random subject',
      ],
      { version: '1.1.0', previousTag: 'v1.0.0', repo: 'yehshune/PoeXD-Extension' },
    );

    const featIndex = notes.indexOf('### ✨ 新功能 / Features');
    const fixIndex = notes.indexOf('### 🐛 修正 / Fixes');
    const perfIndex = notes.indexOf('### ⚡ 效能 / Performance');
    expect(featIndex).toBeGreaterThan(-1);
    expect(fixIndex).toBeGreaterThan(featIndex);
    expect(perfIndex).toBeGreaterThan(fixIndex);
    expect(notes).toContain('- **bookmark**: add folders');
    expect(notes).toContain('- support Firefox MV3');
    expect(notes).toContain('- **live-search**: reconnect after sleep');
    expect(notes).toContain('- random subject');
    expect(notes).not.toContain('bump deps');
    expect(notes).not.toContain('add release workflow');
    expect(notes).not.toContain('update readme');
    expect(notes).toContain('https://github.com/yehshune/PoeXD-Extension/compare/v1.0.0...v1.1.0');
  });

  it('highlights breaking changes and handles the first release', () => {
    const notes = buildReleaseNotes(['feat!: new storage format'], {
      version: '1.0.0',
      repo: 'yehshune/PoeXD-Extension',
    });
    expect(notes).toContain('### ⚠️ 不相容變更 / Breaking changes');
    expect(notes).toContain('- new storage format');
    expect(notes).not.toContain('/compare/');
  });

  it('falls back to a maintenance note when nothing user-facing changed', () => {
    const notes = buildReleaseNotes(['chore: tidy'], { version: '1.0.1', repo: 'a/b' });
    expect(notes).toContain('維護性更新');
  });
});
