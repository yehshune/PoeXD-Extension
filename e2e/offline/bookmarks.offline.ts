import {
  test,
  expect,
  POE1_FETCH,
  TRADE1_SEARCH_ID,
  TRADE1_SECOND_SEARCH_ID,
  TRADE1_SEARCH_URL,
} from './fixtures';

/**
 * 快速書籤：把目前搜尋存進資料夾，換到別的搜尋後再從書籤打開，要回到原本的搜尋。
 * 存書籤前擴充功能會以官方根元件的 `save(true)` 把表單寫進網址，替身頁提供這個方法。
 */

test.describe('快速書籤', () => {
  test('存下目前搜尋，換搜尋後從書籤打開會回到原本的搜尋', async ({
    page,
    pageErrors,
    network,
  }) => {
    await page.goto(TRADE1_SEARCH_URL);
    const rows = page.locator('.results .row[data-id]');
    await expect(rows).toHaveCount(POE1_FETCH.result.length);

    const sidebar = page.locator('poexd-sidebar-container');
    await sidebar.getByRole('button', { name: 'Expand panel' }).click();
    await sidebar.getByRole('button', { name: 'Quick Bookmarks', exact: true }).click();
    const pane = sidebar.locator('.bookmark-pane');
    await pane.getByRole('button', { name: 'New Folder' }).first().click();
    const rename = pane.locator('input:focus');
    await rename.fill('E2E Folder');
    await rename.press('Enter');

    // 資料夾標題列的新增按鈕平常隱藏，hover 才出現
    await pane.getByText('E2E Folder').hover();
    await pane.getByRole('button', { name: 'Add current page to this folder' }).click();
    const bookmark = pane.locator('.bookmark-row-item');
    await expect(bookmark).toHaveCount(1);
    // 官方頁面標題是通用的「Trade - Path of Exile」，書籤名稱改由 search id 解出的搜尋條件推導
    await expect(bookmark).toContainText('Coronal Leather');

    // 在頁面上換成另一個搜尋（SPA，網址換成新的 search id）
    await page.evaluate((id) => (window as any).e2eSearch(id), TRADE1_SECOND_SEARCH_ID);
    await expect(page).toHaveURL(new RegExp(`${TRADE1_SECOND_SEARCH_ID}$`));
    await expect(rows).toHaveCount(2);

    // 預設點書籤名稱是預覽，開啟搜尋用 hover 才出現的按鈕
    await bookmark.hover();
    await bookmark.getByTitle('Open Search').click();
    await expect(page).toHaveURL(new RegExp(`/trade/search/Standard/${TRADE1_SEARCH_ID}$`));
    await expect(rows).toHaveCount(POE1_FETCH.result.length);

    expect(pageErrors).toEqual([]);
    expect(network.blocked).toEqual([]);
  });
});
