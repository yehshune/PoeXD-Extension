// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import { ConfigProvider } from 'reka-ui';
import SearchEntrySettingsPopover from '@/components/sidebar/SearchEntrySettingsPopover.vue';
import { resetI18nStateForTests } from '@/utils/i18n';
import {
  createInMemoryPreferencesStorage,
  createPreferencesModule,
  type PreferencesModule,
} from '@/utils/preferences';
import type { BookmarkButtonPosition, SearchEntryClickAction } from '@/utils/preferences-contract';

let activePrefsModule: PreferencesModule | null = null;

vi.mock('sortablejs', () => ({
  default: {
    create: vi.fn(() => ({ destroy: vi.fn(), option: vi.fn() })),
  },
}));

vi.mock('@/utils/trade-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/trade-context')>()),
  getPoeVersion: () => 'poe1',
}));

vi.mock('@/utils/preferences', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/preferences')>();
  return {
    ...actual,
    getPreferences: vi.fn(async () =>
      activePrefsModule
        ? { ok: true as const, value: activePrefsModule }
        : {
            ok: false as const,
            error: { code: 'unavailable' as const, message: 'no mock module' },
          },
    ),
  };
});

vi.mock('@/utils/bookmark-messaging', () => ({
  createChromeBookmarkClient: () => ({
    readCollection: vi.fn(async () => ({ ok: true, value: { bookmarks: [], groups: [] } })),
    subscribe: vi.fn(() => () => {}),
  }),
}));

vi.mock('@/utils/search-record-messaging', () => ({
  createChromeSearchRecordClient: () => ({
    execute: vi.fn(async () => ({ ok: true, value: undefined })),
  }),
}));

vi.mock('@/components/sidebar/history-domain-feed', () => ({
  createHistoryDomainFeed: (_client: unknown, _version: unknown, onSnapshot: (s: any) => void) => ({
    start: vi.fn(async () => {
      onSnapshot({ history: [], enabled: true });
    }),
    stop: vi.fn(),
    refresh: vi.fn(async () => {
      onSnapshot({ history: [], enabled: true });
    }),
  }),
}));

import BookmarkPane from '@/components/sidebar/BookmarkPane.vue';
import HistoryPane from '@/components/sidebar/HistoryPane.vue';

const flushAsync = async () => {
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await nextTick();
};

