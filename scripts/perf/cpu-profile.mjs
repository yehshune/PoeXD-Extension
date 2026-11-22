#!/usr/bin/env node
/**
 * 錄製官方交易頁重新載入時的 CPU profile 與網路時序：先暖機載入一次，再錄第二次載入到頁面靜止。
 * 輸出 <out>.cpuprofile（可拖進 DevTools Performance）與 <out>.meta.json，交給 cpu-profile-report.mjs 歸因。
 *
 *   node scripts/perf/cpu-profile.mjs --url <交易搜尋網址> --out .perf/before [--ext .output/chrome-mv3]
 *
 * 用法與注意事項見 scripts/perf/README.md。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { commonOptions, connect, requireTradeUrl, sleep } from './cdp.mjs';

const USAGE = `用法：node scripts/perf/cpu-profile.mjs --url <交易搜尋網址> --out <輸出前綴> [選項]

  --url <網址>          官方交易搜尋頁（必填）
  --out <前綴>          輸出路徑前綴，例如 .perf/before（必填）
  --ext <路徑>          先以 unpacked 載入這個 build
  --expand              錄製前先展開側邊欄，錄完再收合
  --interval <µs>       取樣間隔（預設 200）
  --quiet <ms>          DOM 連續多久沒變動視為靜止（預設 2000）
  --cdp <網址>          Chrome 遠端除錯端點（預設 http://127.0.0.1:9222）`;

const { values: args } = parseArgs({
  options: {
    ...commonOptions,
    out: { type: 'string' },
    expand: { type: 'boolean', default: false },
    interval: { type: 'string', default: '200' },
    quiet: { type: 'string', default: '2000' },
  },
});

if (args.help) {
  console.log(USAGE);
  process.exit(0);
}
const url = requireTradeUrl(args.url);
if (!args.out) throw new Error('缺少 --out（輸出路徑前綴）');
const interval = Number(args.interval);
const quietMs = Number(args.quiet);
if (!(interval > 0) || !(quietMs > 0)) throw new Error('--interval 與 --quiet 必須是正數');

function installProbe() {
  const t = (window.__poexdCpuProbe = { rowsFirst: null, lastMut: 0 });
  new MutationObserver(() => {
    const now = performance.now();
    t.lastMut = now;
    if (t.rowsFirst == null && document.querySelector('.resultset .row[data-id]'))
      t.rowsFirst = now;
  }).observe(document, { childList: true, subtree: true, attributes: true, characterData: true });
}

const waitForQuiet = (page) =>
  page.waitForFunction(
    (quiet) => {
      const t = window.__poexdCpuProbe;
      return t?.rowsFirst != null && performance.now() - t.lastMut > quiet;
    },
    quietMs,
    { timeout: 60_000, polling: 200 },
  );

const toggleSidebar = (page, action) =>
  page.evaluate((action) => {
    const root = document.querySelector('poexd-sidebar-container')?.shadowRoot;
    const button = root?.querySelector(`[data-sidebar-action="${action}"]`);
    if (button && button.offsetParent !== null) button.click();
  }, action);

const { context } = await connect(args);
const page = await context.newPage();
try {
  await page.addInitScript(installProbe);
  await page.goto(url, { waitUntil: 'load' });
  await waitForQuiet(page);
  if (args.expand) await toggleSidebar(page, 'expand');
  // 讓暖機載入的背景工作（快取寫入、延遲掛載）跑完，避免混進錄製
  await sleep(10_000);

  const cdp = await context.newCDPSession(page);
  const requests = new Map();
  await cdp.send('Network.enable');
  cdp.on('Network.requestWillBeSent', (e) => {
    requests.set(e.requestId, { url: e.request.url, start: e.timestamp });
  });
  cdp.on('Network.loadingFinished', (e) => {
    const request = requests.get(e.requestId);
    if (request) request.end = e.timestamp;
  });
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval });
  await cdp.send('Profiler.start');
  await page.goto(url, { waitUntil: 'load' });
  await waitForQuiet(page);
  const { profile } = await cdp.send('Profiler.stop');

  const timing = await page.evaluate(() => ({
    rowsFirst: Math.round(window.__poexdCpuProbe.rowsFirst),
    quiet: Math.round(window.__poexdCpuProbe.lastMut),
  }));
  const all = [...requests.values()];
  const navigation = all.find((r) => r.url === url) ?? all[0];
  if (!navigation) throw new Error('沒有錄到導航請求，無法對齊時間軸');
  const meta = {
    url,
    ...timing,
    navStartUs: navigation.start * 1e6,
    requests: all
      .filter((r) => /api\/trade|\.json|\.js(\?|$)/.test(r.url))
      .map((r) => ({
        url: r.url.slice(-80),
        startMs: Math.round((r.start - navigation.start) * 1000),
        endMs: r.end ? Math.round((r.end - navigation.start) * 1000) : null,
      })),
  };
  await mkdir(dirname(args.out), { recursive: true });
  await writeFile(`${args.out}.cpuprofile`, JSON.stringify(profile));
  await writeFile(`${args.out}.meta.json`, JSON.stringify(meta, null, 1));
  console.log(`${args.out} ${JSON.stringify(timing)}`);
} finally {
  if (args.expand) await toggleSidebar(page, 'collapse').catch(() => {});
  await page.close().catch(() => {});
}
process.exit(0);
