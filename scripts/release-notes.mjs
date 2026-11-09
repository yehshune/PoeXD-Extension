/**
 * 依 Conventional Commits 前綴產生 GitHub Release 說明。
 *
 * 用法：node scripts/release-notes.mjs <version> [previousTag] > notes.md
 * 未指定 previousTag 時自動取上一個 v* tag；找不到則列出全部歷史（首次發布）。
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SECTIONS = [
  { key: 'breaking', title: '### ⚠️ 不相容變更 / Breaking changes' },
  { key: 'feat', title: '### ✨ 新功能 / Features' },
  { key: 'fix', title: '### 🐛 修正 / Fixes' },
  { key: 'perf', title: '### ⚡ 效能 / Performance' },
  { key: 'other', title: '### 其他 / Other' },
];

/** 不出現在使用者看的 release notes 中的類型 */
const HIDDEN_TYPES = new Set(['chore', 'ci', 'docs', 'style', 'test', 'build', 'refactor']);

const SUBJECT_PATTERN = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/;

export function parseCommitSubject(subject) {
  const match = SUBJECT_PATTERN.exec(subject.trim());
  if (!match) {
    return { type: 'other', scope: undefined, breaking: false, description: subject.trim() };
  }
  const [, type, scope, bang, description] = match;
  return { type: type.toLowerCase(), scope, breaking: Boolean(bang), description };
}

function formatEntry({ scope, description }) {
  return scope ? `- **${scope}**: ${description}` : `- ${description}`;
}

function sectionKeyOf(commit) {
  if (commit.breaking) return 'breaking';
  if (commit.type === 'feat' || commit.type === 'fix' || commit.type === 'perf') return commit.type;
  if (HIDDEN_TYPES.has(commit.type)) return null;
  return 'other';
}

export function buildReleaseNotes(subjects, { version, previousTag, repo }) {
  const grouped = new Map(SECTIONS.map(({ key }) => [key, []]));
  for (const subject of subjects) {
    const commit = parseCommitSubject(subject);
    const key = sectionKeyOf(commit);
    if (key) grouped.get(key).push(formatEntry(commit));
  }

  const blocks = SECTIONS.filter(({ key }) => grouped.get(key).length > 0).map(({ key, title }) =>
    [title, '', ...grouped.get(key)].join('\n'),
  );
  if (blocks.length === 0) {
    blocks.push(
      '維護性更新，無使用者可見變更。 / Maintenance release with no user-facing changes.',
    );
  }

  const tag = `v${version}`;
  if (previousTag) {
    blocks.push(`**Full changelog**: https://github.com/${repo}/compare/${previousTag}...${tag}`);
  }
  return `${blocks.join('\n\n')}\n`;
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function findPreviousTag(currentTag) {
  const tags = git(['tag', '--list', 'v*', '--sort=-v:refname'])
    .split('\n')
    .filter((t) => t && t !== currentTag);
  return tags[0];
}

function main() {
  const [version, explicitPrevious] = process.argv.slice(2);
  if (!version) throw new Error('用法：node scripts/release-notes.mjs <version> [previousTag]');
  const previousTag = explicitPrevious || findPreviousTag(`v${version}`);
  const range = previousTag ? [`${previousTag}..HEAD`] : [];
  const subjects = git(['log', ...range, '--no-merges', '--pretty=%s'])
    .split('\n')
    .filter(Boolean);
  const repo = process.env.GITHUB_REPOSITORY || 'yehshune/PoeXD-Extension';
  process.stdout.write(buildReleaseNotes(subjects, { version, previousTag, repo }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
