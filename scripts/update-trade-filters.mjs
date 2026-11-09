/**
 * 從各語言的官方市集 API（filters 與 stats）更新 public/json/<version>/locales/<locale>/trade-filters.json。
 *
 * 用法：node scripts/update-trade-filters.mjs [--locale <locale>]... [--version poe1|poe2]
 *
 * en 必須成功（執行期後備語系）；其他語系抓取失敗時保留既有檔案並列出警告。
 * 全部抓取與驗證完成後才一次寫入，寫入失敗會回復。
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { replaceFilesWithRollback } from './file-update-rollback.mjs';
import {
  GAME_VERSION_ROUTES,
  LOCALE_REALM_HOSTS,
  REQUIRED_LOCALES,
  buildArtifactFromApi,
  buildFiltersUrl,
  buildStatsUrl,
  stableJson,
  validateArtifact,
} from './trade-filter-api.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const REQUEST_INTERVAL_MS = 1000;
const REQUEST_TIMEOUT_MS = 20000;
const USER_AGENT = 'PoeXD-Extension trade-filters updater';

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function parseArgs(argv) {
  const locales = [];
  let versions = Object.keys(GAME_VERSION_ROUTES);
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--locale') locales.push(argv[++i]);
    else if (argv[i] === '--version') versions = [argv[++i]];
    else throw new Error(`未知參數：${argv[i]}`);
  }
  const selected = locales.length > 0 ? locales : Object.keys(LOCALE_REALM_HOSTS);
  for (const locale of selected) {
    if (!LOCALE_REALM_HOSTS[locale]) throw new Error(`不支援的語系：${locale}`);
  }
  for (const version of versions) {
    if (!GAME_VERSION_ROUTES[version]) throw new Error(`不支援的遊戲版本：${version}`);
  }
  // en 永遠要抓：它是後備語系，也用來偵測其他網域是否回傳英文
  return { locales: [...new Set(['en', ...selected])], versions };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function buildVersion(version, locales) {
  const artifacts = {};
  const failures = [];
  for (const locale of locales) {
    const url = buildFiltersUrl(locale, version);
    try {
      const filtersResponse = await fetchJson(url);
      await sleep(REQUEST_INTERVAL_MS);
      const statsResponse = await fetchJson(buildStatsUrl(locale, version));
      const artifact = buildArtifactFromApi(filtersResponse, {
        gameVersion: version,
        locale,
        statsResponse,
      });
      artifacts[locale] = validateArtifact(artifact, artifacts.en);
      const fieldCount = Object.keys(artifact.fields).length;
      const pseudoCount = Object.keys(artifact.pseudoStats).length;
      process.stdout.write(
        `  ${version} ${locale.padEnd(5)} ✓ ${fieldCount} 個欄位、${pseudoCount} 個 pseudo\n`,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (REQUIRED_LOCALES.includes(locale)) {
        throw new Error(`${version} ${locale} 為必要語系，抓取失敗：${reason}（${url}）`);
      }
      failures.push(`${version} ${locale}: ${reason}`);
      process.stdout.write(`  ${version} ${locale.padEnd(5)} ✗ ${reason}，保留既有檔案\n`);
    }
    await sleep(REQUEST_INTERVAL_MS);
  }
  return { artifacts, failures };
}

async function main() {
  const { locales, versions } = parseArgs(process.argv.slice(2));
  const writes = [];
  const failures = [];
  for (const version of versions) {
    const result = await buildVersion(version, locales);
    failures.push(...result.failures);
    for (const [locale, artifact] of Object.entries(result.artifacts)) {
      writes.push({
        path: resolve(ROOT, `public/json/${version}/locales/${locale}/trade-filters.json`),
        content: stableJson(artifact),
      });
    }
  }
  await replaceFilesWithRollback(writes);
  process.stdout.write(`已更新 ${writes.length} 個檔案\n`);
  if (failures.length > 0) {
    process.stdout.write(`未更新（保留既有檔案）：\n  - ${failures.join('\n  - ')}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exitCode = 1;
});
