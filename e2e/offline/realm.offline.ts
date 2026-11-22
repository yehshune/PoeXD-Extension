import { test, expect, POE1_FETCH, TRADE1_TW_SEARCH_URL } from './fixtures';

/**
 * 台服（Garena，pathofexile.tw）：同一套官方前端，但介面語系依網域判定為 zh-TW，
 * 且 poe.ninja 只有國際服匯率，所以不提供價格換算。
 */

test.describe('台服市集', () => {
  test('介面為繁體中文，結果列有按鈕但沒有價格換算', async ({ page, pageErrors, network }) => {
    await page.goto(TRADE1_TW_SEARCH_URL);

    const rows = page.locator('.results .row[data-id]');
    await expect(rows).toHaveCount(POE1_FETCH.result.length);
    for (const row of await rows.all()) {
      await expect(row.locator('.left .poexd-left-actions .poexd-pin-btn')).toBeAttached();
      await expect(row.locator('.left .poexd-left-actions .poexd-pob-copy-btn')).toBeAttached();
    }

    const sidebar = page.locator('poexd-sidebar-container');
    await sidebar.getByRole('button', { name: '展開面板' }).click();
    await expect(sidebar.getByRole('button', { name: '搜尋歷史', exact: true })).toBeVisible();
    await expect(sidebar.getByRole('button', { name: '快速書籤', exact: true })).toBeVisible();

    // 工具頁明確標示這個網域不支援價格換算；結果列也不加換算
    await sidebar.getByRole('button', { name: '工具與資訊', exact: true }).click();
    await expect(sidebar.locator('.price-conversion-unsupported')).toContainText('台服');
    await expect(page.locator('.price .poexd-price-comparison')).toHaveCount(0);

    expect(pageErrors).toEqual([]);
    expect(network.blocked).toEqual([]);
  });
});
