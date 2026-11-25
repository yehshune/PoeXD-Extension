/**
 * `pnpm poe <command>`：在 `pnpm dev` 開的瀏覽器（CDP 9222）上快速查看與操作官方交易頁。
 * 給臨時驗證用；固定的回歸檢查請寫成 `e2e/*.e2e.ts`。執行 `pnpm poe help` 看指令說明。
 */
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { flagInt, flagString, parseCliArgs, type CliArgs } from './cli-args.ts';
import {
  clearSearch,
  LAYOUTS,
  loadMore,
  runSearch,
  setFiltersVisible,
  setLayout,
  setLiveSearch,
  type ActionResult,
  type ResultLayout,
} from './official-actions.ts';
import { readExtensionStorage } from './extension-storage.ts';
import { captureResponses } from './network-capture.ts';
import { snapshotStore, summarizeTradePage } from './page-probes.ts';
import {
  allPages,
  isCloudflareChallenge,
  pickTradePage,
  requireTradePage,
  tradePages,
  ensureUsableViewport,
  waitForTradeReady,
  withDevBrowser,
  type DevBrowserConnection,
} from './trade-page.ts';
import { parseTradeUrl, resolveOpenTarget } from './trade-url.ts';

const SHOTS_DIR = path.resolve(import.meta.dirname, '../.shots');

const HELP = `用法：pnpm poe <command> [參數] [--tab N]

唯讀（不發官方請求）：
  status                    分頁清單、擴充是否注入、篩選區、結果數、store 摘要
  store [path] [--depth 3] [--items 5]
                            印出官方 Vuex state（例：store persistent.stats）
  eval "<expr>"             在主世界求值並印出 JSON（可用 await）
  eval --file x.js          執行檔案內容作為 async 函式本體（用 return 回傳）
  shot [selector] [--full] [--out file.png]
                            截圖到 e2e/.shots/（selector 會穿透 open shadow DOM）
  close-trade               關閉所有官方搜尋分頁（改擴充程式碼前用，避免熱更新一直刷新）
  net [--filter /api/] [--seconds 10] [--file x.js] [--max-body 600] [--full-url]
                            監聽分頁的網路回應（含擴充發出的請求）；--file 在監聽期間於主世界執行，
                            用來觸發要觀察的請求（本身不發請求，觸發的動作可能會）
  ext-storage [key ...]     讀擴充的 chrome.storage.local；不給 key 時列出所有 key

會發官方請求（注意速率限制）：
  open <url|poe1|poe2|searchId> [--new]
                            重用（或 --new 新開）分頁前往並等擴充就緒；searchId 沿用目前聯盟
  reload                    重新整理目前搜尋頁並等擴充就緒
  act search                按官方「搜尋」並等結果
  act load-more             按「載入更多」
  act live on|off           切換官方線上搜尋

不發請求的官方操作：
  act filters show|hide     展開／收合篩選區
  act layout ${LAYOUTS.join('|')}
  act clear                 按官方「清除」

--tab N：有多個官方搜尋分頁時指定第 N 個（從 0 起，順序同 status）。`;

function print(value: unknown): void {
  console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}

async function status({ browser, cdpUrl }: DevBrowserConnection, args: CliArgs): Promise<void> {
  const trade = tradePages(browser);
  const selected = pickTradePage(browser, flagInt(args, 'tab'));
  print({
    cdpUrl,
    tabs: allPages(browser).map((page) => ({
      tradeIndex: trade.indexOf(page) >= 0 ? trade.indexOf(page) : undefined,
      url: page.url(),
    })),
  });
  if (!selected) return print('沒有官方搜尋分頁；可用 `pnpm poe open poe2` 開啟。');
  if (await isCloudflareChallenge(selected))
    return print('選取的分頁停在 Cloudflare 驗證頁，請手動通過。');
  print({ url: parseTradeUrl(selected.url()), page: await selected.evaluate(summarizeTradePage) });
}

async function open({ browser }: DevBrowserConnection, args: CliArgs): Promise<void> {
  const target = args.positionals[0];
  if (!target) throw new Error('用法：pnpm poe open <url|poe1|poe2|searchId>');
  const current = pickTradePage(browser, flagInt(args, 'tab'));
  const url = resolveOpenTarget(target, current ? parseTradeUrl(current.url()) : null);
  const page = !args.flags.new && current ? current : await browser.contexts()[0].newPage();
  await page.goto(url);
  await page.bringToFront();
  await waitForTradeReady(page);
  print({ opened: page.url(), page: await page.evaluate(summarizeTradePage) });
}

async function closeTrade({ browser }: DevBrowserConnection): Promise<void> {
  const trade = tradePages(browser);
  // 關掉最後一個分頁會連帶關掉 dev 瀏覽器視窗，先留一個空白分頁
  if (trade.length > 0 && trade.length === allPages(browser).length) {
    await browser.contexts()[0].newPage();
  }
  for (const page of trade) await page.close();
  print(`已關閉 ${trade.length} 個官方搜尋分頁`);
}

