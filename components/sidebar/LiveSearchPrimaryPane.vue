<template>
  <div
    ref="paneRootRef"
    data-sidebar-pane="live-search-primary"
    class="livesearch-primary-pane flex flex-col h-full min-h-0 select-none overflow-hidden"
  >
    <!-- 若 controller 未提供，顯示安全不可用狀態 -->
    <div
      v-if="!controller"
      data-test="controller-unavailable"
      class="flex flex-col items-center justify-center p-[var(--pxd-space-lg)] m-[var(--pxd-pane-padding)] rounded-md border border-dashed border-border bg-card/50 text-center gap-[var(--pxd-space-sm)] my-auto"
    >
      <Radio class="size-[var(--control-icon-lg,20px)] text-muted-foreground/40" />
      <span class="text-[length:var(--pxd-font-body)] font-medium text-muted-foreground">
        {{ t('liveSearch.primary.notInitialized') }}
      </span>
      <span
        class="text-[length:var(--pxd-font-caption)] text-muted-foreground max-w-[240px] leading-relaxed"
      >
        {{ t('liveSearch.primary.notInitializedHint') }}
      </span>
    </div>

    <template v-else>
      <!-- 固定區：Compact Status Header / Rate Details / Search & Filter Toolbar -->
      <div
        data-test="primary-fixed-area"
        class="shrink-0 flex flex-col gap-[var(--pxd-space-sm)] p-[var(--pxd-pane-padding)] pb-[var(--pxd-space-sm)]"
      >
        <LiveSearchStatusHeader
          :current-selected-league="currentSelectedLeague"
          :available-leagues="availableLeagues"
          :is-switching-league="isSwitchingLeague"
          :is-batch-running="isBatchRunning"
          :active-subscription-count="activeSubscriptionCount"
          :error-subscription-count="errorSubscriptionCount"
          :is-sound-blocked="isSoundBlocked"
          :is-sound-enabled="liveSearchSoundEnabled"
          :can-toggle-sound="Boolean(soundNotifier)"
          :displayed-result-count="displayedResultCount"
          :can-clear-results="typeof controller?.clearResults === 'function'"
          :rate-limit="snapshot?.rateLimit"
          @switch-league="handleSwitchLeague"
          @enable-sound="handleEnableSound"
          @toggle-sound="handleToggleSoundEnabled"
          @clear-results="handleClearResults"
        />

        <!-- 速率限制略過項目區（依搜尋彙總計數；推播 token 只有數秒效期，僅供知悉與清除） -->
        <LiveSearchDroppedPanel
          v-if="droppedGroups.length > 0"
          :groups="droppedGroups"
          :resolve-source-name="resolveDroppedSourceName"
          @dismiss-group="handleDismissDroppedGroup"
          @clear-all="handleClearDroppedGroups"
        />

        <!-- 搜尋與狀態篩選固定主要工具列 -->
        <div data-test="search-connections-toolbar" class="flex flex-col gap-[var(--pxd-space-sm)]">
          <div class="flex items-center gap-[var(--pxd-space-xs)]">
            <div class="relative flex-1 min-w-0 flex items-center">
              <Search
                class="pointer-events-none absolute left-2.5 size-[var(--control-icon-sm,14px)] text-muted-foreground"
              />
              <Input
                v-model="searchQuery"
                type="text"
                size="sm"
                data-test="search-connections-input"
                :placeholder="t('liveSearch.primary.searchPlaceholder')"
                class="w-full pl-8 pr-7 text-[length:var(--pxd-font-caption)]"
                @keydown.esc.stop.prevent="clearSearch"
              />
              <Button
                v-if="searchQuery"
                type="button"
                variant="ghost"
                size="icon-sm"
                data-test="btn-clear-search"
                class="absolute right-1"
                :title="t('common.clearSearch')"
                @click="clearSearch"
              >
                <X />
              </Button>
            </div>
          </div>

          <ToggleGroup
            type="single"
            :model-value="statusFilter"
            variant="outline"
            size="sm"
            data-test="connection-status-filter-bar"
            class="w-full grid grid-cols-4 gap-0"
            @update:model-value="handleStatusFilterChange"
          >
            <ToggleGroupItem
              v-for="opt in statusFilterOptions"
              :key="opt.value"
              :value="opt.value"
              :data-test="`filter-status-${opt.value}`"
              class="text-[length:var(--pxd-font-caption)] px-1 w-full justify-center gap-1"
              :class="opt.value === 'error' && opt.count > 0 ? 'text-destructive' : ''"
            >
              <span>{{ opt.label }}</span>
              <span
                v-if="opt.count > 0"
                class="text-[length:var(--pxd-font-caption)] opacity-70 tabular-nums"
              >
                {{ opt.count }}
              </span>
            </ToggleGroupItem>
          </ToggleGroup>

          <!-- 結果區依連線篩選提示 -->
          <div
            v-if="resultFilterKey"
            data-test="result-filter-banner"
            class="flex items-center justify-between gap-[var(--pxd-space-xs)] px-[var(--pxd-space-sm)] py-0.5 rounded-sm border border-primary/40 bg-primary/10 text-[length:var(--pxd-font-caption)]"
          >
            <span class="truncate min-w-0 text-foreground">
              {{ t('liveSearch.resultFilter.banner', { name: resultFilterName }) }}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              data-test="btn-clear-result-filter"
              :title="t('liveSearch.resultFilter.clear')"
              :aria-label="t('liveSearch.resultFilter.clear')"
              @click="clearResultFilter"
            >
              <X />
            </Button>
          </div>

          <!-- 開發模式：注入假結果測試官方展示區（不建立連線、不 fetch） -->
          <div
            v-if="isDevBuild && controller?.injectDevResults"
            data-test="dev-inject-bar"
            class="flex items-center gap-[var(--pxd-space-xs)] text-[length:var(--pxd-font-caption)]"
          >
            <span class="font-mono text-muted-foreground shrink-0">DEV</span>
            <Button
              v-for="count in DEV_INJECT_COUNTS"
              :key="count"
              type="button"
              variant="outline"
              size="sm"
              :data-test="`btn-dev-inject-${count}`"
              class="text-[length:var(--pxd-font-caption)] px-2"
              :disabled="isDevInjecting"
              @click="handleDevInject(count)"
            >
              +{{ count }}
            </Button>
            <span
              data-test="dev-inject-status"
              class="truncate min-w-0 font-mono text-muted-foreground"
            >
              {{ devInjectStatus }}
            </span>
          </div>

          <!-- 目前篩選結果統計與批次操作列 (僅在有搜尋關鍵字或狀態篩選非全部時顯示) -->
          <div
            v-if="isFilteredBatchBarVisible"
            data-test="filtered-batch-bar"
            class="flex items-center justify-between gap-[var(--pxd-space-xs)] pt-0.5 text-[length:var(--pxd-font-caption)]"
          >
            <span data-test="filtered-match-count" class="text-muted-foreground font-mono">
              {{ t('liveSearch.primary.filterMatched', { count: filteredSourceIds.length }) }}
            </span>

            <DropdownMenu :open="isFilteredBatchMenuOpen" @update:open="setFilteredBatchMenuOpen">
              <DropdownMenuTrigger as-child>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  data-test="btn-filtered-batch-menu"
                  class="text-[length:var(--pxd-font-caption)] gap-1 px-2"
                  :disabled="filteredSourceIds.length === 0 || isBatchRunning"
                  @pointerdown.capture="handleFilteredTriggerPointerDown"
                  @click.capture="handleMenuTriggerClickCapture"
                  @click.stop="handleFilteredTriggerClick"
                >
                  <span>{{ t('liveSearch.primary.batchAction') }}</span>
                  <ChevronDown class="size-[var(--control-icon-sm,14px)] text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>

              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  data-test="btn-batch-enable-filtered"
                  :disabled="filteredSourceIds.length === 0 || isBatchRunning"
                  @click="handleBatchEnableFiltered"
                >
                  {{ t('liveSearch.primary.enableFiltered') }}
                </DropdownMenuItem>
                <DropdownMenuItem
                  data-test="btn-batch-stop-filtered"
                  :disabled="filteredSourceIds.length === 0 || isBatchRunning"
                  @click="handleBatchStopFiltered"
                >
                  {{ t('liveSearch.primary.stopFiltered') }}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <Separator class="mt-[var(--pxd-space-xs)]" />
      </div>

      <!-- flex-1：單一搜尋連線 list (採用 ScrollArea Foundation) -->
      <TooltipProvider :delay-duration="200">
        <ScrollAreaRoot class="flex-1 box-border h-full min-h-0 relative overflow-hidden">
          <ScrollAreaViewport
            data-test="search-connections-list"
            class="flex flex-col gap-[var(--pxd-bookmark-tree-gap)] box-border h-full w-full min-h-0 px-[var(--pxd-pane-padding)] pb-[var(--pxd-pane-scroll-end-space)] pt-[var(--pxd-space-xs)]"
          >
            <!-- Persistent source loading failure -->
            <div
              v-if="sourceSnapshot?.error"
              data-test="connections-source-error"
              class="flex flex-col items-center justify-center p-[var(--pxd-space-lg)] rounded-md border border-destructive/40 bg-destructive/10 text-center text-destructive gap-[var(--pxd-space-xs)]"
            >
              <span class="font-medium text-[length:var(--pxd-font-caption)]">
                {{ t('liveSearch.primary.loadConnectionsFailed') }}
              </span>
              <span class="text-[length:var(--pxd-font-caption)] opacity-90">{{
                sourceSnapshot.error
              }}</span>
            </div>

            <div
              v-else-if="sourceSnapshot?.loading && !hasAnySources"
              data-test="connections-loading"
              class="text-[length:var(--pxd-font-caption)] text-muted-foreground p-[var(--pxd-space-lg)] text-center"
            >
              {{ t('liveSearch.primary.loadingConnections') }}
            </div>

            <SidebarFilterEmptyState
              v-else-if="filteredGroups.length === 0 && hasAnySources"
              data-test="connections-empty"
              :message="t('liveSearch.primary.noMatchingConnections')"
              :active-filters="activeConnectionFilterLabels"
              class="rounded-md border border-dashed border-border"
              @reset="resetConnectionFilters"
            />

            <SidebarEmptyState
              v-else-if="filteredGroups.length === 0"
              data-test="connections-empty"
              :message="t('liveSearch.primary.noAvailableConnections')"
              :hint="t('liveSearch.primary.emptyGuide')"
              class="rounded-md border border-dashed border-border"
            >
              <template #icon><Radio /></template>
              <template #actions>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  data-test="btn-empty-add-connection"
                  class="text-[length:var(--pxd-font-caption)]"
                  @click="handleOpenAddConnection"
                >
                  <Plus />
                  <span>{{ t('liveSearch.console.addConnectionTitle') }}</span>
                </Button>
              </template>
            </SidebarEmptyState>

            <template v-else>
              <LiveSearchGroupSection
                v-for="group in visibleGroups"
                :key="group.id"
                :group="group"
                :stats="getGroupStats(group.id)"
                :is-collapsed="isGroupCollapsed(group.id)"
                :has-enableable-sources="hasEnableableSourcesInGroup(group.id)"
                :has-stopped-sources="hasStoppedSourcesInGroup(group.id)"
                :is-batch-running="isBatchRunning"
                :is-group-menu-open="activeGroupMenuId === group.id"
                :active-item-menu-id="activeItemMenuId"
                :tooltip-side="tooltipSide"
                :boundary-anchor="paneRootRef"
                :active-entity-key="activeEntityKey"
                :active-preview-data="activePreviewData"
                :is-item-result-filterable="isResultFilterable"
                :is-item-result-filter-target="isResultFilterTarget"
                :get-item-result-count="getItemResultCount"
                @toggle-collapse="toggleGroupCollapse"
                @open-add-connection="handleOpenAddConnection"
                @batch-enable-group="handleBatchEnableGroup"
                @batch-stop-group="handleBatchStopGroup"
                @clear-previous-connections="handleClearPreviousConnections"
                @clear-stopped-session-connections="handleClearStoppedSessionConnections"
                @group-menu-open-change="setGroupMenuOpen"
                @group-menu-trigger-pointerdown="handleGroupTriggerPointerDown"
                @group-menu-trigger-click="handleGroupTriggerClick"
                @menu-trigger-click-capture="handleMenuTriggerClickCapture"
                @connection-dragstart="handleConnectionDragStart"
                @connection-dragend="handleConnectionDragEnd"
                @preview-open-change="handlePreviewOpenChange"
                @toggle-result-filter="handleToggleResultFilter"
                @enable-source="handleEnableSource"
                @stop-source="handleStopSource"
                @retry-source="handleRetrySource"
                @open-source-new-tab="handleOpenSourceNewTab"
                @toggle-mute-source="handleToggleMuteSource"
                @remove-source="handleRemoveSource"
                @item-menu-open-change="setItemMenuOpen"
                @item-menu-trigger-pointerdown="handleItemTriggerPointerDown"
                @item-menu-trigger-click="handleItemTriggerClick"
              />
            </template>
          </ScrollAreaViewport>
          <ScrollBar />
          <ScrollAreaCorner />
        </ScrollAreaRoot>
      </TooltipProvider>

      <!-- 拖曳刪除垃圾桶區 -->
      <DragTrashZone
        :ref="setTrashZoneRef"
        data-test="live-search-drag-trash"
        :visible="isDragging"
        :over-trash="isOverTrash"
        :sidebar-position="sidebarPosition"
        :style="trashStyle"
        @drop.prevent="handleTrashDrop"
      >
        <div
          class="text-center text-[length:var(--pxd-font-secondary)] font-bold leading-snug select-none"
        >
          {{ t('liveSearch.primary.releaseToRemove') }}
        </div>
      </DragTrashZone>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, type PropType } from 'vue';
