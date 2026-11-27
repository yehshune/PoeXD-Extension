/**
 * 從 poexd-data 的發布內容同步 public/json/（docs/architecture/data-unification-plan.md 第 5.1 節）。
 *
 * 來源：
 * - 遠端（預設）：poexd-data-dist 的 gh-pages 的某個 commit。以 commit SHA 組網址，內容固定不變，
 *   不受 jsDelivr 分支快取影響；一律透過 HTTP 取得，避免本機 git 的換行轉換改變內容。
 * - 本機：`--source <dir>`，指向 poexd-data 的 output/（開發用）。
 *
 * 依 manifest.json 驗證每個檔案的 sha256 與大小，再依批次檢查一致性（同一 patch、索引對齊），
 * 通過的批次整批寫入；任一批次失敗時該批次不寫入，並以非零狀態結束。
 * 哪些檔案屬於哪個批次由 poexd-data 的 catalog 決定（manifest 每個檔案帶 batch）；不認得的批次一律忽略，
 * 已知批次的路徑必須安全且在該批次自己的目錄底下（見 checkDataPath）。
 *
 * 用法：
 *   node scripts/sync-data.mjs                       最新 gh-pages commit
 *   node scripts/sync-data.mjs --ref <sha>           指定 commit（重現某次同步）
 *   node scripts/sync-data.mjs --source <dir>        本機 poexd-data/output
 *   node scripts/sync-data.mjs --batch poe2/game     只同步指定批次（可重複）
 *   node scripts/sync-data.mjs --version poe1        只同步指定遊戲版本的批次
 *
 * 完整同步遠端內容且資料有變動（或尚無紀錄）時，寫入 public/json/data-source.json，記錄資料來自哪一次發布。
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { replaceFilesWithRollback } from './file-update-rollback.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TARGET_DIR = join(ROOT, 'public/json');
/** poexd-data 的發布內容所在的 repo */
const DATA_REPO = 'yehshune/poexd-data-dist';
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
  'folder-icons',
]);

// ── 路徑檢查 ──────────────────────────────────────────────
//
// 哪些檔案屬於哪個批次只由 poexd-data 的 src/publish/catalog.ts 決定（manifest 每個檔案帶 batch）；
// 這裡不再維護同一份檔名清單，只做與檔名無關的安全檢查：批次必須是已知的、路徑必須安全，
// 且只能落在該批次自己的目錄底下。新增資料檔時只需改 poexd-data。

/** 每段路徑：英數開頭（排除 . 與 ..），只含英數、點、底線、連字號 */
const SAFE_PATH = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

/** 各批次可寫入的目錄與副檔名 */
const BATCH_SCOPES = Object.freeze({
  'poe1/game': { roots: ['poe1/'], extensions: ['.json'] },
  'poe2/game': { roots: ['poe2/'], extensions: ['.json'] },
  'poe1/mercenary': { roots: ['poe1/'], extensions: ['.json'] },
  'poe1/trade-filters': { roots: ['poe1/locales/'], extensions: ['.json'] },
  'poe2/trade-filters': { roots: ['poe2/locales/'], extensions: ['.json'] },
  market: { roots: ['locales/', 'poe1/locales/', 'poe2/locales/'], extensions: ['.json'] },
  'folder-icons': { roots: ['folder-icons/'], extensions: ['.json', '.webp'] },
});

/** 檢查資料檔路徑能否寫入該批次；可以時回傳 null，否則回傳原因 */
export function checkDataPath(path, batchId) {
  const scope = BATCH_SCOPES[batchId];
  if (!scope) return `未知的批次 ${batchId}`;
  if (typeof path !== 'string' || !SAFE_PATH.test(path)) return `路徑不安全：${path}`;
  if (!scope.roots.some((root) => path.startsWith(root))) {
    return `${path} 不在批次 ${batchId} 的目錄（${scope.roots.join('、')}）`;
  }
  if (!scope.extensions.some((extension) => path.endsWith(extension))) {
    return `${path} 的副檔名不是 ${scope.extensions.join('、')}`;
  }
  return null;
}

// ── 批次一致性 ────────────────────────────────────────────

/** mods-tiers／stats 與英文共用句型分片的格式版本（poexd-data 的 src/publish/batch-validation.ts） */
const ALIGNED_SCHEMA_VERSION = 2;

