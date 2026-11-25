// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createApp, nextTick, ref } from 'vue';

const historyEntriesMock = ref<any[]>([]);
const historyEnabledMock = ref(true);
const bookmarksMock = ref<any[]>([]);
const bookmarkGroupsMock = ref<any[]>([]);
const putBookmarkMock = vi.fn(async (bm: any) => {
  bookmarksMock.value = [...bookmarksMock.value, bm];
  return { ok: true, changed: true };
});
const putGroupMock = vi.fn(async (group: any) => {
  bookmarkGroupsMock.value = [...bookmarkGroupsMock.value, group];
  return { ok: true, changed: true };
});
let onSnapshotCallback: ((s: any) => void) | null = null;

vi.mock('@/utils/trade-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/trade-context')>()),
  getPoeVersion: () => 'poe1',
}));

vi.mock('@/utils/search-record-messaging', () => ({
  createChromeSearchRecordClient: () => ({
    execute: vi.fn(async (cmd: any) => {
      if (cmd.type === 'clear-history') {
        historyEntriesMock.value = [];
        onSnapshotCallback?.({ history: [], enabled: historyEnabledMock.value });
      }
      if (cmd.type === 'delete-history-entry') {
        historyEntriesMock.value = historyEntriesMock.value.filter((h) => h.id !== cmd.entryId);
        onSnapshotCallback?.({
          history: historyEntriesMock.value,
          enabled: historyEnabledMock.value,
        });
      }
      if (cmd.type === 'delete-history-entries') {
        const idSet = new Set(cmd.entryIds);
        historyEntriesMock.value = historyEntriesMock.value.filter((h) => !idSet.has(h.id));
        onSnapshotCallback?.({
          history: historyEntriesMock.value,
          enabled: historyEnabledMock.value,
        });
      }
      if (cmd.type === 'clear-unbookmarked-history') {
        const bookmarkedRecordIds = new Set(
          bookmarksMock.value.map((bm) => bm.searchRecordId).filter(Boolean),
        );
        const bookmarkedUrls = new Set(
          bookmarksMock.value.map((bm) => bm.url?.replace(/\/live\/?$/i, '')).filter(Boolean),
        );
        historyEntriesMock.value = historyEntriesMock.value.filter(
          (h) =>
            (h.searchRecordId && bookmarkedRecordIds.has(h.searchRecordId)) ||
            bookmarkedUrls.has(h.url?.replace(/\/live\/?$/i, '')),
        );
        onSnapshotCallback?.({
          history: historyEntriesMock.value,
          enabled: historyEnabledMock.value,
        });
      }
      if (cmd.type === 'restore-history-entry') {
        historyEntriesMock.value = [cmd.entry, ...historyEntriesMock.value].sort(
          (a, b) => (b.visitedAt ?? 0) - (a.visitedAt ?? 0),
        );
        onSnapshotCallback?.({
          history: historyEntriesMock.value,
          enabled: historyEnabledMock.value,
        });
      }
      if (cmd.type === 'set-history-enabled') {
        historyEnabledMock.value = cmd.enabled;
        onSnapshotCallback?.({ history: historyEntriesMock.value, enabled: cmd.enabled });
      }
      return { ok: true, value: undefined };
    }),
  }),
}));

vi.mock('@/utils/bookmark-messaging', () => ({
  createChromeBookmarkClient: () => ({
    readCollection: vi.fn(async () => ({
      ok: true,
      value: { bookmarks: bookmarksMock.value, groups: bookmarkGroupsMock.value },
    })),
    putBookmark: putBookmarkMock,
    putGroup: putGroupMock,
    subscribe: vi.fn(() => () => {}),
  }),
}));