import { ChevronDown, Plus, Radio, Search, X } from '@lucide/vue';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  ScrollAreaCorner,
  ScrollAreaRoot,
  ScrollAreaViewport,
  ScrollBar,
} from '@/components/ui/scroll-area';
import DragTrashZone from './layout/DragTrashZone.vue';
import SidebarEmptyState from './layout/SidebarEmptyState.vue';
import SidebarFilterEmptyState from './layout/SidebarFilterEmptyState.vue';
import LiveSearchStatusHeader from './live-search/LiveSearchStatusHeader.vue';
import LiveSearchDroppedPanel from './live-search/LiveSearchDroppedPanel.vue';
import LiveSearchGroupSection from './live-search/LiveSearchGroupSection.vue';
import { useLiveSearchMenuState } from './live-search/useLiveSearchMenuState';
import {
  getPreviewEntityKey,
  isItemStoppedInSession,
  useLiveSearchGroups,
} from './live-search/useLiveSearchGroups';
import { resolveBatchEnableToast, resolveBatchStopToast } from './live-search-presentation';
import { useDragTrash } from './composables/useDragTrash';
import { useTradeSearchPreview } from './composables/useTradeSearchPreview';
import { dispatchPoeEvent } from '@/utils/event-contracts';
import {
  DEFAULT_PREFERENCES,
  getPreferences,
  type Preferences,
  type PreferencesModule,
} from '@/utils/preferences';
import { getPoeVersion } from '@/utils/trade-context';
import { parseTradeSearchUrl, stripLiveSuffix } from '@/utils/trade-search-identity';
import { t } from '@/utils/i18n';
import type {
  LiveSearchPrimaryController,
  LiveSearchPrimaryViewSnapshot,
} from '@/utils/live-search-contract';
import {
  PREVIOUS_CONNECTIONS_GROUP_ID,
  SESSION_CONNECTIONS_GROUP_ID,
  countLiveSearchSourceStatuses,
  createLiveSearchSourceController,
  formatLiveSearchDisplayLeague,
  getLiveSearchGroupSubtreeItems,
  getLiveSearchGroupSubtreeSourceIds,
  type LiveSearchBatchOutcome,
  type LiveSearchSourceController,
  type LiveSearchSourceGroup,
  type LiveSearchSourceItem,
  type LiveSearchSourceSnapshot,
  type LiveSearchSourceStatusFilter,
} from '@/entrypoints/content/logic/live-search-sources';
import type {
  LiveSearchResumeController,
  LiveSearchResumeSnapshot,
} from '@/entrypoints/content/logic/live-search-resume-controller';
import type { LiveSearchSoundNotifier } from '@/entrypoints/content/logic/live-search-sound-notifier';

