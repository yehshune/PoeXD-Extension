/**
 * 從 poexd-data 的發布內容同步 public/json/（docs/architecture/data-unification-plan.md 第 5.1 節）。
 *
 * 來源：
 * - 遠端（預設）：GitHub 上 gh-pages 的某個 commit。以 commit SHA 組網址，內容固定不變，
 *   不受 jsDelivr 分支快取影響；一律透過 HTTP 取得，避免本機 git 的換行轉換改變內容。
 * - 本機：`--source <dir>`，指向 poexd-data 的 output/（開發用）。
 *
 * 依 manifest.json 驗證每個檔案的 sha256 與大小，再依批次檢查一致性（同一 patch、索引對齊），
 * 通過的批次整批寫入；任一批次失敗時該批次不寫入，並以非零狀態結束。
 * 只接受白名單路徑：manifest 裡其他檔案（atlas、icons 等）一律忽略。
 *
 * 用法：
 *   node scripts/sync-data.mjs                       最新 gh-pages commit
 *   node scripts/sync-data.mjs --ref <sha>           指定 commit（重現某次同步）
 *   node scripts/sync-data.mjs --source <dir>        本機 poexd-data/output
 *   node scripts/sync-data.mjs --batch poe2/game     只同步指定批次（可重複）
 *   node scripts/sync-data.mjs --version poe1        只同步指定遊戲版本的批次
 *
 * 完整同步遠端內容時會寫入 public/json/data-source.json，記錄資料來自哪一次發布。
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { replaceFilesWithRollback } from './file-update-rollback.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TARGET_DIR = join(ROOT, 'public/json');
const DATA_REPO = 'yehshune/poexd-data';
const PUBLISH_BRANCH = 'gh-pages';
const SUPPORTED_MANIFEST_VERSION = 1;
const DATA_SOURCE_FILE = 'data-source.json';
const REQUEST_TIMEOUT_MS = 60000;
/** 單檔大小上限：目前最大的 poe1/mods-tiers.json 約 3.7MB */
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const COMMIT_SHA = /^[0-9a-f]{40}$/;

export const GAME_VERSIONS = Object.freeze(['poe1', 'poe2']);
export const BATCH_IDS = Object.freeze([
  'poe1/game',
  'poe2/game',
  'poe1/mercenary',
  'poe1/trade-filters',
  'poe2/trade-filters',
  'market',
]);

// ── 路徑白名單 ────────────────────────────────────────────

const LOCALE = '[A-Za-z]{2}(?:-[A-Za-z]{2})?';
const VERSION = '(poe1|poe2)';
const PATH_RULES = [
  [new RegExp(`^${VERSION}/mods-tiers\\.json$`), (m) => `${m[1]}/game`],
  [
    new RegExp(`^${VERSION}/locales/${LOCALE}/(?:stats|items|mod-lines|result-labels)\\.json$`),
    (m) => `${m[1]}/game`,
  ],
  [/^poe1\/mercenary\.json$/, () => 'poe1/mercenary'],
  [new RegExp(`^poe1/locales/${LOCALE}/mercenary\\.json$`), () => 'poe1/mercenary'],
  [
    new RegExp(`^${VERSION}/locales/${LOCALE}/trade-filters\\.json$`),
    (m) => `${m[1]}/trade-filters`,
  ],
  [new RegExp(`^locales/${LOCALE}/trade-ui\\.json$`), () => 'market'],
  [new RegExp(`^${VERSION}/locales/${LOCALE}/trade-(?:stats|static)\\.json$`), () => 'market'],
];

/** 回傳資料檔所屬批次；不在白名單內的路徑回傳 null（與 poexd-data 的 src/publish/catalog.ts 一致） */
export function batchOfDataPath(path) {
  for (const [pattern, toBatch] of PATH_RULES) {
    const match = pattern.exec(path);
    if (match) return toBatch(match);
  }
  return null;
}

// ── 批次一致性 ────────────────────────────────────────────

/**
 * 檢查一個版本的整批分片是否一致；回傳錯誤訊息陣列（空陣列表示一致）。
 * @param {{ modsTiers: any, stats: Record<string, any>, items: Record<string, any>, modLines?: Record<string, any>, resultLabels?: Record<string, any> }} batch
 */
