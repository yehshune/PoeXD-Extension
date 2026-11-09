import { test, expect } from './fixtures';

const POPOVER = '[data-test="search-preview-popover"]';

test.describe('書籤的 Search Preview 彈窗', () => {
  test.beforeEach(async ({ tradePage }) => {
    const rows = tradePage.locator('.bookmark-row-item');
    test.skip((await rows.count()) === 0, 'dev 設定檔裡沒有書籤可預覽');
    // 確保從關閉狀態開始：上一次留下的預覽會讓切換按鈕變成關閉
    await tradePage.keyboard.press('Escape');
    await expect(tradePage.locator(POPOVER)).toHaveCount(0);
  });

  test.afterEach(async ({ tradePage }) => {
    await tradePage.keyboard.press('Escape');
  });

  test('標題列分成來源與操作兩行，按鈕文字不換行', async ({ tradePage }) => {
    const row = tradePage.locator('.bookmark-row-item').first();
    await row.hover();
    await row.locator('[data-test="bookmark-preview-toggle"]').click();
    const popover = tradePage.locator(POPOVER);
    await expect(popover).toBeVisible();

    const name = (await row.innerText()).trim().split('\n')[0];
    await expect(popover.locator('[data-test="preview-source-name"]')).toHaveText(name);

    const buttons = popover.locator('.preview-action-row button');
    const heights = await buttons.evaluateAll((els) =>
      els.map((el) => {
        const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 16;
        return el.getBoundingClientRect().height / lineHeight;
      }),
    );
    expect(heights.length).toBeGreaterThan(0);
    // 單行按鈕高度不會超過兩倍行高（換行時會）
    for (const ratio of heights) expect(ratio).toBeLessThan(2);
  });

  test('詞綴以群組卡片呈現且不出現混合詞綴的原始分隔符', async ({ tradePage }) => {
    const row = tradePage.locator('.bookmark-row-item').first();
    await row.hover();
    await row.locator('[data-test="bookmark-preview-toggle"]').click();
    const popover = tradePage.locator(POPOVER);
    await expect(popover).toBeVisible();
    await expect(popover.locator('.preview-body')).not.toContainText('|||||');
    const cards = popover.locator('.preview-stat-group');
    if ((await cards.count()) > 0) {
      await expect(cards.first().locator('.preview-stat-group-type')).toBeVisible();
    }
  });
});
