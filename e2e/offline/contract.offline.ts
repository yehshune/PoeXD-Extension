import type { Page } from '@playwright/test';
import {
  inspectOfficialPage,
  RESULT_ROW_DOM,
  RESULT_ROW_SELECTOR,
  SEARCH_PAGE_DOM,
  STORE_MUTATIONS,
  type CheckResult,
} from '../official-page-contract.ts';
import {
  test,
  expect,
  POE1_FETCH,
  POE2_FETCH,
  TRADE1_SEARCH_URL,
  TRADE2_RESULTS_URL,
} from './fixtures';

/**
 * 替身頁對齊官方契約：實機金絲雀（pnpm e2e:canary）用同一份契約檢查真正的官方頁面，
 * 這裡確保替身頁也滿足其中標成 `offline: true` 的項目，替身頁不會悄悄和官方脫節。
 */

const offlineOnly = <T extends { offline: boolean }>(checks: readonly T[]) =>
  checks.filter((check) => check.offline);

async function failedChecks(page: Page): Promise<CheckResult[]> {
  const inspection = await page.evaluate(inspectOfficialPage, {
    searchPage: offlineOnly(SEARCH_PAGE_DOM),
    rowSelector: RESULT_ROW_SELECTOR,
    row: offlineOnly(RESULT_ROW_DOM),
    mutations: STORE_MUTATIONS,
    requireRows: true,
  });
  return inspection.results.filter((result) => !result.ok);
}

test.describe('替身頁對齊官方契約', () => {
  for (const { game, url, count } of [
    { game: 'PoE1', url: TRADE1_SEARCH_URL, count: POE1_FETCH.result.length },
    { game: 'PoE2', url: TRADE2_RESULTS_URL, count: POE2_FETCH.result.length },
  ]) {
    test(`${game} 搜尋頁的 DOM 結構符合契約`, async ({ page }) => {
      await page.goto(url);
      await expect(page.locator(RESULT_ROW_SELECTOR)).toHaveCount(count);
      expect(await failedChecks(page)).toEqual([]);
    });
  }

  test('Trade root 的官方 store 符合契約', async ({ page }) => {
    await page.goto('https://www.pathofexile.com/trade');
    const inspection = await page.evaluate(inspectOfficialPage, {
      searchPage: [],
      rowSelector: RESULT_ROW_SELECTOR,
      row: [],
      mutations: STORE_MUTATIONS,
      requireRows: false,
    });
    expect(inspection.results.filter((result) => !result.ok)).toEqual([]);
    expect(inspection.results.map((result) => result.id)).toContain('store-mutations');
  });
});
