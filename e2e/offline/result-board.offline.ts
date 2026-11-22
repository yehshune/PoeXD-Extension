import { test, expect, POE2_FETCH, POE2_NINJA_OVERVIEW, TRADE2_RESULTS_URL } from './fixtures';

/**
 * 搜尋結果看板（CONTEXT.md「Result Board」）：彙整這次搜尋已取得的結果，可排序、依賣家檢視，
 * 點結果會定位到官方結果列。用 PoE2 的錄音：同時有崇高石與混沌石標價，換算後排序才有差別。
 */

test.describe('搜尋結果看板', () => {
  test('從結果數旁的捷徑打開，依換算價格排序並定位到官方結果列', async ({
    page,
    pageErrors,
    network,
  }) => {
    await page.goto(TRADE2_RESULTS_URL);
    const officialRows = page.locator('.results .resultset .row[data-id]');
    await expect(officialRows).toHaveCount(POE2_FETCH.result.length);

    // 捷徑放在官方結果數列，點了直接打開側邊欄的看板
    await page.locator('.results > .row.row-total .poexd-board-shortcut').click();
    const sidebar = page.locator('poexd-sidebar-container');
    await expect(sidebar.locator('.active-tab-title')).toHaveText('Result Board');

    const entries = sidebar.locator('[data-board-entry-id]');
    await expect(entries).toHaveCount(POE2_FETCH.result.length);
    await expect(sidebar.getByText(`${POE2_FETCH.result.length} retrieved`)).toBeVisible();

    // 回放的 PoE2 匯率 1 chaos = 40 exalted：92 chaos（3,680 ex）最貴，2000 exalted 最便宜
    const mostExpensive = [...POE2_FETCH.result].sort(
      (a, b) => priceInExalted(b.listing.price) - priceInExalted(a.listing.price),
    )[0];
    const sortBy = async (mode: string) => {
      await sidebar.locator('[data-board-sort]').click();
      await sidebar.locator(`[data-board-sort-mode="${mode}"]`).click();
    };
    await sortBy('price-desc');
    await expect(entries.first()).toHaveAttribute('data-board-entry-id', mostExpensive.id);
    await sortBy('price-asc');
    await expect(entries.last()).toHaveAttribute('data-board-entry-id', mostExpensive.id);

    // 定位：捲到並標示那一筆官方結果列，不改動官方列表
    const target = entries.last();
    await target.hover();
    await target.getByRole('button', { name: 'Show in official results' }).click();
    await expect(page.locator(`.results .row[data-id="${mostExpensive.id}"]`)).toHaveClass(
      /poexd-board-locate/,
    );
    await expect(officialRows).toHaveCount(POE2_FETCH.result.length);

    // 賣家檢視：一次去同一個藏身處買多件，預設只列出至少 2 筆即時購買的賣家，可調低門檻
    const sellerCounts = new Map<string, number>();
    for (const entry of POE2_FETCH.result) {
      const name = entry.listing.account.name;
      sellerCounts.set(name, (sellerCounts.get(name) ?? 0) + 1);
    }
    const sellers = sidebar.locator('[data-board-seller]');
    await sidebar.locator('[data-board-view="sellers"]').click();
    await expect(sellers).toHaveCount([...sellerCounts.values()].filter((n) => n >= 2).length);
    await sidebar.getByRole('button', { name: 'Decrease minimum instant buyout count' }).click();
    await expect(sellers).toHaveCount(sellerCounts.size);

    expect(pageErrors).toEqual([]);
    expect(network.blocked).toEqual([]);
  });
});

const EXALTED_RATES = Object.fromEntries(
  POE2_NINJA_OVERVIEW.lines.map((line) => [line.id, line.primaryValue]),
);

function priceInExalted(price: { amount: number; currency: string }): number {
  return price.amount * (EXALTED_RATES[price.currency] ?? 0);
}
