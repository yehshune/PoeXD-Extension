// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readBookmarkNodeSource } from './helpers/bookmark-node-source';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ConfigProvider } from 'reka-ui';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useBookmarkPreview } from '@/components/sidebar/composables/useBookmarkPreview';
import type { Bookmark } from '@/components/sidebar/bookmark-types';
import TradeSearchPreviewContent from '@/components/sidebar/search-preview/TradeSearchPreviewContent.vue';
import type { TradeSearchPreviewData } from '@/components/sidebar/composables/useTradeSearchPreview';
import { createBoundaryVirtualElement } from '@/components/sidebar/search-preview/preview-anchor';

const mockDecodeTradeSearchUrl = vi.fn();
const mockLoadTradeDictionaries = vi.fn();
const mockExtractQueryMetadata = vi.fn();

vi.mock('@/utils/trade-url-codec', () => ({
  decodeTradeSearchUrl: (...args: any[]) => mockDecodeTradeSearchUrl(...args),
  extractQueryMetadata: (...args: any[]) => mockExtractQueryMetadata(...args),
}));

vi.mock('@/utils/trade-stat-dictionary', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/trade-stat-dictionary')>();
  return {
    ...actual,
    loadTradeDictionaries: (...args: any[]) => mockLoadTradeDictionaries(...args),
  };
});