export function validateGameDataBatch(batch) {
  const errors = [];
  const patch = batch.modsTiers?.patch;
  const tierCount = batch.modsTiers?.tiers?.length;
  if (!patch) errors.push('mods-tiers.json 缺少 patch');
  if (!Number.isInteger(tierCount)) errors.push('mods-tiers.json 缺少 tiers');

  for (const [locale, shard] of Object.entries(batch.stats)) {
    if (shard?.patch !== patch) {
      errors.push(`stats.json (${locale}) patch ${shard?.patch ?? '缺少'} ≠ ${patch}`);
    }
    if (shard?.tierTemplates?.length !== tierCount) {
      errors.push(
        `stats.json (${locale}) tierTemplates ${shard?.tierTemplates?.length} 筆 ≠ tiers ${tierCount} 筆`,
      );
    }
  }

  const enItems = batch.items.en?.items?.length;
  if (Object.keys(batch.items).length > 0 && !Number.isInteger(enItems)) {
    errors.push('缺少 en/items.json，無法檢查物品分片對齊');
  }
  for (const [locale, shard] of Object.entries(batch.items)) {
    if (shard?.patch !== patch) {
      errors.push(`items.json (${locale}) patch ${shard?.patch ?? '缺少'} ≠ ${patch}`);
    }
    if (shard?.items?.length !== enItems) {
      errors.push(`items.json (${locale}) ${shard?.items?.length} 筆 ≠ en ${enItems} 筆`);
    }
  }
  const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
  const localeShards = [
    ['mod-lines.json', batch.modLines, (shard) => isObject(shard.lines)],
    [
      'result-labels.json',
      batch.resultLabels,
      (shard) => isObject(shard.labels) && Array.isArray(shard.templates),
    ],
  ];
  for (const [file, shards, hasValidBody] of localeShards) {
    for (const [locale, shard] of Object.entries(shards ?? {})) {
      if (shard?.patch !== patch) {
        errors.push(`${file} (${locale}) patch ${shard?.patch ?? '缺少'} ≠ ${patch}`);
      }
      if (shard?.schemaVersion !== 1 || shard?.locale !== locale || !hasValidBody(shard)) {
        errors.push(`${file} (${locale}) 語系或格式不符`);
      }
    }
  }
  return errors;
}

/**
 * 檢查傭兵資料批次；回傳錯誤訊息陣列（空陣列表示一致）。
 * @param {{ data: any, names: Record<string, any> }} batch
 */
export function validateMercenaryBatch(batch) {
  const errors = [];
  const patch = batch.data?.patch;
  if (!patch) errors.push('mercenary.json 缺少 patch');
  const lengths = {
    builds: batch.data?.builds?.length,
    skills: batch.data?.skills?.length,
    supports: batch.data?.supports?.length,
  };
  for (const [key, length] of Object.entries(lengths)) {
    if (!Number.isInteger(length) || length === 0) errors.push(`mercenary.json 缺少 ${key}`);
  }
  if (!batch.names.en) errors.push('缺少 en/mercenary.json');
  for (const [locale, shard] of Object.entries(batch.names)) {
    if (shard?.patch !== patch) {
      errors.push(`mercenary.json (${locale}) patch ${shard?.patch ?? '缺少'} ≠ ${patch}`);
    }
    for (const [key, length] of Object.entries(lengths)) {
      if (shard?.[key]?.length !== length) {
        errors.push(`mercenary.json (${locale}) ${key} ${shard?.[key]?.length} 筆 ≠ ${length} 筆`);
      }
    }
  }
  return errors;
}

const localeOf = (path) => /\/locales\/([^/]+)\//.exec(`/${path}`)?.[1];

/** 依批次 ID 檢查已解析的檔案內容；回傳錯誤訊息陣列 */
export function validateBatchContent(batchId, filesByPath) {
  const entries = Object.entries(filesByPath);
  if (batchId.endsWith('/game')) {
    const version = batchId.split('/')[0];
    const batch = {
      modsTiers: filesByPath[`${version}/mods-tiers.json`],
      stats: {},
      items: {},
      modLines: {},
      resultLabels: {},
    };
    const keyByFile = {
      'stats.json': 'stats',
      'items.json': 'items',
      'mod-lines.json': 'modLines',
      'result-labels.json': 'resultLabels',
    };
    for (const [path, data] of entries) {
      const key = keyByFile[path.split('/').pop()];
      if (key && localeOf(path)) batch[key][localeOf(path)] = data;
    }
    return validateGameDataBatch(batch);
  }
  if (batchId === 'poe1/mercenary') {
    const names = {};
    for (const [path, data] of entries) if (localeOf(path)) names[localeOf(path)] = data;
    return validateMercenaryBatch({ data: filesByPath['poe1/mercenary.json'], names });
  }
  // 篩選翻譯與市集漢化：en 是執行期後備語系，必須存在
  const required =
    batchId === 'market'
      ? GAME_VERSIONS.map((version) => `${version}/locales/en/trade-stats.json`)
      : [`${batchId.split('/')[0]}/locales/en/trade-filters.json`];
  return required.filter((path) => !(path in filesByPath)).map((path) => `缺少 ${path}`);
}

