<script setup lang="ts">
import { computed } from 'vue';
import { FilterX, RotateCcw, SearchX } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { t } from '@/utils/i18n';
import SidebarEmptyState from './SidebarEmptyState.vue';

const props = withDefaults(
  defineProps<{
    message: string;
    /** 目前生效的篩選條件標籤；有值時會自動組成「目前篩選：…」提示。 */
    activeFilters?: readonly string[];
    /** 未提供 activeFilters 時的補充說明文字。 */
    hint?: string;
    /** 退回按鈕文字；未提供時依 icon 預設為「清除搜尋」或「重設篩選」。 */
    actionLabel?: string;
    /** 預設 'filter'（多條件篩選），純關鍵字搜尋可改用 'search'。 */
    icon?: 'filter' | 'search';
    /** 緊湊模式，適用於次級選擇器或折疊面板。 */
    compact?: boolean;
    /** 是否顯示退回按鈕（極少數無可重設條件時可關閉）。 */
    showReset?: boolean;
  }>(),
  {
    activeFilters: undefined,
    hint: undefined,
    actionLabel: undefined,
    icon: 'filter',
    compact: false,
    showReset: true,
  },
);

const emit = defineEmits<{
  reset: [];
}>();

const resolvedHint = computed(() => {
  const filters = (props.activeFilters ?? []).filter((item) => item.trim().length > 0);
  if (filters.length > 0) {
    return t('common.activeFiltersHint', { filters: filters.join(' · ') });
  }
  return props.hint;
});

const resolvedActionLabel = computed(
  () =>
    props.actionLabel ??
    (props.icon === 'search' ? t('common.clearSearch') : t('common.resetFilters')),
);
</script>

<template>
  <SidebarEmptyState :message="message" :hint="resolvedHint" :compact="compact">
    <template #icon>
      <SearchX v-if="icon === 'search'" />
      <FilterX v-else />
    </template>
    <template v-if="showReset || $slots.actions" #actions>
      <Button
        v-if="showReset"
        type="button"
        variant="outline"
        size="sm"
        data-filter-empty-reset
        @click="emit('reset')"
      >
        <RotateCcw />
        <span>{{ resolvedActionLabel }}</span>
      </Button>
      <slot name="actions" />
    </template>
  </SidebarEmptyState>
</template>
