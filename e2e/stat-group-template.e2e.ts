import { test, expect } from './fixtures';

const CONTROL = '.search-advanced-pane.brown .filter-group-select';
const TRIGGER = '.poexd-stat-group-template-slot [data-test="stat-group-template-trigger"]';

test.describe('「新增屬性組合」旁的常用詞綴群組選單', () => {
  test.beforeEach(async ({ tradePage }) => {
    // 收合時官方只加上 search-advanced-hidden 並把高度設為 0，元素仍在且有尺寸，不能只看 isVisible
    const collapsed = await tradePage.locator('.search-advanced.search-advanced-hidden').count();
    test.skip(collapsed > 0, '官方篩選區已收合，請先按 Show Filters 展開');
  });

  test('緊貼在官方控制項左側並上下對齊', async ({ tradePage }) => {
    const control = tradePage.locator(CONTROL).first();
    const trigger = tradePage.locator(TRIGGER).first();
    await expect(trigger).toBeVisible();

    const controlBox = (await control.boundingBox())!;
    const triggerBox = (await trigger.boundingBox())!;
    expect(Math.abs(triggerBox.y - controlBox.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(triggerBox.height - controlBox.height)).toBeLessThanOrEqual(1);
    // 在左側且間距不超過 12px
    const gap = controlBox.x - (triggerBox.x + triggerBox.width);
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThanOrEqual(12);
  });

  test('打開選單時列出儲存、復原與管理項目', async ({ tradePage }) => {
    await tradePage.locator(TRIGGER).first().click();
    // 選單渲染在擴充功能的 shadow root 內，Playwright locator 會穿透 open shadow DOM
    const menu = tradePage.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByText('將目前詞綴群組存為常用…')).toBeVisible();
    await expect(menu.getByText('復原上次套用')).toBeVisible();
    await expect(menu.getByText('管理常用詞綴群組…')).toBeVisible();
    await tradePage.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  });
});

test.describe('官方頁面前提', () => {
  test('主世界可讀到官方 Vuex 的 persistent 狀態', async ({ tradePage }) => {
    const snapshot = await tradePage.evaluate(() => {
      type VueHost = Element & {
        __vue_app__?: { config?: { globalProperties?: { $store?: { state?: any } } } };
      };
      // 與 main-world 的 poe-runtime-reader 相同：依序找第一個帶 Vuex store 的掛載點
      const persistent = ['#trade', '#app']
        .map((selector) => (document.querySelector(selector) as VueHost | null)?.__vue_app__)
        .map((app) => app?.config?.globalProperties?.$store?.state?.persistent)
        .find(Boolean);
      return persistent
        ? { hasStats: Array.isArray(persistent.stats), hasFilters: 'filters' in persistent }
        : null;
    });
    expect(snapshot).toEqual({ hasStats: true, hasFilters: true });
  });
});