const props = defineProps({
  controller: {
    type: Object as PropType<LiveSearchPrimaryController | null>,
    default: null,
  },
  sourceController: {
    type: Object as PropType<LiveSearchSourceController | null>,
    default: null,
  },
  resumeController: {
    type: Object as PropType<LiveSearchResumeController | null>,
    default: null,
  },
  preferences: {
    type: Object as PropType<PreferencesModule | null>,
    default: null,
  },
  soundNotifier: {
    type: Object as PropType<LiveSearchSoundNotifier | null>,
    default: null,
  },
});

const emit = defineEmits<{
  (e: 'open-add-connection'): void;
}>();

function handleOpenAddConnection() {
  emit('open-add-connection');
}

const statusCounts = computed(() => countLiveSearchSourceStatuses(normalizedGroups.value));

const statusFilterOptions = computed<
  ReadonlyArray<{
    value: LiveSearchSourceStatusFilter;
    label: string;
    count: number;
  }>
>(() => [
  { value: 'all', label: t('liveSearch.primary.filterAll'), count: statusCounts.value.all },
  {
    value: 'enabled',
    label: t('liveSearch.primary.filterEnabled'),
    count: statusCounts.value.enabled,
  },
  {
    value: 'disabled',
    label: t('liveSearch.primary.filterDisabled'),
    count: statusCounts.value.disabled,
  },
  { value: 'error', label: t('liveSearch.primary.filterError'), count: statusCounts.value.error },
]);

