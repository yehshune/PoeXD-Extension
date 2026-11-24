import {
  computed,
  getCurrentInstance,
  getCurrentScope,
  onScopeDispose,
  onUnmounted,
  ref,
  shallowRef,
  watch,
  type ComputedRef,
  type Ref,
  type ShallowRef,
} from 'vue';

type SidebarRect = Pick<DOMRect, 'left' | 'right'>;

export interface DragTrashSession<TEntity = unknown> {
  trashZone: Ref<HTMLElement | null>;
  setTrashZoneRef: (target: unknown) => void;
  isDragging: Ref<boolean>;
  isOverTrash: Ref<boolean>;
  activeDragEntity: ShallowRef<TEntity | null>;
  trashStyle: ComputedRef<Record<string, string>>;
  beginDrag: (entity?: TEntity) => void;
  endDrag: () => void;
  dispose: () => void;
}

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

function resolveTrashZoneElement(target: unknown): HTMLElement | null {
  if (!target) return null;
  if (typeof HTMLElement !== 'undefined' && target instanceof HTMLElement) {
    return target;
  }
  if (typeof target === 'object' && '$el' in target) {
    const el = (target as { $el?: unknown }).$el;
    if (typeof HTMLElement !== 'undefined') {
      return el instanceof HTMLElement ? el : null;
    }
    return (el as HTMLElement | null) ?? null;
  }
  return null;
}

export function useDragTrash<TEntity = unknown>(
  listContainerSelector: string,
): DragTrashSession<TEntity> {
  const isDragging = ref(false);
  const isOverTrash = ref(false);
  const trashZone = ref<HTMLElement | null>(null);
  const activeDragEntity = shallowRef<TEntity | null>(null);

  const setTrashZoneRef = (target: unknown) => {
    trashZone.value = resolveTrashZoneElement(target);
  };

  const trashStyle = computed<Record<string, string>>(() => {
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
    const target = e.target as HTMLElement | null;
    if (target && target.closest && target.closest(listContainerSelector)) {
      return; // 相容性 fallback
    }
    e.preventDefault();
  };

  let isScrollBlocked = false;

  const enableDragScrollBlock = () => {
    if (isScrollBlocked || typeof window === 'undefined') return;
    window.addEventListener('wheel', preventDefaultScroll, { passive: false });
    window.addEventListener('touchmove', preventDefaultScroll, { passive: false });
    isScrollBlocked = true;
  };

  const disableDragScrollBlock = () => {
    if (!isScrollBlocked || typeof window === 'undefined') return;
    window.removeEventListener('wheel', preventDefaultScroll);
    window.removeEventListener('touchmove', preventDefaultScroll);
    isScrollBlocked = false;
  };

  const attachTrashListeners = (trashEl: HTMLElement) => {
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

    trashEl.addEventListener('dragenter', onDragEnter);
    trashEl.addEventListener('dragover', onDragOver);
    trashEl.addEventListener('dragleave', onDragLeave);
    trashEl.addEventListener('drop', onDrop);

    return () => {
      trashEl.removeEventListener('dragenter', onDragEnter);
      trashEl.removeEventListener('dragover', onDragOver);
      trashEl.removeEventListener('dragleave', onDragLeave);
      trashEl.removeEventListener('drop', onDrop);
    };
  };

  let trashCleanup: (() => void) | null = null;
  let boundTrashEl: HTMLElement | null = null;

  const detachTrashListeners = () => {
    if (boundTrashEl) {
      hideDragTrash(boundTrashEl);
      boundTrashEl.classList.remove('drag-hover');
    }
    trashCleanup?.();
    trashCleanup = null;
    boundTrashEl = null;
  };

  const stopTrashWatch = watch(
    trashZone,
    (el) => {
      if (el === boundTrashEl) return;
      detachTrashListeners();
      if (el) {
        boundTrashEl = el;
        trashCleanup = attachTrashListeners(el);
      }
    },
    { immediate: true, flush: 'sync' },
  );

  const beginDrag = (entity?: TEntity) => {
    activeDragEntity.value = entity ?? null;
    isDragging.value = true;
    isOverTrash.value = false;
    if (trashZone.value) {
      trashZone.value.classList.remove('drag-hover');
      showDragTrash(trashZone.value);
    }
    enableDragScrollBlock();
  };

  const endDrag = () => {
    if (trashZone.value) {
      hideDragTrash(trashZone.value);
      trashZone.value.classList.remove('drag-hover');
    }
    isDragging.value = false;
    isOverTrash.value = false;
    activeDragEntity.value = null;
    disableDragScrollBlock();
  };

  const dispose = () => {
    endDrag();
    stopTrashWatch();
    detachTrashListeners();
  };

  if (getCurrentInstance()) {
    onUnmounted(dispose);
  } else if (getCurrentScope()) {
    onScopeDispose(dispose);
  }

  return {
    trashZone,
    setTrashZoneRef,
    isDragging,
    isOverTrash,
    activeDragEntity,
    trashStyle,
    beginDrag,
    endDrag,
    dispose,
  };
}
