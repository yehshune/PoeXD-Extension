<template>
  <SidebarPane>
    <template #fixed>
      <!-- 歷史紀錄設定區 (啟用勾選框與清除按鈕) -->
      <div
        class="flex items-center justify-between gap-[var(--pxd-space-sm)] pb-[var(--pxd-space-md)] w-full min-w-0"
      >
        <div class="flex items-center gap-[var(--pxd-space-md)] min-w-0 flex-1">
          <Checkbox
            id="enable-history"
            v-model="enableHistory"
            class="shrink-0"
            @update:model-value="saveHistorySettings"
          />
          <label
            for="enable-history"
            class="cursor-pointer select-none text-[length:var(--pxd-font-body)] text-foreground min-w-0 truncate"
            :title="t('history.enableLabel')"
          >
            {{ t('history.enableLabel') }}
          </label>
        </div>
        <!-- 破壞性操作收進選單，避免在最顯眼處誤按 -->
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button
              variant="secondary"
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
      <p
        v-if="!enableHistory"
        class="text-[length:var(--pxd-font-micro)] text-muted-foreground pb-[var(--pxd-space-md)]"
      >
        {{ t('history.stoppedNotice') }}
      </p>

      <Separator class="mb-[var(--pxd-space-md)]" />
    </template>

    <template #scroll>
      <div v-if="history.length > 0" class="flex flex-col gap-[var(--pxd-space-sm)]">
        <template v-for="h in history" :key="h.id">
          <div
            :data-history-id="h.id"
            :class="
              previewHistory?.id === h.id
                ? 'bg-[color-mix(in_srgb,var(--primary)_12%,var(--card))] hover:bg-[color-mix(in_srgb,var(--primary)_15%,var(--card))] shadow-[inset_2px_0_0_var(--primary)]'
                : 'bg-card hover:bg-[color-mix(in_srgb,var(--muted)_40%,var(--card))]'
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
              <a
                :href="h.url"
                @click.prevent="handleHistoryPrimaryClick(h, $event)"
                class="min-w-0 flex-1 truncate text-[length:var(--pxd-font-body)] text-foreground hover:text-primary no-underline"
                :title="getHistoryName(h)"
              >
                {{ getHistoryName(h) }}
              </a>
              <span
                v-if="isLegacyTradeSearchUrl(h.url)"
                class="legacy-search-badge shrink-0 text-[length:var(--pxd-font-micro)] text-destructive"
                :title="t('history.invalidTooltip')"
                >{{ t('common.invalid') }}</span
              >
              <span
                class="shrink-0 text-[length:var(--pxd-font-micro)] text-muted-foreground group-hover:opacity-0"
              >
                {{ formatTime(h.visitedAt) }}
              </span>
            </div>
            <div
              :class="
                previewHistory?.id === h.id
                  ? '[--pxd-hover-overlay-bg:color-mix(in_srgb,var(--primary)_15%,var(--card))]'
                  : undefined
              "
              class="history-row-actions pxd-hover-actions-overlay absolute inset-y-0 right-0 rounded-r-md z-(--pxd-z-raised) pr-[var(--pxd-space-md)] pl-[var(--pxd-space-2xl)] flex items-center gap-[var(--pxd-space-xs)] opacity-0 pointer-events-none transition-opacity duration-150 ease-out group-hover:opacity-100 group-hover:pointer-events-auto"
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
        <!-- 單例預覽（點擊切換，見 CONTEXT.md「Search Preview」） -->
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
import { computed, defineComponent, ref, onMounted, onUnmounted } from 'vue';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import SidebarPane from './layout/SidebarPane.vue';
import SidebarEmptyState from './layout/SidebarEmptyState.vue';
import { ArrowRight, ExternalLink, Eye, History, MoreVertical, Trash2, X } from '@lucide/vue';
import { getPoeVersion } from '@/utils/trade-context';
import { createChromeSearchRecordClient } from '@/utils/search-record-messaging';
import type { HistoryEntry } from '@/utils/search-records';
import { createHistoryDomainFeed } from './history-domain-feed';
import { createChromeBookmarkClient } from '@/utils/bookmark-messaging';
import { isLegacyTradeSearchUrl, stripLiveSuffix } from '@/utils/trade-search-identity';
import { resolveTunedTradeSearchUrl } from '@/utils/trade-query-tuning';
import { getPreferences } from '@/utils/preferences';
import TradeSearchPreviewPopover from './search-preview/TradeSearchPreviewPopover.vue';
import { DEFAULT_PREFERENCES, type SearchEntryClickAction } from '@/utils/preferences-contract';
import { useTradeSearchPreview } from './composables/useTradeSearchPreview';
import { rowAnchorFromEvent, usePinnedPreview } from './composables/usePinnedPreview';
import { t } from '@/utils/i18n';

export default defineComponent({
  name: 'HistoryPane',
  components: {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    MoreVertical,
    SidebarPane,
    SidebarEmptyState,
    Button,
    Checkbox,
    Separator,
    ArrowRight,
    ExternalLink,
    Eye,
    History,
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
    const bookmarks = ref<any[]>([]);
    const sidebarPosition = ref<'left' | 'right'>('left');
    const searchEntryClickAction = ref<SearchEntryClickAction>(
      DEFAULT_PREFERENCES.searchEntryClickAction,
    );
    let stopPreferences: (() => void) | undefined;

    const {
      activePreviewData,
      activeRawQuery,
      loadPreview: loadHistoryPreview,
      clearActivePreview,
    } = useTradeSearchPreview({
      version,
    });

    // 單例預覽：點擊切換，同一時間只開一個（見 CONTEXT.md「Search Preview」）
    const {
      activeItem: previewHistory,
      anchorEl: previewAnchorEl,
      isOpen: isHistoryPreviewOpen,
      toggle: togglePinnedHistoryPreview,
      close: closeHistoryPreview,
    } = usePinnedPreview<HistoryEntry>({
      onOpen: (h) => void loadHistoryPreview(h.id, h.url),
      onClose: (h) => clearActivePreview(h.id),
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
      if (result.ok) bookmarks.value = result.value.bookmarks;
    };

    onMounted(async () => {
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
      stopBookmarkFeed?.();
      domainFeed.stop();
      stopPreferences?.();
      stopPreferences = undefined;
    });

    const saveHistorySettings = async () => {
      const outcome = await client.execute({
        type: 'set-history-enabled',
        gameVersion: version,
        enabled: enableHistory.value,
      });
      await domainFeed.refresh();
      if (!outcome.ok) {
        console.error('[PoeXD] 儲存歷史設定失敗:', outcome.error);
      }
    };

    const deleteHistory = async (entryId: string) => {
      const outcome = await client.execute({ type: 'delete-history-entry', entryId });
      await domainFeed.refresh();
      if (!outcome.ok) console.error('[PoeXD] 刪除歷史失敗:', outcome.error);
    };

    const clearAllHistory = async () => {
      const confirmed = await (window as any).poexdConfirm?.(
        t('history.dialog.clearAllConfirm'),
        t('history.dialog.clearAllTitle'),
      );
      if (!confirmed) return;
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

    const getHistoryName = (h: HistoryEntry) => {
      const cleanHUrl = stripLiveSuffix(h.url);
      const matched = bookmarks.value.find((bm) => bm && stripLiveSuffix(bm.url) === cleanHUrl);
      return matched ? matched.name : h.name;
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
      history,
      enableHistory,
      saveHistorySettings,
      deleteHistory,
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
