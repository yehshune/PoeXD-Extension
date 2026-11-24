// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref, type Ref } from 'vue';
import type Sortable from 'sortablejs';
import {
  moveListId,
  useSortableTrashList,
  type CreateSortableFn,
} from '@/components/sidebar/composables/useSortableTrashList';

const SCROLL_SELECTOR = '[data-pane="test-list"] [data-slot="sidebar-pane-scroll"]';

function buildFixture(ids: string[]) {
  const sidebar = document.createElement('div');
  sidebar.className = 'pxd-sidebar-wrapper';
  sidebar.getBoundingClientRect = () =>
    ({
      left: 0,
      right: 360,
      top: 0,
      bottom: 800,
      width: 360,
      height: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;

  const scrollEl = document.createElement('div');
  scrollEl.setAttribute('data-pane', 'test-list');
  const scrollViewport = document.createElement('div');
  scrollViewport.setAttribute('data-slot', 'sidebar-pane-scroll');
  scrollEl.appendChild(scrollViewport);

  const listEl = document.createElement('ul');
  for (const id of ids) {
    const li = document.createElement('li');
    li.dataset.itemId = id;
    li.textContent = id;
    listEl.appendChild(li);
  }
  scrollViewport.appendChild(listEl);

  const trashEl = document.createElement('div');
  trashEl.className = 'drag-trash-zone';
  trashEl.getBoundingClientRect = () =>
    ({
      left: 372,
      right: 462,
      top: 80,
      bottom: 680,
      width: 90,
      height: 600,
      x: 372,
      y: 80,
      toJSON: () => ({}),
    }) as DOMRect;

  sidebar.appendChild(scrollEl);
  sidebar.appendChild(trashEl);
  document.body.appendChild(sidebar);

  return { sidebar, scrollViewport, listEl, trashEl };
}

function createTestSession(
  ids: string[],
  overrides: {
    handle?: string;
    filter?: string;
    canDrag?: Ref<boolean>;
    hasItems?: Ref<boolean>;
    createSortable?: CreateSortableFn;
  } = {},
) {
  const fixture = buildFixture(ids);
  let capturedOptions: Sortable.Options | undefined;
  const destroySpy = vi.fn();
  const optionSpy = vi.fn();
  const onReorder = vi.fn();
  const onTrashDrop = vi.fn();

  const createSortable =
    overrides.createSortable ??
    vi.fn<CreateSortableFn>((_el, opts) => {
      capturedOptions = opts;
      return { destroy: destroySpy, option: optionSpy };
    });

  const session = useSortableTrashList({
    listRef: ref<HTMLElement | null>(fixture.listEl),
    scrollSelector: SCROLL_SELECTOR,
    draggableSelector: '[data-item-id]',
    handle: overrides.handle,
    filter: overrides.filter,
    canDrag: overrides.canDrag ?? ref(true),
    hasItems: overrides.hasItems ?? ref(true),
    getItemId: (el) => el.dataset.itemId,
    getOrderedIds: () => ids,
    onReorder,
    onTrashDrop,
    createSortable,
    scheduleDrop: (work) => {
      void work();
    },
  });
  session.setTrashZoneRef(fixture.trashEl);

  return {
    ...fixture,
    session,
    onReorder,
    onTrashDrop,
    destroySpy,
    optionSpy,
    createSortable,
    getOptions: () => capturedOptions,
  };
}

function childIds(listEl: HTMLElement): string[] {
  return Array.from(listEl.children).map((el) => (el as HTMLElement).dataset.itemId ?? '');
}

describe('moveListId', () => {
  const ids = ['a', 'b', 'c', 'd'];

  it('moves an id down or up without mutating the input', () => {
    expect(moveListId(ids, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveListId(ids, 3, 1)).toEqual(['a', 'd', 'b', 'c']);
    expect(ids).toEqual(['a', 'b', 'c', 'd']);
  });

  it('keeps the order for no-op or out-of-range moves', () => {
    expect(moveListId(ids, 1, 1)).toEqual(ids);
    expect(moveListId(ids, -1, 2)).toEqual(ids);
    expect(moveListId(ids, 0, 9)).toEqual(ids);
  });
});

describe('useSortableTrashList', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('shows trash zone, sets isDragging, and blocks window scroll outside the list onStart', () => {
    const { scrollViewport, trashEl, session, getOptions } = createTestSession(['a', 'b', 'c'], {
      handle: '.drag-handle',
      filter: 'button, input',
    });

    const capturedOptions = getOptions();
    capturedOptions?.onStart?.({} as Sortable.SortableEvent);

    expect(session.isDragging.value).toBe(true);
    expect(trashEl.classList.contains('visible')).toBe(true);
    expect(capturedOptions?.handle).toBe('.drag-handle');
    expect(capturedOptions?.filter).toBe('button, input');
    expect(capturedOptions?.preventOnFilter).toBe(false);
    expect(capturedOptions?.scroll).toBe(scrollViewport);

    // Window scroll outside the list is prevented
    const outsideWheel = new Event('wheel', { cancelable: true, bubbles: true });
    window.dispatchEvent(outsideWheel);
    expect(outsideWheel.defaultPrevented).toBe(true);

    // Wheel inside the list scroll container is allowed
    const insideWheel = new Event('wheel', { cancelable: true, bubbles: true });
    scrollViewport.dispatchEvent(insideWheel);
    expect(insideWheel.defaultPrevented).toBe(false);

    session.dispose();
  });

  it('restores DOM order, ends drag, calls onTrashDrop and skips onReorder when dropped over trash', () => {
    const { listEl, trashEl, session, onReorder, onTrashDrop, getOptions } = createTestSession([
      'a',
      'b',
      'c',
    ]);

    getOptions()?.onStart?.({} as Sortable.SortableEvent);
    trashEl.dispatchEvent(new Event('dragenter', { cancelable: true }));
    expect(session.isOverTrash.value).toBe(true);
    expect(trashEl.classList.contains('drag-hover')).toBe(true);

    // Simulate Sortable moving item 'a' (index 0) to index 2 before drop on trash
    const itemA = listEl.children[0] as HTMLElement;
    listEl.appendChild(itemA);
    expect(childIds(listEl)).toEqual(['b', 'c', 'a']);

    getOptions()?.onEnd?.({
      item: itemA,
      from: listEl,
      oldIndex: 0,
      newIndex: 2,
    } as unknown as Sortable.SortableEvent);

    expect(childIds(listEl)).toEqual(['a', 'b', 'c']);
    expect(session.isDragging.value).toBe(false);
    expect(session.isOverTrash.value).toBe(false);
    expect(trashEl.classList.contains('visible')).toBe(false);
    expect(trashEl.classList.contains('drag-hover')).toBe(false);
    expect(onTrashDrop).toHaveBeenCalledWith('a');
    expect(onReorder).not.toHaveBeenCalled();

    session.dispose();
  });

  it('restores DOM order accurately and calls onReorder on forward and backward moves', () => {
    const { listEl, session, onReorder, onTrashDrop, getOptions } = createTestSession([
      'a',
      'b',
      'c',
      'd',
    ]);

    // Forward move: 'a' from 0 -> 2 (Sortable mutates DOM to [b, c, a, d])
    const itemA = listEl.children[0] as HTMLElement;
    listEl.insertBefore(itemA, listEl.children[3]);
    expect(childIds(listEl)).toEqual(['b', 'c', 'a', 'd']);

    getOptions()?.onStart?.({} as Sortable.SortableEvent);
    getOptions()?.onEnd?.({
      item: itemA,
      from: listEl,
      oldIndex: 0,
      newIndex: 2,
    } as unknown as Sortable.SortableEvent);

    expect(childIds(listEl)).toEqual(['a', 'b', 'c', 'd']);
    expect(onReorder).toHaveBeenLastCalledWith(['b', 'c', 'a', 'd']);
    expect(onTrashDrop).not.toHaveBeenCalled();

    // Backward move: 'd' from 3 -> 1 (Sortable mutates DOM to [a, d, b, c])
    const itemD = listEl.children[3] as HTMLElement;
    listEl.insertBefore(itemD, listEl.children[1]);
    expect(childIds(listEl)).toEqual(['a', 'd', 'b', 'c']);

    getOptions()?.onStart?.({} as Sortable.SortableEvent);
    getOptions()?.onEnd?.({
      item: itemD,
      from: listEl,
      oldIndex: 3,
      newIndex: 1,
    } as unknown as Sortable.SortableEvent);

    expect(childIds(listEl)).toEqual(['a', 'b', 'c', 'd']);
    expect(onReorder).toHaveBeenLastCalledWith(['a', 'd', 'b', 'c']);
    expect(onTrashDrop).not.toHaveBeenCalled();

    session.dispose();
  });

  it('treats unchanged index or missing oldIndex as a safe no-op after endDrag', () => {
    const { listEl, session, onReorder, onTrashDrop, getOptions } = createTestSession(['a', 'b']);

    const itemA = listEl.children[0] as HTMLElement;
    getOptions()?.onStart?.({} as Sortable.SortableEvent);
    getOptions()?.onEnd?.({
      item: itemA,
      from: listEl,
      oldIndex: 0,
      newIndex: 0,
    } as unknown as Sortable.SortableEvent);

    expect(session.isDragging.value).toBe(false);
    expect(onReorder).not.toHaveBeenCalled();
    expect(onTrashDrop).not.toHaveBeenCalled();

    getOptions()?.onStart?.({} as Sortable.SortableEvent);
    getOptions()?.onEnd?.({
      item: itemA,
      from: listEl,
      oldIndex: undefined,
      newIndex: 1,
    } as unknown as Sortable.SortableEvent);

    expect(session.isDragging.value).toBe(false);
    expect(onReorder).not.toHaveBeenCalled();
    expect(onTrashDrop).not.toHaveBeenCalled();

    session.dispose();
  });

  it('syncs canDrag into Sortable disabled option and re-initializes when hasItems changes', async () => {
    const canDrag = ref(true);
    const hasItems = ref(true);
    const { session, createSortable, optionSpy, destroySpy } = createTestSession(['a', 'b'], {
      canDrag,
      hasItems,
    });

    expect(createSortable).toHaveBeenCalledTimes(1);

    canDrag.value = false;
    await nextTick();
    expect(optionSpy).toHaveBeenCalledWith('disabled', true);

    canDrag.value = true;
    await nextTick();
    expect(optionSpy).toHaveBeenCalledWith('disabled', false);

    hasItems.value = false;
    await nextTick();
    await nextTick();
    expect(destroySpy).toHaveBeenCalledTimes(1);
    expect(createSortable).toHaveBeenCalledTimes(2);

    session.dispose();
  });

  it('cleans up active drag state, scroll lock, Sortable, and trash listeners on explicit dispose() mid-drag', () => {
    const { trashEl, session, destroySpy, getOptions } = createTestSession(['a', 'b']);

    getOptions()?.onStart?.({} as Sortable.SortableEvent);
    trashEl.dispatchEvent(new Event('dragenter', { cancelable: true }));
    expect(session.isDragging.value).toBe(true);
    expect(session.isOverTrash.value).toBe(true);
    expect(trashEl.classList.contains('visible')).toBe(true);
    expect(trashEl.classList.contains('drag-hover')).toBe(true);

    session.dispose();

    expect(destroySpy).toHaveBeenCalledOnce();
    expect(session.isDragging.value).toBe(false);
    expect(session.isOverTrash.value).toBe(false);
    expect(trashEl.classList.contains('visible')).toBe(false);
    expect(trashEl.classList.contains('drag-hover')).toBe(false);

    const wheelAfterDispose = new Event('wheel', { cancelable: true, bubbles: true });
    window.dispatchEvent(wheelAfterDispose);
    expect(wheelAfterDispose.defaultPrevented).toBe(false);

    trashEl.dispatchEvent(new Event('dragenter', { cancelable: true }));
    expect(session.isOverTrash.value).toBe(false);
    expect(trashEl.classList.contains('drag-hover')).toBe(false);
  });

  it('initializes once on component mount and cleans up mid-drag state on unmount with template refs', async () => {
    let capturedOptions: Sortable.Options | undefined;
    const destroySpy = vi.fn();
    const createSortable = vi.fn<CreateSortableFn>((_el, opts) => {
      capturedOptions = opts;
      return { destroy: destroySpy, option: vi.fn() };
    });

    let exposedSession: ReturnType<typeof useSortableTrashList> | undefined;
    let mountedTrashEl: HTMLElement | null = null;
    const TestHost = defineComponent({
      setup() {
        const listRef = ref<HTMLElement | null>(null);
        exposedSession = useSortableTrashList({
          listRef,
          scrollSelector: SCROLL_SELECTOR,
          draggableSelector: '[data-item-id]',
          canDrag: ref(true),
          hasItems: ref(true),
          getItemId: (el) => el.dataset.itemId,
          getOrderedIds: () => ['a', 'b'],
          onReorder: vi.fn(),
          onTrashDrop: vi.fn(),
          createSortable,
        });
        return () =>
          h('div', { class: 'pxd-sidebar-wrapper' }, [
            h('div', { 'data-pane': 'test-list' }, [
              h('div', { 'data-slot': 'sidebar-pane-scroll' }, [
                h('ul', {
                  ref: (el: unknown) => {
                    listRef.value = el instanceof HTMLElement ? el : null;
                  },
                }),
              ]),
            ]),
            h('div', {
              class: 'drag-trash-zone',
              ref: (el: unknown) => {
                if (el instanceof HTMLElement) mountedTrashEl = el;
                exposedSession!.setTrashZoneRef(el);
              },
            }),
          ]);
      },
    });

    const mountTarget = document.createElement('div');
    document.body.appendChild(mountTarget);
    const app = createApp(TestHost);
    app.mount(mountTarget);
    await nextTick();
    await nextTick();

    expect(createSortable).toHaveBeenCalledTimes(1);
    const trashEl = mountedTrashEl!;

    // Start dragging and hover over trash
    capturedOptions?.onStart?.({} as Sortable.SortableEvent);
    trashEl.dispatchEvent(new Event('dragenter', { cancelable: true }));
    expect(exposedSession!.isDragging.value).toBe(true);
    expect(exposedSession!.isOverTrash.value).toBe(true);
    expect(trashEl.classList.contains('visible')).toBe(true);
    expect(trashEl.classList.contains('drag-hover')).toBe(true);

    // Unmount mid-drag (Vue clears template refs before onUnmounted)
    app.unmount();

    expect(destroySpy).toHaveBeenCalledOnce();
    expect(exposedSession!.isDragging.value).toBe(false);
    expect(exposedSession!.isOverTrash.value).toBe(false);
    expect(trashEl.classList.contains('visible')).toBe(false);
    expect(trashEl.classList.contains('drag-hover')).toBe(false);

    // Window scroll lock is released
    const wheelAfterUnmount = new Event('wheel', { cancelable: true, bubbles: true });
    window.dispatchEvent(wheelAfterUnmount);
    expect(wheelAfterUnmount.defaultPrevented).toBe(false);

    // Trash listeners are detached
    trashEl.dispatchEvent(new Event('dragenter', { cancelable: true }));
    expect(exposedSession!.isOverTrash.value).toBe(false);
    expect(trashEl.classList.contains('drag-hover')).toBe(false);
  });
});
