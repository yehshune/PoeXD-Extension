import type { BookmarkGroup } from '../bookmark-types';
import {
  getFolderSubtreeIds,
  getVisibleFlattenedFolders,
  resolveFolderDropPlacement,
  type FolderDropIntent,
  type FolderDropPosition,
  type VisibleFolderItem,
} from '@/utils/bookmark-collection';

export interface FolderCardRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
  height: number;
}

export interface FolderCardGeometry {
  folderId: string;
  depth: number;
  rect: FolderCardRect;
  /** Header row height used for adaptive edge-zone sizing; falls back to rect.height or 40. */
  headerHeight?: number;
}

export interface FolderDropPlanInput {
  pointer: { x: number; y: number };
  /** Folder card directly under the pointer, or null when the pointer is in a gap/margin. */
  hitFolderId: string | null;
  /** Visible folder cards in DOM order (only the hit card is required when hitFolderId is set). */
  cards: readonly FolderCardGeometry[];
  /** Effective collapsed folder IDs (excluding any transiently expanded folders). */
  collapsedFolderIds: ReadonlySet<string>;
}

export interface FolderDropPlan {
  dropIntent: FolderDropIntent;
  projectedDepth: number;
  projectedParentId: string | undefined;
  /** Folder card that owns the visual drop indicator. */
  slotFolderId: string;
  indicatorPosition: FolderDropPosition;
  /** Integer depth delta (projectedDepth - slotDepth); DOM adapter multiplies by indentStep. */
  indentSteps: number;
  /** Whether hovering on this target should trigger transient auto-expand. */
  shouldAutoExpand: boolean;
}

export interface FolderDropSession {
  readonly draggedFolderId: string;
  readonly draggedSubtreeIds: ReadonlySet<string>;
  plan(input: FolderDropPlanInput): FolderDropPlan | null;
}

const FIRST_CARD_TOP_CORRIDOR_PX = 16;
const LAST_CARD_BOTTOM_CORRIDOR_PX = 24;
const LAST_CARD_ROOT_OUTDENT_THRESHOLD_PX = 8;

function resolveGapTarget(
  cards: readonly FolderCardGeometry[],
  pointer: { x: number; y: number },
  draggedFolderId: string,
): {
  targetCard: FolderCardGeometry;
  forcedDropPosition: 'before' | 'after';
  forcedTargetFolderId: string | null;
} | null {
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    const rect = c.rect;
    if (rect.height <= 0 || pointer.x < rect.left || pointer.x > rect.right) continue;

    // Pointer slightly above the first card
    if (i === 0 && pointer.y < rect.top && rect.top - pointer.y <= FIRST_CARD_TOP_CORRIDOR_PX) {
      return {
        targetCard: c,
        forcedDropPosition: 'before',
        forcedTargetFolderId: null,
      };
    }

    // Pointer in the vertical gap between two adjacent cards
    const nextC = cards[i + 1];
    if (nextC) {
      const nextRect = nextC.rect;
      if (nextRect.height > 0 && pointer.y > rect.bottom && pointer.y < nextRect.top) {
        const midY = (rect.bottom + nextRect.top) / 2;
        if (pointer.y < midY) {
          return {
            targetCard: c,
            forcedDropPosition: 'after',
            forcedTargetFolderId: null,
          };
        }
        if (pointer.x >= nextRect.left && pointer.x <= nextRect.right) {
          return {
            targetCard: nextC,
            forcedDropPosition: 'before',
            forcedTargetFolderId: null,
          };
        }
        return {
          targetCard: c,
          forcedDropPosition: 'after',
          forcedTargetFolderId: null,
        };
      }
    } else if (pointer.y > rect.bottom && pointer.y - rect.bottom <= LAST_CARD_BOTTOM_CORRIDOR_PX) {
      // Pointer below the last card: if it's a nested subfolder and pulled further down, align to last root folder
      let forcedTargetFolderId: string | null = null;
      if (c.depth > 0 && pointer.y - rect.bottom > LAST_CARD_ROOT_OUTDENT_THRESHOLD_PX) {
        for (let j = cards.length - 1; j >= 0; j--) {
          if (cards[j].depth === 0 && cards[j].folderId !== draggedFolderId) {
            forcedTargetFolderId = cards[j].folderId;
            break;
          }
        }
      }
      return {
        targetCard: c,
        forcedDropPosition: 'after',
        forcedTargetFolderId,
      };
    }
  }

  return null;
}

