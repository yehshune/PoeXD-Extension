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
            class="cursor-pointer select-none text-[length:var(--pxd-font-secondary)] text-foreground min-w-0 truncate"
            :title="t('history.enableLabel')"
          >
            {{ t('history.enableLabel') }}
          </label>
        </div>
        <Button
          v-if="history.length > 0"
          variant="destructive"
          size="sm"
          class="shrink-0 font-bold"
          :title="t('history.clearAllTitle')"
          @click="clearAllHistory"
        >
          <Trash2 />
          <span class="pxd-toolbar-btn-text ml-1.5 truncate">{{ t('history.clearAllBtn') }}</span>
        </Button>
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
            class="history-row-item group relative flex items-center justify-between rounded-md border border-border bg-card px-[var(--pxd-space-md)] py-[var(--pxd-space-sm)] shadow-sm text-[length:var(--pxd-font-secondary)] transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_50%,var(--card))]"
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
                class="flex size-[var(--control-height-sm)] shrink-0 items-center justify-center border border-border bg-muted"
              >
                <span class="text-[length:var(--pxd-font-micro)] font-bold text-muted-foreground"
                  >?</span
                >
              </div>
              <a
                :href="h.url"
                @click.prevent="handleHistoryPrimaryClick(h, $event)"
                class="min-w-0 flex-1 truncate text-[length:var(--pxd-font-secondary)] text-foreground hover:text-primary no-underline"
                :title="getHistoryName(h)"
              >
                {{ getHistoryName(h) }}
              </a>
              <span
                v-if="isLegacyTradeSearchUrl(h.url)"
                class="legacy-search-badge shrink-0 text-[length:var(--pxd-font-micro)] text-destructive"
                :title="t('history.invalidTooltip')"
                >{{ t('history.invalidBadge') }}</span
              >
              <span class="shrink-0 text-[length:var(--pxd-font-micro)] text-muted-foreground">
                {{ formatTime(h.visitedAt) }}
              </span>
            </div>
            <div
              class="history-row-actions absolute right-[var(--pxd-space-md)] top-1/2 -translate-y-1/2 z-(--pxd-z-raised) bg-inherit pl-[var(--pxd-space-sm)] flex items-center gap-[var(--pxd-space-xs)] opacity-0 pointer-events-none transition-opacity duration-150 ease-out group-hover:opacity-100 group-hover:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto"
            >
              <Button
                v-if="searchEntryClickAction === 'preview'"
                variant="ghost"
                size="icon-sm"
                :title="t('history.row.open')"
                data-test="history-open"
                @click.stop="openHistory(h.url)"
              >
                <ArrowRight />
              </Button>
              <Button
                v-else
                variant="ghost"
                size="icon-sm"
                :title="t('history.row.preview')"
                data-test="history-preview-toggle"
                @click.stop="toggleHistoryPreview(h, $event)"
              >
                <Eye />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                :title="t('history.row.openNewTab')"
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
          @update:open="(open) => !open && closeHistoryPreview()"
        />
      </div>
      <div
        v-else
        class="py-[var(--pxd-space-2xl)] text-center text-[length:var(--pxd-font-caption)] text-muted-foreground"
      >
        {{ enableHistory ? t('history.empty.noHistory') : t('history.empty.stopped') }}
      </div>
    </template>
  </SidebarPane>
</template>

<script lang="ts">
import { computed, defineComponent, ref, onMounted, onUnmounted } from 'vue';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import SidebarPane from './layout/SidebarPane.vue';
import { ArrowRight, ExternalLink, Eye, Trash2, X } from '@lucide/vue';
import { getPoeVersion } from '@/utils/trade-context';
import { createChromeSearchRecordClient } from '@/utils/search-record-messaging';
import type { HistoryEntry } from '@/utils/search-records';
import { createHistoryDomainFeed } from './history-domain-feed';
import { createChromeBookmarkClient } from '@/utils/bookmark-messaging';
import { isLegacyTradeSearchUrl, stripLiveSuffix } from '@/utils/trade-search-identity';
import { getPreferences } from '@/utils/preferences';
import TradeSearchPreviewPopover from './search-preview/TradeSearchPreviewPopover.vue';
import { DEFAULT_PREFERENCES, type SearchEntryClickAction } from '@/utils/preferences-contract';
import { useTradeSearchPreview } from './composables/useTradeSearchPreview';
import { rowAnchorFromEvent, usePinnedPreview } from './composables/usePinnedPreview';
import { t } from '@/utils/i18n';

export default defineComponent({
  name: 'HistoryPane',
  components: {
    SidebarPane,
    Button,
    Checkbox,
    Separator,
    ArrowRight,
    ExternalLink,
    Eye,
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
      previewHistory,
      searchEntryClickAction,
      previewAnchorEl,
      previewSourceName,
      toggleHistoryPreview,
      closeHistoryPreview,
      handleHistoryPrimaryClick,
    };
  },
});
</script>