const paneRootRef = ref<HTMLElement | null>(null);
const snapshot = ref<Readonly<LiveSearchPrimaryViewSnapshot> | null>(null);
const sourceSnapshot = ref<Readonly<LiveSearchSourceSnapshot> | null>(null);

const sidebarPosition = ref<'left' | 'right'>(DEFAULT_PREFERENCES.sidebarPosition ?? 'right');
const liveSearchSoundEnabled = ref<boolean>(DEFAULT_PREFERENCES.liveSearchSoundEnabled);
let activePreferencesModule: PreferencesModule | null = null;
const tooltipSide = computed<'left' | 'right'>(() => {
  return sidebarPosition.value === 'left' ? 'right' : 'left';
});

const { activeEntityKey, activePreviewData, loadPreview, clearActivePreview } =
  useTradeSearchPreview({
    version: computed(() => getPoeVersion()),
  });

const activePreviewUrl = ref<string | null>(null);

function clearScopedActivePreview(entityKey?: string) {
  if (!entityKey || activeEntityKey.value === entityKey) {
    activePreviewUrl.value = null;
  }
  clearActivePreview(entityKey);
}

function handlePreviewOpenChange(item: LiveSearchSourceItem, open: boolean) {
  const entityKey = getPreviewEntityKey(item);
  if (open) {
    if (item.compatibility === 'invalid-url') {
      clearScopedActivePreview(entityKey);
      return;
    }
    activePreviewUrl.value = item.url;
    loadPreview(entityKey, item.url);
  } else {
    clearScopedActivePreview(entityKey);
  }
}

watch(activeEntityKey, (key) => {
  if (!key) {
    activePreviewUrl.value = null;
  }
});

const isBatchRunning = ref(false);

const {
  isFilteredBatchMenuOpen,
  activeGroupMenuId,
  activeItemMenuId,
  closeAllMenus,
  handleMenuTriggerClickCapture,
  setFilteredBatchMenuOpen,
  handleFilteredTriggerPointerDown,
  handleFilteredTriggerClick,
  setGroupMenuOpen,
  handleGroupTriggerPointerDown,
  handleGroupTriggerClick,
  setItemMenuOpen,
  handleItemTriggerPointerDown,
  handleItemTriggerClick,
} = useLiveSearchMenuState();

