/**
 * 從 poexd-data 的輸出同步遊戲資料分片到 public/json/<version>/。
 *
 * mods-tiers.json、locales/<locale>/stats.json 與 locales/<locale>/items.json 以索引互相對齊，
 * 必須整批來自同一次建置：任一檔的 patch 不同或長度不對齊時整批拒絕，不寫入任何檔案。
 *
 * mercenary.json 與 locales/<locale>/mercenary.json（僅 poe1）自成一批：彼此以索引對齊、patch 一致即可，
 * 不需與詞綴分片同一 patch；來源沒有傭兵資料時略過，不影響詞綴同步。
 *
 * 用法：node scripts/sync-game-data.mjs [--source ../poexd-data/output] [--version poe1|poe2]
 */
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { replaceFilesWithRollback } from './file-update-rollback.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const GAME_VERSIONS = ['poe1', 'poe2'];

/**
 * 檢查一個版本的整批分片是否一致；回傳錯誤訊息陣列（空陣列表示可同步）。
 * @param {{ modsTiers: any, stats: Record<string, any>, items: Record<string, any> }} batch
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
  return errors;
}

/**
 * 檢查傭兵資料批次；回傳錯誤訊息陣列（空陣列表示可同步）。
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

async function readJsonIfExists(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, 'utf8'));
}

async function loadBatch(sourceDir, version) {
  const versionDir = join(sourceDir, version);
  const modsTiers = await readJsonIfExists(join(versionDir, 'mods-tiers.json'));
  if (!modsTiers) throw new Error(`找不到 ${join(versionDir, 'mods-tiers.json')}`);
  const stats = {};
  const items = {};
  const locales = await readdir(join(versionDir, 'locales'));
  for (const locale of locales) {
    const statsShard = await readJsonIfExists(join(versionDir, 'locales', locale, 'stats.json'));
    const itemsShard = await readJsonIfExists(join(versionDir, 'locales', locale, 'items.json'));
    if (statsShard) stats[locale] = statsShard;
    if (itemsShard) items[locale] = itemsShard;
  }
  return { modsTiers, stats, items };
}

async function loadMercenaryBatch(sourceDir, version) {
  const versionDir = join(sourceDir, version);
  const data = await readJsonIfExists(join(versionDir, 'mercenary.json'));
  if (!data) return null;
  const names = {};
  for (const locale of await readdir(join(versionDir, 'locales'))) {
    const shard = await readJsonIfExists(join(versionDir, 'locales', locale, 'mercenary.json'));
    if (shard) names[locale] = shard;
  }
  return { data, names };
}

function mercenaryWrites(version, batch) {
  const targetDir = join(ROOT, 'public/json', version);
  const writes = [{ path: join(targetDir, 'mercenary.json'), data: batch.data }];
  for (const [locale, shard] of Object.entries(batch.names)) {
    writes.push({ path: join(targetDir, 'locales', locale, 'mercenary.json'), data: shard });
  }
  return writes.map(({ path, data }) => ({ path, content: JSON.stringify(data) }));
}

function batchWrites(version, batch) {
  const targetDir = join(ROOT, 'public/json', version);
  const writes = [{ path: join(targetDir, 'mods-tiers.json'), data: batch.modsTiers }];
  for (const [locale, shard] of Object.entries(batch.stats)) {
    writes.push({ path: join(targetDir, 'locales', locale, 'stats.json'), data: shard });
  }
  for (const [locale, shard] of Object.entries(batch.items)) {
    writes.push({ path: join(targetDir, 'locales', locale, 'items.json'), data: shard });
  }
  return writes.map(({ path, data }) => ({ path, content: JSON.stringify(data) }));
}

function parseArgs(argv) {
  const args = { source: resolve(ROOT, '../poexd-data/output'), versions: GAME_VERSIONS };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--source') args.source = resolve(argv[++i]);
    else if (argv[i] === '--version') args.versions = [argv[++i]];
    else throw new Error(`未知參數：${argv[i]}`);
  }
  if (!args.versions.every((v) => GAME_VERSIONS.includes(v))) {
    throw new Error(`--version 必須是 ${GAME_VERSIONS.join(' 或 ')}`);
  }
  return args;
}

async function main() {
  const { source, versions } = parseArgs(process.argv.slice(2));
  const writes = [];
  for (const version of versions) {
    const batch = await loadBatch(source, version);
    const errors = validateGameDataBatch(batch);
    if (errors.length > 0) {
      throw new Error(`${version} 分片不一致，未寫入任何檔案：\n  - ${errors.join('\n  - ')}`);
    }
    writes.push(...batchWrites(version, batch));
    process.stdout.write(
      `${version}: patch ${batch.modsTiers.patch}，${Object.keys(batch.stats).length} 個語系\n`,
    );

    const mercenary = await loadMercenaryBatch(source, version);
    if (mercenary) {
      const mercenaryErrors = validateMercenaryBatch(mercenary);
      if (mercenaryErrors.length > 0) {
        throw new Error(
          `${version} 傭兵資料不一致，未寫入任何檔案：\n  - ${mercenaryErrors.join('\n  - ')}`,
        );
      }
      writes.push(...mercenaryWrites(version, mercenary));
      process.stdout.write(
        `${version}: 傭兵資料 patch ${mercenary.data.patch}，${Object.keys(mercenary.names).length} 個語系\n`,
      );
    }
  }
  await replaceFilesWithRollback(writes);
  process.stdout.write(`已同步 ${writes.length} 個檔案\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  });
}
