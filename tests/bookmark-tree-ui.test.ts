// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { activateBookmarkRows } from './helpers/bookmark-node-source';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import { ConfigProvider } from 'reka-ui';
import Sortable from 'sortablejs';
import BookmarkPane from '@/components/sidebar/BookmarkPane.vue';
import { buildFolderTree } from '@/components/sidebar/bookmark-tree';
import type { Bookmark, BookmarkGroup } from '@/components/sidebar/bookmark-types';
import type { TradeLeague } from '@/utils/trade-leagues';

vi.mock('sortablejs', () => ({
  default: {
    create: vi.fn(() => ({ destroy: vi.fn(), option: vi.fn() })),
  },
}));

const mockTradeLeagues: TradeLeague[] = [
  { id: 'Standard', text: '標準模式' },
  { id: 'Settlers', text: '卡爾葛墾荒者' },
];

vi.mock('@/utils/trade-leagues', () => ({
  fetchTradeLeagues: vi.fn(async () => mockTradeLeagues),
}));

let mockCollection = {
  groups: [] as any[],
  bookmarks: [] as any[],
};

let executeOutcomeSpy = vi.fn();
let bookmarkChangeSubscriber: ((event: any) => void) | null = null;

vi.mock('@/utils/bookmark-messaging', () => ({
  createChromeBookmarkClient: () => ({
    readCollection: vi.fn(async () => ({ ok: true, value: mockCollection })),
    exportTransfer: vi.fn(async () => ({
      ok: true,
      value: {
        kind: 'poexd-bookmarks',
        schemaVersion: 2,
        gameVersion: 'poe1',
        scope: 'collection',
        folders: [],
      },
    })),
    putGroup: vi.fn(async (group: any) => {
      executeOutcomeSpy('putGroup', group);
      return { ok: true };
    }),
    deleteGroup: vi.fn(async (groupId: string) => {
      executeOutcomeSpy('deleteGroup', groupId);
      return { ok: true };
    }),
    reorderGroups: vi.fn(async (groupIds: string[]) => {
      executeOutcomeSpy('reorderGroups', groupIds);
      return { ok: true };
    }),
    putBookmark: vi.fn(async (bookmark: any) => {
      executeOutcomeSpy('putBookmark', bookmark);
      return { ok: true };
    }),
    deleteBookmark: vi.fn(async (bookmarkId: string) => {
      executeOutcomeSpy('deleteBookmark', bookmarkId);
      return { ok: true };
    }),
    reorderBookmarks: vi.fn(async (placements: any[]) => {
      executeOutcomeSpy('reorderBookmarks', placements);
      return { ok: true };
    }),
    replaceLeague: vi.fn(async () => ({ ok: true })),
    importTransfer: vi.fn(async () => ({ ok: true })),
    subscribe: vi.fn((listener: any) => {
      bookmarkChangeSubscriber = listener;
      return () => {
        if (bookmarkChangeSubscriber === listener) {
          bookmarkChangeSubscriber = null;
        }
      };
    }),
  }),
}));

