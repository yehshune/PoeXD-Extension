import type { BookmarkGroup } from '../bookmark-types';
import {
  getFolderAncestors,
  getFolderDepth,
  getFolderSubtreeIds,
  getVisibleFlattenedFolders,
  type FolderDropIntent,
  type VisibleFolderItem,
} from '@/utils/bookmark-collection';

export const TREE_INDENTATION_WIDTH = 20;
export const TREE_HORIZONTAL_DEAD_ZONE = 8;

export { getFolderDepth, getVisibleFlattenedFolders, type VisibleFolderItem };

/**
 * 計算水平位移對應的階層變化量 (含防手震 dead zone)
 */
export function calculateDepthDelta(
  horizontalOffset: number,
  indentationWidth = TREE_INDENTATION_WIDTH,
  deadZone = TREE_HORIZONTAL_DEAD_ZONE,
): number {
  if (Math.abs(horizontalOffset) <= deadZone) {
    return 0;
  }
  const effectiveOffset =
    horizontalOffset > 0 ? horizontalOffset - deadZone : horizontalOffset + deadZone;
  return Math.trunc(effectiveOffset / indentationWidth);
}

export interface TreeDropParams {
  folders: readonly BookmarkGroup[];
  collapsedFolderIds: ReadonlySet<string>;
  draggedFolderId: string;
  targetFolderId: string;
  dropPosition: 'before' | 'inside' | 'after';
  horizontalOffset: number; // clientX - startX
  indentationWidth?: number;
  deadZone?: number;
}

export interface TreeProjectionResult {
  ok: boolean;
  reason?: string;
  targetFolderId: string;
  position: 'before' | 'inside' | 'after';
  dropIntent: FolderDropIntent;
  projectedDepth: number;
  projectedParentId: string | undefined;
  indentPx: number;
}

/**
 * 沿著 targetFolder 往上尋找指定 depth 的 ancestor 節點
 */
function findAncestorAtDepth(
  folders: readonly BookmarkGroup[],
  startFolderId: string,
  targetDepth: number,
): BookmarkGroup | null {
  const target = folders.find((f) => f.id === startFolderId);
  if (!target) return null;
  const ancestors = getFolderAncestors(folders, startFolderId);
  const chain = [...ancestors.reverse(), target];
  return chain[targetDepth] ?? null;
}

/**
 * 計算 Sortable Tree 投影位置與 FolderDropIntent
 *
 * 核心契約 (Explicit Drop Zones Contract)：
 * 1. dropPosition: 'inside' (卡片中央區域) 100% 由中央 target surface 直接表達「成為此 folder 的 child」，不受水平位移改寫。
 * 2. dropPosition: 'before' | 'after' (卡片頂部/底部窄邊緣) 透過 X 軸水平位移決定同級或向左 outdent 至祖先，絕不自動轉為 inside。
 * 3. projectedDepth 與 FolderDropIntent 一致反映同級插入或祖先 outdent 槽位。
 */
