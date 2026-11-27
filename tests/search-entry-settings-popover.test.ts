// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import { ConfigProvider } from 'reka-ui';
import SearchEntrySettingsPopover from '@/components/sidebar/SearchEntrySettingsPopover.vue';
import { resetI18nStateForTests } from '@/utils/i18n';
import type { BookmarkButtonPosition, SearchEntryClickAction } from '@/utils/preferences-contract';

describe('SearchEntrySettingsPopover', () => {
  let portalRoot: HTMLElement;
  let appRoot: HTMLElement;
  let app: ReturnType<typeof createApp> | undefined;

  beforeEach(() => {
    resetI18nStateForTests('zh-TW');
    document.body.innerHTML = '';
    portalRoot = document.createElement('div');
    portalRoot.id = 'poexd-portal-root';
    document.body.appendChild(portalRoot);

    appRoot = document.createElement('div');
    document.body.appendChild(appRoot);
  });

  afterEach(() => {
    app?.unmount();
    app = undefined;
    document.body.innerHTML = '';
    resetI18nStateForTests('zh-TW');
  });

  it('bookmark scope renders bookmark button position and click action, emits updates, and guards against empty toggle re-clicks', async () => {
    const addBookmarkBtnPosition = ref<BookmarkButtonPosition>('top');
    const searchEntryClickAction = ref<SearchEntryClickAction>('preview');

    app = createApp(
      defineComponent({
        setup() {
          return () =>
            h(ConfigProvider, { teleportTo: portalRoot, scrollBody: false }, () =>
              h(SearchEntrySettingsPopover, {
                scope: 'bookmark',
                open: true,
                addBookmarkBtnPosition: addBookmarkBtnPosition.value,
                searchEntryClickAction: searchEntryClickAction.value,
                'onUpdate:addBookmarkBtnPosition': (v: BookmarkButtonPosition) => {
                  addBookmarkBtnPosition.value = v;
                },
                'onUpdate:searchEntryClickAction': (v: SearchEntryClickAction) => {
                  searchEntryClickAction.value = v;
                },
              }),
            );
        },
      }),
    );
    app.mount(appRoot);
    await nextTick();

    const trigger = appRoot.querySelector<HTMLButtonElement>('[data-bookmark-settings]');
    expect(trigger).not.toBeNull();
    expect(trigger?.getAttribute('aria-label')).toBe('書籤設定');

    const panel = portalRoot.querySelector<HTMLElement>('[data-bookmark-settings-panel]');
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain('加入書籤按鈕位置');
    expect(panel?.textContent).toContain('左鍵點選書籤／歷史');

    // Toggle addBookmarkBtnPosition -> bottom -> re-click bottom (guarded)
    const bottomBtn = panel!.querySelector<HTMLButtonElement>(
      '[data-test="bookmark-btn-position"] [value="bottom"]',
    )!;
    bottomBtn.click();
    await nextTick();
    expect(addBookmarkBtnPosition.value).toBe('bottom');

    bottomBtn.click();
    await nextTick();
    expect(addBookmarkBtnPosition.value).toBe('bottom');

    // Toggle searchEntryClickAction -> open -> re-click open (guarded)
    const openBtn = panel!.querySelector<HTMLButtonElement>(
      '[data-test="search-entry-click-action"] [value="open"]',
    )!;
    openBtn.click();
    await nextTick();
    expect(searchEntryClickAction.value).toBe('open');

    openBtn.click();
    await nextTick();
    expect(searchEntryClickAction.value).toBe('open');
  });

  it('history scope renders only the shared click-action setting and omits bookmark-only controls', async () => {
    const searchEntryClickAction = ref<SearchEntryClickAction>('preview');

    app = createApp(
      defineComponent({
        setup() {
          return () =>
            h(ConfigProvider, { teleportTo: portalRoot, scrollBody: false }, () =>
              h(SearchEntrySettingsPopover, {
                scope: 'history',
                open: true,
                searchEntryClickAction: searchEntryClickAction.value,
                'onUpdate:searchEntryClickAction': (v: SearchEntryClickAction) => {
                  searchEntryClickAction.value = v;
                },
              }),
            );
        },
      }),
    );
    app.mount(appRoot);
    await nextTick();

    const trigger = appRoot.querySelector<HTMLButtonElement>('[data-history-settings]');
    expect(trigger).not.toBeNull();
    expect(trigger?.getAttribute('aria-label')).toBe('歷史設定');

    const panel = portalRoot.querySelector<HTMLElement>('[data-history-settings-panel]');
    expect(panel).not.toBeNull();
    expect(panel?.querySelector('[data-test="bookmark-btn-position"]')).toBeNull();
    expect(panel?.querySelector('[data-test="search-entry-click-action"]')).not.toBeNull();

    const openBtn = panel!.querySelector<HTMLButtonElement>(
      '[data-test="search-entry-click-action"] [value="open"]',
    )!;
    openBtn.click();
    await nextTick();
    expect(searchEntryClickAction.value).toBe('open');
  });
});
