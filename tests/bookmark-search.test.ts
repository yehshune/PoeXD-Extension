// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { createBookmarkWorkspace } from '@/components/sidebar/bookmark-workspace';
import { createFakeBookmarkWorkspaceHost } from '@/components/sidebar/bookmark-workspace/fake-host';
import { DEFAULT_SEARCH_DEBOUNCE_MS } from '@/components/sidebar/composables/useDebouncedSearch';
import type { Bookmark, BookmarkGroup } from '@/components/sidebar/bookmark-types';
import { createFakeBookmarkModel } from './helpers/fake-bookmark-model';

describe('Bookmark Workspace — search', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const flushDebounce = async () => {
    await nextTick();
    vi.advanceTimersByTime(DEFAULT_SEARCH_DEBOUNCE_MS);
    await nextTick();
  };

  const dummyGroups: BookmarkGroup[] = [
    { id: 'group-1', name: '通貨 Currency', order: 0 },
    { id: 'group-2', name: '裝備 Gear', order: 1 },
    { id: 'group-3', name: '地圖 Maps', order: 2 },
  ];

  const dummyBookmarks: Bookmark[] = [
    {
      id: 'bm-1',
      name: '崇高石 Exalted Orb',
      url: 'https://www.pathofexile.com/trade/search/Standard/exalt',
      groupId: 'group-1',
      searchRecordId: 'exalt',
      order: 0,
    },
    {
      id: 'bm-2',
      name: '神聖石 Divine Orb',
      url: 'https://www.pathofexile.com/trade/search/Standard/divine',
      groupId: 'group-1',
      searchRecordId: 'divine',
      order: 1,
    },
    {
      id: 'bm-3',
      name: '獵首 Headhunter',
      url: 'https://www.pathofexile.com/trade/search/Standard/hh-belt',
      groupId: 'group-2',
      searchRecordId: 'hh',
      order: 2,
    },
  ];

  const setup = (groups: BookmarkGroup[] = dummyGroups, bookmarks: Bookmark[] = dummyBookmarks) =>
    createBookmarkWorkspace(createFakeBookmarkWorkspaceHost(), {
      version: 'poe1',
      model: createFakeBookmarkModel({ groups, bookmarks }),
    });

  it('has correct initial state', () => {
    const workspace = setup();

    expect(workspace.tree.search.query.value).toBe('');
    expect(workspace.tree.search.isVisible.value).toBe(false);
    expect(workspace.tree.filteredGroups.value).toEqual(dummyGroups);
    expect(workspace.tree.getFilteredGroupBookmarks('group-1')).toEqual([
      dummyBookmarks[0],
      dummyBookmarks[1],
    ]);
  });

  it('filters by folder name (case-insensitive)', async () => {
    const workspace = setup();

    workspace.tree.search.query.value = 'currency';
    await flushDebounce();
    expect(workspace.tree.filteredGroups.value.map((g) => g.id)).toEqual(['group-1']);

    workspace.tree.search.query.value = 'GEAR';
    await flushDebounce();
    expect(workspace.tree.filteredGroups.value.map((g) => g.id)).toEqual(['group-2']);
  });

  it('filters by bookmark name (case-insensitive)', async () => {
    const workspace = setup();

    workspace.tree.search.query.value = 'exalted';
    await flushDebounce();
    expect(workspace.tree.filteredGroups.value.map((g) => g.id)).toEqual(['group-1']);
    expect(workspace.tree.getFilteredGroupBookmarks('group-1').map((b) => b.id)).toEqual(['bm-1']);
  });

  it('filters by bookmark URL', async () => {
    const workspace = setup();

    workspace.tree.search.query.value = 'hh-belt';
    await flushDebounce();
    expect(workspace.tree.filteredGroups.value.map((g) => g.id)).toEqual(['group-2']);
    expect(workspace.tree.getFilteredGroupBookmarks('group-2').map((b) => b.id)).toEqual(['bm-3']);
  });

  it('clears search properly via close', () => {
    const workspace = setup();

    workspace.tree.search.open();
    workspace.tree.search.query.value = 'divine';
    expect(workspace.tree.search.isVisible.value).toBe(true);

    workspace.tree.search.close();
    expect(workspace.tree.search.isVisible.value).toBe(false);
    expect(workspace.tree.search.query.value).toBe('');
    expect(workspace.tree.filteredGroups.value).toEqual(dummyGroups);
  });

  it('toggles search visibility and resets search query upon toggle close', () => {
    const workspace = setup();

    workspace.tree.search.toggle();
    expect(workspace.tree.search.isVisible.value).toBe(true);

    workspace.tree.search.query.value = 'test';
    workspace.tree.search.toggle();
    expect(workspace.tree.search.isVisible.value).toBe(false);
    expect(workspace.tree.search.query.value).toBe('');
  });

  it('closes visible search on Escape keydown', () => {
    const workspace = setup();

    workspace.tree.search.open();
    workspace.tree.search.query.value = 'some query';

    workspace.tree.search.handleKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(workspace.tree.search.isVisible.value).toBe(false);
    expect(workspace.tree.search.query.value).toBe('');

    // When already closed, Escape has no negative effect
    workspace.tree.search.handleKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(workspace.tree.search.isVisible.value).toBe(false);
  });

  it('11. preserves complete ancestor path when a deeply nested bookmark matches', async () => {
    // 裝備 (root) -> 武器 (child) -> 弓 (grandchild) -> 神弓 (bookmark)
    // 消耗品 (unrelated root) -> 藥劑 (child)
    const hierarchyGroups: BookmarkGroup[] = [
      { id: 'g-equip', name: '裝備', order: 0 },
      { id: 'g-weapon', name: '武器', order: 0, parentId: 'g-equip' },
      { id: 'g-bow', name: '弓', order: 0, parentId: 'g-weapon' },
      { id: 'g-other', name: '消耗品', order: 1 },
      { id: 'g-potion', name: '藥劑', order: 0, parentId: 'g-other' },
    ];
    const hierarchyBookmarks: Bookmark[] = [
      {
        id: 'bm-bow',
        name: '神弓 Windripper',
        url: 'https://pathofexile.com/trade/search/Standard/bow1',
        groupId: 'g-bow',
        searchRecordId: 's1',
        order: 0,
      },
      {
        id: 'bm-armor',
        name: '胸甲 Kaom',
        url: 'https://pathofexile.com/trade/search/Standard/armor1',
        groupId: 'g-equip',
        searchRecordId: 's2',
        order: 0,
      },
      {
        id: 'bm-potion',
        name: '生命藥劑',
        url: 'https://pathofexile.com/trade/search/Standard/pot1',
        groupId: 'g-potion',
        searchRecordId: 's3',
        order: 0,
      },
    ];

    const workspace = setup(hierarchyGroups, hierarchyBookmarks);

    workspace.tree.search.query.value = '神弓';
    await flushDebounce();

    // Filtered groups must include g-bow and all its ancestors: g-weapon, g-equip
    const resultGroupIds = workspace.tree.filteredGroups.value.map((g) => g.id);
    expect(resultGroupIds).toContain('g-equip');
    expect(resultGroupIds).toContain('g-weapon');
    expect(resultGroupIds).toContain('g-bow');
    // Unrelated branches are NOT included
    expect(resultGroupIds).not.toContain('g-other');
    expect(resultGroupIds).not.toContain('g-potion');

    // Only matching bookmark is returned for g-bow
    expect(workspace.tree.getFilteredGroupBookmarks('g-bow').map((b) => b.id)).toEqual(['bm-bow']);
    // g-equip has a bookmark '胸甲 Kaom', but it is not matching so it should NOT be returned
    expect(workspace.tree.getFilteredGroupBookmarks('g-equip')).toEqual([]);
  });

  it('12. preserves matching folder and necessary ancestors without including unrelated subtrees', async () => {
    // 裝備 (root) -> 武器 (child) -> 弓 (grandchild, no match)
    // 裝備 (root) -> 防具 (child, no match)
    const hierarchyGroups: BookmarkGroup[] = [
      { id: 'g-equip', name: '裝備', order: 0 },
      { id: 'g-weapon', name: '武器', order: 0, parentId: 'g-equip' },
      { id: 'g-bow', name: '弓', order: 0, parentId: 'g-weapon' },
      { id: 'g-armor', name: '防具', order: 1, parentId: 'g-equip' },
    ];
    const hierarchyBookmarks: Bookmark[] = [
      {
        id: 'bm-bow',
        name: '普通弓',
        url: 'https://pathofexile.com/trade/search/Standard/bow1',
        groupId: 'g-bow',
        searchRecordId: 's1',
        order: 0,
      },
    ];

    const workspace = setup(hierarchyGroups, hierarchyBookmarks);

    // Search matches folder '武器'
    workspace.tree.search.query.value = '武器';
    await flushDebounce();

    const resultGroupIds = workspace.tree.filteredGroups.value.map((g) => g.id);
    // Must include matching folder '武器' and ancestor '裝備'
    expect(resultGroupIds).toEqual(['g-equip', 'g-weapon']);
    // Must NOT include non-matching descendant '弓' or non-matching sibling '防具'
    expect(resultGroupIds).not.toContain('g-bow');
    expect(resultGroupIds).not.toContain('g-armor');
  });
});
