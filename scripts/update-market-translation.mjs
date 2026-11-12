/**
 * 更新市集漢化（ADR-0012）用的資料分片：
 *
 * - public/json/locales/<locale>/trade-ui.json                 官方介面字典（translate.*.js）
 * - public/json/<version>/locales/<locale>/trade-stats.json    該服 /data/stats，只留國際服存在的 id
 * - public/json/<version>/locales/<locale>/trade-static.json   該服 /data/static，只留國際服存在的條目
 *
 * <locale> 為市集漢化目標語系（zh-TW、zh-CN）。國際服（en）另外寫出 trade-stats.json：
 * 詞綴標籤以官方市集寫法為準（utils/official-stat-text.ts），英文介面與「中文市集仍回傳英文」的判斷都要用到。
 *
 * 用法：node scripts/update-market-translation.mjs [--locale zh-TW|zh-CN]... [--version poe1|poe2] [--skip-ui]
 *
 * en 必須成功；其他語系或介面字典抓取失敗時保留既有檔案並列出警告。
 * 全部抓取與驗證完成後才一次寫入，寫入失敗會回復。
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { replaceFilesWithRollback } from './file-update-rollback.mjs';
import { GAME_VERSION_ROUTES, buildStaticUrl, buildStatsUrl } from './trade-filter-api.mjs';
import {
  MARKET_LOCALES,
  buildStaticArtifact,
  buildStatsArtifact,
  buildUiArtifact,
  getUiDictionaryUrls,
  validateStaticArtifact,
  validateStatsArtifact,
  validateUiArtifact,
} from './market-translation-api.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const REQUEST_INTERVAL_MS = 1000;
const REQUEST_TIMEOUT_MS = 30000;
const USER_AGENT = 'PoeXD-Extension market-translation updater';

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** 大型分片不縮排：stats 每個語系可達數百 KB，縮排只會增加打包大小 */
const compactJson = (value) => `${JSON.stringify(value)}\n`;

function parseArgs(argv) {
  const locales = [];
  let versions = Object.keys(GAME_VERSION_ROUTES);
  let skipUi = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--locale') locales.push(argv[++i]);
    else if (argv[i] === '--version') versions = [argv[++i]];
    else if (argv[i] === '--skip-ui') skipUi = true;
    else throw new Error(`未知參數：${argv[i]}`);
  }
  for (const locale of locales) {
    if (!MARKET_LOCALES.includes(locale)) throw new Error(`不支援的市集漢化語系：${locale}`);
  }
  for (const version of versions) {
    if (!GAME_VERSION_ROUTES[version]) throw new Error(`不支援的遊戲版本：${version}`);
  }
  return { locales: locales.length > 0 ? locales : [...MARKET_LOCALES], versions, skipUi };
}

async function fetchWithTimeout(url, accept) {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: accept },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response;
}

const fetchJson = async (url) => (await fetchWithTimeout(url, 'application/json')).json();
const fetchText = async (url) => (await fetchWithTimeout(url, 'application/javascript')).text();

const describeError = (error) => (error instanceof Error ? error.message : String(error));

/** 依序嘗試主網址與備援網址，全部失敗時列出每個網址的原因 */
async function fetchFirstAvailableText(urls) {
  const reasons = [];
  for (const url of urls) {
    try {
      return await fetchText(url);
    } catch (error) {
      reasons.push(`${url}（${describeError(error)}）`);
    }
  }
  throw new Error(reasons.join('；'));
}

