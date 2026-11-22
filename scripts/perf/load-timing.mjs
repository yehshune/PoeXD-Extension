#!/usr/bin/env node
/**
 * 官方交易頁首屏計時：重複載入同一個搜尋網址，量測結果列、篩選區、側邊欄出現的時間，
 * 並偵測英文閃現、版面位移與 console 錯誤；丟掉第一輪暖機後取中位數。
 *
 *   node scripts/perf/load-timing.mjs --url <交易搜尋網址> [--runs 6] [--throttle 4] [--ext .output/chrome-mv3]
 *
 * 用法與注意事項見 scripts/perf/README.md。
 */
import { parseArgs } from 'node:util';
import { commonOptions, connect, median, requireTradeUrl, sleep } from './cdp.mjs';

const USAGE = `用法：node scripts/perf/load-timing.mjs --url <交易搜尋網址> [選項]

  --url <網址>        官方交易搜尋頁（必填）
  --ext <路徑>        先以 unpacked 載入這個 build（例如 .output/chrome-mv3）
  --runs <n>          量測輪數，不含暖機（預設 5）
  --throttle <倍率>   CPU 節流倍率，1 為不節流（預設 1）
  --settle <ms>       結果列出現後再等多久才讀數（預設 2500 × 節流倍率）
  --cooldown <ms>     每輪之間的間隔，避免觸發搜尋 API 限流（預設 12000）
  --label <名稱>      輸出前綴（預設 run）
  --cdp <網址>        Chrome 遠端除錯端點（預設 http://127.0.0.1:9222）`;

const { values: args } = parseArgs({
  options: {
    ...commonOptions,
    runs: { type: 'string', default: '5' },
    throttle: { type: 'string', default: '1' },
    settle: { type: 'string' },
    cooldown: { type: 'string', default: '12000' },
    label: { type: 'string', default: 'run' },
  },
});

if (args.help) {
  console.log(USAGE);
  process.exit(0);
}

const positiveNumber = (name, value) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`--${name} 必須是正數：${value}`);
  return number;
};

const url = requireTradeUrl(args.url);
const runs = Math.floor(positiveNumber('runs', args.runs));
const throttle = positiveNumber('throttle', args.throttle);
const settle = args.settle ? positiveNumber('settle', args.settle) : throttle * 2500;
const cooldown = positiveNumber('cooldown', args.cooldown);

/** 注入頁面：每 30ms 取樣一次首屏里程碑（毫秒，相對於導航開始） */
function installProbe() {
  const t = (window.__poexdLoadTiming = {
    rowsFirst: null,
    rowCJK: null,
    rowEnglishSeen: false,
    filterFirst: null,
    filterCJK: null,
    filterEnglishAfterRender: false,
    sidebar: null,
    skeleton: null,
    tier: null,
    shiftAfterRows: null,
    shiftAfterFilters: null,
  });
  const cjk = /[一-鿿]/;
  const tick = () => {
    const now = Math.round(performance.now());
    const content = document.querySelector('.content');
    const left = content ? Math.round(content.getBoundingClientRect().left) : null;
    const row = document.querySelector('.resultset .row[data-id]');
    if (row) {
      if (t.rowsFirst == null) {
        t.rowsFirst = now;
        t.leftAtRows = left;
      }
      if (t.shiftAfterRows == null && left !== t.leftAtRows)
        t.shiftAfterRows = [now, t.leftAtRows, left];
      const mod = row.querySelector('[data-field^="stat."]');
      if (mod && t.rowCJK == null) {
        if (cjk.test(mod.textContent)) t.rowCJK = now;
        else t.rowEnglishSeen = true;
      }
    }
    const filter = document.querySelector(
      '.search-advanced-pane .filter-title, .search-advanced-pane .filter-group-header',
    );
    if (filter) {
      if (t.filterFirst == null) {
        t.filterFirst = now;
        t.leftAtFilters = left;
      }
      if (t.shiftAfterFilters == null && left !== t.leftAtFilters) {
        t.shiftAfterFilters = [now, t.leftAtFilters, left];
      }
      if (t.filterCJK == null) {
        if (cjk.test(filter.textContent)) t.filterCJK = now;
        else t.filterEnglishAfterRender = true;
      }
    }
    if (t.sidebar == null && document.querySelector('poexd-sidebar-container')) t.sidebar = now;
    if (t.skeleton == null && document.getElementById('poexd-sidebar-skeleton')) t.skeleton = now;
    if (t.tier == null && document.querySelector('.poexd-tier-trigger-slot')) t.tier = now;
    setTimeout(tick, 30);
  };
  tick();
}

const { context } = await connect(args);
const page = await context.newPage();
const errors = new Set();
page.on('console', (message) => {
  const type = message.type();
  if (type === 'error' || (type === 'warning' && /PoeXD/.test(message.text()))) {
    errors.add(message.text().slice(0, 200));
  }
});
page.on('pageerror', (error) => errors.add(`pageerror ${error.message.slice(0, 200)}`));

const results = [];
const cdp = await context.newCDPSession(page);
try {
  await page.addInitScript(installProbe);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  for (let i = 0; i <= runs; i += 1) {
    await page.goto(url, { waitUntil: 'load', timeout: 90_000 });
    await page.waitForSelector('.resultset .row[data-id]', { timeout: 90_000 });
    await page.waitForTimeout(settle);
    const timing = await page.evaluate(() => window.__poexdLoadTiming);
    const tag = i === 0 ? 'warmup' : `run${i}`;
    console.log(`${args.label} x${throttle} ${tag} ${JSON.stringify(timing)}`);
    if (i > 0) results.push(timing);
    if (i < runs) await sleep(cooldown);
  }
} finally {
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }).catch(() => {});
  await page.close().catch(() => {});
}

const flags = new Set();
for (const r of results) {
  if (r.rowEnglishSeen) flags.add('EN!（結果列先出現英文）');
  if (r.filterEnglishAfterRender) flags.add('FEN!（篩選區渲染後仍是英文）');
  if (r.shiftAfterRows || r.shiftAfterFilters) flags.add('SHIFT（首屏後版面位移）');
}
const pick = (key) => results.map((r) => r[key]);
const summary = {
  label: args.label,
  throttle,
  runs: results.length,
  rowsFirst: pick('rowsFirst'),
  median: {
    rowsFirst: median(pick('rowsFirst')),
    rowCJK: median(pick('rowCJK')),
    filterFirst: median(pick('filterFirst')),
    filterCJK: median(pick('filterCJK')),
    sidebar: median(pick('sidebar')),
    skeleton: median(pick('skeleton')),
  },
  flags: [...flags],
  errors: [...errors],
};
console.log(`SUMMARY ${JSON.stringify(summary)}`);
process.exit(0);
