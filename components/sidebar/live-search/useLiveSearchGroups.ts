import { computed, ref, type Ref } from 'vue';
import { getFolderAncestors, getFolderDepth } from '@/utils/bookmark-collection';
import { t } from '@/utils/i18n';
import type { LiveSearchSubscriptionStatus } from '@/utils/live-search-contract';
import {
  PREVIOUS_CONNECTIONS_GROUP_ID,
  SESSION_CONNECTIONS_GROUP_ID,
  filterLiveSearchSourceGroups,
  getLiveSearchGroupSubtreeItems,
  matchesLiveSearchSourceStatusFilter,
  type LiveSearchSourceGroup,
  type LiveSearchSourceItem,
  type LiveSearchSourceSnapshot,
  type LiveSearchSourceStatusFilter,
} from '@/entrypoints/content/logic/live-search-bookmark-controller';

export interface LiveSearchGroupStats {
  enabledCount: number;
  totalCount: number;
  errorCount: number;
}

export function getPreviewEntityKey(item: { kind: string; id: string }): string {
  return `${item.kind}:${item.id}`;
}

export function isItemActiveOrError(status?: LiveSearchSubscriptionStatus): boolean {
  return (
    status === 'connecting' ||
    status === 'active' ||
    status === 'reconnecting' ||
    status === 'error'
  );
}

export function isItemStoppedInSession(item: LiveSearchSourceItem): boolean {
  return !item.pending && !isItemActiveOrError(item.status);
}

function isItemEnableable(item: LiveSearchSourceItem): boolean {
  return item.compatibility === 'compatible' && !item.pending && !isItemActiveOrError(item.status);
}

function normalizeGroups(
  rawGroups: readonly LiveSearchSourceGroup[] | undefined,
): LiveSearchSourceGroup[] {
  if (!rawGroups) return [];
  const bookmarkRawGroups = rawGroups.filter((g) => (g.kind ?? 'bookmark') !== 'custom');
  return rawGroups.map((g, index) => {
    const groupKind = g.kind ?? 'bookmark';
    const rawItems = g.items ?? g.bookmarks ?? [];
    const normalizedItems: LiveSearchSourceItem[] = rawItems.map((item) => {
      const status = item.status ?? item.liveSearchStatus;
      const kind = item.kind ?? 'bookmark';
      return {
        ...item,
        kind,
        groupId: item.groupId ?? g.id,
        groupName: item.groupName ?? g.name,
        status,
        liveSearchStatus: status,
        canonicalIdentity: item.canonicalIdentity ?? null,
        canonicalKey: item.canonicalKey ?? null,
        compatibility: item.compatibility,
        compatibilityMessage: item.compatibilityMessage,
        removable: item.removable ?? kind === 'custom',
        coverImageUrl: item.coverImageUrl,
      };
    });
    const resolvedDepth =
      typeof g.depth === 'number'
        ? g.depth
        : groupKind === 'custom'
          ? 0
          : getFolderDepth(bookmarkRawGroups, g.id);
    return {
      ...g,
      kind: groupKind,
      order: typeof g.order === 'number' ? g.order : index,
      depth: resolvedDepth,
      items: normalizedItems,
      bookmarks: normalizedItems,
    };
  });
}

