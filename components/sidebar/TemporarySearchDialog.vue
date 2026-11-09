<script setup lang="ts">
import { ref, computed, watch, nextTick, onUnmounted, type PropType } from 'vue';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  ScrollAreaCorner,
  ScrollAreaRoot,
  ScrollAreaViewport,
  ScrollBar,
} from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ChevronDown, Folder, Search, X, Check } from '@lucide/vue';
import { FORM_INDICATOR_SPECS } from '@/lib/tokens';
import { decodeTradeSearchUrl, extractQueryMetadata } from '@/utils/trade-url-codec';
import { parseTradeSearchUrl, stripLiveSuffix } from '@/utils/trade-search-identity';
import { loadTradeDictionaries } from '@/utils/trade-stat-dictionary';
import { formatFolderPath } from '@/utils/bookmark-collection';
import { dispatchPoeEvent } from '@/utils/event-contracts';
import { t } from '@/utils/i18n';
import { resolveBatchEnableToast } from './live-search-presentation';
import {
  filterLiveSearchSourceGroups,
  formatLiveSearchDisplayLeague,
  getLiveSearchGroupSubtreeItems,
  type LiveSearchSourceController,
  type LiveSearchSourceGroup,
  type LiveSearchSourceItem,
  type LiveSearchSourceSnapshot,
} from '@/entrypoints/content/logic/live-search-bookmark-controller';

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  sourceController: {
    type: Object as PropType<LiveSearchSourceController | null>,
    default: null,
  },
});

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
  (e: 'success', sourceId?: string): void;
}>();

const activeMode = ref<'bookmarks' | 'url'>('url');
const inputUrl = ref('');
const inputName = ref('');
const lastAutoName = ref('');
const isNameManuallyEdited = ref(false);
const isSubmitting = ref(false);
const validationError = ref('');
const urlInputRef = ref<any>(null);

const sourceSnapshot = ref<Readonly<LiveSearchSourceSnapshot> | null>(null);
const pickerSearchQuery = ref('');
const selectedBookmarkIds = ref<Set<string>>(new Set());
const collapsedPickerGroupIds = ref<Set<string>>(new Set());
let unsubSource: (() => void) | null = null;

let isApplyingAutoName = false;
let autoNameSeq = 0;
let pendingAutoNamePromise: Promise<void> | null = null;

function bindSourceController(ctrl: LiveSearchSourceController | null | undefined) {
  unsubSource?.();
  unsubSource = null;
  if (ctrl && typeof ctrl.read === 'function') {
    sourceSnapshot.value = ctrl.read();
    if (typeof ctrl.subscribe === 'function') {
      unsubSource = ctrl.subscribe((snap) => {
        sourceSnapshot.value = snap;
      });
    }
  } else {
    sourceSnapshot.value = null;
  }
}

watch(
  () => props.sourceController,
  (ctrl) => {
    bindSourceController(ctrl);
  },
  { immediate: true },
);

const bookmarkGroups = computed<LiveSearchSourceGroup[]>(() => {
  const raw = sourceSnapshot.value?.groups ?? [];
  return raw.filter((g) => (g.kind ?? 'bookmark') === 'bookmark');
});

const filteredBookmarkGroups = computed<LiveSearchSourceGroup[]>(() => {
  return filterLiveSearchSourceGroups(bookmarkGroups.value, {
    query: pickerSearchQuery.value,
    statusFilter: 'all',
  }).filter((g) => (g.items?.length ?? 0) > 0);
});

const bookmarkItemById = computed<Map<string, LiveSearchSourceItem>>(() => {
  const map = new Map<string, LiveSearchSourceItem>();
  for (const group of bookmarkGroups.value) {
    for (const item of group.items) {
      map.set(item.id, item);
    }
  }
  return map;
});

function getItemDedupKey(item: LiveSearchSourceItem): string {
  return item.canonicalKey || item.url || item.id;
}

const selectedByCanonicalKey = computed<Map<string, string>>(() => {
  const map = new Map<string, string>();
  for (const id of selectedBookmarkIds.value) {
    const item = bookmarkItemById.value.get(id);
    if (item) {
      map.set(getItemDedupKey(item), id);
    }
  }
  return map;
});

