import {
  getCurrentInstance,
  getCurrentScope,
  nextTick,
  onMounted,
  onScopeDispose,
  onUnmounted,
  watch,
  type ComputedRef,
  type Ref,
} from 'vue';
import Sortable from 'sortablejs';
import { scheduleAfterSortableDrop, useDragTrash } from './useDragTrash';

type SidebarDragScrollOptions = Pick<
  Sortable.Options,
  'scroll' | 'forceAutoScrollFallback' | 'scrollSensitivity' | 'scrollSpeed' | 'bubbleScroll'
>;

/**
 * 側邊欄清單拖曳時靠近上下邊緣自動捲動的 Sortable 設定。
 * 側邊欄在 shadow root 內，瀏覽器原生的拖曳自動捲動不會作用，因此強制使用 Sortable 的 fallback，
 * 並指定實際捲動的 viewport，避免冒泡去捲動官方頁面。
 */
export function createSidebarDragScrollOptions(
  scrollEl: HTMLElement | null,
): SidebarDragScrollOptions {
  return {
    scroll: scrollEl ?? undefined,
    forceAutoScrollFallback: true,
    scrollSensitivity: 48,
    scrollSpeed: 20,
    bubbleScroll: false,
  };
}

/**
 * 依拖曳結果把 id 從 from 位置移到 to 位置，回傳新陣列（不修改輸入）。
 * 索引超出範圍或位置不變時回傳原順序的複本。
 */
export function moveListId(ids: readonly string[], from: number, to: number): string[] {
  const inRange = (i: number) => Number.isInteger(i) && i >= 0 && i < ids.length;
  if (!inRange(from) || !inRange(to) || from === to) return [...ids];
  const without = ids.filter((_, i) => i !== from);
  return [...without.slice(0, to), ids[from], ...without.slice(to)];
}

export type SortableListInstance = Pick<Sortable, 'destroy' | 'option'>;

export type CreateSortableFn = (el: HTMLElement, options: Sortable.Options) => SortableListInstance;

export type ScheduleDropFn = (work: () => void | Promise<void>) => void;

export interface SortableTrashListOptions {
  listRef: Readonly<Ref<HTMLElement | null>>;
  scrollSelector: string;
  draggableSelector: string;
  handle?: string;
  filter?: string;
  canDrag: Readonly<Ref<boolean>>;
  hasItems: Readonly<Ref<boolean>>;
  getItemId: (el: HTMLElement) => string | undefined;
  getOrderedIds: () => readonly string[];
  onReorder: (nextIds: string[]) => void | Promise<void>;
  onTrashDrop: (itemId: string) => void | Promise<void>;
  createSortable?: CreateSortableFn;
  scheduleDrop?: ScheduleDropFn;
}

export interface SortableTrashListSession {
  setTrashZoneRef: (target: unknown) => void;
  isDragging: Ref<boolean>;
  isOverTrash: Ref<boolean>;
  trashStyle: ComputedRef<Record<string, string>>;
  dispose: () => void;
}

export function useSortableTrashList(options: SortableTrashListOptions): SortableTrashListSession {
  const createSortable: CreateSortableFn =
    options.createSortable ?? ((el, sortableOptions) => Sortable.create(el, sortableOptions));
  const scheduleDrop: ScheduleDropFn = options.scheduleDrop ?? scheduleAfterSortableDrop;

  const dragTrash = useDragTrash(options.scrollSelector);

  let sortable: SortableListInstance | null = null;
  let disposed = false;

  const destroySortable = () => {
    sortable?.destroy();
    sortable = null;
  };

  const initSortable = () => {
    if (disposed) return;
    destroySortable();
    const listEl = options.listRef.value;
    if (!listEl) return;

    sortable = createSortable(listEl, {
      animation: 200,
      draggable: options.draggableSelector,
      ...(options.handle ? { handle: options.handle } : {}),
      ghostClass: 'sortable-ghost',
      ...(options.filter ? { filter: options.filter, preventOnFilter: false } : {}),
      disabled: !options.canDrag.value,
      ...createSidebarDragScrollOptions(listEl.closest<HTMLElement>(options.scrollSelector)),
      onStart: () => {
        dragTrash.beginDrag();
      },
      onEnd: (event) => {
        const droppedOverTrash = dragTrash.isOverTrash.value;
        const { oldIndex, newIndex, item, from } = event;
        const itemId = options.getItemId(item);
        dragTrash.endDrag();
        if (typeof oldIndex !== 'number') return;
        // 先把 DOM 還原，交由 Vue 依資料重新渲染，避免 Sortable 與 Vue 的 DOM 狀態不一致
        if (typeof newIndex === 'number' && newIndex !== oldIndex) {
          const reference = from.children[oldIndex < newIndex ? oldIndex : oldIndex + 1] ?? null;
          from.insertBefore(item, reference);
        }
        const ids = options.getOrderedIds();
        scheduleDrop(async () => {
          if (droppedOverTrash) {
            if (itemId) await options.onTrashDrop(itemId);
            return;
          }
          if (typeof newIndex !== 'number' || newIndex === oldIndex) return;
          await options.onReorder(moveListId(ids, oldIndex, newIndex));
        });
      },
    });
  };

  const stopCanDragWatch = watch(options.canDrag, (enabled) => {
    sortable?.option('disabled', !enabled);
  });

  let pendingInit = false;
  const scheduleInit = () => {
    if (disposed || pendingInit) return;
    pendingInit = true;
    void nextTick(() => {
      pendingInit = false;
      initSortable();
    });
  };

  const stopListWatch = watch([options.listRef, options.hasItems], scheduleInit);

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    stopCanDragWatch();
    stopListWatch();
    destroySortable();
    dragTrash.dispose();
  };

  if (getCurrentInstance()) {
    onMounted(scheduleInit);
    onUnmounted(dispose);
  } else {
    if (getCurrentScope()) {
      onScopeDispose(dispose);
    }
    initSortable();
  }

  return {
    setTrashZoneRef: dragTrash.setTrashZoneRef,
    isDragging: dragTrash.isDragging,
    isOverTrash: dragTrash.isOverTrash,
    trashStyle: dragTrash.trashStyle,
    dispose,
  };
}