const {
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
} = useLiveSearchGroups(sourceSnapshot);

const activeConnectionFilterLabels = computed(() => {
  const labels: string[] = [];
  if (statusFilter.value !== 'all') {
    const statusLabel = statusFilterOptions.value.find(
      (opt) => opt.value === statusFilter.value,
    )?.label;
    if (statusLabel) {
      labels.push(t('common.filterTag.status', { status: statusLabel }));
    }
  }
  const trimmed = searchQuery.value.trim();
  if (trimmed) {
    labels.push(t('common.filterTag.keyword', { query: trimmed }));
  }
  return labels;
});

function resetConnectionFilters() {
  clearSearch();
  handleStatusFilterChange('all');
}

const currentSelectedLeague = computed(() => {
  return sourceSnapshot.value?.selectedLeague || snapshot.value?.runtimeLeague || 'Standard';
});

const availableLeagues = computed(() => {
  return sourceSnapshot.value?.availableLeagues ?? [currentSelectedLeague.value];
});

const isSwitchingLeague = computed(() => {
  return Boolean(sourceSnapshot.value?.isSwitchingLeague);
});

async function handleSwitchLeague(league: string) {
  const sourceCtrl = getActiveSourceController();
  if (!sourceCtrl || isSwitchingLeague.value) return;
  if (league.toLowerCase() === currentSelectedLeague.value.toLowerCase()) return;
  const activeCount = activeSubscriptionCount.value;
  if (activeCount > 0) {
    const confirm = (
      window as { poexdConfirm?: (message: string, title?: string) => Promise<boolean> }
    ).poexdConfirm;
    if (confirm) {
      const confirmed = await confirm(
        t('liveSearch.primary.switchLeagueConfirm', {
          league: formatLiveSearchDisplayLeague(league),
          count: activeCount,
        }),
        t('liveSearch.primary.switchLeagueConfirmTitle'),
      );
      if (!confirmed) return;
      if (isSwitchingLeague.value) return;
    }
  }
  try {
    const success = await sourceCtrl.switchLeague(league);
    if (!success) {
      showToast(t('liveSearch.toast.switchLeagueFailed'), 'error');
    }
  } catch (err) {
    showToast(
      err instanceof Error ? err.message : t('liveSearch.toast.switchLeagueFailed'),
      'error',
    );
  }
}

let unsubscribe: (() => void) | null = null;
let unsubSource: (() => void) | null = null;
let stopPreferences: (() => void) | null = null;
let fallbackSourceController: LiveSearchSourceController | null = null;
let stopResumeSub: (() => void) | null = null;
const resumeSnapshot = ref<LiveSearchResumeSnapshot | null>(null);
let lastHandledAutoOutcome: LiveSearchBatchOutcome | null = null;

function bindResumeController(ctrl: LiveSearchResumeController | null | undefined) {
  stopResumeSub?.();
  stopResumeSub = null;
  lastHandledAutoOutcome = null;
  if (ctrl) {
    resumeSnapshot.value = ctrl.read();
    stopResumeSub = ctrl.subscribe((snap) => {
      resumeSnapshot.value = snap;
    });
  } else {
    resumeSnapshot.value = null;
  }
}

watch(
  () => resumeSnapshot.value?.autoRestoreOutcome,
  (newOutcome) => {
    if (newOutcome && newOutcome !== lastHandledAutoOutcome) {
      lastHandledAutoOutcome = newOutcome;
      presentBatchEnableOutcome(newOutcome);
    }
  },
  { immediate: true },
);

function showToast(message: string, tone: 'default' | 'error' = 'default') {
  dispatchPoeEvent('poexd-toast', {
    message,
    tone,
    durationMs: 3000,
  });
}

function applyPreferencesSnapshot(prefSnapshot: Readonly<Preferences>) {
  sidebarPosition.value = prefSnapshot.sidebarPosition ?? 'right';
  liveSearchSoundEnabled.value =
    prefSnapshot.liveSearchSoundEnabled ?? DEFAULT_PREFERENCES.liveSearchSoundEnabled;
}

function bindPreferences(mod: PreferencesModule | null | undefined) {
  if (stopPreferences) {
    stopPreferences();
    stopPreferences = null;
  }
  activePreferencesModule = mod ?? null;
  if (mod) {
    applyPreferencesSnapshot(mod.read());
    stopPreferences = mod.subscribe(applyPreferencesSnapshot);
  }
}

async function handleToggleSoundEnabled() {
  const next = !liveSearchSoundEnabled.value;
  liveSearchSoundEnabled.value = next;
  if (!activePreferencesModule) return;
  const outcome = await activePreferencesModule.update({ liveSearchSoundEnabled: next });
  if (!outcome.ok) {
    applyPreferencesSnapshot(activePreferencesModule.read());
  }
}

watch(
  () => props.preferences,
  (newPref) => {
    if (newPref) {
      bindPreferences(newPref);
    }
  },
  { immediate: true },
);

onMounted(async () => {
  if (props.preferences) return;
  try {
    const version = getPoeVersion();
    const outcome = await getPreferences(version);
    if (outcome.ok && !props.preferences) {
      bindPreferences(outcome.value);
    }
  } catch {
    // Use DEFAULT_PREFERENCES when storage is unavailable
  }
});

