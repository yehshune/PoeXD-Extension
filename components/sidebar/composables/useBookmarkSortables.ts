import { nextTick, ref, watch, type Ref } from 'vue';
import Sortable from 'sortablejs';
import type { Bookmark, BookmarkGroup } from '../bookmark-types';
import type { BookmarkMutationIntent } from '../bookmark-model';
import { scheduleAfterSortableDrop, type ActiveDragEntity } from './useDragTrash';
import { createSidebarDragScrollOptions } from './sidebar-drag-scroll';
import {
  getFolderSubtreeIds,
  getFolderDeleteImpact,
  isDirectlyDeletableEmptyFolder,
  resolveFolderDropPlacement,
  type FolderDropIntent,
} from '@/utils/bookmark-collection';
import {
  projectTreeDrop,
  getVisibleFlattenedFolders,
  getFolderDepth,
  type TreeProjectionResult,
} from './bookmark-tree-projection';

export interface BookmarkSortableOptions {
  bookmarks: Readonly<Ref<readonly Bookmark[]>>;
  groups: Readonly<Ref<readonly BookmarkGroup[]>>;
  listRenderKey: Ref<number>;
  trashZone: Ref<HTMLElement | null>;
  isDragging: Ref<boolean>;
  isOverTrash: Ref<boolean>;
  enableDragScrollBlock: () => void;
  disableDragScrollBlock: () => void;
  showTrash: () => void;
  hideTrash: () => void;
  execute: (intent: BookmarkMutationIntent) => Promise<boolean>;
  containerRef?: Readonly<Ref<HTMLElement | null>>;
  isDragEnabled?: Readonly<Ref<boolean>>;
  elementFromPoint?: (x: number, y: number) => Element | null;
  collapsedGroupIds?: Readonly<Ref<ReadonlySet<string>>>;
  transientExpandedFolderIds?: Ref<Set<string>>;
  onTransientExpand?: (folderId: string) => void;
  indentationWidth?: number;
  setDragEntity?: (entity: ActiveDragEntity | null) => void;
}

function readCssVarNumber(el: HTMLElement, varName: string): number {
  let current: Element | null = el;
  while (current) {
    const style = window.getComputedStyle(current);
    const raw = style.getPropertyValue(varName);
    if (raw) {
      const val = parseFloat(raw);
      if (Number.isFinite(val) && val > 0) return val;
    }
    if (current instanceof HTMLElement && current.style) {
      const inlineRaw = current.style.getPropertyValue(varName);
      if (inlineRaw) {
        const val = parseFloat(inlineRaw);
        if (Number.isFinite(val) && val > 0) return val;
      }
    }
    if (current.parentElement) {
      current = current.parentElement;
    } else {
      const rootNode = current.getRootNode?.();
      if (rootNode && rootNode !== current && 'host' in rootNode) {
        current = (rootNode as ShadowRoot).host as Element;
      } else {
        break;
      }
    }
  }

  const docEl = el.ownerDocument?.documentElement;
  if (docEl) {
    const raw = window.getComputedStyle(docEl).getPropertyValue(varName);
    if (raw) {
      const val = parseFloat(raw);
      if (Number.isFinite(val) && val > 0) return val;
    }
    if (docEl.style) {
      const inlineRaw = docEl.style.getPropertyValue(varName);
      if (inlineRaw) {
        const val = parseFloat(inlineRaw);
        if (Number.isFinite(val) && val > 0) return val;
      }
    }
  }

  return 0;
}

/**
 * 依據當前 rendered DOM 與 CSS 變數動態測量樹狀每層縮排寬度 (Scale x Density)
 */
export function resolveTreeIndentationWidth(container: HTMLElement | null): number {
  if (!container || typeof window === 'undefined') {
    return 20;
  }

  // 1. 若 DOM 中已存在實際渲染的扁平兄弟資料夾，優先測量真實 left 差
  const containers = Array.from(
    container.querySelectorAll<HTMLElement>('.group-container[data-depth]'),
  );
  const rootContainer = containers.find((c) => c.getAttribute('data-depth') === '0');
  const childContainerFlat = containers.find((c) => {
    const d = parseInt(c.getAttribute('data-depth') ?? '0', 10);
    return d > 0;
  });
  if (rootContainer && childContainerFlat) {
    const depth = parseInt(childContainerFlat.getAttribute('data-depth') ?? '1', 10);
    const diff =
      (childContainerFlat.getBoundingClientRect().left -
        rootContainer.getBoundingClientRect().left) /
      (depth || 1);
    if (diff > 0) return Math.round(diff);
  }

  // 2. 從目前 runtime scale/density token 取得完整 nesting step (--pxd-space-lg + --pxd-space-md)
  const tokenLg = readCssVarNumber(container, '--pxd-space-lg');
  const tokenMd = readCssVarNumber(container, '--pxd-space-md');

  if (tokenLg > 0 && tokenMd > 0) {
    return Math.round(tokenLg + tokenMd);
  }

  const lgStep = tokenLg > 0 ? tokenLg : 12;
  const mdStep = tokenMd > 0 ? tokenMd : 8;

  const total = lgStep + mdStep;
  if (total > 0) {
    return Math.round(total);
  }

  return 20;
}

