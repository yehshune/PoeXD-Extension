import { test, expect, TRADE2_SEARCH_URL } from './fixtures';

/**
 * 擴充功能在官方交易頁的啟動流程：service worker、content script、MAIN world 攔截器、
 * 側邊欄與 toast 的 shadow host 都要就緒，且過程中沒有錯誤也沒有對外連線。
 */
test.describe('啟動', () => {
  test('在官方搜尋頁掛上側邊欄與 toast，且沒有錯誤', async ({ page, network, pageErrors }) => {
    await page.goto(TRADE2_SEARCH_URL);

    const sidebar = page.locator('poexd-sidebar-container');
    await expect(sidebar).toBeAttached();
    await expect(page.locator('poexd-toast-container')).toBeAttached();
    await expect(sidebar.getByRole('button', { name: 'Expand panel' })).toBeVisible();

    // interceptor.js 以 <script> 注入 MAIN world 後會包裝 window.fetch
    await expect
      .poll(() => page.evaluate(() => window.fetch.toString().includes('[native code]')))
      .toBe(false);

    expect(pageErrors).toEqual([]);
    expect(network.blocked).toEqual([]);
  });

  test.describe('全新安裝', () => {
    test.use({ freshInstall: true });

    test('第一次展開側邊欄時開始初始導覽', async ({ page }) => {
      await page.goto(TRADE2_SEARCH_URL);
      const sidebar = page.locator('poexd-sidebar-container');
      await sidebar.getByRole('button', { name: 'Expand panel' }).click();
      await expect(sidebar.locator('[data-page-guide-blocker]')).toBeVisible();
    });
  });

  test('非交易頁不注入任何介面', async ({ page }) => {
    await page.goto('https://www.pathofexile.com/trade2/search/poe2/Standard');
    await expect(page.locator('poexd-sidebar-container')).toBeAttached();
    // 同網域的論壇頁只會執行 market-translation，不會掛側邊欄
    await page.goto('https://www.pathofexile.com/forum');
    await expect(page.locator('poexd-sidebar-container')).toHaveCount(0);
  });
});
