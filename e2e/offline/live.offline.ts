import type { Locator, Page } from '@playwright/test';
import { test, expect, POE1_FETCH, TRADE1_SEARCH_ID, TRADE1_SEARCH_URL } from './fixtures';

/**
 * 線上搜尋主控台：從搜尋頁開啟主控台分頁（trade root），新增搜尋連線後，
 * 擴充功能在 content script 建立官方即時搜尋 WebSocket，收到 token 再 fetch，並寫進官方 Vuex store 顯示。
 * WebSocket 由 fixtures.ts 的回放端扮演官方伺服器，不會連到官方。
 */

const TRADE_ROOT = /^https:\/\/www\.pathofexile\.com\/trade\/?$/;

/** 取得主控台頁並新增一條「輸入搜尋網址」的連線，回傳該連線在側邊欄的那一列 */
async function addConnection(consolePage: Page, name: string): Promise<Locator> {
  const sidebar = consolePage.locator('poexd-sidebar-container');
  await (await sidebarButton(consolePage, '＋ Add Search Connection')).click();
  await sidebar.getByText('Enter Search URL').click();
  await sidebar.getByLabel('Search URL').fill(TRADE1_SEARCH_URL);
  await sidebar.getByLabel('Search Name (optional)').fill(name);
  await sidebar.getByRole('button', { name: 'Start', exact: true }).click();
  return sidebar.locator('[data-test="connection-item"]').filter({ hasText: name });
}

/** 側邊欄可能還在掛載、也可能已展開：等展開按鈕或目標按鈕其一出現，需要時才展開 */
async function sidebarButton(page: Page, name: string): Promise<Locator> {
  const sidebar = page.locator('poexd-sidebar-container');
  const expand = sidebar.getByRole('button', { name: 'Expand panel' });
  const target = sidebar.getByRole('button', { name, exact: true });
  await expect(expand.or(target)).toBeVisible();
  if (await expand.isVisible()) await expand.click();
  return target;
}

async function openConsole(page: Page): Promise<Page> {
  await page.goto(TRADE1_SEARCH_URL);
  const openButton = await sidebarButton(page, 'Open Live Search Console');
  const [consolePage] = await Promise.all([
    page.context().waitForEvent('page'),
    openButton.click(),
  ]);
  // 擴充功能以 chrome.tabs.create 開的分頁，第一次導覽不經過 context.route，由本機替身伺服器回應替身頁
  await consolePage.waitForURL(TRADE_ROOT);
  return consolePage;
}

test.describe('線上搜尋主控台', () => {
  test('新增搜尋連線後，即時推送的物品依序出現在主控台並加上擴充功能按鈕', async ({
    page,
    liveSockets,
    network,
  }) => {
    const consolePage = await openConsole(page);
    const consoleErrors: string[] = [];
    consolePage.on('pageerror', (error) => consoleErrors.push(`[pageerror] ${error.message}`));
    consolePage.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(`[console] ${message.text()}`);
    });

    const connection = await addConnection(consolePage, 'E2E Live');
    const socket = await liveSockets.waitFor(TRADE1_SEARCH_ID);
    await expect(connection).toBeVisible();

    const [first, second] = POE1_FETCH.result;
    const rows = consolePage.locator('.results .row[data-id]');
    socket.push(first.id);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveAttribute('data-id', first.id);
    await expect(rows.first().locator('.left .poexd-left-actions .poexd-pin-btn')).toBeAttached();

    // 官方把新的一批放在最前面
    socket.push(second.id);
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toHaveAttribute('data-id', second.id);
    await expect(rows.first().locator('.left .poexd-left-actions .poexd-pin-btn')).toBeAttached();

    expect(consoleErrors).toEqual([]);
    expect(network.blocked).toEqual([]);
  });

  test('連線中斷後自動重連，重連後的推送照常顯示', async ({ page, liveSockets }) => {
    const consolePage = await openConsole(page);
    const connection = await addConnection(consolePage, 'E2E Reconnect');
    const firstSocket = await liveSockets.waitFor(TRADE1_SEARCH_ID);
    await expect(connection.getByRole('button', { name: 'Pause' })).toBeVisible();

    firstSocket.drop();
    // 第一次重連約等 5 秒（±20%），期間顯示倒數
    await expect(connection.locator('[data-status^="Reconnecting"]')).toBeVisible();
    const secondSocket = await liveSockets.waitFor(TRADE1_SEARCH_ID, 2);
    await expect(connection.getByRole('button', { name: 'Pause' })).toBeVisible();

    const [item] = POE1_FETCH.result;
    secondSocket.push(item.id);
    await expect(consolePage.locator(`.results .row[data-id="${item.id}"]`)).toBeVisible();
  });

  test('暫停會關閉連線，重新啟用後再連上並顯示推送', async ({ page, liveSockets }) => {
    const consolePage = await openConsole(page);
    const connection = await addConnection(consolePage, 'E2E Pause');
    const firstSocket = await liveSockets.waitFor(TRADE1_SEARCH_ID);

    await connection.getByRole('button', { name: 'Pause' }).click();
    await firstSocket.closed;
    await connection.getByRole('button', { name: 'Enable' }).click();

    const secondSocket = await liveSockets.waitFor(TRADE1_SEARCH_ID, 2);
    await expect(connection.getByRole('button', { name: 'Pause' })).toBeVisible();
    const [item] = POE1_FETCH.result;
    secondSocket.push(item.id);
    await expect(consolePage.locator(`.results .row[data-id="${item.id}"]`)).toBeVisible();
  });

  test('移除連線會關閉 WebSocket 並從清單消失', async ({ page, liveSockets }) => {
    const consolePage = await openConsole(page);
    const connection = await addConnection(consolePage, 'E2E Remove');
    const socket = await liveSockets.waitFor(TRADE1_SEARCH_ID);

    await connection.hover();
    await connection.getByRole('button', { name: 'More actions' }).click();
    await consolePage.locator('[data-test^="btn-remove-"]').click();
    await socket.closed;
    await expect(connection).toHaveCount(0);
  });

  test('官方拒絕連線時進入重連倒數，而不是立刻重試', async ({ page, liveSockets }) => {
    // 模擬 search id 失效：官方在 WebSocket 握手階段就拒絕
    liveSockets.reject(TRADE1_SEARCH_ID);
    const consolePage = await openConsole(page);
    const connection = await addConnection(consolePage, 'E2E Rejected');

    await liveSockets.waitForRejection(TRADE1_SEARCH_ID);
    await expect(connection.locator('[data-status^="Reconnecting in"]')).toBeVisible();
  });
});
