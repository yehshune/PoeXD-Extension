// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { readBookmarkNodeSource } from './helpers/bookmark-node-source';

const { createSortable } = vi.hoisted(() => ({ createSortable: vi.fn() }));

vi.mock('sortablejs', () => ({
  default: { create: createSortable },
}));

import {
  createBookmarkCollectionModule,
  resolveFolderDropPlacement,
  type BookmarkCollectionState,
  type BookmarkFolder,
  type FolderDropIntent,
} from '@/utils/bookmark-collection';
import { createBookmarkModel } from '@/components/sidebar/bookmark-model';
import {
  calculateBookmarkReorderPlacements,
  resolveFolderRowGap,
  resolveHitTestElement,
  resolveTreeIndentationWidth,
  useBookmarkSortables,
} from '@/components/sidebar/composables/useBookmarkSortables';
import { ref } from 'vue';
import type { BookmarkClient } from '@/utils/bookmark-messaging';

describe('Bookmark Nested DnD (Phase D Domain & Placement Contracts)', () => {
  const sampleFolders: BookmarkFolder[] = [
    { id: 'root-1', gameVersion: 'poe1', name: 'Root 1', order: 0 },
    { id: 'root-2', gameVersion: 'poe1', name: 'Root 2', order: 1 },
    { id: 'root-3', gameVersion: 'poe1', name: 'Root 3', order: 2 },
    { id: 'child-1-1', gameVersion: 'poe1', name: 'Child 1.1', order: 0, parentId: 'root-1' },
    { id: 'child-1-2', gameVersion: 'poe1', name: 'Child 1.2', order: 1, parentId: 'root-1' },
    {
      id: 'subchild-1-1-1',
      gameVersion: 'poe1',
      name: 'SubChild 1.1.1',
      order: 0,
      parentId: 'child-1-1',
    },
  ];

  it('1. same-parent before: reorders sibling in place and normalizes sibling orders', () => {
    const intent: FolderDropIntent = { targetFolderId: 'root-1', position: 'before' };
    const result = resolveFolderDropPlacement(sampleFolders, 'root-3', intent);

    expect(result.ok).toBe(true);
    expect(result.targetParentId).toBeUndefined();
    // Expected order: root-3 (0), root-1 (1), root-2 (2)
    const map = new Map(result.placements!.map((p) => [p.id, p]));
    expect(map.get('root-3')?.order).toBe(0);
    expect(map.get('root-1')?.order).toBe(1);
    expect(map.get('root-2')?.order).toBe(2);
    // Unrelated children should not be touched
    expect(map.has('child-1-1')).toBe(false);
  });

  it('2. same-parent after: reorders sibling in place and normalizes sibling orders', () => {
    const intent: FolderDropIntent = { targetFolderId: 'root-3', position: 'after' };
    const result = resolveFolderDropPlacement(sampleFolders, 'root-1', intent);

    expect(result.ok).toBe(true);
    expect(result.targetParentId).toBeUndefined();
    // Expected order: root-2 (0), root-3 (1), root-1 (2)
    const map = new Map(result.placements!.map((p) => [p.id, p]));
    expect(map.get('root-2')?.order).toBe(0);
    expect(map.get('root-3')?.order).toBe(1);
    expect(map.get('root-1')?.order).toBe(2);
  });

  it('3. root A inside root B: moves A to become child of B and updates both sibling sets', () => {
    const intent: FolderDropIntent = { targetFolderId: 'root-2', position: 'inside' };
    const result = resolveFolderDropPlacement(sampleFolders, 'root-1', intent);

    expect(result.ok).toBe(true);
    expect(result.targetParentId).toBe('root-2');
    const map = new Map(result.placements!.map((p) => [p.id, p]));

    // Target siblings under root-2: root-1 is added as child
    expect(map.get('root-1')).toEqual({ id: 'root-1', parentId: 'root-2', order: 0 });

    // Source siblings under root: root-2 and root-3 normalized
    expect(map.get('root-2')).toEqual({ id: 'root-2', parentId: undefined, order: 0 });
    expect(map.get('root-3')).toEqual({ id: 'root-3', parentId: undefined, order: 1 });

    // Internal subtree of root-1 remains untouched
    expect(map.has('child-1-1')).toBe(false);
    expect(map.has('subchild-1-1-1')).toBe(false);
  });

  it('4. child moved to another parent: updates target siblings and re-indexes source siblings', () => {
    const intent: FolderDropIntent = { targetFolderId: 'root-2', position: 'inside' };
    const result = resolveFolderDropPlacement(sampleFolders, 'child-1-1', intent);

    expect(result.ok).toBe(true);
    expect(result.targetParentId).toBe('root-2');
    const map = new Map(result.placements!.map((p) => [p.id, p]));

    // Target child placement
    expect(map.get('child-1-1')).toEqual({ id: 'child-1-1', parentId: 'root-2', order: 0 });

    // Source sibling remaining under root-1 re-indexed
    expect(map.get('child-1-2')).toEqual({ id: 'child-1-2', parentId: 'root-1', order: 0 });

    // Subtree of child-1-1 (subchild-1-1-1) is untouched
    expect(map.has('subchild-1-1-1')).toBe(false);
  });

  it('5. child moved back to root via before/after a root folder', () => {
    const intent: FolderDropIntent = { targetFolderId: 'root-2', position: 'before' };
    const result = resolveFolderDropPlacement(sampleFolders, 'child-1-1', intent);

    expect(result.ok).toBe(true);
    expect(result.targetParentId).toBeUndefined();
    const map = new Map(result.placements!.map((p) => [p.id, p]));

    // Placed before root-2 among root folders
    expect(map.get('root-1')?.order).toBe(0);
    expect(map.get('child-1-1')?.order).toBe(1);
    expect(map.get('child-1-1')?.parentId).toBeUndefined();
    expect(map.get('root-2')?.order).toBe(2);
    expect(map.get('root-3')?.order).toBe(3);

    // Source siblings under root-1 re-indexed
    expect(map.get('child-1-2')).toEqual({ id: 'child-1-2', parentId: 'root-1', order: 0 });
  });

  it('6. preserves arbitrary-depth subtree hierarchy unchanged during ancestor move', () => {
    const intent: FolderDropIntent = { targetFolderId: 'root-3', position: 'inside' };
    const result = resolveFolderDropPlacement(sampleFolders, 'root-1', intent);

    expect(result.ok).toBe(true);
    // Placements should strictly touch root siblings and root-3 children, NOT descendants of root-1
    const placements = result.placements!;
    const touchedIds = new Set(placements.map((p) => p.id));
    expect(touchedIds.has('root-1')).toBe(true);
    expect(touchedIds.has('child-1-1')).toBe(false);
    expect(touchedIds.has('child-1-2')).toBe(false);
    expect(touchedIds.has('subchild-1-1-1')).toBe(false);
  });

  it('7. rejects drop inside self', () => {
    const intent: FolderDropIntent = { targetFolderId: 'root-1', position: 'inside' };
    const result = resolveFolderDropPlacement(sampleFolders, 'root-1', intent);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('Cannot drop folder onto itself');
  });

  it('8. rejects ancestor drop inside its own descendant (direct and indirect cycle)', () => {
    // Direct child inside
    const directChildIntent: FolderDropIntent = { targetFolderId: 'child-1-1', position: 'inside' };
    const directResult = resolveFolderDropPlacement(sampleFolders, 'root-1', directChildIntent);
    expect(directResult.ok).toBe(false);
    expect(directResult.reason).toContain('descendant');

    // Deep grandchild inside
    const deepGrandchildIntent: FolderDropIntent = {
      targetFolderId: 'subchild-1-1-1',
      position: 'inside',
    };
    const deepResult = resolveFolderDropPlacement(sampleFolders, 'root-1', deepGrandchildIntent);
    expect(deepResult.ok).toBe(false);
    expect(deepResult.reason).toContain('descendant');
  });

  it('9. rejects ancestor drop before/after descendant that would make parent inside subtree', () => {
    // Dropping root-1 before subchild-1-1-1 implies new parentId = child-1-1, which is a descendant of root-1
    const intent: FolderDropIntent = { targetFolderId: 'subchild-1-1-1', position: 'before' };
    const result = resolveFolderDropPlacement(sampleFolders, 'root-1', intent);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('descendant');
  });

  it('10. fails closed on nonexistent dragged or target folder', () => {
    expect(
      resolveFolderDropPlacement(sampleFolders, 'unknown', {
        targetFolderId: 'root-1',
        position: 'inside',
      }).ok,
    ).toBe(false);
    expect(
      resolveFolderDropPlacement(sampleFolders, 'root-1', {
        targetFolderId: 'unknown',
        position: 'inside',
      }).ok,
    ).toBe(false);
  });

  it('11. executes move-folder atomically in BookmarkCollectionModule with dropIntent', () => {
    const module = createBookmarkCollectionModule({
      schemaVersion: 3,
      folders: [
        { id: 'f-a', gameVersion: 'poe1', name: 'A', order: 0 },
        { id: 'f-b', gameVersion: 'poe1', name: 'B', order: 1 },
        { id: 'f-c', gameVersion: 'poe1', name: 'C', order: 2 },
      ],
      bookmarks: [],
    });

    const prepared = module.prepare({
      type: 'move-folder',
      gameVersion: 'poe1',
      folderId: 'f-c',
      dropIntent: { targetFolderId: 'f-a', position: 'before' },
    });

    expect(prepared.changed).toBe(true);
    const updated = prepared.state.folders.slice().sort((a, b) => a.order - b.order);
    expect(updated.map((f) => f.id)).toEqual(['f-c', 'f-a', 'f-b']);
    expect(updated.map((f) => f.order)).toEqual([0, 1, 2]);
  });

  it('12. BookmarkModel performs optimistic folder move projection and retains subtree', async () => {
    let committedState: BookmarkCollectionState | null = null;
    let liveView = {
      groups: [
        { id: 'f-1', name: 'Folder 1', order: 0 },
        { id: 'f-2', name: 'Folder 2', order: 1 },
        { id: 'f-sub', name: 'Sub Folder', order: 0, parentId: 'f-1' },
      ],
      bookmarks: [
        { id: 'bm-1', name: 'Item', url: 'https://...', groupId: 'f-sub', order: 0, createdAt: 1 },
      ],
    };

    const client: BookmarkClient = {
      readCollection: vi.fn(async () => ({
        ok: true,
        value: structuredClone(liveView),
      })),
      moveFolder: vi.fn(async (id, targetParentId, order, dropIntent) => {
        if (dropIntent) {
          const res = resolveFolderDropPlacement(liveView.groups, id, dropIntent);
          if (res.ok && res.placements) {
            const pMap = new Map(res.placements.map((p) => [p.id, p]));
            liveView.groups = liveView.groups.map((g) => {
              const p = pMap.get(g.id);
              return p ? { ...g, parentId: p.parentId, order: p.order } : g;
            });
          }
        }
        return { ok: true, changed: true };
      }),
      subscribe: vi.fn(() => () => {}),
    } as unknown as BookmarkClient;

    const model = createBookmarkModel(client);
    await model.connect();

    expect(model.state.value.groups.length).toBe(3);

    // Optimistically move f-1 inside f-2
    await model.execute({
      type: 'move-folder',
      folderId: 'f-1',
      dropIntent: { targetFolderId: 'f-2', position: 'inside' },
    });

    const groups = model.state.value.groups;
    const f1 = groups.find((g) => g.id === 'f-1')!;
    const f2 = groups.find((g) => g.id === 'f-2')!;
    const fSub = groups.find((g) => g.id === 'f-sub')!;

    expect(f1.parentId).toBe('f-2');
    expect(f2.parentId).toBeUndefined();
    expect(fSub.parentId).toBe('f-1'); // Internal subtree identity strictly preserved
    expect(model.state.value.bookmarks[0].groupId).toBe('f-sub'); // Bookmark ownership unchanged
  });

  it('13. calculates bookmark reorder placements across nested folders properly', () => {
    const groups = [
      { id: 'g-root', name: 'Root', order: 0 },
      { id: 'g-nested', name: 'Nested', order: 1, parentId: 'g-root' },
    ];
    const bookmarks = [
      {
        id: 'bm-1',
        name: 'Item 1',
        url: 'https://...',
        searchRecordId: 'sr-1',
        groupId: 'g-root',
        order: 0,
        createdAt: 1,
      },
      {
        id: 'bm-2',
        name: 'Item 2',
        url: 'https://...',
        searchRecordId: 'sr-2',
        groupId: 'g-root',
        order: 1,
        createdAt: 2,
      },
    ];

    // Drag bm-1 into empty nested folder g-nested
    const placements = calculateBookmarkReorderPlacements({
      bookmarks,
      groups,
      draggedBookmarkId: 'bm-1',
      sourceGroupId: 'g-root',
      targetGroupId: 'g-nested',
      newIndex: 0,
    });

    expect(placements).not.toBeNull();
    const movedBm = placements!.find((p) => p.id === 'bm-1');
    expect(movedBm?.groupId).toBe('g-nested');
    const remainingBm = placements!.find((p) => p.id === 'bm-2');
    expect(remainingBm?.groupId).toBe('g-root');
  });

  it('14. BookmarkFolderNode template defines dedicated .folder-drag-handle and visual drop indicator styles', () => {
    const fs = require('node:fs');
    const source = readBookmarkNodeSource();

    const handleMatch = source.match(/<button[^>]*class="[^"]*folder-drag-handle[^"]*"[^>]*>/s);
    expect(handleMatch).not.toBeNull();
    expect(handleMatch![0]).toContain('@click.stop');
    expect(handleMatch![0]).not.toContain('@pointerdown.stop');

    // Visual drop indicator CSS contracts
    expect(source).toContain('.drop-indicator-before');
    expect(source).toContain('.drop-indicator-inside');
    expect(source).toContain('.drop-indicator-after');
  });

  it('15. useBookmarkSortables configures handle: .folder-drag-handle instead of whole header', () => {
    const fs = require('node:fs');
    const source = fs.readFileSync(
      'components/sidebar/composables/useBookmarkSortables.ts',
      'utf8',
    );

    expect(source).toContain("handle: '.folder-drag-handle'");
    expect(source).not.toContain("handle: '.group-header-row'");
  });

  it('16. parent folder drag-to-trash uses subtree-aware prompt and deletes entire subtree', async () => {
    let capturedSortableOptions: any;
    const fakeSortable = {
      destroy: vi.fn(),
      option: vi.fn(),
    };
    createSortable.mockImplementation((_el: any, options: any) => {
      capturedSortableOptions = options;
      return fakeSortable;
    });

    const confirmSpy = vi.fn(async (_message?: string) => true);
    (window as any).poexdConfirm = confirmSpy;

    const execute = vi.fn(async () => true);
    const groups = ref([
      { id: 'f-parent', name: 'Parent', order: 0 },
      { id: 'f-child', name: 'Child', order: 0, parentId: 'f-parent' },
    ]);
    const bookmarks = ref([
      { id: 'b-1', name: 'B1', url: '...', groupId: 'f-parent', order: 0, createdAt: 1 },
      { id: 'b-2', name: 'B2', url: '...', groupId: 'f-child', order: 0, createdAt: 2 },
    ]);

    const container = document.createElement('div');
    container.className = 'bookmark-sortable-root';
    document.body.appendChild(container);

    const sortables = useBookmarkSortables({
      bookmarks,
      groups,
      listRenderKey: ref(0),
      trashZone: ref(null),
      isDragging: ref(false),
      isOverTrash: ref(true),
      enableDragScrollBlock: vi.fn(),
      disableDragScrollBlock: vi.fn(),
      showTrash: vi.fn(),
      hideTrash: vi.fn(),
      execute,
    } as any);

    await sortables.init();
    expect(capturedSortableOptions).toBeDefined();

    // Trigger onEnd over trash with f-parent
    capturedSortableOptions.onEnd({
      item: { getAttribute: (attr: string) => (attr === 'data-group-id' ? 'f-parent' : null) },
    });

    await vi.waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    expect(confirmSpy.mock.calls[0][0]).toContain('及其 1 個子資料夾');
    expect(confirmSpy.mock.calls[0][0]).toContain('2 個書籤');

    await vi.waitFor(() =>
      expect(execute).toHaveBeenCalledWith({
        type: 'delete-group',
        groupId: 'f-parent',
      }),
    );
  });

  it('17. cancelled trash drop does not trigger mutation and restores DOM', async () => {
    let capturedSortableOptions: any;
    const fakeSortable = {
      destroy: vi.fn(),
      option: vi.fn(),
    };
    createSortable.mockImplementation((_el: any, options: any) => {
      capturedSortableOptions = options;
      return fakeSortable;
    });

    const confirmSpy = vi.fn(async (_message?: string) => false); // User cancels
    (window as any).poexdConfirm = confirmSpy;

    const execute = vi.fn(async () => true);
    const groups = ref([{ id: 'f-parent', name: 'Parent', order: 0 }]);
    const bookmarks = ref([
      { id: 'b-1', name: 'B1', url: '...', groupId: 'f-parent', order: 0, createdAt: 1 },
    ]);

    const container = document.createElement('div');
    container.className = 'bookmark-sortable-root';
    document.body.appendChild(container);

    const sortables = useBookmarkSortables({
      bookmarks,
      groups,
      listRenderKey: ref(0),
      trashZone: ref(null),
      isDragging: ref(false),
      isOverTrash: ref(true),
      enableDragScrollBlock: vi.fn(),
      disableDragScrollBlock: vi.fn(),
      showTrash: vi.fn(),
      hideTrash: vi.fn(),
      execute,
    } as any);

    await sortables.init();
    capturedSortableOptions.onEnd({
      item: { getAttribute: (attr: string) => (attr === 'data-group-id' ? 'f-parent' : null) },
    });

    await vi.waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    expect(execute).not.toHaveBeenCalled();
  });

  it('18. pointerdown on .folder-drag-handle propagates to Sortable container while click is stopped from toggling collapse', async () => {
    const { createApp, defineComponent, h, ref } = await import('vue');
    const BookmarkFolderNode = (await import('@/components/sidebar/BookmarkFolderNode.vue'))
      .default;
    const { BOOKMARK_PANE_CONTEXT_KEY } = await import('@/components/sidebar/bookmark-tree');

    const toggleGroupCollapseSpy = vi.fn();
    const mockCtx = {
      activeTab: ref('bookmarks'),
      sidebarPosition: ref('right'),
      bookmarks: ref([]),
      groups: ref([{ id: 'folder-1', name: 'Test Folder', order: 0 }]),
      activeBookmarkId: ref(null),
      activePreviewData: ref(null),
      activeGroupMenuId: ref(null),
      activeBookmarkMenuId: ref(null),
      isMoveSubMenu: ref(false),
      isCoverSubMenu: ref(false),
      setGroupMenuOpen: vi.fn(),
      setBookmarkMenuOpen: vi.fn(),
      setMoveSubMenuOpen: vi.fn(),
      setCoverSubMenuOpen: vi.fn(),
      isGroupCollapsed: vi.fn(() => false),
      toggleGroupCollapse: toggleGroupCollapseSpy,
      editingGroupId: ref(null),
      editingGroupName: ref(''),
      editingBookmarkId: ref(null),
      editingBookmarkName: ref(''),
      isDragging: ref(false),
      addBookmarkBtnPosition: ref('top'),
      getFilteredGroupBookmarks: vi.fn(() => []),
      tradeLeagues: ref([]),
      isLeagueLoading: ref(false),
      leagueLoadError: ref(null),
    };

    const container = document.createElement('div');
    container.className = 'bookmark-sortable-root';
    document.body.appendChild(container);

    const receivedPointerDowns: Array<{ target: EventTarget | null; handleMatch: boolean }> = [];
    container.addEventListener('pointerdown', (e) => {
      receivedPointerDowns.push({
        target: e.target,
        handleMatch: Boolean((e.target as HTMLElement)?.closest?.('.folder-drag-handle')),
      });
    });

    const TestHarness = defineComponent({
      setup() {
        return () =>
          h(BookmarkFolderNode, {
            node: {
              folder: { id: 'folder-1', name: 'Test Folder', order: 0 },
              depth: 0,
            },
          });
      },
      provide: {
        [BOOKMARK_PANE_CONTEXT_KEY]: mockCtx,
      },
    });

    const app = createApp(TestHarness);
    const mountEl = document.createElement('div');
    container.appendChild(mountEl);
    app.mount(mountEl);

    const handleBtn = container.querySelector('.folder-drag-handle') as HTMLButtonElement;
    expect(handleBtn).not.toBeNull();

    // 1. Pointerdown on handle (or inside grip SVG) MUST propagate to container (Sortable initiation seam)
    const gripSvg = handleBtn.querySelector('svg');
    const targetToDispatch = gripSvg ?? handleBtn;
    const pointerDownEvent = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
    targetToDispatch.dispatchEvent(pointerDownEvent);

    expect(receivedPointerDowns).toHaveLength(1);
    expect(receivedPointerDowns[0].handleMatch).toBe(true);

    // 2. Click on drag grip MUST NOT toggle folder collapse (prevented by @click.stop)
    handleBtn.click();
    expect(toggleGroupCollapseSpy).not.toHaveBeenCalled();

    // 3. Regular click on header row (outside handle) DOES toggle folder collapse
    const headerRow = container.querySelector('.group-header-row') as HTMLElement;
    headerRow.click();
    expect(toggleGroupCollapseSpy).toHaveBeenCalledWith('folder-1');

    // 4. Pointerdown on other header parts reaches container but does NOT match drag handle
    const titleSpan = container.querySelector('.group-header-row span') as HTMLElement;
    titleSpan.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    expect(receivedPointerDowns).toHaveLength(2);
    expect(receivedPointerDowns[1].handleMatch).toBe(false);

    app.unmount();
    container.remove();
  }, 15000);

  it('19. resolveHitTestElement discovers target element inside Shadow Root instead of shadow host', () => {
    const host = document.createElement('div');
    host.id = 'poexd-sidebar-host';
    document.body.appendChild(host);

    const shadowRoot = host.attachShadow({ mode: 'open' });
    const container = document.createElement('div');
    container.className = 'bookmark-sortable-root';
    shadowRoot.appendChild(container);

    const targetHeader = document.createElement('div');
    targetHeader.className = 'group-header-row';
    container.appendChild(targetHeader);

    // Document-level hit-test returns the shadow host
    const originalDocElementFromPoint = document.elementFromPoint;
    document.elementFromPoint = vi.fn((_x: number, _y: number) => host);

    // ShadowRoot-level hit-test returns the internal header element
    const shadowHitTest = vi.fn((_x: number, _y: number) => targetHeader);
    (shadowRoot as any).elementFromPoint = shadowHitTest;

    // 1. When container is passed, getRootNode() accesses shadowRoot directly
    const result1 = resolveHitTestElement(container, 100, 100);
    expect(result1).toBe(targetHeader);
    expect(result1).not.toBe(host);
    expect(shadowHitTest).toHaveBeenCalledWith(100, 100);

    // 2. Fallback drill-down: when container is null, document.elementFromPoint hits host, and penetrates host.shadowRoot
    const result2 = resolveHitTestElement(null, 100, 100);
    expect(result2).toBe(targetHeader);
    expect(result2).not.toBe(host);

    // 3. Custom injection seam works as explicit override
    const customTarget = document.createElement('div');
    const result3 = resolveHitTestElement(container, 100, 100, () => customTarget);
    expect(result3).toBe(customTarget);

    document.elementFromPoint = originalDocElementFromPoint;
    host.remove();
  });

  it('20. Folder DnD in Shadow Root correctly resolves before/inside/after drop intent and executes move-folder mutation', async () => {
    let capturedSortableOptions: any;
    const fakeSortable = {
      destroy: vi.fn(),
      option: vi.fn(),
    };
    createSortable.mockImplementation((_el: any, options: any) => {
      capturedSortableOptions = options;
      return fakeSortable;
    });

    const host = document.createElement('div');
    host.id = 'poexd-sidebar-host';
    document.body.appendChild(host);

    const shadowRoot = host.attachShadow({ mode: 'open' });
    const container = document.createElement('div');
    container.className = 'bookmark-sortable-root';
    shadowRoot.appendChild(container);

    // Target folder DOM inside Shadow Root
    const targetFolderEl = document.createElement('div');
    targetFolderEl.className = 'group-container';
    targetFolderEl.setAttribute('data-group-id', 'folder-target');
    const targetHeader = document.createElement('div');
    targetHeader.className = 'group-header-row';
    targetFolderEl.appendChild(targetHeader);
    container.appendChild(targetFolderEl);

    // Dragged folder DOM inside Shadow Root
    const draggedFolderEl = document.createElement('div');
    draggedFolderEl.className = 'group-container';
    draggedFolderEl.setAttribute('data-group-id', 'folder-dragged');
    const draggedHeader = document.createElement('div');
    draggedHeader.className = 'group-header-row';
    draggedFolderEl.appendChild(draggedHeader);
    container.appendChild(draggedFolderEl);

    // Mock geometry on targetHeader: top = 100, height = 40 (bottom = 140)
    targetHeader.getBoundingClientRect = () =>
      ({
        top: 100,
        height: 40,
        bottom: 140,
        left: 0,
        right: 200,
        width: 200,
        x: 0,
        y: 100,
        toJSON: () => {},
      }) as any;

    // Simulate Chromium Shadow DOM hit-test
    (shadowRoot as any).elementFromPoint = vi.fn((_x: number, _y: number) => targetHeader);
    const originalDocElementFromPoint = document.elementFromPoint;
    document.elementFromPoint = vi.fn((_x: number, _y: number) => host);

    const execute = vi.fn(async () => true);
    const groups = ref([
      { id: 'folder-target', name: 'Target Folder', order: 0 },
      { id: 'folder-dragged', name: 'Dragged Folder', order: 1 },
    ]);
    const bookmarks = ref([]);

    const sortables = useBookmarkSortables({
      bookmarks,
      groups,
      listRenderKey: ref(0),
      trashZone: ref(null),
      isDragging: ref(false),
      isOverTrash: ref(false),
      enableDragScrollBlock: vi.fn(),
      disableDragScrollBlock: vi.fn(),
      showTrash: vi.fn(),
      hideTrash: vi.fn(),
      execute,
      containerRef: ref(container),
    } as any);

    await sortables.init();
    expect(capturedSortableOptions).toBeDefined();

    // 1. Start drag on draggedFolderEl
    capturedSortableOptions.onStart({
      item: draggedFolderEl,
    });

    // 2a. Pointermove at top of targetHeader: y = 105 -> ratio = 0.125 < 0.25 -> before
    window.dispatchEvent(
      new MouseEvent('pointermove', {
        clientX: 50,
        clientY: 105,
      }),
    );
    expect(targetHeader.classList.contains('drop-indicator-before')).toBe(true);

    // 2b. Pointermove at bottom of targetHeader: y = 135 -> ratio = 0.875 > 0.75 -> after
    window.dispatchEvent(
      new MouseEvent('pointermove', {
        clientX: 50,
        clientY: 135,
      }),
    );
    expect(targetHeader.classList.contains('drop-indicator-after')).toBe(true);

    // 2c. Pointermove with right horizontal offset (+30px, clientX = 80): indents to depth 1 -> inside
    window.dispatchEvent(
      new MouseEvent('pointermove', {
        clientX: 80,
        clientY: 120,
      }),
    );
    expect(targetHeader.classList.contains('drop-indicator-inside')).toBe(true);

    // 3. Drop ends -> onEnd commits atomic move-folder intent
    capturedSortableOptions.onEnd({
      item: draggedFolderEl,
    });

    await vi.waitFor(() =>
      expect(execute).toHaveBeenCalledWith({
        type: 'move-folder',
        folderId: 'folder-dragged',
        dropIntent: {
          targetFolderId: 'folder-target',
          position: 'inside',
        },
      }),
    );

    // Indicator must be cleared after drop
    expect(targetHeader.classList.contains('drop-indicator-inside')).toBe(false);

    document.elementFromPoint = originalDocElementFromPoint;
    host.remove();
  });

  it('21. horizontal drag offset drives projected depth and sets --drop-indicator-indent on header', async () => {
    let capturedSortableOptions: any;
    const fakeSortable = {
      destroy: vi.fn(),
      option: vi.fn(),
    };
    createSortable.mockImplementation((_el: any, options: any) => {
      capturedSortableOptions = options;
      return fakeSortable;
    });

    const container = document.createElement('div');
    container.className = 'bookmark-sortable-root';
    document.body.appendChild(container);

    const targetFolderEl = document.createElement('div');
    targetFolderEl.className = 'group-container';
    targetFolderEl.setAttribute('data-group-id', 'folder-target');
    const targetHeader = document.createElement('div');
    targetHeader.className = 'group-header-row';
    targetFolderEl.appendChild(targetHeader);
    container.appendChild(targetFolderEl);

    const draggedFolderEl = document.createElement('div');
    draggedFolderEl.className = 'group-container';
    draggedFolderEl.setAttribute('data-group-id', 'folder-dragged');
    const draggedHeader = document.createElement('div');
    draggedHeader.className = 'group-header-row';
    draggedFolderEl.appendChild(draggedHeader);
    container.appendChild(draggedFolderEl);

    targetHeader.getBoundingClientRect = () =>
      ({ top: 100, height: 40, bottom: 140, left: 0, right: 200, width: 200, x: 0, y: 100 }) as any;

    const originalDocElementFromPoint = document.elementFromPoint;
    document.elementFromPoint = vi.fn(() => targetHeader);

    const execute = vi.fn(async () => true);
    const groups = ref([
      { id: 'folder-target', gameVersion: 'poe1', name: 'Target', order: 0 },
      { id: 'folder-dragged', gameVersion: 'poe1', name: 'Dragged', order: 1 },
    ]);

    const sortables = useBookmarkSortables({
      bookmarks: ref([]),
      groups,
      listRenderKey: ref(0),
      trashZone: ref(null),
      isDragging: ref(false),
      isOverTrash: ref(false),
      enableDragScrollBlock: vi.fn(),
      disableDragScrollBlock: vi.fn(),
      showTrash: vi.fn(),
      hideTrash: vi.fn(),
      execute,
      containerRef: ref(container),
    } as any);

    await sortables.init();

    // Start drag with clientX = 100
    capturedSortableOptions.onStart({
      item: draggedFolderEl,
      originalEvent: { clientX: 100 } as any,
    });

    // 1. Drag below target (y = 135) with horizontal offset = 0 (clientX = 100) -> after, indent = 0px
    window.dispatchEvent(
      new MouseEvent('pointermove', {
        clientX: 100,
        clientY: 135,
      }),
    );
    expect(targetHeader.classList.contains('drop-indicator-after')).toBe(true);
    expect(targetHeader.style.getPropertyValue('--drop-indicator-indent')).toBe('0px');

    // 2. Drag to target inside surface (clientY = 120) -> expresses inside target
    window.dispatchEvent(
      new MouseEvent('pointermove', {
        clientX: 100,
        clientY: 120,
      }),
    );
    expect(targetHeader.classList.contains('drop-indicator-inside')).toBe(true);
    expect(targetFolderEl.classList.contains('drop-indicator-inside')).toBe(true);

    capturedSortableOptions.onEnd({
      item: draggedFolderEl,
    });

    await vi.waitFor(() =>
      expect(execute).toHaveBeenCalledWith({
        type: 'move-folder',
        folderId: 'folder-dragged',
        dropIntent: {
          targetFolderId: 'folder-target',
          position: 'inside',
        },
      }),
    );

    document.elementFromPoint = originalDocElementFromPoint;
    container.remove();
  });

  it('22. hovering on collapsed target triggers transient auto-expand without mutating storage preference or destroying Sortable', async () => {
    vi.useFakeTimers();
    let capturedSortableOptions: any;
    const destroySpy = vi.fn();
    const fakeSortable = {
      destroy: destroySpy,
      option: vi.fn(),
    };
    createSortable.mockImplementation((_el: any, options: any) => {
      capturedSortableOptions = options;
      return fakeSortable;
    });

    const storageStore: Record<string, any> = {
      poexdBookmarkCollapsedGroups: ['folder-target'],
    };
    (globalThis as any).chrome = {
      storage: {
        local: {
          get: vi.fn(async (keys: string[]) => {
            const res: Record<string, any> = {};
            for (const k of keys) if (k in storageStore) res[k] = storageStore[k];
            return res;
          }),
          set: vi.fn(async (items: Record<string, any>) => {
            Object.assign(storageStore, items);
          }),
        },
      },
    };

    const container = document.createElement('div');
    container.className = 'bookmark-sortable-root';
    document.body.appendChild(container);

    const targetFolderEl = document.createElement('div');
    targetFolderEl.className = 'group-container';
    targetFolderEl.setAttribute('data-group-id', 'folder-target');
    const targetHeader = document.createElement('div');
    targetHeader.className = 'group-header-row';
    targetFolderEl.appendChild(targetHeader);
    container.appendChild(targetFolderEl);

    const draggedFolderEl = document.createElement('div');
    draggedFolderEl.className = 'group-container';
    draggedFolderEl.setAttribute('data-group-id', 'folder-dragged');
    container.appendChild(draggedFolderEl);

    targetHeader.getBoundingClientRect = () =>
      ({ top: 100, height: 40, bottom: 140, left: 0, right: 200, width: 200, x: 0, y: 100 }) as any;

    document.elementFromPoint = vi.fn(() => targetHeader);

    const groups = ref([
      { id: 'folder-target', name: 'Target', order: 0 },
      { id: 'folder-dragged', name: 'Dragged', order: 1 },
    ]);

    const { useBookmarkCollapse } =
      await import('@/components/sidebar/composables/useBookmarkCollapse');
    const collapse = useBookmarkCollapse({
      groups,
      searchQuery: ref(''),
      storageKey: 'poexdBookmarkCollapsedGroups',
    });
    await collapse.loadCollapsedGroups();

    // 初始狀態：folder-target 是收合的
    expect(collapse.isGroupCollapsed('folder-target')).toBe(true);

    const transientExpandedFolderIds = ref<Set<string>>(new Set());
    const isGroupCollapsed = (id: string) => {
      if (transientExpandedFolderIds.value.has(id)) return false;
      return collapse.isGroupCollapsed(id);
    };

    const sortables = useBookmarkSortables({
      bookmarks: ref([]),
      groups,
      listRenderKey: ref(0),
      trashZone: ref(null),
      isDragging: ref(false),
      isOverTrash: ref(false),
      enableDragScrollBlock: vi.fn(),
      disableDragScrollBlock: vi.fn(),
      showTrash: vi.fn(),
      hideTrash: vi.fn(),
      execute: vi.fn(),
      containerRef: ref(container),
      collapsedGroupIds: collapse.collapsedGroupIds,
      transientExpandedFolderIds,
    } as any);

    await sortables.init();

    capturedSortableOptions.onStart({
      item: draggedFolderEl,
      originalEvent: { clientX: 100 } as any,
    });

    // 懸停在 folder-target 中央 inside surface (clientY = 120)
    window.dispatchEvent(
      new MouseEvent('pointermove', {
        clientX: 100,
        clientY: 120,
      }),
    );

    expect(isGroupCollapsed('folder-target')).toBe(true);

    // 400ms 後仍未展開
    vi.advanceTimersByTime(400);
    expect(isGroupCollapsed('folder-target')).toBe(true);

    // 滿 500ms 觸發 transient auto-expand！
    vi.advanceTimersByTime(100);
    // 1. 500ms hover 可顯示 collapsed target 內容
    expect(isGroupCollapsed('folder-target')).toBe(false);

    // 2. storage preference 不改變
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
    expect(storageStore.poexdBookmarkCollapsedGroups).toEqual(['folder-target']);

    // 3. active Sortable 絕不被 destroy / re-init
    expect(destroySpy).not.toHaveBeenCalled();

    // 4. drag 結束後，transient expansion 清空，原始 collapse preference 仍一致
    capturedSortableOptions.onEnd({ item: draggedFolderEl });
    expect(isGroupCollapsed('folder-target')).toBe(true);
    expect(collapse.isGroupCollapsed('folder-target')).toBe(true);

    container.remove();
    vi.useRealTimers();
  });

  it('23. dragging-subtree-origin class is applied to dragged item on start and removed on end without collapsing body', async () => {
    let capturedSortableOptions: any;
    createSortable.mockImplementation((_el: any, options: any) => {
      capturedSortableOptions = options;
      return { destroy: vi.fn(), option: vi.fn() };
    });

    const container = document.createElement('div');
    container.className = 'bookmark-sortable-root';
    document.body.appendChild(container);

    const draggedFolderEl = document.createElement('div');
    draggedFolderEl.className = 'group-container';
    draggedFolderEl.setAttribute('data-group-id', 'folder-dragged');
    const bodyEl = document.createElement('div');
    bodyEl.className = 'group-body';
    draggedFolderEl.appendChild(bodyEl);
    container.appendChild(draggedFolderEl);

    const sortables = useBookmarkSortables({
      bookmarks: ref([]),
      groups: ref([{ id: 'folder-dragged', name: 'Dragged', order: 0 }]),
      listRenderKey: ref(0),
      trashZone: ref(null),
      isDragging: ref(false),
      isOverTrash: ref(false),
      enableDragScrollBlock: vi.fn(),
      disableDragScrollBlock: vi.fn(),
      showTrash: vi.fn(),
      hideTrash: vi.fn(),
      execute: vi.fn(),
      containerRef: ref(container),
    } as any);

    await sortables.init();

    expect(draggedFolderEl.classList.contains('dragging-subtree-origin')).toBe(false);
    expect(draggedFolderEl.classList.contains('dragging-parent-collapsed')).toBe(false);

    capturedSortableOptions.onStart({ item: draggedFolderEl });
    expect(draggedFolderEl.classList.contains('dragging-subtree-origin')).toBe(true);
    expect(draggedFolderEl.classList.contains('dragging-parent-collapsed')).toBe(false);
    // Body is NOT hidden
    expect(bodyEl.style.display).not.toBe('none');

    capturedSortableOptions.onEnd({ item: draggedFolderEl });
    expect(draggedFolderEl.classList.contains('dragging-subtree-origin')).toBe(false);

    container.remove();
  });

  it('24. resolveTreeIndentationWidth uses rendered left difference when flat parent/child sibling DOM exists', () => {
    const container = document.createElement('div');
    container.className = 'bookmark-sortable-root';
    document.body.appendChild(container);

    const parentFolderEl = document.createElement('div');
    parentFolderEl.className = 'group-container';
    parentFolderEl.setAttribute('data-group-id', 'parent-1');
    parentFolderEl.setAttribute('data-depth', '0');

    const childFolderEl = document.createElement('div');
    childFolderEl.className = 'group-container';
    childFolderEl.setAttribute('data-group-id', 'child-1');
    childFolderEl.setAttribute('data-depth', '1');

    container.appendChild(parentFolderEl);
    container.appendChild(childFolderEl);

    parentFolderEl.getBoundingClientRect = () =>
      ({ left: 10, top: 0, right: 300, bottom: 200, width: 290, height: 200, x: 10, y: 0 }) as any;
    childFolderEl.getBoundingClientRect = () =>
      ({ left: 34, top: 40, right: 300, bottom: 100, width: 266, height: 60, x: 34, y: 40 }) as any;

    const width = resolveTreeIndentationWidth(container);
    // 34 - 10 = 24px
    expect(width).toBe(24);

    container.remove();
  });

  it('25. resolveTreeIndentationWidth resolves full nesting step (lg + md) from runtime tokens when only root folders exist', () => {
    const container = document.createElement('div');
    container.className = 'bookmark-sortable-root';
    container.style.setProperty('--pxd-space-lg', '12px');
    container.style.setProperty('--pxd-space-md', '8px');
    document.body.appendChild(container);

    const rootFolderEl = document.createElement('div');
    rootFolderEl.className = 'group-container';
    rootFolderEl.setAttribute('data-group-id', 'root-1');
    rootFolderEl.setAttribute('data-depth', '0');

    const rootBody = document.createElement('div');
    rootBody.className = 'group-body';
    rootFolderEl.appendChild(rootBody);
    container.appendChild(rootFolderEl);

    // .folder-children-list 不存在於 DOM 中
    expect(container.querySelector('.folder-children-list')).toBeNull();

    const width = resolveTreeIndentationWidth(container);
    // 必須取得完整 nesting step 12 + 8 = 20px
    expect(width).toBe(20);

    container.remove();
  });

  it('26. resolveTreeIndentationWidth matches UI nesting step under different runtime scale and density tokens', () => {
    const container = document.createElement('div');
    container.className = 'bookmark-sortable-root';
    document.body.appendChild(container);

    // 1. 預設基準 (Scale 1.0, 12px + 8px = 20px)
    container.style.setProperty('--pxd-space-lg', '12px');
    container.style.setProperty('--pxd-space-md', '8px');
    expect(resolveTreeIndentationWidth(container)).toBe(20);

    // 2. 放大 Scale (例如 Scale 1.2, 14.4px + 9.6px = 24px)
    container.style.setProperty('--pxd-space-lg', '14.4px');
    container.style.setProperty('--pxd-space-md', '9.6px');
    expect(resolveTreeIndentationWidth(container)).toBe(24);

    // 3. 即使只有 root folders，Scale 1.2 下依然正確取得 24px
    const rootFolderEl = document.createElement('div');
    rootFolderEl.className = 'group-container';
    rootFolderEl.setAttribute('data-depth', '0');
    container.appendChild(rootFolderEl);

    expect(resolveTreeIndentationWidth(container)).toBe(24);

    container.remove();
  });

  it('27. Folder Sortable disables realtime DOM sorting (sort: false, onMove: false), preserves sibling DOM order while pointer moves across multiple folders, and executes move-folder on drop', async () => {
    let capturedSortableOptions: any;
    const fakeSortable = { destroy: vi.fn(), option: vi.fn() };
    createSortable.mockImplementation((_el: any, options: any) => {
      capturedSortableOptions = options;
      return fakeSortable;
    });

    const container = document.createElement('div');
    container.className = 'bookmark-sortable-root';
    document.body.appendChild(container);

    const makeFolder = (id: string, top: number) => {
      const folderEl = document.createElement('div');
      folderEl.className = 'group-container';
      folderEl.setAttribute('data-group-id', id);
      folderEl.setAttribute('data-depth', '0');

      const header = document.createElement('div');
      header.className = 'group-header-row';
      header.getBoundingClientRect = () =>
        ({
          top,
          height: 40,
          bottom: top + 40,
          left: 0,
          right: 200,
          width: 200,
          x: 0,
          y: top,
          toJSON: () => {},
        }) as any;
      folderEl.appendChild(header);
      return { folderEl, header };
    };

    const fA = makeFolder('f-a', 100);
    const fB = makeFolder('f-b', 150);
    const fC = makeFolder('f-c', 200);

    container.appendChild(fA.folderEl);
    container.appendChild(fB.folderEl);
    container.appendChild(fC.folderEl);

    let hitElement: Element | null = null;
    const customElementFromPoint = vi.fn(() => hitElement);

    const execute = vi.fn(async () => true);
    const groups = ref([
      { id: 'f-a', name: 'Folder A', order: 0 },
      { id: 'f-b', name: 'Folder B', order: 1 },
      { id: 'f-c', name: 'Folder C', order: 2 },
    ]);

    const sortables = useBookmarkSortables({
      bookmarks: ref([]),
      groups,
      listRenderKey: ref(0),
      trashZone: ref(null),
      isDragging: ref(false),
      isOverTrash: ref(false),
      enableDragScrollBlock: vi.fn(),
      disableDragScrollBlock: vi.fn(),
      showTrash: vi.fn(),
      hideTrash: vi.fn(),
      execute,
      containerRef: ref(container),
      elementFromPoint: customElementFromPoint,
    } as any);

    await sortables.init();

    // 1. Sortable responsibility guard: Folder Sortable must strictly disable realtime DOM reordering
    expect(capturedSortableOptions.sort).toBe(false);
    expect(typeof capturedSortableOptions.onMove).toBe('function');
    expect(capturedSortableOptions.onMove()).toBe(false);

    // Initial DOM order check: A -> B -> C
    const getDomOrder = () =>
      Array.from(container.children).map((el) => el.getAttribute('data-group-id'));
    expect(getDomOrder()).toEqual(['f-a', 'f-b', 'f-c']);

    // 2. Start drag on Folder C
    capturedSortableOptions.onStart({
      item: fC.folderEl,
      originalEvent: { clientX: 50 },
    });

    // 3. Move pointer over Folder A header
    hitElement = fA.header;
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 50, clientY: 110 })); // ratio = 0.25 (before A)

    // DOM order must remain completely static: no DOM swaps during drag!
    expect(getDomOrder()).toEqual(['f-a', 'f-b', 'f-c']);
    expect(fA.header.classList.contains('drop-indicator-before')).toBe(true);

    // 4. Move pointer over Folder B header
    hitElement = fB.header;
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 50, clientY: 180 })); // ratio = 0.75 (after B)

    // DOM order still completely static!
    expect(getDomOrder()).toEqual(['f-a', 'f-b', 'f-c']);
    expect(fA.header.classList.contains('drop-indicator-before')).toBe(false);
    expect(fB.header.classList.contains('drop-indicator-after')).toBe(true);

    // 5. Move pointer to Folder B inside surface (clientY: 170) -> inside B
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 50, clientY: 170 }));
    expect(getDomOrder()).toEqual(['f-a', 'f-b', 'f-c']);
    expect(fB.header.classList.contains('drop-indicator-inside')).toBe(true);
    expect(fB.folderEl.classList.contains('drop-indicator-inside')).toBe(true);

    // 6. Drop (onEnd): execute single atomic move-folder based on finalDropIntent
    capturedSortableOptions.onEnd({
      item: fC.folderEl,
    });

    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'move-folder',
          folderId: 'f-c',
          dropIntent: expect.objectContaining({
            targetFolderId: 'f-b',
          }),
        }),
      );
    });

    // Indicators cleaned up
    expect(fB.header.classList.contains('drop-indicator-after')).toBe(false);

    container.remove();
  });

  it('28. Folder drag cancellation or invalid target does not execute mutation and preserves canonical order', async () => {
    let capturedSortableOptions: any;
    createSortable.mockImplementation((_el: any, options: any) => {
      capturedSortableOptions = options;
      return { destroy: vi.fn(), option: vi.fn() };
    });

    const container = document.createElement('div');
    container.className = 'bookmark-sortable-root';
    document.body.appendChild(container);

    const folderA = document.createElement('div');
    folderA.className = 'group-container';
    folderA.setAttribute('data-group-id', 'f-a');
    container.appendChild(folderA);

    const execute = vi.fn(async () => true);
    const groups = ref([{ id: 'f-a', name: 'Folder A', order: 0 }]);

    const sortables = useBookmarkSortables({
      bookmarks: ref([]),
      groups,
      listRenderKey: ref(0),
      trashZone: ref(null),
      isDragging: ref(false),
      isOverTrash: ref(false),
      enableDragScrollBlock: vi.fn(),
      disableDragScrollBlock: vi.fn(),
      showTrash: vi.fn(),
      hideTrash: vi.fn(),
      execute,
      containerRef: ref(container),
      elementFromPoint: () => null, // No target element hit
    } as any);

    await sortables.init();

    capturedSortableOptions.onStart({
      item: folderA,
      originalEvent: { clientX: 50 },
    });

    // Move pointer outside any folder header
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 0, clientY: 0 }));

    // Drop
    capturedSortableOptions.onEnd({
      item: folderA,
    });

    await new Promise((r) => setTimeout(r, 20));

    // Zero mutations executed on cancel / invalid target
    expect(execute).not.toHaveBeenCalled();

    container.remove();
  });

  it('29. Parent subtree drag marks descendants via dragging-subtree-descendant preserving layout footprint without display:none, and restores upon drop', async () => {
    let capturedSortableOptions: any;
    createSortable.mockImplementation((_el: any, options: any) => {
      capturedSortableOptions = options;
      return { destroy: vi.fn(), option: vi.fn() };
    });

    const container = document.createElement('div');
    container.className = 'bookmark-sortable-root';
    document.body.appendChild(container);

    const makeRow = (id: string, depth = 0) => {
      const el = document.createElement('div');
      el.className = 'group-container';
      el.setAttribute('data-group-id', id);
      el.setAttribute('data-depth', String(depth));
      const header = document.createElement('div');
      header.className = 'group-header-row';
      header.getBoundingClientRect = () =>
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
      el.appendChild(header);
      return { el, header };
    };

    const parentP = makeRow('f-p', 0);
    const childP1 = makeRow('f-p1', 1);
    const siblingS = makeRow('f-s', 0);

    container.appendChild(parentP.el);
    container.appendChild(childP1.el);
    container.appendChild(siblingS.el);

    const execute = vi.fn(async () => true);
    const groups = ref([
      { id: 'f-p', name: 'Parent', order: 0 },
      { id: 'f-p1', name: 'Child 1', order: 0, parentId: 'f-p' },
      { id: 'f-s', name: 'Sibling S', order: 1 },
    ]);

    const sortables = useBookmarkSortables({
      bookmarks: ref([]),
      groups,
      listRenderKey: ref(0),
      trashZone: ref(null),
      isDragging: ref(false),
      isOverTrash: ref(false),
      enableDragScrollBlock: vi.fn(),
      disableDragScrollBlock: vi.fn(),
      showTrash: vi.fn(),
      hideTrash: vi.fn(),
      execute,
      containerRef: ref(container),
    } as any);

    await sortables.init();

    // Start drag on Parent P
    capturedSortableOptions.onStart({
      item: parentP.el,
      originalEvent: { clientX: 50 },
    });

    // Parent has subtree origin class
    expect(parentP.el.classList.contains('dragging-subtree-origin')).toBe(true);
    expect(parentP.el.classList.contains('dragging-parent-collapsed')).toBe(false);

    // Descendant P1 has descendant visual class and retains layout footprint (NOT display:none)
    expect(childP1.el.classList.contains('dragging-subtree-descendant')).toBe(true);
    expect(childP1.el.classList.contains('dragging-descendant-hidden')).toBe(false);
    expect(childP1.el.style.display).not.toBe('none');

    // Sibling S is NOT marked and does not change DOM position
    expect(siblingS.el.classList.contains('dragging-subtree-descendant')).toBe(false);
    expect(Array.from(container.children).map((c) => c.getAttribute('data-group-id'))).toEqual([
      'f-p',
      'f-p1',
      'f-s',
    ]);

    // Drop
    capturedSortableOptions.onEnd({
      item: parentP.el,
    });

    // Transient classes restored on drop
    expect(parentP.el.classList.contains('dragging-subtree-origin')).toBe(false);
    expect(childP1.el.classList.contains('dragging-subtree-descendant')).toBe(false);

    container.remove();
  });

  it('30. Folder drop affordance: before (top edge), inside (center / direct-bookmark body), after (bottom edge), and reject self/descendant', async () => {
    let capturedSortableOptions: any;
    createSortable.mockImplementation((_el: any, options: any) => {
      capturedSortableOptions = options;
      return { destroy: vi.fn(), option: vi.fn() };
    });

    const container = document.createElement('div');
    container.className = 'bookmark-sortable-root';
    document.body.appendChild(container);

    const makeFolder = (id: string, top: number, height = 40, depth = 0) => {
      const folderEl = document.createElement('div');
      folderEl.className = 'group-container';
      folderEl.setAttribute('data-group-id', id);
      folderEl.setAttribute('data-depth', String(depth));
      folderEl.getBoundingClientRect = () =>
        ({
          top,
          height,
          bottom: top + height,
          left: 0,
          right: 200,
          width: 200,
          x: 0,
          y: top,
        }) as any;

      const header = document.createElement('div');
      header.className = 'group-header-row';
      header.getBoundingClientRect = () =>
        ({
          top,
          height: 40,
          bottom: top + 40,
          left: 0,
          right: 200,
          width: 200,
          x: 0,
          y: top,
        }) as any;
      folderEl.appendChild(header);

      const body = document.createElement('div');
      body.className = 'group-body';
      const bm = document.createElement('div');
      bm.className = 'bookmark-row-item';
      body.appendChild(bm);
      folderEl.appendChild(body);

      return { folderEl, header, body, bm };
    };

    // Expanded Folder A (top: 100, height: 120 [header 40 + body 80], bottom: 220)
    const fA = makeFolder('f-a', 100, 120, 0);
    // Collapsed Folder B (top: 230, height: 40, bottom: 270)
    const fB = makeFolder('f-b', 230, 40, 0);
    // Dragged Folder C (top: 280, height: 40, bottom: 320)
    const fC = makeFolder('f-c', 280, 40, 0);
    // Descendant of C (f-c1)
    const fC1 = makeFolder('f-c1', 330, 40, 1);

    container.appendChild(fA.folderEl);
    container.appendChild(fB.folderEl);
    container.appendChild(fC.folderEl);
    container.appendChild(fC1.folderEl);

    let hitElement: Element | null = null;
    const execute = vi.fn(async () => true);
    const groups = ref([
      { id: 'f-a', name: 'Folder A', order: 0 },
      { id: 'f-b', name: 'Folder B', order: 1 },
      { id: 'f-c', name: 'Folder C', order: 2 },
      { id: 'f-c1', name: 'Child of C', order: 0, parentId: 'f-c' },
    ]);

    const sortables = useBookmarkSortables({
      bookmarks: ref([]),
      groups,
      listRenderKey: ref(0),
      trashZone: ref(null),
      isDragging: ref(false),
      isOverTrash: ref(false),
      enableDragScrollBlock: vi.fn(),
      disableDragScrollBlock: vi.fn(),
      showTrash: vi.fn(),
      hideTrash: vi.fn(),
      execute,
      containerRef: ref(container),
      elementFromPoint: () => hitElement,
    } as any);

    await sortables.init();

    // Start drag on Folder C
    capturedSortableOptions.onStart({
      item: fC.folderEl,
      originalEvent: { clientX: 50 },
    });

    // 1. Top edge of Expanded Folder A: y = 105 (within 10px of top 100) -> before
    hitElement = fA.header;
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 50, clientY: 105 }));
    expect(fA.header.classList.contains('drop-indicator-before')).toBe(true);
    expect(fA.folderEl.classList.contains('drop-indicator-before')).toBe(true);

    // 2. Direct-bookmark body of Expanded Folder A: pointer on bm element at y = 160 -> inside
    hitElement = fA.bm;
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 50, clientY: 160 }));
    expect(fA.header.classList.contains('drop-indicator-before')).toBe(false);
    expect(fA.header.classList.contains('drop-indicator-inside')).toBe(true);
    expect(fA.folderEl.classList.contains('drop-indicator-inside')).toBe(true);

    // 3. Bottom edge of Expanded Folder A: y = 215 (within 10px of bottom 220) -> after
    hitElement = fA.body;
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 50, clientY: 215 }));
    expect(fA.header.classList.contains('drop-indicator-inside')).toBe(false);
    expect(fA.header.classList.contains('drop-indicator-after')).toBe(true);
    expect(fA.folderEl.classList.contains('drop-indicator-after')).toBe(true);

    // 4. Center of Collapsed Folder B: y = 250 (middle of 230~270) -> inside
    hitElement = fB.header;
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 50, clientY: 250 }));
    expect(fA.folderEl.classList.contains('drop-indicator-after')).toBe(false);
    expect(fB.header.classList.contains('drop-indicator-inside')).toBe(true);
    expect(fB.folderEl.classList.contains('drop-indicator-inside')).toBe(true);

    // 5. Dragged folder self (fC): hovering over self clears indicator and rejects
    hitElement = fC.header;
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 50, clientY: 300 }));
    expect(fB.header.classList.contains('drop-indicator-inside')).toBe(false);
    expect(fB.folderEl.classList.contains('drop-indicator-inside')).toBe(false);
    expect(fC.header.classList.contains('drop-indicator-inside')).toBe(false);

    // 6. Descendant of dragged folder (fC1): hovering over descendant clears indicator and rejects
    hitElement = fC1.header;
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 50, clientY: 340 }));
    expect(fC1.header.classList.contains('drop-indicator-inside')).toBe(false);
    expect(fC1.folderEl.classList.contains('drop-indicator-inside')).toBe(false);

    // Drop while on invalid target -> 0 mutations
    capturedSortableOptions.onEnd({ item: fC.folderEl });
    expect(execute).not.toHaveBeenCalled();

    container.remove();
  });

  it('31. Horizontal projection on before/after edge zones supports outdenting to ancestor, and commit matches visual indicator', async () => {
    let capturedSortableOptions: any;
    createSortable.mockImplementation((_el: any, options: any) => {
      capturedSortableOptions = options;
      return { destroy: vi.fn(), option: vi.fn() };
    });

    const container = document.createElement('div');
    container.className = 'bookmark-sortable-root';
    document.body.appendChild(container);

    const makeFolder = (id: string, top: number, depth = 0) => {
      const folderEl = document.createElement('div');
      folderEl.className = 'group-container';
      folderEl.setAttribute('data-group-id', id);
      folderEl.setAttribute('data-depth', String(depth));
      folderEl.getBoundingClientRect = () =>
        ({
          top,
          height: 40,
          bottom: top + 40,
          left: depth * 20,
          right: 200,
          width: 200,
          x: depth * 20,
          y: top,
        }) as any;

      const header = document.createElement('div');
      header.className = 'group-header-row';
      header.getBoundingClientRect = () =>
        ({
          top,
          height: 40,
          bottom: top + 40,
          left: depth * 20,
          right: 200,
          width: 200,
          x: depth * 20,
          y: top,
        }) as any;
      folderEl.appendChild(header);
      return { folderEl, header };
    };

    // Parent A (depth 0)
    const pA = makeFolder('p-a', 100, 0);
    // Child A1 (depth 1, parent: p-a)
    const cA1 = makeFolder('c-a1', 150, 1);
    // Child A2 (depth 1, parent: p-a)
    const cA2 = makeFolder('c-a2', 200, 1);
    // Dragged Folder D (depth 1, initially under p-a)
    const fD = makeFolder('f-d', 250, 1);

    container.appendChild(pA.folderEl);
    container.appendChild(cA1.folderEl);
    container.appendChild(cA2.folderEl);
    container.appendChild(fD.folderEl);

    let hitElement: Element | null = null;
    const execute = vi.fn(async () => true);
    const groups = ref([
      { id: 'p-a', name: 'Parent A', order: 0 },
      { id: 'c-a1', name: 'Child A1', order: 0, parentId: 'p-a' },
      { id: 'c-a2', name: 'Child A2', order: 1, parentId: 'p-a' },
      { id: 'f-d', name: 'Folder D', order: 2, parentId: 'p-a' },
    ]);

    const sortables = useBookmarkSortables({
      bookmarks: ref([]),
      groups,
      listRenderKey: ref(0),
      trashZone: ref(null),
      isDragging: ref(false),
      isOverTrash: ref(false),
      enableDragScrollBlock: vi.fn(),
      disableDragScrollBlock: vi.fn(),
      showTrash: vi.fn(),
      hideTrash: vi.fn(),
      execute,
      containerRef: ref(container),
      elementFromPoint: () => hitElement,
    } as any);

    await sortables.init();

    // Start drag on fD (depth 1, startX = 100)
    capturedSortableOptions.onStart({
      item: fD.folderEl,
      originalEvent: { clientX: 100 },
    });

    // 1. Move to bottom edge of cA1 (y = 188) with offset = 0 (clientX = 100) -> after cA1 (depth 1)
    hitElement = cA1.header;
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 100, clientY: 188 }));
    expect(cA1.header.classList.contains('drop-indicator-after')).toBe(true);
    expect(cA1.header.style.getPropertyValue('--drop-indicator-indent')).toBe('0px');

    // 2. Drag left by -35px (clientX = 65) -> outdents to depth 0 -> after p-a (slot moves to p-a's last visible descendant cA2)
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 65, clientY: 188 }));
    expect(cA1.header.classList.contains('drop-indicator-after')).toBe(false);
    expect(cA2.header.classList.contains('drop-indicator-after')).toBe(true);
    expect(cA2.folderEl.classList.contains('drop-indicator-after')).toBe(true);
    // Indent is relative to cA2 (depth 1), so outdenting to depth 0 gives -20px
    expect(cA2.header.style.getPropertyValue('--drop-indicator-indent')).toBe('-20px');
    expect(cA2.folderEl.style.getPropertyValue('--drop-indicator-indent')).toBe('-20px');

    // 3. Drop: executes move-folder matching the indicator (after p-a at root level)
    capturedSortableOptions.onEnd({ item: fD.folderEl });

    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'move-folder',
          folderId: 'f-d',
          dropIntent: expect.objectContaining({
            targetFolderId: 'p-a',
            position: 'after',
          }),
        }),
      );
    });

    container.remove();
  });

  it('32. Folder DOM remains 100% static during drag, and Bookmark Sortable (.bookmark-list-wrapper) is unaffected', async () => {
    let capturedFolderSortableOptions: any;
    let capturedBookmarkSortableOptions: any;

    createSortable.mockImplementation((el: any, options: any) => {
      if (el.classList?.contains('bookmark-sortable-root')) {
        capturedFolderSortableOptions = options;
      } else {
        capturedBookmarkSortableOptions = options;
      }
      return { destroy: vi.fn(), option: vi.fn() };
    });

    const container = document.createElement('div');
    container.className = 'bookmark-sortable-root';
    document.body.appendChild(container);

    const f1 = document.createElement('div');
    f1.className = 'group-container';
    f1.setAttribute('data-group-id', 'f-1');
    const f1Header = document.createElement('div');
    f1Header.className = 'group-header-row';
    f1Header.getBoundingClientRect = () =>
      ({ top: 100, height: 40, bottom: 140, left: 0, right: 200, width: 200, x: 0, y: 100 }) as any;
    f1.appendChild(f1Header);

    const f1List = document.createElement('div');
    f1List.className = 'bookmark-list-wrapper';
    f1.appendChild(f1List);

    const f2 = document.createElement('div');
    f2.className = 'group-container';
    f2.setAttribute('data-group-id', 'f-2');
    const f2Header = document.createElement('div');
    f2Header.className = 'group-header-row';
    f2Header.getBoundingClientRect = () =>
      ({ top: 150, height: 40, bottom: 190, left: 0, right: 200, width: 200, x: 0, y: 150 }) as any;
    f2.appendChild(f2Header);

    container.appendChild(f1);
    container.appendChild(f2);

    const execute = vi.fn(async () => true);
    const groups = ref([
      { id: 'f-1', name: 'Folder 1', order: 0 },
      { id: 'f-2', name: 'Folder 2', order: 1 },
    ]);
    const bookmarks = ref([{ id: 'b-1', name: 'BM 1', groupId: 'f-1', order: 0 }]);

    const sortables = useBookmarkSortables({
      bookmarks,
      groups,
      listRenderKey: ref(0),
      trashZone: ref(null),
      isDragging: ref(false),
      isOverTrash: ref(false),
      enableDragScrollBlock: vi.fn(),
      disableDragScrollBlock: vi.fn(),
      showTrash: vi.fn(),
      hideTrash: vi.fn(),
      execute,
      containerRef: ref(container),
      elementFromPoint: () => f1Header,
    } as any);

    await sortables.init();

    // 1. Folder Sortable contract: static DOM sorting
    expect(capturedFolderSortableOptions.sort).toBe(false);
    expect(capturedFolderSortableOptions.onMove()).toBe(false);

    // 2. Bookmark Sortable contract: sort is NOT disabled (remains interactive)
    expect(capturedBookmarkSortableOptions).toBeDefined();
    expect(capturedBookmarkSortableOptions.sort).not.toBe(false);

    // 3. Start drag on f2, move over f1 -> DOM order is completely static
    capturedFolderSortableOptions.onStart({
      item: f2,
      originalEvent: { clientX: 50 },
    });

    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 50, clientY: 105 }));
    expect(Array.from(container.children).map((el) => el.getAttribute('data-group-id'))).toEqual([
      'f-1',
      'f-2',
    ]);

    capturedFolderSortableOptions.onEnd({ item: f2 });
    expect(Array.from(container.children).map((el) => el.getAttribute('data-group-id'))).toEqual([
      'f-1',
      'f-2',
    ]);

    container.remove();
  });

  it('33. Layout stability regression: drag start preserves folder card height, bookmark body visibility, and descendant footprint without vertical jumps', async () => {
    let capturedFolderSortableOptions: any;
    createSortable.mockImplementation((el: any, options: any) => {
      if (el?.classList?.contains('bookmark-sortable-root')) {
        capturedFolderSortableOptions = options;
      }
      return { destroy: vi.fn(), option: vi.fn() };
    });

    const container = document.createElement('div');
    container.className = 'bookmark-sortable-root';
    document.body.appendChild(container);

    const fParent = document.createElement('div');
    fParent.className = 'group-container';
    fParent.setAttribute('data-group-id', 'f-parent');
    fParent.setAttribute('data-depth', '0');
    const fParentHeader = document.createElement('div');
    fParentHeader.className = 'group-header-row';
    const fParentBody = document.createElement('div');
    fParentBody.className = 'group-body';
    fParent.appendChild(fParentHeader);
    fParent.appendChild(fParentBody);

    const fChild = document.createElement('div');
    fChild.className = 'group-container';
    fChild.setAttribute('data-group-id', 'f-child');
    fChild.setAttribute('data-depth', '1');
    const fChildHeader = document.createElement('div');
    fChildHeader.className = 'group-header-row';
    fChild.appendChild(fChildHeader);

    const fOther = document.createElement('div');
    fOther.className = 'group-container';
    fOther.setAttribute('data-group-id', 'f-other');
    fOther.setAttribute('data-depth', '0');
    const fOtherHeader = document.createElement('div');
    fOtherHeader.className = 'group-header-row';
    fOther.appendChild(fOtherHeader);

    container.appendChild(fParent);
    container.appendChild(fChild);
    container.appendChild(fOther);

    let activeHitElement: HTMLElement = fOtherHeader;
    const execute = vi.fn(async () => true);
    const groups = ref([
      { id: 'f-parent', name: 'Parent', order: 0 },
      { id: 'f-child', name: 'Child', order: 0, parentId: 'f-parent' },
      { id: 'f-other', name: 'Other', order: 1 },
    ]);

    const sortables = useBookmarkSortables({
      bookmarks: ref([{ id: 'b-1', name: 'BM 1', groupId: 'f-parent', order: 0 }]),
      groups,
      listRenderKey: ref(0),
      trashZone: ref(null),
      isDragging: ref(false),
      isOverTrash: ref(false),
      enableDragScrollBlock: vi.fn(),
      disableDragScrollBlock: vi.fn(),
      showTrash: vi.fn(),
      hideTrash: vi.fn(),
      execute,
      containerRef: ref(container),
      elementFromPoint: () => activeHitElement,
    } as any);

    await sortables.init();

    // 1. Before drag: check initial display and styles
    expect(fParent.style.display).not.toBe('none');
    expect(fParentBody.style.display).not.toBe('none');
    expect(fChild.style.display).not.toBe('none');
    expect(fOther.style.display).not.toBe('none');

    // 2. Start drag on fParent
    capturedFolderSortableOptions.onStart({
      item: fParent,
      originalEvent: { clientX: 50 },
    });

    // 2a. Parent card height & body visibility preserved (NO dragging-parent-collapsed, NO display:none)
    expect(fParent.classList.contains('dragging-subtree-origin')).toBe(true);
    expect(fParent.classList.contains('dragging-parent-collapsed')).toBe(false);
    expect(fParent.style.display).not.toBe('none');
    expect(fParentBody.style.display).not.toBe('none');

    // 2b. Descendant retains layout footprint (NO dragging-descendant-hidden, NO display:none)
    expect(fChild.classList.contains('dragging-subtree-descendant')).toBe(true);
    expect(fChild.classList.contains('dragging-descendant-hidden')).toBe(false);
    expect(fChild.style.display).not.toBe('none');

    // 2c. Non-subtree sibling DOM order and presence unaffected
    expect(fOther.classList.contains('dragging-subtree-descendant')).toBe(false);
    expect(Array.from(container.children).map((el) => el.getAttribute('data-group-id'))).toEqual([
      'f-parent',
      'f-child',
      'f-other',
    ]);

    // 3. Hit-testing exclusion: hover over fParent (self) or fChild (descendant) does NOT generate drop indicator
    activeHitElement = fParentHeader;
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 50, clientY: 50 }));
    expect(fParent.classList.contains('drop-indicator-before')).toBe(false);
    expect(fParent.classList.contains('drop-indicator-inside')).toBe(false);
    expect(fParent.classList.contains('drop-indicator-after')).toBe(false);

    activeHitElement = fChildHeader;
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 50, clientY: 100 }));
    expect(fChild.classList.contains('drop-indicator-before')).toBe(false);
    expect(fChild.classList.contains('drop-indicator-inside')).toBe(false);
    expect(fChild.classList.contains('drop-indicator-after')).toBe(false);

    // 4. Hit-testing on valid target fOther works normally
    activeHitElement = fOtherHeader;
    fOther.getBoundingClientRect = () =>
      ({ top: 160, bottom: 200, height: 40, left: 0, right: 200, width: 200, x: 0, y: 160 }) as any;
    fOtherHeader.getBoundingClientRect = () =>
      ({ top: 160, bottom: 200, height: 40, left: 0, right: 200, width: 200, x: 0, y: 160 }) as any;
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 50, clientY: 180 }));
    expect(fOther.classList.contains('drop-indicator-inside')).toBe(true);

    // 5. Drop / End drag: all transient visual classes completely cleared
    capturedFolderSortableOptions.onEnd({ item: fParent });
    expect(fParent.classList.contains('dragging-subtree-origin')).toBe(false);
    expect(fChild.classList.contains('dragging-subtree-descendant')).toBe(false);
    expect(fOther.classList.contains('drop-indicator-inside')).toBe(false);

    container.remove();
  });

  it('34. Trash hover does not collapse Folder sortable-ghost layout footprint', async () => {
    let capturedFolderSortableOptions: any;
    createSortable.mockImplementation((el: any, options: any) => {
      if (el?.classList?.contains('bookmark-sortable-root')) {
        capturedFolderSortableOptions = options;
      }
      return { destroy: vi.fn(), option: vi.fn() };
    });

    const pane = document.createElement('div');
    pane.className = 'bookmark-pane';
    document.body.appendChild(pane);

    const trashZone = document.createElement('div');
    trashZone.className = 'drag-trash-zone';
    pane.appendChild(trashZone);

    const container = document.createElement('div');
    container.className = 'bookmark-sortable-root';
    pane.appendChild(container);

    const f1 = document.createElement('div');
    f1.className = 'group-container';
    f1.setAttribute('data-group-id', 'f-1');
    container.appendChild(f1);

    const isOverTrash = ref(false);
    const sortables = useBookmarkSortables({
      bookmarks: ref([]),
      groups: ref([{ id: 'f-1', name: 'Folder 1', order: 0 }]),
      listRenderKey: ref(0),
      trashZone: ref(trashZone),
      isDragging: ref(false),
      isOverTrash,
      enableDragScrollBlock: vi.fn(),
      disableDragScrollBlock: vi.fn(),
      showTrash: vi.fn(),
      hideTrash: vi.fn(),
      execute: vi.fn(),
      containerRef: ref(container),
    } as any);

    await sortables.init();

    capturedFolderSortableOptions.onStart({
      item: f1,
      originalEvent: { clientX: 50 },
    });

    // SortableJS adds sortable-ghost to dragged element
    f1.classList.add('sortable-ghost');

    // Simulate trash hover
    isOverTrash.value = true;
    trashZone.classList.add('drag-hover');

    // Verify f1 does not have inline or explicit style collapsing height/margin/padding
    expect(f1.style.height).not.toBe('0px');
    expect(f1.style.minHeight).not.toBe('0px');
    expect(f1.style.padding).not.toBe('0px');
    expect(f1.style.margin).not.toBe('0px');
    expect(f1.style.display).not.toBe('none');

    // Clean up
    capturedFolderSortableOptions.onEnd({ item: f1 });
    f1.classList.remove('sortable-ghost');
    pane.remove();
  });

  it('35. Folder drag-trash destructive preview affordance, SSOT impact derivation, and drag lifecycle cleanup', async () => {
    let capturedFolderSortableOptions: any;
    let capturedBookmarkSortableOptions: any;
    createSortable.mockImplementation((el: any, options: any) => {
      if (el?.classList?.contains('bookmark-sortable-root')) {
        capturedFolderSortableOptions = options;
      } else if (el?.classList?.contains('bookmark-list-wrapper')) {
        capturedBookmarkSortableOptions = options;
      }
      return { destroy: vi.fn(), option: vi.fn() };
    });

    const pane = document.createElement('div');
    pane.className = 'bookmark-pane';
    document.body.appendChild(pane);

    const trashZone = document.createElement('div');
    trashZone.className = 'drag-trash-zone';
    pane.appendChild(trashZone);

    const container = document.createElement('div');
    container.className = 'bookmark-sortable-root';
    pane.appendChild(container);

    const fParent = document.createElement('div');
    fParent.className = 'group-container';
    fParent.setAttribute('data-group-id', 'p');
    container.appendChild(fParent);

    const fChild = document.createElement('div');
    fChild.className = 'group-container';
    fChild.setAttribute('data-group-id', 'c');
    container.appendChild(fChild);

    const fSibling = document.createElement('div');
    fSibling.className = 'group-container';
    fSibling.setAttribute('data-group-id', 's');
    container.appendChild(fSibling);

    const bmListWrapper = document.createElement('div');
    bmListWrapper.className = 'bookmark-list-wrapper';
    container.appendChild(bmListWrapper);

    const bmItem = document.createElement('div');
    bmItem.className = 'bookmark-row-item';
    bmItem.setAttribute('data-id', 'b-1');
    bmListWrapper.appendChild(bmItem);

    const isOverTrash = ref(false);
    const isDragging = ref(false);
    let currentDragEntity: any = null;
    const setDragEntity = vi.fn((entity) => {
      currentDragEntity = entity;
    });
    const executeMock = vi.fn().mockResolvedValue(true);

    const groups = ref([
      { id: 'p', name: 'Parent', order: 0 },
      { id: 'c', name: 'Child', parentId: 'p', order: 0 },
      { id: 's', name: 'Sibling', order: 1 },
    ]);
    const bookmarks = ref([
      { id: 'b-p', groupId: 'p', name: 'BP', order: 0 },
      { id: 'b-c', groupId: 'c', name: 'BC', order: 0 },
      { id: 'b-s', groupId: 's', name: 'BS', order: 0 },
    ]);

    const sortables = useBookmarkSortables({
      bookmarks,
      groups,
      listRenderKey: ref(0),
      trashZone: ref(trashZone),
      isDragging,
      isOverTrash,
      enableDragScrollBlock: vi.fn(),
      disableDragScrollBlock: vi.fn(),
      showTrash: vi.fn(),
      hideTrash: vi.fn(),
      execute: executeMock,
      containerRef: ref(container),
      setDragEntity,
    } as any);

    await sortables.init();

    // 1. Start folder drag on Parent
    capturedFolderSortableOptions.onStart({
      item: fParent,
      originalEvent: { clientX: 50 },
    });

    expect(fParent.classList.contains('dragging-subtree-origin')).toBe(true);
    expect(fChild.classList.contains('dragging-subtree-descendant')).toBe(true);
    expect(fSibling.classList.contains('dragging-subtree-descendant')).toBe(false);
    expect(setDragEntity).toHaveBeenCalledWith({ kind: 'folder', id: 'p' });
    expect(currentDragEntity).toEqual({ kind: 'folder', id: 'p' });

    // 2. Derive canonical delete impact for Parent
    const { getFolderDeleteImpact } = await import('@/utils/bookmark-collection');
    const impact = getFolderDeleteImpact(groups.value, bookmarks.value, 'p');
    expect(impact.totalFolderCount).toBe(2);
    expect(impact.descendantFolderCount).toBe(1);
    expect(impact.affectedBookmarkCount).toBe(2);
    expect(impact.affectedBookmarkIds.sort()).toEqual(['b-c', 'b-p']);

    // 3. Hover trash: isOverTrash toggles true
    isOverTrash.value = true;
    trashZone.classList.add('drag-hover');
    // Subtree classes remain stable on both origin & descendant without collapsing layout
    expect(fParent.classList.contains('dragging-subtree-origin')).toBe(true);
    expect(fChild.classList.contains('dragging-subtree-descendant')).toBe(true);
    expect(fSibling.classList.contains('dragging-subtree-origin')).toBe(false);
    expect(fSibling.classList.contains('dragging-subtree-descendant')).toBe(false);

    // 4. Drop over trash with confirmation prompt (Cancel branch)
    let promptMsg = '';
    (window as any).poexdConfirm = vi.fn(async (msg: string) => {
      promptMsg = msg;
      return false; // cancel
    });

    capturedFolderSortableOptions.onEnd({ item: fParent });
    // After onEnd, transient visual classes and drag entity must be immediately cleared
    expect(fParent.classList.contains('dragging-subtree-origin')).toBe(false);
    expect(fChild.classList.contains('dragging-subtree-descendant')).toBe(false);
    expect(currentDragEntity).toBeNull();

    await new Promise((r) => setTimeout(r, 10));
    expect(promptMsg).toContain('1 個子資料夾');
    expect(promptMsg).toContain('2 個書籤');
    expect(executeMock).not.toHaveBeenCalled();

    // 5. Drop over trash with confirmation prompt (Confirm branch)
    (window as any).poexdConfirm = vi.fn(async () => true);
    isOverTrash.value = true;
    capturedFolderSortableOptions.onStart({
      item: fParent,
      originalEvent: { clientX: 50 },
    });
    capturedFolderSortableOptions.onEnd({ item: fParent });

    await new Promise((r) => setTimeout(r, 10));
    expect(executeMock).toHaveBeenCalledWith({ type: 'delete-group', groupId: 'p' });

    // 6. Bookmark drag does not set folder kind or subtree classes
    capturedBookmarkSortableOptions.onStart({
      item: bmItem,
      originalEvent: { clientX: 50 },
    });
    expect(setDragEntity).toHaveBeenCalledWith({ kind: 'bookmark', id: 'b-1' });
    expect(fParent.classList.contains('dragging-subtree-origin')).toBe(false);
    expect(fChild.classList.contains('dragging-subtree-descendant')).toBe(false);

    capturedBookmarkSortableOptions.onEnd({
      item: bmItem,
      from: bmListWrapper,
      to: bmListWrapper,
    });
    expect(currentDragEntity).toBeNull();

    sortables.destroy();
    expect(currentDragEntity).toBeNull();
    pane.remove();
  });

  it('36. Destroy during active drag cleanly removes all transient subtree classes and resets trash state without mutation or confirm', async () => {
    let capturedFolderSortableOptions: any;
    let capturedBookmarkSortableOptions: any;
    createSortable.mockImplementation((el: any, options: any) => {
      if (el?.classList?.contains('bookmark-sortable-root')) {
        capturedFolderSortableOptions = options;
      } else if (el?.classList?.contains('bookmark-list-wrapper')) {
        capturedBookmarkSortableOptions = options;
      }
      return { destroy: vi.fn(), option: vi.fn() };
    });

    const pane = document.createElement('div');
    pane.className = 'bookmark-pane';
    document.body.appendChild(pane);

    const trashZone = document.createElement('div');
    trashZone.className = 'drag-trash-zone';
    pane.appendChild(trashZone);

    const container = document.createElement('div');
    container.className = 'bookmark-sortable-root';
    pane.appendChild(container);

    const fRoot = document.createElement('div');
    fRoot.className = 'group-container';
    fRoot.setAttribute('data-group-id', 'f-root');
    container.appendChild(fRoot);

    const fChild = document.createElement('div');
    fChild.className = 'group-container';
    fChild.setAttribute('data-group-id', 'f-child');
    container.appendChild(fChild);

    const bmListWrapper = document.createElement('div');
    bmListWrapper.className = 'bookmark-list-wrapper';
    container.appendChild(bmListWrapper);

    const bmItem = document.createElement('div');
    bmItem.className = 'bookmark-row-item';
    bmItem.setAttribute('data-id', 'bm-test');
    bmListWrapper.appendChild(bmItem);

    const isOverTrash = ref(false);
    const isDragging = ref(false);
    let activeEntity: any = null;
    const setDragEntity = vi.fn((e) => {
      activeEntity = e;
    });
    const executeMock = vi.fn().mockResolvedValue(true);
    const poexdConfirmMock = vi.fn();
    (window as any).poexdConfirm = poexdConfirmMock;

    const groups = ref([
      { id: 'f-root', name: 'Root Folder', order: 0 },
      { id: 'f-child', name: 'Child Folder', parentId: 'f-root', order: 0 },
    ]);
    const bookmarks = ref([{ id: 'bm-test', groupId: 'f-root', name: 'BM', order: 0 }]);

    const disableDragScrollBlock = vi.fn();
    const hideTrash = vi.fn(() => {
      trashZone.classList.remove('visible');
    });

    const sortables = useBookmarkSortables({
      bookmarks,
      groups,
      listRenderKey: ref(0),
      trashZone: ref(trashZone),
      isDragging,
      isOverTrash,
      enableDragScrollBlock: vi.fn(),
      disableDragScrollBlock,
      showTrash: () => trashZone.classList.add('visible'),
      hideTrash,
      execute: executeMock,
      containerRef: ref(container),
      setDragEntity,
    } as any);

    await sortables.init();

    // 1. Start Folder drag
    capturedFolderSortableOptions.onStart({
      item: fRoot,
      originalEvent: { clientX: 50 },
    });

    // 2. Confirm root & descendant acquired transient subtree classes
    expect(fRoot.classList.contains('dragging-subtree-origin')).toBe(true);
    expect(fChild.classList.contains('dragging-subtree-descendant')).toBe(true);
    expect(isDragging.value).toBe(true);
    expect(activeEntity).toEqual({ kind: 'folder', id: 'f-root' });

    // 3. Simulate trash hover
    isOverTrash.value = true;
    trashZone.classList.add('drag-hover');
    expect(isOverTrash.value).toBe(true);
    expect(trashZone.classList.contains('drag-hover')).toBe(true);

    // 4. Directly call destroy() without onEnd
    sortables.destroy();

    // 5. Verify complete cleanup
    expect(fRoot.classList.contains('dragging-subtree-origin')).toBe(false);
    expect(fChild.classList.contains('dragging-subtree-descendant')).toBe(false);
    expect(isDragging.value).toBe(false);
    expect(isOverTrash.value).toBe(false);
    expect(trashZone.classList.contains('drag-hover')).toBe(false);
    expect(trashZone.classList.contains('visible')).toBe(false);
    expect(disableDragScrollBlock).toHaveBeenCalled();
    expect(activeEntity).toBeNull();
    expect(executeMock).not.toHaveBeenCalled();
    expect(poexdConfirmMock).not.toHaveBeenCalled();

    // 6. Verify Bookmark active drag through destroy
    await sortables.init();
    capturedBookmarkSortableOptions.onStart({
      item: bmItem,
      originalEvent: { clientX: 50 },
    });
    isOverTrash.value = true;
    trashZone.classList.add('drag-hover');
    expect(isDragging.value).toBe(true);
    expect(activeEntity).toEqual({ kind: 'bookmark', id: 'bm-test' });

    sortables.destroy();
    expect(isDragging.value).toBe(false);
    expect(isOverTrash.value).toBe(false);
    expect(trashZone.classList.contains('drag-hover')).toBe(false);
    expect(trashZone.classList.contains('visible')).toBe(false);
    expect(activeEntity).toBeNull();
    expect(executeMock).not.toHaveBeenCalled();
    expect(poexdConfirmMock).not.toHaveBeenCalled();

    pane.remove();
  });

  it('37. Bookmark Folder DnD projected insertion slot & gap geometry regression', async () => {
    const fs = require('node:fs');
    const nodeSource = readBookmarkNodeSource();

    // 1. Single visual owner audit: .group-container owns before/after pseudo-elements, header pseudo-elements removed
    expect(nodeSource).toContain('.group-container.drop-indicator-before::before');
    expect(nodeSource).toContain('.group-container.drop-indicator-after::after');
    expect(nodeSource).not.toContain('.group-header-row.drop-indicator-before::before');
    expect(nodeSource).not.toContain('.group-header-row.drop-indicator-after::before');
    expect(nodeSource).toContain('top: var(--drop-indicator-offset-y, 0px)');
    expect(nodeSource).toContain('bottom: var(--drop-indicator-offset-y, 0px)');
    expect(nodeSource).toContain('transform: translateY(-50%)');
    expect(nodeSource).toContain('transform: translateY(50%)');

    // Inside highlight contract is preserved
    expect(nodeSource).toContain('.group-container.drop-indicator-inside');
    expect(nodeSource).toContain('.group-header-row.drop-indicator-inside');

    // 2. Setup DOM tree with:
    // - Parent A (p-a, depth 0, top: 0, bottom: 40)
    //   - Child A1 (c-a1, depth 1, top: 48, bottom: 88)
    //   - Child A2 (c-a2, depth 1, top: 96, bottom: 136)
    // - Parent B (p-b, depth 0, top: 144, bottom: 184)
    // - Dragged Folder X (f-x, depth 0, top: 192, bottom: 232)
    const container = document.createElement('div');
    container.className = 'bookmark-sortable-root';
    document.body.appendChild(container);

    const makeFolderNode = (id: string, top: number, bottom: number, depth: number) => {
      const folderEl = document.createElement('div');
      folderEl.className = 'group-container';
      folderEl.setAttribute('data-group-id', id);
      folderEl.setAttribute('data-depth', String(depth));

      const header = document.createElement('div');
      header.className = 'group-header-row';
      const handle = document.createElement('button');
      handle.className = 'folder-drag-handle';
      header.appendChild(handle);
      folderEl.appendChild(header);

      // Mock getBoundingClientRect
      folderEl.getBoundingClientRect = () => ({
        top,
        bottom,
        height: bottom - top,
        left: depth * 20,
        right: 300,
        width: 300 - depth * 20,
        x: depth * 20,
        y: top,
        toJSON: () => {},
      });
      header.getBoundingClientRect = () => ({
        top,
        bottom: top + 36,
        height: 36,
        left: depth * 20,
        right: 300,
        width: 300 - depth * 20,
        x: depth * 20,
        y: top,
        toJSON: () => {},
      });

      return { folderEl, header };
    };

    const pA = makeFolderNode('p-a', 0, 40, 0);
    const cA1 = makeFolderNode('c-a1', 48, 88, 1);
    const cA2 = makeFolderNode('c-a2', 96, 136, 1);
    const pB = makeFolderNode('p-b', 144, 184, 0);
    const fX = makeFolderNode('f-x', 192, 232, 0);

    container.appendChild(pA.folderEl);
    container.appendChild(cA1.folderEl);
    container.appendChild(cA2.folderEl);
    container.appendChild(pB.folderEl);
    container.appendChild(fX.folderEl);

    const groups = ref([
      { id: 'p-a', name: 'Parent A', order: 0 },
      { id: 'c-a1', name: 'Child A1', order: 0, parentId: 'p-a' },
      { id: 'c-a2', name: 'Child A2', order: 1, parentId: 'p-a' },
      { id: 'p-b', name: 'Parent B', order: 1 },
      { id: 'f-x', name: 'Folder X', order: 2 },
    ]);

    let capturedSortableOptions: any;
    let hitElement: Element | null = null;
    const execute = vi.fn(async () => true);

    const sortables = useBookmarkSortables({
      bookmarks: ref([]),
      groups,
      listRenderKey: ref(0),
      trashZone: ref(null),
      isDragging: ref(false),
      isOverTrash: ref(false),
      enableDragScrollBlock: vi.fn(),
      disableDragScrollBlock: vi.fn(),
      showTrash: vi.fn(),
      hideTrash: vi.fn(),
      execute,
      containerRef: ref(container),
      elementFromPoint: () => hitElement,
      collapsedGroupIds: ref(new Set<string>()),
    } as any);

    const fakeSortable = {
      destroy: vi.fn(),
      option: vi.fn(),
    };
    createSortable.mockImplementation((_el: any, options: any) => {
      capturedSortableOptions = options;
      return fakeSortable;
    });

    await sortables.init();

    // Start drag on fX (startX = 100)
    capturedSortableOptions.onStart({
      item: fX.folderEl,
      originalEvent: { clientX: 100 },
    });

    // 2. Test: Expanded parent 'after p-a' must project after its last visible descendant cA2
    // Hover near bottom edge of pA (clientY = 38)
    hitElement = pA.folderEl;
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 100, clientY: 38 }));

    // Slot is cA2 (last visible descendant), not pA!
    expect(pA.folderEl.classList.contains('drop-indicator-after')).toBe(false);
    expect(cA2.folderEl.classList.contains('drop-indicator-after')).toBe(true);
    // Indent reflects depth 0 of after p-a relative to cA2 (depth 1) -> (0 - 1) * 20 = -20px
    expect(cA2.folderEl.style.getPropertyValue('--drop-indicator-indent')).toBe('-20px');
    // Offset Y centers within measured gap (pB.top 144 - cA2.bottom 136 = 8px gap -> -4px offset)
    expect(cA2.folderEl.style.getPropertyValue('--drop-indicator-offset-y')).toBe('-4px');

    // 3. Test: Sibling gap centering (after pA's visible subtree cA2 vs before pB)
    // Between cA2 (bottom 136) and pB (top 144), gap is 8px. Center is at Y = 140.
    // 3a. after pA (slot on cA2 bottom)
    expect(cA2.folderEl.classList.contains('drop-indicator-after')).toBe(true);
    expect(cA2.folderEl.style.getPropertyValue('--drop-indicator-offset-y')).toBe('-4px');

    // 3b. before pB (clientY = 146 -> top edge of pB)
    hitElement = pB.folderEl;
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 100, clientY: 146 }));
    expect(cA2.folderEl.classList.contains('drop-indicator-after')).toBe(false);
    expect(pB.folderEl.classList.contains('drop-indicator-before')).toBe(true);
    // Indicator is offset by -4px from pB top (144 - 4 = 140), exactly in the gap center
    expect(pB.folderEl.style.getPropertyValue('--drop-indicator-offset-y')).toBe('-4px');
    expect(pB.folderEl.style.getPropertyValue('--drop-indicator-indent')).toBe('0px');

    // 4. Test: Before first folder outward half-gap placement
    hitElement = pA.folderEl;
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 100, clientY: 2 }));
    expect(pA.folderEl.classList.contains('drop-indicator-before')).toBe(true);
    // First folder has no previous element -> uses runtime CSS row gap (fallback 8px -> -4px)
    expect(pA.folderEl.style.getPropertyValue('--drop-indicator-offset-y')).toBe('-4px');

    // 5. Test: After last folder outward half-gap placement
    hitElement = pB.folderEl;
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 100, clientY: 182 }));
    expect(pB.folderEl.classList.contains('drop-indicator-after')).toBe(true);
    // Measured gap between pB and fX is 192 - 184 = 8px -> -4px
    expect(pB.folderEl.style.getPropertyValue('--drop-indicator-offset-y')).toBe('-4px');

    // 6. Test: Horizontal outdent from child to ancestor
    // Hover on cA1 top (before cA1), then drag left by -40px (clientX = 60) -> outdents to before p-a (depth 0)
    hitElement = cA1.folderEl;
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 60, clientY: 50 }));
    // Must move slot to pA before!
    expect(cA1.folderEl.classList.contains('drop-indicator-before')).toBe(false);
    expect(pA.folderEl.classList.contains('drop-indicator-before')).toBe(true);
    expect(pA.folderEl.style.getPropertyValue('--drop-indicator-indent')).toBe('0px');

    // 7. Test: UI Scale & Density token adaptation for row-gap
    const densityContainer = document.createElement('div');
    densityContainer.style.setProperty('--pxd-row-gap', '6.4px'); // Compact density
    const dummySlot = document.createElement('div');
    dummySlot.className = 'group-container';
    densityContainer.appendChild(dummySlot);
    const compactGap = resolveFolderRowGap(densityContainer, dummySlot, 'before');
    expect(compactGap).toBe(6.4);

    densityContainer.style.setProperty('--pxd-row-gap', '9.6px'); // Relaxed density
    const relaxedGap = resolveFolderRowGap(densityContainer, dummySlot, 'before');
    expect(relaxedGap).toBe(9.6);

    // 7b. Test: Bookmark tree-gap local ownership priority over global row-gap
    densityContainer.style.setProperty('--pxd-bookmark-tree-gap', '4.8px'); // Bookmark Compact tree gap
    const bookmarkTreeGap = resolveFolderRowGap(densityContainer, dummySlot, 'before');
    expect(bookmarkTreeGap).toBe(4.8); // Must prioritize local semantic tree gap over row-gap

    // 8. Test: Inside highlight preservation
    hitElement = pB.folderEl;
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 100, clientY: 160 }));
    expect(pB.folderEl.classList.contains('drop-indicator-inside')).toBe(true);
    expect(pB.header.classList.contains('drop-indicator-inside')).toBe(true);

    // 9. Test: Drop commit matches final dropIntent
    capturedSortableOptions.onEnd({ item: fX.folderEl });
    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'move-folder',
          folderId: 'f-x',
          dropIntent: {
            targetFolderId: 'p-b',
            position: 'inside',
          },
        }),
      );
    });

    container.remove();
  });

  it('38. Self-origin horizontal outdent: dragged folder as gesture sensor to reduce depth to ancestor after slot', async () => {
    // Structure:
    // A (depth 0, top: 0, bottom: 40)
    //   B (depth 1, top: 48, bottom: 88, parentId: 'f-a')
    //     C (depth 2, top: 96, bottom: 136, parentId: 'f-b')
    //     D (depth 2, top: 144, bottom: 184, parentId: 'f-b')
    // E (root, depth 0, top: 192, bottom: 232)
    const container = document.createElement('div');
    container.className = 'bookmark-sortable-root';
    document.body.appendChild(container);

    const makeNode = (id: string, top: number, bottom: number, depth: number) => {
      const folderEl = document.createElement('div');
      folderEl.className = 'group-container';
      folderEl.setAttribute('data-group-id', id);
      folderEl.setAttribute('data-depth', String(depth));

      const header = document.createElement('div');
      header.className = 'group-header-row';
      const handle = document.createElement('button');
      handle.className = 'folder-drag-handle';
      header.appendChild(handle);
      folderEl.appendChild(header);

      folderEl.getBoundingClientRect = () => ({
        top,
        bottom,
        height: bottom - top,
        left: depth * 20,
        right: 300,
        width: 300 - depth * 20,
        x: depth * 20,
        y: top,
        toJSON: () => {},
      });
      header.getBoundingClientRect = () => ({
        top,
        bottom: top + 36,
        height: 36,
        left: depth * 20,
        right: 300,
        width: 300 - depth * 20,
        x: depth * 20,
        y: top,
        toJSON: () => {},
      });

      return { folderEl, header };
    };

    const fA = makeNode('f-a', 0, 40, 0);
    const fB = makeNode('f-b', 48, 88, 1);
    const fC = makeNode('f-c', 96, 136, 2);
    const fD = makeNode('f-d', 144, 184, 2);
    const fE = makeNode('f-e', 192, 232, 0);

    container.appendChild(fA.folderEl);
    container.appendChild(fB.folderEl);
    container.appendChild(fC.folderEl);
    container.appendChild(fD.folderEl);
    container.appendChild(fE.folderEl);

    const groups = ref([
      { id: 'f-a', name: 'Folder A', order: 0 },
      { id: 'f-b', name: 'Folder B', order: 0, parentId: 'f-a' },
      { id: 'f-c', name: 'Folder C', order: 0, parentId: 'f-b' },
      { id: 'f-d', name: 'Folder D', order: 1, parentId: 'f-b' },
      { id: 'f-e', name: 'Folder E', order: 1 },
    ]);

    let capturedSortableOptions: any;
    const execute = vi.fn(async () => true);

    const allNodes = [fA, fB, fC, fD, fE];
    const realisticElementFromPoint = (x: number, y: number): Element | null => {
      for (const node of allNodes) {
        const rect = node.folderEl.getBoundingClientRect();
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
          const headerRect = node.header.getBoundingClientRect();
          if (
            x >= headerRect.left &&
            x <= headerRect.right &&
            y >= headerRect.top &&
            y <= headerRect.bottom
          ) {
            return node.header;
          }
          return node.folderEl;
        }
      }
      return container;
    };

    const sortables = useBookmarkSortables({
      bookmarks: ref([]),
      groups,
      listRenderKey: ref(0),
      trashZone: ref(null),
      isDragging: ref(false),
      isOverTrash: ref(false),
      enableDragScrollBlock: vi.fn(),
      disableDragScrollBlock: vi.fn(),
      showTrash: vi.fn(),
      hideTrash: vi.fn(),
      execute,
      containerRef: ref(container),
      elementFromPoint: realisticElementFromPoint,
      collapsedGroupIds: ref(new Set<string>()),
    } as any);

    const fakeSortable = {
      destroy: vi.fn(),
      option: vi.fn(),
    };
    createSortable.mockImplementation((_el: any, options: any) => {
      capturedSortableOptions = options;
      return fakeSortable;
    });

    await sortables.init();

    // Start drag on fC drag-handle (fC.left = 40, handle starts at x = 45, depth 2)
    capturedSortableOptions.onStart({
      item: fC.folderEl,
      originalEvent: { clientX: 45 },
    });

    // 1. Pointer on fC self card with no horizontal outdent (clientX = 45, clientY = 110)
    // Hits fC header -> invalid / no-op (self without horizontal outdent)
    expect(realisticElementFromPoint(45, 110)).toBe(fC.header);
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 45, clientY: 110 }));
    expect(fC.folderEl.classList.contains('drop-indicator-after')).toBe(false);
    expect(fC.folderEl.classList.contains('drop-indicator-inside')).toBe(false);
    expect(fC.folderEl.classList.contains('drop-indicator-before')).toBe(false);

    // 2. Pointer dragged right (clientX = 75, clientY = 110, offset = +30)
    // Hits fC card -> invalid / no-op (no self-inside)
    expect(realisticElementFromPoint(75, 110)).toBe(fC.header);
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 75, clientY: 110 }));
    expect(fC.folderEl.classList.contains('drop-indicator-inside')).toBe(false);
    expect(fC.folderEl.classList.contains('drop-indicator-after')).toBe(false);

    // 3. Pointer dragged left 1 level into indentation gutter (clientX = 17, offset = 17 - 45 = -28)
    // Because clientX = 17 < fC.left (40), pointer is physically outside fC card in the left gutter!
    // elementFromPoint hits container (.bookmark-sortable-root), NOT fC!
    expect(realisticElementFromPoint(17, 110)).toBe(container);
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 17, clientY: 110 }));
    // Self-origin gesture corridor recovers fC as sensor:
    // Outdents to depth 1 (after B). B's visible subtree ends at D (depth 2).
    // Indicator is placed after D, reflecting depth 1 (relative indent: (1 - 2) * 20 = -20px)
    expect(fD.folderEl.classList.contains('drop-indicator-after')).toBe(true);
    expect(fD.folderEl.style.getPropertyValue('--drop-indicator-indent')).toBe('-20px');
    expect(fD.folderEl.style.getPropertyValue('--drop-indicator-offset-y')).toBe('-4px');

    // 4. Pointer dragged left 2 levels further into gutter (clientX = -3, offset = -3 - 45 = -48)
    // Still in left gutter outside any card -> elementFromPoint hits container
    expect(realisticElementFromPoint(-3, 110)).toBe(container);
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: -3, clientY: 110 }));
    // Outdents to depth 0 (after A). A's visible subtree ends at D.
    // Indicator is placed after D, reflecting depth 0 (relative indent: (0 - 2) * 20 = -40px)
    expect(fD.folderEl.classList.contains('drop-indicator-after')).toBe(true);
    expect(fD.folderEl.style.getPropertyValue('--drop-indicator-indent')).toBe('-40px');
    expect(fD.folderEl.style.getPropertyValue('--drop-indicator-offset-y')).toBe('-4px');

    // 5. Pointer moves vertically out of origin row into fB's row (clientX = 45, clientY = 60)
    // Hits fB directly (fB top: 48, bottom: 88, left: 20) -> switches to fB target gesture
    expect(realisticElementFromPoint(45, 60)).toBe(fB.header);
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 45, clientY: 60 }));
    // Previous indicator on fD must be cleared
    expect(fD.folderEl.classList.contains('drop-indicator-after')).toBe(false);
    // fB center zone -> inside fB
    expect(fB.folderEl.classList.contains('drop-indicator-inside')).toBe(true);

    // 6. Pointer in fB's vertical height but in left gutter outside fB (clientX = 5, clientY = 60, fB.left = 20)
    // Hits container, but clientY is outside fC origin row -> corridor does not trigger, indicators cleared
    expect(realisticElementFromPoint(5, 60)).toBe(container);
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 5, clientY: 60 }));
    expect(fB.folderEl.classList.contains('drop-indicator-inside')).toBe(false);
    expect(fD.folderEl.classList.contains('drop-indicator-after')).toBe(false);

    // 7. Move back to self-origin corridor at depth 0 outdent (clientX = -3, clientY = 110)
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: -3, clientY: 110 }));
    expect(fD.folderEl.classList.contains('drop-indicator-after')).toBe(true);

    // 8. Verify source/subtree layout footprint has not changed during gesture
    const currentOrder = Array.from(container.children).map((c) => c.getAttribute('data-group-id'));
    expect(currentOrder).toEqual(['f-a', 'f-b', 'f-c', 'f-d', 'f-e']);

    // 9. Drop commits move-folder after A
    capturedSortableOptions.onEnd({ item: fC.folderEl });
    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'move-folder',
          folderId: 'f-c',
          dropIntent: {
            targetFolderId: 'f-a',
            position: 'after',
          },
        }),
      );
    });

    // 10. Cycle safety: dragging A onto descendant B is rejected even with realistic hit test
    capturedSortableOptions.onStart({
      item: fA.folderEl,
      originalEvent: { clientX: 50 },
    });
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 50, clientY: 60 }));
    expect(fB.folderEl.classList.contains('drop-indicator-after')).toBe(false);
    expect(fB.folderEl.classList.contains('drop-indicator-inside')).toBe(false);
    expect(fB.folderEl.classList.contains('drop-indicator-before')).toBe(false);

    capturedSortableOptions.onEnd({ item: fA.folderEl });

    container.remove();
  });

  it('39. Folder drag to trash: directly deletes empty leaf folder without poexdConfirm, while folders with bookmarks or subtrees retain confirmation', async () => {
    let capturedFolderSortableOptions: any;
    createSortable.mockImplementation((el: any, options: any) => {
      if (el?.classList?.contains('bookmark-sortable-root')) {
        capturedFolderSortableOptions = options;
      }
      return { destroy: vi.fn(), option: vi.fn() };
    });

    const pane = document.createElement('div');
    pane.className = 'bookmark-pane';
    document.body.appendChild(pane);

    const trashZone = document.createElement('div');
    trashZone.className = 'drag-trash-zone';
    pane.appendChild(trashZone);

    const container = document.createElement('div');
    container.className = 'bookmark-sortable-root';
    pane.appendChild(container);

    // 1. emptyLeaf (0 descendants, 0 bookmarks)
    const fEmptyLeaf = document.createElement('div');
    fEmptyLeaf.className = 'group-container';
    fEmptyLeaf.setAttribute('data-group-id', 'empty-leaf');
    container.appendChild(fEmptyLeaf);

    // 2. withBookmark (0 descendants, 1 bookmark)
    const fWithBm = document.createElement('div');
    fWithBm.className = 'group-container';
    fWithBm.setAttribute('data-group-id', 'with-bm');
    container.appendChild(fWithBm);

    // 3. parentWithEmptyChild (1 descendant, 0 bookmarks)
    const fParentEmptyChild = document.createElement('div');
    fParentEmptyChild.className = 'group-container';
    fParentEmptyChild.setAttribute('data-group-id', 'parent-empty-child');
    container.appendChild(fParentEmptyChild);

    const fEmptyChild = document.createElement('div');
    fEmptyChild.className = 'group-container';
    fEmptyChild.setAttribute('data-group-id', 'empty-child');
    container.appendChild(fEmptyChild);

    const isOverTrash = ref(false);
    const isDragging = ref(false);
    const executeMock = vi.fn().mockResolvedValue(true);
    const poexdConfirmMock = vi.fn(async () => true);
    (window as any).poexdConfirm = poexdConfirmMock;

    const groups = ref([
      { id: 'empty-leaf', name: 'Empty Leaf', order: 0 },
      { id: 'with-bm', name: 'With Bookmark', order: 1 },
      { id: 'parent-empty-child', name: 'Parent Empty Child', order: 2 },
      { id: 'empty-child', name: 'Empty Child', parentId: 'parent-empty-child', order: 0 },
    ]);
    const bookmarks = ref([{ id: 'bm-1', groupId: 'with-bm', name: 'BM1', order: 0 }]);

    const sortables = useBookmarkSortables({
      bookmarks,
      groups,
      listRenderKey: ref(0),
      trashZone: ref(trashZone),
      isDragging,
      isOverTrash,
      enableDragScrollBlock: vi.fn(),
      disableDragScrollBlock: vi.fn(),
      showTrash: vi.fn(),
      hideTrash: vi.fn(),
      execute: executeMock,
      containerRef: ref(container),
    } as any);

    await sortables.init();

    // 1. Drop empty leaf folder over trash -> deletes directly without poexdConfirm
    isOverTrash.value = true;
    capturedFolderSortableOptions.onStart({
      item: fEmptyLeaf,
      originalEvent: { clientX: 50 },
    });
    capturedFolderSortableOptions.onEnd({ item: fEmptyLeaf });
    await new Promise((r) => setTimeout(r, 10));

    expect(poexdConfirmMock).not.toHaveBeenCalled();
    expect(executeMock).toHaveBeenCalledWith({ type: 'delete-group', groupId: 'empty-leaf' });

    executeMock.mockClear();
    poexdConfirmMock.mockClear();

    // 2. Drop folder with bookmarks over trash -> requires poexdConfirm
    isOverTrash.value = true;
    capturedFolderSortableOptions.onStart({
      item: fWithBm,
      originalEvent: { clientX: 50 },
    });
    capturedFolderSortableOptions.onEnd({ item: fWithBm });
    await new Promise((r) => setTimeout(r, 10));

    expect(poexdConfirmMock).toHaveBeenCalledWith(
      expect.stringContaining(
        '確定要刪除資料夾「With Bookmark」嗎？\n這將會一併刪除資料夾內的 1 個書籤。',
      ),
      '拖曳刪除資料夾',
    );
    expect(executeMock).toHaveBeenCalledWith({ type: 'delete-group', groupId: 'with-bm' });

    executeMock.mockClear();
    poexdConfirmMock.mockClear();

    // 3. Drop folder with empty child folder (0 bookmarks in subtree) -> requires poexdConfirm and reports descendant cascade
    isOverTrash.value = true;
    capturedFolderSortableOptions.onStart({
      item: fParentEmptyChild,
      originalEvent: { clientX: 50 },
    });
    capturedFolderSortableOptions.onEnd({ item: fParentEmptyChild });
    await new Promise((r) => setTimeout(r, 10));

    expect(poexdConfirmMock).toHaveBeenCalledWith(
      expect.stringContaining(
        '確定要刪除資料夾「Parent Empty Child」及其 1 個子資料夾嗎？\n這將會一併刪除其中的 0 個書籤。',
      ),
      '拖曳刪除資料夾',
    );
    expect(executeMock).toHaveBeenCalledWith({
      type: 'delete-group',
      groupId: 'parent-empty-child',
    });

    sortables.destroy();
    pane.remove();
  });
});
