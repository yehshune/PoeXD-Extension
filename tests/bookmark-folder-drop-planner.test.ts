import { describe, expect, it } from 'vitest';
import type { BookmarkGroup } from '@/components/sidebar/bookmark-types';
import {
  createFolderDropSession,
  type FolderCardGeometry,
} from '@/components/sidebar/composables/bookmark-folder-drop-planner';
import {
  getFlattenedFolderTree,
  getFolderItemIndentLevel,
  TREE_MENU_MAX_INDENT_DEPTH,
} from '@/components/sidebar/bookmark-tree';
import { resolveFolderDropPlacement } from '@/utils/bookmark-collection';

function makeCard(
  folderId: string,
  depth: number,
  top: number,
  height: number,
  options?: { left?: number; right?: number; headerHeight?: number },
): FolderCardGeometry {
  return {
    folderId,
    depth,
    rect: {
      top,
      bottom: top + height,
      left: options?.left ?? depth * 20,
      right: options?.right ?? 260,
      height,
    },
    headerHeight: options?.headerHeight ?? 40,
  };
}

describe('Bookmark Folder Drop Planner (Per-Drag Session)', () => {
  const sampleFolders: BookmarkGroup[] = [
    { id: 'root-1', name: 'Root 1', order: 0 },
    { id: 'child-1-1', name: 'Child 1.1', order: 0, parentId: 'root-1' },
    { id: 'subchild-1-1-1', name: 'SubChild 1.1.1', order: 0, parentId: 'child-1-1' },
    { id: 'child-1-2', name: 'Child 1.2', order: 1, parentId: 'root-1' },
    { id: 'root-2', name: 'Root 2', order: 1 },
    { id: 'root-3', name: 'Root 3', order: 2 },
  ];

  // Vertical layout with 8px inter-card gap
  const defaultCards: FolderCardGeometry[] = [
    makeCard('root-1', 0, 0, 40),
    makeCard('child-1-1', 1, 48, 40),
    makeCard('subchild-1-1-1', 2, 96, 40),
    makeCard('child-1-2', 1, 144, 40),
    makeCard('root-2', 0, 192, 40),
    makeCard('root-3', 0, 240, 40),
  ];

  describe('1. Vertical three-zone classification (before / inside / after)', () => {
    it('classifies top edge as before, middle as inside, bottom edge as after regardless of pointer X', () => {
      const session = createFolderDropSession(sampleFolders, 'root-3');
      const card = makeCard('root-2', 0, 192, 40, { headerHeight: 40 }); // edgeHeight = 10

      for (const x of [10, 130, 250]) {
        const beforePlan = session.plan({
          pointer: { x, y: 196 },
          hitFolderId: 'root-2',
          cards: [card],
          collapsedFolderIds: new Set(),
        });
        expect(beforePlan).toEqual({
          dropIntent: { targetFolderId: 'root-2', position: 'before' },
          projectedDepth: 0,
          projectedParentId: undefined,
          slotFolderId: 'root-2',
          indicatorPosition: 'before',
          indentSteps: 0,
          shouldAutoExpand: false,
        });

        const insidePlan = session.plan({
          pointer: { x, y: 212 },
          hitFolderId: 'root-2',
          cards: [card],
          collapsedFolderIds: new Set(),
        });
        expect(insidePlan).toEqual({
          dropIntent: { targetFolderId: 'root-2', position: 'inside' },
          projectedDepth: 1,
          projectedParentId: 'root-2',
          slotFolderId: 'root-2',
          indicatorPosition: 'inside',
          indentSteps: 0,
          shouldAutoExpand: false,
        });

        const afterPlan = session.plan({
          pointer: { x, y: 228 },
          hitFolderId: 'root-2',
          cards: [card],
          collapsedFolderIds: new Set(),
        });
        expect(afterPlan).toEqual({
          dropIntent: { targetFolderId: 'root-2', position: 'after' },
          projectedDepth: 0,
          projectedParentId: undefined,
          slotFolderId: 'root-2',
          indicatorPosition: 'after',
          indentSteps: 0,
          shouldAutoExpand: false,
        });
      }
    });

    it('adapts edge zone height for tall expanded cards with direct bookmarks', () => {
      const session = createFolderDropSession(sampleFolders, 'root-3');
      // Tall card (height 160) with 40px header -> edgeHeight = min(10, 53) = 10
      const tallCard = makeCard('root-2', 0, 200, 160, { headerHeight: 40 });

      expect(
        session.plan({
          pointer: { x: 100, y: 210 },
          hitFolderId: 'root-2',
          cards: [tallCard],
          collapsedFolderIds: new Set(),
        })?.indicatorPosition,
      ).toBe('before');

      expect(
        session.plan({
          pointer: { x: 100, y: 215 },
          hitFolderId: 'root-2',
          cards: [tallCard],
          collapsedFolderIds: new Set(),
        })?.indicatorPosition,
      ).toBe('inside');

      expect(
        session.plan({
          pointer: { x: 100, y: 350 },
          hitFolderId: 'root-2',
          cards: [tallCard],
          collapsedFolderIds: new Set(),
        })?.indicatorPosition,
      ).toBe('after');
    });

    it('aligns nested target before/after with target depth and inside with target depth + 1', () => {
      const session = createFolderDropSession(sampleFolders, 'root-3');
      const nestedCard = makeCard('child-1-2', 1, 144, 40);

      const beforePlan = session.plan({
        pointer: { x: 100, y: 146 },
        hitFolderId: 'child-1-2',
        cards: [nestedCard],
        collapsedFolderIds: new Set(),
      });
      expect(beforePlan?.projectedDepth).toBe(1);
      expect(beforePlan?.projectedParentId).toBe('root-1');

      const insidePlan = session.plan({
        pointer: { x: 100, y: 164 },
        hitFolderId: 'child-1-2',
        cards: [nestedCard],
        collapsedFolderIds: new Set(),
      });
      expect(insidePlan?.projectedDepth).toBe(2);
      expect(insidePlan?.projectedParentId).toBe('child-1-2');
    });
  });

  describe('2. Inter-card gap corridor & list-edge snapping', () => {
    it('snaps to before first card when pointer is slightly above it (<= 16px)', () => {
      const session = createFolderDropSession(sampleFolders, 'root-3');
      const cards = [makeCard('root-1', 0, 20, 40), makeCard('root-2', 0, 68, 40)];

      const snapped = session.plan({
        pointer: { x: 100, y: 10 },
        hitFolderId: null,
        cards,
        collapsedFolderIds: new Set(),
      });
      expect(snapped?.dropIntent).toEqual({ targetFolderId: 'root-1', position: 'before' });

      const tooFarAbove = session.plan({
        pointer: { x: 100, y: 0 },
        hitFolderId: null,
        cards,
        collapsedFolderIds: new Set(),
      });
      expect(tooFarAbove).toBeNull();
    });

    it('snaps to upper card after or lower card before across the vertical gap midpoint', () => {
      const session = createFolderDropSession(sampleFolders, 'root-3');
      // Gap between child-1-2 (bottom 184) and root-2 (top 192): midpoint = 188
      const upperHalf = session.plan({
        pointer: { x: 100, y: 186 },
        hitFolderId: null,
        cards: defaultCards,
        collapsedFolderIds: new Set(),
      });
      expect(upperHalf?.dropIntent).toEqual({ targetFolderId: 'child-1-2', position: 'after' });

      const lowerHalf = session.plan({
        pointer: { x: 100, y: 190 },
        hitFolderId: null,
        cards: defaultCards,
        collapsedFolderIds: new Set(),
      });
      expect(lowerHalf?.dropIntent).toEqual({ targetFolderId: 'root-2', position: 'before' });
    });

    it('snaps to last root folder after when pointer is pulled > 8px below a nested last card', () => {
      const folders: BookmarkGroup[] = [
        { id: 'root-1', name: 'Root 1', order: 0 },
        { id: 'root-2', name: 'Root 2', order: 1 },
        { id: 'child-2-1', name: 'Child 2.1', order: 0, parentId: 'root-2' },
      ];
      const cards: FolderCardGeometry[] = [
        makeCard('root-1', 0, 0, 40),
        makeCard('root-2', 0, 48, 40),
        makeCard('child-2-1', 1, 96, 40), // bottom = 136
      ];
      const session = createFolderDropSession(folders, 'root-1');

      // Within 8px below last child -> stays after child-2-1
      const nearBottom = session.plan({
        pointer: { x: 100, y: 141 },
        hitFolderId: null,
        cards,
        collapsedFolderIds: new Set(),
      });
      expect(nearBottom?.dropIntent).toEqual({ targetFolderId: 'child-2-1', position: 'after' });
      expect(nearBottom?.projectedDepth).toBe(1);
      expect(nearBottom?.indentSteps).toBe(0);

      // More than 8px (and <= 24px) below last child -> promotes to after last root (root-2),
      // with visual slot on child-2-1 and indentSteps = -1
      const outdentedBottom = session.plan({
        pointer: { x: 100, y: 150 },
        hitFolderId: null,
        cards,
        collapsedFolderIds: new Set(),
      });
      expect(outdentedBottom?.dropIntent).toEqual({ targetFolderId: 'root-2', position: 'after' });
      expect(outdentedBottom?.projectedDepth).toBe(0);
      expect(outdentedBottom?.slotFolderId).toBe('child-2-1');
      expect(outdentedBottom?.indentSteps).toBe(-1);

      // Beyond 24px below last card -> null
      const tooFarBelow = session.plan({
        pointer: { x: 100, y: 165 },
        hitFolderId: null,
        cards,
        collapsedFolderIds: new Set(),
      });
      expect(tooFarBelow).toBeNull();
    });
  });

  describe('3. Expanded-subtree visual slot resolution & negative indentSteps', () => {
    it('places after indicator on the last visible descendant with negative indentSteps', () => {
      const session = createFolderDropSession(sampleFolders, 'root-3');

      // Dragging onto bottom edge of root-1 (depth 0) while its subtree is expanded:
      // last visible descendant is child-1-2 (depth 1) -> indentSteps = 0 - 1 = -1
      const planAfterRoot1 = session.plan({
        pointer: { x: 100, y: 38 },
        hitFolderId: 'root-1',
        cards: defaultCards,
        collapsedFolderIds: new Set(),
      });
      expect(planAfterRoot1).toEqual({
        dropIntent: { targetFolderId: 'root-1', position: 'after' },
        projectedDepth: 0,
        projectedParentId: undefined,
        slotFolderId: 'child-1-2',
        indicatorPosition: 'after',
        indentSteps: -1,
        shouldAutoExpand: false,
      });

      // Dragging onto bottom edge of child-1-1 (depth 1):
      // last visible descendant is subchild-1-1-1 (depth 2) -> indentSteps = 1 - 2 = -1
      const planAfterChild11 = session.plan({
        pointer: { x: 100, y: 86 },
        hitFolderId: 'child-1-1',
        cards: defaultCards,
        collapsedFolderIds: new Set(),
      });
      expect(planAfterChild11?.slotFolderId).toBe('subchild-1-1-1');
      expect(planAfterChild11?.indentSteps).toBe(-1);
    });

    it('uses target itself as slot with indentSteps 0 when parent is collapsed', () => {
      const session = createFolderDropSession(sampleFolders, 'root-3');

      const planAfterCollapsedRoot1 = session.plan({
        pointer: { x: 100, y: 38 },
        hitFolderId: 'root-1',
        cards: [makeCard('root-1', 0, 0, 40)],
        collapsedFolderIds: new Set(['root-1']),
      });
      expect(planAfterCollapsedRoot1?.slotFolderId).toBe('root-1');
      expect(planAfterCollapsedRoot1?.indentSteps).toBe(0);
    });
  });

  describe('4. Transient auto-expand & mid-session cache invalidation', () => {
    it('signals shouldAutoExpand on collapsed inside zone and refreshes visible tree after expansion', () => {
      const session = createFolderDropSession(sampleFolders, 'root-3');

      // While root-1 is collapsed: hovering inside triggers auto-expand
      const collapsedInside = session.plan({
        pointer: { x: 100, y: 20 },
        hitFolderId: 'root-1',
        cards: [makeCard('root-1', 0, 0, 40)],
        collapsedFolderIds: new Set(['root-1']),
      });
      expect(collapsedInside?.shouldAutoExpand).toBe(true);

      // Hovering before/after on collapsed root-1 does NOT auto-expand
      const collapsedAfter = session.plan({
        pointer: { x: 100, y: 38 },
        hitFolderId: 'root-1',
        cards: [makeCard('root-1', 0, 0, 40)],
        collapsedFolderIds: new Set(['root-1']),
      });
      expect(collapsedAfter?.shouldAutoExpand).toBe(false);
      expect(collapsedAfter?.slotFolderId).toBe('root-1');

      // Once root-1 is transiently expanded (removed from collapsedFolderIds),
      // the same session immediately sees its descendants without creating a new session
      const expandedAfter = session.plan({
        pointer: { x: 100, y: 38 },
        hitFolderId: 'root-1',
        cards: defaultCards,
        collapsedFolderIds: new Set(),
      });
      expect(expandedAfter?.shouldAutoExpand).toBe(false);
      expect(expandedAfter?.slotFolderId).toBe('child-1-2');
      expect(expandedAfter?.indentSteps).toBe(-1);
    });
  });

  describe('5. Fail-closed validation & canonical placement parity', () => {
    it('exposes draggedSubtreeIds and rejects self, descendants, and invisible targets', () => {
      const session = createFolderDropSession(sampleFolders, 'root-1');

      expect(session.draggedSubtreeIds).toEqual(
        new Set(['root-1', 'child-1-1', 'subchild-1-1-1', 'child-1-2']),
      );

      // Self
      expect(
        session.plan({
          pointer: { x: 100, y: 20 },
          hitFolderId: 'root-1',
          cards: defaultCards,
          collapsedFolderIds: new Set(),
        }),
      ).toBeNull();

      // Descendant
      expect(
        session.plan({
          pointer: { x: 100, y: 68 },
          hitFolderId: 'child-1-1',
          cards: defaultCards,
          collapsedFolderIds: new Set(),
        }),
      ).toBeNull();

      // Target hidden under a collapsed ancestor
      const sessionFromRoot3 = createFolderDropSession(sampleFolders, 'root-3');
      expect(
        sessionFromRoot3.plan({
          pointer: { x: 100, y: 68 },
          hitFolderId: 'child-1-1',
          cards: defaultCards,
          collapsedFolderIds: new Set(['root-1']),
        }),
      ).toBeNull();
    });

    it('every non-null plan produces a dropIntent accepted by resolveFolderDropPlacement', () => {
      const session = createFolderDropSession(sampleFolders, 'root-3');
      const queries = [
        { pointer: { x: 100, y: 4 }, hitFolderId: 'root-1' },
        { pointer: { x: 100, y: 20 }, hitFolderId: 'root-1' },
        { pointer: { x: 100, y: 38 }, hitFolderId: 'root-1' },
        { pointer: { x: 100, y: 68 }, hitFolderId: 'child-1-1' },
        { pointer: { x: 100, y: 186 }, hitFolderId: null },
        { pointer: { x: 100, y: 190 }, hitFolderId: null },
      ];

      for (const q of queries) {
        const plan = session.plan({
          pointer: q.pointer,
          hitFolderId: q.hitFolderId,
          cards: defaultCards,
          collapsedFolderIds: new Set(),
        });
        expect(plan).not.toBeNull();
        const placement = resolveFolderDropPlacement(sampleFolders, 'root-3', plan!.dropIntent);
        expect(placement.ok).toBe(true);
      }
    });
  });

  describe('Move Target Projection (getFlattenedFolderTree & getFolderItemIndentLevel)', () => {
    const deepFolders: BookmarkGroup[] = [
      { id: 'l1', name: 'L1', order: 0 },
      { id: 'l2', name: 'L2', parentId: 'l1', order: 0 },
      { id: 'l3', name: 'L3', parentId: 'l2', order: 0 },
      { id: 'l4', name: 'L4', parentId: 'l3', order: 0 },
      { id: 'l5', name: 'L5', parentId: 'l4', order: 0 },
      { id: 'l6', name: 'L6', parentId: 'l5', order: 0 },
      { id: 'r2', name: 'R2', order: 1 },
      { id: 'r2-c1', name: 'R2-C1', parentId: 'r2', order: 0 },
    ];

    it('projects deep canonical hierarchy into DFS ordered list with accurate depth', () => {
      const targets = getFlattenedFolderTree(deepFolders);

      expect(targets.map((t) => ({ id: t.folder.id, depth: t.depth }))).toEqual([
        { id: 'l1', depth: 0 },
        { id: 'l2', depth: 1 },
        { id: 'l3', depth: 2 },
        { id: 'l4', depth: 3 },
        { id: 'l5', depth: 4 },
        { id: 'l6', depth: 5 },
        { id: 'r2', depth: 0 },
        { id: 'r2-c1', depth: 1 },
      ]);
    });

    it('excludes self and all descendants while preserving valid sibling and ancestor hierarchy', () => {
      const targets = getFlattenedFolderTree(deepFolders, 'l3');

      expect(targets.map((t) => t.folder.id)).toEqual(['l1', 'l2', 'r2', 'r2-c1']);
    });

    it('clamps indentation level accurately without unbounded growth at deep levels', () => {
      expect(getFolderItemIndentLevel(0)).toBe(0);
      expect(getFolderItemIndentLevel(-1)).toBe(0);
      expect(getFolderItemIndentLevel(1)).toBe(1);
      expect(getFolderItemIndentLevel(6)).toBe(6);
      expect(getFolderItemIndentLevel(10)).toBe(TREE_MENU_MAX_INDENT_DEPTH);
    });
  });
});
