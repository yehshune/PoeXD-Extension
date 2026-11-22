import type { Locator, Page } from '@playwright/test';
import { test, expect, TRADE2_SEARCH_URL } from './fixtures';

function sidebar(page: Page): Locator {
  return page.locator('poexd-sidebar-container');
}

async function openSidebar(page: Page): Promise<Locator> {
  await page.goto(TRADE2_SEARCH_URL);
  const root = sidebar(page);
  await root.getByRole('button', { name: 'Expand panel' }).click();
  await expect(root.getByRole('button', { name: 'Close panel' })).toBeVisible();
  return root;
}

test.describe('側邊欄', () => {
  test('展開後可切換各模組並收合', async ({ page, pageErrors }) => {
    const root = await openSidebar(page);
    const title = root.locator('.active-tab-title');

    for (const name of ['Quick Bookmarks', 'Search History', 'Tools & Info', 'System Settings']) {
      await root.getByRole('button', { name, exact: true }).click();
      await expect(title).toHaveText(name);
    }

    // 展開的側邊欄要完整落在視窗內
    const viewport = page.viewportSize()!;
    const box = (await root.locator('.pxd-sidebar-wrapper').boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.height).toBeGreaterThan(viewport.height / 2);

    await root.getByRole('button', { name: 'Close panel' }).click();
    await expect(root.getByRole('button', { name: 'Expand panel' })).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test('新增的書籤資料夾在重新整理後仍在', async ({ page, pageErrors }) => {
    const root = await openSidebar(page);
    await root.getByRole('button', { name: 'Quick Bookmarks', exact: true }).click();
    const pane = root.locator('.bookmark-pane');
    await expect(pane.getByText('No bookmarks yet')).toBeVisible();

    await pane.getByRole('button', { name: 'New Folder' }).first().click();
    // 新資料夾建立後直接進入改名，輸入新名稱並送出
    const rename = pane.locator('input:focus');
    await expect(rename).toBeVisible();
    await rename.fill('E2E Folder');
    await rename.press('Enter');
    await expect(pane.getByText('E2E Folder')).toBeVisible();

    // 書籤由 background 寫入 chrome.storage，重新整理後要從 storage 讀回
    await page.reload();
    const reloaded = sidebar(page);
    // 側邊欄展開狀態與目前分頁會被記住；若仍收合就再展開一次
    const expand = reloaded.getByRole('button', { name: 'Expand panel' });
    if (await expand.isVisible()) await expand.click();
    await reloaded.getByRole('button', { name: 'Quick Bookmarks', exact: true }).click();
    await expect(reloaded.locator('.bookmark-pane').getByText('E2E Folder')).toBeVisible();
    expect(pageErrors).toEqual([]);
  });
});
