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
  horizontalOffset?: number;
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
 * 計算 Sortable Tree 投影位置與 FolderDropIntent
 *
 * 核心契約 (Explicit Vertical Drop Zones Contract)：
 * 1. 純垂直上下三區判定，完全不受水平 X 軸偏移影響（避免右側拖曳把手斜拉時誤觸階層跳動）。
 * 2. dropPosition: 'inside' (卡片中央區域) 100% 由中央 target surface 直接表達「成為此 folder 的 child」。
 * 3. dropPosition: 'before' | 'after' (卡片頂部/底部邊緣或卡片間隙) 直接對齊 targetItem 的同級階層 (targetItem.depth)。
 */
export function projectTreeDrop(params: TreeDropParams): TreeProjectionResult {
  const { folders, collapsedFolderIds, draggedFolderId, targetFolderId, dropPosition } = params;

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

  if (draggedFolderId === targetFolderId) {
    return {
      ok: false,
      reason: 'Cannot drop folder onto itself',
      targetFolderId,
      position: dropPosition,
      dropIntent: { targetFolderId, position: dropPosition },
      projectedDepth: 0,
      projectedParentId: undefined,
      indentPx: 0,
    };
  }

  const draggedSubtreeIds = getFolderSubtreeIds(folders, draggedFolderId);
  if (draggedSubtreeIds.has(targetFolderId)) {
    return {
      ok: false,
      reason: 'Target folder is part of dragged subtree',
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

  // 1. inside: 由中央 target surface 直接擁有，成為 targetItem 的直接子節點
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

  // 2. before / after: 卡片頂部或底部邊緣，直接對齊 targetItem 的同級階層 (targetItem.depth)
  return {
    ok: true,
    targetFolderId: targetItem.id,
    position: dropPosition,
    dropIntent: {
      targetFolderId: targetItem.id,
      position: dropPosition,
    },
    projectedDepth: targetItem.depth,
    projectedParentId: targetItem.parentId,
    indentPx: 0,
  };
}

