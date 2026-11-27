<script setup lang="ts">
import { computed, ref, watch, type PropType } from 'vue';
import { X } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { t, type I18nKey } from '@/utils/i18n';
import type { SimilarSearchDraft } from '@/utils/similar-item-search';
import type { PoeVersion } from '@/utils/trade-context';
import type { SimilarSessionState } from '@/entrypoints/content/logic/similar-search-session';
import SimilarDraftEditor from './SimilarDraftEditor.vue';
import { tabsOf, type SimilarTabView } from './draft-rows';

/**
 * 找相似面板（ADR-0020）：草稿編輯、開始、進度、批次分頁、回到我的搜尋。
 * 狀態都來自工作階段；這裡只把使用者的操作轉成事件。
 */
const props = defineProps({
  state: { type: Object as PropType<SimilarSessionState>, required: true },
  version: { type: String as PropType<PoeVersion>, default: 'poe1' },
  homeKey: { type: String, required: true },
});

const emit = defineEmits<{
  'update-draft': [update: (draft: SimilarSearchDraft) => SimilarSearchDraft];
  start: [];
  activate: [key: string];
  back: [];
  close: [];
}>();

const running = computed(() => props.state.phase === 'running');
const hasResults = computed(() => props.state.batches.length > 0);
/** 開始後收起草稿，使用者可以再展開調整 */
const editorOpen = ref(true);
watch(
  () => props.state.phase,
  (phase) => {
    if (phase === 'running') editorOpen.value = false;
  },
);

const tabs = computed(() => tabsOf(props.state.batches, props.homeKey));

function tabLabel(tab: SimilarTabView): string {
  if (tab.kind === 'relaxed') return t('similarSearch.tab.relaxed', { n: String(tab.index ?? 1) });
  return t(`similarSearch.tab.${tab.kind}` as I18nKey);
}

const statusText = computed(() => {
  const { progress, phase, reason, replaced } = props.state;
  if (replaced) return t('similarSearch.replaced');
  if (phase === 'running' && progress) {
    return t(`similarSearch.progress.${progress.phase}` as I18nKey, {
      search: String(progress.search),
    });
  }
  if (phase !== 'done' || !reason) return '';
  if (!hasResults.value && reason !== 'rate-limited' && reason !== 'error')
    return t('similarSearch.noResults');
  return t(`similarSearch.reason.${reason}` as I18nKey);
});

const statusTone = computed(() =>
  props.state.reason === 'rate-limited' || props.state.reason === 'error'
    ? 'text-destructive'
    : 'text-muted-foreground',
);
</script>

<template>
  <div
    class="flex max-h-[min(70vh,640px)] w-[440px] max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-md border border-border bg-background text-foreground shadow-lg"
    data-similar-panel
    :data-phase="state.phase"
  >
    <header
      class="flex items-center gap-[var(--pxd-space-sm)] border-b border-border px-[var(--pxd-space-md)] py-[var(--pxd-space-sm)]"
    >
      <div class="flex min-w-0 flex-1 flex-col">
        <strong class="text-sm">{{ t('similarSearch.title') }}</strong>
        <span v-if="state.sourceName" class="truncate text-xs text-muted-foreground">{{
          t('similarSearch.source', { name: state.sourceName })
        }}</span>
      </div>
      <Button
        size="icon-sm"
        variant="ghost"
        data-similar-close
        :aria-label="t('similarSearch.close')"
        :title="t('similarSearch.close')"
        @click="emit('close')"
        ><X class="size-4"
      /></Button>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto px-[var(--pxd-space-md)] py-[var(--pxd-space-sm)]">
      <SimilarDraftEditor
        v-if="state.draft && editorOpen"
        :draft="state.draft"
        :version="version"
        :disabled="running"
        @update="(update) => emit('update-draft', update)"
      />
      <p
        v-if="state.dropped.length > 0"
        class="m-0 mt-[var(--pxd-space-sm)] text-xs text-muted-foreground"
        data-similar-dropped
      >
        {{ t('similarSearch.dropped', { count: String(state.dropped.length) }) }}
      </p>
    </div>

    <nav
      v-if="tabs.length > 0"
      class="flex flex-wrap gap-[var(--pxd-space-xs)] border-t border-border px-[var(--pxd-space-md)] py-[var(--pxd-space-sm)]"
      data-similar-tabs
    >
      <Button
        v-for="tab in tabs"
        :key="tab.key"
        size="sm"
        variant="ghost"
        :data-similar-tab="tab.key"
        :aria-pressed="state.activeKey === tab.key"
        @click="emit('activate', tab.key)"
      >
        {{ tabLabel(tab) }}
        <span v-if="tab.total !== undefined" class="ml-1 opacity-70">{{
          t('similarSearch.total', { total: `${tab.total}${tab.inexact ? '+' : ''}` })
        }}</span>
      </Button>
    </nav>

    <footer
      class="flex flex-wrap items-center gap-[var(--pxd-space-sm)] border-t border-border px-[var(--pxd-space-md)] py-[var(--pxd-space-sm)]"
    >
      <span class="min-w-0 flex-1 text-xs" :class="statusTone" data-similar-status>{{
        statusText
      }}</span>
      <Button
        v-if="state.draft && !editorOpen"
        size="sm"
        variant="ghost"
        data-similar-edit
        @click="editorOpen = true"
        >{{ t('similarSearch.editDraft') }}</Button
      >
      <Button
        v-if="hasResults || running"
        size="sm"
        variant="outline"
        data-similar-back
        @click="emit('back')"
        >{{ t('similarSearch.backToMySearch') }}</Button
      >
      <Button
        size="sm"
        data-similar-start
        :disabled="running || !state.draft"
        @click="emit('start')"
        >{{
          hasResults || state.phase === 'done'
            ? t('similarSearch.restart')
            : t('similarSearch.start')
        }}</Button
      >
    </footer>
  </div>
</template>