describe('useBookmarkPreview data composable', () => {
  const bookmarkA: Bookmark = {
    id: 'bm-1',
    searchRecordId: 'sr-1',
    name: 'Chaos Orb',
    url: 'https://www.pathofexile.com/trade/search/Standard/test1',
    groupId: 'grp-1',
    order: 0,
  };

  const bookmarkB: Bookmark = {
    id: 'bm-2',
    searchRecordId: 'sr-2',
    name: 'Exalted Orb',
    url: 'https://www.pathofexile.com/trade/search/Standard/test2',
    groupId: 'grp-1',
    order: 1,
  };

  beforeEach(() => {
    mockDecodeTradeSearchUrl.mockReset();
    mockLoadTradeDictionaries.mockReset();
    mockExtractQueryMetadata.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sets initial loading state immediately without composable timer delay', async () => {
    const isDragging = ref(false);
    let decodeResolve: (val: any) => void;
    mockDecodeTradeSearchUrl.mockReturnValue(
      new Promise((resolve) => {
        decodeResolve = resolve;
      }),
    );

    const { activeBookmarkId, activePreviewData, loadBookmarkPreview } = useBookmarkPreview({
      isDragging,
    });

    const loadPromise = loadBookmarkPreview(bookmarkA);
    // Directly enters loading state without requiring vi.advanceTimersByTime(220)
    expect(activeBookmarkId.value).toBe(bookmarkA.id);
    expect(activePreviewData.value).toEqual({ loading: true, realmLabel: '國際服' });

    decodeResolve!({ query: null });
    await loadPromise;
  });

  it('populates metadata on successful decode', async () => {
    const fakeMeta = {
      suggestedName: 'Chaos Orb',
      name: 'Chaos Orb',
      stats: [{ id: 'stat.1', min: 1 }],
      filters: [],
    };

    mockDecodeTradeSearchUrl.mockResolvedValue({
      gameVersion: 'poe1',
      league: 'Standard',
      query: { status: { option: 'online' } },
    });
    mockLoadTradeDictionaries.mockResolvedValue(undefined);
    mockExtractQueryMetadata.mockReturnValue(fakeMeta);

    const { activePreviewData, loadBookmarkPreview } = useBookmarkPreview();

    await loadBookmarkPreview(bookmarkA);

    expect(activePreviewData.value).toEqual({
      loading: false,
      gameVersion: 'poe1',
      realmLabel: '國際服',
      league: 'Standard',
      meta: fakeMeta,
      criteria: { status: 'online', statGroups: [], fields: [], sectionDisabled: {} },
    });
    expect(mockDecodeTradeSearchUrl).toHaveBeenCalledWith(bookmarkA.url);
    expect(mockLoadTradeDictionaries).toHaveBeenCalledWith('poe1');
    expect(mockExtractQueryMetadata).toHaveBeenCalledWith({ status: { option: 'online' } }, 'poe1');
  });

  it('uses cached data on cache hit without re-decoding', async () => {
    const fakeMeta = { suggestedName: 'Chaos Orb', stats: [], filters: [] };

    mockDecodeTradeSearchUrl.mockResolvedValue({
      gameVersion: 'poe1',
      league: 'Standard',
      query: {},
    });
    mockExtractQueryMetadata.mockReturnValue(fakeMeta);

    const { activePreviewData, loadBookmarkPreview, clearActivePreview } = useBookmarkPreview();

    // 1st load
    await loadBookmarkPreview(bookmarkA);
    expect(mockDecodeTradeSearchUrl).toHaveBeenCalledTimes(1);
    expect(activePreviewData.value?.meta).toEqual(fakeMeta);

    // Close preview
    clearActivePreview(bookmarkA.id);
    expect(activePreviewData.value).toBeNull();

    // 2nd load
    await loadBookmarkPreview(bookmarkA);
    // Cache hit: decode is NOT called again
    expect(mockDecodeTradeSearchUrl).toHaveBeenCalledTimes(1);
    expect(activePreviewData.value?.meta).toEqual(fakeMeta);
  });

  it('handles decode failure or legacy non-gzip urls by setting isLegacy', async () => {
    mockDecodeTradeSearchUrl.mockResolvedValue(null);

    const { activePreviewData, loadBookmarkPreview } = useBookmarkPreview();

    await loadBookmarkPreview(bookmarkA);

    expect(activePreviewData.value).toEqual({
      loading: false,
      isLegacy: true,
      realmLabel: '國際服',
    });
  });

  it('handles thrown errors gracefully by setting isLegacy', async () => {
    mockDecodeTradeSearchUrl.mockRejectedValue(new Error('Decompression error'));

    const { activePreviewData, loadBookmarkPreview } = useBookmarkPreview();

    await loadBookmarkPreview(bookmarkA);

    expect(activePreviewData.value).toEqual({
      loading: false,
      isLegacy: true,
      realmLabel: '國際服',
    });
  });

  it('prevents stale async requests from overwriting newer active bookmark', async () => {
    let resolveA: (val: any) => void;
    mockDecodeTradeSearchUrl.mockImplementation((url: string) => {
      if (url === bookmarkA.url) {
        return new Promise((resolve) => {
          resolveA = resolve;
        });
      }
      return Promise.resolve({
        gameVersion: 'poe1',
        league: 'Standard',
        query: { status: { option: 'online' } },
      });
    });

    const fakeMetaB = { suggestedName: 'Exalted Orb', stats: [], filters: [] };
    mockExtractQueryMetadata.mockReturnValue(fakeMetaB);

    const { activeBookmarkId, activePreviewData, loadBookmarkPreview, bookmarkPreviewCache } =
      useBookmarkPreview();

    // Start loading A (pending)
    const promiseA = loadBookmarkPreview(bookmarkA);
    expect(activeBookmarkId.value).toBe(bookmarkA.id);
    expect(activePreviewData.value).toEqual({ loading: true, realmLabel: '國際服' });

    // User switches to B before A finishes
    await loadBookmarkPreview(bookmarkB);
    expect(activeBookmarkId.value).toBe(bookmarkB.id);
    expect(activePreviewData.value?.meta).toEqual(fakeMetaB);

    // Now A resolves
    const fakeMetaA = { suggestedName: 'Chaos Orb', stats: [], filters: [] };
    mockExtractQueryMetadata.mockReturnValue(fakeMetaA);
    resolveA!({
      gameVersion: 'poe1',
      league: 'Standard',
      query: {},
    });
    await promiseA;

    // Active preview remains B!
    expect(activeBookmarkId.value).toBe(bookmarkB.id);
    expect(activePreviewData.value?.meta).toEqual(fakeMetaB);

    // But A is cached for future fast retrieval
    expect(bookmarkPreviewCache.has(bookmarkA.url)).toBe(true);
  });

  it('clears active preview when clearActivePreview is called', async () => {
    mockDecodeTradeSearchUrl.mockResolvedValue(null);

    const { activeBookmarkId, activePreviewData, loadBookmarkPreview, clearActivePreview } =
      useBookmarkPreview();

    await loadBookmarkPreview(bookmarkA);
    expect(activePreviewData.value).not.toBeNull();

    // Non-matching bookmark ID does not clear
    clearActivePreview(bookmarkB.id);
    expect(activePreviewData.value).not.toBeNull();

    // Matching bookmark ID clears
    clearActivePreview(bookmarkA.id);
    expect(activeBookmarkId.value).toBeNull();
    expect(activePreviewData.value).toBeNull();
  });

  it('ignores loadBookmarkPreview and clears active preview when isDragging is true', async () => {
    const isDragging = ref(false);
    mockDecodeTradeSearchUrl.mockResolvedValue(null);

    const { activeBookmarkId, activePreviewData, loadBookmarkPreview } = useBookmarkPreview({
      isDragging,
    });

    await loadBookmarkPreview(bookmarkA);
    expect(activePreviewData.value).not.toBeNull();
    expect(activeBookmarkId.value).toBe(bookmarkA.id);

    // Drag starts -> clears preview
    isDragging.value = true;
    await nextTick();
    expect(activePreviewData.value).toBeNull();
    expect(activeBookmarkId.value).toBeNull();

    // Loading while dragging is ignored
    await loadBookmarkPreview(bookmarkB);
    expect(activePreviewData.value).toBeNull();
    expect(activeBookmarkId.value).toBeNull();
    expect(mockDecodeTradeSearchUrl).toHaveBeenCalledTimes(1); // Only for bookmarkA
  });

  it('ignores loadBookmarkPreview and clears active preview when editingBookmarkId is set', async () => {
    const editingBookmarkId = ref<string | null>(null);
    mockDecodeTradeSearchUrl.mockResolvedValue(null);

    const { activeBookmarkId, activePreviewData, loadBookmarkPreview } = useBookmarkPreview({
      editingBookmarkId,
    });

    await loadBookmarkPreview(bookmarkA);
    expect(activePreviewData.value).not.toBeNull();
    expect(activeBookmarkId.value).toBe(bookmarkA.id);

    // Editing starts -> clears preview
    editingBookmarkId.value = bookmarkA.id;
    await nextTick();
    expect(activePreviewData.value).toBeNull();
    expect(activeBookmarkId.value).toBeNull();

    // Loading while editing is ignored
    await loadBookmarkPreview(bookmarkB);
    expect(activePreviewData.value).toBeNull();
    expect(activeBookmarkId.value).toBeNull();
  });
});