const mockChromeStorageData: Record<string, any> = {};
(globalThis as any).chrome = {
  storage: {
    local: {
      get: vi.fn(async (keys?: string | string[]) => {
        if (!keys) return { ...mockChromeStorageData };
        if (typeof keys === 'string') return { [keys]: mockChromeStorageData[keys] };
        return (keys as string[]).reduce(
          (acc, k) => {
            acc[k] = mockChromeStorageData[k];
            return acc;
          },
          {} as Record<string, any>,
        );
      }),
      set: vi.fn(async (items: Record<string, any>) => {
        Object.assign(mockChromeStorageData, items);
      }),
    },
    onChanged: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
  tabs: {
    query: vi.fn(async () => [{ title: 'Test Tab', url: 'https://www.pathofexile.com/trade' }]),
  },
  runtime: {
    getURL: vi.fn((path: string) => path),
    sendMessage: vi.fn(),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
};

(window as any).poexdAlert = vi.fn();
(window as any).poexdConfirm = vi.fn(async () => true);

describe('Bookmark Tree UI & Hierarchy Semantics', () => {
  describe('buildFolderTree helper', () => {
    it('constructs arbitrary depth tree with correct sibling ordering', () => {
      const folders: BookmarkGroup[] = [
        { id: 'root-2', name: 'Root 2', order: 1 },
        { id: 'root-1', name: 'Root 1', order: 0 },
        { id: 'child-1-b', name: 'Child 1B', order: 1, parentId: 'root-1' },
        { id: 'child-1-a', name: 'Child 1A', order: 0, parentId: 'root-1' },
        { id: 'grandchild-1', name: 'Grandchild 1', order: 0, parentId: 'child-1-a' },
      ];

      const tree = buildFolderTree(folders);

      expect(tree).toHaveLength(2);
      expect(tree[0].folder.id).toBe('root-1');
      expect(tree[0].depth).toBe(0);
      expect(tree[0].children).toHaveLength(2);
      expect(tree[0].children[0].folder.id).toBe('child-1-a');
      expect(tree[0].children[0].depth).toBe(1);
      expect(tree[0].children[1].folder.id).toBe('child-1-b');
      expect(tree[0].children[0].children).toHaveLength(1);
      expect(tree[0].children[0].children[0].folder.id).toBe('grandchild-1');
      expect(tree[0].children[0].children[0].depth).toBe(2);

      expect(tree[1].folder.id).toBe('root-2');
      expect(tree[1].depth).toBe(0);
      expect(tree[1].children).toHaveLength(0);
    });

    it('treats dangling folders without valid parent as root for resilience', () => {
      const folders: BookmarkGroup[] = [
        { id: 'f-1', name: 'Dangling', order: 0, parentId: 'missing-parent' },
      ];
      const tree = buildFolderTree(folders);
      expect(tree).toHaveLength(1);
      expect(tree[0].folder.id).toBe('f-1');
      expect(tree[0].depth).toBe(0);
    });
  });

  describe('BookmarkPane Component Tree UI Mounting', () => {
    let host: HTMLElement;
    let appRoot: HTMLElement;
    let portalRoot: HTMLElement;
    let app: ReturnType<typeof createApp>;

    beforeEach(async () => {
      mockCollection = {
        groups: [
          { id: 'g-equip', name: '裝備', order: 0 },
          { id: 'g-weapon', name: '武器', order: 0, parentId: 'g-equip' },
          { id: 'g-bow', name: '弓', order: 0, parentId: 'g-weapon' },
          { id: 'g-other', name: '消耗品', order: 1 },
        ],
        bookmarks: [
          {
            id: 'bm-equip',
            name: '胸甲 Kaom',
            url: 'https://pathofexile.com/trade/search/Standard/1',
            groupId: 'g-equip',
            order: 0,
          },
          {
            id: 'bm-bow',
            name: '神弓 Windripper',
            url: 'https://pathofexile.com/trade/search/Standard/2',
            groupId: 'g-bow',
            order: 0,
          },
        ],
      };
      executeOutcomeSpy.mockClear();
      vi.mocked((window as any).poexdConfirm).mockClear();
      vi.mocked(Sortable.create).mockClear();

      host = document.createElement('div');
      document.body.appendChild(host);
      const shadowRoot = host.attachShadow({ mode: 'open' });

      portalRoot = document.createElement('div');
      portalRoot.id = 'poexd-portal-root';
      shadowRoot.appendChild(portalRoot);

      appRoot = document.createElement('div');
      shadowRoot.appendChild(appRoot);

      const Root = defineComponent({
        setup() {
          return () =>
            h(
              ConfigProvider,
              { teleportTo: portalRoot, scrollBody: false },
              { default: () => h(BookmarkPane) },
            );
        },
      });

      app = createApp(Root);
      app.mount(appRoot);
      await nextTick();
      await new Promise((r) => setTimeout(r, 80));
      await activateBookmarkRows(appRoot);
    });

    afterEach(() => {
      app?.unmount();
      host?.remove();
      while (document.body.firstChild) {
        document.body.removeChild(document.body.firstChild);
      }
    });

    it('1. renders root, child, grandchild as flat sibling cards with depth indentation and direct bookmarks only', () => {
      const rootList = appRoot.querySelector('.bookmark-sortable-root');
      expect(rootList).not.toBeNull();

      // Find root folder 'g-equip'
      const equipEl = appRoot.querySelector('[data-group-id="g-equip"]');
      expect(equipEl).not.toBeNull();
      expect(equipEl?.getAttribute('data-depth')).toBe('0');

      // In flat visual tree, child folder 'g-weapon' is a direct sibling in bookmark-sortable-root
      const weaponEl = appRoot.querySelector('[data-group-id="g-weapon"]');
      expect(weaponEl).not.toBeNull();
      expect(weaponEl?.getAttribute('data-depth')).toBe('1');
      expect(weaponEl?.parentElement).toBe(rootList);

      // Grandchild 'g-bow' is also a direct sibling in bookmark-sortable-root
      const bowEl = appRoot.querySelector('[data-group-id="g-bow"]');
      expect(bowEl).not.toBeNull();
      expect(bowEl?.getAttribute('data-depth')).toBe('2');
      expect(bowEl?.parentElement).toBe(rootList);

      // Sibling order in rootList DOM: equip -> weapon -> bow
      expect(equipEl?.compareDocumentPosition(weaponEl!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
      expect(weaponEl?.compareDocumentPosition(bowEl!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

      // Visual indentation contract:
      // Depth 0: 0 indentation (no marginLeft)
      expect((equipEl as HTMLElement).style.marginLeft).toBe('');

      // Depth 1: 1 x nesting step using runtime tokens without typed arithmetic
      expect((weaponEl as HTMLElement).style.marginLeft).toBe(
        'calc(var(--pxd-space-lg) + var(--pxd-space-md))',
      );

      // Depth 2: 2 x nesting step using accumulated step addition without typed multiplication
      expect((bowEl as HTMLElement).style.marginLeft).toBe(
        'calc((var(--pxd-space-lg) + var(--pxd-space-md)) + (var(--pxd-space-lg) + var(--pxd-space-md)))',
      );

      // Visual indentation regression: verify usable, strictly increasing indentation across depth 0 -> 1 -> 2
      const parseIndentPixels = (styleVal: string, lg = 12, md = 8) => {
        if (!styleVal) return 0;
        const lgMatches = (styleVal.match(/var\(--pxd-space-lg\)/g) || []).length;
        const mdMatches = (styleVal.match(/var\(--pxd-space-md\)/g) || []).length;
        return lgMatches * lg + mdMatches * md;
      };

      const indent0 = parseIndentPixels((equipEl as HTMLElement).style.marginLeft);
      const indent1 = parseIndentPixels((weaponEl as HTMLElement).style.marginLeft);
      const indent2 = parseIndentPixels((bowEl as HTMLElement).style.marginLeft);

      expect(indent0).toBe(0);
      expect(indent1).toBe(20);
      expect(indent2).toBe(40);
      expect(indent0).toBeLessThan(indent1);
      expect(indent1).toBeLessThan(indent2);

      // Verify dynamic synchronization under Scale 1.2 tokens (14.4px + 9.6px = 24px)
      const indent1Scaled = parseIndentPixels(
        (weaponEl as HTMLElement).style.marginLeft,
        14.4,
        9.6,
      );
      const indent2Scaled = parseIndentPixels((bowEl as HTMLElement).style.marginLeft, 14.4, 9.6);
      expect(indent1Scaled).toBe(24);
      expect(indent2Scaled).toBe(48);

      // equipBody contains only direct bookmarks, NO folder-children-list or nested folder cards!
      const equipBody = equipEl?.querySelector(':scope > .group-body');
      expect(equipBody).not.toBeNull();
      expect(equipBody?.querySelector('.folder-children-list')).toBeNull();
      expect(equipBody?.querySelector('.group-container')).toBeNull();

      const directBookmarksWrapper = equipBody?.querySelector(':scope > .bookmark-list-wrapper');
      expect(directBookmarksWrapper).not.toBeNull();
      expect(directBookmarksWrapper?.querySelector('[data-id="bm-equip"]')).not.toBeNull();
    });

    it('2. collapses parent to hide all descendants and direct bookmarks, and restores upon expand', async () => {
      const equipEl = appRoot.querySelector('[data-group-id="g-equip"]');
      const equipHeader = equipEl?.querySelector('.group-header-row') as HTMLElement;
      expect(equipHeader).not.toBeNull();

      // Click to collapse
      equipHeader.click();
      await nextTick();
      await new Promise((r) => setTimeout(r, 30));

      // equipBody should not be rendered
      expect(equipEl?.querySelector(':scope > .group-body')).toBeNull();
      // Consequently, descendants (g-weapon, g-bow) and bookmarks (bm-equip) are not rendered
      expect(appRoot.querySelector('[data-group-id="g-weapon"]')).toBeNull();
      expect(appRoot.querySelector('[data-group-id="g-bow"]')).toBeNull();
      expect(appRoot.querySelector('[data-id="bm-equip"]')).toBeNull();

      // Click to expand again
      equipHeader.click();
      await nextTick();
      await new Promise((r) => setTimeout(r, 30));

      // Descendants are restored
      expect(appRoot.querySelector('[data-group-id="g-weapon"]')).not.toBeNull();
      expect(appRoot.querySelector('[data-group-id="g-bow"]')).not.toBeNull();
      expect(appRoot.querySelector('[data-id="bm-equip"]')).not.toBeNull();
    });

    it('3. uses subtree-aware prompt when deleting folder with descendants', async () => {
      const equipEl = appRoot.querySelector('[data-group-id="g-equip"]');
      const triggerBtn = equipEl?.querySelector(
        '.group-actions button[title="操作選單"]',
      ) as HTMLButtonElement;
      expect(triggerBtn).not.toBeNull();

      triggerBtn.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
      triggerBtn.click();
      await nextTick();
      await new Promise((r) => setTimeout(r, 50));

      const deleteItem = Array.from(
        portalRoot.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]'),
      ).find((item) => item.textContent?.includes('刪除資料夾'));
      expect(deleteItem).toBeDefined();

      deleteItem?.click();
      await nextTick();

      // 'g-equip' has 2 descendant folders (weapon, bow) and 2 bookmarks total (bm-equip, bm-bow)
      expect((window as any).poexdConfirm).toHaveBeenCalledWith(
        expect.stringContaining('該資料夾及其 2 個子資料夾中包含 2 個書籤，將一併刪除。'),
        '刪除資料夾',
      );
      await vi.waitFor(() =>
        expect(executeOutcomeSpy).toHaveBeenCalledWith('deleteGroup', 'g-equip'),
      );
    });

    it('4. distinguishes duplicate folder names in Move to Folder submenu using full hierarchy path', async () => {
      // Find bookmark in g-bow
      const bmRow = appRoot.querySelector('[data-id="bm-bow"]');
      const triggerBtn = bmRow?.querySelector(
        '.bookmark-item-actions button[title="操作選單"]',
      ) as HTMLButtonElement;
      expect(triggerBtn).not.toBeNull();

      triggerBtn.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
      triggerBtn.click();
      await nextTick();
      await new Promise((r) => setTimeout(r, 50));

      // In Move submenu, groups are listed with full breadcrumb
      const moveTrigger = Array.from(
        portalRoot.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-sub-trigger"]'),
      ).find((item) => item.textContent?.includes('移動到資料夾'));
      expect(moveTrigger).toBeDefined();
    });

    it('5. maintains single ScrollArea without nested scrollbars', () => {
      const scrollAreas = appRoot.querySelectorAll('.bookmark-accordion-list');
      expect(scrollAreas).toHaveLength(1);

      const breathingRoom = appRoot.querySelector('.pb-\\[var\\(--pxd-pane-scroll-end-space\\)\\]');
      expect(breathingRoom).not.toBeNull();
    });

    it('6. creates root folder with order based only on root siblings, and creates child folder with parentId and sibling order', async () => {
      // 1. Click top "新建資料夾" button -> root folder
      const topAddBtn = Array.from(appRoot.querySelectorAll<HTMLButtonElement>('button')).find(
        (b) => b.textContent?.includes('新建資料夾'),
      );
      expect(topAddBtn).toBeDefined();

      topAddBtn?.click();
      await nextTick();

      await vi.waitFor(() => {
        const calls = executeOutcomeSpy.mock.calls.filter((c) => c[0] === 'putGroup');
        expect(calls.length).toBeGreaterThan(0);
        const lastCall = calls[calls.length - 1];
        const addedGroup = lastCall[1];
        expect(addedGroup.parentId).toBeUndefined();
        // Roots are g-equip(order 0) and g-other(order 1), so new root order should be 2 (not 4)
        expect(addedGroup.order).toBe(2);
        expect(addedGroup.name).toBe('新資料夾');
      });

      executeOutcomeSpy.mockClear();

      // 2. Click "新建子資料夾" in g-weapon's menu -> child folder under g-weapon
      const weaponEl = appRoot.querySelector('[data-group-id="g-weapon"]');
      const weaponTrigger = weaponEl?.querySelector(
        '.group-actions button[title="操作選單"]',
      ) as HTMLButtonElement;
      expect(weaponTrigger).not.toBeNull();

      weaponTrigger.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, cancelable: true }),
      );
      weaponTrigger.click();
      await nextTick();
      await new Promise((r) => setTimeout(r, 50));

      const addChildItem = Array.from(
        portalRoot.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]'),
      ).find((item) => item.textContent?.includes('新建子資料夾'));
      expect(addChildItem).toBeDefined();

      addChildItem?.click();
      await nextTick();

      await vi.waitFor(() => {
        const calls = executeOutcomeSpy.mock.calls.filter((c) => c[0] === 'putGroup');
        expect(calls.length).toBeGreaterThan(0);
        const lastCall = calls[calls.length - 1];
        const addedChild = lastCall[1];
        expect(addedChild.parentId).toBe('g-weapon');
        // Under g-weapon, there is already g-bow (order 0), so new child order should be 1
        expect(addedChild.order).toBe(1);
        // Sibling naming scope: under g-weapon there is no "新資料夾", so it can name "新資料夾"
        expect(addedChild.name).toBe('新資料夾');
      });
    });

    it('7. safely disables flat groupSortable when nested hierarchy is present to prevent invalid reorders', async () => {
      // In beforeEach, mockCollection has parentId hierarchy (g-weapon under g-equip).
      // Verify Sortable.create was NEVER called with handle: '.group-header-row'
      const calls = vi.mocked(Sortable.create).mock.calls;
      const groupSortableCall = calls.find((args) => args[1]?.handle === '.group-header-row');
      expect(groupSortableCall).toBeUndefined();
    });

    it('8. external parentId-only change triggers Sortable destroy and re-binds fresh Sortable to new container', async () => {
      // 1. Initial state:
      // Folder A (order 0)
      //   - Folder X (order 0, parentId: 'f-a')
      // Folder B (order 1)
      mockCollection.groups = [
        { id: 'f-a', name: 'Folder A', order: 0 },
        { id: 'f-b', name: 'Folder B', order: 1 },
        { id: 'f-x', name: 'Folder X', order: 0, parentId: 'f-a' },
      ];
      mockCollection.bookmarks = [];

      const createdSortables: Array<{ el: HTMLElement; destroy: ReturnType<typeof vi.fn> }> = [];
      vi.mocked(Sortable.create).mockImplementation((el: any) => {
        const instance = { destroy: vi.fn(), option: vi.fn() };
        createdSortables.push({ el, destroy: instance.destroy });
        return instance as any;
      });

      // Trigger initial reconcile
      bookmarkChangeSubscriber?.({ type: 'change' });
      await nextTick();
      await new Promise((r) => setTimeout(r, 60));

      const folderA = appRoot.querySelector('[data-group-id="f-a"]');
      const folderB = appRoot.querySelector('[data-group-id="f-b"]');
      const folderX = appRoot.querySelector('[data-group-id="f-x"]');
      const rootList = appRoot.querySelector('.bookmark-sortable-root');
      expect(folderA?.parentElement).toBe(rootList);
      expect(folderB?.parentElement).toBe(rootList);
      expect(folderX?.parentElement).toBe(rootList);

      // In initial state, f-x is child of f-a, so sibling order is f-a -> f-x -> f-b
      expect(folderA?.compareDocumentPosition(folderX!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
      expect(folderX?.compareDocumentPosition(folderB!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
      expect(folderX?.getAttribute('data-depth')).toBe('1');

      const initialInstances = [...createdSortables];
      expect(initialInstances.length).toBeGreaterThan(0);

      // 2. Simulate external canonical update:
      // ONLY change X's parentId from 'f-a' to 'f-b'. X's id ('f-x') and order (0) remain identical!
      mockCollection.groups = [
        { id: 'f-a', name: 'Folder A', order: 0 },
        { id: 'f-b', name: 'Folder B', order: 1 },
        { id: 'f-x', name: 'Folder X', order: 0, parentId: 'f-b' },
      ];

      createdSortables.length = 0;
      bookmarkChangeSubscriber?.({ type: 'change' });
      await nextTick();
      await new Promise((r) => setTimeout(r, 60));

      const updatedFolderA = appRoot.querySelector('[data-group-id="f-a"]');
      const updatedFolderB = appRoot.querySelector('[data-group-id="f-b"]');
      const updatedFolderX = appRoot.querySelector('[data-group-id="f-x"]');

      // 3. Verify DOM updated in Flat Visual Tree: X is now after B, NOT after A
      expect(updatedFolderA?.compareDocumentPosition(updatedFolderB!)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
      expect(updatedFolderB?.compareDocumentPosition(updatedFolderX!)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
      expect(updatedFolderX?.getAttribute('data-depth')).toBe('1');

      // 4. Verify all old Sortable instances were destroyed (no stale lifecycle)
      for (const oldInstance of initialInstances) {
        expect(oldInstance.destroy).toHaveBeenCalled();
      }

      // 5. Verify fresh Sortable instance was created for single rootList container
      expect(createdSortables.length).toBeGreaterThan(0);
      const boundToFolderRoot = createdSortables.find((item) => item.el === rootList);
      expect(boundToFolderRoot).toBeDefined();
    });

    it('9. adapts empty folder display: parent without bookmarks displays header-only normally, expands compact drop target during bookmark drag, while empty leaf folder retains drop area', async () => {
      const weaponEl = appRoot.querySelector('[data-group-id="g-weapon"]');
      const otherEl = appRoot.querySelector('[data-group-id="g-other"]');
      const equipEl = appRoot.querySelector('[data-group-id="g-equip"]');
      expect(weaponEl).not.toBeNull();
      expect(otherEl).not.toBeNull();
      expect(equipEl).not.toBeNull();

      const weaponHeader = weaponEl!.querySelector('.group-header-row') as HTMLElement;
      const otherHeader = otherEl!.querySelector('.group-header-row') as HTMLElement;
      const equipHeader = equipEl!.querySelector('.group-header-row') as HTMLElement;
      const weaponBody = weaponEl!.querySelector('.group-body') as HTMLElement;
      const otherBody = otherEl!.querySelector('.group-body') as HTMLElement;
      const equipBody = equipEl!.querySelector('.group-body') as HTMLElement;

      // 1. Normal state (no drag active, DEFAULT bottom mode)
      // Parent with child but no direct bookmarks (g-weapon): header-only, body is display: none
      expect(weaponBody).not.toBeNull();
      expect(weaponBody.style.display).toBe('none');
      expect(weaponHeader.classList.contains('border-b')).toBe(false);
      // SortableJS registration target MUST remain in DOM
      expect(weaponBody.querySelector('.bookmark-list-wrapper')).not.toBeNull();
      // Even in bottom mode, header-only parent MUST provide header add button as direct entry
      const weaponHeaderAddBtn = weaponHeader.querySelector(
        'button[title="新增當前網頁到此資料夾"]',
      );
      expect(weaponHeaderAddBtn).not.toBeNull();
      // Body is hidden, bottom add container is NOT rendered for header-only parent
      expect(weaponBody.querySelector('.bookmark-bottom-add-container')).toBeNull();

      // Empty leaf folder (g-other): retains default empty state body with helper text; top mode uses header add button
      expect(otherBody.style.display).not.toBe('none');
      expect(otherHeader.querySelector('button[title="新增當前網頁到此資料夾"]')).not.toBeNull();
      const otherEmptyText = otherBody.querySelector('.empty-group-text');
      expect(otherEmptyText).not.toBeNull();
      expect(otherEmptyText?.textContent).toContain('資料夾內尚無書籤');
      expect(otherBody.querySelector('.bookmark-bottom-add-container')).toBeNull();

      // Folder with bookmarks (g-equip): normal body with bookmark rows; top mode uses header add button
      expect(equipBody.style.display).not.toBe('none');
      expect(equipHeader.querySelector('button[title="新增當前網頁到此資料夾"]')).not.toBeNull();
      expect(equipBody.querySelector('[data-id="bm-equip"]')).not.toBeNull();
      expect(equipBody.querySelector('.bookmark-bottom-add-container')).toBeNull();

      // 2. Start dragging a bookmark
      // Locate Sortable options for bookmark sortable
      const bookmarkSortableCall = vi
        .mocked(Sortable.create)
        .mock.calls.find(
          (args) =>
            (args[0] as HTMLElement)?.classList?.contains('bookmark-list-wrapper') &&
            typeof args[1]?.onStart === 'function',
        );
      expect(bookmarkSortableCall).toBeDefined();
      const sortableOptions = bookmarkSortableCall![1]!;

      // Simulate bookmark drag start
      sortableOptions.onStart!({
        item: { getAttribute: (attr: string) => (attr === 'data-id' ? 'bm-equip' : null) },
      } as any);
      await nextTick();

      // Parent without direct bookmarks expands clear and compact drop target
      expect(weaponBody.style.display).not.toBe('none');
      expect(weaponHeader.classList.contains('border-b')).toBe(true);
      const compactDropZone = weaponBody.querySelector('.compact-drop-zone');
      expect(compactDropZone).not.toBeNull();
      expect(compactDropZone?.textContent).toContain('放置書籤至此資料夾');
      // Compact drop target MUST NOT render bottom add button container
      expect(weaponBody.querySelector('.bookmark-bottom-add-container')).toBeNull();

      // 3. End dragging (cancel or drop elsewhere)
      sortableOptions.onEnd!({
        item: { getAttribute: (attr: string) => (attr === 'data-id' ? 'bm-equip' : null) },
        to: equipBody.querySelector('.bookmark-list-wrapper') as any,
        from: equipBody.querySelector('.bookmark-list-wrapper') as any,
      } as any);
      await nextTick();

      // Restores header-only compact appearance
      expect(weaponBody.style.display).toBe('none');
      expect(weaponHeader.classList.contains('border-b')).toBe(false);
      expect(weaponHeader.querySelectorAll('button[title="新增當前網頁到此資料夾"]').length).toBe(
        1,
      );
    });

    it('10. does not render duplicate add buttons on header-only parent when preference is top', async () => {
      const BookmarkFolderNode = (await import('@/components/sidebar/BookmarkFolderNode.vue'))
        .default;
      const { BOOKMARK_PANE_CONTEXT_KEY } = await import('@/components/sidebar/bookmark-tree');

      const mockCtx = {
        addBookmarkBtnPosition: ref('top'),
        groups: ref([
          { id: 'g-parent', name: 'Parent', order: 0 },
          { id: 'g-child', name: 'Child', order: 0, parentId: 'g-parent' },
        ]),
        bookmarks: ref([]),
        isDragging: ref(false),
        isDraggingBookmark: ref(false),
        activeBookmarkId: ref(null),
        activePreviewData: ref(null),
        activeGroupMenuId: ref(null),
        activeBookmarkMenuId: ref(null),
        editingGroupId: ref(null),
        editingGroupName: ref(''),
        editingBookmarkId: ref(null),
        editingBookmarkName: ref(''),
        getFilteredGroupBookmarks: vi.fn(() => []),
        isGroupCollapsed: vi.fn(() => false),
        toggleGroupCollapse: vi.fn(),
        setGroupMenuOpen: vi.fn(),
        setBookmarkMenuOpen: vi.fn(),
        handleGroupTriggerPointerDown: vi.fn(),
        handleBookmarkTriggerPointerDown: vi.fn(),
        handleTriggerClick: vi.fn(),
        addBookmarkToGroup: vi.fn(),
        addChildFolder: vi.fn(),
        startRenameGroup: vi.fn(),
        confirmDeleteGroup: vi.fn(),
        hasSubtreeFolders: vi.fn(() => true),
        isSubtreeAllCollapsed: vi.fn(() => false),
        toggleSubtreeCollapse: vi.fn(),
        sidebarPosition: ref('left'),
      };

      const container = document.createElement('div');
      const Harness = defineComponent({
        setup() {
          return () =>
            h(BookmarkFolderNode, {
              node: {
                folder: { id: 'g-parent', name: 'Parent', order: 0 },
                depth: 0,
              },
            });
        },
        provide: {
          [BOOKMARK_PANE_CONTEXT_KEY]: mockCtx,
        },
      });

      const testApp = createApp(Harness);
      testApp.mount(container);
      await nextTick();

      const addBtns = container.querySelectorAll('button[title="新增當前網頁到此資料夾"]');
      expect(addBtns.length).toBe(1);
      testApp.unmount();
      container.remove();
    });
  });
});
