// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createApp, nextTick, ref } from 'vue';

const historyEntriesMock = ref<any[]>([]);
const historyEnabledMock = ref(true);
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
    readCollection: vi.fn(async () => ({ ok: true, value: { bookmarks: [] } })),
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
      expect(historyPaneSource).toContain('--pxd-font-secondary');
      expect(historyPaneSource).toContain('--pxd-font-micro');
      expect(historyPaneSource).toContain('--pxd-font-caption');
    });

    it('enforces standard size="sm" for Clear Button and size="icon-sm" for row actions', () => {
      // Clear all button uses primitive sm without local overrides
      expect(historyPaneSource).toContain('size="sm"');
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
        'hover:bg-[color-mix(in_srgb,var(--accent)_50%,var(--card))]',
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

    it('renders Header with Checkbox and Clear Button aligned to size="sm"', async () => {
      app = createApp(HistoryPane);
      app.mount(container);
      await flushPromises();
      await nextTick();

      // Checkbox label uses secondary font token
      const label = container.querySelector('label[for="enable-history"]');
      expect(label).not.toBeNull();
      expect(label?.className).toContain('text-[length:var(--pxd-font-secondary)]');

      // Clear button exists and has primitive sm classes
      const clearBtn = container.querySelector(
        'button[title="清除所有搜尋歷史"]',
      ) as HTMLButtonElement;
      expect(clearBtn).not.toBeNull();
      // Button primitive sm classes
      expect(clearBtn.className).toContain('h-[var(--control-height-sm,1.75rem)]');
      expect(clearBtn.className).not.toContain('h-auto');
      expect(clearBtn.className).not.toContain('py-0.5');

      // Separator uses --pxd-space-md
      const separator = container.querySelector('[data-slot="separator"]');
      expect(separator).not.toBeNull();
      expect(separator?.className).toContain('mb-[var(--pxd-space-md)]');
    });

    it('renders History Items with secondary typography, micro timestamp, and icon-sm actions', async () => {
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

      // Title has secondary font
      const titleLink = itemRows[0].querySelector('a');
      expect(titleLink?.textContent?.trim()).toBe('獵首 皮革腰帶');
      expect(titleLink?.className).toContain('text-[length:var(--pxd-font-secondary)]');

      // Timestamp has micro font
      const timestamp = itemRows[0].querySelector(
        'span.text-muted-foreground, span.text-\\[\\#888896\\]',
      );
      expect(timestamp?.className).toContain('text-[length:var(--pxd-font-micro)]');

      // Row action buttons use icon-sm
      // 預覽（或前往）、新分頁、刪除
      const actionButtons = itemRows[0].querySelectorAll('button');
      expect(actionButtons.length).toBe(3);
      actionButtons.forEach((btn) => {
        expect(btn.className).toContain('size-[var(--control-height-sm)]');
        expect(btn.className).not.toContain('size-5');
      });
    });

    it('renders empty state with caption font token when history is empty', async () => {
      historyEntriesMock.value = [];
      app = createApp(HistoryPane);
      app.mount(container);
      await flushPromises();
      await nextTick();

      const emptyDiv = container.querySelector('.text-center');
      expect(emptyDiv).not.toBeNull();
      expect(emptyDiv?.textContent?.trim()).toBe('尚無歷史搜尋紀錄');
      expect(emptyDiv?.className).toContain('py-[var(--pxd-space-2xl)]');
      expect(emptyDiv?.className).toContain('text-[length:var(--pxd-font-caption)]');
    });

    it('renders subtle empty state with caption font token when history is disabled and empty', async () => {
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
      expect(disabledDiv?.className).toContain('text-[length:var(--pxd-font-caption)]');

      // Status notice is shown without hiding anything
      expect(container.textContent).toContain('已停止記錄新搜尋，既有歷史仍可查看與清理');
    });

    it('retains existing history entries, action buttons, and clear-all button when history is disabled', async () => {
      historyEnabledMock.value = false;
      // historyEntriesMock has 2 items from beforeEach
      app = createApp(HistoryPane);
      app.mount(container);
      await flushPromises();
      await nextTick();

      // Checkbox label reflects accurate scope
      const label = container.querySelector('label[for="enable-history"]');
      expect(label?.textContent?.trim()).toBe('記錄搜尋歷史');

      // Status notice is visible
      expect(container.textContent).toContain('已停止記錄新搜尋，既有歷史仍可查看與清理');

      // Rows are NOT hidden; 2 rows are fully rendered
      const itemRows = container.querySelectorAll(
        '[data-slot="sidebar-pane-scroll"] .justify-between.border-border, [data-slot="sidebar-pane-scroll"] .justify-between.border-\\[\\#2b2b35\\]',
      );
      expect(itemRows.length).toBe(2);

      // Clear all button remains visible and functional
      const clearBtn = container.querySelector(
        'button[title="清除所有搜尋歷史"]',
      ) as HTMLButtonElement;
      expect(clearBtn).not.toBeNull();
    });

    it('deletes single history entry directly without confirmation', async () => {
      const confirmSpy = vi.fn(async () => false);
      (window as any).poexdConfirm = confirmSpy;

      app = createApp(HistoryPane);
      app.mount(container);
      await flushPromises();
      await nextTick();

      const deleteBtn = container.querySelector('button[title="刪除此紀錄"]') as HTMLButtonElement;
      expect(deleteBtn).not.toBeNull();
      deleteBtn.click();
      await nextTick();
      await nextTick();

      expect(confirmSpy).not.toHaveBeenCalled();
      expect(historyEntriesMock.value.length).toBe(1);
      expect(historyEntriesMock.value[0].id).toBe('hist-2');
    });

    it('requires confirmation before clearing all history and respects cancel', async () => {
      const confirmSpy = vi.fn(async () => false);
      (window as any).poexdConfirm = confirmSpy;

      app = createApp(HistoryPane);
      app.mount(container);
      await flushPromises();
      await nextTick();

      const clearBtn = container.querySelector(
        'button[title="清除所有搜尋歷史"]',
      ) as HTMLButtonElement;
      expect(clearBtn).not.toBeNull();
      clearBtn.click();
      await nextTick();

      expect(confirmSpy).toHaveBeenCalledWith(
        '確定要清除全部搜尋歷史紀錄嗎？此操作無法復原。',
        '清除歷史紀錄',
      );
      expect(historyEntriesMock.value.length).toBe(2);

      confirmSpy.mockResolvedValueOnce(true);
      clearBtn.click();
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
  });
});
