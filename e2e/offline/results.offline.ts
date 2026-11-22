import type { Page } from '@playwright/test';
import { test, expect, POE1_FETCH, TRADE1_SEARCH_URL } from './fixtures';

/**
 * 搜尋結果列：替身頁以回放的官方 search / fetch 回應畫出結果列，
 * 擴充功能要從 MAIN world 攔截到 fetch 資料，並在每一列加上自己的操作按鈕。
 */

async function expectRowEnhancements(page: Page): Promise<void> {
  const rows = page.locator('.results .row[data-id]');
  await expect(rows).toHaveCount(POE1_FETCH.result.length);
  for (const row of await rows.all()) {
    // 左側工具列平常隱藏，hover 結果列才出現
    const actions = row.locator('.left .poexd-left-actions');
    await expect(actions.locator('.poexd-pob-copy-btn')).toBeAttached();
    await expect(actions.locator('.poexd-result-link-btn').first()).toBeAttached();
    await expect(actions.locator('.poexd-pin-btn')).toBeAttached();
  }
}

test.describe('搜尋結果列', () => {
  test('每一列都加上 PoB 複製、外部連結、釘選、詞綴快速篩選與價格換算', async ({
    page,
    pageErrors,
    network,
  }) => {
    await page.goto(TRADE1_SEARCH_URL);
    await expectRowEnhancements(page);

    const first = page.locator('.results .row[data-id]').first();
    await first.hover();
    await expect(first.locator('.poexd-pin-btn')).toBeVisible();
    await expect(
      first.locator('.item-mod--explicit .poexd-result-mod-actions').first(),
    ).toBeAttached();
    // 回放的 poe.ninja 匯率：1 alch = 0.1 chaos
    await expect(first.locator('.price .poexd-price-comparison')).toBeAttached();

    expect(pageErrors).toEqual([]);
    expect(network.blocked).toEqual([]);
  });

  test('首批結果比擴充功能初始化更早到達時，結果列仍加上按鈕', async ({ page }) => {
    // 已知問題：首批 fetch 事件早於側邊欄掛載時，結果列不會出現 PoB 複製／外部連結／釘選按鈕，
    // 要等下一次 fetch 才補上（詞綴快速篩選不受影響）。修好後移除 test.fail。
    test.fail();
    await page.goto(`${TRADE1_SEARCH_URL}?timing=early`);
    await expectRowEnhancements(page);
  });

  test('釘選的物品出現在側邊欄的釘選物品，重新整理後仍在', async ({ page, pageErrors }) => {
    await page.goto(TRADE1_SEARCH_URL);
    const first = POE1_FETCH.result[0];
    const row = page.locator(`.results .row[data-id="${first.id}"]`);
    await row.hover();
    await row.locator('.poexd-pin-btn').click();

    const sidebar = page.locator('poexd-sidebar-container');
    const openPinned = async () => {
      const expand = sidebar.getByRole('button', { name: 'Expand panel' });
      if (await expand.isVisible()) await expand.click();
      await sidebar.getByRole('button', { name: 'Pinned Items', exact: true }).click();
    };
    const itemName = first.item.name || first.item.typeLine;

    await openPinned();
    await expect(sidebar.getByText(itemName).first()).toBeVisible();

    await page.reload();
    await openPinned();
    await expect(sidebar.getByText(itemName).first()).toBeVisible();
    expect(pageErrors).toEqual([]);
  });
});
