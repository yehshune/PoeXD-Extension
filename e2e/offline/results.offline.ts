import type { Page } from '@playwright/test';
import {
  test,
  expect,
  POE1_FETCH,
  POE2_FETCH,
  TRADE1_SEARCH_URL,
  TRADE2_RESULTS_URL,
} from './fixtures';

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

  test('首批結果比擴充功能初始化更早到達時，結果列仍加上按鈕', async ({ page, pageErrors }) => {
    // 迴歸測試：攔截器曾排在讀偏好設定等 await 之後才注入，官方首批 search / fetch 會整批漏接。
    // 現在攔截器最先注入，各功能的監聽較晚註冊，靠初始化期間的事件緩衝補送首批事件。
    await page.goto(`${TRADE1_SEARCH_URL}?timing=early`);
    await expectRowEnhancements(page);
    expect(pageErrors).toEqual([]);
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

test.describe('PoE2 搜尋結果列', () => {
  test('每一列都加上 PoB 複製、外部連結、釘選、詞綴快速篩選與價格換算', async ({
    page,
    pageErrors,
    network,
  }) => {
    await page.goto(TRADE2_RESULTS_URL);
    const rows = page.locator('.results .row[data-id]');
    await expect(rows).toHaveCount(POE2_FETCH.result.length);
    for (const row of await rows.all()) {
      const actions = row.locator('.left .poexd-left-actions');
      await expect(actions.locator('.poexd-pob-copy-btn')).toBeAttached();
      await expect(actions.locator('.poexd-result-link-btn').first()).toBeAttached();
      await expect(actions.locator('.poexd-pin-btn')).toBeAttached();
    }
    await expect(
      rows.first().locator('.item-mod--explicit .poexd-result-mod-actions').first(),
    ).toBeAttached();

    // 回放的 PoE2 匯率：1 chaos = 40 exalted；崇高石標價的物品不需要換算
    const chaosListing = POE2_FETCH.result.find(
      (entry) => entry.listing.price.currency === 'chaos',
    );
    if (!chaosListing) throw new Error('poe2-fetch.json 需要至少一筆以混沌石標價的物品');
    const chaosRow = page.locator(`.results .row[data-id="${chaosListing.id}"]`);
    await expect(chaosRow.locator('.price .poexd-price-comparison')).toContainText(
      (chaosListing.listing.price.amount * 40).toLocaleString('en-US'),
    );
    for (const entry of POE2_FETCH.result.filter((e) => e.listing.price.currency === 'exalted')) {
      await expect(
        page.locator(`.results .row[data-id="${entry.id}"] .poexd-price-comparison`),
      ).toHaveCount(0);
    }

    expect(pageErrors).toEqual([]);
    expect(network.blocked).toEqual([]);
  });
});