describe('Bookmark hover preview Runtime Tooltip & DOM contract', () => {
  const bookmarkA: Bookmark = {
    id: 'bm-1',
    searchRecordId: 'sr-1',
    name: 'Chaos Orb',
    url: 'https://www.pathofexile.com/trade/search/Standard/test1',
    groupId: 'grp-1',
    order: 0,
  };

  const bookmarkB: Bookmark = {
    id: 'bm-2',
    searchRecordId: 'sr-2',
    name: 'Exalted Orb',
    url: 'https://www.pathofexile.com/trade/search/Standard/test2',
    groupId: 'grp-1',
    order: 1,
  };

  it('unifies TooltipTrigger hit area with .bookmark-row-item and preserves Sortable DOM contract', async () => {
    const portalRoot = document.createElement('div');
    portalRoot.id = 'poexd-portal-root';
    document.body.appendChild(portalRoot);

    const editingBookmarkId = ref<string | null>(null);
    const bookmarks = [bookmarkA, bookmarkB];

    const TestComponent = defineComponent({
      setup() {
        return () =>
          h(ConfigProvider, { teleportTo: portalRoot }, () =>
            h(TooltipProvider, { delayDuration: 0, skipDelayDuration: 0 }, () =>
              h(
                'div',
                { class: 'bookmark-list-wrapper', 'data-group-id': 'grp-1' },
                bookmarks.map((bm) =>
                  h(Tooltip, { key: bm.id }, () => [
                    h(TooltipTrigger, { asChild: true }, () =>
                      h('div', { class: 'bookmark-row-item', 'data-id': bm.id }, [
                        h('span', { class: 'cover-icon' }, '•'),
                        editingBookmarkId.value === bm.id
                          ? h('input', { class: 'rename-input' })
                          : h('a', { href: bm.url, class: 'bookmark-link' }, bm.name),
                        h('div', { class: 'bookmark-item-actions' }, '...'),
                      ]),
                    ),
                    h(TooltipContent, { side: 'right', align: 'start' }, () =>
                      h('div', { class: 'bookmark-preview-popover' }, `Preview ${bm.name}`),
                    ),
                  ]),
                ),
              ),
            ),
          );
      },
    });

    const app = createApp(TestComponent);
    const container = document.createElement('div');
    document.body.appendChild(container);
    app.mount(container);

    const listWrapper = container.querySelector('.bookmark-list-wrapper');
    expect(listWrapper).not.toBeNull();

    // DOM contract: Tooltip wrapper must NOT insert intermediate DOM elements into bookmark-list-wrapper
    // Direct children of listWrapper are all .bookmark-row-item
    const childRows = listWrapper?.querySelectorAll(':scope > .bookmark-row-item');
    expect(childRows?.length).toBe(2);
    expect(listWrapper?.children.length).toBe(2);

    // Each row item has the trigger attributes and contains cover, text, and actions
    const firstRow = childRows?.[0] as HTMLElement;
    expect(firstRow.getAttribute('data-id')).toBe('bm-1');
    expect(firstRow.querySelector('.cover-icon')).not.toBeNull();
    expect(firstRow.querySelector('.bookmark-link')).not.toBeNull();
    expect(firstRow.querySelector('.bookmark-item-actions')).not.toBeNull();

    // When editing, input is rendered inside the row and satisfies Sortable filter: 'input'
    editingBookmarkId.value = 'bm-1';
    await nextTick();
    const inputEl = firstRow.querySelector('input.rename-input');
    expect(inputEl).not.toBeNull();
    expect(firstRow.querySelector('.bookmark-link')).toBeNull();

    app.unmount();
    container.remove();
    portalRoot.remove();
  });

  it('enforces controlled-open lifecycle: clears on drag or edit and re-opens after drag ends', async () => {
    const portalRoot = document.createElement('div');
    portalRoot.id = 'poexd-portal-root';
    document.body.appendChild(portalRoot);

    const isDragging = ref(false);
    const editingBookmarkId = ref<string | null>(null);

    const { activeBookmarkId, activePreviewData, loadBookmarkPreview, clearActivePreview } =
      useBookmarkPreview({ isDragging, editingBookmarkId });

    const handlePreviewOpenChange = (bm: Bookmark, open: boolean) => {
      if (open) {
        if (isDragging.value || editingBookmarkId.value === bm.id) return;
        loadBookmarkPreview(bm);
      } else {
        clearActivePreview(bm.id);
      }
    };

    const TestComponent = defineComponent({
      setup() {
        return () =>
          h(ConfigProvider, { teleportTo: portalRoot }, () =>
            h(TooltipProvider, { delayDuration: 0, skipDelayDuration: 0 }, () =>
              h(
                Tooltip,
                {
                  open: activeBookmarkId.value === bookmarkA.id,
                  disabled: isDragging.value || editingBookmarkId.value === bookmarkA.id,
                  'onUpdate:open': (open: boolean) => handlePreviewOpenChange(bookmarkA, open),
                },
                () => [
                  h(TooltipTrigger, { asChild: true }, () =>
                    h(
                      'div',
                      { class: 'bookmark-row-item', 'data-id': bookmarkA.id },
                      bookmarkA.name,
                    ),
                  ),
                  h(TooltipContent, { side: 'right', align: 'start' }, () =>
                    h('div', { class: 'bookmark-preview-popover' }, 'Preview Content'),
                  ),
                ],
              ),
            ),
          );
      },
    });

    const app = createApp(TestComponent);
    const container = document.createElement('div');
    document.body.appendChild(container);
    app.mount(container);

    expect(portalRoot.querySelector('[data-slot="tooltip-content"]')).toBeNull();

    // 1. Tooltip opens for Bookmark A
    handlePreviewOpenChange(bookmarkA, true);
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    expect(activeBookmarkId.value).toBe(bookmarkA.id);
    expect(activePreviewData.value).not.toBeNull();
    let contentInPortal = portalRoot.querySelector('[data-slot="tooltip-content"]');
    expect(contentInPortal).not.toBeNull();

    // 2. Drag starts -> clears active preview and closes Tooltip
    isDragging.value = true;
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    expect(activeBookmarkId.value).toBeNull();
    expect(activePreviewData.value).toBeNull();
    contentInPortal = portalRoot.querySelector('[data-slot="tooltip-content"]');
    expect(contentInPortal).toBeNull();

    // 3. Drag ends -> hover can open again
    isDragging.value = false;
    await nextTick();

    handlePreviewOpenChange(bookmarkA, true);
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    expect(activeBookmarkId.value).toBe(bookmarkA.id);
    expect(portalRoot.querySelector('[data-slot="tooltip-content"]')).not.toBeNull();

    // 4. Editing starts -> clears active preview and closes Tooltip
    editingBookmarkId.value = bookmarkA.id;
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    expect(activeBookmarkId.value).toBeNull();
    expect(activePreviewData.value).toBeNull();
    expect(portalRoot.querySelector('[data-slot="tooltip-content"]')).toBeNull();

    app.unmount();
    container.remove();
    portalRoot.remove();
  });

  it('handles duplicate URLs with distinct bookmark IDs: only hovered item opens, cache is shared by URL, and late close events do not clear subsequent opens', async () => {
    const portalRoot = document.createElement('div');
    portalRoot.id = 'poexd-portal-root';
    document.body.appendChild(portalRoot);

    const sameUrl = 'https://www.pathofexile.com/trade/search/Standard/shared-query';
    const bmSharedA: Bookmark = {
      id: 'bm-a',
      searchRecordId: 'sr-a',
      name: 'Shared Item A',
      url: sameUrl,
      groupId: 'grp-1',
      order: 0,
    };
    const bmSharedB: Bookmark = {
      id: 'bm-b',
      searchRecordId: 'sr-b',
      name: 'Shared Item B',
      url: sameUrl,
      groupId: 'grp-1',
      order: 1,
    };

    let decodeCalls = 0;
    mockDecodeTradeSearchUrl.mockImplementation(async () => {
      decodeCalls++;
      return {
        gameVersion: 'poe1',
        league: 'Standard',
        query: {},
      };
    });
    mockExtractQueryMetadata.mockReturnValue({
      suggestedName: 'Shared Item',
      stats: [],
      filters: [],
    });

    const {
      activeBookmarkId,
      activePreviewData,
      loadBookmarkPreview,
      clearActivePreview,
      bookmarkPreviewCache,
    } = useBookmarkPreview();

    const handleOpenChange = (bm: Bookmark, open: boolean) => {
      if (open) {
        loadBookmarkPreview(bm);
      } else {
        clearActivePreview(bm.id);
      }
    };

    const TestComponent = defineComponent({
      setup() {
        return () =>
          h(ConfigProvider, { teleportTo: portalRoot }, () =>
            h(TooltipProvider, { delayDuration: 0, skipDelayDuration: 0 }, () =>
              h('div', [
                h(
                  Tooltip,
                  {
                    open: activeBookmarkId.value === bmSharedA.id,
                    'onUpdate:open': (open: boolean) => handleOpenChange(bmSharedA, open),
                  },
                  () => [
                    h(TooltipTrigger, { asChild: true }, () =>
                      h(
                        'div',
                        { class: 'bookmark-row-item', 'data-id': bmSharedA.id },
                        bmSharedA.name,
                      ),
                    ),
                    h(TooltipContent, { side: 'right' }, () =>
                      h('div', { class: 'content-a' }, 'Preview A'),
                    ),
                  ],
                ),
                h(
                  Tooltip,
                  {
                    open: activeBookmarkId.value === bmSharedB.id,
                    'onUpdate:open': (open: boolean) => handleOpenChange(bmSharedB, open),
                  },
                  () => [
                    h(TooltipTrigger, { asChild: true }, () =>
                      h(
                        'div',
                        { class: 'bookmark-row-item', 'data-id': bmSharedB.id },
                        bmSharedB.name,
                      ),
                    ),
                    h(TooltipContent, { side: 'right' }, () =>
                      h('div', { class: 'content-b' }, 'Preview B'),
                    ),
                  ],
                ),
              ]),
            ),
          );
      },
    });

    const app = createApp(TestComponent);
    const container = document.createElement('div');
    document.body.appendChild(container);
    app.mount(container);

    // 1. Open A
    handleOpenChange(bmSharedA, true);
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    expect(activeBookmarkId.value).toBe('bm-a');
    // 2. Only A Tooltip is open
    expect(portalRoot.querySelector('.content-a')).not.toBeNull();
    // 3. B is NOT open
    expect(portalRoot.querySelector('.content-b')).toBeNull();
    // 4. Decode called once for sameUrl; cache is keyed by URL
    expect(decodeCalls).toBe(1);
    expect(bookmarkPreviewCache.has(sameUrl)).toBe(true);

    // 5. Close A and open B
    handleOpenChange(bmSharedB, true);
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    // B opens using cache; decode was NOT called again
    expect(decodeCalls).toBe(1);
    expect(activeBookmarkId.value).toBe('bm-b');
    expect(portalRoot.querySelector('.content-a')).toBeNull();
    expect(portalRoot.querySelector('.content-b')).not.toBeNull();

    // 6. Late close event from A arrives after B is already open
    handleOpenChange(bmSharedA, false); // clearActivePreview('bm-a')
    await nextTick();

    // Must NOT clear B!
    expect(activeBookmarkId.value).toBe('bm-b');
    expect(portalRoot.querySelector('.content-b')).not.toBeNull();

    // Finally close B
    handleOpenChange(bmSharedB, false); // clearActivePreview('bm-b')
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));
    expect(activeBookmarkId.value).toBeNull();
    expect(portalRoot.querySelector('.content-b')).toBeNull();

    app.unmount();
    container.remove();
    portalRoot.remove();
  });

  it('enforces shared preview architecture: TradeSearchPreviewTooltip encapsulation, BookmarkPane trigger slot, Popper positioning SSOT', () => {
    const bookmarkPanePath = path.resolve(__dirname, '../components/sidebar/BookmarkPane.vue');
    const bookmarkSource = readFileSync(bookmarkPanePath, 'utf-8');
    const bookmarkNodeSource = readBookmarkNodeSource();

    const tooltipCompPath = path.resolve(
      __dirname,
      '../components/sidebar/search-preview/TradeSearchPreviewTooltip.vue',
    );
    const tooltipSource = readFileSync(tooltipCompPath, 'utf-8');

    // BookmarkPane mounts a hoisted singleton, click-toggled preview anchored to the toggled row
    expect(bookmarkSource).toMatch(
      /<TradeSearchPreviewPopover[\s\S]*?:open="isPreviewOpen"[\s\S]*?:reference="previewAnchorEl"/,
    );
    expect(bookmarkSource).toContain(":side=\"sidebarPosition === 'left' ? 'right' : 'left'\"");

    // BookmarkFolderNode is decoupled: no hover preview, toggling goes through the shared context
    expect(bookmarkNodeSource).not.toContain('<TradeSearchPreviewTooltip');
    expect(bookmarkNodeSource).not.toContain('@mouseenter="ctx.handleBookmarkMouseEnter');
    expect(bookmarkNodeSource).toContain('ctx.toggleBookmarkPreview(bm, $event)');

    // TradeSearchPreviewTooltip encapsulates generic Tooltip primitive and Popper positioning SSOT
    expect(tooltipSource).toMatch(/<TooltipTrigger\s+as-child>[\s\S]*?<slot\s*\/>/);
    expect(tooltipSource).toContain(':disable-hoverable-content="false"');
    expect(tooltipSource).toContain(':side="side"');
    expect(tooltipSource).toContain('align="start"');
    expect(tooltipSource).toContain(':side-offset="10"');
    expect(tooltipSource).toContain(
      'max-h-[var(--reka-tooltip-content-available-height,calc(100vh-32px))]',
    );
    // 外框不捲動；捲動區域交由內容的 .preview-body，頂部的網域／聯盟／全部展開摺疊保持固定
    expect(tooltipSource).toContain('overflow-hidden');
    expect(tooltipSource).not.toContain('overflow-y-auto');
    expect(tooltipSource).not.toContain('pointer-events-none');

    // Neither composable nor tooltip maintains manual geometry or timers
    expect(bookmarkSource).not.toContain('getBoundingClientRect');
    expect(tooltipSource).not.toContain('getBoundingClientRect');
    expect(tooltipSource).not.toContain('hoverPreview.style');
    expect(tooltipSource).not.toContain('previewTimer');
  });

  it('enforces Sidebar.vue root TooltipProvider contract', () => {
    const sidebarPath = path.resolve(__dirname, '../components/Sidebar.vue');
    const source = readFileSync(sidebarPath, 'utf-8');

    // TooltipProvider wraps sidebar root inside ConfigProvider
    expect(source).toMatch(
      /<TooltipProvider[\s\S]*?:delay-duration="220"[\s\S]*?:skip-delay-duration="0"[\s\S]*?:disable-hoverable-content="true"/,
    );
    expect(source).toContain("import { TooltipProvider } from '@/components/ui/tooltip'");
  });

  it('enforces Theme semantic tokens in TradeSearchPreviewContent and purges preview styles from BookmarkPane', () => {
    const contentCompPath = path.resolve(
      __dirname,
      '../components/sidebar/search-preview/TradeSearchPreviewContent.vue',
    );
    const content = readFileSync(contentCompPath, 'utf-8');

    const bookmarkPanePath = path.resolve(__dirname, '../components/sidebar/BookmarkPane.vue');
    const bookmarkPaneContent = readFileSync(bookmarkPanePath, 'utf-8');

    // Untyped preview metadata must not use hardcoded colors
    expect(content).not.toContain('#38bdf8'); // Version tag
    expect(content).not.toContain('#af6025'); // Unique item
    expect(content).not.toContain('#d4af37'); // Stat title/range
    expect(content).not.toContain('#f59e0b'); // Filter title

    // Generic preview uses Theme semantic tokens (class-first)
    expect(content).toContain('bg-secondary');
    expect(content).toContain('text-secondary-foreground');
    expect(content).toContain('text-foreground');
    expect(content).toContain('text-muted-foreground');

    // Zero scoped styles in TradeSearchPreviewContent
    expect(content).not.toContain('<style');

    // Generic outer visual removed from popover container (now owned by TooltipContent)
    expect(content).not.toContain('z-50');
    expect(content).not.toContain('bg-popover');
    expect(content).not.toContain('shadow-md');

    // BookmarkPane no longer holds preview CSS
    expect(bookmarkPaneContent).not.toContain('.preview-header');
    expect(bookmarkPaneContent).not.toContain('.preview-stats-list');
  });

  describe('TradeSearchPreviewContent complete detail rendering contract', () => {
    const renderPreview = (previewData: TradeSearchPreviewData) => {
      const container = document.createElement('div');
      const app = createApp(TradeSearchPreviewContent, { previewData });
      app.mount(container);
      return { container, app };
    };

    it('shows the trade realm instead of the game version in the fixed header', () => {
      const { container, app } = renderPreview({
        loading: false,
        gameVersion: 'poe2',
        realmLabel: 'QQ',
        league: 'S1赛季',
        meta: { suggestedName: 'x', stats: [], filters: [] },
      });
      const tags = Array.from(container.querySelectorAll('.preview-header .preview-tag')).map(
        (el) => el.textContent?.trim(),
      );
      expect(tags).toEqual(['QQ', 'S1赛季']);
      expect(container.textContent).not.toContain('POE2');
      // 頂部標頭位於捲動區域之外
      expect(container.querySelector('.preview-body .preview-header')).toBeNull();
      expect(container.querySelector('.preview-body')?.className).toContain('overflow-y-auto');
      app.unmount();
    });

    it('keeps the tooltip height while collapsing so it does not shift away from the cursor', async () => {
      const data: TradeSearchPreviewData = {
        loading: false,
        gameVersion: 'poe1',
        meta: {
          suggestedName: 'x',
          stats: [{ id: 'stat-1', min: 1 }],
          filters: [{ sectionKey: 'trade_filters', fieldKey: 'price', value: { min: 10 } }],
        },
      };
      const container = document.createElement('div');
      const current = ref<TradeSearchPreviewData>(data);
      const app = createApp(
        defineComponent({
          setup: () => () => h(TradeSearchPreviewContent, { previewData: current.value }),
        }),
      );
      app.mount(container);
      const root = container.querySelector<HTMLElement>('.trade-search-preview-popover')!;
      const offsetHeight = vi.spyOn(root, 'offsetHeight', 'get').mockReturnValue(240);

      container.querySelector<HTMLButtonElement>('.preview-toggle-all')!.click();
      await nextTick();
      expect(root.style.minHeight).toBe('240px');

      // 之後內容變矮也維持原高度；再次展開不會重新量測
      offsetHeight.mockReturnValue(80);
      container.querySelector<HTMLButtonElement>('.preview-toggle-all')!.click();
      await nextTick();
      expect(root.style.minHeight).toBe('240px');

      // 切換到另一筆搜尋時解除鎖定
      current.value = { ...data, league: 'Standard' };
      await nextTick();
      expect(
        container.querySelector<HTMLElement>('.trade-search-preview-popover')!.style.minHeight,
      ).toBe('');
      app.unmount();
    });

    it('collapses sections individually and toggles all from the header', async () => {
      const { container, app } = renderPreview({
        loading: false,
        gameVersion: 'poe1',
        meta: {
          suggestedName: 'x',
          stats: [{ id: 'stat-1', min: 1 }],
          filters: [
            { sectionKey: 'type_filters', fieldKey: 'category', value: { option: 'armour' } },
            { sectionKey: 'trade_filters', fieldKey: 'price', value: { min: 10 } },
          ],
        },
      });
      const toggles = () =>
        Array.from(container.querySelectorAll<HTMLButtonElement>('.preview-section-toggle'));
      const visibleRows = () =>
        Array.from(
          container.querySelectorAll<HTMLElement>('.preview-stat-row, .preview-filter-row'),
        ).filter((row) => (row.parentElement as HTMLElement).style.display !== 'none').length;
      const toggleAll = () => container.querySelector<HTMLButtonElement>('.preview-toggle-all')!;

      expect(toggles()).toHaveLength(3);
      expect(toggles().every((button) => button.getAttribute('aria-expanded') === 'true')).toBe(
        true,
      );
      expect(visibleRows()).toBe(3);
      expect(toggleAll().textContent).toContain('全部摺疊');

      toggles()[1].click();
      await nextTick();
      expect(toggles()[1].getAttribute('aria-expanded')).toBe('false');
      expect(visibleRows()).toBe(2);
      expect(toggleAll().textContent).toContain('全部展開');

      toggleAll().click();
      await nextTick();
      expect(visibleRows()).toBe(3);
      expect(toggleAll().textContent).toContain('全部摺疊');

      toggleAll().click();
      await nextTick();
      expect(visibleRows()).toBe(0);
      expect(toggles().every((button) => button.getAttribute('aria-expanded') === 'false')).toBe(
        true,
      );
      app.unmount();
    });

    it('hides the expand/collapse-all control when there is nothing to collapse', () => {
      const { container, app } = renderPreview({ loading: true, realmLabel: '台服' });
      expect(container.querySelector('.preview-toggle-all')).toBeNull();
      expect(container.querySelector('.realm-tag')?.textContent?.trim()).toBe('台服');
      app.unmount();
    });

    it('renders all stats and filters when total count is within small range', () => {
      const data: TradeSearchPreviewData = {
        loading: false,
        gameVersion: 'poe1',
        league: 'Standard',
        meta: {
          suggestedName: 'Test Item',
          stats: [
            { id: 'stat-1', min: 1 },
            { id: 'stat-2', min: 2 },
            { id: 'stat-3', min: 3 },
          ],
          filters: [
            { sectionKey: 'misc_filters', fieldKey: 'quality', value: { min: 20 } },
            { sectionKey: 'misc_filters', fieldKey: 'gem_level', value: { min: 20 } },
          ],
        },
      };

      const { container, app } = renderPreview(data);
      const statRows = container.querySelectorAll('.preview-stat-row');
      const filterRows = container.querySelectorAll('.preview-filter-row');
      const omittedEl = container.querySelector('.preview-omitted');

      expect(statRows.length).toBe(3);
      expect(filterRows.length).toBe(2);
      expect(omittedEl).toBeNull();
      app.unmount();
    });

    it('renders all stats and filters without budget truncation or omitted count when exceeding 8 items', () => {
      const stats = Array.from({ length: 11 }, (_, i) => ({ id: `stat-${i + 1}`, min: i + 1 }));
      const data: TradeSearchPreviewData = {
        loading: false,
        gameVersion: 'poe1',
        meta: {
          suggestedName: 'Overloaded Stats',
          stats,
          filters: [{ sectionKey: 'misc_filters', fieldKey: 'quality', value: { min: 20 } }],
        },
      };

      const { container, app } = renderPreview(data);
      const statRows = container.querySelectorAll('.preview-stat-row');
      const filterRows = container.querySelectorAll('.preview-filter-row');
      const filterSection = container.querySelector('.filter-group-section');
      const omittedEl = container.querySelector('.preview-omitted');

      expect(statRows.length).toBe(11);
      expect(filterRows.length).toBe(1);
      expect(filterSection).not.toBeNull();
      expect(omittedEl).toBeNull();
      app.unmount();
    });

    it('renders all items completely when many stats and filters coexist', () => {
      const stats = Array.from({ length: 5 }, (_, i) => ({ id: `stat-${i + 1}` }));
      const filters = [
        { sectionKey: 'misc_filters', fieldKey: 'f1', value: 1 },
        { sectionKey: 'misc_filters', fieldKey: 'f2', value: 2 },
        { sectionKey: 'misc_filters', fieldKey: 'f3', value: 3 },
        { sectionKey: 'misc_filters', fieldKey: 'f4', value: 4 },
        { sectionKey: 'misc_filters', fieldKey: 'f5', value: 5 },
      ]; // 5 stats + 5 filters = 10 total
      const data: TradeSearchPreviewData = {
        loading: false,
        meta: {
          suggestedName: 'Shared Budget',
          stats,
          filters,
        },
      };

      const { container, app } = renderPreview(data);
      const statRows = container.querySelectorAll('.preview-stat-row');
      const filterRows = container.querySelectorAll('.preview-filter-row');
      const omittedEl = container.querySelector('.preview-omitted');

      expect(statRows.length).toBe(5);
      expect(filterRows.length).toBe(5);
      expect(omittedEl).toBeNull();
      app.unmount();
    });

    it('renders empty description when there are zero stats and zero filters', () => {
      const data: TradeSearchPreviewData = {
        loading: false,
        meta: {
          suggestedName: 'Clean Item',
          stats: [],
          filters: [],
        },
      };

      const { container, app } = renderPreview(data);
      const emptyEl = container.querySelector('.preview-empty');
      expect(emptyEl).not.toBeNull();
      expect(emptyEl?.textContent).toContain('（無其他詞綴條件限制）');
      expect(container.querySelector('.preview-stats-list')).toBeNull();
      expect(container.querySelector('.preview-filters-list')).toBeNull();
      expect(container.querySelector('.preview-omitted')).toBeNull();
      app.unmount();
    });

    it('renders enabled filters grouped by official filter groups and suppresses empty groups', () => {
      const data: TradeSearchPreviewData = {
        loading: false,
        gameVersion: 'poe1',
        meta: {
          suggestedName: 'Grouped Preview',
          stats: [],
          filters: [
            { sectionKey: 'type_filters', fieldKey: 'category', value: { option: 'armour.chest' } },
            { sectionKey: 'type_filters', fieldKey: 'rarity', value: { option: 'rare' } },
            { sectionKey: 'armour_filters', fieldKey: 'ar', value: { min: 1000 } },
            { sectionKey: 'trade_filters', fieldKey: 'price', value: { min: 10, option: 'chaos' } },
          ],
        },
      };

      const { container, app } = renderPreview(data);
      const groupSections = container.querySelectorAll('.filter-group-section');
      const groupTitles = Array.from(container.querySelectorAll('.filter-group-title')).map((el) =>
        el.textContent?.trim(),
      );

      // Only groups with active filters are displayed
      expect(groupSections.length).toBe(3);
      expect(groupTitles).toEqual(['類別過濾', '護甲篩選', '交易過濾']);

      // Empty groups like req_filters, map_filters, misc_filters are NOT rendered
      expect(groupTitles).not.toContain('物品需求');
      expect(groupTitles).not.toContain('地圖/海圖篩選器');
      expect(groupTitles).not.toContain('其它');

      // Filter rows within group
      const firstGroupRows = groupSections[0].querySelectorAll('.preview-filter-row');
      expect(firstGroupRows.length).toBe(2);
      expect(firstGroupRows[0].textContent).toContain('道具分類');
      expect(firstGroupRows[1].textContent).toContain('物品稀有度');

      app.unmount();
    });

    it('resolves PoE1 vs PoE2 group titles from existing dictionary without hardcoded maps', () => {
      // PoE1
      const poe1Data: TradeSearchPreviewData = {
        loading: false,
        gameVersion: 'poe1',
        meta: {
          suggestedName: 'PoE1 Items',
          stats: [],
          filters: [
            { sectionKey: 'weapon_filters', fieldKey: 'damage', value: { min: 100 } },
            { sectionKey: 'req_filters', fieldKey: 'lvl', value: { min: 16 } },
          ],
        },
      };
      const { container: container1, app: app1 } = renderPreview(poe1Data);
      const titles1 = Array.from(container1.querySelectorAll('.filter-group-title')).map((el) =>
        el.textContent?.trim(),
      );
      expect(titles1).toEqual(['武器篩選', '物品需求']);
      app1.unmount();

      // PoE2
      const poe2Data: TradeSearchPreviewData = {
        loading: false,
        gameVersion: 'poe2',
        meta: {
          suggestedName: 'PoE2 Items',
          stats: [],
          filters: [
            { sectionKey: 'equipment_filters', fieldKey: 'damage', value: { min: 100 } },
            { sectionKey: 'map_filters', fieldKey: 'map_tier', value: { min: 16 } },
          ],
        },
      };
      const { container: container2, app: app2 } = renderPreview(poe2Data);
      const titles2 = Array.from(container2.querySelectorAll('.filter-group-title')).map((el) =>
        el.textContent?.trim(),
      );
      expect(titles2).toEqual(['裝備篩選器', '終局篩選器']);
      app2.unmount();
    });

    it('renders all stats and grouped filters completely without truncation', () => {
      const stats = Array.from({ length: 5 }, (_, i) => ({ id: `stat-${i + 1}`, min: i + 1 }));
      const filters = [
        { sectionKey: 'type_filters', fieldKey: 'category', value: { option: 'armour.chest' } },
        { sectionKey: 'type_filters', fieldKey: 'rarity', value: { option: 'rare' } },
        { sectionKey: 'armour_filters', fieldKey: 'ar', value: { min: 1000 } },
        { sectionKey: 'armour_filters', fieldKey: 'es', value: { min: 200 } },
        { sectionKey: 'trade_filters', fieldKey: 'price', value: { min: 5, option: 'divine' } },
      ]; // 5 stats + 5 filters = 10 total

      const data: TradeSearchPreviewData = {
        loading: false,
        gameVersion: 'poe1',
        meta: {
          suggestedName: 'Budget Grouped',
          stats,
          filters,
        },
      };

      const { container, app } = renderPreview(data);
      const statRows = container.querySelectorAll('.preview-stat-row');
      const filterRows = container.querySelectorAll('.preview-filter-row');
      const groupTitles = container.querySelectorAll('.filter-group-title');
      const omittedEl = container.querySelector('.preview-omitted');

      // Full 5 stats and 5 filter rows rendered
      expect(statRows.length).toBe(5);
      expect(filterRows.length).toBe(5);
      // Group titles for all 3 groups
      expect(groupTitles.length).toBe(3);
      // No omitted notification
      expect(omittedEl).toBeNull();

      app.unmount();
    });

    it('preserves HistoryPane encapsulation with the shared click-toggled preview', () => {
      const historyPanePath = path.resolve(__dirname, '../components/sidebar/HistoryPane.vue');
      const historySource = readFileSync(historyPanePath, 'utf-8');

      expect(historySource).toContain(
        "import TradeSearchPreviewPopover from './search-preview/TradeSearchPreviewPopover.vue'",
      );
      expect(historySource).toMatch(
        /<TradeSearchPreviewPopover[\s\S]*?:preview-data="activePreviewData"/,
      );
    });
  });

  describe('TradeSearchPreviewTooltip boundary anchoring contract', () => {
    it('creates virtual element whose horizontal geometry comes from boundary and vertical geometry comes from trigger', () => {
      const boundaryEl = document.createElement('div');
      const triggerEl = document.createElement('div');

      vi.spyOn(boundaryEl, 'getBoundingClientRect').mockReturnValue({
        left: 100,
        right: 420,
        width: 320,
        top: 50,
        bottom: 850,
        height: 800,
        x: 100,
        y: 50,
        toJSON: () => {},
      });

      vi.spyOn(triggerEl, 'getBoundingClientRect').mockReturnValue({
        left: 120,
        right: 280,
        width: 160,
        top: 340,
        bottom: 370,
        height: 30,
        x: 120,
        y: 340,
        toJSON: () => {},
      });

      const virtualEl = createBoundaryVirtualElement(boundaryEl, triggerEl);
      const rect = virtualEl.getBoundingClientRect();

      // left / right / width comes from boundary
      expect(rect.left).toBe(100);
      expect(rect.right).toBe(420);
      expect(rect.width).toBe(320);
      expect(rect.x).toBe(100);

      // top / bottom / height comes from trigger
      expect(rect.top).toBe(340);
      expect(rect.bottom).toBe(370);
      expect(rect.height).toBe(30);
      expect(rect.y).toBe(340);
    });

    it('isolates trigger Y geometry between distinct rows A and B without cross-contamination', () => {
      const boundaryEl = document.createElement('div');
      const triggerA = document.createElement('div');
      const triggerB = document.createElement('div');

      vi.spyOn(boundaryEl, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        right: 320,
        width: 320,
        top: 0,
        bottom: 600,
        height: 600,
        x: 0,
        y: 0,
        toJSON: () => {},
      });

      vi.spyOn(triggerA, 'getBoundingClientRect').mockReturnValue({
        left: 20,
        right: 200,
        width: 180,
        top: 100,
        bottom: 130,
        height: 30,
        x: 20,
        y: 100,
        toJSON: () => {},
      });

      vi.spyOn(triggerB, 'getBoundingClientRect').mockReturnValue({
        left: 20,
        right: 200,
        width: 180,
        top: 450,
        bottom: 480,
        height: 30,
        x: 20,
        y: 450,
        toJSON: () => {},
      });

      const virtualA = createBoundaryVirtualElement(
        () => boundaryEl,
        () => triggerA,
      );
      const virtualB = createBoundaryVirtualElement(
        () => boundaryEl,
        () => triggerB,
      );

      const rectA = virtualA.getBoundingClientRect();
      const rectB = virtualB.getBoundingClientRect();

      // Both share boundary X
      expect(rectA.left).toBe(0);
      expect(rectA.width).toBe(320);
      expect(rectB.left).toBe(0);
      expect(rectB.width).toBe(320);

      // Each uses distinct trigger Y geometry
      expect(rectA.top).toBe(100);
      expect(rectA.bottom).toBe(130);
      expect(rectB.top).toBe(450);
      expect(rectB.bottom).toBe(480);
    });
  });

  describe('hoisted singleton preview toggle state management', () => {
    const testBm = (id: string): Bookmark => ({
      id,
      searchRecordId: `sr-${id}`,
      name: id,
      url: `https://www.pathofexile.com/trade/search/Standard/${id}`,
      groupId: 'grp-1',
      order: 0,
    });

    beforeEach(() => {
      mockDecodeTradeSearchUrl.mockResolvedValue({
        gameVersion: 'poe1',
        league: 'Standard',
        query: { status: { option: 'online' } },
      });
      mockLoadTradeDictionaries.mockResolvedValue(undefined);
      mockExtractQueryMetadata.mockReturnValue({ suggestedName: 'Test Item' });
    });

    it('opens on the first toggle and closes on a second toggle of the same bookmark', () => {
      const anchor = document.createElement('div');
      const { isPreviewOpen, previewAnchorEl, previewBookmark, toggleBookmarkPreview } =
        useBookmarkPreview();

      toggleBookmarkPreview(testBm('a'), anchor);
      expect(isPreviewOpen.value).toBe(true);
      expect(previewAnchorEl.value).toBe(anchor);
      expect(previewBookmark.value?.id).toBe('a');

      toggleBookmarkPreview(testBm('a'), anchor);
      expect(isPreviewOpen.value).toBe(false);
      expect(previewBookmark.value).toBeNull();
    });

    it('switches to another bookmark instead of closing', () => {
      const anchorA = document.createElement('div');
      const anchorB = document.createElement('div');
      const { isPreviewOpen, previewAnchorEl, previewBookmark, toggleBookmarkPreview } =
        useBookmarkPreview();

      toggleBookmarkPreview(testBm('a'), anchorA);
      toggleBookmarkPreview(testBm('b'), anchorB);
      expect(isPreviewOpen.value).toBe(true);
      expect(previewBookmark.value?.id).toBe('b');
      expect(previewAnchorEl.value).toBe(anchorB);
    });

    it('does not open while dragging and closes when dragging starts', async () => {
      const isDragging = ref(true);
      const { isPreviewOpen, toggleBookmarkPreview } = useBookmarkPreview({ isDragging });
      toggleBookmarkPreview(testBm('a'), document.createElement('div'));
      expect(isPreviewOpen.value).toBe(false);

      isDragging.value = false;
      await nextTick();
      toggleBookmarkPreview(testBm('a'), document.createElement('div'));
      expect(isPreviewOpen.value).toBe(true);
      isDragging.value = true;
      await nextTick();
      expect(isPreviewOpen.value).toBe(false);
    });
  });
});
