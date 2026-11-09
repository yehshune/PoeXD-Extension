import { ref, computed } from 'vue';

type SidebarRect = Pick<DOMRect, 'left' | 'right'>;

export function calculateDragTrashPosition(
  sidebarRect: SidebarRect,
  viewportWidth: number,
  gap = 12,
) {
  const isRight = viewportWidth - sidebarRect.right < sidebarRect.left;
  if (isRight) {
    return {
      right: `${Math.max(0, viewportWidth - sidebarRect.left) + gap}px`,
      left: 'auto',
    };
  }
  return {
    left: `${sidebarRect.right + gap}px`,
    right: 'auto',
  };
}

export function showDragTrash(
  trashEl: HTMLElement,
  viewportWidth = typeof document !== 'undefined'
    ? document.documentElement.clientWidth || window.innerWidth
    : 1440,
) {
  const sidebar = trashEl.closest<HTMLElement>('.pxd-sidebar-wrapper');
  if (sidebar) {
    const rect = sidebar.getBoundingClientRect();
    const isRight = viewportWidth - rect.right < rect.left;
    if (isRight) {
      trashEl.classList.remove?.('sidebar-left');
      trashEl.classList.add?.('sidebar-right');
    } else {
      trashEl.classList.remove?.('sidebar-right');
      trashEl.classList.add?.('sidebar-left');
    }
    Object.assign(trashEl.style, calculateDragTrashPosition(rect, viewportWidth));
  }
  trashEl.classList.add?.('visible');
}

export function hideDragTrash(trashEl: HTMLElement) {
  trashEl.classList.remove('visible');
}

export function scheduleAfterSortableDrop(work: () => void | Promise<void>) {
  setTimeout(() => void work(), 0);
}

export type DragKind = 'folder' | 'bookmark';

export interface ActiveDragEntity {
  kind: DragKind;
  id: string;
}

export function useDragTrash(listContainerSelector: string) {
  const isDragging = ref(false);
  const isOverTrash = ref(false);
  const trashZone = ref<HTMLElement | null>(null);
  const activeDragEntity = ref<ActiveDragEntity | null>(null);

  const setDragEntity = (entity: ActiveDragEntity | null) => {
    activeDragEntity.value = entity;
  };

  const trashStyle = computed(() => {
    void isDragging.value;
    const sidebar = trashZone.value?.closest<HTMLElement>('.pxd-sidebar-wrapper');
    if (!sidebar) return {};
    const clientWidth =
      typeof document !== 'undefined'
        ? document.documentElement.clientWidth || window.innerWidth
        : window.innerWidth;
    return calculateDragTrashPosition(sidebar.getBoundingClientRect(), clientWidth);
  });

  const preventDefaultScroll = (e: Event) => {
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    const isInsideList = path.some(
      (node) => node instanceof HTMLElement && node.matches?.(listContainerSelector),
    );
    if (isInsideList) {
      return; // 放行列表內部的滾動
    }
    const target = e.target as HTMLElement;
    if (target && target.closest && target.closest(listContainerSelector)) {
      return; // 相容性 fallback
    }
    e.preventDefault();
  };

  const enableDragScrollBlock = () => {
    window.addEventListener('wheel', preventDefaultScroll, { passive: false });
    window.addEventListener('touchmove', preventDefaultScroll, { passive: false });
  };

  const disableDragScrollBlock = () => {
    window.removeEventListener('wheel', preventDefaultScroll);
    window.removeEventListener('touchmove', preventDefaultScroll);
  };

  const setupTrashListeners = (trashEl: HTMLElement) => {
    if (!trashEl) return () => {};

    const onDragEnter = (e: DragEvent) => {
      e.preventDefault();
      trashEl.classList.add('drag-hover');
      isOverTrash.value = true;
    };

    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      trashEl.classList.add('drag-hover');
      isOverTrash.value = true;
    };

    const onDragLeave = (e: DragEvent) => {
      const rect = trashEl.getBoundingClientRect();
      // 物理邊界交叉檢查：只有滑鼠確實移出垃圾桶範圍，才取消高亮 hover 與 true 狀態
      if (
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom
      ) {
        trashEl.classList.remove('drag-hover');
        isOverTrash.value = false;
      }
    };

    const onDrop = (e: DragEvent) => {
      e.preventDefault();
    };

    if (!trashEl.dataset.hasDragListeners) {
      trashEl.addEventListener('dragenter', onDragEnter);
      trashEl.addEventListener('dragover', onDragOver);
      trashEl.addEventListener('dragleave', onDragLeave);
      trashEl.addEventListener('drop', onDrop);
      trashEl.dataset.hasDragListeners = 'true';
    }

    return () => {
      trashEl.removeEventListener('dragenter', onDragEnter);
      trashEl.removeEventListener('dragover', onDragOver);
      trashEl.removeEventListener('dragleave', onDragLeave);
      trashEl.removeEventListener('drop', onDrop);
      delete trashEl.dataset.hasDragListeners;
    };
  };

  return {
    trashZone,
    isDragging,
    isOverTrash,
    activeDragEntity,
    setDragEntity,
    trashStyle,
    enableDragScrollBlock,
    disableDragScrollBlock,
    setupTrashListeners,
  };
}