export function useLiveSearchGroups(
  sourceSnapshot: Ref<Readonly<LiveSearchSourceSnapshot> | null>,
) {
  const searchQuery = ref('');
  const statusFilter = ref<LiveSearchSourceStatusFilter>('all');
  const collapsedGroupIds = ref<Set<string>>(new Set());

  const isFilteredBatchBarVisible = computed(() => {
    return Boolean(searchQuery.value.trim()) || statusFilter.value !== 'all';
  });

  function handleStatusFilterChange(val: unknown) {
    if (typeof val === 'string' && val.trim()) {
      statusFilter.value = val as LiveSearchSourceStatusFilter;
    }
  }

  function clearSearch() {
    searchQuery.value = '';
  }

  const rawConsoleGroups = computed<readonly LiveSearchSourceGroup[] | undefined>(() => {
    const snap = sourceSnapshot.value;
    if (!snap) return undefined;
    if (Array.isArray(snap.sessionConnections) || Array.isArray(snap.previousConnections)) {
      const result: LiveSearchSourceGroup[] = [];
      const sessionItems = snap.sessionConnections ?? [];
      const previousItems = snap.previousConnections ?? [];
      if (sessionItems.length > 0) {
        result.push({
          id: SESSION_CONNECTIONS_GROUP_ID,
          name: t('liveSearch.primary.sessionGroupName'),
          kind: 'custom',
          order: 0,
          depth: 0,
          items: sessionItems,
          bookmarks: sessionItems,
        });
      }
      if (previousItems.length > 0) {
        result.push({
          id: PREVIOUS_CONNECTIONS_GROUP_ID,
          name: t('liveSearch.primary.previousGroupName'),
          kind: 'custom',
          order: 1,
          depth: 0,
          items: previousItems,
          bookmarks: previousItems,
        });
      }
      return result;
    }
    return snap.groups;
  });

  const normalizedGroups = computed(() => normalizeGroups(rawConsoleGroups.value));

  const groupStatsMap = computed(() => {
    const map = new Map<string, LiveSearchGroupStats>();
    for (const group of normalizedGroups.value) {
      const subtreeItems = getLiveSearchGroupSubtreeItems(normalizedGroups.value, group.id);
      let enabledCount = 0;
      let errorCount = 0;
      for (const item of subtreeItems) {
        if (matchesLiveSearchSourceStatusFilter(item.status, 'enabled')) {
          enabledCount += 1;
        } else if (item.status === 'error') {
          errorCount += 1;
        }
      }
      map.set(group.id, {
        enabledCount,
        totalCount: subtreeItems.length,
        errorCount,
      });
    }
    return map;
  });

  function getGroupStats(groupId: string): LiveSearchGroupStats {
    return (
      groupStatsMap.value.get(groupId) ?? {
        enabledCount: 0,
        totalCount: 0,
        errorCount: 0,
      }
    );
  }

  function isGroupCollapsed(groupId: string): boolean {
    if (isFilteredBatchBarVisible.value) return false;
    return collapsedGroupIds.value.has(groupId);
  }

  function toggleGroupCollapse(groupId: string) {
    const next = new Set(collapsedGroupIds.value);
    if (next.has(groupId)) {
      next.delete(groupId);
    } else {
      next.add(groupId);
    }
    collapsedGroupIds.value = next;
  }

  const hasAnySources = computed(() => {
    return normalizedGroups.value.some((g) => g.items.length > 0);
  });

  const filteredGroups = computed(() => {
    return filterLiveSearchSourceGroups(normalizedGroups.value, {
      query: searchQuery.value,
      statusFilter: statusFilter.value,
    });
  });

  const visibleGroups = computed<LiveSearchSourceGroup[]>(() => {
    if (isFilteredBatchBarVisible.value || collapsedGroupIds.value.size === 0) {
      return filteredGroups.value;
    }
    const bookmarkGroups = filteredGroups.value.filter((g) => (g.kind ?? 'bookmark') !== 'custom');
    return filteredGroups.value.filter((group) => {
      if (group.kind === 'custom') return true;
      const ancestors = getFolderAncestors(bookmarkGroups, group.id);
      return !ancestors.some((ancestor) => collapsedGroupIds.value.has(ancestor.id));
    });
  });

  const filteredSourceIds = computed<string[]>(() => {
    const ids: string[] = [];
    for (const group of filteredGroups.value) {
      for (const item of group.items) {
        ids.push(item.id);
      }
    }
    return ids;
  });

  function hasEnableableSourcesInGroup(groupId: string): boolean {
    const subtreeItems = getLiveSearchGroupSubtreeItems(normalizedGroups.value, groupId);
    return subtreeItems.some(isItemEnableable);
  }

  function hasStoppedSourcesInGroup(groupId: string): boolean {
    const subtreeItems = getLiveSearchGroupSubtreeItems(normalizedGroups.value, groupId);
    return subtreeItems.some(isItemStoppedInSession);
  }

  return {
    searchQuery,
    statusFilter,
    collapsedGroupIds,
    isFilteredBatchBarVisible,
    handleStatusFilterChange,
    clearSearch,
    normalizedGroups,
    getGroupStats,
    isGroupCollapsed,
    toggleGroupCollapse,
    hasAnySources,
    filteredGroups,
    visibleGroups,
    filteredSourceIds,
    hasEnableableSourcesInGroup,
    hasStoppedSourcesInGroup,
  };
}