const activeSubscriptionCount = computed(() => {
  const subs = snapshot.value?.subscriptions ?? [];
  let count = 0;
  for (const sub of subs) {
    if (sub.status === 'connecting' || sub.status === 'active' || sub.status === 'reconnecting') {
      count += 1;
    }
  }
  return count;
});

const errorSubscriptionCount = computed(() => {
  const subs = snapshot.value?.subscriptions ?? [];
  let count = 0;
  for (const sub of subs) {
    if (sub.status === 'error') {
      count += 1;
    }
  }
  return count;
});

const droppedGroups = computed(() => snapshot.value?.droppedGroups ?? []);

function resolveDroppedSourceName(ownerKey: string): string | undefined {
  for (const group of normalizedGroups.value) {
    for (const item of group.items) {
      if (item.canonicalKey === ownerKey && item.name) {
        return item.name;
      }
    }
  }
  return undefined;
}

function handleDismissDroppedGroup(ownerKey: string) {
  props.controller?.dismissDroppedGroup?.(ownerKey);
}

function handleClearDroppedGroups() {
  props.controller?.clearDroppedGroups?.();
}

watch([visibleGroups, collapsedGroupIds, isSwitchingLeague], () => {
  if (!activeEntityKey.value) return;
  if (isSwitchingLeague.value) {
    clearScopedActivePreview();
    return;
  }
  let activeItem: LiveSearchSourceItem | undefined;
  for (const g of visibleGroups.value) {
    if (isGroupCollapsed(g.id)) continue;
    for (const item of g.items) {
      if (getPreviewEntityKey(item) === activeEntityKey.value) {
        activeItem = item;
        break;
      }
    }
    if (activeItem) break;
  }

  if (
    !activeItem ||
    activeItem.compatibility === 'invalid-url' ||
    activePreviewUrl.value === null ||
    activeItem.url !== activePreviewUrl.value
  ) {
    clearScopedActivePreview();
  }
});

function getActiveSourceController(): LiveSearchSourceController | null {
  return props.sourceController ?? fallbackSourceController;
}

watch(
  [() => props.controller, () => props.sourceController],
  ([newController, newSourceCtrl]) => {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    if (unsubSource) {
      unsubSource();
      unsubSource = null;
    }
    if (fallbackSourceController) {
      fallbackSourceController.dispose();
      fallbackSourceController = null;
    }

    if (newController) {
      unsubscribe = newController.subscribe((newSnapshot) => {
        snapshot.value = newSnapshot;
      });
    } else {
      snapshot.value = null;
    }

    const externalSourceCtrl = newSourceCtrl;
    if (externalSourceCtrl) {
      unsubSource = externalSourceCtrl.subscribe((newSnapshot) => {
        sourceSnapshot.value = newSnapshot;
      });
    } else if (newController) {
      fallbackSourceController = createLiveSearchSourceController(null, newController);
      unsubSource = fallbackSourceController.subscribe((newSnapshot) => {
        sourceSnapshot.value = newSnapshot;
      });
    } else {
      sourceSnapshot.value = null;
    }
  },
  { immediate: true },
);

interface DraggingConnection {
  item: LiveSearchSourceItem;
  groupId: string;
}

const {
  setTrashZoneRef,
  isDragging,
  isOverTrash,
  activeDragEntity: draggingConnection,
  trashStyle,
  beginDrag,
  endDrag,
} = useDragTrash<DraggingConnection>('[data-test="search-connections-list"]');

function handleConnectionDragStart(item: LiveSearchSourceItem, groupId: string, event: DragEvent) {
  if (!item.removable) {
    event.preventDefault();
    return;
  }
  clearScopedActivePreview();
  closeAllMenus();

  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    try {
      event.dataTransfer.setData('text/plain', item.id);
    } catch {}
  }

  beginDrag({ item, groupId });
}

function completeTrashDropIfActive() {
  const target = draggingConnection.value;
  if (!target) return;
  draggingConnection.value = null;
  handleRemoveSource(target.item, target.groupId);
}

function handleTrashDrop() {
  if (isOverTrash.value || draggingConnection.value) {
    completeTrashDropIfActive();
  }
  handleConnectionDragEnd();
}

function handleConnectionDragEnd() {
  if (isOverTrash.value && draggingConnection.value) {
    completeTrashDropIfActive();
  }
  endDrag();
}

watch(
  () => props.resumeController,
  (ctrl) => {
    bindResumeController(ctrl);
  },
  { immediate: true },
);

const isSoundBlocked = ref(false);
let stopSoundSub: (() => void) | null = null;

watch(
  () => props.soundNotifier,
  (notifier) => {
    stopSoundSub?.();
    stopSoundSub = null;
    isSoundBlocked.value = notifier?.getState() === 'blocked';
    if (!notifier) return;
    stopSoundSub = notifier.subscribe((state) => {
      isSoundBlocked.value = state === 'blocked';
    });
  },
  { immediate: true },
);

function handleEnableSound() {
  void props.soundNotifier?.preview();
}

