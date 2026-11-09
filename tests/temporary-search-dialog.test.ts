// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import { createApp, nextTick, ref } from 'vue';
import TemporarySearchDialog from '@/components/sidebar/TemporarySearchDialog.vue';
import { setMockDictionaries } from '@/utils/trade-stat-dictionary';

let customLoadTradeDictionariesImpl: ((version?: 'poe1' | 'poe2') => Promise<void>) | null = null;

vi.mock('@/utils/trade-stat-dictionary', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/trade-stat-dictionary')>();
  return {
    ...actual,
    loadTradeDictionaries: vi.fn(async (version: 'poe1' | 'poe2' = 'poe1') => {
      if (customLoadTradeDictionariesImpl) {
        await customLoadTradeDictionariesImpl(version);
      }
    }),
  };
});

function createGzipTradeUrl(queryPayload: any, version: 'poe1' | 'poe2' = 'poe2'): string {
  const hash = gzipSync(Buffer.from(JSON.stringify(queryPayload), 'utf8')).toString('base64url');
  return version === 'poe2'
    ? `https://www.pathofexile.com/trade2/search/poe2/Standard/${hash}`
    : `https://www.pathofexile.com/trade/search/Standard/${hash}`;
}

describe('TemporarySearchDialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    customLoadTradeDictionariesImpl = null;
    setMockDictionaries(
      'poe2',
      {
        'armour.chest': '胸甲',
      },
      undefined,
      new Map([
        ['unique', '傳奇'],
        ['magic', '魔法'],
      ]),
    );
  });

  const flushAsync = async (ms = 50) => {
    await nextTick();
    await new Promise((r) => setTimeout(r, ms));
    await nextTick();
  };

  function mountDialog(props: { open?: boolean; controller?: any; sourceController?: any }) {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const openRef = ref(props.open ?? true);
    const successEvents: any[] = [];

    const app = createApp({
      components: { TemporarySearchDialog },
      setup() {
        return {
          open: openRef,
          controller: props.controller ?? null,
          sourceController: props.sourceController ?? null,
          onSuccess: (sourceId?: string) => successEvents.push(sourceId),
        };
      },
      template: `
        <TemporarySearchDialog
          :open="open"
          :controller="controller"
          :source-controller="sourceController"
          @update:open="open = $event"
          @success="onSuccess"
        />
      `,
    });

    app.mount(container);

    return {
      container,
      openRef,
      successEvents,
      unmount: () => {
        app.unmount();
        container.remove();
        document.body.innerHTML = '';
      },
    };
  }

  describe('Rendering & Lifecycle', () => {
    it('does not render dialog content when open is false', async () => {
      const { unmount } = mountDialog({ open: false });
      await flushAsync();

      expect(document.body.querySelector('[data-test="temporary-search-dialog"]')).toBeNull();
      unmount();
    });

    it('renders dialog elements and controls when open is true', async () => {
      const { unmount } = mountDialog({ open: true });
      await flushAsync();

      expect(document.body.querySelector('[data-test="temporary-search-dialog"]')).not.toBeNull();
      expect(document.body.querySelector('[data-test="input-url"]')).not.toBeNull();
      expect(document.body.querySelector('[data-test="input-name"]')).not.toBeNull();

      const startBtn = document.body.querySelector('[data-test="btn-start"]') as HTMLButtonElement;
      expect(startBtn).not.toBeNull();
      expect(startBtn.disabled).toBe(true);

      const cancelBtn = document.body.querySelector(
        '[data-test="btn-cancel"]',
      ) as HTMLButtonElement;
      expect(cancelBtn).not.toBeNull();

      unmount();
    });

    it('emits update:open: false and resets form when cancel button is clicked', async () => {
      const { openRef, unmount } = mountDialog({ open: true });
      await flushAsync();

      const urlInput = document.body.querySelector('[data-test="input-url"]') as HTMLInputElement;
      urlInput.value = 'https://www.pathofexile.com/trade/search/Standard/test';
      urlInput.dispatchEvent(new Event('input', { bubbles: true }));
      await flushAsync();

      const cancelBtn = document.body.querySelector(
        '[data-test="btn-cancel"]',
      ) as HTMLButtonElement;
      cancelBtn.click();
      await flushAsync();

      expect(openRef.value).toBe(false);

      // Reopen and verify reset
      openRef.value = true;
      await flushAsync();
      const reopenedUrlInput = document.body.querySelector(
        '[data-test="input-url"]',
      ) as HTMLInputElement;
      expect(reopenedUrlInput.value).toBe('');

      unmount();
    });
  });

  describe('Auto-Naming & Manual Name Precedence', () => {
    it('auto-populates inputName from decodable Trade URL and updates on URL changes', async () => {
      const { unmount } = mountDialog({ open: true });
      await flushAsync();

      const urlInput = document.body.querySelector('[data-test="input-url"]') as HTMLInputElement;
      const nameInput = document.body.querySelector('[data-test="input-name"]') as HTMLInputElement;

      const url1 = createGzipTradeUrl({
        query: { name: '魔血', type: '重型腰帶' },
      });
      urlInput.value = url1;
      urlInput.dispatchEvent(new Event('input', { bubbles: true }));
      await flushAsync();
      expect(nameInput.value).toBe('魔血 (重型腰帶)');

      const url2 = createGzipTradeUrl({
        query: {
          filters: {
            type_filters: {
              filters: {
                category: { option: 'armour.chest' },
              },
            },
          },
        },
      });
      urlInput.value = url2;
      urlInput.dispatchEvent(new Event('input', { bubbles: true }));
      await flushAsync();
      expect(nameInput.value).toBe('胸甲');

      unmount();
    });

    it('preserves manual user edits on URL change, re-enables auto-fill when cleared, and falls back to the search ID for empty metadata', async () => {
      const { unmount } = mountDialog({ open: true });
      await flushAsync();

      const urlInput = document.body.querySelector('[data-test="input-url"]') as HTMLInputElement;
      const nameInput = document.body.querySelector('[data-test="input-name"]') as HTMLInputElement;

      const url1 = createGzipTradeUrl({
        query: { name: '獵首' },
      });
      urlInput.value = url1;
      urlInput.dispatchEvent(new Event('input', { bubbles: true }));
      await flushAsync();
      expect(nameInput.value).toBe('獵首');

      // Manual edit
      nameInput.value = '我的自訂獵首';
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
      await flushAsync();

      const url2 = createGzipTradeUrl({
        query: {
          filters: {
            type_filters: {
              filters: {
                category: { option: 'armour.chest' },
              },
            },
          },
        },
      });
      urlInput.value = url2;
      urlInput.dispatchEvent(new Event('input', { bubbles: true }));
      await flushAsync();
      expect(nameInput.value).toBe('我的自訂獵首');

      // Clear manual edit -> restores auto-fill
      nameInput.value = '';
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
      await flushAsync();

      const url3 = createGzipTradeUrl({
        query: {
          filters: {
            type_filters: {
              filters: {
                rarity: { option: 'unique' },
              },
            },
          },
        },
      });
      urlInput.value = url3;
      urlInput.dispatchEvent(new Event('input', { bubbles: true }));
      await flushAsync();
      expect(nameInput.value).toBe('傳奇');

      // Empty metadata -> falls back to the search ID (URL hash)
      const statsOnlyUrl = createGzipTradeUrl({
        query: {
          stats: [{ filters: [{ id: 'explicit.stat_1', value: { min: 10 } }] }],
        },
      });
      urlInput.value = statsOnlyUrl;
      urlInput.dispatchEvent(new Event('input', { bubbles: true }));
      await flushAsync();
      expect(nameInput.value).toBe(statsOnlyUrl.split('/').pop());

      unmount();
    });

    it('waits for pending dictionary readiness on immediate submit for English Trade URL while respecting manual edits during dictionary load', async () => {
      let resolveDict!: () => void;
      const dictPromise = new Promise<void>((resolve) => {
        resolveDict = resolve;
      });
      customLoadTradeDictionariesImpl = async () => {
        await dictPromise;
        setMockDictionaries(
          'poe2',
          {},
          undefined,
          new Map([
            ['mageblood', '魔血'],
            ['heavy belt', '重型腰帶'],
          ]),
        );
      };

      let submittedName = '';
      const sourceController = {
        addCustom: vi.fn(async (_url: string, opts?: { name?: string }) => {
          submittedName = opts?.name ?? '';
          return { success: true, sourceId: 'src_custom_1' };
        }),
      };

      const { unmount } = mountDialog({ open: true, sourceController });
      await flushAsync();

      const urlInput = document.body.querySelector('[data-test="input-url"]') as HTMLInputElement;
      const nameInput = document.body.querySelector('[data-test="input-name"]') as HTMLInputElement;
      const form = document.body.querySelector(
        '[data-test="temporary-search-form"]',
      ) as HTMLFormElement;

      const englishUrl = createGzipTradeUrl({
        query: { name: 'Mageblood', type: 'Heavy Belt' },
      });
      urlInput.value = englishUrl;
      urlInput.dispatchEvent(new Event('input', { bubbles: true }));
      await flushAsync();

      expect(nameInput.value).toBe('Mageblood (Heavy Belt)');

      // Submit immediately while dictionary is pending
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await flushAsync(5);

      // Still in-flight because waiting for dictionary
      expect(sourceController.addCustom).not.toHaveBeenCalled();

      // Complete dictionary load
      resolveDict();
      await flushAsync();

      expect(sourceController.addCustom).toHaveBeenCalledTimes(1);
      expect(submittedName).toBe('魔血 (重型腰帶)');

      unmount();
    });
  });

  describe('Form Submission & Validation Error Handling', () => {
    it('submits successfully, emits success and update:open: false, and resets form', async () => {
      const sourceController = {
        addCustom: vi.fn(async (url: string, opts?: { name?: string }) => ({
          success: true,
          sourceId: 'src_cust_123',
        })),
      };

      const { openRef, successEvents, unmount } = mountDialog({
        open: true,
        sourceController,
      });
      await flushAsync();

      const urlInput = document.body.querySelector('[data-test="input-url"]') as HTMLInputElement;
      const nameInput = document.body.querySelector('[data-test="input-name"]') as HTMLInputElement;
      const form = document.body.querySelector(
        '[data-test="temporary-search-form"]',
      ) as HTMLFormElement;

      urlInput.value = 'https://www.pathofexile.com/trade/search/Standard/test123';
      urlInput.dispatchEvent(new Event('input', { bubbles: true }));
      nameInput.value = '自訂名稱';
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
      await flushAsync();

      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await flushAsync();

      expect(sourceController.addCustom).toHaveBeenCalledWith(
        'https://www.pathofexile.com/trade/search/Standard/test123',
        { name: '自訂名稱' },
      );
      expect(successEvents).toEqual(['src_cust_123']);
      expect(openRef.value).toBe(false);

      unmount();
    });

    it('renders in-field validation error on failure without closing dialog', async () => {
      const sourceController = {
        addCustom: vi.fn(async () => ({
          success: false,
          error: '無效的 Trade 搜尋網址格式',
        })),
      };

      const { openRef, unmount } = mountDialog({
        open: true,
        sourceController,
      });
      await flushAsync();

      const urlInput = document.body.querySelector('[data-test="input-url"]') as HTMLInputElement;
      const form = document.body.querySelector(
        '[data-test="temporary-search-form"]',
      ) as HTMLFormElement;

      urlInput.value = 'https://google.com';
      urlInput.dispatchEvent(new Event('input', { bubbles: true }));
      await flushAsync();

      expect(document.body.querySelector('[data-test="url-validation-error"]')).toBeNull();

      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await flushAsync();

      expect(openRef.value).toBe(true);
      const errorEl = document.body.querySelector('[data-test="url-validation-error"]');
      expect(errorEl).not.toBeNull();
      expect(errorEl?.textContent).toContain('無效的 Trade 搜尋網址格式');

      // Modifying URL clears the validation error
      urlInput.value = 'https://www.pathofexile.com/trade/search/Standard/valid';
      urlInput.dispatchEvent(new Event('input', { bubbles: true }));
      await flushAsync();
      expect(document.body.querySelector('[data-test="url-validation-error"]')).toBeNull();

      unmount();
    });

    it('prevents multiple simultaneous submissions while in-flight', async () => {
      let resolveSubmit!: (res: any) => void;
      const submitPromise = new Promise<any>((resolve) => {
        resolveSubmit = resolve;
      });

      const sourceController = {
        addCustom: vi.fn(async () => submitPromise),
      };

      const { unmount } = mountDialog({ open: true, sourceController });
      await flushAsync();

      const urlInput = document.body.querySelector('[data-test="input-url"]') as HTMLInputElement;
      const form = document.body.querySelector(
        '[data-test="temporary-search-form"]',
      ) as HTMLFormElement;

      urlInput.value = 'https://www.pathofexile.com/trade/search/Standard/test';
      urlInput.dispatchEvent(new Event('input', { bubbles: true }));
      await flushAsync();

      // First submit
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await flushAsync(5);

      expect(sourceController.addCustom).toHaveBeenCalledTimes(1);

      // Second submit while first is still pending
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await flushAsync(5);

      expect(sourceController.addCustom).toHaveBeenCalledTimes(1);

      // Finish first submit
      resolveSubmit({ success: true, sourceId: 'src_done' });
      await flushAsync();

      unmount();
    });

    it('fails closed and does not call raw controller or create subscription when sourceController is unavailable', async () => {
      const rawController = {
        addFromUrl: vi.fn(),
      };

      const { openRef, successEvents, unmount } = mountDialog({
        open: true,
        sourceController: null,
        controller: rawController,
      });
      await flushAsync();

      const urlInput = document.body.querySelector('[data-test="input-url"]') as HTMLInputElement;
      const form = document.body.querySelector(
        '[data-test="temporary-search-form"]',
      ) as HTMLFormElement;

      urlInput.value = 'https://www.pathofexile.com/trade/search/Standard/test123';
      urlInput.dispatchEvent(new Event('input', { bubbles: true }));
      await flushAsync();

      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await flushAsync();

      // Does not call raw controller or create subscription
      expect(rawController.addFromUrl).not.toHaveBeenCalled();
      // Fails closed: shows error and dialog stays open
      expect(openRef.value).toBe(true);
      expect(successEvents).toHaveLength(0);
      const errorEl = document.body.querySelector('[data-test="url-validation-error"]');
      expect(errorEl).not.toBeNull();
      expect(errorEl?.textContent).toContain('主控台尚未就緒');

      unmount();
    });
  });

  describe('Bookmark Picker Tab (從書籤挑選)', () => {
    it('switches to 從書籤挑選 tab, supports group & item selection, and batch-enables selected bookmarks via enableMany', async () => {
      const snapshot = {
        loading: false,
        selectedLeague: 'Standard',
        availableLeagues: ['Standard'],
        isSwitchingLeague: false,
        groups: [
          {
            id: 'grp_gear',
            name: '常用裝備',
            kind: 'bookmark',
            items: [
              {
                kind: 'bookmark',
                id: 'b1',
                name: '魔血腰帶',
                url: 'https://www.pathofexile.com/trade/search/Standard/H4sImb1',
                canonicalIdentity: { gameVersion: 'poe1', league: 'Standard', searchId: 'H4sImb1' },
                canonicalKey: 'poe1:standard:H4sImb1',
                compatibility: 'compatible',
                groupId: 'grp_gear',
                groupName: '常用裝備',
                status: 'idle',
                pending: false,
                removable: false,
              },
              {
                kind: 'bookmark',
                id: 'b2',
                name: '獵首腰帶',
                url: 'https://www.pathofexile.com/trade/search/Standard/H4sIhh2',
                canonicalIdentity: { gameVersion: 'poe1', league: 'Standard', searchId: 'H4sIhh2' },
                canonicalKey: 'poe1:standard:H4sIhh2',
                compatibility: 'compatible',
                groupId: 'grp_gear',
                groupName: '常用裝備',
                status: 'active',
                pending: false,
                removable: false,
              },
            ],
            bookmarks: [],
          },
        ],
      };

      const sourceController = {
        read: () => snapshot,
        subscribe: (cb: any) => {
          cb(snapshot);
          return () => {};
        },
        enableMany: vi.fn(async (ids: readonly string[]) => ({
          success: true,
          requested: ids.length,
          succeeded: ids.length,
          skipped: 0,
          failed: 0,
          skipReasons: {
            alreadyActive: 0,
            pending: 0,
            incompatible: 0,
            duplicateInBatch: 0,
            notFound: 0,
            inactive: 0,
          },
          incompatibleBreakdown: { invalidUrl: 0, wrongVersion: 0, wrongLeague: 0 },
          runtimeFailureCount: 0,
        })),
        addCustom: vi.fn(),
      };

      const { openRef, unmount } = mountDialog({
        open: true,
        sourceController,
      });
      await flushAsync();

      const tabBookmarksBtn = document.body.querySelector(
        '[data-test="tab-bookmarks"]',
      ) as HTMLButtonElement;
      expect(tabBookmarksBtn).not.toBeNull();
      tabBookmarksBtn.click();
      await flushAsync();

      // b1 is selectable, b2 is already active
      const selectAllGroupBtn = document.body.querySelector(
        '[data-test="picker-group-toggle-grp_gear"]',
      ) as HTMLButtonElement;
      expect(selectAllGroupBtn).not.toBeNull();
      selectAllGroupBtn.click();
      await flushAsync();

      const submitBookmarksBtn = document.body.querySelector(
        '[data-test="btn-enable-selected-bookmarks"]',
      ) as HTMLButtonElement;
      expect(submitBookmarksBtn).not.toBeNull();
      expect(submitBookmarksBtn.textContent).toContain('啟用已選 (1)');

      submitBookmarksBtn.click();
      await flushAsync();

      expect(sourceController.enableMany).toHaveBeenCalledWith(['b1']);
      expect(openRef.value).toBe(false);

      unmount();
    });

    it('deduplicates bookmarks sharing the same canonical URL across folders and prevents flex collapse on group cards', async () => {
      const snapshot = {
        loading: false,
        leagueResolved: true,
        selectedLeague: 'Standard',
        availableLeagues: ['Standard'],
        isSwitchingLeague: false,
        sessionConnections: [],
        previousConnections: [],
        groups: [
          {
            id: 'grp_a',
            name: '資料夾 A',
            kind: 'bookmark' as const,
            items: [
              {
                kind: 'bookmark' as const,
                id: 'b_dup_1',
                name: '獵首 (A)',
                url: 'https://www.pathofexile.com/trade/search/Standard/H4sIsameUrl',
                canonicalIdentity: {
                  gameVersion: 'poe1' as const,
                  league: 'Standard',
                  searchId: 'H4sIsameUrl',
                },
                canonicalKey: 'poe1:standard:H4sIsameUrl',
                compatibility: 'compatible' as const,
                groupId: 'grp_a',
                groupName: '資料夾 A',
                status: 'idle' as const,
                pending: false,
                removable: false,
              },
            ],
            bookmarks: [],
          },
          {
            id: 'grp_b',
            name: '資料夾 B',
            kind: 'bookmark' as const,
            items: [
              {
                kind: 'bookmark' as const,
                id: 'b_dup_2',
                name: '獵首 (B)',
                url: 'https://www.pathofexile.com/trade/search/Standard/H4sIsameUrl',
                canonicalIdentity: {
                  gameVersion: 'poe1' as const,
                  league: 'Standard',
                  searchId: 'H4sIsameUrl',
                },
                canonicalKey: 'poe1:standard:H4sIsameUrl',
                compatibility: 'compatible' as const,
                groupId: 'grp_b',
                groupName: '資料夾 B',
                status: 'idle' as const,
                pending: false,
                removable: false,
              },
            ],
            bookmarks: [],
          },
        ],
      };

      const sourceController = {
        read: () => snapshot,
        subscribe: (cb: any) => {
          cb(snapshot);
          return () => {};
        },
        enableMany: vi.fn(async (ids: readonly string[]) => ({
          success: true,
          requested: ids.length,
          succeeded: ids.length,
          skipped: 0,
          failed: 0,
          skipReasons: {
            alreadyActive: 0,
            pending: 0,
            incompatible: 0,
            duplicateInBatch: 0,
            notFound: 0,
            inactive: 0,
          },
          incompatibleBreakdown: { invalidUrl: 0, wrongVersion: 0, wrongLeague: 0 },
          runtimeFailureCount: 0,
        })),
        addCustom: vi.fn(),
      };

      const { unmount } = mountDialog({
        open: true,
        sourceController: sourceController as any,
      });
      await flushAsync();

      const groupCards = Array.from(
        document.body.querySelectorAll('[data-test="bookmark-picker-group"]'),
      );
      expect(groupCards.length).toBe(2);
      for (const card of groupCards) {
        expect(card.className).toContain('shrink-0');
        expect(card.className).not.toContain('overflow-hidden');
      }

      // Click b_dup_1 -> selected count is 1, and b_dup_2 shows "已選相同網址"
      const b1Btn = document.body.querySelector(
        '[data-test="picker-bookmark-b_dup_1"]',
      ) as HTMLButtonElement;
      const b2Btn = document.body.querySelector(
        '[data-test="picker-bookmark-b_dup_2"]',
      ) as HTMLButtonElement;
      b1Btn.click();
      await flushAsync();

      expect(b2Btn.textContent).toContain('已選相同網址');

      const submitBtn = document.body.querySelector(
        '[data-test="btn-enable-selected-bookmarks"]',
      ) as HTMLButtonElement;
      expect(submitBtn.textContent).toContain('啟用已選 (1)');

      // Clicking b_dup_2 switches selection to b_dup_2 while keeping total unique selected count = 1
      b2Btn.click();
      await flushAsync();
      expect(submitBtn.textContent).toContain('啟用已選 (1)');

      submitBtn.click();
      await flushAsync();
      expect(sourceController.enableMany).toHaveBeenCalledWith(['b_dup_2']);

      unmount();
    });

    it('supports collapsing/expanding bookmark folders and shows 已在本次連線 badge for paused session items', async () => {
      const snapshot = {
        loading: false,
        leagueResolved: true,
        selectedLeague: 'Standard',
        availableLeagues: ['Standard'],
        isSwitchingLeague: false,
        sessionConnections: [
          {
            kind: 'bookmark' as const,
            id: 'b_in_session',
            name: '暫停中連線',
            url: 'https://www.pathofexile.com/trade/search/Standard/H4sIsession_idle',
            canonicalIdentity: {
              gameVersion: 'poe1' as const,
              league: 'Standard',
              searchId: 'H4sIsession_idle',
            },
            canonicalKey: 'poe1:standard:H4sIsession_idle',
            compatibility: 'compatible' as const,
            groupId: 'grp_fold',
            groupName: '可收合資料夾',
            status: 'idle' as const,
            pending: false,
            removable: false,
          },
        ],
        previousConnections: [],
        groups: [
          {
            id: 'grp_fold',
            name: '可收合資料夾',
            kind: 'bookmark' as const,
            items: [
              {
                kind: 'bookmark' as const,
                id: 'b_in_session',
                name: '暫停中連線',
                url: 'https://www.pathofexile.com/trade/search/Standard/H4sIsession_idle',
                canonicalIdentity: {
                  gameVersion: 'poe1' as const,
                  league: 'Standard',
                  searchId: 'H4sIsession_idle',
                },
                canonicalKey: 'poe1:standard:H4sIsession_idle',
                compatibility: 'compatible' as const,
                groupId: 'grp_fold',
                groupName: '可收合資料夾',
                status: 'idle' as const,
                pending: false,
                removable: false,
              },
            ],
            bookmarks: [],
          },
        ],
      };

      const sourceController = {
        read: () => snapshot,
        subscribe: (cb: any) => {
          cb(snapshot);
          return () => {};
        },
        enableMany: vi.fn(),
        addCustom: vi.fn(),
      };

      const { unmount } = mountDialog({
        open: true,
        sourceController: sourceController as any,
      });
      await flushAsync();

      // Shows "已在本次連線" badge for paused session item
      const inSessionBadge = document.body.querySelector(
        '[data-test="picker-bookmark-in-session"]',
      );
      expect(inSessionBadge).not.toBeNull();
      expect(inSessionBadge?.textContent).toContain('已在本次連線');

      // Collapsing folder hides items
      const collapseBtn = document.body.querySelector(
        '[data-test="picker-group-collapse-grp_fold"]',
      ) as HTMLButtonElement;
      expect(collapseBtn).not.toBeNull();
      collapseBtn.click();
      await flushAsync();

      expect(document.body.querySelector('[data-test="picker-bookmark-b_in_session"]')).toBeNull();

      // Expanding folder reveals items again
      collapseBtn.click();
      await flushAsync();
      expect(
        document.body.querySelector('[data-test="picker-bookmark-b_in_session"]'),
      ).not.toBeNull();

      const pickerList = document.body.querySelector('[data-test="bookmark-picker-list"]');
      expect(pickerList).not.toBeNull();
      expect(pickerList?.className).not.toContain('pxd-scrollbar');

      unmount();
    });
  });
});
