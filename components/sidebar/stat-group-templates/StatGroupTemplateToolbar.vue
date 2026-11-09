<script setup lang="ts">
import { nextTick, ref } from 'vue';
import {
  BookmarkPlus,
  Copy,
  Download,
  MoreVertical,
  Search,
  Trash2,
  Undo2,
  Upload,
  X,
} from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { dispatchPoeEvent } from '@/utils/event-contracts';
import { downloadTextFile } from '@/utils/download-file';
import { t } from '@/utils/i18n';
import type { CriteriaOverlayManager } from '@/components/injected/criteria-overlay-manager';

/**
 * 常用詞綴群組分頁的頂部控制列，排法對齊書籤頁：主要動作、次要動作、搜尋、⋮ 選單。
 */
const props = defineProps<{
  manager: CriteriaOverlayManager;
  /** 目前頁面有官方搜尋表單時才能儲存。 */
  canSave: boolean;
}>();

const query = defineModel<string>('query', { default: '' });

const { templates, canUndo, busy } = props.manager;
const isSearchVisible = ref(false);
const isMenuOpen = ref(false);
const searchInputRef = ref<InstanceType<typeof Input> | null>(null);

function notify(message: string, tone: 'success' | 'error') {
  dispatchPoeEvent('poexd-toast', { message, tone });
}

async function toggleSearch() {
  if (isSearchVisible.value) {
    closeSearch();
    return;
  }
  isSearchVisible.value = true;
  await nextTick();
  (searchInputRef.value?.$el as HTMLInputElement | undefined)?.focus?.();
}

function closeSearch() {
  isSearchVisible.value = false;
  query.value = '';
}

async function copyShareCode() {
  try {
    await navigator.clipboard.writeText(props.manager.exportTemplates());
    notify(
      t('statGroupTemplate.toast.copiedShareCode', { count: templates.value.length }),
      'success',
    );
  } catch (error) {
    console.warn('[PoeXD] 複製常用詞綴群組分享碼失敗:', error);
    notify(t('statGroupTemplate.toast.clipboardFailed'), 'error');
  }
}

function downloadBackup() {
  const date = new Date().toISOString().slice(0, 10);
  downloadTextFile({
    content: props.manager.exportTemplates(),
    filename: `poexd-stat-group-templates-${props.manager.version}-${date}.json`,
    mimeType: 'application/json',
  });
}
</script>

<template>
  <div
    class="flex items-center gap-[var(--pxd-space-sm)] pb-[var(--pxd-space-md)] w-full max-w-full min-w-0"
  >
    <Button
      variant="default"
      size="sm"
      class="min-w-0 flex-1 font-bold"
      data-test="stat-group-template-save-current"
      :title="
        canSave
          ? t('statGroupTemplate.toolbar.saveTitle')
          : t('statGroupTemplate.toolbar.saveDisabledTitle')
      "
      :disabled="busy || !canSave"
      @click="manager.beginSaveTemplate()"
    >
      <BookmarkPlus />
      <span class="pxd-toolbar-btn-text ml-1.5 truncate">{{
        t('statGroupTemplate.toolbar.saveCurrent')
      }}</span>
    </Button>
    <Button
      variant="secondary"
      size="sm"
      class="font-bold shrink-0"
      data-test="stat-group-template-undo"
      :title="t('statGroupTemplate.action.undoTitle')"
      :disabled="busy || !canUndo"
      @click="manager.undo()"
    >
      <Undo2 />
      <span class="pxd-toolbar-btn-text ml-1.5 truncate">{{
        t('statGroupTemplate.action.undo')
      }}</span>
    </Button>
    <Button
      :variant="isSearchVisible ? 'default' : 'secondary'"
      size="icon-sm"
      data-test="stat-group-template-search-toggle"
      :title="
        isSearchVisible
          ? t('bookmark.search.closeTooltip')
          : t('statGroupTemplate.toolbar.searchTooltip')
      "
      @click="toggleSearch"
    >
      <Search />
    </Button>
    <DropdownMenu v-model:open="isMenuOpen">
      <DropdownMenuTrigger as-child>
        <Button
          variant="secondary"
          size="icon-sm"
          :title="t('statGroupTemplate.toolbar.menuTooltip')"
          data-test="stat-group-template-menu"
        >
          <MoreVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent v-if="isMenuOpen" align="end">
        <DropdownMenuItem :disabled="busy" @click="manager.importTemplates()">
          <Upload class="text-muted-foreground" />
          {{ t('statGroupTemplate.toolbar.import') }}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem :disabled="templates.length === 0" @click="copyShareCode">
          <Copy class="text-muted-foreground" />
          {{ t('bookmark.transfer.copyShareCode') }}
        </DropdownMenuItem>
        <DropdownMenuItem :disabled="templates.length === 0" @click="downloadBackup">
          <Download class="text-muted-foreground" />
          {{ t('bookmark.transfer.downloadBackup') }}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          :disabled="busy || templates.length === 0"
          @click="manager.clearTemplates()"
        >
          <Trash2 class="text-destructive" />
          {{ t('statGroupTemplate.toolbar.clearAll') }}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>

  <Separator class="mb-[var(--pxd-space-md)]" />

  <div v-if="isSearchVisible" class="relative mb-[var(--pxd-space-md)] flex items-center">
    <Search
      class="pointer-events-none absolute left-2.5 size-[var(--control-icon-sm,14px)] text-muted-foreground"
    />
    <Input
      ref="searchInputRef"
      v-model="query"
      size="sm"
      :placeholder="t('statGroupTemplate.toolbar.searchPlaceholder')"
      class="w-full pl-8 pr-7"
      data-test="stat-group-template-search"
      @keydown.esc.stop.prevent="closeSearch"
    />
    <Button
      v-if="query"
      variant="ghost"
      size="icon-sm"
      class="absolute right-1"
      :title="t('bookmark.search.clearTooltip')"
      @click="query = ''"
    >
      <X />
    </Button>
  </div>
</template>