onUnmounted(() => {
  clearScopedActivePreview();
  stopResumeSub?.();
  stopResumeSub = null;
  stopSoundSub?.();
  stopSoundSub = null;
  if (stopPreferences) {
    stopPreferences();
    stopPreferences = null;
  }
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  if (unsubSource) {
    unsubSource();
    unsubSource = null;
  }
  if (fallbackSourceController) {
    fallbackSourceController.dispose();
    fallbackSourceController = null;
  }
});

async function handleEnableSource(sourceId: string) {
  const sourceCtrl = getActiveSourceController();
  if (!sourceCtrl) return;
  try {
    const outcome = await sourceCtrl.enable(sourceId);
    if (!outcome.success) {
      showToast(outcome.error || t('liveSearch.toast.enableFailed'), 'error');
    }
  } catch (err) {
    showToast(err instanceof Error ? err.message : t('common.error'), 'error');
  }
}

function presentBatchEnableOutcome(outcome: LiveSearchBatchOutcome) {
  const toast = resolveBatchEnableToast(outcome);
  showToast(toast.message, toast.tone);
}

function presentBatchStopOutcome(outcome: LiveSearchBatchOutcome) {
  const toast = resolveBatchStopToast(outcome);
  showToast(toast.message, toast.tone);
}

async function runBatchEnable(sourceIds: readonly string[]) {
  const sourceCtrl = getActiveSourceController();
  if (!sourceCtrl || isBatchRunning.value || sourceIds.length === 0) return;

  closeAllMenus();
  isBatchRunning.value = true;
  try {
    if (typeof sourceCtrl.enableMany === 'function') {
      const outcome = await sourceCtrl.enableMany(sourceIds);
      presentBatchEnableOutcome(outcome);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : t('liveSearch.toast.batchEnableFailed');
    showToast(msg, 'error');
  } finally {
    isBatchRunning.value = false;
  }
}

function runBatchStop(sourceIds: readonly string[]) {
  const sourceCtrl = getActiveSourceController();
  if (!sourceCtrl || isBatchRunning.value || sourceIds.length === 0) return;

  closeAllMenus();
  if (typeof sourceCtrl.stopMany === 'function') {
    const outcome = sourceCtrl.stopMany(sourceIds);
    presentBatchStopOutcome(outcome);
  }
}

async function handleBatchEnableGroup(groupId: string) {
  if (groupId === PREVIOUS_CONNECTIONS_GROUP_ID) {
    const sourceCtrl = getActiveSourceController();
    if (sourceCtrl && typeof sourceCtrl.restoreAllPreviousConnections === 'function') {
      if (isBatchRunning.value) return;
      closeAllMenus();
      isBatchRunning.value = true;
      try {
        const outcome = await sourceCtrl.restoreAllPreviousConnections();
        presentBatchEnableOutcome(outcome);
      } catch (err) {
        const msg = err instanceof Error ? err.message : t('liveSearch.toast.batchEnableFailed');
        showToast(msg, 'error');
      } finally {
        isBatchRunning.value = false;
      }
      return;
    }
  }
  const sourceIds = getLiveSearchGroupSubtreeSourceIds(normalizedGroups.value, groupId);
  if (sourceIds.length === 0) return;
  await runBatchEnable(sourceIds);
}

async function handleClearPreviousConnections() {
  const sourceCtrl = getActiveSourceController();
  if (!sourceCtrl || isBatchRunning.value) return;
  activeGroupMenuId.value = null;
  activeItemMenuId.value = null;
  if (typeof sourceCtrl.clearPreviousConnections === 'function') {
    await sourceCtrl.clearPreviousConnections();
  }
}

function handleClearStoppedSessionConnections() {
  if (isBatchRunning.value) return;
  activeGroupMenuId.value = null;
  activeItemMenuId.value = null;
  const subtreeItems = getLiveSearchGroupSubtreeItems(
    normalizedGroups.value,
    SESSION_CONNECTIONS_GROUP_ID,
  );
  const stoppedItems = subtreeItems.filter(isItemStoppedInSession);
  for (const item of stoppedItems) {
    handleRemoveSource(item, SESSION_CONNECTIONS_GROUP_ID);
  }
}

function handleBatchStopGroup(groupId: string) {
  const sourceIds = getLiveSearchGroupSubtreeSourceIds(normalizedGroups.value, groupId);
  if (sourceIds.length === 0) return;
  runBatchStop(sourceIds);
}

async function handleBatchEnableFiltered() {
  await runBatchEnable(filteredSourceIds.value);
}

function handleBatchStopFiltered() {
  runBatchStop(filteredSourceIds.value);
}

function handleRetrySource(item: LiveSearchSourceItem) {
  const sourceCtrl = getActiveSourceController();
  if (sourceCtrl && typeof sourceCtrl.retry === 'function') {
    const outcome = sourceCtrl.retry(item.id);
    if (!outcome.success) {
      showToast(outcome.error || t('liveSearch.toast.retryFailed'), 'error');
    }
    return;
  }
  if (props.controller && item.subscriptionId) {
    const outcome = props.controller.retry(item.subscriptionId);
    if (!outcome.success) {
      showToast(outcome.error || t('liveSearch.toast.retryFailed'), 'error');
    }
  }
}

function handleStopSource(item: LiveSearchSourceItem) {
  const sourceCtrl = getActiveSourceController();
  if (sourceCtrl && typeof sourceCtrl.stop === 'function') {
    sourceCtrl.stop(item.id);
    return;
  }
  if (props.controller && item.subscriptionId) {
    props.controller.remove(item.subscriptionId);
  }
}

function handleOpenSourceNewTab(item: LiveSearchSourceItem) {
  closeAllMenus();
  if (item.compatibility === 'invalid-url' || !parseTradeSearchUrl(item.url)) return;
  const targetUrl = stripLiveSuffix(item.url);
  window.open(targetUrl, '_blank', 'noopener,noreferrer');
}

function handleToggleMuteSource(item: LiveSearchSourceItem) {
  closeAllMenus();
  const sourceCtrl = getActiveSourceController();
  if (!sourceCtrl || typeof sourceCtrl.setMuted !== 'function') return;
  const targetKey = item.canonicalKey ?? item.id;
  void sourceCtrl.setMuted(targetKey, !item.muted);
}

function handleRemoveSource(item: LiveSearchSourceItem, groupId: string) {
  const sourceCtrl = getActiveSourceController();
  if (!sourceCtrl) return;
  if (groupId === PREVIOUS_CONNECTIONS_GROUP_ID) {
    if (typeof sourceCtrl.removePreviousConnection === 'function') {
      void sourceCtrl.removePreviousConnection(item.id);
      return;
    }
  }
  if (groupId === SESSION_CONNECTIONS_GROUP_ID) {
    if (typeof sourceCtrl.removeSessionConnection === 'function') {
      sourceCtrl.removeSessionConnection(item.id);
      return;
    }
  }
  if (typeof sourceCtrl.removeTemporarySearch === 'function') {
    sourceCtrl.removeTemporarySearch(item.id);
  }
}

const isDevBuild = import.meta.env.DEV;
const DEV_INJECT_COUNTS = [50, 200, 600] as const;
const isDevInjecting = ref(false);
const devInjectStatus = ref('');

const resultFilterKey = computed(() => snapshot.value?.resultFilterKey ?? null);
const displayedResultCount = computed(() => snapshot.value?.displayedResultCount ?? 0);
const resultCountsByOwner = computed(() => snapshot.value?.resultCountsByOwner ?? {});
const resultFilterName = computed(() => {
  const key = resultFilterKey.value;
  if (!key) return '';
  const match =
    sourceSnapshot.value?.sessionConnections?.find((item) => item.canonicalKey === key) ??
    sourceSnapshot.value?.groups
      ?.flatMap((group) => group.items)
      .find((item) => item.canonicalKey === key);
  return match?.name?.trim() || match?.canonicalIdentity?.searchId || key;
});

function isResultFilterable(item: LiveSearchSourceItem, group: LiveSearchSourceGroup): boolean {
  if (!item.canonicalKey || typeof props.controller?.setResultFilter !== 'function') return false;
  // 本次連線一律可篩選；其他分組（書籤、自訂網址）在已建立監聽時亦可篩選
  return group.id === SESSION_CONNECTIONS_GROUP_ID || Boolean(item.subscriptionId);
}

function isResultFilterTarget(item: LiveSearchSourceItem): boolean {
  return Boolean(resultFilterKey.value) && item.canonicalKey === resultFilterKey.value;
}

function getItemResultCount(item: LiveSearchSourceItem): number {
  if (!item.canonicalKey) return 0;
  return resultCountsByOwner.value[item.canonicalKey] ?? 0;
}

async function handleClearResults() {
  await props.controller?.clearResults?.();
}

function handleToggleResultFilter(item: LiveSearchSourceItem, group: LiveSearchSourceGroup) {
  if (!isResultFilterable(item, group) || !item.canonicalKey) return;
  props.controller?.setResultFilter?.(
    resultFilterKey.value === item.canonicalKey ? null : item.canonicalKey,
  );
}

function clearResultFilter() {
  props.controller?.setResultFilter?.(null);
}

async function handleDevInject(count: number) {
  const inject = props.controller?.injectDevResults;
  if (!isDevBuild || !inject || isDevInjecting.value) return;
  isDevInjecting.value = true;
  devInjectStatus.value = '…';
  const owners = (sourceSnapshot.value?.sessionConnections ?? [])
    .filter((item) => item.canonicalKey && item.canonicalIdentity)
    .map((item) => ({
      canonicalKey: item.canonicalKey as string,
      searchId: item.canonicalIdentity!.searchId,
    }));
  const startedAt = performance.now();
  try {
    const outcome = await inject(count, owners);
    const elapsed = Math.round(performance.now() - startedAt);
    devInjectStatus.value = outcome.error
      ? outcome.error
      : `ok ${outcome.rendered} / fail ${outcome.failed} · ${elapsed}ms`;
  } catch (error) {
    devInjectStatus.value = error instanceof Error ? error.message : String(error);
  } finally {
    isDevInjecting.value = false;
  }
}
</script>
