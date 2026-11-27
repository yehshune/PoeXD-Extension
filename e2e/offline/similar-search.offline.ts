import type { Page } from '@playwright/test';
import { test, expect, POE1_FETCH, TRADE1_SEARCH_URL } from './fixtures';

/**
 * 找相似（ADR-0020）：結果列的「相似」按鈕開面板 → 開始 → 每一批結果變成官方 store 的合成 search，
 * 在官方結果區顯示並加上 Similarity 標章；回到我的搜尋或按官方搜尋時移除合成 search。
 * 回放的 search 每次都回同樣 5 筆，所以會一路放寬到用完 4 次搜尋。
 */

const SIMILAR_PREFIX = 'poexd_similar_';

function storeLocalIds(page: Page): Promise<{ ids: string[]; active: string | null }> {
  return page.evaluate(() => {
    const store = (document.querySelector('#trade') as any).__vue_app__.config.globalProperties
      .$store;
    return {
      ids: store.state.transient.searches.map((search: { localId: string }) => search.localId),
      active: store.state.transient.search.active?.localId ?? null,
    };
  });
}

async function openPanel(page: Page) {
  const row = page.locator('.results .row[data-id]').first();
  await expect(page.locator('.results .row[data-id]')).toHaveCount(POE1_FETCH.result.length);
  await row.hover();
  await row.locator('.poexd-similar-btn').click();
  const panel = page.locator('[data-similar-panel]');
  await expect(panel).toBeVisible();
  return panel;
}

test.describe('找相似', () => {
  test('從結果列開始找相似，批次顯示在官方結果區並可回到我的搜尋', async ({
    page,
    pageErrors,
    network,
  }) => {
    const searches: unknown[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/api/trade/search/')) {
        searches.push(request.postDataJSON());
      }
    });
    await page.goto(TRADE1_SEARCH_URL);
    const panel = await openPanel(page);
    await expect(panel.locator('[data-similar-stat]').first()).toBeVisible();
    const officialSearches = searches.length;

    await panel.locator('[data-similar-start]').click();
    await expect(panel).toHaveAttribute('data-phase', 'done');
    expect(searches.length - officialSearches).toBe(4);
    await expect(panel.locator('[data-similar-tab]')).toHaveText([
      /My search/,
      /Strict/,
      /Relaxed 1/,
      /Relaxed 2/,
      /Relaxed 3/,
      /By similarity/,
    ]);
    await expect(panel.locator('[data-similar-tab="similarity"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('.results .row[data-id] .poexd-similar-badge')).toHaveCount(
      POE1_FETCH.result.length,
    );
    expect((await storeLocalIds(page)).active).toBe(`${SIMILAR_PREFIX}similarity`);

    await panel.locator('[data-similar-tab="home"]').click();
    await expect(page.locator('.poexd-similar-badge')).toHaveCount(0);
    expect((await storeLocalIds(page)).active).toBe('search_1');

    await panel.locator('[data-similar-back]').click();
    await expect(panel.locator('[data-similar-tab]')).toHaveCount(0);
    expect(await storeLocalIds(page)).toEqual({ ids: ['search_1'], active: 'search_1' });
    await expect(page.locator('.results .row[data-id]')).toHaveCount(POE1_FETCH.result.length);

    expect(pageErrors).toEqual([]);
    expect(network.blocked).toEqual([]);
  });

  test('按官方搜尋時移除找相似的合成 search，留下官方的新搜尋', async ({ page, pageErrors }) => {
    await page.goto(TRADE1_SEARCH_URL);
    const panel = await openPanel(page);
    await panel.locator('[data-similar-start]').click();
    await expect(panel).toHaveAttribute('data-phase', 'done');

    await page.evaluate(() => (window as any).e2eSearch());
    await expect(panel.locator('[data-similar-status]')).toHaveText(/new search/);
    await expect
      .poll(async () => (await storeLocalIds(page)).ids.some((id) => id.startsWith(SIMILAR_PREFIX)))
      .toBe(false);
    expect((await storeLocalIds(page)).active).toBe('search_2');

    await panel.locator('[data-similar-close]').click();
    await expect(panel).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });
});