// ── manifest ─────────────────────────────────────────────

/** 檢查 manifest 結構，回傳以批次分組的檔案清單；路徑或批次對不上白名單時拒絕整份 manifest */
export function parseManifest(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('manifest.json 格式錯誤');
  if (raw.manifestVersion !== SUPPORTED_MANIFEST_VERSION) {
    throw new Error(
      `不支援的 manifestVersion：${raw.manifestVersion}（需要 ${SUPPORTED_MANIFEST_VERSION}）`,
    );
  }
  if (!raw.files || typeof raw.files !== 'object' || Array.isArray(raw.files)) {
    throw new Error('manifest.json 缺少 files');
  }
  const batches = {};
  for (const [path, entry] of Object.entries(raw.files)) {
    const expected = batchOfDataPath(path);
    if (!expected) continue;
    if (entry?.batch !== expected) {
      throw new Error(`manifest.json 中 ${path} 的批次為 ${entry?.batch}，預期 ${expected}`);
    }
    if (typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sha256)) {
      throw new Error(`manifest.json 中 ${path} 缺少有效的 sha256`);
    }
    if (!Number.isInteger(entry.bytes) || entry.bytes <= 0 || entry.bytes > MAX_FILE_BYTES) {
      throw new Error(`manifest.json 中 ${path} 的大小無效：${entry.bytes}`);
    }
    (batches[expected] ??= []).push({ path, sha256: entry.sha256, bytes: entry.bytes });
  }
  return {
    generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : undefined,
    sourceCommit:
      typeof raw.sourceCommit === 'string' && COMMIT_SHA.test(raw.sourceCommit)
        ? raw.sourceCommit
        : undefined,
    batchRecords: raw.batches && typeof raw.batches === 'object' ? raw.batches : {},
    batches,
  };
}

export const sha256Of = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * 依 manifest 取得並驗證選定的批次。
 * @param {{ readFile(path: string): Promise<Buffer>, readLocal(path: string): Promise<Buffer | null> }} io
 * @returns {Promise<{ writes: Array<{ path: string, content: Buffer }>, unchanged: number, synced: string[], failures: string[], notes: string[] }>}
 */