/**
 * 依據相鄰 rendered DOM 卡片或 runtime CSS 變數動態測量資料夾卡片之間的 gap (支援 UI Scale x Density)
 */
export function resolveFolderRowGap(
  container: HTMLElement | null,
  slotEl: HTMLElement,
  position: 'before' | 'after',
): number {
  if (typeof window !== 'undefined' && slotEl) {
    if (position === 'before') {
      const prevEl = slotEl.previousElementSibling as HTMLElement | null;
      if (prevEl && prevEl.classList.contains('group-container')) {
        const prevRect = prevEl.getBoundingClientRect();
        const currRect = slotEl.getBoundingClientRect();
        const measured = currRect.top - prevRect.bottom;
        if (measured > 0) return measured;
      }
    } else {
      const nextEl = slotEl.nextElementSibling as HTMLElement | null;
      if (nextEl && nextEl.classList.contains('group-container')) {
        const nextRect = nextEl.getBoundingClientRect();
        const currRect = slotEl.getBoundingClientRect();
        const measured = nextRect.top - currRect.bottom;
        if (measured > 0) return measured;
      }
    }
  }

  // Fallback to runtime CSS variables
  if (container) {
    const tokenBookmarkGap = readCssVarNumber(container, '--pxd-bookmark-tree-gap');
    if (tokenBookmarkGap > 0) return tokenBookmarkGap;
    const tokenGap = readCssVarNumber(container, '--pxd-row-gap');
    if (tokenGap > 0) return tokenGap;
    const tokenMd = readCssVarNumber(container, '--pxd-space-md');
    if (tokenMd > 0) return tokenMd;
  }
  return 8;
}

export interface FolderDropSlotTarget {
  slotContainer: HTMLElement;
  slotHeader: HTMLElement | null;
  indicatorPosition: 'before' | 'inside' | 'after';
  indentPx: number;
  offsetY: number;
}

/**
 * 依據最終 projection 結果解析出實際放置的 Slot 卡片與幾何定位
 */
export function resolveFolderDropSlotTarget(params: {
  containerEl: HTMLElement | null;
  hitContainer: HTMLElement;
  hitHeader: HTMLElement | null;
  folders: readonly BookmarkGroup[];
  effectiveCollapsedIds: ReadonlySet<string>;
  draggedFolderId: string;
  projection: TreeProjectionResult;
  indentStep: number;
}): FolderDropSlotTarget {
  const {
    containerEl,
    hitContainer,
    hitHeader,
    folders,
    effectiveCollapsedIds,
    draggedFolderId,
    projection,
    indentStep,
  } = params;

  if (projection.position === 'inside') {
    const slotFolderId = projection.dropIntent.targetFolderId;
    const slotContainer =
      (containerEl?.querySelector(
        `.group-container[data-group-id="${slotFolderId}"]`,
      ) as HTMLElement | null) ?? hitContainer;
    const slotHeader =
      (slotContainer.querySelector('.group-header-row') as HTMLElement | null) ?? hitHeader;
    return {
      slotContainer,
      slotHeader,
      indicatorPosition: 'inside',
      indentPx: 0,
      offsetY: 0,
    };
  }

  if (projection.position === 'before') {
    const slotFolderId = projection.dropIntent.targetFolderId;
    const slotContainer =
      (containerEl?.querySelector(
        `.group-container[data-group-id="${slotFolderId}"]`,
      ) as HTMLElement | null) ?? hitContainer;
    const slotHeader =
      (slotContainer.querySelector('.group-header-row') as HTMLElement | null) ?? hitHeader;
    const rawDepthAttr = slotContainer.getAttribute('data-depth');
    const slotDepth =
      rawDepthAttr !== null ? parseInt(rawDepthAttr, 10) : getFolderDepth(folders, slotFolderId);
    const indentPx = (projection.projectedDepth - slotDepth) * indentStep;
    const gap = resolveFolderRowGap(containerEl, slotContainer, 'before');
    const offsetY = -(gap / 2);
    return {
      slotContainer,
      slotHeader,
      indicatorPosition: 'before',
      indentPx,
      offsetY,
    };
  }

  // projection.position === 'after'
  // 若 targetFolder 有 visible descendants，插入線必須在整個 visible subtree 的最後一個 item 之後
  const visibleFolders = getVisibleFlattenedFolders(
    folders,
    effectiveCollapsedIds,
    draggedFolderId,
  );
  const targetIdx = visibleFolders.findIndex((f) => f.id === projection.dropIntent.targetFolderId);
  let lastVisibleItem = targetIdx !== -1 ? visibleFolders[targetIdx] : undefined;
  if (lastVisibleItem) {
    const subtreeIds = getFolderSubtreeIds(folders, projection.dropIntent.targetFolderId);
    for (let i = targetIdx + 1; i < visibleFolders.length; i++) {
      const item = visibleFolders[i];
      if (subtreeIds.has(item.id)) {
        lastVisibleItem = item;
      } else {
        break;
      }
    }
  }

  const slotFolderId = lastVisibleItem ? lastVisibleItem.id : projection.dropIntent.targetFolderId;
  const slotContainer =
    (containerEl?.querySelector(
      `.group-container[data-group-id="${slotFolderId}"]`,
    ) as HTMLElement | null) ?? hitContainer;
  const slotHeader =
    (slotContainer.querySelector('.group-header-row') as HTMLElement | null) ?? hitHeader;
  const rawDepthAttr = slotContainer.getAttribute('data-depth');
  const slotDepth =
    lastVisibleItem?.depth ??
    (rawDepthAttr !== null ? parseInt(rawDepthAttr, 10) : getFolderDepth(folders, slotFolderId));
  const indentPx = (projection.projectedDepth - slotDepth) * indentStep;
  const gap = resolveFolderRowGap(containerEl, slotContainer, 'after');
  const offsetY = -(gap / 2);

  return {
    slotContainer,
    slotHeader,
    indicatorPosition: 'after',
    indentPx,
    offsetY,
  };
}

