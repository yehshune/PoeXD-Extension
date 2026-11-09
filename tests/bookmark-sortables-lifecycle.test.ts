import { nextTick, ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createSortable } = vi.hoisted(() => ({ createSortable: vi.fn() }));

vi.mock('sortablejs', () => ({
  default: { create: createSortable },
}));

import {
  useBookmarkSortables,
  calculateBookmarkReorderPlacements,
} from '@/components/sidebar/composables/useBookmarkSortables';

describe('bookmark Sortable drag lifecycle', () => {
  beforeEach(() => {
    createSortable.mockReset();
  });

  describe('Pure intent calculation', () => {
    const groups = [
      { id: 'group-1', name: 'Folder 1', order: 0 },
      { id: 'group-2', name: 'Folder 2', order: 1 },
    ];

    it('calculates same-folder bookmark reorder placements (C before A)', () => {
      const bookmarks = [
        { id: 'bm-a', name: 'A', url: '/a', searchRecordId: 'ra', groupId: 'group-1', order: 0 },
        { id: 'bm-b', name: 'B', url: '/b', searchRecordId: 'rb', groupId: 'group-1', order: 1 },
        { id: 'bm-c', name: 'C', url: '/c', searchRecordId: 'rc', groupId: 'group-1', order: 2 },
      ];
      const placements = calculateBookmarkReorderPlacements({
        bookmarks,
        groups,
        draggedBookmarkId: 'bm-c',
        sourceGroupId: 'group-1',
        targetGroupId: 'group-1',
        newIndex: 0,
      });

      expect(placements).toEqual([
        { id: 'bm-c', groupId: 'group-1', order: 0 },
        { id: 'bm-a', groupId: 'group-1', order: 1 },
        { id: 'bm-b', groupId: 'group-1', order: 2 },
      ]);
    });

    it('calculates cross-folder move placements to non-empty target folder', () => {
      const bookmarks = [
        { id: 'bm-1', name: 'One', url: '/1', searchRecordId: 'r1', groupId: 'group-1', order: 0 },
        { id: 'bm-2', name: 'Two', url: '/2', searchRecordId: 'r2', groupId: 'group-2', order: 0 },
      ];
      const placements = calculateBookmarkReorderPlacements({
        bookmarks,
        groups,
        draggedBookmarkId: 'bm-1',
        sourceGroupId: 'group-1',
        targetGroupId: 'group-2',
        newIndex: 0,
      });

      expect(placements).toEqual([
        { id: 'bm-1', groupId: 'group-2', order: 0 },
        { id: 'bm-2', groupId: 'group-2', order: 1 },
      ]);
    });

    it('calculates cross-folder move placements into an empty target folder', () => {
      const bookmarks = [
        { id: 'bm-1', name: 'One', url: '/1', searchRecordId: 'r1', groupId: 'group-1', order: 0 },
      ];
      const placements = calculateBookmarkReorderPlacements({
        bookmarks,
        groups,
        draggedBookmarkId: 'bm-1',
        sourceGroupId: 'group-1',
        targetGroupId: 'group-2',
        newIndex: 0,
      });

      expect(placements).toEqual([{ id: 'bm-1', groupId: 'group-2', order: 0 }]);
    });

    it('returns null on invalid bookmark or group id without throwing', () => {
      const bookmarks = [
        { id: 'bm-1', name: 'One', url: '/1', searchRecordId: 'r1', groupId: 'group-1', order: 0 },
      ];
      expect(
        calculateBookmarkReorderPlacements({
          bookmarks,
          groups,
          draggedBookmarkId: 'non-existent',
          targetGroupId: 'group-2',
          newIndex: 0,
        }),
      ).toBeNull();

      expect(
        calculateBookmarkReorderPlacements({
          bookmarks,
          groups,
          draggedBookmarkId: 'bm-1',
          targetGroupId: 'non-existent-group',
          newIndex: 0,
        }),
      ).toBeNull();
    });
  });

  it('shows and hides the trash zone synchronously around a folder drag', async () => {
    let sortableOptions: Record<string, (...args: any[]) => void> = {};
    createSortable.mockImplementation((_element, options) => {
      sortableOptions = options;
      return { destroy: vi.fn(), option: vi.fn() };
    });
    vi.stubGlobal('document', {
      querySelector: () => ({}),
      querySelectorAll: (selector: string) =>
        selector === '.group-container' ? [{ getAttribute: () => 'folder' }] : [],
    });
    const showTrash = vi.fn();
    const hideTrash = vi.fn();
    const execute = vi.fn(async () => true);
    const controller = useBookmarkSortables({
      bookmarks: ref([]),
      groups: ref([{ id: 'folder', name: 'Folder', order: 0 }]),
      listRenderKey: ref(0),
      trashZone: ref(null),
      isDragging: ref(false),
      isOverTrash: ref(false),
      enableDragScrollBlock: vi.fn(),
      disableDragScrollBlock: vi.fn(),
      execute,
      showTrash,
      hideTrash,
    } as any);

    await controller.init();
    sortableOptions.onStart();
    expect(showTrash).toHaveBeenCalledOnce();

    sortableOptions.onEnd({ item: { getAttribute: () => 'folder' } } as any);
    expect(hideTrash).toHaveBeenCalledOnce();
    expect(execute).not.toHaveBeenCalled();
  });

  it('converts Bookmark drag event into pure placements without mutating state or reading DOM', async () => {
    let sortableOptions: Record<string, (...args: any[]) => void> = {};
    const mockWrapper = { getAttribute: () => 'group-1' };
    createSortable.mockImplementation((_element, options) => {
      sortableOptions = options;
      return { destroy: vi.fn(), option: vi.fn() };
    });
    vi.stubGlobal('document', {
      querySelector: () => null,
      querySelectorAll: (selector: string) =>
        selector === '.bookmark-list-wrapper' ? [mockWrapper] : [],
    });
    const bookmarks = ref([
      {
        id: 'bookmark-1',
        name: 'One',
        url: '/one',
        searchRecordId: 'r1',
        groupId: 'group-1',
        order: 0,
      },
      {
        id: 'bookmark-2',
        name: 'Two',
        url: '/two',
        searchRecordId: 'r2',
        groupId: 'group-1',
        order: 1,
      },
    ]);
    const groups = ref([
      { id: 'group-2', name: 'Folder 2', order: 0 },
      { id: 'group-1', name: 'Folder 1', order: 1 },
    ]);
    const execute = vi.fn(async () => true);
    const listRenderKey = ref(0);
    const controller = useBookmarkSortables({
      bookmarks,
      groups,
      listRenderKey,
      trashZone: ref(null),
      isDragging: ref(false),
      isOverTrash: ref(false),
      enableDragScrollBlock: vi.fn(),
      disableDragScrollBlock: vi.fn(),
      execute,
      showTrash: vi.fn(),
      hideTrash: vi.fn(),
    } as any);

    await controller.init();
    sortableOptions.onEnd({
      item: { getAttribute: () => 'bookmark-1' },
      from: { getAttribute: () => 'group-1' },
      to: { getAttribute: () => 'group-2' },
      newDraggableIndex: 0,
    } as any);

    await vi.waitFor(() =>
      expect(execute).toHaveBeenCalledWith({
        type: 'reorder-bookmarks',
        placements: [
          { id: 'bookmark-1', groupId: 'group-2', order: 0 },
          { id: 'bookmark-2', groupId: 'group-1', order: 1 },
        ],
      }),
    );
    expect(bookmarks.value[0].groupId).toBe('group-1');
    expect(listRenderKey.value).toBe(1);
  });

  it('converts a Bookmark trash drop into one delete intent and repairs DOM through transaction', async () => {
    let sortableOptions: Record<string, (...args: any[]) => void> = {};
    const mockWrapper = { getAttribute: () => 'group-1' };
    createSortable.mockImplementation((_element, options) => {
      sortableOptions = options;
      return { destroy: vi.fn(), option: vi.fn() };
    });
    vi.stubGlobal('document', {
      querySelector: () => null,
      querySelectorAll: (selector: string) =>
        selector === '.bookmark-list-wrapper' ? [mockWrapper] : [],
    });

    const execute = vi.fn(async () => true);
    const initialBookmark = {
      id: 'bookmark-1',
      name: 'One',
      url: '/one',
      searchRecordId: 'r1',
      groupId: 'group-1',
      order: 0,
    };
    const bookmarks = ref([initialBookmark]);
    const listRenderKey = ref(0);

    const controller = useBookmarkSortables({
      bookmarks,
      groups: ref([]),
      listRenderKey,
      trashZone: ref(null),
      isDragging: ref(false),
      isOverTrash: ref(true),
      enableDragScrollBlock: vi.fn(),
      disableDragScrollBlock: vi.fn(),
      execute,
      showTrash: vi.fn(),
      hideTrash: vi.fn(),
    } as any);

    await controller.init();
    sortableOptions.onEnd({ item: { getAttribute: () => 'bookmark-1' } } as any);

    await vi.waitFor(() =>
      expect(execute).toHaveBeenCalledWith({
        type: 'delete-bookmark',
        bookmarkId: 'bookmark-1',
      }),
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(listRenderKey.value).toBe(1);
    expect(bookmarks.value).toHaveLength(1);
    expect(bookmarks.value[0]).toStrictEqual(initialBookmark);
  });

  it('triggers DOM recovery via listRenderKey even when delete intent fails or rolls back', async () => {
    let sortableOptions: Record<string, (...args: any[]) => void> = {};
    const mockWrapper = { getAttribute: () => 'group-1' };
    createSortable.mockImplementation((_element, options) => {
      sortableOptions = options;
      return { destroy: vi.fn(), option: vi.fn() };
    });
    vi.stubGlobal('document', {
      querySelector: () => null,
      querySelectorAll: (selector: string) =>
        selector === '.bookmark-list-wrapper' ? [mockWrapper] : [],
    });

    const execute = vi.fn(async () => false);
    const listRenderKey = ref(0);
    const initialBookmark = {
      id: 'bookmark-rollback',
      name: 'Rollback Item',
      url: '/rb',
      searchRecordId: 'r-rb',
      groupId: 'group-1',
      order: 0,
    };
    const bookmarks = ref([initialBookmark]);

    const controller = useBookmarkSortables({
      bookmarks,
      groups: ref([]),
      listRenderKey,
      trashZone: ref(null),
      isDragging: ref(false),
      isOverTrash: ref(true),
      enableDragScrollBlock: vi.fn(),
      disableDragScrollBlock: vi.fn(),
      execute,
      showTrash: vi.fn(),
      hideTrash: vi.fn(),
    } as any);

    await controller.init();
    sortableOptions.onEnd({ item: { getAttribute: () => 'bookmark-rollback' } } as any);

    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledTimes(1);
      expect(listRenderKey.value).toBe(1);
    });
    expect(bookmarks.value).toHaveLength(1);
    expect(bookmarks.value[0]).toStrictEqual(initialBookmark);
  });

  it('blocks concurrent init() during active reconciling transaction', async () => {
    let sortableOptions: Record<string, (...args: any[]) => void> = {};
    const mockWrapper = { getAttribute: () => 'group-1' };
    createSortable.mockImplementation((_element, options) => {
      sortableOptions = options;
      return { destroy: vi.fn(), option: vi.fn() };
    });
    vi.stubGlobal('document', {
      querySelector: () => null,
      querySelectorAll: (selector: string) =>
        selector === '.bookmark-list-wrapper' ? [mockWrapper] : [],
    });

    let resolveExecute!: (val: boolean) => void;
    const execute = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveExecute = resolve;
        }),
    );
    const controller = useBookmarkSortables({
      bookmarks: ref([
        { id: 'bm-1', name: 'One', url: '/1', searchRecordId: 'r1', groupId: 'group-1', order: 0 },
      ]),
      groups: ref([{ id: 'group-1', name: 'G1', order: 0 }]),
      listRenderKey: ref(0),
      trashZone: ref(null),
      isDragging: ref(false),
      isOverTrash: ref(true),
      enableDragScrollBlock: vi.fn(),
      disableDragScrollBlock: vi.fn(),
      execute,
      showTrash: vi.fn(),
      hideTrash: vi.fn(),
    } as any);

    await controller.init();
    expect(createSortable).toHaveBeenCalledTimes(1);

    // Trigger drag drop to enter transaction
    sortableOptions.onEnd({ item: { getAttribute: () => 'bm-1' } } as any);
    await vi.waitFor(() => expect(controller.isReconciling.value).toBe(true));

    // Attempt concurrent init() while reconciling
    await controller.init();
    // createSortable must NOT have been called while reconciling
    expect(createSortable).toHaveBeenCalledTimes(1);

    // Settle transaction
    resolveExecute(true);
    await vi.waitFor(() => expect(controller.isReconciling.value).toBe(false));

    // After transaction completes, init() runs once for the new DOM
    expect(createSortable).toHaveBeenCalledTimes(2);
  });

  it('configures unified AutoScroll contract for both Folder and Bookmark Sortables', async () => {
    const sortableCalls: Array<{ element: HTMLElement; options: any }> = [];
    createSortable.mockImplementation((element, options) => {
      sortableCalls.push({ element, options });
      return { destroy: vi.fn(), option: vi.fn() };
    });

    const mockAccordion = {
      nodeType: 1,
      classList: { contains: () => true },
    } as unknown as HTMLElement;
    const mockSortableRoot = {
      nodeType: 1,
      classList: { contains: () => true },
    } as unknown as HTMLElement;
    const mockWrapper = {
      getAttribute: () => 'group-1',
      querySelectorAll: () => [],
    } as unknown as HTMLElement;

    vi.stubGlobal('document', {
      querySelector: (selector: string) => {
        if (selector === '.bookmark-sortable-root') return mockSortableRoot;
        if (selector === '.bookmark-accordion-list') return mockAccordion;
        return null;
      },
      querySelectorAll: (selector: string) => {
        if (selector === '.bookmark-list-wrapper') return [mockWrapper];
        if (selector === '.group-container') return [];
        return [];
      },
    });

    const controller = useBookmarkSortables({
      bookmarks: ref([]),
      groups: ref([{ id: 'folder-1', name: 'Folder 1', order: 0 }]),
      listRenderKey: ref(0),
      trashZone: ref(null),
      isDragging: ref(false),
      isOverTrash: ref(false),
      enableDragScrollBlock: vi.fn(),
      disableDragScrollBlock: vi.fn(),
      execute: vi.fn(async () => true),
      showTrash: vi.fn(),
      hideTrash: vi.fn(),
    } as any);

    await controller.init();

    // Exactly 2 Sortable instances created: Folder (sortableRoot) and Bookmark (wrapper)
    expect(sortableCalls).toHaveLength(2);

    const folderCall = sortableCalls[0];
    const bookmarkCall = sortableCalls[1];

    expect(folderCall.element).toBe(mockSortableRoot);
    expect(bookmarkCall.element).toBe(mockWrapper);

    // Both instances share the exact same AutoScroll configuration
    for (const call of [folderCall, bookmarkCall]) {
      expect(call.options.scroll).toBe(mockAccordion);
      expect(call.options.forceAutoScrollFallback).toBe(true);
      expect(call.options.scrollSensitivity).toBe(48);
      expect(call.options.scrollSpeed).toBe(20);
      expect(call.options.bubbleScroll).toBe(false);
      // Strict guard against destructive forceFallback
      expect(call.options.forceFallback).toBeUndefined();
    }
  });

  describe('isDragEnabled lifecycle guard', () => {
    it('does not create Sortable instances when isDragEnabled is false on init', async () => {
      const mockAccordion = {
        nodeType: 1,
        classList: { contains: () => true },
      } as unknown as HTMLElement;
      vi.stubGlobal('document', {
        querySelector: (selector: string) =>
          selector === '.bookmark-accordion-list' ? mockAccordion : null,
        querySelectorAll: () => [],
      });

      const isDragEnabled = ref(false);
      const controller = useBookmarkSortables({
        bookmarks: ref([]),
        groups: ref([{ id: 'g-1', name: 'G1', order: 0 }]),
        listRenderKey: ref(0),
        trashZone: ref(null),
        isDragging: ref(false),
        isOverTrash: ref(false),
        enableDragScrollBlock: vi.fn(),
        disableDragScrollBlock: vi.fn(),
        execute: vi.fn(async () => true),
        showTrash: vi.fn(),
        hideTrash: vi.fn(),
        isDragEnabled,
      } as any);

      await controller.init();
      expect(createSortable).not.toHaveBeenCalled();
    });

    it('destroys active Sortable instances when isDragEnabled transitions true -> false and rebinds on true', async () => {
      const destroySpy = vi.fn();
      createSortable.mockImplementation(() => ({
        destroy: destroySpy,
        option: vi.fn(),
      }));

      const mockAccordion = {
        nodeType: 1,
        classList: { contains: () => true },
      } as unknown as HTMLElement;
      vi.stubGlobal('document', {
        querySelector: (selector: string) =>
          selector === '.bookmark-accordion-list' ? mockAccordion : null,
        querySelectorAll: () => [],
      });

      const isDragEnabled = ref(true);
      const controller = useBookmarkSortables({
        bookmarks: ref([]),
        groups: ref([{ id: 'g-1', name: 'G1', order: 0 }]),
        listRenderKey: ref(0),
        trashZone: ref(null),
        isDragging: ref(false),
        isOverTrash: ref(false),
        enableDragScrollBlock: vi.fn(),
        disableDragScrollBlock: vi.fn(),
        execute: vi.fn(async () => true),
        showTrash: vi.fn(),
        hideTrash: vi.fn(),
        isDragEnabled,
      } as any);

      await controller.init();
      expect(createSortable).toHaveBeenCalledTimes(1);

      // Search active: isDragEnabled true -> false
      isDragEnabled.value = false;
      await nextTick();
      expect(destroySpy).toHaveBeenCalled();

      // Calling init while disabled must not re-create
      createSortable.mockClear();
      await controller.init();
      expect(createSortable).not.toHaveBeenCalled();

      // Search cleared: isDragEnabled false -> true
      isDragEnabled.value = true;
      await controller.init();
      expect(createSortable).toHaveBeenCalledTimes(1);
    });

    it('incrementally preserves unaffected folder Sortables when a single folder collapses or expands', async () => {
      const mockDestroy1 = vi.fn();
      const mockDestroy2 = vi.fn();
      const mockDestroy3 = vi.fn();

      const wrapper1 = { id: 'w1', getAttribute: () => 'group-1' } as any;
      const wrapper2 = { id: 'w2', getAttribute: () => 'group-2' } as any;
      const wrapper3 = { id: 'w3', getAttribute: () => 'group-3' } as any;

      let currentWrappers = [wrapper1, wrapper2];

      createSortable.mockImplementation((el: any) => {
        if (el === wrapper1) return { destroy: mockDestroy1, option: vi.fn() };
        if (el === wrapper2) return { destroy: mockDestroy2, option: vi.fn() };
        if (el === wrapper3) return { destroy: mockDestroy3, option: vi.fn() };
        return { destroy: vi.fn(), option: vi.fn() };
      });

      vi.stubGlobal('document', {
        querySelector: () => null,
        querySelectorAll: (selector: string) =>
          selector === '.bookmark-list-wrapper' ? currentWrappers : [],
      });

      const controller = useBookmarkSortables({
        bookmarks: ref([]),
        groups: ref([
          { id: 'group-1', name: 'G1', order: 0 },
          { id: 'group-2', name: 'G2', order: 1 },
          { id: 'group-3', name: 'G3', order: 2 },
        ]),
        listRenderKey: ref(0),
        trashZone: ref(null),
        isDragging: ref(false),
        isOverTrash: ref(false),
        enableDragScrollBlock: vi.fn(),
        disableDragScrollBlock: vi.fn(),
        execute: vi.fn(async () => true),
        showTrash: vi.fn(),
        hideTrash: vi.fn(),
      } as any);

      // 1. Initial mount of folder 1 and 2
      await controller.init();
      expect(createSortable).toHaveBeenCalledTimes(2);

      // 2. Folder 2 is collapsed: current wrappers only has wrapper1
      currentWrappers = [wrapper1];
      createSortable.mockClear();
      await controller.init();

      // wrapper1 is preserved untouched: NOT destroyed, NOT re-created!
      expect(mockDestroy1).not.toHaveBeenCalled();
      expect(createSortable).not.toHaveBeenCalled();
      // wrapper2 is pruned
      expect(mockDestroy2).toHaveBeenCalledOnce();

      // 3. Folder 3 is expanded: current wrappers has wrapper1 and wrapper3
      currentWrappers = [wrapper1, wrapper3];
      mockDestroy1.mockClear();
      createSortable.mockClear();
      await controller.init();

      // wrapper1 is still preserved!
      expect(mockDestroy1).not.toHaveBeenCalled();
      // only wrapper3 is created!
      expect(createSortable).toHaveBeenCalledTimes(1);
    });
  });
});