export async function planSync(manifest, selectedBatches, io) {
  const writes = [];
  const synced = [];
  const failures = [];
  const notes = [];
  let unchanged = 0;
  for (const batchId of selectedBatches) {
    const files = manifest.batches[batchId];
    if (!files || files.length === 0) {
      failures.push(`${batchId}: manifest 中沒有這個批次`);
      continue;
    }
    try {
      const contents = {};
      const parsed = {};
      for (const file of files) {
        const bytes = await io.readFile(file.path);
        if (bytes.length !== file.bytes)
          throw new Error(`${file.path} 大小 ${bytes.length} ≠ manifest ${file.bytes}`);
        if (sha256Of(bytes) !== file.sha256)
          throw new Error(`${file.path} sha256 與 manifest 不符`);
        contents[file.path] = bytes;
        parsed[file.path] = JSON.parse(bytes.toString('utf8'));
      }
      const errors = validateBatchContent(batchId, parsed);
      if (errors.length > 0) throw new Error(`批次不一致：\n    - ${errors.join('\n    - ')}`);

      let changed = 0;
      for (const [path, bytes] of Object.entries(contents)) {
        const local = await io.readLocal(path);
        if (local && local.equals(bytes)) {
          unchanged += 1;
          continue;
        }
        writes.push({ path, content: bytes });
        changed += 1;
      }
      const record = manifest.batchRecords[batchId];
      const stale =
        Array.isArray(record?.staleLocales) && record.staleLocales.length > 0
          ? `，沿用上一版：${record.staleLocales.join('、')}`
          : '';
      const patch = typeof record?.patch === 'string' ? `，patch ${record.patch}` : '';
      notes.push(`${batchId}: ${files.length} 個檔案，${changed} 個有變動${patch}${stale}`);
      synced.push(batchId);
    } catch (error) {
      failures.push(`${batchId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { writes, unchanged, synced, failures, notes };
}

// ── 來源 ─────────────────────────────────────────────────

const githubHeaders = () => {
  const token = process.env.GITHUB_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
};

async function fetchWithTimeout(url, headers = {}) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'PoeXD-Extension data sync', ...headers },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}（${url}）`);
  return response;
}

async function resolvePublishedCommit() {
  const response = await fetchWithTimeout(
    `https://api.github.com/repos/${DATA_REPO}/commits/${PUBLISH_BRANCH}`,
    { Accept: 'application/vnd.github.sha', ...githubHeaders() },
  );
  const sha = (await response.text()).trim();
  if (!COMMIT_SHA.test(sha)) throw new Error(`無法取得 ${PUBLISH_BRANCH} 的 commit SHA`);
  return sha;
}

function remoteReader(ref) {
  const base = `https://raw.githubusercontent.com/${DATA_REPO}/${ref}/`;
  return async (path) => {
    const response = await fetchWithTimeout(base + path);
    const declared = Number(response.headers.get('content-length'));
    if (declared > MAX_FILE_BYTES) throw new Error(`${path} 超過大小上限`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_FILE_BYTES) throw new Error(`${path} 超過大小上限`);
    return bytes;
  };
}

function localReader(dir) {
  return (path) => readFile(join(dir, path));
}

async function readLocal(path) {
  const full = join(TARGET_DIR, path);
  return existsSync(full) ? readFile(full) : null;
}

// ── CLI ──────────────────────────────────────────────────

export function parseArgs(argv) {
  const args = { ref: undefined, source: undefined, batches: [], versions: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${arg} 需要參數`);
      return next;
    };
    if (arg === '--ref') args.ref = value();
    else if (arg === '--source') args.source = resolve(value());
    else if (arg === '--batch') args.batches.push(value());
    else if (arg === '--version') args.versions.push(value());
    else throw new Error(`未知參數：${arg}`);
  }
  if (args.ref && args.source) throw new Error('--ref 與 --source 不能同時使用');
  if (args.ref && !COMMIT_SHA.test(args.ref)) throw new Error('--ref 必須是 40 字元的 commit SHA');
  for (const batch of args.batches) {
    if (!BATCH_IDS.includes(batch))
      throw new Error(`未知的批次：${batch}（可用：${BATCH_IDS.join('、')}）`);
  }
  for (const version of args.versions) {
    if (!GAME_VERSIONS.includes(version))
      throw new Error(`--version 必須是 ${GAME_VERSIONS.join(' 或 ')}`);
  }
  return args;
}

/** 依參數決定要同步的批次；沒有任何篩選時為全部批次 */
export function selectBatches({ batches, versions }) {
  let selected = batches.length > 0 ? [...batches] : [...BATCH_IDS];
  if (versions.length > 0) {
    selected = selected.filter((id) => versions.some((version) => id.startsWith(`${version}/`)));
  }
  return selected;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const ref = args.source ? undefined : (args.ref ?? (await resolvePublishedCommit()));
  const read = args.source ? localReader(args.source) : remoteReader(ref);
  process.stdout.write(args.source ? `來源：${args.source}\n` : `來源：${DATA_REPO}@${ref}\n`);

  const manifest = parseManifest(JSON.parse((await read('manifest.json')).toString('utf8')));
  const selected = selectBatches(args);
  const fullSync = selected.length === BATCH_IDS.length;
  const plan = await planSync(manifest, selected, { readFile: read, readLocal });

  const writes = plan.writes.map(({ path, content }) => ({
    path: join(TARGET_DIR, path),
    content,
  }));
  if (ref && fullSync && plan.failures.length === 0) {
    const dataSource = {
      ref,
      ...(manifest.sourceCommit ? { sourceCommit: manifest.sourceCommit } : {}),
      ...(manifest.generatedAt ? { generatedAt: manifest.generatedAt } : {}),
    };
    const content = Buffer.from(`${JSON.stringify(dataSource, null, 2)}\n`);
    const existing = await readLocal(DATA_SOURCE_FILE);
    if (!existing?.equals(content))
      writes.push({ path: join(TARGET_DIR, DATA_SOURCE_FILE), content });
  }
  await replaceFilesWithRollback(writes);

  for (const note of plan.notes) process.stdout.write(`  ✓ ${note}\n`);
  process.stdout.write(`已寫入 ${writes.length} 個檔案，${plan.unchanged} 個未變動\n`);
  if (plan.failures.length > 0) {
    throw new Error(`以下批次未寫入：\n  - ${plan.failures.join('\n  - ')}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  });
}