function getGroupDisplayPath(group: LiveSearchSourceGroup): string {
  return formatFolderPath(bookmarkGroups.value, group.id) || group.name;
}

const currentLeagueDisplay = computed(() => {
  const league = sourceSnapshot.value?.selectedLeague || 'Standard';
  return formatLiveSearchDisplayLeague(league);
});

function isBookmarkSelectable(item: LiveSearchSourceItem): boolean {
  if (item.compatibility !== 'compatible') return false;
  if (item.pending) return false;
  const st = item.status ?? item.liveSearchStatus;
  if (st === 'connecting' || st === 'active' || st === 'reconnecting' || st === 'error') {
    return false;
  }
  return true;
}

function isBookmarkSelected(id: string): boolean {
  return selectedBookmarkIds.value.has(id);
}

function isDuplicateCanonicalSelected(item: LiveSearchSourceItem): boolean {
  if (selectedBookmarkIds.value.has(item.id)) return false;
  const selectedId = selectedByCanonicalKey.value.get(getItemDedupKey(item));
  return Boolean(selectedId && selectedId !== item.id);
}

const sessionPausedCanonicalKeys = computed<Set<string>>(() => {
  const keys = new Set<string>();
  for (const item of sourceSnapshot.value?.sessionConnections ?? []) {
    const st = item.status ?? item.liveSearchStatus;
    if (st !== 'connecting' && st !== 'active' && st !== 'reconnecting' && st !== 'error') {
      keys.add(getItemDedupKey(item));
    }
  }
  return keys;
});

function isBookmarkInSessionPaused(item: LiveSearchSourceItem): boolean {
  return sessionPausedCanonicalKeys.value.has(getItemDedupKey(item));
}

function isPickerGroupCollapsed(groupId: string): boolean {
  if (pickerSearchQuery.value.trim()) return false;
  return collapsedPickerGroupIds.value.has(groupId);
}

function togglePickerGroupCollapse(groupId: string) {
  const next = new Set(collapsedPickerGroupIds.value);
  if (next.has(groupId)) {
    next.delete(groupId);
  } else {
    next.add(groupId);
  }
  collapsedPickerGroupIds.value = next;
}

function toggleBookmarkSelection(item: LiveSearchSourceItem) {
  if (!isBookmarkSelectable(item)) return;
  const next = new Set(selectedBookmarkIds.value);
  if (next.has(item.id)) {
    next.delete(item.id);
  } else {
    const dedupKey = getItemDedupKey(item);
    const existingDuplicateId = selectedByCanonicalKey.value.get(dedupKey);
    if (existingDuplicateId && existingDuplicateId !== item.id) {
      next.delete(existingDuplicateId);
    }
    next.add(item.id);
  }
  selectedBookmarkIds.value = next;
}

function getPickerItemBadge(item: LiveSearchSourceItem): string {
  if (item.compatibility !== 'compatible') {
    switch (item.compatibility) {
      case 'wrong-version':
        return t('liveSearch.primary.diffVersion');
      case 'wrong-league':
        return t('liveSearch.primary.diffLeague');
      case 'invalid-url':
        return t('liveSearch.primary.invalidUrl');
      default:
        return t('liveSearch.primary.diffVersion');
    }
  }
  if (item.status === 'error') {
    return t('liveSearch.primary.statusError');
  }
  return t('liveSearch.primary.statusActive');
}

function getGroupSelectableItems(groupId: string): LiveSearchSourceItem[] {
  const group = bookmarkGroups.value.find((g) => g.id === groupId);
  const raw = (group?.items ?? []).filter(isBookmarkSelectable);
  const seenKeys = new Set<string>();
  const deduped: LiveSearchSourceItem[] = [];
  for (const item of raw) {
    const key = getItemDedupKey(item);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    deduped.push(item);
  }
  return deduped;
}

function isGroupAllSelected(groupId: string): boolean {
  const selectable = getGroupSelectableItems(groupId);
  if (selectable.length === 0) return false;
  return selectable.every(
    (item) =>
      selectedBookmarkIds.value.has(item.id) ||
      selectedByCanonicalKey.value.has(getItemDedupKey(item)),
  );
}