export function resolveHitTestElement(
  container: ParentNode | null | undefined,
  clientX: number,
  clientY: number,
  customElementFromPoint?: (x: number, y: number) => Element | null,
): Element | null {
  if (customElementFromPoint) {
    return customElementFromPoint(clientX, clientY);
  }

  // 1. Resolve via container's root node (ShadowRoot in sidebar, Document otherwise)
  if (
    container &&
    'getRootNode' in container &&
    typeof (container as any).getRootNode === 'function'
  ) {
    const root = (container as any).getRootNode();
    if (root && typeof root.elementFromPoint === 'function') {
      const el = root.elementFromPoint(clientX, clientY);
      if (el) return el;
    }
  }

  // 2. Fall back to document.elementFromPoint with open shadow root penetration
  if (typeof document !== 'undefined' && typeof document.elementFromPoint === 'function') {
    let el = document.elementFromPoint(clientX, clientY);
    while (
      el &&
      (el as HTMLElement).shadowRoot &&
      typeof (el as HTMLElement).shadowRoot?.elementFromPoint === 'function'
    ) {
      const inner = (el as HTMLElement).shadowRoot!.elementFromPoint(clientX, clientY);
      if (!inner || inner === el) break;
      el = inner;
    }
    return el;
  }

  return null;
}

export interface BookmarkReorderParams {
  bookmarks: readonly Bookmark[];
  groups: readonly BookmarkGroup[];
  draggedBookmarkId: string;
  sourceGroupId?: string;
  targetGroupId?: string;
  newIndex?: number;
}

