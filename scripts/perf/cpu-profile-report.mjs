#!/usr/bin/env node
/**
 * 把 cpu-profile.mjs 的輸出歸因：導航開始後 N 毫秒內，CPU 時間花在哪些腳本、
 * 以及擴充功能 content script 裡哪些函式（inclusive，同一個堆疊只算一次）。
 *
 *   node scripts/perf/cpu-profile-report.mjs .perf/before [--window 3000] [--top 30]
 */
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    window: { type: 'string', default: '3000' },
    top: { type: 'string', default: '30' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (args.help || positionals.length !== 1) {
  console.log(
    '用法：node scripts/perf/cpu-profile-report.mjs <輸出前綴> [--window <ms>] [--top <n>]',
  );
  process.exit(args.help ? 0 : 1);
}

const prefix = positionals[0];
const windowMs = Number(args.window);
const top = Number(args.top);
if (!(windowMs > 0) || !(top > 0)) throw new Error('--window 與 --top 必須是正數');

const profile = JSON.parse(await readFile(`${prefix}.cpuprofile`, 'utf8'));
const meta = JSON.parse(await readFile(`${prefix}.meta.json`, 'utf8'));
if (
  !Array.isArray(profile.nodes) ||
  !Array.isArray(profile.samples) ||
  typeof meta.navStartUs !== 'number'
) {
  throw new Error(`${prefix} 不是 cpu-profile.mjs 產生的檔案`);
}

const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
const parentOf = new Map();
for (const node of profile.nodes)
  for (const child of node.children ?? []) parentOf.set(child, node.id);

const shortUrl = (url) =>
  url
    .replace(/^chrome-extension:\/\/[a-z]+\//, 'EXT/')
    .replace(/^https:\/\/[^/]+\//, '')
    .replace(/\?.*$/, '')
    .slice(-48);
const isContentScript = (url) => /^EXT\/content-scripts\//.test(shortUrl(url));
const frameKey = (frame) =>
  `${frame.functionName || '(anonymous)'} ${shortUrl(frame.url)}:${frame.lineNumber + 1}`;

const byScript = new Map();
const extInclusive = new Map();
const extSelf = new Map();
const add = (map, key, value) => map.set(key, (map.get(key) ?? 0) + value);

let timestamp = profile.startTime;
profile.samples.forEach((sample, index) => {
  timestamp += profile.timeDeltas[index];
  const atMs = (timestamp - meta.navStartUs) / 1000;
  if (atMs < 0 || atMs > windowMs) return;
  const duration = (profile.timeDeltas[index + 1] ?? 0) / 1000;

  let owner;
  const seen = new Set();
  for (let id = sample; id != null; id = parentOf.get(id)) {
    const frame = nodes.get(id).callFrame;
    if (frame.url && owner == null) owner = shortUrl(frame.url);
    if (isContentScript(frame.url)) {
      const key = frameKey(frame);
      if (!seen.has(key)) {
        seen.add(key);
        add(extInclusive, key, duration);
      }
    }
  }
  const leaf = nodes.get(sample).callFrame;
  add(byScript, owner ?? (leaf.functionName || '(native)'), duration);
  if (isContentScript(leaf.url)) add(extSelf, frameKey(leaf), duration);
});

const table = (map, limit) =>
  [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, ms]) => `${ms.toFixed(0).padStart(6)} ms  ${key}`)
    .join('\n') || '  （無）';

console.log(
  `${prefix}  rowsFirst=${meta.rowsFirst}ms quiet=${meta.quiet}ms  區間 0..${windowMs}ms`,
);
console.log(`\n== 依腳本\n${table(byScript, 15)}`);
console.log(`\n== content script 函式（inclusive）\n${table(extInclusive, top)}`);
console.log(`\n== content script 函式（self）\n${table(extSelf, Math.min(top, 15))}`);