function toggleGroupSelection(groupId: string) {
  const selectable = getGroupSelectableItems(groupId);
  if (selectable.length === 0) return;
  const next = new Set(selectedBookmarkIds.value);
  const allSelected = selectable.every(
    (item) => next.has(item.id) || selectedByCanonicalKey.value.has(getItemDedupKey(item)),
  );
  if (allSelected) {
    const groupAllItems = getLiveSearchGroupSubtreeItems(bookmarkGroups.value, groupId);
    const groupKeys = new Set(selectable.map(getItemDedupKey));
    for (const item of groupAllItems) {
      next.delete(item.id);
    }
    for (const [key, selId] of selectedByCanonicalKey.value.entries()) {
      if (groupKeys.has(key)) {
        next.delete(selId);
      }
    }
  } else {
    const activeKeys = new Set<string>(selectedByCanonicalKey.value.keys());
    for (const item of selectable) {
      const key = getItemDedupKey(item);
      if (activeKeys.has(key)) continue;
      activeKeys.add(key);
      next.add(item.id);
    }
  }
  selectedBookmarkIds.value = next;
}

function resetForm() {
  autoNameSeq++;
  pendingAutoNamePromise = null;
  isApplyingAutoName = false;
  inputUrl.value = '';
  inputName.value = '';
  lastAutoName.value = '';
  isNameManuallyEdited.value = false;
  validationError.value = '';
  isSubmitting.value = false;
  pickerSearchQuery.value = '';
  selectedBookmarkIds.value = new Set();
  collapsedPickerGroupIds.value = new Set();
  activeMode.value = bookmarkGroups.value.some((g) => g.items.length > 0) ? 'bookmarks' : 'url';
}

function handleOpenUpdate(nextOpen: boolean) {
  if (!nextOpen) {
    if (isSubmitting.value) return;
    resetForm();
  }
  emit('update:open', nextOpen);
}

function handleCancel() {
  if (isSubmitting.value) return;
  resetForm();
  emit('update:open', false);
}

function applyAutoName(nextAutoName: string) {
  isApplyingAutoName = true;
  lastAutoName.value = nextAutoName;
  inputName.value = nextAutoName;
  isNameManuallyEdited.value = false;
  isApplyingAutoName = false;
}

function canAutoOverwriteName(): boolean {
  const current = inputName.value;
  return !isNameManuallyEdited.value || current.trim() === '' || current === lastAutoName.value;
}

/** 自動解析不到名稱時，以網址中的搜尋代碼（search ID）作為名稱，確保連線可辨識。 */
function fallbackNameForUrl(rawUrl: string): string {
  return parseTradeSearchUrl(stripLiveSuffix(rawUrl.trim()))?.searchId ?? '';
}

async function syncAutoNameForUrl(rawUrl: string): Promise<void> {
  const seq = ++autoNameSeq;
  const trimmedUrl = rawUrl.trim();
  if (!trimmedUrl) {
    if (canAutoOverwriteName()) {
      applyAutoName('');
    }
    return;
  }

  const decoded = await decodeTradeSearchUrl(trimmedUrl);
  if (seq !== autoNameSeq || !props.open) return;

  if (!decoded) {
    if (canAutoOverwriteName()) {
      applyAutoName(fallbackNameForUrl(trimmedUrl));
    }
    return;
  }

  const initialMeta = extractQueryMetadata(decoded.query, decoded.gameVersion);
  if (canAutoOverwriteName() && seq === autoNameSeq && props.open) {
    applyAutoName(initialMeta.suggestedName || decoded.searchId);
  }

  await loadTradeDictionaries(decoded.gameVersion);
  if (seq !== autoNameSeq || !props.open) return;

  const finalMeta = extractQueryMetadata(decoded.query, decoded.gameVersion);
  if (canAutoOverwriteName() && seq === autoNameSeq && props.open) {
    applyAutoName(finalMeta.suggestedName || decoded.searchId);
  }
}

watch(
  inputName,
  (newName) => {
    if (isApplyingAutoName) return;
    if (newName.trim() === '') {
      isNameManuallyEdited.value = false;
      lastAutoName.value = '';
    } else if (newName !== lastAutoName.value) {
      isNameManuallyEdited.value = true;
    }
  },
  { flush: 'sync' },
);