vi.mock('@/components/sidebar/history-domain-feed', () => ({
  createHistoryDomainFeed: (_client: any, _version: any, onSnapshot: any) => {
    onSnapshotCallback = onSnapshot;
    return {
      start: vi.fn(async () => {
        onSnapshot({
          history: historyEntriesMock.value,
          enabled: historyEnabledMock.value,
        });
      }),
      stop: vi.fn(),
      refresh: vi.fn(async () => {
        onSnapshot({
          history: historyEntriesMock.value,
          enabled: historyEnabledMock.value,
        });
      }),
    };
  },
}));

vi.mock('@/utils/preferences', () => ({
  getPreferences: vi.fn(async () => ({
    ok: true,
    value: {
      sidebarPosition: 'left',
      subscribe: vi.fn(() => () => {}),
    },
  })),
}));

import HistoryPane from '@/components/sidebar/HistoryPane.vue';

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));
const historyPaneSource = readFileSync('components/sidebar/HistoryPane.vue', 'utf8');

describe('Phase 1B: HistoryPane UI Contract & Migration', () => {
  describe('Static Source Code Contract Enforcement', () => {
    it('guarantees ZERO occurrences of legacy scale/density variables in HistoryPane.vue', () => {
      expect(historyPaneSource).not.toContain('--poexd-font-size-scale');
      expect(historyPaneSource).not.toContain('--poexd-density-scale');
      expect(historyPaneSource).not.toMatch(/calc\(/);
    });

    it('enforces semantic tokens in HistoryPane.vue', () => {
      // Separator generic spacing
      expect(historyPaneSource).toContain('--pxd-space-md');
      // Typography tokens
      expect(historyPaneSource).toContain('--pxd-font-body');
      expect(historyPaneSource).toContain('--pxd-font-micro');
    });

    it('moves Clear All into the ⋮ menu and keeps size="icon-sm" for row actions', () => {
      // Clear all is a destructive menu item, not a red toolbar button
      expect(historyPaneSource).toContain('data-history-menu');
      expect(historyPaneSource).toMatch(
        /<DropdownMenuItem[\s\S]*?variant="destructive"[\s\S]*?@click="clearAllHistory"/,
      );
      expect(historyPaneSource).not.toMatch(/<Button[^>]*variant="destructive"/);
      expect(historyPaneSource).not.toContain('h-auto');
      expect(historyPaneSource).not.toContain('py-0.5');

      // Row action buttons use icon-sm and never size-5
      expect(historyPaneSource).toContain('size="icon-sm"');
      expect(historyPaneSource).not.toContain('size-5');
    });

    it('uses UI Scale aligned size-[var(--control-height-sm)] thumbnail and delegates checkbox to primitive contract', () => {
      expect(historyPaneSource).toContain('size-[var(--control-height-sm)]');
      expect(historyPaneSource).not.toContain('size-7');
      expect(historyPaneSource).not.toContain('size-4');
    });

    it('enforces shared trade search preview architecture and forbids importing BookmarkPane', () => {
      expect(historyPaneSource).not.toContain('BookmarkPane');
      expect(historyPaneSource).toContain('TradeSearchPreviewPopover');
      expect(historyPaneSource).toContain('useTradeSearchPreview');
    });

    it('enforces single-line row layout and opaque hover action overlay', () => {
      // Row must use truncate and shrink-0 timestamp, and never break-all
      expect(historyPaneSource).toContain('truncate');
      expect(historyPaneSource).toContain('shrink-0');
      expect(historyPaneSource).not.toContain('break-all');

      // Zero scoped styles
      expect(historyPaneSource).not.toContain('<style');

      // Actions must be absolute overlay with z-index: 1 and inherit opaque color-mix background from row hover
      expect(historyPaneSource).toContain(
        'hover:bg-[color-mix(in_srgb,var(--muted)_40%,var(--card))]',
      );
      expect(historyPaneSource).toContain('group-hover:opacity-100');
      expect(historyPaneSource).toContain('group-hover:pointer-events-auto');

      // Preview is a single click-toggled popover anchored to the toggled row, not a hover wrapper
      expect(historyPaneSource).not.toContain('<TradeSearchPreviewTooltip');
      expect(historyPaneSource).toMatch(
        /<TradeSearchPreviewPopover[\s\S]*?:reference="previewAnchorEl"/,
      );
    });
  });

  describe('Runtime DOM & Interactive Sizing Verification', () => {
    let container: HTMLElement;
    let app: ReturnType<typeof createApp> | undefined;

    beforeEach(() => {
      container = document.createElement('div');
      document.body.appendChild(container);
      historyEnabledMock.value = true;
      bookmarksMock.value = [];
      bookmarkGroupsMock.value = [];
      putBookmarkMock.mockClear();
      putGroupMock.mockClear();
      historyEntriesMock.value = [
        {
          id: 'hist-1',
          url: 'https://www.pathofexile.com/trade/search/Standard/H4sItest1',
          name: '獵首 皮革腰帶',
          visitedAt: Date.now() - 5000,
          icon: 'https://web.poecdn.com/gen/image/test.png',
        },
        {
          id: 'hist-2',
          url: 'https://www.pathofexile.com/trade/search/Standard/test2',
          name: '魔血 重革腰帶',
          visitedAt: Date.now() - 3600000,
        },
      ];
    });

    afterEach(() => {
      app?.unmount();
      app = undefined;
      container.remove();
      while (document.body.firstChild) {
        document.body.removeChild(document.body.firstChild);
      }
    });

    it('marks only Legacy Search ID entries as invalid (ADR-0008)', async () => {
      app = createApp(HistoryPane);
      app.mount(container);
      await flushPromises();
      await nextTick();

      const rows = Array.from(container.querySelectorAll('.history-row-item'));
      expect(rows).toHaveLength(2);
      const badgeOf = (row: Element) =>
        row.querySelector('.legacy-search-badge')?.textContent?.trim();
      expect(badgeOf(rows[0])).toBeUndefined();
      expect(badgeOf(rows[1])).toBe('已失效');
    });

    it('renders Header with search input and a ⋮ menu trigger aligned to size="icon-sm"', async () => {
      app = createApp(HistoryPane);
      app.mount(container);
      await flushPromises();
      await nextTick();

      // Search input uses Input primitive (size="sm")
      const searchInput = container.querySelector('[data-history-search]') as HTMLInputElement;
      expect(searchInput).not.toBeNull();
      expect(searchInput.getAttribute('data-slot')).toBe('input');

      // Recording toggle & Clear All live behind the ⋮ trigger; no checkbox or red button in toolbar
      expect(container.querySelector('label[for="enable-history"]')).toBeNull();
      expect(container.querySelector('button[title="清除所有搜尋歷史"]')).toBeNull();
      const menuTrigger = container.querySelector('[data-history-menu]') as HTMLButtonElement;
      expect(menuTrigger).not.toBeNull();
      expect(menuTrigger.getAttribute('aria-label')).toBe('歷史紀錄操作');
      expect(menuTrigger.className).not.toContain('h-auto');

      // Separator uses --pxd-space-md
      const separator = container.querySelector('[data-slot="separator"]');
      expect(separator).not.toBeNull();
      expect(separator?.className).toContain('mb-[var(--pxd-space-md)]');
    });

    it('renders History Items with body typography, micro timestamp, and icon-sm actions', async () => {
      app = createApp(HistoryPane);
      app.mount(container);
      await flushPromises();
      await nextTick();

      const itemRows = container.querySelectorAll(
        '[data-slot="sidebar-pane-scroll"] .justify-between.border-border, [data-slot="sidebar-pane-scroll"] .justify-between.border-\\[\\#2b2b35\\]',
      );
      expect(itemRows.length).toBe(2);

      // Item 1 has thumbnail size-[var(--control-height-sm)]
      const thumb = itemRows[0].querySelector('.size-\\[var\\(--control-height-sm\\)\\]');
      expect(thumb).not.toBeNull();

      // Title has body font
      const titleLink = itemRows[0].querySelector('a');
      expect(titleLink?.textContent?.trim()).toBe('獵首 皮革腰帶');
      expect(titleLink?.className).toContain('text-[length:var(--pxd-font-body)]');

      // Timestamp has micro font
      const timestamp = itemRows[0].querySelector(
        'span.text-muted-foreground, span.text-\\[\\#888896\\]',
      );
      expect(timestamp?.className).toContain('text-[length:var(--pxd-font-micro)]');

      // Row action buttons use icon-sm
      // 預覽（或前往）、新分頁、⋮ 操作選單
      const actionButtons = itemRows[0].querySelectorAll('button');
      expect(actionButtons.length).toBe(3);
      actionButtons.forEach((btn) => {
        expect(btn.className).toContain('size-[var(--control-height-sm)]');
        expect(btn.className).not.toContain('size-5');
      });
    });

    it('renders empty state with body font token when history is empty', async () => {
      historyEntriesMock.value = [];
      app = createApp(HistoryPane);
      app.mount(container);
      await flushPromises();
      await nextTick();

      const emptyDiv = container.querySelector('.text-center');
      expect(emptyDiv).not.toBeNull();
      expect(emptyDiv?.textContent?.trim()).toBe('尚無歷史搜尋紀錄');
      expect(emptyDiv?.className).toContain('py-[var(--pxd-space-2xl)]');
      expect(emptyDiv?.className).toContain('text-[length:var(--pxd-font-body)]');
    });

    it('renders subtle empty state with body font token when history is disabled and empty', async () => {
      historyEnabledMock.value = false;
      historyEntriesMock.value = [];
      app = createApp(HistoryPane);
      app.mount(container);
      await flushPromises();
      await nextTick();

      const disabledDiv = container.querySelector('.text-center');
      expect(disabledDiv).not.toBeNull();
      expect(disabledDiv?.textContent?.trim()).toBe('尚無歷史搜尋紀錄（已停止記錄）');
      expect(disabledDiv?.className).toContain('py-[var(--pxd-space-2xl)]');
      expect(disabledDiv?.className).toContain('text-[length:var(--pxd-font-body)]');

      // Status notice is shown without hiding anything
      expect(container.textContent).toContain('已停止記錄新搜尋，既有歷史仍可查看與清理');
    });

    it('retains existing history entries, action buttons, resume button, and menu when history is disabled', async () => {
      historyEnabledMock.value = false;
      // historyEntriesMock has 2 items from beforeEach
      app = createApp(HistoryPane);
      app.mount(container);
      await flushPromises();
      await nextTick();

      // Status notice & quick resume button are visible
      expect(container.textContent).toContain('已停止記錄新搜尋，既有歷史仍可查看與清理');
      const resumeBtn = container.querySelector('[data-history-resume]') as HTMLButtonElement;
      expect(resumeBtn).not.toBeNull();

      // Rows are NOT hidden; 2 rows are fully rendered
      const itemRows = container.querySelectorAll(
        '[data-slot="sidebar-pane-scroll"] .justify-between.border-border, [data-slot="sidebar-pane-scroll"] .justify-between.border-\\[\\#2b2b35\\]',
      );
      expect(itemRows.length).toBe(2);

      // Clear all menu remains available
      expect(container.querySelector('[data-history-menu]')).not.toBeNull();

      // Clicking resume re-enables history recording
      resumeBtn.click();
      await flushPromises();
      await nextTick();
      expect(historyEnabledMock.value).toBe(true);
      expect(container.querySelector('[data-history-stopped-notice]')).toBeNull();
    });

    it('deletes single history entry directly without confirmation', async () => {
      const confirmSpy = vi.fn(async () => false);
      (window as any).poexdConfirm = confirmSpy;

      app = createApp(HistoryPane);
      const vm: any = app.mount(container);
      await flushPromises();
      await nextTick();

      expect(container.querySelector('[data-test="history-row-menu"]')).not.toBeNull();
      await vm.deleteHistory('hist-1');
      await nextTick();

      expect(confirmSpy).not.toHaveBeenCalled();
      expect(historyEntriesMock.value.length).toBe(1);
      expect(historyEntriesMock.value[0].id).toBe('hist-2');
    });

    it('requires confirmation before clearing all history and respects cancel', async () => {
      const confirmSpy = vi.fn(async () => false);
      (window as any).poexdConfirm = confirmSpy;

      app = createApp(HistoryPane);
      const vm: any = app.mount(container);
      await flushPromises();
      await nextTick();

      await vm.clearAllHistory();
      await nextTick();

      expect(confirmSpy).toHaveBeenCalledWith(
        '確定要清除全部搜尋歷史紀錄嗎？此操作無法復原。',
        '清除歷史紀錄',
      );
      expect(historyEntriesMock.value.length).toBe(2);

      confirmSpy.mockResolvedValueOnce(true);
      await vm.clearAllHistory();
      await nextTick();
      await nextTick();

      expect(historyEntriesMock.value.length).toBe(0);
    });

    it('renders single-line row item with truncate title and actions overlay', async () => {
      app = createApp(HistoryPane);
      app.mount(container);
      await flushPromises();
      await nextTick();

      const rowItem = container.querySelector('.history-row-item');
      expect(rowItem).not.toBeNull();

      const titleLink = rowItem?.querySelector('a');
      expect(titleLink?.className).toContain('truncate');
      expect(titleLink?.className).not.toContain('break-all');

      const actions = rowItem?.querySelector('.history-row-actions');
      expect(actions).not.toBeNull();
    });

    it('manages preview open state per history entry independently even with duplicate URLs', async () => {
      historyEntriesMock.value = [
        {
          id: 'hist-dup-1',
          url: 'https://www.pathofexile.com/trade/search/Standard/dup',
          name: 'Item Dup 1',
          visitedAt: Date.now() - 1000,
        },
        {
          id: 'hist-dup-2',
          url: 'https://www.pathofexile.com/trade/search/Standard/dup',
          name: 'Item Dup 2',
          visitedAt: Date.now() - 2000,
        },
      ];

      app = createApp(HistoryPane);
      const vm: any = app.mount(container);
      await flushPromises();
      await nextTick();

      expect(vm.previewHistory).toBeNull();
      const clickOn = () =>
        ({ currentTarget: document.createElement('button') }) as unknown as Event;

      // Open preview for hist-dup-1
      vm.toggleHistoryPreview(historyEntriesMock.value[0], clickOn());
      expect(vm.previewHistory?.id).toBe('hist-dup-1');
      expect(vm.isHistoryPreviewOpen).toBe(true);

      // Toggling hist-dup-1 again closes it
      vm.toggleHistoryPreview(historyEntriesMock.value[0], clickOn());
      expect(vm.previewHistory).toBeNull();
    });

    it('filters history entries by search query and shows filter empty state with reset', async () => {
      app = createApp(HistoryPane);
      const vm: any = app.mount(container);
      await flushPromises();
      await nextTick();

      vm.searchQuery = '獵首';
      await nextTick();
      expect(container.querySelectorAll('.history-row-item')).toHaveLength(1);
      expect(container.querySelector('.history-row-item a')?.textContent?.trim()).toBe(
        '獵首 皮革腰帶',
      );

      vm.searchQuery = '不存在的裝備';
      await nextTick();
      expect(container.querySelectorAll('.history-row-item')).toHaveLength(0);
      expect(container.textContent).toContain('找不到相符的歷史紀錄');

      const resetBtn = container.querySelector('[data-filter-empty-reset]') as HTMLButtonElement;
      expect(resetBtn).not.toBeNull();
      resetBtn.click();
      await nextTick();
      expect(container.querySelectorAll('.history-row-item')).toHaveLength(2);
    });

    it('shows bookmarked indicator for saved entries and saves unbookmarked entries with one click', async () => {
      bookmarkGroupsMock.value = [{ id: 'g-1', name: '主力裝備', order: 0 }];
      bookmarksMock.value = [
        {
          id: 'bm-existing',
          name: '已存獵首',
          groupId: 'g-1',
          order: 0,
          url: 'https://www.pathofexile.com/trade/search/Standard/H4sItest1',
        },
      ];
      historyEntriesMock.value = [
        {
          id: 'hist-1',
          url: 'https://www.pathofexile.com/trade/search/Standard/H4sItest1',
          name: '獵首 皮革腰帶',
          visitedAt: Date.now() - 5000,
        },
        {
          id: 'hist-2',
          url: 'https://www.pathofexile.com/trade/search/Standard/H4sItest2',
          name: '魔血 重革腰帶',
          visitedAt: Date.now() - 3600000,
        },
      ];

      app = createApp(HistoryPane);
      const vm: any = app.mount(container);
      await flushPromises();
      await nextTick();

      const rows = Array.from(container.querySelectorAll('.history-row-item'));
      expect(rows[0].querySelector('[data-test="history-bookmarked-indicator"]')).not.toBeNull();
      expect(rows[1].querySelector('[data-test="history-bookmarked-indicator"]')).toBeNull();

      // Already-bookmarked row does not create duplicate bookmark
      await vm.saveHistoryToBookmark(historyEntriesMock.value[0]);
      await flushPromises();
      expect(putBookmarkMock).toHaveBeenCalledTimes(0);

      // Saving the second entry adds it into the single folder
      await vm.saveHistoryToBookmark(historyEntriesMock.value[1]);
      await flushPromises();
      await nextTick();

      expect(putBookmarkMock).toHaveBeenCalledTimes(1);
      expect(putBookmarkMock).toHaveBeenCalledWith(
        expect.objectContaining({
          name: '魔血 重革腰帶',
          groupId: 'g-1',
          url: 'https://www.pathofexile.com/trade/search/Standard/H4sItest2',
        }),
      );
      expect(rows[1].querySelector('[data-test="history-bookmarked-indicator"]')).not.toBeNull();
    });

    it('matches a bookmark whose search ID encodes the same query with a different compressor', async () => {
      // 書籤：瀏覽器壓縮（OS byte 0x0a）；歷史：官方伺服器重新壓縮（OS byte 0x03、不同壓縮等級）
      const query = {
        query: { status: { option: 'online' }, name: 'Headhunter' },
        sort: { price: 'asc' },
      };
      const encode = (value: unknown, level: number, osByte: number) => {
        const bytes = gzipSync(Buffer.from(JSON.stringify(value)), { level });
        bytes[9] = osByte;
        return bytes.toString('base64url');
      };
      const bookmarkId = encode(query, 6, 0x0a);
      const historyId = encode(query, 9, 0x03);
      const otherSortId = encode({ ...query, sort: { price: 'desc' } }, 9, 0x03);
      expect(bookmarkId).not.toBe(historyId);

      bookmarkGroupsMock.value = [{ id: 'g-1', name: '主力裝備', order: 0 }];
      bookmarksMock.value = [
        {
          id: 'bm-hh',
          name: '我的獵首',
          groupId: 'g-1',
          order: 0,
          url: `https://www.pathofexile.com/trade/search/Standard/${bookmarkId}`,
          searchRecordId: `poe1:standard:${bookmarkId}`,
        },
      ];
      historyEntriesMock.value = [
        {
          id: 'hist-server-id',
          searchRecordId: `poe1:standard:${historyId}`,
          url: `https://www.pathofexile.com/trade/search/Standard/${historyId}`,
          name: '獵首 皮革腰帶',
          visitedAt: Date.now() - 1000,
        },
        {
          id: 'hist-other-sort',
          searchRecordId: `poe1:standard:${otherSortId}`,
          url: `https://www.pathofexile.com/trade/search/Standard/${otherSortId}`,
          name: '獵首 皮革腰帶',
          visitedAt: Date.now() - 2000,
        },
      ];
      const confirmSpy = vi.fn(async () => true);
      (window as any).poexdConfirm = confirmSpy;

      app = createApp(HistoryPane);
      const vm: any = app.mount(container);
      await vi.waitFor(() => {
        expect(
          container.querySelector(
            '[data-history-id="hist-server-id"] [data-test="history-bookmarked-indicator"]',
          ),
        ).not.toBeNull();
      });
      expect(
        container.querySelector(
          '[data-history-id="hist-other-sort"] [data-test="history-bookmarked-indicator"]',
        ),
      ).toBeNull();
      expect(vm.getHistoryName(historyEntriesMock.value[0])).toBe('我的獵首');

      await vm.clearUnbookmarkedHistory();
      await flushPromises();
      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(historyEntriesMock.value.map((h) => h.id)).toEqual(['hist-server-id']);
    });

    it('auto-creates default folder when saving history to bookmark with no existing folders', async () => {
      app = createApp(HistoryPane);
      const vm: any = app.mount(container);
      await flushPromises();
      await nextTick();

      await vm.saveHistoryToBookmark(historyEntriesMock.value[0]);
      await flushPromises();
      await nextTick();

      expect(putGroupMock).toHaveBeenCalledTimes(1);
      expect(putBookmarkMock).toHaveBeenCalledTimes(1);
    });

    it('exposes flattened bookmark folders for multi-folder row submenu', async () => {
      bookmarkGroupsMock.value = [
        { id: 'g-1', name: '主力裝備', order: 0 },
        { id: 'g-2', name: '通貨材料', order: 1 },
      ];

      app = createApp(HistoryPane);
      const vm: any = app.mount(container);
      await flushPromises();
      await nextTick();

      expect(vm.flattenedBookmarkFolders).toHaveLength(2);
      expect(container.querySelector('[data-test="history-row-menu"]')).not.toBeNull();
    });

    it('copies history URL to clipboard via copyHistoryLink', async () => {
      const writeText = vi.fn(async () => {});
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText },
        configurable: true,
      });

      app = createApp(HistoryPane);
      const vm: any = app.mount(container);
      await flushPromises();
      await nextTick();

      await vm.copyHistoryLink(historyEntriesMock.value[0].url);
      await flushPromises();

      expect(writeText).toHaveBeenCalledWith(
        'https://www.pathofexile.com/trade/search/Standard/H4sItest1',
      );
    });

    it('groups history entries by time and renders Live and non-current league badges', async () => {
      const prevUrl = window.location.href;
      (window as any).happyDOM?.setURL(
        'https://www.pathofexile.com/trade/search/Standard/H4sItoday',
      );
      try {
        const now = Date.now();
        historyEntriesMock.value = [
          {
            id: 'hist-today-live',
            url: 'https://www.pathofexile.com/trade/search/Standard/H4sItoday/live',
            name: '即時搜尋裝備',
            visitedAt: now - 5000,
          },
          {
            id: 'hist-older-league',
            url: 'https://www.pathofexile.com/trade/search/Settlers/H4sIolder',
            name: '舊賽季裝備',
            visitedAt: now - 10 * 86_400_000,
          },
        ];

        app = createApp(HistoryPane);
        app.mount(container);
        await flushPromises();
        await nextTick();

        const groups = Array.from(container.querySelectorAll('[data-history-group]'));
        expect(groups.map((g) => g.getAttribute('data-history-group'))).toEqual(['today', 'older']);

        const todayRow = container.querySelector('[data-history-id="hist-today-live"]');
        expect(todayRow?.getAttribute('data-current')).toBe('true');
        expect(todayRow?.querySelector('[data-test="history-live-badge"]')).not.toBeNull();
        expect(todayRow?.querySelector('[data-test="history-league-badge"]')).toBeNull();

        const olderRow = container.querySelector('[data-history-id="hist-older-league"]');
        expect(olderRow?.getAttribute('data-current')).toBeNull();
        expect(
          olderRow?.querySelector('[data-test="history-league-badge"]')?.textContent?.trim(),
        ).toBe('Settlers');
      } finally {
        (window as any).happyDOM?.setURL(prevUrl);
      }
    });

    it('shows undo bar after deleting an entry and restores it on undo click', async () => {
      app = createApp(HistoryPane);
      const vm: any = app.mount(container);
      await flushPromises();
      await nextTick();

      await vm.deleteHistory('hist-1');
      await flushPromises();
      await nextTick();

      expect(historyEntriesMock.value).toHaveLength(1);
      const undoBar = container.querySelector('[data-history-undo-bar]');
      expect(undoBar).not.toBeNull();
      expect(undoBar?.textContent).toContain('獵首 皮革腰帶');

      const undoBtn = container.querySelector('[data-history-undo-btn]') as HTMLButtonElement;
      undoBtn.click();
      await flushPromises();
      await nextTick();

      expect(historyEntriesMock.value).toHaveLength(2);
      expect(container.querySelector('[data-history-undo-bar]')).toBeNull();
    });

    it('renders capacity count and clears invalid or unbookmarked entries selectively', async () => {
      bookmarksMock.value = [
        {
          id: 'bm-1',
          name: '已收藏獵首',
          groupId: 'g-1',
          order: 0,
          url: 'https://www.pathofexile.com/trade/search/Standard/H4sItest1',
        },
      ];
      historyEntriesMock.value = [
        {
          id: 'hist-valid-bookmarked',
          url: 'https://www.pathofexile.com/trade/search/Standard/H4sItest1',
          name: '獵首 皮革腰帶',
          visitedAt: Date.now() - 1000,
        },
        {
          id: 'hist-valid-unbookmarked',
          url: 'https://www.pathofexile.com/trade/search/Standard/H4sItest2',
          name: '魔血 重革腰帶',
          visitedAt: Date.now() - 2000,
        },
        {
          id: 'hist-legacy-invalid',
          url: 'https://www.pathofexile.com/trade/search/Standard/short123',
          name: '舊短碼裝備',
          visitedAt: Date.now() - 3000,
        },
      ];

      const confirmSpy = vi.fn(async () => false);
      (window as any).poexdConfirm = confirmSpy;

      app = createApp(HistoryPane);
      const vm: any = app.mount(container);
      await flushPromises();
      await nextTick();

      const capacity = container.querySelector('[data-history-capacity]');
      expect(capacity?.textContent?.trim()).toBe('共 3 / 50 筆紀錄');

      // Clearing invalid entries removes only legacy entry without confirmation
      await vm.clearInvalidHistory();
      await nextTick();
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(historyEntriesMock.value.map((h) => h.id)).toEqual([
        'hist-valid-bookmarked',
        'hist-valid-unbookmarked',
      ]);
      expect(container.querySelector('[data-history-capacity]')?.textContent?.trim()).toBe(
        '共 2 / 50 筆紀錄',
      );

      // Clearing unbookmarked respects cancel first
      await vm.clearUnbookmarkedHistory();
      await nextTick();
      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(historyEntriesMock.value).toHaveLength(2);

      // Confirming removes only unbookmarked entry, preserving bookmarked entry
      confirmSpy.mockResolvedValueOnce(true);
      await vm.clearUnbookmarkedHistory();
      await nextTick();
      expect(historyEntriesMock.value.map((h) => h.id)).toEqual(['hist-valid-bookmarked']);
      expect(container.querySelector('[data-history-capacity]')?.textContent?.trim()).toBe(
        '共 1 / 50 筆紀錄',
      );
    });
  });
});