async function buildUiWrites(locales) {
  const writes = [];
  const failures = [];
  for (const locale of locales) {
    try {
      const artifact = validateUiArtifact(
        buildUiArtifact(await fetchFirstAvailableText(getUiDictionaryUrls(locale)), { locale }),
      );
      writes.push({
        path: resolve(ROOT, `public/json/locales/${locale}/trade-ui.json`),
        content: compactJson(artifact),
      });
      process.stdout.write(
        `  ui    ${locale.padEnd(5)} ✓ ${Object.keys(artifact.strings).length} 個字串\n`,
      );
    } catch (error) {
      failures.push(`ui ${locale}: ${describeError(error)}`);
      process.stdout.write(`  ui    ${locale.padEnd(5)} ✗ ${describeError(error)}，保留既有檔案\n`);
    }
    await sleep(REQUEST_INTERVAL_MS);
  }
  return { writes, failures };
}

async function fetchEnglish(version) {
  try {
    const stats = await fetchJson(buildStatsUrl('en', version));
    await sleep(REQUEST_INTERVAL_MS);
    const statics = await fetchJson(buildStaticUrl('en', version));
    await sleep(REQUEST_INTERVAL_MS);
    return {
      statsResponse: stats,
      staticResponse: statics,
      statsArtifact: buildStatsArtifact(stats, { gameVersion: version, locale: 'en' }),
      staticArtifact: buildStaticArtifact(statics, { gameVersion: version, locale: 'en' }),
    };
  } catch (error) {
    throw new Error(`${version} en 為必要語系，抓取失敗：${describeError(error)}`);
  }
}

async function buildVersionWrites(version, locales) {
  const english = await fetchEnglish(version);
  const writes = [
    {
      path: resolve(ROOT, `public/json/${version}/locales/en/trade-stats.json`),
      content: compactJson(validateStatsArtifact(english.statsArtifact)),
    },
  ];
  const failures = [];
  for (const locale of locales) {
    try {
      const statsResponse = await fetchJson(buildStatsUrl(locale, version));
      await sleep(REQUEST_INTERVAL_MS);
      const staticResponse = await fetchJson(buildStaticUrl(locale, version));
      const options = { gameVersion: version, locale };
      const stats = validateStatsArtifact(
        buildStatsArtifact(statsResponse, { ...options, englishResponse: english.statsResponse }),
        english.statsArtifact,
      );
      const statics = validateStaticArtifact(
        buildStaticArtifact(staticResponse, {
          ...options,
          englishResponse: english.staticResponse,
        }),
        english.staticArtifact,
      );
      const dir = `public/json/${version}/locales/${locale}`;
      writes.push(
        { path: resolve(ROOT, `${dir}/trade-stats.json`), content: compactJson(stats) },
        { path: resolve(ROOT, `${dir}/trade-static.json`), content: compactJson(statics) },
      );
      const covered = Object.keys(stats.stats).length;
      const total = Object.keys(english.statsArtifact.stats).length;
      process.stdout.write(
        `  ${version}  ${locale.padEnd(5)} ✓ stats ${covered}/${total}（${Math.round((covered / total) * 100)}%）、static ${Object.values(statics.entries).reduce((sum, group) => sum + Object.keys(group).length, 0)} 筆\n`,
      );
    } catch (error) {
      failures.push(`${version} ${locale}: ${describeError(error)}`);
      process.stdout.write(
        `  ${version}  ${locale.padEnd(5)} ✗ ${describeError(error)}，保留既有檔案\n`,
      );
    }
    await sleep(REQUEST_INTERVAL_MS);
  }
  return { writes, failures };
}

async function main() {
  const { locales, versions, skipUi } = parseArgs(process.argv.slice(2));
  const results = [];
  if (!skipUi) results.push(await buildUiWrites(locales));
  for (const version of versions) results.push(await buildVersionWrites(version, locales));

  const writes = results.flatMap((result) => result.writes);
  const failures = results.flatMap((result) => result.failures);
  await replaceFilesWithRollback(writes);
  process.stdout.write(`已更新 ${writes.length} 個檔案\n`);
  if (failures.length > 0) {
    process.stdout.write(`未更新（保留既有檔案）：\n  - ${failures.join('\n  - ')}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`${describeError(error)}\n`);
  process.exitCode = 1;
});
