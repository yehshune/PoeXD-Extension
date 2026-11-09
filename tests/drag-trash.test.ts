import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  calculateDragTrashPosition,
  hideDragTrash,
  showDragTrash,
  scheduleAfterSortableDrop,
} from '@/components/sidebar/composables/useDragTrash';

describe('drag trash lifecycle', () => {
  it('anchors the trash zone to the rendered sidebar edge', () => {
    const rect = { left: 1100, right: 1440 };

    expect(calculateDragTrashPosition(rect, 1440)).toEqual({
      right: '352px',
      left: 'auto',
    });
    expect(calculateDragTrashPosition({ left: 0, right: 372 }, 1440)).toEqual({
      left: '384px',
      right: 'auto',
    });
  });

  it('defers mutations until Sortable has finished its drop cleanup', () => {
    vi.useFakeTimers();
    const work = vi.fn();

    scheduleAfterSortableDrop(work);
    expect(work).not.toHaveBeenCalled();

    vi.runAllTimers();
    expect(work).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it('shows at the rendered sidebar edge before drag start returns', () => {
    const style: Record<string, string> = {};
    const add = vi.fn();
    const remove = vi.fn();
    const trash = {
      style,
      classList: { add, remove },
      closest: () => ({ getBoundingClientRect: () => ({ left: 1100, right: 1440 }) }),
    } as unknown as HTMLElement;

    showDragTrash(trash, 1440);

    expect(style).toMatchObject({ right: '352px', left: 'auto' });
    expect(add).toHaveBeenCalledWith('visible');
    expect(add).toHaveBeenCalledWith('sidebar-right');

    hideDragTrash(trash);
    expect(remove).toHaveBeenCalledWith('visible');
  });

  it('uses the rendered edge when the initial sidebar state is stale', () => {
    const style: Record<string, string> = {};
    const add = vi.fn();
    const remove = vi.fn();
    const trash = {
      style,
      classList: { add, remove },
      closest: () => ({ getBoundingClientRect: () => ({ left: 0, right: 372 }) }),
    } as unknown as HTMLElement;

    showDragTrash(trash, 1440);

    expect(style).toMatchObject({ left: '384px', right: 'auto' });
    expect(add).toHaveBeenCalledWith('sidebar-left');
  });

  it('uses shadcn semantic destructive vocabulary and theme shadow instead of invalid hsl', () => {
    // 垃圾桶外觀由書籤頁與常用詞綴群組頁共用的元件提供
    const bookmarkPaneSource = readFileSync('components/sidebar/layout/DragTrashZone.vue', 'utf8');

    // Base visual uses theme semantic tokens in template
    expect(bookmarkPaneSource).toContain(
      'bg-[color-mix(in_srgb,var(--destructive)_15%,transparent)]',
    );
    expect(bookmarkPaneSource).toContain('border-destructive');
    expect(bookmarkPaneSource).toContain('rounded-[var(--radius)]');
    expect(bookmarkPaneSource).toContain('text-destructive');
    expect(bookmarkPaneSource).toContain('shadow-lg');

    // Must not use invalid hsl(var(--destructive)) or hardcoded rgba shadows
    expect(bookmarkPaneSource).not.toContain('hsl(var(--destructive)');
    expect(bookmarkPaneSource).not.toMatch(/rgba\(/);

    const hoverMatch = bookmarkPaneSource.match(/\.drag-trash-zone\.drag-hover\s*\{[^}]+\}/);
    expect(hoverMatch).toBeTruthy();
    const hoverRule = hoverMatch![0];
    expect(hoverRule).not.toMatch(/rgba\(/);
    expect(hoverRule).toContain('background-color: var(--destructive) !important;');
    expect(hoverRule).toContain('color: var(--destructive-foreground) !important;');
    expect(hoverRule).toContain('box-shadow: var(--shadow-2xl);');
  });

  it('anchors to .pxd-sidebar-wrapper and eliminates legacy .poe-sidebar-wrapper hook', () => {
    const useDragTrashSource = readFileSync(
      'components/sidebar/composables/useDragTrash.ts',
      'utf8',
    );
    expect(useDragTrashSource).toContain("'.pxd-sidebar-wrapper'");
    expect(useDragTrashSource).not.toContain('poe-sidebar-wrapper');
  });

  it('differentiates folder and bookmark sortable-ghost rules on trash hover to preserve folder layout footprint and present destructive preview', () => {
    const bookmarkPaneSource = readFileSync('components/sidebar/BookmarkPane.vue', 'utf8');

    // 1. Bookmark row collapses on trash hover to preserve existing bookmark DnD UX
    const bookmarkCollapseMatch = bookmarkPaneSource.match(
      /\.bookmark-pane:has\(\.drag-trash-zone\.drag-hover\)\s+\.bookmark-row-item\.sortable-ghost\s*\{([^}]+)\}/,
    );
    expect(bookmarkCollapseMatch).toBeTruthy();
    const bookmarkRule = bookmarkCollapseMatch![1];
    expect(bookmarkRule).toContain('height: 0 !important;');
    expect(bookmarkRule).toContain('min-height: 0 !important;');
    expect(bookmarkRule).toContain('margin: 0 !important;');
    expect(bookmarkRule).toContain('padding: 0 !important;');

    // 2. Folder row strictly preserves layout footprint and applies destructive preview tokens without visibility:hidden
    const folderGhostMatch = bookmarkPaneSource.match(
      /\.bookmark-pane:has\(\.drag-trash-zone\.drag-hover\)\s+\.group-container\.sortable-ghost[^{]*\{([^}]+)\}/,
    );
    expect(folderGhostMatch).toBeTruthy();
    const folderRule = folderGhostMatch![1];
    expect(folderRule).toContain('visibility: visible !important;');
    expect(folderRule).toContain('border-color: var(--destructive) !important;');
    expect(folderRule).not.toContain('visibility: hidden');
    expect(folderRule).not.toContain('height: 0');
    expect(folderRule).not.toContain('min-height: 0');
    expect(folderRule).not.toContain('margin: 0');
    expect(folderRule).not.toContain('padding: 0');

    // 3. Subtree descendants and origin receive destructive header rail
    expect(bookmarkPaneSource).toMatch(
      /\.bookmark-pane:has\(\.drag-trash-zone\.drag-hover\)[\s\S]*?\.group-container\.dragging-subtree-origin\s*>\s*\.group-header-row/,
    );
    expect(bookmarkPaneSource).toMatch(
      /\.bookmark-pane:has\(\.drag-trash-zone\.drag-hover\)[\s\S]*?\.group-container\.dragging-subtree-descendant\s*>\s*\.group-header-row/,
    );
    expect(bookmarkPaneSource).toContain('border-left-color: var(--destructive) !important;');

    // 4. Trash zone text is never hidden on hover, providing canonical live impact feedback
    expect(bookmarkPaneSource).not.toMatch(
      /\.drag-trash-zone\.drag-hover\s+span\s*\{\s*display:\s*none/,
    );
    expect(bookmarkPaneSource).toContain('放開以刪除');
    expect(bookmarkPaneSource).toContain('個資料夾');
    expect(bookmarkPaneSource).toContain('個書籤');
    expect(bookmarkPaneSource).toContain('放開以刪除書籤');
  });
});
