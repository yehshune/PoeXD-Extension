// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

const { createSortable } = vi.hoisted(() => ({ createSortable: vi.fn() }));

vi.mock('sortablejs', () => ({
  default: { create: createSortable },
}));

import { useBookmarkSortables } from '@/components/sidebar/composables/useBookmarkSortables';

/**
 * 原生 HTML5 拖曳中按 Esc（或在不接受 drop 的位置放開）時，瀏覽器只會觸發 dragend，不會有 drop。
 * Sortable 對兩者都會呼叫 onEnd，originalEvent.type 分別是 'dragend' / 'drop'。
 * 取消的拖曳不能套用任何 mutation（移動、排序或刪除）。
 */
describe('Bookmark drag cancel (native dragend without drop)', () => {
  const containers: HTMLElement[] = [];

  afterEach(() => {
    containers.splice(0).forEach((el) => el.remove());
    createSortable.mockReset();
  });

  const settle = () => new Promise((r) => setTimeout(r, 20));

  function setupFolderDrag(options: { isOverTrash?: boolean } = {}) {
    const sortableOptions: any[] = [];
    createSortable.mockImplementation((_el: HTMLElement, opts: any) => {
      sortableOptions.push(opts);
      return { destroy: vi.fn(), option: vi.fn() };
    });

    const container = document.createElement('div');
    container.className = 'bookmark-sortable-root';
    document.body.appendChild(container);
    containers.push(container);

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
        }) as DOMRect;
      folderEl.appendChild(header);
      container.appendChild(folderEl);
      return { folderEl, header };
    };

    const fA = makeFolder('f-a', 100);
    const fB = makeFolder('f-b', 150);

    const wrapper = document.createElement('div');
    wrapper.className = 'bookmark-list-wrapper';
    wrapper.setAttribute('data-group-id', 'f-a');
    fA.folderEl.appendChild(wrapper);

    const execute = vi.fn(async () => true);
    const confirmSpy = vi.fn(async () => true);
    (window as any).poexdConfirm = confirmSpy;
    const listRenderKey = ref(0);
    const isOverTrash = ref(options.isOverTrash ?? false);

    const sortables = useBookmarkSortables({
      bookmarks: ref([
        {
          id: 'b-1',
          name: 'B1',
          url: '...',
          groupId: 'f-a',
          order: 0,
          createdAt: 1,
        },
        {
          id: 'b-2',
          name: 'B2',
          url: '...',
          groupId: 'f-a',
          order: 1,
          createdAt: 2,
        },
      ]),
      groups: ref([
        { id: 'f-a', name: 'Folder A', order: 0 },
        { id: 'f-b', name: 'Folder B', order: 1 },
      ]),
      listRenderKey,
      isDragging: ref(false),
      isOverTrash,
      beginDrag: vi.fn(),
      endDrag: vi.fn(),
      execute,
      containerRef: ref(container),
      elementFromPoint: () => fA.header,
    } as any);

    return {
      sortables,
      sortableOptions,
      fA,
      fB,
      wrapper,
      execute,
      confirmSpy,
      listRenderKey,
    };
  }

  it('cancelled folder drag does not execute move-folder even when an indicator was active', async () => {
    const { sortables, sortableOptions, fA, fB, execute, listRenderKey } = setupFolderDrag();
    await sortables.init();
    const folderOptions = sortableOptions[0];

    folderOptions.onStart({
      item: fB.folderEl,
      originalEvent: { clientX: 50 },
    });
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 50, clientY: 120 }));
    expect(fA.header.classList.contains('drop-indicator-inside')).toBe(true);

    folderOptions.onEnd({
      item: fB.folderEl,
      originalEvent: { type: 'dragend' },
    });
    await settle();

    expect(execute).not.toHaveBeenCalled();
    expect(fA.header.classList.contains('drop-indicator-inside')).toBe(false);
    // 仍會重繪一次，讓 DOM 回到 canonical 狀態
    expect(listRenderKey.value).toBeGreaterThan(0);
  });

  it('completed folder drop (drop event) still executes move-folder', async () => {
    const { sortables, sortableOptions, fA, fB, execute } = setupFolderDrag();
    await sortables.init();
    const folderOptions = sortableOptions[0];

    folderOptions.onStart({
      item: fB.folderEl,
      originalEvent: { clientX: 50 },
    });
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 50, clientY: 120 }));
    expect(fA.header.classList.contains('drop-indicator-inside')).toBe(true);

    folderOptions.onEnd({ item: fB.folderEl, originalEvent: { type: 'drop' } });

    await vi.waitFor(() =>
      expect(execute).toHaveBeenCalledWith({
        type: 'move-folder',
        folderId: 'f-b',
        dropIntent: { targetFolderId: 'f-a', position: 'inside' },
      }),
    );
  });

  it('cancelled folder drag over trash neither confirms nor deletes', async () => {
    const { sortables, sortableOptions, fB, execute, confirmSpy } = setupFolderDrag({
      isOverTrash: true,
    });
    await sortables.init();
    const folderOptions = sortableOptions[0];

    folderOptions.onStart({
      item: fB.folderEl,
      originalEvent: { clientX: 50 },
    });
    folderOptions.onEnd({
      item: fB.folderEl,
      originalEvent: { type: 'dragend' },
    });
    await settle();

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('cancelled bookmark drag does not reorder bookmarks', async () => {
    const { sortables, sortableOptions, wrapper, execute, listRenderKey } = setupFolderDrag();
    await sortables.init();
    const bookmarkOptions = sortableOptions[1];
    expect(bookmarkOptions.draggable).toBe('.bookmark-row-item');

    const item = document.createElement('div');
    item.setAttribute('data-id', 'b-1');
    bookmarkOptions.onStart({ item });
    bookmarkOptions.onEnd({
      item,
      from: wrapper,
      to: wrapper,
      newDraggableIndex: 1,
      originalEvent: { type: 'dragend' },
    });
    await settle();

    expect(execute).not.toHaveBeenCalled();
    expect(listRenderKey.value).toBeGreaterThan(0);
  });

  it('cancelled bookmark drag over trash does not delete the bookmark', async () => {
    const { sortables, sortableOptions, wrapper, execute } = setupFolderDrag({
      isOverTrash: true,
    });
    await sortables.init();
    const bookmarkOptions = sortableOptions[1];

    const item = document.createElement('div');
    item.setAttribute('data-id', 'b-1');
    bookmarkOptions.onStart({ item });
    bookmarkOptions.onEnd({
      item,
      from: wrapper,
      to: wrapper,
      originalEvent: { type: 'dragend' },
    });
    await settle();

    expect(execute).not.toHaveBeenCalled();
  });
});
