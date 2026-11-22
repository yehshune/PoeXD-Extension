import type { Locator, Page } from '@playwright/test';
import {
  test,
  expect,
  searchResultIds,
  TRADE1_SEARCH_URL,
  TRADE1_SECOND_SEARCH_ID,
} from './fixtures';

/**
 * 在官方頁面上換搜尋（SPA：POST search 後 pushState 換網址，不重新載入頁面）。
 * 擴充功能要跟著換掉結果列的增強，並把新的搜尋記進搜尋紀錄。
 */

async function waitForFirstResults(page: Page): Promise<void> {
  await expect(page.locator('.results .row[data-id] .poexd-pin-btn')).toHaveCount(
    searchResultIds('').length,
  );
}

/** 模擬使用者在官方搜尋列輸入名稱（可省略）後按下搜尋 */
async function searchOnPage(page: Page, searchId: string, name?: string): Promise<void> {
  if (name) await page.locator('.search-bar .search-left input').fill(name);
  await page.evaluate((id) => (window as any).e2eSearch(id), searchId);
}

async function openHistory(page: Page): Promise<Locator> {
  const sidebar = page.locator('poexd-sidebar-container');
  await sidebar.getByRole('button', { name: 'Expand panel' }).click();
  await sidebar.getByRole('button', { name: 'Search History', exact: true }).click();
  return sidebar.locator('.history-row-item');
}

test.describe('在頁面上換搜尋', () => {
  test('換成新搜尋的結果列，每一列都有擴充功能的按鈕', async ({ page, pageErrors, network }) => {
    await page.goto(TRADE1_SEARCH_URL);
    await waitForFirstResults(page);

    await searchOnPage(page, TRADE1_SECOND_SEARCH_ID);
    await expect(page).toHaveURL(new RegExp(`/trade/search/Standard/${TRADE1_SECOND_SEARCH_ID}$`));

    const expected = searchResultIds(TRADE1_SECOND_SEARCH_ID);
    const rows = page.locator('.results .row[data-id]');
    await expect(rows).toHaveCount(expected.length);
    for (const [index, id] of expected.entries()) {
      const row = rows.nth(index);
      await expect(row).toHaveAttribute('data-id', id);
      await expect(row.locator('.poexd-pob-copy-btn')).toBeAttached();
      await expect(row.locator('.poexd-pin-btn')).toBeAttached();
      await expect(row.locator('.price .poexd-price-comparison')).toBeAttached();
    }

    expect(pageErrors).toEqual([]);
    expect(network.blocked).toEqual([]);
  });

  test('新搜尋以搜尋列的名稱記進搜尋紀錄', async ({ page, pageErrors }) => {
    await page.goto(TRADE1_SEARCH_URL);
    await waitForFirstResults(page);

    await searchOnPage(page, TRADE1_SECOND_SEARCH_ID, 'E2E Greaves');
    const history = await openHistory(page);
    await expect(history).toHaveCount(1);
    await expect(history.first()).toContainText('E2E Greaves');
    // 官方格式的 search id 不會被標成失效的舊網址
    await expect(history.first().locator('.legacy-search-badge')).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });

  test('沒有名稱的新搜尋以介面語系的預設名稱記錄', async ({ page }) => {
    await page.goto(TRADE1_SEARCH_URL);
    await waitForFirstResults(page);

    await searchOnPage(page, TRADE1_SECOND_SEARCH_ID);
    const history = await openHistory(page);
    await expect(history).toHaveCount(1);
    await expect(history.first()).toContainText('Unnamed Search');
  });
});