export function calculateBookmarkReorderPlacements(
  params: BookmarkReorderParams,
): Array<{ id: string; groupId: string; order: number }> | null {
  const { bookmarks, groups, draggedBookmarkId } = params;
  if (!draggedBookmarkId) return null;

  const draggedBookmark = bookmarks.find((b) => b.id === draggedBookmarkId);
  if (!draggedBookmark) return null;

  const targetGroupId = params.targetGroupId || draggedBookmark.groupId;
  if (
    !groups.some((g) => g.id === targetGroupId) &&
    !bookmarks.some((b) => b.groupId === targetGroupId)
  ) {
    return null;
  }

  // 1. Group bookmarks by folder in order
  const sortedGroups = groups.slice().sort((a, b) => a.order - b.order);
  const groupBookmarksMap = new Map<string, Bookmark[]>();

  for (const g of sortedGroups) {
    groupBookmarksMap.set(g.id, []);
  }
  for (const b of bookmarks) {
    if (!groupBookmarksMap.has(b.groupId)) {
      groupBookmarksMap.set(b.groupId, []);
    }
  }
  for (const b of bookmarks) {
    groupBookmarksMap.get(b.groupId)!.push(b);
  }
  for (const list of groupBookmarksMap.values()) {
    list.sort((a, b) => a.order - b.order);
  }

  // 2. Remove dragged bookmark from its current location
  let found = false;
  for (const list of groupBookmarksMap.values()) {
    const idx = list.findIndex((b) => b.id === draggedBookmarkId);
    if (idx !== -1) {
      list.splice(idx, 1);
      found = true;
      break;
    }
  }
  if (!found) return null;

  // 3. Insert into target group at newIndex
  const targetList = groupBookmarksMap.get(targetGroupId);
  if (!targetList) return null;

  let insertIndex = targetList.length;
  if (typeof params.newIndex === 'number' && !isNaN(params.newIndex)) {
    insertIndex = Math.max(0, Math.min(params.newIndex, targetList.length));
  }
  targetList.splice(insertIndex, 0, { ...draggedBookmark, groupId: targetGroupId });

  // 4. Generate deterministic placements in group order
  const placements: Array<{ id: string; groupId: string; order: number }> = [];
  for (const g of sortedGroups) {
    const list = groupBookmarksMap.get(g.id);
    if (list) {
      for (const b of list) {
        placements.push({
          id: b.id,
          groupId: g.id,
          order: placements.length,
        });
      }
    }
  }
  for (const [gid, list] of groupBookmarksMap.entries()) {
    if (!sortedGroups.some((g) => g.id === gid)) {
      for (const b of list) {
        placements.push({
          id: b.id,
          groupId: gid,
          order: placements.length,
        });
      }
    }
  }

  // 5. Ensure uniqueness and totality
  if (placements.length !== bookmarks.length) return null;
  const uniqueIds = new Set(placements.map((p) => p.id));
  if (uniqueIds.size !== bookmarks.length) return null;

  return placements;
}

