import { describe, expect, it } from 'vitest';
import type { BookmarkGroup } from '@/components/sidebar/bookmark-types';
import {
  calculateDepthDelta,
  getFolderDepth,
  getVisibleFlattenedFolders,
  projectTreeDrop,
  TREE_INDENTATION_WIDTH,
  TREE_HORIZONTAL_DEAD_ZONE,
} from '@/components/sidebar/composables/bookmark-tree-projection';
import {
  getFlattenedFolderTree,
  getFolderItemIndentLevel,
  TREE_MENU_MAX_INDENT_DEPTH,
} from '@/components/sidebar/bookmark-tree';
import { resolveFolderDropPlacement } from '@/utils/bookmark-collection';

describe('Bookmark Tree Projection Domain Module (Explicit Drop Zones Contract)', () => {
  const sampleFolders: BookmarkGroup[] = [
    { id: 'root-1', name: 'Root 1', order: 0 },
    { id: 'child-1-1', name: 'Child 1.1', order: 0, parentId: 'root-1' },
    { id: 'subchild-1-1-1', name: 'SubChild 1.1.1', order: 0, parentId: 'child-1-1' },
    { id: 'child-1-2', name: 'Child 1.2', order: 1, parentId: 'root-1' },
    { id: 'root-2', name: 'Root 2', order: 1 },
    { id: 'root-3', name: 'Root 3', order: 2 },
  ];

  describe('1. calculateDepthDelta with dead zone & variable step', () => {
    it('returns 0 when offset is within dead zone', () => {
      expect(calculateDepthDelta(0)).toBe(0);
      expect(calculateDepthDelta(TREE_HORIZONTAL_DEAD_ZONE)).toBe(0);
      expect(calculateDepthDelta(-TREE_HORIZONTAL_DEAD_ZONE)).toBe(0);
      expect(calculateDepthDelta(5)).toBe(0);
      expect(calculateDepthDelta(-5)).toBe(0);
    });

    it('calculates depth delta accurately with custom indentation widths (e.g. 20px vs 28px)', () => {
      // With step = 20px, deadZone = 8px:
      expect(calculateDepthDelta(28, 20, 8)).toBe(1);
      expect(calculateDepthDelta(48, 20, 8)).toBe(2);
      expect(calculateDepthDelta(-28, 20, 8)).toBe(-1);
      expect(calculateDepthDelta(-48, 20, 8)).toBe(-2);

      // With step = 28px (e.g. higher scale/density), deadZone = 8px:
      expect(calculateDepthDelta(36, 28, 8)).toBe(1);
      expect(calculateDepthDelta(64, 28, 8)).toBe(2);
      expect(calculateDepthDelta(-36, 28, 8)).toBe(-1);
      expect(calculateDepthDelta(-64, 28, 8)).toBe(-2);
    });
  });

  describe('2. getFolderDepth helper', () => {
    it('accurately resolves depth for root and nested folders', () => {
      expect(getFolderDepth(sampleFolders, 'root-1')).toBe(0);
      expect(getFolderDepth(sampleFolders, 'child-1-1')).toBe(1);
      expect(getFolderDepth(sampleFolders, 'subchild-1-1-1')).toBe(2);
    });
  });

  describe('3. Explicit inside contract (central surface ownership)', () => {
    it('always places as target child and is completely immune to horizontal offsets', () => {
      for (const offset of [0, 50, -50]) {
        const result = projectTreeDrop({
          folders: sampleFolders,
          collapsedFolderIds: new Set(),
          draggedFolderId: 'root-3',
          targetFolderId: 'root-2',
          dropPosition: 'inside',
          horizontalOffset: offset,
        });

        expect(result.ok).toBe(true);
        expect(result.position).toBe('inside');
        expect(result.projectedDepth).toBe(1); // root-2.depth (0) + 1
        expect(result.projectedParentId).toBe('root-2');
        expect(result.dropIntent).toEqual({ targetFolderId: 'root-2', position: 'inside' });
        expect(result.indentPx).toBe(0);
      }
    });

    it('places inside nested target folder at target.depth + 1', () => {
      const result = projectTreeDrop({
        folders: sampleFolders,
        collapsedFolderIds: new Set(),
        draggedFolderId: 'root-3',
        targetFolderId: 'child-1-1', // depth 1
        dropPosition: 'inside',
        horizontalOffset: 0,
      });

      expect(result.ok).toBe(true);
      expect(result.position).toBe('inside');
      expect(result.projectedDepth).toBe(2); // child-1-1.depth (1) + 1
      expect(result.projectedParentId).toBe('child-1-1');
      expect(result.dropIntent).toEqual({ targetFolderId: 'child-1-1', position: 'inside' });
    });
  });

  describe('4. Explicit before contract (top edge zone with X-axis outdent)', () => {
    it('maintains same depth insertion when horizontalOffset = 0', () => {
      const result = projectTreeDrop({
        folders: sampleFolders,
        collapsedFolderIds: new Set(),
        draggedFolderId: 'root-3', // depth 0
        targetFolderId: 'root-2', // depth 0
        dropPosition: 'before',
        horizontalOffset: 0,
      });

      expect(result.ok).toBe(true);
      expect(result.position).toBe('before');
      expect(result.projectedDepth).toBe(0);
      expect(result.projectedParentId).toBeUndefined();
      expect(result.dropIntent).toEqual({ targetFolderId: 'root-2', position: 'before' });
    });

    it('never mutates into inside even with large right horizontal offset', () => {
      const result = projectTreeDrop({
        folders: sampleFolders,
        collapsedFolderIds: new Set(),
        draggedFolderId: 'root-3', // depth 0
        targetFolderId: 'root-2', // depth 0
        dropPosition: 'before',
        horizontalOffset: 120, // large right offset
      });

      expect(result.ok).toBe(true);
      expect(result.position).toBe('before');
      expect(result.projectedDepth).toBe(0); // clamped to maxDepth (targetItem.depth = 0)
      expect(result.projectedParentId).toBeUndefined();
      expect(result.dropIntent).toEqual({ targetFolderId: 'root-2', position: 'before' });
    });

    it('supports left horizontal offset outdent to ancestor', () => {
      // subchild-1-1-1 (depth 2) dragged before child-1-2 (depth 1) with outdent (-28px)
      const result = projectTreeDrop({
        folders: sampleFolders,
        collapsedFolderIds: new Set(),
        draggedFolderId: 'subchild-1-1-1', // depth 2
        targetFolderId: 'child-1-2', // depth 1
        dropPosition: 'before',
        horizontalOffset: -28, // delta = -1 -> rawDepth = 1 -> clampedDepth = 1
      });

      expect(result.ok).toBe(true);
      expect(result.position).toBe('before');
      expect(result.projectedDepth).toBe(1);
      expect(result.projectedParentId).toBe('root-1');
      expect(result.dropIntent).toEqual({ targetFolderId: 'child-1-2', position: 'before' });

      // Outdent further to depth 0 (-56px)
      const resRoot = projectTreeDrop({
        folders: sampleFolders,
        collapsedFolderIds: new Set(),
        draggedFolderId: 'subchild-1-1-1', // depth 2
        targetFolderId: 'child-1-2', // depth 1
        dropPosition: 'before',
        horizontalOffset: -56, // delta = -2 -> rawDepth = 0 -> clampedDepth = 0
      });

      expect(resRoot.ok).toBe(true);
      expect(resRoot.position).toBe('before');
      expect(resRoot.projectedDepth).toBe(0);
      expect(resRoot.projectedParentId).toBeUndefined();
      expect(resRoot.dropIntent).toEqual({ targetFolderId: 'root-1', position: 'before' });
    });

    it('first item edge case: dragging before first item clamped to depth 0', () => {
      const result = projectTreeDrop({
        folders: sampleFolders,
        collapsedFolderIds: new Set(),
        draggedFolderId: 'root-3',
        targetFolderId: 'root-1',
        dropPosition: 'before',
        horizontalOffset: 100,
      });

      expect(result.ok).toBe(true);
      expect(result.projectedDepth).toBe(0);
      expect(result.projectedParentId).toBeUndefined();
      expect(result.position).toBe('before');
      expect(result.dropIntent).toEqual({ targetFolderId: 'root-1', position: 'before' });
    });
  });

  describe('5. Explicit after contract (bottom edge zone with X-axis outdent)', () => {
    it('maintains same depth insertion when horizontalOffset = 0', () => {
      const result = projectTreeDrop({
        folders: sampleFolders,
        collapsedFolderIds: new Set(),
        draggedFolderId: 'child-1-1', // depth 1
        targetFolderId: 'child-1-2', // depth 1
        dropPosition: 'after',
        horizontalOffset: 0,
      });

      expect(result.ok).toBe(true);
      expect(result.position).toBe('after');
      expect(result.projectedDepth).toBe(1);
      expect(result.projectedParentId).toBe('root-1');
      expect(result.dropIntent).toEqual({ targetFolderId: 'child-1-2', position: 'after' });
    });

    it('never mutates into inside even with large right horizontal offset', () => {
      const result = projectTreeDrop({
        folders: sampleFolders,
        collapsedFolderIds: new Set(),
        draggedFolderId: 'root-1', // depth 0
        targetFolderId: 'root-2', // depth 0
        dropPosition: 'after',
        horizontalOffset: 100,
      });

      expect(result.ok).toBe(true);
      expect(result.position).toBe('after');
      expect(result.projectedDepth).toBe(0); // clamped to maxDepth (targetItem.depth = 0)
      expect(result.projectedParentId).toBeUndefined();
      expect(result.dropIntent).toEqual({ targetFolderId: 'root-2', position: 'after' });
    });

    it('supports left horizontal offset outdent to ancestor', () => {
      // subchild-1-1-1 (depth 2) dragged after child-1-1 (depth 1) with outdent
      const resRoot = projectTreeDrop({
        folders: sampleFolders,
        collapsedFolderIds: new Set(),
        draggedFolderId: 'subchild-1-1-1', // depth 2
        targetFolderId: 'child-1-1', // depth 1
        dropPosition: 'after',
        horizontalOffset: -56, // delta = -2 -> rawDepth = 0 -> clamped to ancestor root-1 depth 0
      });

      expect(resRoot.ok).toBe(true);
      expect(resRoot.position).toBe('after');
      expect(resRoot.projectedDepth).toBe(0);
      expect(resRoot.projectedParentId).toBeUndefined();
      expect(resRoot.dropIntent).toEqual({ targetFolderId: 'root-1', position: 'after' });
    });

    it('last item edge case: allows depth 0 after last item', () => {
      const res0 = projectTreeDrop({
        folders: sampleFolders,
        collapsedFolderIds: new Set(),
        draggedFolderId: 'child-1-2',
        targetFolderId: 'root-3', // last item (depth 0)
        dropPosition: 'after',
        horizontalOffset: 0,
      });

      expect(res0.ok).toBe(true);
      expect(res0.position).toBe('after');
      expect(res0.projectedDepth).toBe(0);
      expect(res0.projectedParentId).toBeUndefined();
      expect(res0.dropIntent).toEqual({ targetFolderId: 'root-3', position: 'after' });
    });
  });

  describe('6. Subtree & invalid target safety', () => {
    it('fails closed when dragging into self or own descendant subtree', () => {
      // self
      const resSelf = projectTreeDrop({
        folders: sampleFolders,
        collapsedFolderIds: new Set(),
        draggedFolderId: 'root-1',
        targetFolderId: 'root-1',
        dropPosition: 'inside',
        horizontalOffset: 0,
      });
      expect(resSelf.ok).toBe(false);

      // descendant
      const resDesc = projectTreeDrop({
        folders: sampleFolders,
        collapsedFolderIds: new Set(),
        draggedFolderId: 'root-1',
        targetFolderId: 'child-1-1',
        dropPosition: 'inside',
        horizontalOffset: 0,
      });
      expect(resDesc.ok).toBe(false);
    });

    it('fails closed when target folder is not visible or non-existent', () => {
      const res = projectTreeDrop({
        folders: sampleFolders,
        collapsedFolderIds: new Set(['root-1']), // collapses child-1-1
        draggedFolderId: 'root-3',
        targetFolderId: 'child-1-1', // not visible
        dropPosition: 'before',
        horizontalOffset: 0,
      });
      expect(res.ok).toBe(false);
    });
  });

  describe('7. Indicator coordinate geometry & local indentation without duplication', () => {
    it('root target: local indent equals (projectedDepth - targetDepth) * indentationWidth', () => {
      const resSame = projectTreeDrop({
        folders: sampleFolders,
        collapsedFolderIds: new Set(),
        draggedFolderId: 'root-3',
        targetFolderId: 'root-2', // depth 0
        dropPosition: 'before',
        horizontalOffset: 0,
        indentationWidth: 20,
      });
      expect(resSame.indentPx).toBe(0);
    });

    it('nested target: local indent eliminates duplicate ancestor offset', () => {
      // target = child-1-1 (depth 1)
      const resSame = projectTreeDrop({
        folders: sampleFolders,
        collapsedFolderIds: new Set(),
        draggedFolderId: 'child-1-2', // depth 1
        targetFolderId: 'child-1-1', // depth 1
        dropPosition: 'before',
        horizontalOffset: 0,
        indentationWidth: 20,
      });
      expect(resSame.projectedDepth).toBe(1);
      expect(resSame.indentPx).toBe(0); // aligns locally with target header

      // Outdent to root: indentPx is -20px
      const resOutdent = projectTreeDrop({
        folders: sampleFolders,
        collapsedFolderIds: new Set(),
        draggedFolderId: 'child-1-2', // depth 1
        targetFolderId: 'child-1-1', // depth 1
        dropPosition: 'before',
        horizontalOffset: -28,
        indentationWidth: 20,
      });
      expect(resOutdent.projectedDepth).toBe(0);
      expect(resOutdent.indentPx).toBe(-20);
    });

    it('supports varied indentation widths (24px scale)', () => {
      const resOutdent = projectTreeDrop({
        folders: sampleFolders,
        collapsedFolderIds: new Set(),
        draggedFolderId: 'child-1-2', // depth 1
        targetFolderId: 'child-1-1', // depth 1
        dropPosition: 'before',
        horizontalOffset: -36,
        indentationWidth: 24,
      });
      expect(resOutdent.projectedDepth).toBe(0);
      expect(resOutdent.indentPx).toBe(-24);
    });
  });

  describe('8. resolveFolderDropPlacement integration', () => {
    const folders: BookmarkGroup[] = [
      { id: 'folder-A', name: 'Folder A', order: 0 },
      { id: 'child-C', name: 'Child C', order: 0, parentId: 'folder-A' },
      { id: 'child-E', name: 'Child E', order: 1, parentId: 'folder-A' },
      { id: 'folder-B', name: 'Folder B', order: 1 },
      { id: 'folder-D', name: 'Folder D', order: 2 },
    ];

    it('integrates dropPosition inside with domain placement', () => {
      const projection = projectTreeDrop({
        folders,
        collapsedFolderIds: new Set(),
        draggedFolderId: 'folder-D',
        targetFolderId: 'folder-B',
        dropPosition: 'inside',
        horizontalOffset: 0,
      });

      expect(projection.ok).toBe(true);
      expect(projection.dropIntent).toEqual({ targetFolderId: 'folder-B', position: 'inside' });

      const placement = resolveFolderDropPlacement(folders, 'folder-D', projection.dropIntent);
      expect(placement.ok).toBe(true);
      expect(placement.targetParentId).toBe('folder-B');
      expect(placement.placements?.filter((p) => p.parentId === 'folder-B')).toEqual([
        { id: 'folder-D', parentId: 'folder-B', order: 0 },
      ]);
    });

    it('integrates dropPosition before with domain placement', () => {
      // folder-D is depth 0. To project as depth 1 sibling of child-C, provide right offset 28px
      const projection = projectTreeDrop({
        folders,
        collapsedFolderIds: new Set(),
        draggedFolderId: 'folder-D',
        targetFolderId: 'child-C',
        dropPosition: 'before',
        horizontalOffset: 28,
      });

      expect(projection.ok).toBe(true);
      expect(projection.dropIntent).toEqual({ targetFolderId: 'child-C', position: 'before' });

      const placement = resolveFolderDropPlacement(folders, 'folder-D', projection.dropIntent);
      expect(placement.ok).toBe(true);
      expect(placement.targetParentId).toBe('folder-A');
      expect(placement.placements?.filter((p) => p.parentId === 'folder-A')).toEqual([
        { id: 'folder-D', parentId: 'folder-A', order: 0 },
        { id: 'child-C', parentId: 'folder-A', order: 1 },
        { id: 'child-E', parentId: 'folder-A', order: 2 },
      ]);
    });

    it('integrates dropPosition after with domain placement', () => {
      // folder-D is depth 0. To project as depth 1 sibling of child-E, provide right offset 28px
      const projection = projectTreeDrop({
        folders,
        collapsedFolderIds: new Set(),
        draggedFolderId: 'folder-D',
        targetFolderId: 'child-E',
        dropPosition: 'after',
        horizontalOffset: 28,
      });

      expect(projection.ok).toBe(true);
      expect(projection.dropIntent).toEqual({ targetFolderId: 'child-E', position: 'after' });

      const placement = resolveFolderDropPlacement(folders, 'folder-D', projection.dropIntent);
      expect(placement.ok).toBe(true);
      expect(placement.targetParentId).toBe('folder-A');
      expect(placement.placements?.filter((p) => p.parentId === 'folder-A')).toEqual([
        { id: 'child-C', parentId: 'folder-A', order: 0 },
        { id: 'child-E', parentId: 'folder-A', order: 1 },
        { id: 'folder-D', parentId: 'folder-A', order: 2 },
      ]);
    });
  });

  describe('Self-Origin Horizontal Outdent Projection', () => {
    const treeFolders: BookmarkGroup[] = [
      { id: 'f-a', name: 'Folder A', order: 0 },
      { id: 'f-b', name: 'Folder B', order: 0, parentId: 'f-a' },
      { id: 'f-c', name: 'Folder C', order: 0, parentId: 'f-b' },
    ];

    it('A -> B -> C: dragging C left 1 level projects to after B at depth 1', () => {
      const res = projectTreeDrop({
        folders: treeFolders,
        collapsedFolderIds: new Set(),
        draggedFolderId: 'f-c',
        targetFolderId: 'f-c',
        dropPosition: 'inside', // hit on self surface
        horizontalOffset: -28, // delta = -1 -> depth 1 (after B)
      });

      expect(res.ok).toBe(true);
      expect(res.position).toBe('after');
      expect(res.projectedDepth).toBe(1);
      expect(res.projectedParentId).toBe('f-a');
      expect(res.dropIntent).toEqual({ targetFolderId: 'f-b', position: 'after' });
    });

    it('A -> B -> C: dragging C left 2 levels projects to after A at depth 0', () => {
      const res = projectTreeDrop({
        folders: treeFolders,
        collapsedFolderIds: new Set(),
        draggedFolderId: 'f-c',
        targetFolderId: 'f-c',
        dropPosition: 'before',
        horizontalOffset: -48, // delta = -2 -> depth 0 (after A)
      });

      expect(res.ok).toBe(true);
      expect(res.position).toBe('after');
      expect(res.projectedDepth).toBe(0);
      expect(res.projectedParentId).toBeUndefined();
      expect(res.dropIntent).toEqual({ targetFolderId: 'f-a', position: 'after' });
    });

    it('A -> B -> C: dragging C left beyond root clamps to depth 0', () => {
      const res = projectTreeDrop({
        folders: treeFolders,
        collapsedFolderIds: new Set(),
        draggedFolderId: 'f-c',
        targetFolderId: 'f-c',
        dropPosition: 'inside',
        horizontalOffset: -100,
      });

      expect(res.ok).toBe(true);
      expect(res.position).toBe('after');
      expect(res.projectedDepth).toBe(0);
      expect(res.dropIntent).toEqual({ targetFolderId: 'f-a', position: 'after' });
    });

    it('self-origin without outdent is rejected (ok: false)', () => {
      const res = projectTreeDrop({
        folders: treeFolders,
        collapsedFolderIds: new Set(),
        draggedFolderId: 'f-c',
        targetFolderId: 'f-c',
        dropPosition: 'inside',
        horizontalOffset: 0,
      });

      expect(res.ok).toBe(false);
      expect(res.reason).toContain('Self-origin gesture requires outdenting');
    });

    it('self-origin dragged right is rejected (ok: false)', () => {
      const res = projectTreeDrop({
        folders: treeFolders,
        collapsedFolderIds: new Set(),
        draggedFolderId: 'f-c',
        targetFolderId: 'f-c',
        dropPosition: 'inside',
        horizontalOffset: 40,
      });

      expect(res.ok).toBe(false);
    });

    it('root folder self-origin cannot outdent further (ok: false)', () => {
      const res = projectTreeDrop({
        folders: treeFolders,
        collapsedFolderIds: new Set(),
        draggedFolderId: 'f-a', // depth 0
        targetFolderId: 'f-a',
        dropPosition: 'inside',
        horizontalOffset: -40,
      });

      expect(res.ok).toBe(false);
    });
  });

  describe('Move Target Projection (getFlattenedFolderTree & getFolderItemIndentStyle)', () => {
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

    it('projects 4-6 level deep canonical hierarchy into DFS ordered list with accurate depth', () => {
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
      // Exclude l3 (and its descendants l4, l5, l6)
      const targets = getFlattenedFolderTree(deepFolders, 'l3');

      expect(targets.map((t) => t.folder.id)).toEqual(['l1', 'l2', 'r2', 'r2-c1']);
      expect(targets.find((t) => t.folder.id === 'l3')).toBeUndefined();
      expect(targets.find((t) => t.folder.id === 'l4')).toBeUndefined();
      expect(targets.find((t) => t.folder.id === 'l5')).toBeUndefined();
      expect(targets.find((t) => t.folder.id === 'l6')).toBeUndefined();
    });

    it('clamps indentation level accurately without unbounded growth at deep levels', () => {
      expect(getFolderItemIndentLevel(0)).toBe(0);
      expect(getFolderItemIndentLevel(-1)).toBe(0);
      expect(getFolderItemIndentLevel(1)).toBe(1);
      expect(getFolderItemIndentLevel(2)).toBe(2);
      expect(getFolderItemIndentLevel(6)).toBe(6);
      // Depth > 6 is clamped to max indent depth
      expect(getFolderItemIndentLevel(10)).toBe(TREE_MENU_MAX_INDENT_DEPTH);
    });
  });
});
