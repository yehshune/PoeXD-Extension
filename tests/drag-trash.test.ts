// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h } from 'vue';
import {
  calculateDragTrashPosition,
  hideDragTrash,
  showDragTrash,
  scheduleAfterSortableDrop,
  useDragTrash,
} from '@/components/sidebar/composables/useDragTrash';

function createDragTrashDomFixture() {
  const sidebar = document.createElement('div');
  sidebar.className = 'pxd-sidebar-wrapper';
  sidebar.getBoundingClientRect = () =>
    ({
      left: 0,
      right: 372,
      top: 0,
      bottom: 800,
      width: 372,
      height: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;

  const list = document.createElement('div');
  list.className = 'test-scroll-list';
  sidebar.appendChild(list);

  const trash = document.createElement('div');
  trash.className = 'drag-trash-zone';
  trash.getBoundingClientRect = () =>
    ({
      left: 384,
      right: 474,
      top: 80,
      bottom: 680,
      width: 90,
      height: 600,
      x: 384,
      y: 80,
      toJSON: () => ({}),
    }) as DOMRect;
  sidebar.appendChild(trash);

  document.body.appendChild(sidebar);
  return { sidebar, list, trash };
}

describe('drag trash lifecycle', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

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

  it('unwraps HTMLElement, Vue component $el, and null via setTrashZoneRef', () => {
    const { trash } = createDragTrashDomFixture();
    const session = useDragTrash('.test-scroll-list');

    session.setTrashZoneRef({ $el: trash });
    expect(session.trashZone.value).toBe(trash);

    session.setTrashZoneRef(null);
    expect(session.trashZone.value).toBeNull();

    session.setTrashZoneRef(trash);
    expect(session.trashZone.value).toBe(trash);

    session.dispose();
  });

  it('coordinates beginDrag, generic entity tracking, hover bounds, scroll lock, and endDrag', () => {
    const { list, trash } = createDragTrashDomFixture();
    type CustomEntity = { kind: 'item'; id: string };
    const session = useDragTrash<CustomEntity>('.test-scroll-list');
    session.setTrashZoneRef(trash);

    session.beginDrag({ kind: 'item', id: 'entry-1' });
    expect(session.isDragging.value).toBe(true);
    expect(session.isOverTrash.value).toBe(false);
    expect(session.activeDragEntity.value).toEqual({ kind: 'item', id: 'entry-1' });
    expect(trash.classList.contains('visible')).toBe(true);
    expect(session.trashStyle.value).toEqual({ left: '384px', right: 'auto' });

    // Window scroll outside list is blocked; inside list is permitted
    const outsideWheel = new Event('wheel', { cancelable: true, bubbles: true });
    window.dispatchEvent(outsideWheel);
    expect(outsideWheel.defaultPrevented).toBe(true);

    const insideWheel = new Event('wheel', { cancelable: true, bubbles: true });
    list.dispatchEvent(insideWheel);
    expect(insideWheel.defaultPrevented).toBe(false);

    // Drag enter highlights trash
    const enterEvent = new Event('dragenter', { cancelable: true });
    trash.dispatchEvent(enterEvent);
    expect(enterEvent.defaultPrevented).toBe(true);
    expect(session.isOverTrash.value).toBe(true);
    expect(trash.classList.contains('drag-hover')).toBe(true);

    // Drag leave inside rect keeps hover active
    const innerLeave = new MouseEvent('dragleave', { clientX: 400, clientY: 200 });
    trash.dispatchEvent(innerLeave);
    expect(session.isOverTrash.value).toBe(true);
    expect(trash.classList.contains('drag-hover')).toBe(true);

    // Drag leave outside rect clears hover
    const outerLeave = new MouseEvent('dragleave', { clientX: 100, clientY: 200 });
    trash.dispatchEvent(outerLeave);
    expect(session.isOverTrash.value).toBe(false);
    expect(trash.classList.contains('drag-hover')).toBe(false);

    // Re-hover then endDrag clears everything and unlocks scroll
    trash.dispatchEvent(new Event('dragover', { cancelable: true }));
    expect(session.isOverTrash.value).toBe(true);
    session.endDrag();

    expect(session.isDragging.value).toBe(false);
    expect(session.isOverTrash.value).toBe(false);
    expect(session.activeDragEntity.value).toBeNull();
    expect(trash.classList.contains('visible')).toBe(false);
    expect(trash.classList.contains('drag-hover')).toBe(false);

    const afterEndWheel = new Event('wheel', { cancelable: true, bubbles: true });
    window.dispatchEvent(afterEndWheel);
    expect(afterEndWheel.defaultPrevented).toBe(false);

    session.dispose();
  });

  it('cleans up active drag state, listeners, and scroll lock on explicit dispose() mid-drag', () => {
    const { trash } = createDragTrashDomFixture();
    const session = useDragTrash<{ id: string }>('.test-scroll-list');
    session.setTrashZoneRef(trash);

    session.beginDrag({ id: 'live-0' });
    trash.dispatchEvent(new Event('dragenter', { cancelable: true }));
    expect(session.isDragging.value).toBe(true);
    expect(session.isOverTrash.value).toBe(true);
    expect(trash.classList.contains('visible')).toBe(true);
    expect(trash.classList.contains('drag-hover')).toBe(true);

    session.dispose();

    expect(session.isDragging.value).toBe(false);
    expect(session.isOverTrash.value).toBe(false);
    expect(session.activeDragEntity.value).toBeNull();
    expect(trash.classList.contains('visible')).toBe(false);
    expect(trash.classList.contains('drag-hover')).toBe(false);

    const wheelEvent = new Event('wheel', { cancelable: true, bubbles: true });
    window.dispatchEvent(wheelEvent);
    expect(wheelEvent.defaultPrevented).toBe(false);

    trash.dispatchEvent(new Event('dragenter', { cancelable: true }));
    expect(session.isOverTrash.value).toBe(false);
    expect(trash.classList.contains('drag-hover')).toBe(false);
  });

  it('cleans up drag state, classes, listeners, and scroll lock when template ref clears before component unmount', () => {
    let session: ReturnType<typeof useDragTrash<{ id: string }>> | undefined;
    let mountedTrashEl: HTMLElement | null = null;

    const Host = defineComponent({
      setup() {
        session = useDragTrash<{ id: string }>('.test-scroll-list');
        return () =>
          h('div', { class: 'pxd-sidebar-wrapper' }, [
            h('div', {
              class: 'drag-trash-zone',
              ref: (el: unknown) => {
                if (el instanceof HTMLElement) mountedTrashEl = el;
                session!.setTrashZoneRef(el);
              },
            }),
          ]);
      },
    });

    const mountRoot = document.createElement('div');
    document.body.appendChild(mountRoot);
    const app = createApp(Host);
    app.mount(mountRoot);

    const trash = mountedTrashEl!;
    expect(trash).toBeInstanceOf(HTMLElement);

    session!.beginDrag({ id: 'live-1' });
    trash.dispatchEvent(new Event('dragenter', { cancelable: true }));
    expect(session!.isDragging.value).toBe(true);
    expect(session!.isOverTrash.value).toBe(true);
    expect(trash.classList.contains('visible')).toBe(true);
    expect(trash.classList.contains('drag-hover')).toBe(true);

    app.unmount();

    expect(session!.isDragging.value).toBe(false);
    expect(session!.isOverTrash.value).toBe(false);
    expect(session!.activeDragEntity.value).toBeNull();
    expect(trash.classList.contains('visible')).toBe(false);
    expect(trash.classList.contains('drag-hover')).toBe(false);

    const wheelEvent = new Event('wheel', { cancelable: true, bubbles: true });
    window.dispatchEvent(wheelEvent);
    expect(wheelEvent.defaultPrevented).toBe(false);

    trash.dispatchEvent(new Event('dragenter', { cancelable: true }));
    expect(session!.isOverTrash.value).toBe(false);
    expect(trash.classList.contains('drag-hover')).toBe(false);
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
