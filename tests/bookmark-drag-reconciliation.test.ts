// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick } from 'vue';
import { ConfigProvider } from 'reka-ui';
import BookmarkPane from '@/components/sidebar/BookmarkPane.vue';
import { resolveFolderDropPlacement } from '@/utils/bookmark-collection';

const sortableInstances: Array<{ element: HTMLElement; options: any }> = [];

vi.mock('sortablejs', () => ({
  default: {
    create: vi.fn((element: HTMLElement, options: any) => {
      sortableInstances.push({ element, options });
      return {
        destroy: vi.fn(() => {
          const idx = sortableInstances.findIndex((inst) => inst.element === element);
          if (idx !== -1) sortableInstances.splice(idx, 1);
        }),
        option: vi.fn(),
      };
    }),
  },
}));

vi.mock('@/utils/trade-leagues', () => ({
  fetchTradeLeagues: vi.fn(async () => [{ id: 'Standard', text: '標準模式' }]),
}));

let mockBookmarkCollection = {
  bookmarks: [] as any[],
  groups: [] as any[],
};

const deleteBookmarkSpy = vi.fn(async (bookmarkId: string) => {
  mockBookmarkCollection.bookmarks = mockBookmarkCollection.bookmarks.filter(
    (b) => b.id !== bookmarkId,
  );
  return { ok: true };
});

const deleteGroupSpy = vi.fn(async (groupId: string) => {
  mockBookmarkCollection.groups = mockBookmarkCollection.groups.filter((g) => g.id !== groupId);
  mockBookmarkCollection.bookmarks = mockBookmarkCollection.bookmarks.filter(
    (b) => b.groupId !== groupId,
  );
  return { ok: true };
});

const reorderBookmarksSpy = vi.fn(async (placements: any[]) => {
  for (const p of placements) {
    const bm = mockBookmarkCollection.bookmarks.find((b) => b.id === p.id);
    if (bm) {
      bm.groupId = p.groupId;
      bm.order = p.order;
    }
  }
  mockBookmarkCollection.bookmarks.sort((a, b) => a.order - b.order);
  return { ok: true };
});

const reorderGroupsSpy = vi.fn(async (groupIds: string[]) => {
  groupIds.forEach((id, index) => {
    const g = mockBookmarkCollection.groups.find((group) => group.id === id);
    if (g) g.order = index;
  });
  mockBookmarkCollection.groups.sort((a, b) => a.order - b.order);
  return { ok: true };
});

const moveFolderSpy = vi.fn(
  async (folderId: string, _targetParentId?: string, _order?: number, dropIntent?: any) => {
    if (dropIntent) {
      const result = resolveFolderDropPlacement(
        mockBookmarkCollection.groups,
        folderId,
        dropIntent,
      );
      if (result.ok && result.placements) {
        const placementMap = new Map(result.placements.map((p) => [p.id, p]));
        mockBookmarkCollection.groups.forEach((g) => {
          const p = placementMap.get(g.id);
          if (p) {
            g.parentId = p.parentId;
            g.order = p.order;
          }
        });
        mockBookmarkCollection.groups.sort((a, b) => a.order - b.order);
      }
    }
    return { ok: true };
  },
);

vi.mock('@/utils/bookmark-messaging', () => ({
  createChromeBookmarkClient: () => ({
    readCollection: vi.fn(async () => ({ ok: true, value: { ...mockBookmarkCollection } })),
    putGroup: vi.fn(async () => ({ ok: true })),
    deleteGroup: deleteGroupSpy,
    reorderGroups: reorderGroupsSpy,
    moveFolder: moveFolderSpy,
    putBookmark: vi.fn(async () => ({ ok: true })),
    deleteBookmark: deleteBookmarkSpy,
    reorderBookmarks: reorderBookmarksSpy,
    exportTransfer: vi.fn(async () => ({ ok: true, value: {} })),
    importTransfer: vi.fn(async () => ({ ok: true })),
    replaceLeague: vi.fn(async () => ({ ok: true })),
    subscribe: vi.fn(() => () => {}),
  }),
}));

const mockChromeStorageData: Record<string, any> = {
  addBookmarkBtnPosition: 'top',
};