async function reload(page: Page): Promise<void> {
  await page.reload();
  await waitForTradeReady(page);
  print({ reloaded: page.url(), page: await page.evaluate(summarizeTradePage) });
}

async function store(page: Page, args: CliArgs): Promise<void> {
  const snapshot = await page.evaluate(snapshotStore, {
    path: args.positionals[0] ?? '',
    depth: flagInt(args, 'depth') ?? 3,
    maxItems: flagInt(args, 'items') ?? 5,
  });
  print(snapshot === undefined ? `store 裡沒有路徑「${args.positionals[0]}」` : snapshot);
}

async function net(page: Page, args: CliArgs): Promise<void> {
  const file = flagString(args, 'file');
  print(
    await captureResponses(page, {
      filter: flagString(args, 'filter') ?? '/api/',
      seconds: flagInt(args, 'seconds') ?? 10,
      maxBody: flagInt(args, 'max-body') ?? 600,
      fullUrl: Boolean(args.flags['full-url']),
      script: file ? await readFile(file, 'utf8') : undefined,
    }),
  );
}

async function evaluate(page: Page, args: CliArgs): Promise<void> {
  const file = flagString(args, 'file');
  const expr = args.positionals.join(' ');
  if (!file && !expr) throw new Error('用法：pnpm poe eval "<expr>" 或 pnpm poe eval --file x.js');
  const source = file
    ? `(async () => {\n${await readFile(file, 'utf8')}\n})()`
    : `(async () => (${expr}))()`;
  print((await page.evaluate(source)) ?? null);
}

/**
 * 量出元素在視窗中的位置。不用 `locator.screenshot()`：dev 瀏覽器在背景時 rAF 很慢，
 * Playwright 的「元素穩定」檢查會一直等到逾時。
 */
async function elementClip(page: Page, selector: string) {
  const target = page.locator(selector).first();
  if ((await target.count()) === 0) throw new Error(`頁面上找不到「${selector}」`);
  const box = await target.evaluate((el) => {
    el.scrollIntoView({ block: 'center' });
    const rect = el.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  if (!box.width || !box.height) throw new Error(`「${selector}」沒有可見尺寸`);
  return { x: Math.max(0, box.x), y: Math.max(0, box.y), width: box.width, height: box.height };
}

async function shot(page: Page, args: CliArgs): Promise<void> {
  const selector = args.positionals[0];
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = path.resolve(flagString(args, 'out') ?? path.join(SHOTS_DIR, `${stamp}.png`));
  await mkdir(path.dirname(out), { recursive: true });
  if (selector) await page.screenshot({ path: out, clip: await elementClip(page, selector) });
  else await page.screenshot({ path: out, fullPage: Boolean(args.flags.full) });
  print(`截圖：${out}`);
}

function onOff(value: string | undefined, on: string, off: string): boolean {
  if (value === on) return true;
  if (value === off) return false;
  throw new Error(`需要 ${on} 或 ${off}，收到「${value ?? ''}」`);
}

async function act(page: Page, args: CliArgs): Promise<void> {
  const [name, value] = args.positionals;
  const actions: Record<string, () => Promise<ActionResult>> = {
    search: () => runSearch(page),
    'load-more': () => loadMore(page),
    live: () => setLiveSearch(page, onOff(value, 'on', 'off')),
    filters: () => setFiltersVisible(page, onOff(value, 'show', 'hide')),
    clear: () => clearSearch(page),
    layout: () => {
      if (!LAYOUTS.includes(value as ResultLayout))
        throw new Error(`版型需為 ${LAYOUTS.join('|')}`);
      return setLayout(page, value as ResultLayout);
    },
  };
  const run = name ? actions[name] : undefined;
  if (!run)
    throw new Error(`未知的 act「${name ?? ''}」；可用：${Object.keys(actions).join(', ')}`);
  print(await run());
  print(await page.evaluate(summarizeTradePage));
}

/** 依賴版面尺寸的指令：視窗太小時暫時模擬桌面尺寸 */
const VIEWPORT_COMMANDS = new Set(['shot', 'act', 'eval', 'net']);

const PAGE_COMMANDS: Record<string, (page: Page, args: CliArgs) => Promise<void>> = {
  reload,
  store,
  eval: evaluate,
  net,
  shot,
  act,
};

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  if (!args.command || args.command === 'help' || args.flags.help) return print(HELP);
  await withDevBrowser(async (conn) => {
    if (args.command === 'status') return status(conn, args);
    if (args.command === 'open') return open(conn, args);
    if (args.command === 'close-trade') return closeTrade(conn);
    if (args.command === 'ext-storage')
      return print(await readExtensionStorage(conn.browser, args.positionals));
    const command = PAGE_COMMANDS[args.command ?? ''];
    if (!command) throw new Error(`未知的指令「${args.command}」，執行 pnpm poe help 查看`);
    const page = await requireTradePage(conn.browser, flagInt(args, 'tab'));
    if (VIEWPORT_COMMANDS.has(args.command ?? '')) {
      const note = await ensureUsableViewport(page);
      if (note) console.error(note);
    }
    return command(page, args);
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
