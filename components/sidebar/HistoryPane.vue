<template>
  <SidebarPane>
    <template #fixed>
      <!-- 歷史紀錄工具列（即時搜尋與更多操作選單） -->
      <div
        class="flex items-center justify-between gap-[var(--pxd-space-sm)] pb-[var(--pxd-space-md)] w-full min-w-0"
      >
        <div class="relative flex flex-1 min-w-0 items-center">
          <Search
            class="pointer-events-none absolute left-[var(--input-padding-x-sm)] size-[var(--control-icon-sm,14px)] text-muted-foreground"
          />
          <Input
            v-model="searchQuery"
            size="sm"
            :placeholder="t('history.search.placeholder')"
            :aria-label="t('history.search.placeholder')"
            data-history-search
            class="w-full pl-[var(--control-height-sm)] pr-[var(--control-height-sm)]"
            @keydown.esc.stop.prevent="searchQuery = ''"
          />
          <Button
            v-if="searchQuery"
            variant="ghost"
            size="icon-sm"
            class="absolute right-0"
            data-history-search-clear
            :title="t('common.clearSearch')"
            :aria-label="t('common.clearSearch')"
            @click="searchQuery = ''"
          >
            <X />
          </Button>
        </div>
        <!-- 低頻設定與破壞性操作收進選單，釋放頁首空間並避免誤按 -->
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button
              variant="outline"
              size="icon-sm"
              class="shrink-0"
              data-history-menu
              :title="t('history.menuTooltip')"
              :aria-label="t('history.menuTooltip')"
            >
              <MoreVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuCheckboxItem
              data-history-action="toggle-recording"
              :model-value="enableHistory"
              @update:model-value="setHistoryEnabled(Boolean($event))"
            >
              {{ t('history.enableLabel') }}
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              v-if="invalidHistoryEntries.length > 0"
              data-history-action="clear-invalid"
              @click="clearInvalidHistory"
            >
              <Trash2 class="text-muted-foreground" />
              <span>{{ t('history.action.clearInvalid') }}</span>
              <span
                class="ml-auto pl-[var(--pxd-space-sm)] text-[length:var(--pxd-font-micro)] tabular-nums text-muted-foreground"
                >{{ invalidHistoryEntries.length }}</span
              >
            </DropdownMenuItem>
            <DropdownMenuItem
              data-history-action="clear-unbookmarked"
              :disabled="!bookmarksLoaded || unbookmarkedHistoryEntries.length === 0"
              @click="clearUnbookmarkedHistory"
            >
              <Trash2 class="text-muted-foreground" />
              <span>{{ t('history.action.clearUnbookmarked') }}</span>
              <span
                v-if="unbookmarkedHistoryEntries.length > 0"
                class="ml-auto pl-[var(--pxd-space-sm)] text-[length:var(--pxd-font-micro)] tabular-nums text-muted-foreground"
                >{{ unbookmarkedHistoryEntries.length }}</span
              >
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              data-history-action="clear-all"
              :disabled="history.length === 0"
              :title="t('history.clearAllTitle')"
              @click="clearAllHistory"
            >
              <Trash2 class="text-destructive" />
              {{ t('history.clearAllTitle') }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div
        v-if="!enableHistory"
        data-history-stopped-notice
        class="flex items-center justify-between gap-[var(--pxd-space-sm)] pb-[var(--pxd-space-md)]"
      >
        <p class="text-[length:var(--pxd-font-micro)] text-muted-foreground min-w-0 flex-1 m-0">
          {{ t('history.stoppedNotice') }}
        </p>
        <Button
          variant="outline"
          size="sm"
          class="shrink-0"
          data-history-resume
          @click="setHistoryEnabled(true)"
        >
          {{ t('history.action.resume') }}
        </Button>
      </div>

      <Separator class="mb-[var(--pxd-space-md)]" />

      <div
        v-if="pendingUndoEntry"
        data-history-undo-bar
        role="status"
        class="flex items-center justify-between gap-[var(--pxd-space-sm)] rounded-md border border-border bg-card px-[var(--pxd-space-md)] py-[var(--pxd-space-xs)] mb-[var(--pxd-space-md)]"
      >
        <span class="min-w-0 flex-1 truncate text-[length:var(--pxd-font-micro)] text-foreground">
          {{ t('history.toast.deleted', { name: getHistoryName(pendingUndoEntry) }) }}
        </span>
        <Button
          variant="outline"
          size="sm"
          class="shrink-0"
          data-history-undo-btn
          @click="undoDeleteHistory"
        >
          {{ t('history.action.undo') }}
        </Button>
      </div>
    </template>

    <template #scroll>
      <div v-if="groupedHistory.length > 0" class="flex flex-col gap-[var(--pxd-space-md)]">
        <section
          v-for="group in groupedHistory"
          :key="group.key"
          :data-history-group="group.key"
          class="flex flex-col gap-[var(--pxd-space-sm)]"
        >
          <div
            data-history-group-label
            class="px-[var(--pxd-space-xs)] text-[length:var(--pxd-font-micro)] font-medium text-muted-foreground"
          >
            {{ t(`history.group.${group.key}`) }}
          </div>
          <template v-for="h in group.entries" :key="h.id">
            <div
              :data-history-id="h.id"
              :data-current="isCurrentEntry(h) ? 'true' : undefined"
              :class="
                previewHistory?.id === h.id || isCurrentEntry(h)
                  ? 'bg-[color-mix(in_srgb,var(--primary)_12%,var(--card))] hover:bg-[color-mix(in_srgb,var(--primary)_15%,var(--card))] has-[[data-state=open]]:bg-[color-mix(in_srgb,var(--primary)_15%,var(--card))] shadow-[inset_2px_0_0_var(--primary)]'
                  : 'bg-card hover:bg-[color-mix(in_srgb,var(--muted)_40%,var(--card))] has-[[data-state=open]]:bg-[color-mix(in_srgb,var(--muted)_40%,var(--card))]'
              "
              class="history-row-item group relative flex items-center justify-between rounded-md border border-border px-[var(--pxd-space-md)] py-[var(--pxd-space-sm)] text-[length:var(--pxd-font-secondary)] transition-colors"
            >
              <div class="flex min-w-0 w-full items-center gap-[var(--pxd-space-md)]">
                <div
                  v-if="h.icon"
                  class="flex size-[var(--control-height-sm)] shrink-0 items-center justify-center"
                >
                  <img :src="h.icon" class="size-[var(--control-height-sm)] object-contain" />
                </div>
                <div
                  v-else
                  class="flex size-[var(--control-height-sm)] shrink-0 items-center justify-center rounded-sm border border-border bg-muted"
                >
                  <span class="text-[length:var(--pxd-font-micro)] font-bold text-muted-foreground"
                    >?</span
                  >
                </div>
                <div class="flex min-w-0 flex-1 flex-col">
                  <a
                    :href="h.url"
                    :aria-current="isCurrentEntry(h) ? 'page' : undefined"
                    @click.prevent="handleHistoryPrimaryClick(h, $event)"
                    :class="isCurrentEntry(h) ? 'text-primary font-semibold' : 'text-foreground'"
                    class="min-w-0 truncate text-[length:var(--pxd-font-body)] hover:text-primary no-underline"
                    :title="getHistoryName(h)"
                  >
                    {{ getHistoryName(h) }}
                  </a>
                  <span
                    v-if="getCriteriaHint(h)"
                    data-test="history-criteria-hint"
                    class="min-w-0 truncate text-[length:var(--pxd-font-micro)] text-muted-foreground"
                    :title="getCriteriaHint(h)"
                  >
                    {{ getCriteriaHint(h) }}
                  </span>
                </div>
                <span
                  v-if="isLiveTradeSearchUrl(h.url)"
                  data-test="history-live-badge"
                  class="shrink-0 rounded-sm bg-primary/15 px-[var(--pxd-space-xs)] text-[length:var(--pxd-font-micro)] font-medium text-primary group-hover:opacity-0 group-has-[[data-state=open]]:opacity-0"
                >
                  {{ t('history.row.liveBadge') }}
                </span>
                <span
                  v-if="getOtherLeague(h)"
                  data-test="history-league-badge"
                  class="shrink-0 max-w-[7.5em] truncate rounded-sm bg-muted px-[var(--pxd-space-xs)] text-[length:var(--pxd-font-micro)] text-muted-foreground group-hover:opacity-0 group-has-[[data-state=open]]:opacity-0"
                  :title="t('history.row.otherLeagueTooltip', { league: getOtherLeague(h) ?? '' })"
                >
                  {{ getOtherLeague(h) }}
                </span>
                <span
                  v-if="isBookmarked(h)"
                  data-test="history-bookmarked-indicator"
                  class="inline-flex shrink-0 items-center text-primary group-hover:opacity-0 group-has-[[data-state=open]]:opacity-0"
                  :title="t('history.row.bookmarked')"
                  :aria-label="t('history.row.bookmarked')"
                >
                  <BookmarkCheck class="size-[var(--control-icon-sm,14px)]" />
                </span>
                <span
                  v-if="isLegacyTradeSearchUrl(h.url)"
                  class="legacy-search-badge shrink-0 text-[length:var(--pxd-font-micro)] text-destructive"
                  :title="t('history.invalidTooltip')"
                  >{{ t('common.invalid') }}</span
                >
                <span
                  class="shrink-0 text-[length:var(--pxd-font-micro)] text-muted-foreground group-hover:opacity-0 group-has-[[data-state=open]]:opacity-0"
                >
                  {{ formatTime(h.visitedAt) }}
                </span>
              </div>
              <div
                :class="
                  previewHistory?.id === h.id || isCurrentEntry(h)
                    ? '[--pxd-hover-overlay-bg:color-mix(in_srgb,var(--primary)_15%,var(--card))]'
                    : undefined
                "
                class="history-row-actions pxd-hover-actions-overlay absolute inset-y-0 right-0 rounded-r-md z-(--pxd-z-raised) pr-[var(--pxd-space-md)] pl-[var(--pxd-space-2xl)] flex items-center gap-[var(--pxd-space-xs)] opacity-0 pointer-events-none transition-opacity duration-150 ease-out group-hover:opacity-100 group-hover:pointer-events-auto has-[[data-state=open]]:opacity-100 has-[[data-state=open]]:pointer-events-auto"
              >
                <Button
                  v-if="searchEntryClickAction === 'preview'"
                  variant="ghost"
                  size="icon-sm"
                  :title="t('common.openSearch')"
                  data-test="history-open"
                  @click.stop="openHistory(h.url)"
                >
                  <ArrowRight />
                </Button>
                <Button
                  v-else
                  variant="ghost"
                  size="icon-sm"
                  :class="previewHistory?.id === h.id ? 'text-primary bg-primary/15' : undefined"
                  :title="t('common.searchPreview')"
                  data-test="history-preview-toggle"
                  @click.stop="toggleHistoryPreview(h, $event)"
                >
                  <Eye />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  :title="t('common.openNewTab')"
                  @click.stop="openHistoryNewTab(h.url)"
                >
                  <ExternalLink />
                </Button>
                <DropdownMenu v-if="flattenedBookmarkFolders.length > 1 && !isBookmarked(h)">
                  <DropdownMenuTrigger as-child>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      :disabled="isLegacyTradeSearchUrl(h.url)"
                      :title="t('common.addToBookmarks')"
                      data-test="history-bookmark-picker"
                      @click.stop
                    >
                      <BookmarkPlus />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" class="w-[var(--pxd-menu-sub-width,192px)]">
                    <DropdownMenuItem
                      v-for="item in flattenedBookmarkFolders"
                      :key="item.folder.id"
                      data-test="history-bookmark-folder-option"
                      @click="saveHistoryToBookmark(h, item.folder.id)"
                    >
                      <span
                        v-if="getFolderItemIndentLevel(item.depth) > 0"
                        class="flex shrink-0 items-center -mr-[var(--control-gap-sm)]"
                        aria-hidden="true"
                      >
                        <span
                          v-for="step in getFolderItemIndentLevel(item.depth)"
                          :key="step"
                          class="w-[var(--pxd-space-md)] shrink-0"
                        />
                      </span>
                      <FolderIcon :icon="item.folder.icon" :color="item.folder.color" />
                      <span class="min-w-0 flex-1 truncate">{{ item.folder.name }}</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  v-else
                  variant="ghost"
                  size="icon-sm"
                  :disabled="isLegacyTradeSearchUrl(h.url) || isBookmarked(h)"
                  :class="isBookmarked(h) ? 'text-primary' : undefined"
                  :title="
                    isBookmarked(h) ? t('history.row.bookmarked') : t('common.addToBookmarks')
                  "
                  data-test="history-bookmark-add"
                  @click.stop="saveHistoryToBookmark(h)"
                >
                  <BookmarkCheck v-if="isBookmarked(h)" />
                  <BookmarkPlus v-else />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  :title="t('history.row.copyLink')"
                  data-test="history-copy-link"
                  @click.stop="copyHistoryLink(h.url)"
                >
                  <Link2 />
                </Button>
                <Button
                  variant="ghost-destructive"
                  size="icon-sm"
                  :title="t('history.row.delete')"
                  @click.stop="deleteHistory(h.id)"
                >
                  <X />
                </Button>
              </div>
            </div>
          </template>
        </section>
        <div
          data-history-capacity
          class="pt-[var(--pxd-space-xs)] text-center text-[length:var(--pxd-font-micro)] tabular-nums text-muted-foreground"
        >
          {{ t('history.capacityCount', { count: history.length, limit: maxHistoryEntries }) }}
        </div>
        <!-- 單例預覽（點擊切換，見 GLOSSARY.md「Search Preview」） -->
        <TradeSearchPreviewPopover
          :open="isHistoryPreviewOpen"
          :side="sidebarPosition === 'left' ? 'right' : 'left'"
          :preview-data="activePreviewData"
          :reference="previewAnchorEl"
          :source-name="previewSourceName"
          :raw-query="activeRawQuery"
          :can-open-search="canOpenPreviewSearch"
          @open-search="handleOpenPreviewSearch"
          @update:open="(open) => !open && closeHistoryPreview()"
        />
      </div>
      <SidebarFilterEmptyState
        v-else-if="history.length > 0 && trimmedSearchQuery"
        mode="search"
        :message="t('history.empty.noMatch')"
        :active-filters="[trimmedSearchQuery]"
        @reset="searchQuery = ''"
      />
      <SidebarEmptyState
        v-else
        :message="enableHistory ? t('history.empty.noHistory') : t('history.empty.stopped')"
      >
        <template #icon><History /></template>
      </SidebarEmptyState>
    </template>
  </SidebarPane>
</template>

<script lang="ts">
import { computed, defineComponent, reactive, ref, watch, onMounted, onUnmounted } from 'vue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import SidebarPane from './layout/SidebarPane.vue';
import SidebarEmptyState from './layout/SidebarEmptyState.vue';
import SidebarFilterEmptyState from './layout/SidebarFilterEmptyState.vue';
import FolderIcon from './FolderIcon.vue';
import {
  ArrowRight,
  BookmarkCheck,
  BookmarkPlus,
  ExternalLink,
  Eye,
  History,
  Link2,
  MoreVertical,
  Search,
  Trash2,
  X,
} from '@lucide/vue';
import { getPoeVersion } from '@/utils/trade-context';
import { createChromeSearchRecordClient } from '@/utils/search-record-messaging';
import {
  MAX_HISTORY_ENTRIES,
  type HistoryEntry,
  type SearchRecordCommand,
} from '@/utils/search-records';
import { createHistoryDomainFeed } from './history-domain-feed';
import {
  deriveHistoryCriteriaHint,
  extractTradeLeagueFromUrl,
  findDisambiguationEntryIds,
  getOtherLeagueLabel,
  groupHistoryEntriesByTime,
  isCurrentHistoryEntry,
  isLiveTradeSearchUrl,
} from './history-presentation';
import { createChromeBookmarkClient } from '@/utils/bookmark-messaging';
import {
  getFlattenedFolderTree,
  sanitizeBookmarkName,
  type BookmarkCollectionGroup,
} from '@/utils/bookmark-collection';
import type { BookmarkViewItem } from '@/utils/bookmark-coordinator';
import { getFolderItemIndentLevel } from './bookmark-tree';
import { isValidPoeCdnImageUrl } from '@/utils/poe-cdn-url';
import { dispatchPoeEvent, listenPoeEvent } from '@/utils/event-contracts';
import { isLegacyTradeSearchUrl, stripLiveSuffix } from '@/utils/trade-search-identity';
import { resolveTunedTradeSearchUrl } from '@/utils/trade-query-tuning';
import { getPreferences } from '@/utils/preferences';
import TradeSearchPreviewPopover from './search-preview/TradeSearchPreviewPopover.vue';
import { DEFAULT_PREFERENCES, type SearchEntryClickAction } from '@/utils/preferences-contract';
import { rowAnchorFromEvent, useTradeSearchPreview } from './composables/useTradeSearchPreview';
import { t } from '@/utils/i18n';

const UNDO_TIMEOUT_MS = 5000;

export default defineComponent({
  name: 'HistoryPane',
  components: {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    FolderIcon,
    MoreVertical,
    SidebarPane,
    SidebarEmptyState,
    SidebarFilterEmptyState,
    Button,
    Input,
    Separator,
    ArrowRight,
    BookmarkCheck,
    BookmarkPlus,
    ExternalLink,
    Eye,
    History,
    Link2,
    Search,
    Trash2,
    X,
    TradeSearchPreviewPopover,
  },
  setup() {
    const version = getPoeVersion();
    const client = createChromeSearchRecordClient();
    const bookmarkClient = createChromeBookmarkClient(version);

    const history = ref<HistoryEntry[]>([]);
    const enableHistory = ref(true);
    const searchQuery = ref('');
    const bookmarks = ref<BookmarkViewItem[]>([]);
    const bookmarkGroups = ref<BookmarkCollectionGroup[]>([]);
    const bookmarksLoaded = ref(false);
    const sidebarPosition = ref<'left' | 'right'>('left');
    const searchEntryClickAction = ref<SearchEntryClickAction>(
      DEFAULT_PREFERENCES.searchEntryClickAction,
    );
    const currentPageUrl = ref(typeof window !== 'undefined' ? window.location.href : '');
    const pendingUndoEntry = ref<HistoryEntry | null>(null);
    const criteriaHintByUrl = reactive<Record<string, string>>({});
    const inFlightHintUrls = new Set<string>();
    let undoTimer: ReturnType<typeof setTimeout> | null = null;
    let stopPreferences: (() => void) | undefined;
    let stopRouteListener: (() => void) | undefined;
    let isUnmounted = false;

    const showToast = (message: string, tone: 'default' | 'error' = 'default') => {
      dispatchPoeEvent('poexd-toast', {
        message,
        tone,
        durationMs: 3000,
      });
    };

    const syncCurrentPageRoute = () => {
      if (typeof window !== 'undefined') {
        currentPageUrl.value = window.location.href || '';
      }
    };

    const currentLeague = computed(() => extractTradeLeagueFromUrl(currentPageUrl.value));

    const flattenedBookmarkFolders = computed(() => getFlattenedFolderTree(bookmarkGroups.value));

    const findMatchedBookmark = (h: HistoryEntry) => {
      if (h.searchRecordId) {
        const byRecordId = bookmarks.value.find(
          (bm) => bm && bm.searchRecordId && bm.searchRecordId === h.searchRecordId,
        );
        if (byRecordId) return byRecordId;
      }
      const cleanHUrl = stripLiveSuffix(h.url);
      return bookmarks.value.find((bm) => bm && stripLiveSuffix(bm.url) === cleanHUrl);
    };

    const isBookmarked = (h: HistoryEntry) => Boolean(findMatchedBookmark(h));

    const getHistoryName = (h: HistoryEntry) => {
      const matched = findMatchedBookmark(h);
      return matched ? matched.name : h.name;
    };

    const isCurrentEntry = (h: HistoryEntry) => isCurrentHistoryEntry(h.url, currentPageUrl.value);

    const getOtherLeague = (h: HistoryEntry) => getOtherLeagueLabel(h.url, currentLeague.value);

    const trimmedSearchQuery = computed(() => searchQuery.value.trim());

    const filteredHistory = computed(() => {
      const query = trimmedSearchQuery.value.toLowerCase();
      if (!query) return history.value;
      return history.value.filter((h) => getHistoryName(h).toLowerCase().includes(query));
    });

    const groupedHistory = computed(() => groupHistoryEntriesByTime(filteredHistory.value));

    const invalidHistoryEntries = computed(() =>
      history.value.filter((h) => isLegacyTradeSearchUrl(h.url)),
    );

    const unbookmarkedHistoryEntries = computed(() =>
      history.value.filter((h) => !isBookmarked(h)),
    );

    const disambiguationEntryIds = computed(() =>
      findDisambiguationEntryIds(filteredHistory.value, getHistoryName, version),
    );

    const getCriteriaHint = (h: HistoryEntry) => {
      if (!disambiguationEntryIds.value.has(h.id)) return '';
      return criteriaHintByUrl[h.url] ?? '';
    };

    watch(
      [filteredHistory, disambiguationEntryIds],
      ([entries, ids]) => {
        for (const entry of entries) {
          if (!ids.has(entry.id)) continue;
          if (entry.url in criteriaHintByUrl || inFlightHintUrls.has(entry.url)) continue;
          inFlightHintUrls.add(entry.url);
          void deriveHistoryCriteriaHint(entry.url, version)
            .then((hint) => {
              if (!isUnmounted) {
                criteriaHintByUrl[entry.url] = hint;
              }
            })
            .finally(() => {
              inFlightHintUrls.delete(entry.url);
            });
        }
      },
      { immediate: true },
    );

    // 單例預覽：點擊切換，同一時間只開一個（見 GLOSSARY.md「Search Preview」）
    const {
      activePreviewData,
      activeRawQuery,
      activeItem: previewHistory,
      anchorEl: previewAnchorEl,
      isOpen: isHistoryPreviewOpen,
      toggle: togglePinnedHistoryPreview,
      close: closeHistoryPreview,
    } = useTradeSearchPreview<HistoryEntry>({
      version,
    });
    const previewSourceName = computed(() =>
      previewHistory.value ? getHistoryName(previewHistory.value) : '',
    );

    const canOpenPreviewSearch = computed(() =>
      Boolean(previewHistory.value && !isLegacyTradeSearchUrl(previewHistory.value.url)),
    );

    const handleOpenPreviewSearch = async (payload: {
      mode: 'current' | 'new-tab';
      modifiedQuery: Record<string, unknown> | null;
    }) => {
      const h = previewHistory.value;
      if (!h) return;
      const targetUrl = await resolveTunedTradeSearchUrl(h.url, payload.modifiedQuery);
      if (!targetUrl) return;
      if (payload.mode === 'current') openHistory(targetUrl);
      else openHistoryNewTab(targetUrl);
    };

    const toggleHistoryPreview = (h: HistoryEntry, event: Event) => {
      togglePinnedHistoryPreview(h, rowAnchorFromEvent(event, '.history-row-item'));
    };

    /** 左鍵點紀錄名稱：依 Preference 開啟搜尋或切換預覽。 */
    const handleHistoryPrimaryClick = (h: HistoryEntry, event: Event) => {
      if (searchEntryClickAction.value === 'preview') {
        toggleHistoryPreview(h, event);
        return;
      }
      openHistory(h.url);
    };

    const domainFeed = createHistoryDomainFeed(
      client,
      version,
      (snapshot) => {
        history.value = snapshot.history;
        enableHistory.value = snapshot.enabled;
      },
      (error) => console.error('[PoeXD] 讀取 Search Record 歷史失敗:', error),
    );

    let stopBookmarkFeed: (() => void) | null = null;

    const refreshBookmarks = async () => {
      const result = await bookmarkClient.readCollection();
      if (result.ok) {
        bookmarks.value = result.value.bookmarks ?? [];
        bookmarkGroups.value = result.value.groups ?? [];
        bookmarksLoaded.value = true;
      }
    };

    const clearPendingUndo = () => {
      if (undoTimer) {
        clearTimeout(undoTimer);
        undoTimer = null;
      }
      pendingUndoEntry.value = null;
    };

    onMounted(async () => {
      syncCurrentPageRoute();
      if (typeof window !== 'undefined') {
        window.addEventListener('popstate', syncCurrentPageRoute);
        stopRouteListener = listenPoeEvent('poexd-history-changed', syncCurrentPageRoute);
      }
      const prefResult = await getPreferences(version);
      if (prefResult.ok) {
        stopPreferences = prefResult.value.subscribe((snapshot) => {
          sidebarPosition.value = snapshot.sidebarPosition;
          searchEntryClickAction.value = snapshot.searchEntryClickAction;
        });
      }
      const initialDomainRead = domainFeed.start();
      stopBookmarkFeed = bookmarkClient.subscribe(() => {
        void refreshBookmarks();
      });
      await refreshBookmarks();
      await initialDomainRead;
    });

    onUnmounted(() => {
      isUnmounted = true;
      clearPendingUndo();
      if (typeof window !== 'undefined') {
        window.removeEventListener('popstate', syncCurrentPageRoute);
      }
      stopRouteListener?.();
      stopRouteListener = undefined;
      stopBookmarkFeed?.();
      domainFeed.stop();
      stopPreferences?.();
      stopPreferences = undefined;
    });

    const setHistoryEnabled = async (enabled: boolean) => {
      enableHistory.value = enabled;
      const outcome = await client.execute({
        type: 'set-history-enabled',
        gameVersion: version,
        enabled,
      });
      await domainFeed.refresh();
      if (!outcome.ok) {
        console.error('[PoeXD] 儲存歷史設定失敗:', outcome.error);
      }
    };

    const saveHistoryToBookmark = async (h: HistoryEntry, explicitGroupId?: string) => {
      if (isLegacyTradeSearchUrl(h.url) || isBookmarked(h)) return;
      let targetGroupId = explicitGroupId;
      if (!targetGroupId) {
        if (bookmarkGroups.value.length > 0) {
          targetGroupId =
            flattenedBookmarkFolders.value[0]?.folder.id ?? bookmarkGroups.value[0].id;
        } else {
          const newGroupId = `group_${Math.random().toString(36).slice(2, 11)}_${Date.now()}`;
          const groupOutcome = await bookmarkClient.putGroup({
            id: newGroupId,
            name: t('bookmark.defaultFolderName'),
            order: 0,
          });
          if (!groupOutcome.ok) {
            showToast(t('history.toast.bookmarkFailed'), 'error');
            return;
          }
          targetGroupId = newGroupId;
        }
      }
      const name = sanitizeBookmarkName(getHistoryName(h), t('injectedControls.unnamedSearch'));
      const existingInGroup = bookmarks.value.filter((bm) => bm.groupId === targetGroupId);
      const order =
        existingInGroup.length > 0 ? Math.max(...existingInGroup.map((bm) => bm.order)) + 1 : 0;
      const outcome = await bookmarkClient.putBookmark({
        id: `bm_${Math.random().toString(36).slice(2, 11)}_${Date.now()}`,
        name,
        groupId: targetGroupId,
        order,
        url: h.url,
        createdAt: Date.now(),
        ...(h.icon && isValidPoeCdnImageUrl(h.icon) ? { coverImageUrl: h.icon } : {}),
      });
      if (!outcome.ok) {
        showToast(t('history.toast.bookmarkFailed'), 'error');
        return;
      }
      await refreshBookmarks();
      showToast(t('bookmark.toast.added', { name }));
    };

    const copyHistoryLink = async (url: string) => {
      if (!url) return;
      try {
        await navigator.clipboard.writeText(url);
        showToast(t('history.toast.copiedLink'));
      } catch {
        showToast(t('history.toast.copyFailed'), 'error');
      }
    };

    const deleteHistory = async (entryId: string) => {
      const target = history.value.find((item) => item.id === entryId);
      const outcome = await client.execute({ type: 'delete-history-entry', entryId });
      await domainFeed.refresh();
      if (!outcome.ok) {
        console.error('[PoeXD] 刪除歷史失敗:', outcome.error);
        return;
      }
      if (target && !isUnmounted) {
        clearPendingUndo();
        pendingUndoEntry.value = { ...target };
        undoTimer = setTimeout(() => {
          pendingUndoEntry.value = null;
          undoTimer = null;
        }, UNDO_TIMEOUT_MS);
      }
    };

    const undoDeleteHistory = async () => {
      const entry = pendingUndoEntry.value;
      if (!entry) return;
      clearPendingUndo();
      const outcome = await client.execute({
        type: 'restore-history-entry',
        entry: {
          ...entry,
          gameVersion: entry.gameVersion ?? version,
        },
      });
      await domainFeed.refresh();
      if (!outcome.ok) {
        console.error('[PoeXD] 復原歷史失敗:', outcome.error);
        showToast(t('history.toast.undoFailed'), 'error');
      }
    };

    const runBulkCleanup = async (
      command: SearchRecordCommand,
      successMessage: string,
      errorLabel: string,
    ) => {
      clearPendingUndo();
      const outcome = await client.execute(command);
      await domainFeed.refresh();
      if (!outcome.ok) {
        console.error(`[PoeXD] ${errorLabel}:`, outcome.error);
        return;
      }
      showToast(successMessage);
    };

    const clearInvalidHistory = async () => {
      const entryIds = invalidHistoryEntries.value.map((h) => h.id);
      if (entryIds.length === 0) return;
      await runBulkCleanup(
        { type: 'delete-history-entries', entryIds },
        t('history.toast.clearedInvalid', { count: entryIds.length }),
        '清除無效歷史失敗',
      );
    };

    const clearUnbookmarkedHistory = async () => {
      if (!bookmarksLoaded.value) return;
      const count = unbookmarkedHistoryEntries.value.length;
      if (count === 0) return;
      const confirmed = await (window as any).poexdConfirm?.(
        t('history.dialog.clearUnbookmarkedConfirm', { count }),
        t('history.dialog.clearUnbookmarkedTitle'),
      );
      if (!confirmed) return;
      await runBulkCleanup(
        { type: 'clear-unbookmarked-history', gameVersion: version },
        t('history.toast.clearedUnbookmarked', { count }),
        '清除未收藏歷史失敗',
      );
    };

    const clearAllHistory = async () => {
      const confirmed = await (window as any).poexdConfirm?.(
        t('history.dialog.clearAllConfirm'),
        t('history.dialog.clearAllTitle'),
      );
      if (!confirmed) return;
      clearPendingUndo();
      const outcome = await client.execute({ type: 'clear-history', gameVersion: version });
      await domainFeed.refresh();
      if (!outcome.ok) console.error('[PoeXD] 清除歷史失敗:', outcome.error);
    };

    // 格式化歷史紀錄時間戳記為相對或精簡時間
    const formatTime = (timestamp?: number | string) => {
      if (!timestamp) return '';
      try {
        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);

        if (diffMins < 1) return t('tools.time.justNow');
        if (diffMins < 60) return t('tools.time.minutesAgo', { count: diffMins });

        const diffHours = Math.floor(diffMins / 60);
        if (diffHours < 24) return t('tools.time.hoursAgo', { count: diffHours });

        const diffDays = Math.floor(diffHours / 24);
        if (diffDays < 7) return t('tools.time.daysAgo', { count: diffDays });

        // 超過 7 天顯示日期
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        const hh = String(date.getHours()).padStart(2, '0');
        const mm = String(date.getMinutes()).padStart(2, '0');
        return `${m}-${d} ${hh}:${mm}`;
      } catch (e) {
        return '';
      }
    };

    const openHistory = (url: string) => {
      if (!url) return;
      window.location.href = url;
    };

    const openHistoryNewTab = (url: string) => {
      if (!url) return;
      window.open(url, '_blank');
    };

    return {
      t,
      isLegacyTradeSearchUrl,
      isLiveTradeSearchUrl,
      getFolderItemIndentLevel,
      history,
      filteredHistory,
      groupedHistory,
      invalidHistoryEntries,
      unbookmarkedHistoryEntries,
      bookmarksLoaded,
      maxHistoryEntries: MAX_HISTORY_ENTRIES,
      searchQuery,
      trimmedSearchQuery,
      enableHistory,
      pendingUndoEntry,
      flattenedBookmarkFolders,
      isBookmarked,
      isCurrentEntry,
      getOtherLeague,
      getCriteriaHint,
      setHistoryEnabled,
      saveHistoryToBookmark,
      copyHistoryLink,
      deleteHistory,
      undoDeleteHistory,
      clearInvalidHistory,
      clearUnbookmarkedHistory,
      clearAllHistory,
      formatTime,
      getHistoryName,
      openHistory,
      openHistoryNewTab,
      sidebarPosition,
      isHistoryPreviewOpen,
      activePreviewData,
      activeRawQuery,
      previewHistory,
      searchEntryClickAction,
      previewAnchorEl,
      previewSourceName,
      canOpenPreviewSearch,
      handleOpenPreviewSearch,
      toggleHistoryPreview,
      closeHistoryPreview,
      handleHistoryPrimaryClick,
    };
  },
});
</script>
