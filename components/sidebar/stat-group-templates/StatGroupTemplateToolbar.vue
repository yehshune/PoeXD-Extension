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
import type {
  CriteriaOverlayManager,
  StatGroupTemplateEntry,
} from '@/entrypoints/content/logic/criteria-overlay-manager';
import StatGroupTemplateImportDialog from './StatGroupTemplateImportDialog.vue';

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
const isImportDialogOpen = ref(false);
const searchInputRef = ref<InstanceType<typeof Input> | null>(null);

function openImportDialog() {
  isMenuOpen.value = false;
  isImportDialogOpen.value = true;
}

async function handleImport(payload: { entries: StatGroupTemplateEntry[]; skipped: number }) {
  if (props.manager.importTemplateEntries) {
    await props.manager.importTemplateEntries(payload.entries, payload.skipped);
  }
}

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
      <span class="pxd-toolbar-btn-text truncate">{{
        t('statGroupTemplate.toolbar.saveCurrent')
      }}</span>
    </Button>
    <Button
      variant="outline"
      size="sm"
      class="font-bold shrink-0"
      data-test="stat-group-template-undo"
      :title="t('common.undoLastOverlay')"
      :disabled="busy || !canUndo"
      @click="manager.undo()"
    >
      <Undo2 />
      <span class="pxd-toolbar-btn-text truncate">{{ t('common.undo') }}</span>
    </Button>
    <Button
      :variant="isSearchVisible ? 'default' : 'outline'"
      size="icon-sm"
      class="shrink-0"
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
          variant="outline"
          size="icon-sm"
          class="shrink-0"
          :title="t('statGroupTemplate.toolbar.menuTooltip')"
          data-test="stat-group-template-menu"
        >
          <MoreVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent v-if="isMenuOpen" align="end">
        <DropdownMenuItem
          data-test="stat-group-template-open-import"
          :disabled="busy"
          @click="openImportDialog"
        >
          <Upload class="text-muted-foreground" />
          {{ t('statGroupTemplate.toolbar.import') }}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem :disabled="templates.length === 0" @click="copyShareCode">
          <Copy class="text-muted-foreground" />
          {{ t('bookmarkImport.export.copyCode') }}
        </DropdownMenuItem>
        <DropdownMenuItem :disabled="templates.length === 0" @click="downloadBackup">
          <Download class="text-muted-foreground" />
          {{ t('bookmarkImport.export.downloadBackup') }}
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
      class="pointer-events-none absolute left-[var(--input-padding-x-sm)] size-[var(--control-icon-sm,14px)] text-muted-foreground"
    />
    <Input
      ref="searchInputRef"
      v-model="query"
      size="sm"
      :placeholder="t('statGroupTemplate.toolbar.searchPlaceholder')"
      class="w-full pl-[calc(var(--input-padding-x-sm)+var(--control-icon-sm,14px)+var(--pxd-space-sm))] pr-[calc(var(--control-height-sm)+var(--pxd-space-xs))]"
      data-test="stat-group-template-search"
      @keydown.esc.stop.prevent="closeSearch"
    />
    <Button
      v-if="query"
      variant="ghost"
      size="icon-sm"
      class="absolute right-[var(--pxd-space-xs)]"
      :title="t('common.clearSearch')"
      @click="query = ''"
    >
      <X />
    </Button>
  </div>

  <StatGroupTemplateImportDialog
    v-model:open="isImportDialogOpen"
    :version="manager.version"
    :busy="busy"
    @import="handleImport"
  />
</template>