function classifyVerticalZone(
  card: FolderCardGeometry,
  pointerY: number,
  forcedDropPosition: 'before' | 'after' | null,
): FolderDropPosition {
  if (forcedDropPosition) return forcedDropPosition;

  const cHeight = card.rect.height;
  const baseRowHeight =
    card.headerHeight && card.headerHeight > 0 ? card.headerHeight : cHeight > 0 ? cHeight : 40;
  const edgeHeight = Math.max(
    4,
    Math.min(Math.round(baseRowHeight * 0.25), Math.floor(cHeight / 3)),
  );

  if (pointerY <= card.rect.top + edgeHeight) return 'before';
  if (pointerY >= card.rect.bottom - edgeHeight) return 'after';
  return 'inside';
}

/**
 * Create a per-drag Bookmark folder drop planning session.
 *
 * Encapsulates subtree exclusion, visible-tree caching, explicit vertical drop-zone
 * classification, inter-card gap corridor snapping, canonical placement validation,
 * and visual slot-target resolution behind a single pure interface.
 */
export function createFolderDropSession(
  folders: readonly BookmarkGroup[],
  draggedFolderId: string,
): FolderDropSession {
  const draggedSubtreeIds: ReadonlySet<string> = draggedFolderId
    ? getFolderSubtreeIds(folders, draggedFolderId)
    : new Set<string>();

  let cachedVisibleKey: string | null = null;
  let cachedVisibleFolders: readonly VisibleFolderItem[] = [];

  const getCachedVisibleFolders = (
    collapsedFolderIds: ReadonlySet<string>,
  ): readonly VisibleFolderItem[] => {
    const key = Array.from(collapsedFolderIds).sort().join('\u0000');
    if (cachedVisibleKey !== key) {
      cachedVisibleFolders = getVisibleFlattenedFolders(
        folders,
        collapsedFolderIds,
        draggedFolderId,
      );
      cachedVisibleKey = key;
    }
    return cachedVisibleFolders;
  };

  const plan = (input: FolderDropPlanInput): FolderDropPlan | null => {
    if (!draggedFolderId) return null;

    let targetCard: FolderCardGeometry | null = input.hitFolderId
      ? (input.cards.find((c) => c.folderId === input.hitFolderId) ?? null)
      : null;
    let forcedDropPosition: 'before' | 'after' | null = null;
    let forcedTargetFolderId: string | null = null;

    if (!targetCard) {
      const gapMatch = resolveGapTarget(input.cards, input.pointer, draggedFolderId);
      if (!gapMatch) return null;
      targetCard = gapMatch.targetCard;
      forcedDropPosition = gapMatch.forcedDropPosition;
      forcedTargetFolderId = gapMatch.forcedTargetFolderId;
    }

    const targetFolderId = forcedTargetFolderId ?? targetCard.folderId;
    if (
      !targetFolderId ||
      targetFolderId === draggedFolderId ||
      draggedSubtreeIds.has(targetFolderId)
    ) {
      return null;
    }

    if (targetCard.rect.height <= 0) return null;

    const dropPosition = classifyVerticalZone(targetCard, input.pointer.y, forcedDropPosition);

    const visibleFolders = getCachedVisibleFolders(input.collapsedFolderIds);
    const targetIndex = visibleFolders.findIndex((f) => f.id === targetFolderId);
    if (targetIndex === -1) return null;

    const targetItem = visibleFolders[targetIndex];
    const dropIntent: FolderDropIntent = {
      targetFolderId: targetItem.id,
      position: dropPosition,
    };
    const projectedDepth = dropPosition === 'inside' ? targetItem.depth + 1 : targetItem.depth;
    const projectedParentId = dropPosition === 'inside' ? targetItem.id : targetItem.parentId;

    const validation = resolveFolderDropPlacement(folders, draggedFolderId, dropIntent);
    if (!validation.ok) return null;

    let slotFolderId = targetItem.id;
    let indentSteps = 0;

    if (dropPosition === 'after') {
      let lastVisibleItem = targetItem;
      for (let i = targetIndex + 1; i < visibleFolders.length; i++) {
        const item = visibleFolders[i];
        if (item.depth <= targetItem.depth) break;
        lastVisibleItem = item;
      }
      slotFolderId = lastVisibleItem.id;
      indentSteps = projectedDepth - lastVisibleItem.depth;
    }

    const shouldAutoExpand =
      input.collapsedFolderIds.has(targetFolderId) &&
      (dropPosition === 'inside' || projectedParentId === targetFolderId);

    return {
      dropIntent,
      projectedDepth,
      projectedParentId,
      slotFolderId,
      indicatorPosition: dropPosition,
      indentSteps,
      shouldAutoExpand,
    };
  };

  return {
    draggedFolderId,
    draggedSubtreeIds,
    plan,
  };
}