(globalThis as any).chrome = {
  storage: {
    local: {
      get: vi.fn(async (keys?: string | string[]) => {
        if (!keys) return { ...mockChromeStorageData };
        if (typeof keys === 'string') return { [keys]: mockChromeStorageData[keys] };
        return (keys as string[]).reduce(
          (acc, k) => {
            acc[k] = mockChromeStorageData[k];
            return acc;
          },
          {} as Record<string, any>,
        );
      }),
      set: vi.fn(async (items: Record<string, any>) => {
        Object.assign(mockChromeStorageData, items);
      }),
    },
    onChanged: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
  tabs: {
    query: vi.fn(async () => [{ title: 'Test Tab', url: 'https://www.pathofexile.com/trade' }]),
  },
};

(window as any).poexdAlert = vi.fn();
(window as any).poexdConfirm = vi.fn(async () => true);

describe('Bookmark Drag-and-Drop & Vue DOM Ownership Reconciliation Regression', () => {
  let shadowHost: HTMLElement;
  let shadowRoot: ShadowRoot;
  let portalRoot: HTMLElement;
  let appRoot: HTMLElement;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    sortableInstances.length = 0;
    deleteBookmarkSpy.mockClear();
    deleteGroupSpy.mockClear();
    reorderBookmarksSpy.mockClear();
    reorderGroupsSpy.mockClear();
    moveFolderSpy.mockClear();
    (window as any).poexdAlert.mockClear();
    (window as any).poexdConfirm.mockClear();

    document.body.innerHTML = '';
    shadowHost = document.createElement('div');
    shadowHost.id = 'poexd-shadow-host';
    shadowRoot = shadowHost.attachShadow({ mode: 'open' });

    portalRoot = document.createElement('div');
    portalRoot.id = 'poexd-portal-root';
    shadowRoot.appendChild(portalRoot);

    appRoot = document.createElement('div');
    appRoot.id = 'app';
    shadowRoot.appendChild(appRoot);
    document.body.appendChild(shadowHost);
  });

  afterEach(() => {
    app?.unmount();
    document.body.innerHTML = '';
  });

  async function mountBookmarkPane(groups: any[], bookmarks: any[]) {
    if (app) {
      app.unmount();
      appRoot.innerHTML = '';
      sortableInstances.length = 0;
    }
    mockBookmarkCollection = {
      groups: JSON.parse(JSON.stringify(groups)),
      bookmarks: JSON.parse(JSON.stringify(bookmarks)),
    };

    const RootComponent = defineComponent({
      setup() {
        return () =>
          h(ConfigProvider, { teleportTo: portalRoot, scrollBody: false }, () => [h(BookmarkPane)]);
      },
    });

    app = createApp(RootComponent);
    app.mount(appRoot);

    await vi.waitFor(() => {
      expect(appRoot.querySelector('.empty-state')).toBeNull();
    });
  }

  it('A. Cross-folder move: eliminates duplicate DOM and preserves single SSOT placement', async () => {
    await mountBookmarkPane(
      [
        { id: 'group-a', name: 'Folder A', order: 0 },
        { id: 'group-b', name: 'Folder B', order: 1 },
      ],
      [
        { id: 'bm-1', name: 'One', url: '/1', groupId: 'group-a', order: 0 },
        { id: 'bm-2', name: 'Two', url: '/2', groupId: 'group-b', order: 0 },
      ],
    );

    const wrapperA = appRoot.querySelector(
      '.bookmark-list-wrapper[data-group-id="group-a"]',
    ) as HTMLElement;
    const wrapperB = appRoot.querySelector(
      '.bookmark-list-wrapper[data-group-id="group-b"]',
    ) as HTMLElement;
    expect(wrapperA).not.toBeNull();
    expect(wrapperB).not.toBeNull();

    // Verify initial DOM
    expect(wrapperA.querySelectorAll('.bookmark-row-item[data-id="bm-1"]')).toHaveLength(1);
    expect(wrapperB.querySelectorAll('.bookmark-row-item[data-id="bm-1"]')).toHaveLength(0);

    // Simulate Sortable physically moving DOM element from A to B
    const row1 = wrapperA.querySelector('.bookmark-row-item[data-id="bm-1"]') as HTMLElement;
    wrapperB.insertBefore(row1, wrapperB.firstChild);

    // Trigger Sortable onEnd with drag event metadata
    const sortableA = sortableInstances.find((inst) => inst.element === wrapperA);
    expect(sortableA).toBeDefined();

    sortableA?.options.onEnd({
      item: row1,
      from: wrapperA,
      to: wrapperB,
      oldDraggableIndex: 0,
      newDraggableIndex: 0,
    });

    // Verify reorder-bookmarks intent
    await vi.waitFor(() => {
      expect(reorderBookmarksSpy).toHaveBeenCalledTimes(1);
    });

    const placements = reorderBookmarksSpy.mock.calls[0][0];
    expect(placements).toEqual([
      { id: 'bm-1', groupId: 'group-b', order: 0 },
      { id: 'bm-2', groupId: 'group-b', order: 1 },
    ]);

    // Model projection updated
    expect(mockBookmarkCollection.bookmarks.find((b) => b.id === 'bm-1')?.groupId).toBe('group-b');

    // Verify DOM reconciliation: exactly 1 DOM element across entire pane
    await vi.waitFor(() => {
      const allRows1 = appRoot.querySelectorAll('.bookmark-row-item[data-id="bm-1"]');
      expect(allRows1).toHaveLength(1);
    });

    const currentWrapperA = appRoot.querySelector(
      '.bookmark-list-wrapper[data-group-id="group-a"]',
    );
    const currentWrapperB = appRoot.querySelector(
      '.bookmark-list-wrapper[data-group-id="group-b"]',
    );
    expect(currentWrapperA?.querySelectorAll('.bookmark-row-item[data-id="bm-1"]')).toHaveLength(0);
    expect(currentWrapperB?.querySelectorAll('.bookmark-row-item[data-id="bm-1"]')).toHaveLength(1);
  });

  it('B. Same-folder reorder: moves item and reconstructs deterministic DOM order without duplicates', async () => {
    await mountBookmarkPane(
      [{ id: 'group-a', name: 'Folder A', order: 0 }],
      [
        { id: 'bm-a', name: 'A', url: '/a', groupId: 'group-a', order: 0 },
        { id: 'bm-b', name: 'B', url: '/b', groupId: 'group-a', order: 1 },
        { id: 'bm-c', name: 'C', url: '/c', groupId: 'group-a', order: 2 },
      ],
    );

    const wrapperA = appRoot.querySelector(
      '.bookmark-list-wrapper[data-group-id="group-a"]',
    ) as HTMLElement;
    const rowC = wrapperA.querySelector('.bookmark-row-item[data-id="bm-c"]') as HTMLElement;

    // Simulate Sortable moving C before A
    wrapperA.insertBefore(rowC, wrapperA.firstChild);

    const sortableA = sortableInstances.find((inst) => inst.element === wrapperA);
    sortableA?.options.onEnd({
      item: rowC,
      from: wrapperA,
      to: wrapperA,
      oldDraggableIndex: 2,
      newDraggableIndex: 0,
    });

    await vi.waitFor(() => {
      expect(reorderBookmarksSpy).toHaveBeenCalledTimes(1);
    });

    // Verify DOM reconstructed in order C, A, B with exactly 1 element each
    await vi.waitFor(() => {
      const rows = Array.from(appRoot.querySelectorAll('.bookmark-row-item'));
      expect(rows.map((r) => r.getAttribute('data-id'))).toEqual(['bm-c', 'bm-a', 'bm-b']);
    });
    expect(appRoot.querySelectorAll('.bookmark-row-item[data-id="bm-c"]')).toHaveLength(1);
  });

  it('C. Cross-folder failure rollback: restores bookmark to original folder with zero orphan DOM', async () => {
    reorderBookmarksSpy.mockImplementationOnce(async () => ({
      ok: false,
      error: { message: 'Write rejected' },
    }));

    await mountBookmarkPane(
      [
        { id: 'group-a', name: 'Folder A', order: 0 },
        { id: 'group-b', name: 'Folder B', order: 1 },
      ],
      [
        { id: 'bm-1', name: 'One', url: '/1', groupId: 'group-a', order: 0 },
        { id: 'bm-2', name: 'Two', url: '/2', groupId: 'group-b', order: 0 },
      ],
    );

    const wrapperA = appRoot.querySelector(
      '.bookmark-list-wrapper[data-group-id="group-a"]',
    ) as HTMLElement;
    const wrapperB = appRoot.querySelector(
      '.bookmark-list-wrapper[data-group-id="group-b"]',
    ) as HTMLElement;
    const row1 = wrapperA.querySelector('.bookmark-row-item[data-id="bm-1"]') as HTMLElement;

    // Sortable moves row1 to wrapperB
    wrapperB.appendChild(row1);

    const sortableA = sortableInstances.find((inst) => inst.element === wrapperA);
    sortableA?.options.onEnd({
      item: row1,
      from: wrapperA,
      to: wrapperB,
      oldDraggableIndex: 0,
      newDraggableIndex: 1,
    });

    await vi.waitFor(() => {
      expect(reorderBookmarksSpy).toHaveBeenCalledTimes(1);
      expect((window as any).poexdAlert).toHaveBeenCalledTimes(1);
    });

    // Verify rollback restored bm-1 to Folder A and Folder B has zero orphans
    await vi.waitFor(() => {
      const curA = appRoot.querySelector('.bookmark-list-wrapper[data-group-id="group-a"]');
      const curB = appRoot.querySelector('.bookmark-list-wrapper[data-group-id="group-b"]');
      expect(curA?.querySelectorAll('.bookmark-row-item[data-id="bm-1"]')).toHaveLength(1);
      expect(curB?.querySelectorAll('.bookmark-row-item[data-id="bm-1"]')).toHaveLength(0);
      expect(appRoot.querySelectorAll('.bookmark-row-item[data-id="bm-1"]')).toHaveLength(1);
    });
  });

  it('D1. Trash delete success: removes bookmark from DOM and model projection', async () => {
    await mountBookmarkPane(
      [{ id: 'group-a', name: 'Folder A', order: 0 }],
      [{ id: 'bm-del', name: 'Delete Me', url: '/del', groupId: 'group-a', order: 0 }],
    );

    const wrapper = appRoot.querySelector(
      '.bookmark-list-wrapper[data-group-id="group-a"]',
    ) as HTMLElement;
    const sortable = sortableInstances.find((inst) => inst.element === wrapper);
    sortable?.options.onStart?.();

    const trashZone = appRoot.querySelector('.drag-trash-zone') as HTMLElement;
    trashZone.dispatchEvent(new Event('dragover'));

    const row = wrapper.querySelector('.bookmark-row-item[data-id="bm-del"]') as HTMLElement;
    sortable?.options.onEnd?.({ item: row });

    await vi.waitFor(() => {
      expect(deleteBookmarkSpy).toHaveBeenCalledWith('bm-del');
      expect(appRoot.querySelector('.bookmark-row-item[data-id="bm-del"]')).toBeNull();
    });
  });

  it('D2. Trash delete failure: rolls back model and preserves single DOM row', async () => {
    deleteBookmarkSpy.mockImplementationOnce(async () => ({
      ok: false,
      error: { message: 'Delete failed' },
    }));

    await mountBookmarkPane(
      [{ id: 'group-a', name: 'Folder A', order: 0 }],
      [{ id: 'bm-fail', name: 'Keep Me', url: '/keep', groupId: 'group-a', order: 0 }],
    );

    const wrapper = appRoot.querySelector(
      '.bookmark-list-wrapper[data-group-id="group-a"]',
    ) as HTMLElement;
    const sortable = sortableInstances.find((inst) => inst.element === wrapper);
    sortable?.options.onStart?.();

    const trashZone = appRoot.querySelector('.drag-trash-zone') as HTMLElement;
    trashZone.dispatchEvent(new Event('dragover'));

    const row = wrapper.querySelector('.bookmark-row-item[data-id="bm-fail"]') as HTMLElement;
    sortable?.options.onEnd?.({ item: row });

    await vi.waitFor(() => {
      expect((window as any).poexdAlert).toHaveBeenCalled();
    });

    await vi.waitFor(() => {
      expect(appRoot.querySelectorAll('.bookmark-row-item[data-id="bm-fail"]')).toHaveLength(1);
    });
  });

  it('E. Folder reorder and trash cancel: reconciles folder tree cleanly without duplication', async () => {
    await mountBookmarkPane(
      [
        { id: 'f-1', name: 'Folder 1', order: 0 },
        { id: 'f-2', name: 'Folder 2', order: 1 },
      ],
      [
        { id: 'b-1', name: 'Bookmark 1', url: '/b1', groupId: 'f-1', order: 0 },
        { id: 'b-2', name: 'Bookmark 2', url: '/b2', groupId: 'f-2', order: 0 },
      ],
    );

    const accordion = appRoot.querySelector('.bookmark-accordion-list') as HTMLElement;
    const sortableRoot = appRoot.querySelector('.bookmark-sortable-root') as HTMLElement;
    const folderSortable = sortableInstances.find((inst) => inst.element === sortableRoot);
    expect(folderSortable).toBeDefined();
    expect(folderSortable?.options.scroll).toBe(accordion);

    // 1. Folder reorder: drag f-2 to before f-1
    const folder1 = sortableRoot.querySelector(
      '.group-container[data-group-id="f-1"]',
    ) as HTMLElement;
    const folder2 = sortableRoot.querySelector(
      '.group-container[data-group-id="f-2"]',
    ) as HTMLElement;
    const header1 = folder1.querySelector('.group-header-row') as HTMLElement;
    header1.getBoundingClientRect = () =>
      ({ top: 100, height: 40, bottom: 140, left: 0, right: 200, width: 200, x: 0, y: 100 }) as any;

    (shadowRoot as any).elementFromPoint = vi.fn(() => header1);

    folderSortable?.options.onStart?.({
      item: folder2,
      originalEvent: { clientX: 50 },
    });

    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 50, clientY: 110 }));

    folderSortable?.options.onEnd?.({
      item: folder2,
    });

    await vi.waitFor(() => {
      expect(moveFolderSpy).toHaveBeenCalledWith(
        'f-2',
        undefined,
        undefined,
        expect.objectContaining({
          targetFolderId: 'f-1',
          position: 'before',
        }),
      );
    });

    await vi.waitFor(() => {
      const containers = Array.from(appRoot.querySelectorAll('.group-container'));
      expect(containers.map((c) => c.getAttribute('data-group-id'))).toEqual(['f-2', 'f-1']);
    });

    // 2. Folder delete cancel: drag non-empty folder f-2 over trash, cancel confirm
    accordion.scrollTop = 120;

    const updatedSortableRoot = appRoot.querySelector('.bookmark-sortable-root') as HTMLElement;
    const activeFolderSortable = sortableInstances.find(
      (inst) => inst.element === updatedSortableRoot,
    );
    expect(activeFolderSortable).toBeDefined();

    const folder2Active = updatedSortableRoot.querySelector(
      '.group-container[data-group-id="f-2"]',
    ) as HTMLElement;
    expect(folder2Active).not.toBeNull();

    (window as any).poexdConfirm.mockResolvedValueOnce(false);
    activeFolderSortable?.options.onStart?.();

    const trashZone = appRoot.querySelector('.drag-trash-zone') as HTMLElement;
    trashZone.dispatchEvent(new Event('dragover'));

    activeFolderSortable?.options.onEnd({
      item: folder2Active,
    });

    await vi.waitFor(() => {
      expect((window as any).poexdConfirm).toHaveBeenCalledWith(
        '確定要刪除資料夾「Folder 2」嗎？\n這將會一併刪除資料夾內的 1 個書籤。',
        '拖曳刪除資料夾',
      );
      // Must not call deleteGroup
      expect(deleteGroupSpy).not.toHaveBeenCalled();
    });

    // DOM returns to canonical state without duplicates or orphan items
    await vi.waitFor(() => {
      expect(appRoot.querySelectorAll('.group-container[data-group-id="f-2"]')).toHaveLength(1);
      expect(appRoot.querySelectorAll('.group-container[data-group-id="f-1"]')).toHaveLength(1);
      expect(appRoot.querySelectorAll('.bookmark-row-item[data-id="b-1"]')).toHaveLength(1);
      expect(appRoot.querySelectorAll('.bookmark-row-item[data-id="b-2"]')).toHaveLength(1);
    });

    // Viewport identity intact, non-zero scrollTop preserved
    const postAccordion = appRoot.querySelector('.bookmark-accordion-list') as HTMLElement;
    expect(postAccordion).toBe(accordion);
    expect(postAccordion.scrollTop).toBe(120);

    // Canonical order in BookmarkModel matches
    expect(mockBookmarkCollection.groups.map((g) => g.id)).toEqual(['f-2', 'f-1']);
    expect(mockBookmarkCollection.bookmarks.map((b) => b.id)).toEqual(['b-1', 'b-2']);
  });

  it('F1. Search active: destroys Sortable instances, disables drag/reorder, and keeps canonical model unchanged', async () => {
    await mountBookmarkPane(
      [
        { id: 'f-1', name: 'Folder 1', order: 0 },
        { id: 'f-2', name: 'Folder 2', order: 1 },
      ],
      [
        { id: 'bm-1', name: 'Alpha Bow', url: '/alpha', groupId: 'f-1', order: 0 },
        { id: 'bm-2', name: 'Beta Wand', url: '/beta', groupId: 'f-1', order: 1 },
        { id: 'bm-3', name: 'Gamma Shield', url: '/gamma', groupId: 'f-2', order: 2 },
      ],
    );

    // Initial state: Sortables created for accordion + 2 folders = 3 instances
    expect(sortableInstances.length).toBeGreaterThanOrEqual(3);
    const initialInstances = [...sortableInstances];

    // Open search and input query
    const searchBtn = appRoot.querySelector('button[title="搜尋書籤"]') as HTMLButtonElement;
    searchBtn.click();
    await nextTick();

    const searchInput = appRoot.querySelector(
      'input[placeholder="搜尋書籤或資料夾名稱..."]',
    ) as HTMLInputElement;
    expect(searchInput).not.toBeNull();
    searchInput.value = 'Beta';
    searchInput.dispatchEvent(new Event('input'));
    await nextTick();

    // Verify existing Sortable instances are destroyed
    await vi.waitFor(() => {
      expect(sortableInstances).toHaveLength(0);
    });

    // Ensure filtered items are displayed
    expect(appRoot.querySelector('.bookmark-row-item[data-id="bm-2"]')).not.toBeNull();
    expect(appRoot.querySelector('.bookmark-row-item[data-id="bm-1"]')).toBeNull();

    // Attempting drop via any stale Sortable onEnd reference must not dispatch reorders
    for (const stale of initialInstances) {
      if (stale.options?.onEnd) {
        stale.options.onEnd({
          item: document.createElement('div'),
          oldDraggableIndex: 0,
          newDraggableIndex: 1,
        });
      }
    }

    await vi.waitFor(() => {
      expect(reorderBookmarksSpy).not.toHaveBeenCalled();
      expect(reorderGroupsSpy).not.toHaveBeenCalled();
    });

    // Canonical order in mockBookmarkCollection is completely unchanged
    expect(mockBookmarkCollection.bookmarks.map((b) => b.id)).toEqual(['bm-1', 'bm-2', 'bm-3']);
    expect(mockBookmarkCollection.groups.map((g) => g.id)).toEqual(['f-1', 'f-2']);
  });

  it('F2. Search cleared: rebinds Sortables cleanly without duplication and allows normal drag reorder', async () => {
    await mountBookmarkPane(
      [{ id: 'f-1', name: 'Folder 1', order: 0 }],
      [
        { id: 'bm-1', name: 'Alpha Bow', url: '/alpha', groupId: 'f-1', order: 0 },
        { id: 'bm-2', name: 'Beta Wand', url: '/beta', groupId: 'f-1', order: 1 },
      ],
    );

    // Open search and input query
    const searchBtn = appRoot.querySelector('button[title="搜尋書籤"]') as HTMLButtonElement;
    searchBtn.click();
    await nextTick();

    const searchInput = appRoot.querySelector(
      'input[placeholder="搜尋書籤或資料夾名稱..."]',
    ) as HTMLInputElement;
    searchInput.value = 'Beta';
    searchInput.dispatchEvent(new Event('input'));
    await nextTick();

    await vi.waitFor(() => {
      expect(sortableInstances).toHaveLength(0);
    });

    // Clear search
    searchInput.value = '';
    searchInput.dispatchEvent(new Event('input'));
    await nextTick();

    // Sortables cleanly re-bound: exactly 1 folder accordion + 1 bookmark list wrapper = 2 instances
    await vi.waitFor(() => {
      expect(sortableInstances).toHaveLength(2);
    });

    const wrapper = appRoot.querySelector(
      '.bookmark-list-wrapper[data-group-id="f-1"]',
    ) as HTMLElement;
    const bmSortable = sortableInstances.find((inst) => inst.element === wrapper);
    expect(bmSortable).toBeDefined();

    // Now perform a normal drag reorder (bm-2 to index 0)
    const row2 = wrapper.querySelector('.bookmark-row-item[data-id="bm-2"]') as HTMLElement;
    wrapper.insertBefore(row2, wrapper.firstChild);

    bmSortable?.options.onEnd({
      item: row2,
      from: wrapper,
      to: wrapper,
      oldDraggableIndex: 1,
      newDraggableIndex: 0,
    });

    await vi.waitFor(() => {
      expect(reorderBookmarksSpy).toHaveBeenCalledWith([
        { id: 'bm-2', groupId: 'f-1', order: 0 },
        { id: 'bm-1', groupId: 'f-1', order: 1 },
      ]);
    });

    // Verify DOM reconciliation
    await vi.waitFor(() => {
      const rows = Array.from(wrapper.querySelectorAll('.bookmark-row-item'));
      expect(rows.map((r) => r.getAttribute('data-id'))).toEqual(['bm-2', 'bm-1']);
    });
  });

  describe('G. Scroll Continuity & Viewport Identity Runtime Regression', () => {
    it('G1. Same-folder bookmark reorder: preserves viewport identity and non-zero scrollTop without jumping to top', async () => {
      await mountBookmarkPane(
        [{ id: 'g-main', name: 'Main Folder', order: 0 }],
        [
          { id: 'b-1', name: 'Item 1', url: '/1', groupId: 'g-main', order: 0 },
          { id: 'b-2', name: 'Item 2', url: '/2', groupId: 'g-main', order: 1 },
          { id: 'b-3', name: 'Item 3', url: '/3', groupId: 'g-main', order: 2 },
        ],
      );

      const accordion = appRoot.querySelector('.bookmark-accordion-list') as HTMLElement;
      expect(accordion).not.toBeNull();

      // Simulate list scrolled down
      accordion.scrollTop = 240;
      expect(accordion.scrollTop).toBe(240);

      const wrapper = appRoot.querySelector(
        '.bookmark-list-wrapper[data-group-id="g-main"]',
      ) as HTMLElement;
      const sortable = sortableInstances.find((inst) => inst.element === wrapper);
      expect(sortable).toBeDefined();

      // Drag b-3 before b-1
      const row3 = wrapper.querySelector('.bookmark-row-item[data-id="b-3"]') as HTMLElement;
      wrapper.insertBefore(row3, wrapper.firstChild);

      sortable?.options.onEnd({
        item: row3,
        from: wrapper,
        to: wrapper,
        oldDraggableIndex: 2,
        newDraggableIndex: 0,
      });

      await vi.waitFor(() => {
        expect(reorderBookmarksSpy).toHaveBeenCalledWith([
          { id: 'b-3', groupId: 'g-main', order: 0 },
          { id: 'b-1', groupId: 'g-main', order: 1 },
          { id: 'b-2', groupId: 'g-main', order: 2 },
        ]);
      });

      // Assert scroll viewport identity and position continuity
      const postAccordion = appRoot.querySelector('.bookmark-accordion-list') as HTMLElement;
      expect(postAccordion).toBe(accordion);
      expect(postAccordion.scrollTop).toBe(240);
      expect(postAccordion.scrollTop).toBeGreaterThan(0);

      // Verify DOM reconciliation matches domain model
      await vi.waitFor(() => {
        const rows = Array.from(appRoot.querySelectorAll('.bookmark-row-item'));
        expect(rows.map((r) => r.getAttribute('data-id'))).toEqual(['b-3', 'b-1', 'b-2']);
      });
    });

    it('G2. Cross-folder bookmark move: preserves viewport identity and non-zero scrollTop', async () => {
      await mountBookmarkPane(
        [
          { id: 'g-src', name: 'Source Folder', order: 0 },
          { id: 'g-dst', name: 'Target Folder', order: 1 },
        ],
        [
          { id: 'bm-cross', name: 'Moving Item', url: '/cross', groupId: 'g-src', order: 0 },
          { id: 'bm-other', name: 'Existing Item', url: '/other', groupId: 'g-dst', order: 0 },
        ],
      );

      const accordion = appRoot.querySelector('.bookmark-accordion-list') as HTMLElement;
      expect(accordion).not.toBeNull();

      // Scrolled down
      accordion.scrollTop = 310;
      expect(accordion.scrollTop).toBe(310);

      const srcWrapper = appRoot.querySelector(
        '.bookmark-list-wrapper[data-group-id="g-src"]',
      ) as HTMLElement;
      const dstWrapper = appRoot.querySelector(
        '.bookmark-list-wrapper[data-group-id="g-dst"]',
      ) as HTMLElement;
      const srcSortable = sortableInstances.find((inst) => inst.element === srcWrapper);

      const movingRow = srcWrapper.querySelector(
        '.bookmark-row-item[data-id="bm-cross"]',
      ) as HTMLElement;
      dstWrapper.appendChild(movingRow);

      srcSortable?.options.onEnd({
        item: movingRow,
        from: srcWrapper,
        to: dstWrapper,
        oldDraggableIndex: 0,
        newDraggableIndex: 1,
      });

      await vi.waitFor(() => {
        expect(reorderBookmarksSpy).toHaveBeenCalledWith([
          { id: 'bm-other', groupId: 'g-dst', order: 0 },
          { id: 'bm-cross', groupId: 'g-dst', order: 1 },
        ]);
      });

      // Viewport remains stable and scroll position does not reset
      const postAccordion = appRoot.querySelector('.bookmark-accordion-list') as HTMLElement;
      expect(postAccordion).toBe(accordion);
      expect(postAccordion.scrollTop).toBe(310);
      expect(postAccordion.scrollTop).toBeGreaterThan(0);

      // Clean reconciliation without duplicate rows
      await vi.waitFor(() => {
        expect(appRoot.querySelectorAll('.bookmark-row-item[data-id="bm-cross"]')).toHaveLength(1);
        expect(srcWrapper.querySelectorAll('.bookmark-row-item[data-id="bm-cross"]')).toHaveLength(
          0,
        );
        expect(dstWrapper.querySelectorAll('.bookmark-row-item[data-id="bm-cross"]')).toHaveLength(
          1,
        );
      });
    });

    it('G3. Folder reorder: preserves viewport identity and non-zero scrollTop', async () => {
      await mountBookmarkPane(
        [
          { id: 'f-1', name: 'Folder 1', order: 0 },
          { id: 'f-2', name: 'Folder 2', order: 1 },
          { id: 'f-3', name: 'Folder 3', order: 2 },
        ],
        [],
      );

      const accordion = appRoot.querySelector('.bookmark-accordion-list') as HTMLElement;
      expect(accordion).not.toBeNull();

      accordion.scrollTop = 175;
      expect(accordion.scrollTop).toBe(175);

      const sortableRoot = appRoot.querySelector('.bookmark-sortable-root') as HTMLElement;
      expect(sortableRoot).not.toBeNull();

      const folderSortable = sortableInstances.find((inst) => inst.element === sortableRoot);
      expect(folderSortable).toBeDefined();

      // Drag f-3 to before f-1
      const folder1 = sortableRoot.querySelector(
        '.group-container[data-group-id="f-1"]',
      ) as HTMLElement;
      const folder3 = sortableRoot.querySelector(
        '.group-container[data-group-id="f-3"]',
      ) as HTMLElement;
      const header1 = folder1.querySelector('.group-header-row') as HTMLElement;
      header1.getBoundingClientRect = () =>
        ({
          top: 100,
          height: 40,
          bottom: 140,
          left: 0,
          right: 200,
          width: 200,
          x: 0,
          y: 100,
        }) as any;

      (shadowRoot as any).elementFromPoint = vi.fn(() => header1);

      folderSortable?.options.onStart?.({
        item: folder3,
        originalEvent: { clientX: 50 },
      });

      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 50, clientY: 110 }));

      folderSortable?.options.onEnd?.({
        item: folder3,
      });

      await vi.waitFor(() => {
        expect(moveFolderSpy).toHaveBeenCalledWith(
          'f-3',
          undefined,
          undefined,
          expect.objectContaining({
            targetFolderId: 'f-1',
            position: 'before',
          }),
        );
      });

      // Viewport identity intact, scroll position maintained
      const postAccordion = appRoot.querySelector('.bookmark-accordion-list') as HTMLElement;
      expect(postAccordion).toBe(accordion);
      expect(postAccordion.scrollTop).toBe(175);
      expect(postAccordion.scrollTop).toBeGreaterThan(0);

      // Folder DOM reconciliation
      await vi.waitFor(() => {
        const containers = Array.from(appRoot.querySelectorAll('.group-container'));
        expect(containers.map((c) => c.getAttribute('data-group-id'))).toEqual([
          'f-3',
          'f-1',
          'f-2',
        ]);
      });
    });

    it('G4. Trash delete: preserves viewport identity and non-zero scrollTop', async () => {
      await mountBookmarkPane(
        [{ id: 'f-del', name: 'Delete Test', order: 0 }],
        [{ id: 'bm-del', name: 'Del Item', url: '/del', groupId: 'f-del', order: 0 }],
      );

      const accordion = appRoot.querySelector('.bookmark-accordion-list') as HTMLElement;
      accordion.scrollTop = 190;

      const wrapper = appRoot.querySelector(
        '.bookmark-list-wrapper[data-group-id="f-del"]',
      ) as HTMLElement;
      const sortable = sortableInstances.find((inst) => inst.element === wrapper);
      sortable?.options.onStart?.();

      const trashZone = appRoot.querySelector('.drag-trash-zone') as HTMLElement;
      trashZone.dispatchEvent(new Event('dragover'));

      const row = wrapper.querySelector('.bookmark-row-item[data-id="bm-del"]') as HTMLElement;
      sortable?.options.onEnd?.({ item: row });

      await vi.waitFor(() => {
        expect(deleteBookmarkSpy).toHaveBeenCalledWith('bm-del');
        expect(appRoot.querySelector('.bookmark-row-item[data-id="bm-del"]')).toBeNull();
      });

      const postAccordion = appRoot.querySelector('.bookmark-accordion-list') as HTMLElement;
      expect(postAccordion).toBe(accordion);
      expect(postAccordion.scrollTop).toBe(190);
      expect(postAccordion.scrollTop).toBeGreaterThan(0);
    });

    it('G5. Failure rollback: restores canonical items and preserves viewport identity and non-zero scrollTop', async () => {
      deleteBookmarkSpy.mockImplementationOnce(async () => ({
        ok: false,
        error: { message: 'Write failed' },
      }));

      await mountBookmarkPane(
        [{ id: 'f-rb', name: 'Rollback Test', order: 0 }],
        [{ id: 'bm-rb', name: 'Keep Item', url: '/rb', groupId: 'f-rb', order: 0 }],
      );

      const accordion = appRoot.querySelector('.bookmark-accordion-list') as HTMLElement;
      accordion.scrollTop = 220;

      const wrapper = appRoot.querySelector(
        '.bookmark-list-wrapper[data-group-id="f-rb"]',
      ) as HTMLElement;
      const sortable = sortableInstances.find((inst) => inst.element === wrapper);
      sortable?.options.onStart?.();

      const trashZone = appRoot.querySelector('.drag-trash-zone') as HTMLElement;
      trashZone.dispatchEvent(new Event('dragover'));

      const row = wrapper.querySelector('.bookmark-row-item[data-id="bm-rb"]') as HTMLElement;
      sortable?.options.onEnd?.({ item: row });

      await vi.waitFor(() => {
        expect((window as any).poexdAlert).toHaveBeenCalled();
        expect(appRoot.querySelectorAll('.bookmark-row-item[data-id="bm-rb"]')).toHaveLength(1);
      });

      const postAccordion = appRoot.querySelector('.bookmark-accordion-list') as HTMLElement;
      expect(postAccordion).toBe(accordion);
      expect(postAccordion.scrollTop).toBe(220);
      expect(postAccordion.scrollTop).toBeGreaterThan(0);
    });

    it('G6. Trash cancel: preserves viewport identity and non-zero scrollTop', async () => {
      (window as any).poexdConfirm.mockResolvedValueOnce(false);

      await mountBookmarkPane(
        [{ id: 'f-cancel', name: 'Cancel Test', order: 0 }],
        [
          { id: 'bm-cancel-1', name: 'Cancel Item 1', url: '/c1', groupId: 'f-cancel', order: 0 },
          { id: 'bm-cancel-2', name: 'Cancel Item 2', url: '/c2', groupId: 'f-cancel', order: 1 },
        ],
      );

      const accordion = appRoot.querySelector('.bookmark-accordion-list') as HTMLElement;
      accordion.scrollTop = 160;

      const sortableRoot = appRoot.querySelector('.bookmark-sortable-root') as HTMLElement;
      const folderSortable = sortableInstances.find((inst) => inst.element === sortableRoot);
      expect(folderSortable).toBeDefined();
      folderSortable?.options.onStart?.();

      const trashZone = appRoot.querySelector('.drag-trash-zone') as HTMLElement;
      trashZone.dispatchEvent(new Event('dragover'));

      const folderEl = sortableRoot.querySelector(
        '.group-container[data-group-id="f-cancel"]',
      ) as HTMLElement;
      folderSortable?.options.onEnd?.({ item: folderEl });

      await vi.waitFor(() => {
        expect((window as any).poexdConfirm).toHaveBeenCalledWith(
          '確定要刪除資料夾「Cancel Test」嗎？\n這將會一併刪除資料夾內的 2 個書籤。',
          '拖曳刪除資料夾',
        );
        expect(deleteGroupSpy).not.toHaveBeenCalled();
      });

      // Assert folder and bookmark DOM have exactly 1 copy, no orphans or duplicates
      await vi.waitFor(() => {
        expect(appRoot.querySelectorAll('.group-container[data-group-id="f-cancel"]')).toHaveLength(
          1,
        );
        expect(appRoot.querySelectorAll('.bookmark-row-item[data-id="bm-cancel-1"]')).toHaveLength(
          1,
        );
        expect(appRoot.querySelectorAll('.bookmark-row-item[data-id="bm-cancel-2"]')).toHaveLength(
          1,
        );
      });

      // Viewport identity intact, non-zero scrollTop preserved
      const postAccordion = appRoot.querySelector('.bookmark-accordion-list') as HTMLElement;
      expect(postAccordion).toBe(accordion);
      expect(postAccordion.scrollTop).toBe(160);
      expect(postAccordion.scrollTop).toBeGreaterThan(0);

      // BookmarkModel canonical state intact
      expect(mockBookmarkCollection.groups.map((g) => g.id)).toEqual(['f-cancel']);
      expect(mockBookmarkCollection.bookmarks.map((b) => b.id)).toEqual([
        'bm-cancel-1',
        'bm-cancel-2',
      ]);
    });

    it('G7. AutoScroll contract: folderSortables and bookmarkSortables target .bookmark-accordion-list as scroll owner', async () => {
      await mountBookmarkPane(
        [
          { id: 'f-auto-1', name: 'AutoScroll 1', order: 0 },
          { id: 'f-auto-2', name: 'AutoScroll 2', order: 1 },
        ],
        [{ id: 'b-auto-1', name: 'Auto 1', url: '/a1', groupId: 'f-auto-1', order: 0 }],
      );

      const accordion = appRoot.querySelector('.bookmark-accordion-list') as HTMLElement;
      const sortableRoot = appRoot.querySelector('.bookmark-sortable-root') as HTMLElement;
      const wrapper = appRoot.querySelector(
        '.bookmark-list-wrapper[data-group-id="f-auto-1"]',
      ) as HTMLElement;

      const folderSortable = sortableInstances.find((inst) => inst.element === sortableRoot);
      const bmSortable = sortableInstances.find((inst) => inst.element === wrapper);

      expect(folderSortable).toBeDefined();
      expect(bmSortable).toBeDefined();

      // Both must target .bookmark-accordion-list as scroll element
      expect(folderSortable?.options.scroll).toBe(accordion);
      expect(bmSortable?.options.scroll).toBe(accordion);

      // Both must share identical stable AutoScroll configurations
      for (const instance of [folderSortable, bmSortable]) {
        expect(instance?.options.forceAutoScrollFallback).toBe(true);
        expect(instance?.options.scrollSensitivity).toBe(48);
        expect(instance?.options.scrollSpeed).toBe(20);
        expect(instance?.options.bubbleScroll).toBe(false);
      }
    });

    it('E2. Trash Zone Feedback & Subtree Preview: displays live canonical counts including collapsed descendants and matches confirmation', async () => {
      await mountBookmarkPane(
        [
          { id: 'f-root', name: 'Root Folder', order: 0 },
          { id: 'f-child', name: 'Child Folder', parentId: 'f-root', order: 0 },
        ],
        [
          { id: 'bm-root', name: 'Root BM', url: '/r', groupId: 'f-root', order: 0 },
          { id: 'bm-child', name: 'Child BM', url: '/c', groupId: 'f-child', order: 0 },
        ],
      );

      const sortableRoot = appRoot.querySelector('.bookmark-sortable-root') as HTMLElement;
      const folderSortable = sortableInstances.find((inst) => inst.element === sortableRoot);
      const rootFolderEl = sortableRoot.querySelector(
        '.group-container[data-group-id="f-root"]',
      ) as HTMLElement;
      const trashZone = appRoot.querySelector('.drag-trash-zone') as HTMLElement;

      // 1. Initial neutral text on drag start
      folderSortable?.options.onStart?.({ item: rootFolderEl });
      expect(trashZone.textContent).toContain('拖曳至此處刪除');

      // 2. Drag hover over trash displays live derived canonical impact
      trashZone.dispatchEvent(new Event('dragover'));
      await nextTick();
      expect(trashZone.textContent).toContain('放開以刪除');
      expect(trashZone.textContent).toContain('2 個資料夾');
      expect(trashZone.textContent).toContain('2 個書籤');

      // 3. Drag leave restores neutral text
      const leaveEvt = new MouseEvent('dragleave', { clientX: 2000, clientY: 2000 });
      trashZone.dispatchEvent(leaveEvt);
      await nextTick();
      expect(trashZone.textContent).toContain('拖曳至此處刪除');

      // 4. Hover again and drop: confirmation dialog matches preview impact
      trashZone.dispatchEvent(new Event('dragover'));
      await nextTick();
      folderSortable?.options.onEnd?.({ item: rootFolderEl });

      await vi.waitFor(() => {
        expect((window as any).poexdConfirm).toHaveBeenCalledWith(
          expect.stringContaining('1 個子資料夾'),
          '拖曳刪除資料夾',
        );
        expect((window as any).poexdConfirm).toHaveBeenCalledWith(
          expect.stringContaining('2 個書籤'),
          '拖曳刪除資料夾',
        );
      });
    });
  });
});