/**
 * 檢查一個版本的整批分片是否一致；回傳錯誤訊息陣列（空陣列表示一致）。
 * @param {{ modsTiers: any, stats: Record<string, any>, items: Record<string, any>, modLines?: Record<string, any>, statText?: Record<string, any>, passiveStatText?: Record<string, any>, passiveNames?: Record<string, any>, resultLabels?: Record<string, any>, statAliases?: any }} batch
 */
export function validateGameDataBatch(batch) {
  const errors = [];
  const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
  const modsTiers = batch.modsTiers;
  const patch = modsTiers?.patch;
  const tierCount = modsTiers?.tiers?.length;
  const templateCount = modsTiers?.templateCount;
  if (!patch) errors.push('mods-tiers.json 缺少 patch');
  if (!Number.isInteger(tierCount)) errors.push('mods-tiers.json 缺少 tiers');
  // schemaVersion 2：模板索引共用，放在 mods-tiers.json；語系 stats.json 只有模板陣列
  if (
    modsTiers?.schemaVersion !== ALIGNED_SCHEMA_VERSION ||
    !Number.isInteger(templateCount) ||
    !isObject(modsTiers?.statTemplates)
  ) {
    errors.push('mods-tiers.json 缺少共用模板索引');
  } else if (modsTiers.tierTemplates?.length !== tierCount) {
    errors.push(
      `mods-tiers.json tierTemplates ${modsTiers.tierTemplates?.length} 筆 ≠ tiers ${tierCount} 筆`,
    );
  }

  for (const [locale, shard] of Object.entries(batch.stats)) {
    if (shard?.patch !== patch) {
      errors.push(`stats.json (${locale}) patch ${shard?.patch ?? '缺少'} ≠ ${patch}`);
    }
    if (
      shard?.schemaVersion !== ALIGNED_SCHEMA_VERSION ||
      shard?.locale !== locale ||
      !Array.isArray(shard?.templates)
    ) {
      errors.push(`stats.json (${locale}) 語系或格式不符`);
    } else if (shard.templates.length !== templateCount) {
      errors.push(
        `stats.json (${locale}) templates ${shard.templates.length} 筆 ≠ templateCount ${templateCount} 筆`,
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
  const localeShards = [
    ['mod-lines.json', batch.modLines, ALIGNED_SCHEMA_VERSION, (shard) => isObject(shard.lines)],
    [
      'stat-text-items.json',
      batch.statText,
      ALIGNED_SCHEMA_VERSION,
      (shard) => isObject(shard.lines),
    ],
    [
      'stat-text-passives.json',
      batch.passiveStatText,
      ALIGNED_SCHEMA_VERSION,
      (shard) => isObject(shard.lines),
    ],
    [
      'stat-text-skills.json',
      batch.skillStatText,
      ALIGNED_SCHEMA_VERSION,
      (shard) => isObject(shard.lines),
    ],
    ['passive-names.json', batch.passiveNames, 1, (shard) => isObject(shard.names)],
    [
      'result-labels.json',
      batch.resultLabels,
      1,
      (shard) => isObject(shard.labels) && Array.isArray(shard.templates),
    ],
  ];
  for (const [file, shards, schemaVersion, hasValidBody] of localeShards) {
    for (const [locale, shard] of Object.entries(shards ?? {})) {
      if (shard?.patch !== patch) {
        errors.push(`${file} (${locale}) patch ${shard?.patch ?? '缺少'} ≠ ${patch}`);
      }
      if (
        shard?.schemaVersion !== schemaVersion ||
        shard?.locale !== locale ||
        !hasValidBody(shard)
      ) {
        errors.push(`${file} (${locale}) 語系或格式不符`);
      }
    }
  }
  // 英文共用的句型分片：譯文分片的每個 hash 都要在 en 分片裡、且陣列長度相同
  const alignedShards = [
    ['mod-lines.json', batch.modLines],
    ['stat-text-items.json', batch.statText],
    ['stat-text-passives.json', batch.passiveStatText],
    ['stat-text-skills.json', batch.skillStatText],
  ];
  for (const [file, shards] of alignedShards) {
    const localized = Object.entries(shards ?? {}).filter(([locale]) => locale !== 'en');
    if (localized.length === 0) continue;
    if (!shards?.en) {
      errors.push(`缺少 en/${file}，無法還原英文`);
      continue;
    }
    const englishLines = isObject(shards.en.lines) ? shards.en.lines : {};
    for (const [locale, shard] of localized) {
      const misaligned = Object.entries(isObject(shard?.lines) ? shard.lines : {})
        .filter(
          ([hash, texts]) => !Array.isArray(texts) || englishLines[hash]?.length !== texts.length,
        )
        .map(([hash]) => hash);
      if (misaligned.length > 0) {
        errors.push(
          `${file} (${locale}) ${misaligned.length} 個 hash 與 en 對不齊（例如 ${misaligned[0]}）`,
        );
      }
    }
  }
  if (batch.statAliases !== undefined && batch.statAliases !== null) {
    if (batch.statAliases?.patch !== patch) {
      errors.push(`stat-aliases.json patch ${batch.statAliases?.patch ?? '缺少'} ≠ ${patch}`);
    }
    if (batch.statAliases?.schemaVersion !== 1 || !isObject(batch.statAliases?.aliases)) {
      errors.push('stat-aliases.json 格式不符');
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
      statText: {},
      passiveStatText: {},
      skillStatText: {},
      passiveNames: {},
      resultLabels: {},
      statAliases: filesByPath[`${version}/stat-aliases.json`],
    };
    const keyByFile = {
      'stats.json': 'stats',
      'items.json': 'items',
      'mod-lines.json': 'modLines',
      'stat-text-items.json': 'statText',
      'stat-text-passives.json': 'passiveStatText',
      'stat-text-skills.json': 'skillStatText',
      'passive-names.json': 'passiveNames',
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
  if (batchId === 'folder-icons') {
    const index = filesByPath['folder-icons/index.json'];
    if (
      !index ||
      index.schemaVersion !== 1 ||
      !Array.isArray(index.icons) ||
      index.icons.length === 0
    ) {
      return ['folder-icons/index.json 缺少或格式不符'];
    }
    const missing = [];
    for (const icon of index.icons) {
      const filePath = `folder-icons/${icon?.file ?? ''}`;
      if (!(filePath in filesByPath)) missing.push(`缺少 ${filePath}`);
    }
    return missing;
  }
  // 篩選翻譯與市集漢化：en 是執行期後備語系，必須存在
  const required =
    batchId === 'market'
      ? GAME_VERSIONS.map((version) => `${version}/locales/en/trade-stats.json`)
      : [`${batchId.split('/')[0]}/locales/en/trade-filters.json`];
  return required.filter((path) => !(path in filesByPath)).map((path) => `缺少 ${path}`);
}

// ── manifest ─────────────────────────────────────────────

/**
 * 檢查 manifest 結構，回傳以批次分組的檔案清單。
 * 不認得的批次略過（poexd-data 之後新增、擴充還用不到的資料）；已知批次的檔案路徑不安全或
 * 超出該批次的目錄時拒絕整份 manifest。
 */
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
    const batchId = entry?.batch;
    if (!BATCH_IDS.includes(batchId)) continue;
    const pathError = checkDataPath(path, batchId);
    if (pathError) throw new Error(`manifest.json 中 ${path}：${pathError}`);
    if (typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sha256)) {
      throw new Error(`manifest.json 中 ${path} 缺少有效的 sha256`);
    }
    if (!Number.isInteger(entry.bytes) || entry.bytes <= 0 || entry.bytes > MAX_FILE_BYTES) {
      throw new Error(`manifest.json 中 ${path} 的大小無效：${entry.bytes}`);
    }
    (batches[batchId] ??= []).push({ path, sha256: entry.sha256, bytes: entry.bytes });
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
        parsed[file.path] = file.path.endsWith('.json') ? JSON.parse(bytes.toString('utf8')) : true;
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
  // 資料沒有變動時保留原本的來源紀錄：每次發布都會產生新 commit，只改這個檔案的 PR 沒有意義
  const existingDataSource = await readLocal(DATA_SOURCE_FILE);
  if (ref && fullSync && plan.failures.length === 0 && (writes.length > 0 || !existingDataSource)) {
    const dataSource = {
      ref,
      ...(manifest.sourceCommit ? { sourceCommit: manifest.sourceCommit } : {}),
      ...(manifest.generatedAt ? { generatedAt: manifest.generatedAt } : {}),
    };
    const content = Buffer.from(`${JSON.stringify(dataSource, null, 2)}\n`);
    if (!existingDataSource?.equals(content)) {
      writes.push({ path: join(TARGET_DIR, DATA_SOURCE_FILE), content });
    }
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