describe('SearchEntrySettingsPopover', () => {
  let portalRoot: HTMLElement;
  let appRoot: HTMLElement;
  let app: ReturnType<typeof createApp> | undefined;

  beforeEach(() => {
    resetI18nStateForTests('zh-TW');
    activePrefsModule = null;
    document.body.innerHTML = '';
    portalRoot = document.createElement('div');
    portalRoot.id = 'poexd-portal-root';
    document.body.appendChild(portalRoot);

    appRoot = document.createElement('div');
    document.body.appendChild(appRoot);

    (globalThis as any).chrome = {
      storage: {
        local: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => {}),
        },
        onChanged: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
      },
      tabs: {
        query: vi.fn(async () => [{ title: 'Trade', url: 'https://www.pathofexile.com/trade' }]),
      },
    };
  });

  afterEach(() => {
    app?.unmount();
    app = undefined;
    document.body.innerHTML = '';
    resetI18nStateForTests('zh-TW');
  });

  it('bookmark scope renders bookmark button position and click action, emits updates, and guards against empty toggle re-clicks', async () => {
    const addBookmarkBtnPosition = ref<BookmarkButtonPosition>('top');
    const clickAction = ref<SearchEntryClickAction>('preview');

    app = createApp(
      defineComponent({
        setup() {
          return () =>
            h(ConfigProvider, { teleportTo: portalRoot, scrollBody: false }, () =>
              h(SearchEntrySettingsPopover, {
                scope: 'bookmark',
                open: true,
                addBookmarkBtnPosition: addBookmarkBtnPosition.value,
                clickAction: clickAction.value,
                'onUpdate:addBookmarkBtnPosition': (v: BookmarkButtonPosition) => {
                  addBookmarkBtnPosition.value = v;
                },
                'onUpdate:clickAction': (v: SearchEntryClickAction) => {
                  clickAction.value = v;
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
    expect(panel?.textContent).toContain('左鍵點選書籤');
    expect(panel?.textContent).not.toContain('同步套用');

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

    // Toggle clickAction -> open -> re-click open (guarded)
    const openBtn = panel!.querySelector<HTMLButtonElement>(
      '[data-test="search-entry-click-action"] [value="open"]',
    )!;
    openBtn.click();
    await nextTick();
    expect(clickAction.value).toBe('open');

    openBtn.click();
    await nextTick();
    expect(clickAction.value).toBe('open');
  });

  it('history scope renders only history click action and omits bookmark-only controls', async () => {
    const clickAction = ref<SearchEntryClickAction>('preview');

    app = createApp(
      defineComponent({
        setup() {
          return () =>
            h(ConfigProvider, { teleportTo: portalRoot, scrollBody: false }, () =>
              h(SearchEntrySettingsPopover, {
                scope: 'history',
                open: true,
                clickAction: clickAction.value,
                'onUpdate:clickAction': (v: SearchEntryClickAction) => {
                  clickAction.value = v;
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
    expect(panel?.textContent).toContain('左鍵點選紀錄');
    expect(panel?.textContent).not.toContain('同步套用');
    expect(panel?.querySelector('[data-test="bookmark-btn-position"]')).toBeNull();
    expect(panel?.querySelector('[data-test="search-entry-click-action"]')).not.toBeNull();

    const openBtn = panel!.querySelector<HTMLButtonElement>(
      '[data-test="search-entry-click-action"] [value="open"]',
    )!;
    openBtn.click();
    await nextTick();
    expect(clickAction.value).toBe('open');
  });

  it('BookmarkPane persists bookmarkClickAction independently from historyClickAction and closes popover when active becomes false', async () => {
    const storage = createInMemoryPreferencesStorage();
    const loaded = await createPreferencesModule('poe1', storage);
    if (!loaded.ok) throw new Error('failed to init prefs');
    activePrefsModule = loaded.value;

    const active = ref(true);
    app = createApp(
      defineComponent({
        setup() {
          return () =>
            h(ConfigProvider, { teleportTo: portalRoot, scrollBody: false }, () =>
              h(BookmarkPane, { active: active.value }),
            );
        },
      }),
    );
    app.mount(appRoot);
    await flushAsync();

    appRoot.querySelector<HTMLButtonElement>('[data-bookmark-settings]')!.click();
    await flushAsync();
    const panel = portalRoot.querySelector<HTMLElement>('[data-bookmark-settings-panel]');
    expect(panel).not.toBeNull();

    panel!
      .querySelector<HTMLButtonElement>('[data-test="search-entry-click-action"] [value="open"]')!
      .click();
    await flushAsync();

    expect(activePrefsModule.read().bookmarkClickAction).toBe('open');
    expect(activePrefsModule.read().historyClickAction).toBe('preview');

    // Switching tabs or collapsing sidebar sets active=false -> popover closes cleanly
    active.value = false;
    await flushAsync();
    expect(portalRoot.querySelector('[data-bookmark-settings-panel]')).toBeNull();
  });

  it('HistoryPane persists historyClickAction independently from bookmarkClickAction and closes popover when active becomes false', async () => {
    const storage = createInMemoryPreferencesStorage();
    const loaded = await createPreferencesModule('poe1', storage);
    if (!loaded.ok) throw new Error('failed to init prefs');
    activePrefsModule = loaded.value;

    const active = ref(true);
    app = createApp(
      defineComponent({
        setup() {
          return () =>
            h(ConfigProvider, { teleportTo: portalRoot, scrollBody: false }, () =>
              h(HistoryPane, { active: active.value }),
            );
        },
      }),
    );
    app.mount(appRoot);
    await flushAsync();

    appRoot.querySelector<HTMLButtonElement>('[data-history-settings]')!.click();
    await flushAsync();
    const panel = portalRoot.querySelector<HTMLElement>('[data-history-settings-panel]');
    expect(panel).not.toBeNull();

    panel!
      .querySelector<HTMLButtonElement>('[data-test="search-entry-click-action"] [value="open"]')!
      .click();
    await flushAsync();

    expect(activePrefsModule.read().historyClickAction).toBe('open');
    expect(activePrefsModule.read().bookmarkClickAction).toBe('preview');

    // Switching tabs or collapsing sidebar sets active=false -> popover closes cleanly
    active.value = false;
    await flushAsync();
    expect(portalRoot.querySelector('[data-history-settings-panel]')).toBeNull();
  });
});