export function useBookmarkSortables(options: BookmarkSortableOptions) {
  let folderSortables: Sortable[] = [];
  let boundFolderRoot: HTMLElement | null = null;
  const bookmarkSortableMap = new Map<HTMLElement, Sortable>();
  let lastFolderStructureKey = '';
  const isReconciling = ref(false);
  let activeDropIntent: FolderDropIntent | null = null;
  let activeIndicatorEl: HTMLElement | null = null;
  let activeContainerEl: HTMLElement | null = null;
  let cleanupPointerListeners: (() => void) | undefined;
  let dragStartX: number | null = null;
  let hoverExpandTimer: ReturnType<typeof setTimeout> | null = null;
  let hoverExpandTargetId: string | null = null;

  const internalTransientExpanded = ref<Set<string>>(new Set());
  const transientIds = options.transientExpandedFolderIds ?? internalTransientExpanded;

  const isEnabled = () => (options.isDragEnabled ? options.isDragEnabled.value : true);

  const getContainer = (): ParentNode => options.containerRef?.value ?? document;

  const clearHoverExpandTimer = () => {
    if (hoverExpandTimer) {
      clearTimeout(hoverExpandTimer);
      hoverExpandTimer = null;
    }
    hoverExpandTargetId = null;
  };

  const clearFolderDropIndicator = () => {
    if (activeIndicatorEl) {
      activeIndicatorEl.classList.remove(
        'drop-indicator-before',
        'drop-indicator-inside',
        'drop-indicator-after',
      );
      activeIndicatorEl.style.removeProperty('--drop-indicator-indent');
      activeIndicatorEl.style.removeProperty('--drop-indicator-offset-y');
      activeIndicatorEl = null;
    }
    if (activeContainerEl) {
      activeContainerEl.classList.remove(
        'drop-indicator-before',
        'drop-indicator-inside',
        'drop-indicator-after',
      );
      activeContainerEl.style.removeProperty('--drop-indicator-indent');
      activeContainerEl.style.removeProperty('--drop-indicator-offset-y');
      activeContainerEl = null;
    }
    activeDropIntent = null;
  };

  const updateFolderDropIntentFromPoint = (
    draggedFolderId: string,
    clientX: number,
    clientY: number,
  ) => {
    if (typeof document === 'undefined') return;
    if (options.isOverTrash.value) {
      clearFolderDropIndicator();
      clearHoverExpandTimer();
      return;
    }

    const containerEl = options.containerRef?.value ?? (getContainer() as HTMLElement | null);
    const elem = resolveHitTestElement(containerEl, clientX, clientY, options.elementFromPoint);

    // 1. 解析所屬 .group-container (支援命中 header、body、直屬書籤列與內部控制項)
    let targetContainer = elem?.closest('.group-container') as HTMLElement | null;
    if (!targetContainer && draggedFolderId) {
      // Self-Origin Gesture Corridor:
      // 當 pointer 維持在 dragged origin row 的垂直範圍內，向左跨入其左側 indentation gutter 時，
      // 仍以 dragged origin 作為 gesture sensor 進行 ancestor outdent 投影
      const originContainer = containerEl?.querySelector(
        `.group-container[data-group-id="${draggedFolderId}"]`,
      ) as HTMLElement | null;
      if (originContainer) {
        const originRect = originContainer.getBoundingClientRect();
        if (
          originRect.height > 0 &&
          clientY >= originRect.top &&
          clientY <= originRect.bottom &&
          clientX < originRect.left
        ) {
          targetContainer = originContainer;
        }
      }
    }

    if (!targetContainer) {
      clearFolderDropIndicator();
      clearHoverExpandTimer();
      return;
    }

    const targetFolderId = targetContainer.getAttribute('data-group-id');
    const subtreeIds = draggedFolderId
      ? getFolderSubtreeIds(options.groups.value, draggedFolderId)
      : new Set<string>();

    // 2. 排除無效 ID 與自身子樹後代（自身 card 僅可作為 self-origin outdent 的 gesture sensor）
    if (!targetFolderId || (targetFolderId !== draggedFolderId && subtreeIds.has(targetFolderId))) {
      clearFolderDropIndicator();
      clearHoverExpandTimer();
      return;
    }

    const targetHeader =
      (targetContainer.querySelector(':scope > .group-header-row') as HTMLElement | null) ??
      (targetContainer.querySelector('.group-header-row') as HTMLElement | null);
    if (!targetHeader) {
      clearFolderDropIndicator();
      clearHoverExpandTimer();
      return;
    }

    const containerRect = targetContainer.getBoundingClientRect();
    const headerRect = targetHeader.getBoundingClientRect();

    const cTop = containerRect.height > 0 ? containerRect.top : headerRect.top;
    const cBottom = containerRect.height > 0 ? containerRect.bottom : headerRect.bottom;
    const cHeight = containerRect.height > 0 ? containerRect.height : headerRect.height;
    const baseRowHeight = headerRect.height > 0 ? headerRect.height : cHeight > 0 ? cHeight : 40;

    if (cHeight <= 0) {
      clearFolderDropIndicator();
      clearHoverExpandTimer();
      return;
    }

    // 3. 計算 edge insertion zone 與 inside surface
    // Scale / Density 自適應：以標題行高的一定比例決定窄 edge，上限不超過 card 高度 1/3
    const edgeHeight = Math.max(
      4,
      Math.min(Math.round(baseRowHeight * 0.25), Math.floor(cHeight / 3)),
    );

    let dropPosition: 'before' | 'inside' | 'after';
    if (clientY <= cTop + edgeHeight) {
      dropPosition = 'before';
    } else if (clientY >= cBottom - edgeHeight) {
      dropPosition = 'after';
    } else {
      dropPosition = 'inside';
    }

    if (dragStartX === null) {
      dragStartX = clientX;
    }
    const horizontalOffset = clientX - dragStartX;

    // 動態解析每層縮排寬度 (支援 UI Scale / Density 變化)
    const indentStep = options.indentationWidth ?? resolveTreeIndentationWidth(containerEl);

    // 取得當前 effective 收合狀態 (排除拖曳中暫時展開的 transient 集合)
    const collapsedIds = options.collapsedGroupIds?.value ?? new Set<string>();
    const effectiveCollapsedIds = new Set<string>();
    for (const id of collapsedIds) {
      if (!transientIds.value.has(id)) {
        effectiveCollapsedIds.add(id);
      }
    }

    const projection = projectTreeDrop({
      folders: options.groups.value,
      collapsedFolderIds: effectiveCollapsedIds,
      draggedFolderId,
      targetFolderId,
      dropPosition,
      horizontalOffset,
      indentationWidth: indentStep,
    });

    if (!projection.ok) {
      clearFolderDropIndicator();
      clearHoverExpandTimer();
      return;
    }

    const validation = resolveFolderDropPlacement(
      options.groups.value,
      draggedFolderId,
      projection.dropIntent,
    );

    if (!validation.ok) {
      clearFolderDropIndicator();
      clearHoverExpandTimer();
      return;
    }

    // Transient auto-expand: 僅影響本次 drag，不寫 storage，不重置 Sortable
    if (
      effectiveCollapsedIds.has(targetFolderId) &&
      (projection.position === 'inside' || projection.projectedParentId === targetFolderId)
    ) {
      if (hoverExpandTargetId !== targetFolderId) {
        clearHoverExpandTimer();
        hoverExpandTargetId = targetFolderId;
        hoverExpandTimer = setTimeout(() => {
          if (hoverExpandTargetId === targetFolderId) {
            transientIds.value.add(targetFolderId);
            options.onTransientExpand?.(targetFolderId);
          }
        }, 500);
      }
    } else {
      clearHoverExpandTimer();
    }

    const slotTarget = resolveFolderDropSlotTarget({
      containerEl,
      hitContainer: targetContainer,
      hitHeader: targetHeader,
      folders: options.groups.value,
      effectiveCollapsedIds,
      draggedFolderId,
      projection,
      indentStep,
    });

    const currentIndent = activeContainerEl?.style.getPropertyValue('--drop-indicator-indent');
    const currentOffsetY = activeContainerEl?.style.getPropertyValue('--drop-indicator-offset-y');
    const newIndent = `${slotTarget.indentPx}px`;
    const newOffsetY = `${slotTarget.offsetY}px`;
    const indicatorPosition = slotTarget.indicatorPosition;

    if (
      activeContainerEl !== slotTarget.slotContainer ||
      activeIndicatorEl !== slotTarget.slotHeader ||
      activeDropIntent?.position !== projection.dropIntent.position ||
      activeDropIntent?.targetFolderId !== projection.dropIntent.targetFolderId ||
      currentIndent !== newIndent ||
      (indicatorPosition !== 'inside' && currentOffsetY !== newOffsetY)
    ) {
      clearFolderDropIndicator();

      slotTarget.slotContainer.classList.add(`drop-indicator-${indicatorPosition}`);
      slotTarget.slotContainer.style.setProperty('--drop-indicator-indent', newIndent);
      if (indicatorPosition !== 'inside') {
        slotTarget.slotContainer.style.setProperty('--drop-indicator-offset-y', newOffsetY);
      }

      if (slotTarget.slotHeader) {
        slotTarget.slotHeader.classList.add(`drop-indicator-${indicatorPosition}`);
        slotTarget.slotHeader.style.setProperty('--drop-indicator-indent', newIndent);
        if (indicatorPosition !== 'inside') {
          slotTarget.slotHeader.style.setProperty('--drop-indicator-offset-y', newOffsetY);
        }
      }

      activeContainerEl = slotTarget.slotContainer;
      activeIndicatorEl = slotTarget.slotHeader;
      activeDropIntent = projection.dropIntent;
    }
  };

  const cleanupDragState = () => {
    cleanupPointerListeners?.();
    clearHoverExpandTimer();
    transientIds.value.clear();
    dragStartX = null;
    clearFolderDropIndicator();

    const searchRoots: Array<{ querySelectorAll?: typeof document.querySelectorAll }> = [];
    if (options.containerRef?.value) searchRoots.push(options.containerRef.value);
    const container = getContainer();
    if (container && !searchRoots.includes(container)) searchRoots.push(container);
    if (typeof document !== 'undefined' && !searchRoots.includes(document)) {
      searchRoots.push(document);
    }
    for (const r of searchRoots) {
      if (typeof r.querySelectorAll === 'function') {
        r.querySelectorAll<HTMLElement>(
          '.dragging-subtree-origin, .dragging-subtree-descendant',
        ).forEach((el) => {
          el.classList?.remove?.('dragging-subtree-origin', 'dragging-subtree-descendant');
        });
      }
    }

    options.hideTrash();
    options.isDragging.value = false;
    options.isOverTrash.value = false;
    options.trashZone.value?.classList.remove('drag-hover');
    options.disableDragScrollBlock();
    options.setDragEntity?.(null);

    bookmarkSortableMap.forEach((sb) =>
      sb.option('group', {
        name: 'bookmarks-shared-pool',
        pull: true,
        put: true,
      }),
    );
  };

  const destroy = () => {
    cleanupDragState();
    folderSortables.forEach((sortable) => sortable.destroy());
    folderSortables = [];
    boundFolderRoot = null;
    bookmarkSortableMap.forEach((sortable) => sortable.destroy());
    bookmarkSortableMap.clear();
  };

  if (options.isDragEnabled) {
    watch(options.isDragEnabled, (enabled) => {
      if (!enabled) {
        destroy();
      }
    });
  }

  const startDrag = () => {
    options.showTrash();
    options.isDragging.value = true;
    options.enableDragScrollBlock();
  };

  const runSortableTransaction = async (performIntent?: () => Promise<boolean | void>) => {
    isReconciling.value = true;
    try {
      destroy();
      options.listRenderKey.value++;
      if (performIntent && isEnabled()) {
        await performIntent();
      }
    } catch {
      // Transaction error handled to guarantee clean DOM recovery
    } finally {
      await nextTick();
      isReconciling.value = false;
      await init();
    }
  };

  const createBookmarkSortableOptions = (accordion: HTMLElement | null): Sortable.Options => ({
    group: { name: 'bookmarks-shared-pool', pull: true, put: true },
    animation: 200,
    draggable: '.bookmark-row-item',
    ghostClass: 'sortable-ghost',
    filter: 'input',
    preventOnFilter: false,
    ...createSidebarDragScrollOptions(accordion),
    onStart: (event) => {
      startDrag();
      const bookmarkId = event?.item?.getAttribute?.('data-id') ?? '';
      options.setDragEntity?.({ kind: 'bookmark', id: bookmarkId });
    },
    onEnd: (event) => {
      const droppedOverTrash = options.isOverTrash.value;
      const bookmarkId = event.item.getAttribute('data-id');
      const targetWrapper =
        (event.to as HTMLElement)?.closest?.('.bookmark-list-wrapper') ?? (event.to as HTMLElement);
      const sourceWrapper =
        (event.from as HTMLElement)?.closest?.('.bookmark-list-wrapper') ??
        (event.from as HTMLElement);
      const targetGroupId = targetWrapper?.getAttribute?.('data-group-id') ?? undefined;
      const sourceGroupId = sourceWrapper?.getAttribute?.('data-group-id') ?? undefined;
      const newIndex =
        typeof event.newDraggableIndex === 'number'
          ? event.newDraggableIndex
          : typeof event.newIndex === 'number'
            ? event.newIndex
            : undefined;

      cleanupDragState();

      scheduleAfterSortableDrop(async () => {
        if (droppedOverTrash) {
          if (bookmarkId) {
            await runSortableTransaction(() =>
              options.execute({ type: 'delete-bookmark', bookmarkId }),
            );
          } else {
            await runSortableTransaction();
          }
        } else {
          if (bookmarkId) {
            const placements = calculateBookmarkReorderPlacements({
              bookmarks: options.bookmarks.value,
              groups: options.groups.value,
              draggedBookmarkId: bookmarkId,
              sourceGroupId,
              targetGroupId,
              newIndex,
            });
            if (placements) {
              await runSortableTransaction(() =>
                options.execute({ type: 'reorder-bookmarks', placements }),
              );
            } else {
              await runSortableTransaction();
            }
          } else {
            await runSortableTransaction();
          }
        }
      });
    },
  });

  const init = async () => {
    if (isReconciling.value) return;
    if (!isEnabled()) {
      destroy();
      return;
    }
    await nextTick();
    if (isReconciling.value) return;
    if (!isEnabled()) {
      destroy();
      return;
    }
    const currentFolderStructureKey = options.groups.value
      .map((g) => `${g.id}:${g.parentId ?? ''}:${g.order}`)
      .join(',');
    const isStructureChanged =
      lastFolderStructureKey !== '' && lastFolderStructureKey !== currentFolderStructureKey;
    lastFolderStructureKey = currentFolderStructureKey;

    if (options.isDragging.value || isStructureChanged) {
      destroy();
    }
    const accordion = getContainer().querySelector(
      '.bookmark-accordion-list',
    ) as HTMLElement | null;
    const rootEl = getContainer() as HTMLElement | null;
    const isSelfFolderContainer =
      typeof (rootEl as any)?.matches === 'function' &&
      Boolean((rootEl as any).matches('.bookmark-sortable-root, .bookmark-accordion-list'));
    const folderRoot =
      (rootEl?.querySelector?.('.bookmark-sortable-root') as HTMLElement | null) ??
      (isSelfFolderContainer ? rootEl : null) ??
      accordion;

    if (options.groups.value.length > 0 && folderRoot) {
      if (boundFolderRoot !== folderRoot || folderSortables.length === 0) {
        folderSortables.forEach((sortable) => sortable.destroy());
        folderSortables = [];
        boundFolderRoot = folderRoot;
        const sortable = Sortable.create(folderRoot, {
          group: 'folders-root-list',
          sort: false,
          onMove: () => false,
          animation: 0,
          handle: '.folder-drag-handle',
          draggable: '.group-container',
          ghostClass: 'sortable-ghost',
          filter: 'input',
          preventOnFilter: false,
          ...createSidebarDragScrollOptions(accordion),
          onStart: (event) => {
            startDrag();
            clearFolderDropIndicator();
            dragStartX = ((event as any)?.originalEvent as MouseEvent)?.clientX ?? null;
            event?.item?.classList?.add('dragging-subtree-origin');
            const draggedFolderId = event?.item?.getAttribute?.('data-group-id') ?? '';
            options.setDragEntity?.({ kind: 'folder', id: draggedFolderId });

            // 保持 subtree 視覺回饋：標記被拖曳項自身的所有後代子資料夾 DOM，保留原始 layout footprint
            const subtreeIds = draggedFolderId
              ? getFolderSubtreeIds(options.groups.value, draggedFolderId)
              : new Set<string>();

            if (subtreeIds.size > 1 && typeof folderRoot?.querySelectorAll === 'function') {
              folderRoot.querySelectorAll<HTMLElement>('.group-container').forEach((el) => {
                const gid = el.getAttribute('data-group-id');
                if (gid && gid !== draggedFolderId && subtreeIds.has(gid)) {
                  el.classList?.add?.('dragging-subtree-descendant');
                }
              });
            }

            bookmarkSortableMap.forEach((sb) =>
              sb.option('group', {
                name: 'bookmarks-shared-pool',
                pull: true,
                put: false,
              }),
            );

            const handlePointerMove = (e: MouseEvent) => {
              updateFolderDropIntentFromPoint(draggedFolderId, e.clientX, e.clientY);
            };
            const handleDragOver = (e: DragEvent) => {
              updateFolderDropIntentFromPoint(draggedFolderId, e.clientX, e.clientY);
            };
            if (typeof window !== 'undefined') {
              window.addEventListener('pointermove', handlePointerMove, { passive: true });
              window.addEventListener('dragover', handleDragOver, { passive: true });
            }

            cleanupPointerListeners = () => {
              if (typeof window !== 'undefined') {
                window.removeEventListener('pointermove', handlePointerMove);
                window.removeEventListener('dragover', handleDragOver);
              }
              cleanupPointerListeners = undefined;
            };
          },
          onEnd: (event) => {
            const finalDropIntent = activeDropIntent;
            const droppedOverTrash = options.isOverTrash.value;
            const folderId = event?.item?.getAttribute?.('data-group-id');

            cleanupDragState();

            scheduleAfterSortableDrop(async () => {
              if (droppedOverTrash) {
                const group = options.groups.value.find((item) => item.id === folderId);
                if (folderId && group) {
                  const impact = getFolderDeleteImpact(
                    options.groups.value,
                    options.bookmarks.value,
                    folderId,
                  );
                  if (isDirectlyDeletableEmptyFolder(impact)) {
                    await runSortableTransaction(() =>
                      options.execute({ type: 'delete-group', groupId: folderId }),
                    );
                  } else {
                    const message =
                      impact.descendantFolderCount > 0
                        ? `確定要刪除資料夾「${group.name}」及其 ${impact.descendantFolderCount} 個子資料夾嗎？\n這將會一併刪除其中的 ${impact.affectedBookmarkCount} 個書籤。`
                        : `確定要刪除資料夾「${group.name}」嗎？\n這將會一併刪除資料夾內的 ${impact.affectedBookmarkCount} 個書籤。`;
                    const confirmed = await (window as any).poexdConfirm(message, '拖曳刪除資料夾');
                    if (confirmed) {
                      await runSortableTransaction(() =>
                        options.execute({ type: 'delete-group', groupId: folderId }),
                      );
                    } else {
                      await runSortableTransaction();
                    }
                  }
                } else {
                  await runSortableTransaction();
                }
              } else {
                if (folderId && finalDropIntent) {
                  await runSortableTransaction(() =>
                    options.execute({
                      type: 'move-folder',
                      folderId,
                      dropIntent: finalDropIntent,
                    }),
                  );
                } else {
                  await runSortableTransaction();
                }
              }
            });
          },
        });
        folderSortables.push(sortable);
      }
    } else {
      folderSortables.forEach((sortable) => sortable.destroy());
      folderSortables = [];
      boundFolderRoot = null;
    }

    const currentWrappers = Array.from(
      getContainer().querySelectorAll<HTMLElement>('.bookmark-list-wrapper'),
    );
    const currentWrapperSet = new Set(currentWrappers);

    // 局部化銷毀：僅銷毀已從 DOM 移除或折疊的 wrapper
    for (const [el, sortable] of bookmarkSortableMap.entries()) {
      if (!currentWrapperSet.has(el)) {
        sortable.destroy();
        bookmarkSortableMap.delete(el);
      }
    }

    // 局部化掛載：僅為新增展開的 wrapper 建立 Sortable 實例
    const bookmarkOptions = createBookmarkSortableOptions(accordion);
    currentWrappers.forEach((wrapper) => {
      if (!bookmarkSortableMap.has(wrapper)) {
        const sortable = Sortable.create(wrapper, bookmarkOptions);
        bookmarkSortableMap.set(wrapper, sortable);
      }
    });
  };

  return { init, destroy, isReconciling, transientExpandedFolderIds: transientIds };
}