export function projectTreeDrop(params: TreeDropParams): TreeProjectionResult {
  const {
    folders,
    collapsedFolderIds,
    draggedFolderId,
    targetFolderId,
    dropPosition,
    horizontalOffset,
    indentationWidth = TREE_INDENTATION_WIDTH,
    deadZone = TREE_HORIZONTAL_DEAD_ZONE,
  } = params;

  if (!draggedFolderId || !targetFolderId) {
    return {
      ok: false,
      reason: 'Invalid dragged or target folder ID',
      targetFolderId,
      position: dropPosition,
      dropIntent: { targetFolderId, position: dropPosition },
      projectedDepth: 0,
      projectedParentId: undefined,
      indentPx: 0,
    };
  }

  // Self-origin horizontal outdent:
  // Dragged folder 自身作為 gesture sensor，僅允許向左降低 depth，映射至 ancestor 的 'after' slot
  if (draggedFolderId === targetFolderId) {
    const draggedDepth = getFolderDepth(folders, draggedFolderId);
    const depthDelta = calculateDepthDelta(horizontalOffset, indentationWidth, deadZone);
    const rawDepth = draggedDepth + depthDelta;

    if (draggedDepth > 0 && depthDelta < 0) {
      const clampedDepth = Math.max(0, Math.min(rawDepth, draggedDepth - 1));
      const ancestor = findAncestorAtDepth(folders, draggedFolderId, clampedDepth);
      if (ancestor) {
        return {
          ok: true,
          targetFolderId: ancestor.id,
          position: 'after',
          dropIntent: {
            targetFolderId: ancestor.id,
            position: 'after',
          },
          projectedDepth: clampedDepth,
          projectedParentId: ancestor.parentId,
          indentPx: (clampedDepth - draggedDepth) * indentationWidth,
        };
      }
    }

    return {
      ok: false,
      reason: 'Self-origin gesture requires outdenting to ancestor',
      targetFolderId,
      position: dropPosition,
      dropIntent: { targetFolderId, position: dropPosition },
      projectedDepth: 0,
      projectedParentId: undefined,
      indentPx: 0,
    };
  }

  const visibleFolders = getVisibleFlattenedFolders(folders, collapsedFolderIds, draggedFolderId);

  const targetIndex = visibleFolders.findIndex((f) => f.id === targetFolderId);
  if (targetIndex === -1) {
    return {
      ok: false,
      reason: 'Target folder is not visible or part of dragged subtree',
      targetFolderId,
      position: dropPosition,
      dropIntent: { targetFolderId, position: dropPosition },
      projectedDepth: 0,
      projectedParentId: undefined,
      indentPx: 0,
    };
  }

  const targetItem = visibleFolders[targetIndex];

  // 1. inside: 由中央 target surface 直接擁有，成為 targetItem 的直接子節點，不受水平位移影響
  if (dropPosition === 'inside') {
    return {
      ok: true,
      targetFolderId: targetItem.id,
      position: 'inside',
      dropIntent: {
        targetFolderId: targetItem.id,
        position: 'inside',
      },
      projectedDepth: targetItem.depth + 1,
      projectedParentId: targetItem.id,
      indentPx: 0,
    };
  }

  // 2. before: 卡片頂部邊緣，X 軸位移支援同級 (clampedDepth = targetItem.depth) 或向左 outdent (clampedDepth < targetItem.depth)
  if (dropPosition === 'before') {
    const draggedDepth = getFolderDepth(folders, draggedFolderId);
    const depthDelta = calculateDepthDelta(horizontalOffset, indentationWidth, deadZone);
    const rawDepth = Math.max(0, draggedDepth + depthDelta);

    const maxDepth = targetItem.depth;
    const minDepth = 0;
    const clampedDepth = Math.max(minDepth, Math.min(rawDepth, maxDepth));

    let finalTargetFolderId = targetItem.id;
    let projectedParentId = targetItem.parentId;
    if (clampedDepth < targetItem.depth) {
      const ancestor = findAncestorAtDepth(folders, targetItem.id, clampedDepth);
      if (ancestor) {
        finalTargetFolderId = ancestor.id;
        projectedParentId = ancestor.parentId;
      }
    }
    const localIndentPx = (clampedDepth - targetItem.depth) * indentationWidth;
    return {
      ok: true,
      targetFolderId: finalTargetFolderId,
      position: 'before',
      dropIntent: {
        targetFolderId: finalTargetFolderId,
        position: 'before',
      },
      projectedDepth: clampedDepth,
      projectedParentId,
      indentPx: localIndentPx,
    };
  }

  // 3. after: 卡片底部邊緣，X 軸位移支援同級或向左 outdent，跳過 targetItem 子樹以決定 minDepth
  const draggedDepth = getFolderDepth(folders, draggedFolderId);
  const depthDelta = calculateDepthDelta(horizontalOffset, indentationWidth, deadZone);
  const rawDepth = Math.max(0, draggedDepth + depthDelta);

  const maxDepth = targetItem.depth;

  const targetAncestor =
    findAncestorAtDepth(folders, targetItem.id, Math.max(0, rawDepth)) ?? targetItem;
  const ancestorSubtreeIds = getFolderSubtreeIds(folders, targetAncestor.id);
  let nextItem: VisibleFolderItem | undefined;
  for (let i = targetIndex + 1; i < visibleFolders.length; i++) {
    if (!ancestorSubtreeIds.has(visibleFolders[i].id)) {
      nextItem = visibleFolders[i];
      break;
    }
  }
  const minDepth = nextItem ? nextItem.depth : 0;
  const clampedDepth = Math.max(minDepth, Math.min(rawDepth, maxDepth));

  let finalTargetFolderId = targetItem.id;
  let projectedParentId = targetItem.parentId;
  if (clampedDepth < targetItem.depth) {
    const ancestor = findAncestorAtDepth(folders, targetItem.id, clampedDepth);
    if (ancestor) {
      finalTargetFolderId = ancestor.id;
      projectedParentId = ancestor.parentId;
    }
  }
  const localIndentPx = (clampedDepth - targetItem.depth) * indentationWidth;
  return {
    ok: true,
    targetFolderId: finalTargetFolderId,
    position: 'after',
    dropIntent: {
      targetFolderId: finalTargetFolderId,
      position: 'after',
    },
    projectedDepth: clampedDepth,
    projectedParentId,
    indentPx: localIndentPx,
  };
}