watch(
  inputUrl,
  (newUrl) => {
    validationError.value = '';
    if (isApplyingAutoName) return;
    pendingAutoNamePromise = syncAutoNameForUrl(newUrl);
  },
  { flush: 'sync' },
);

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      bindSourceController(props.sourceController);
      resetForm();
      nextTick(() => {
        if (activeMode.value === 'url') {
          const el = urlInputRef.value?.$el ?? urlInputRef.value;
          el?.focus?.();
        }
      });
    } else {
      resetForm();
    }
  },
);

async function handleSubmit() {
  if (isSubmitting.value) return;
  const url = inputUrl.value.trim();
  if (!url) return;

  isSubmitting.value = true;
  validationError.value = '';

  try {
    if (pendingAutoNamePromise) {
      await pendingAutoNamePromise;
    }

    const sourceCtrl = props.sourceController;
    if (!sourceCtrl || typeof sourceCtrl.addCustom !== 'function') {
      validationError.value = t('liveSearch.tempDialog.notReady');
      return;
    }

    const nameOpt = inputName.value.trim();
    const outcome = await sourceCtrl.addCustom(url, { name: nameOpt });

    if (outcome.success) {
      const sourceId = 'sourceId' in outcome ? (outcome as any).sourceId : undefined;
      resetForm();
      emit('success', sourceId);
      emit('update:open', false);
    } else {
      const errorMsg = outcome.error || t('liveSearch.presentation.enqueueFailed');
      validationError.value = errorMsg;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : t('liveSearch.presentation.enqueueFailed');
    validationError.value = msg;
    dispatchPoeEvent('poexd-toast', {
      message: msg,
      tone: 'error',
      durationMs: 3000,
    });
  } finally {
    isSubmitting.value = false;
  }
}

async function handleEnableSelectedBookmarks() {
  if (isSubmitting.value || selectedBookmarkIds.value.size === 0) return;
  const sourceCtrl = props.sourceController;
  if (!sourceCtrl || typeof sourceCtrl.enableMany !== 'function') {
    validationError.value = t('liveSearch.tempDialog.notReady');
    return;
  }

  isSubmitting.value = true;
  validationError.value = '';
  try {
    const seenKeys = new Set<string>();
    const ids: string[] = [];
    for (const id of selectedBookmarkIds.value) {
      const item = bookmarkItemById.value.get(id);
      const key = item ? getItemDedupKey(item) : id;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      ids.push(id);
    }
    const outcome = await sourceCtrl.enableMany(ids);
    const toast = resolveBatchEnableToast(outcome);
    dispatchPoeEvent('poexd-toast', {
      message: toast.message,
      tone: toast.tone,
      durationMs: 3000,
    });
    if (outcome.succeeded > 0 || !outcome.rejectReason) {
      resetForm();
      emit('success', ids[0]);
      emit('update:open', false);
    } else {
      validationError.value = outcome.error || t('liveSearch.tempDialog.enableBookmarksFailed');
    }
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : t('liveSearch.tempDialog.enableBookmarksFailed');
    validationError.value = msg;
    dispatchPoeEvent('poexd-toast', {
      message: msg,
      tone: 'error',
      durationMs: 3000,
    });
  } finally {
    isSubmitting.value = false;
  }
}

onUnmounted(() => {
  unsubSource?.();
  unsubSource = null;
  resetForm();
});
</script>

<template>
  <Dialog :open="open" @update:open="handleOpenUpdate">
    <DialogContent
      layer="system"
      class="flex h-auto max-h-[min(var(--pxd-temporary-search-dialog-max-height,560px),calc(100vh-32px))] w-[var(--pxd-temporary-search-dialog-width)] max-w-[calc(100vw-32px)] flex-col gap-[var(--pxd-space-md)] p-[var(--pxd-pane-padding)]"
    >
      <div
        data-test="temporary-search-dialog"
        class="flex flex-col gap-[var(--pxd-space-md)] w-full min-w-0"
      >
        <DialogHeader class="shrink-0 text-left pr-[var(--pxd-space-2xl)]">
          <DialogTitle
            class="text-[length:var(--pxd-font-section-title)] font-bold tracking-[0.5px]"
          >
            {{ t('liveSearch.console.addConnectionTitle') }}
          </DialogTitle>
          <DialogDescription
            class="text-[length:var(--pxd-font-caption)] text-muted-foreground m-0"
          >
            {{ t('liveSearch.tempDialog.desc', { league: currentLeagueDisplay }) }}
          </DialogDescription>
        </DialogHeader>

        <!-- 模式切換 Tabs -->
        <div
          data-test="add-connection-mode-tabs"
          class="grid grid-cols-2 gap-[var(--pxd-space-xs)] rounded-md bg-muted/50 p-1 shrink-0"
        >
          <button
            type="button"
            data-test="tab-bookmarks"
            class="px-2.5 py-1 rounded-sm text-[length:var(--pxd-font-caption)] font-medium transition-colors cursor-pointer"
            :class="
              activeMode === 'bookmarks'
                ? 'bg-background text-foreground shadow-sm font-semibold'
                : 'text-muted-foreground hover:text-foreground'
            "
            @click="activeMode = 'bookmarks'"
          >
            {{ t('liveSearch.console.tabBookmarks') }}
          </button>
          <button
            type="button"
            data-test="tab-url"
            class="px-2.5 py-1 rounded-sm text-[length:var(--pxd-font-caption)] font-medium transition-colors cursor-pointer"
            :class="
              activeMode === 'url'
                ? 'bg-background text-foreground shadow-sm font-semibold'
                : 'text-muted-foreground hover:text-foreground'
            "
            @click="activeMode = 'url'"
          >
            {{ t('liveSearch.console.tabUrl') }}
          </button>
        </div>

        <!-- Tab 1: 從書籤挑選 -->
        <div
          v-show="activeMode === 'bookmarks'"
          data-test="bookmark-picker-panel"
          class="flex flex-col gap-[var(--pxd-space-sm)] w-full min-w-0"
        >
          <div class="relative flex items-center shrink-0">
            <Search
              class="pointer-events-none absolute left-2.5 size-[var(--control-icon-sm,14px)] text-muted-foreground"
            />
            <Input
              v-model="pickerSearchQuery"
              type="text"
              size="sm"
              data-test="bookmark-picker-search"
              :placeholder="t('liveSearch.tempDialog.searchBookmarksPlaceholder')"
              class="w-full pl-8 pr-7 text-[length:var(--pxd-font-caption)]"
              @keydown.esc.stop="handleCancel"
            />
            <Button
              v-if="pickerSearchQuery"
              type="button"
              variant="ghost"
              size="icon-sm"
              class="absolute right-1"
              :title="t('bookmark.search.clearTooltip')"
              @click="pickerSearchQuery = ''"
            >
              <X />
            </Button>
          </div>

          <ScrollAreaRoot class="relative w-full overflow-hidden shrink-0">
            <ScrollAreaViewport data-test="bookmark-picker-list" class="max-h-[280px] w-full pr-1">
              <div class="flex flex-col gap-[var(--pxd-bookmark-tree-gap)]">
                <div
                  v-if="filteredBookmarkGroups.length === 0"
                  data-test="bookmark-picker-empty"
                  class="shrink-0 py-6 px-3 text-center text-[length:var(--pxd-font-caption)] text-muted-foreground border border-dashed border-border rounded-md"
                >
                  {{
                    bookmarkGroups.length === 0
                      ? t('liveSearch.tempDialog.noBookmarksInLeague', {
                          league: currentLeagueDisplay,
                        })
                      : t('liveSearch.tempDialog.noBookmarksMatching')
                  }}
                </div>

                <div
                  v-for="group in filteredBookmarkGroups"
                  :key="group.id"
                  :data-picker-group-id="group.id"
                  data-test="bookmark-picker-group"
                  class="shrink-0 flex flex-col rounded-md border border-border bg-card"
                >
                  <div
                    class="shrink-0 w-full min-h-[var(--control-height-sm,28px)] flex items-center justify-between gap-[var(--pxd-space-sm)] px-[var(--pxd-space-md)] py-[var(--pxd-bookmark-row-padding-y)] bg-muted/40 hover:bg-muted/70 rounded-t-md"
                  >
                    <button
                      type="button"
                      :data-test="`picker-group-toggle-${group.id}`"
                      class="shrink-0 flex items-center justify-center cursor-pointer disabled:cursor-not-allowed"
                      :title="
                        isGroupAllSelected(group.id)
                          ? t('liveSearch.tempDialog.deselectAllFolder')
                          : t('liveSearch.tempDialog.selectAllFolder')
                      "
                      :disabled="getGroupSelectableItems(group.id).length === 0"
                      @click.stop="toggleGroupSelection(group.id)"
                    >
                      <span
                        class="flex shrink-0 items-center justify-center rounded-sm border"
                        :class="[
                          FORM_INDICATOR_SPECS.checkbox.sizeClass,
                          isGroupAllSelected(group.id)
                            ? 'bg-primary border-primary text-primary-foreground'
                            : 'border-border bg-background',
                        ]"
                      >
                        <Check
                          v-if="isGroupAllSelected(group.id)"
                          :class="FORM_INDICATOR_SPECS.checkbox.indicatorClass"
                        />
                      </span>
                    </button>

                    <button
                      type="button"
                      :data-test="`picker-group-collapse-${group.id}`"
                      :aria-expanded="!isPickerGroupCollapsed(group.id)"
                      class="flex items-center justify-between gap-[var(--pxd-space-sm)] min-w-0 flex-1 text-left cursor-pointer"
                      @click="togglePickerGroupCollapse(group.id)"
                    >
                      <div class="flex items-center gap-[var(--pxd-space-sm)] min-w-0 flex-1">
                        <Folder
                          class="size-[var(--control-icon-sm,14px)] shrink-0 text-muted-foreground"
                        />
                        <span class="truncate text-[length:var(--pxd-font-caption)] font-semibold">
                          {{ getGroupDisplayPath(group) }}
                        </span>
                      </div>
                      <div class="shrink-0 flex items-center gap-1">
                        <span
                          class="text-[length:var(--pxd-font-micro)] text-muted-foreground font-mono"
                        >
                          {{ group.items.length }} 項
                        </span>
                        <ChevronDown
                          class="size-[var(--control-icon-sm,14px)] shrink-0 text-muted-foreground transition-transform duration-150"
                          :class="{ '-rotate-90': isPickerGroupCollapsed(group.id) }"
                        />
                      </div>
                    </button>
                  </div>

                  <div
                    v-if="!isPickerGroupCollapsed(group.id) && group.items.length > 0"
                    class="shrink-0 flex flex-col divide-y divide-border/40 px-[var(--pxd-space-sm)] py-[var(--pxd-bookmark-folder-body-padding-y)]"
                  >
                    <button
                      v-for="item in group.items"
                      :key="item.id"
                      type="button"
                      :data-test="`picker-bookmark-${item.id}`"
                      class="shrink-0 w-full min-h-[var(--control-height-sm,28px)] flex items-center justify-between gap-[var(--pxd-space-sm)] py-[var(--pxd-bookmark-row-padding-y)] px-[var(--pxd-space-xs)] rounded-sm text-left transition-colors"
                      :class="
                        isBookmarkSelectable(item)
                          ? 'hover:bg-muted/50 cursor-pointer'
                          : 'opacity-55 cursor-not-allowed'
                      "
                      :disabled="!isBookmarkSelectable(item)"
                      @click="toggleBookmarkSelection(item)"
                    >
                      <div class="flex items-center gap-[var(--pxd-space-sm)] min-w-0 flex-1">
                        <span
                          class="flex shrink-0 items-center justify-center rounded-sm border"
                          :class="[
                            FORM_INDICATOR_SPECS.checkbox.sizeClass,
                            isBookmarkSelected(item.id)
                              ? 'bg-primary border-primary text-primary-foreground'
                              : 'border-border bg-background',
                          ]"
                        >
                          <Check
                            v-if="isBookmarkSelected(item.id)"
                            :class="FORM_INDICATOR_SPECS.checkbox.indicatorClass"
                          />
                        </span>
                        <img
                          v-if="item.coverImageUrl"
                          :src="item.coverImageUrl"
                          class="size-[var(--control-height-sm)] shrink-0 object-contain"
                          alt=""
                        />
                        <span class="truncate text-[length:var(--pxd-font-caption)]">
                          {{ item.name }}
                        </span>
                      </div>
                      <span
                        v-if="!isBookmarkSelectable(item)"
                        class="shrink-0 text-[length:var(--pxd-font-micro)] text-emerald-500 font-medium"
                      >
                        {{ getPickerItemBadge(item) }}
                      </span>
                      <span
                        v-else-if="isDuplicateCanonicalSelected(item)"
                        class="shrink-0 text-[length:var(--pxd-font-micro)] text-muted-foreground font-medium"
                      >
                        {{ t('liveSearch.tempDialog.duplicateUrl') }}
                      </span>
                      <span
                        v-else-if="isBookmarkInSessionPaused(item)"
                        data-test="picker-bookmark-in-session"
                        class="shrink-0 text-[length:var(--pxd-font-micro)] text-muted-foreground font-medium"
                      >
                        {{ t('liveSearch.tempDialog.alreadyInSession') }}
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            </ScrollAreaViewport>
            <ScrollBar />
            <ScrollAreaCorner />
          </ScrollAreaRoot>

          <DialogFooter
            class="flex items-center justify-between gap-[var(--pxd-space-xs)] mt-[var(--pxd-space-xs)] shrink-0"
          >
            <span class="text-[length:var(--pxd-font-caption)] text-muted-foreground font-mono">
              {{ t('liveSearch.tempDialog.selectedCount', { count: selectedBookmarkIds.size }) }}
            </span>
            <div class="flex items-center gap-[var(--pxd-space-xs)]">
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-test="btn-picker-cancel"
                :disabled="isSubmitting"
                @click="handleCancel"
              >
                {{ t('common.cancel') }}
              </Button>
              <Button
                type="button"
                size="sm"
                data-test="btn-enable-selected-bookmarks"
                :disabled="isSubmitting || selectedBookmarkIds.size === 0"
                @click="handleEnableSelectedBookmarks"
              >
                {{
                  isSubmitting
                    ? t('liveSearch.tempDialog.starting')
                    : t('liveSearch.tempDialog.enableSelected', { count: selectedBookmarkIds.size })
                }}
              </Button>
            </div>
          </DialogFooter>
        </div>

        <!-- Tab 2: 輸入搜尋網址 -->
        <form
          v-show="activeMode === 'url'"
          data-test="temporary-search-form"
          class="flex flex-col gap-[var(--pxd-field-gap)]"
          @submit.prevent="handleSubmit"
        >
          <div class="flex flex-col gap-[var(--pxd-space-xs)]">
            <label
              for="temporary-search-input-url"
              class="text-[length:var(--pxd-font-caption)] font-medium text-foreground"
            >
              {{ t('liveSearch.tempDialog.urlLabel') }}
            </label>
            <Input
              id="temporary-search-input-url"
              ref="urlInputRef"
              v-model="inputUrl"
              type="text"
              size="sm"
              data-test="input-url"
              placeholder="https://www.pathofexile.com/trade/search/..."
              class="font-mono text-[length:var(--pxd-font-caption)]"
              :disabled="isSubmitting"
              @keydown.esc.stop="handleCancel"
            />
            <span
              v-if="validationError"
              data-test="url-validation-error"
              class="text-[length:var(--pxd-font-caption)] text-destructive font-medium"
            >
              {{ validationError }}
            </span>
          </div>

          <div class="flex flex-col gap-[var(--pxd-space-xs)]">
            <label
              for="temporary-search-input-name"
              class="text-[length:var(--pxd-font-caption)] font-medium text-foreground"
            >
              {{ t('liveSearch.tempDialog.nameLabel') }}
            </label>
            <Input
              id="temporary-search-input-name"
              v-model="inputName"
              type="text"
              size="sm"
              data-test="input-name"
              :placeholder="t('liveSearch.tempDialog.autoNameHint')"
              class="text-[length:var(--pxd-font-caption)]"
              :disabled="isSubmitting"
              @keydown.esc.stop="handleCancel"
            />
          </div>

          <DialogFooter
            class="flex items-center justify-end gap-[var(--pxd-space-xs)] mt-[var(--pxd-space-md)]"
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-test="btn-cancel"
              :disabled="isSubmitting"
              @click="handleCancel"
            >
              {{ t('common.cancel') }}
            </Button>
            <Button
              type="submit"
              size="sm"
              data-test="btn-start"
              :disabled="isSubmitting || !inputUrl.trim()"
            >
              {{
                isSubmitting
                  ? t('liveSearch.tempDialog.starting')
                  : t('liveSearch.tempDialog.startBtn')
              }}
            </Button>
          </DialogFooter>
        </form>
      </div>
    </DialogContent>
  </Dialog>
</template>
