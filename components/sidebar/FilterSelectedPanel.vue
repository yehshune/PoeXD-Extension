<template>
  <!-- 右側已選展示與操作面板 -->
  <div
    class="split-right-panel flex-[2.8] border-l border-border pl-[var(--pxd-space-xl)] flex flex-col min-h-0 bg-background"
  >
    <div
      class="panel-header pb-[var(--pxd-space-md)] border-b border-border mb-[var(--pxd-space-md)]"
    >
      <span
        class="panel-title text-[length:var(--pxd-font-section-title)] font-bold text-foreground tracking-[0.5px]"
        >{{ t('filterPane.selected.title', { count: selectedCount }) }}</span
      >
    </div>

    <div
      class="selected-mods-list pxd-scrollbar flex-1 overflow-y-auto pr-[var(--pxd-space-xs)] mb-[var(--pxd-space-lg)] flex flex-col gap-[var(--pxd-space-sm)]"
    >
      <div
        v-for="group in groupedSelectedMods"
        :key="group.label"
        class="selected-group-section mb-[var(--pxd-space-lg)]"
      >
        <!-- 小區隔大類標題 -->
        <div
          class="selected-group-header text-[length:var(--pxd-font-caption)] font-bold text-muted-foreground py-[2px] px-[var(--pxd-space-sm)] bg-background border-b border-border mb-[var(--pxd-space-xs)] uppercase tracking-[0.5px]"
        >
          {{ group.label }}
        </div>
        <div class="selected-group-items flex flex-col gap-[var(--pxd-space-xs)]">
          <div
            v-for="[key, info] in group.items"
            :key="key"
            class="selected-mod-item flex justify-between items-start bg-card border border-border rounded-[var(--radius)] py-[var(--pxd-space-sm)] px-[var(--pxd-space-md)] gap-[var(--pxd-space-md)]"
          >
            <div
              class="selected-mod-text text-[length:var(--pxd-font-secondary)] text-foreground leading-[1.35] break-all flex-1 cursor-pointer"
              @click="emit('scroll-to-mod', info.id, info.affinities[0])"
              :title="t('filterPane.selected.jumpToMod')"
            >
              <span
                class="selected-mod-tier bg-primary text-primary-foreground text-[length:var(--pxd-font-micro)] font-bold py-[1px] px-[4px] mr-[4px] inline-block align-middle"
                v-if="info.selectedTierIndex !== undefined"
              >
                T{{ getDisplayTier(info.id, info.selectedTierIndex) }}+
              </span>
              <span class="selected-mod-name">
                {{ formatModText(getPendingModLabel(info)) }}
              </span>
              <span
                v-if="!info.officialId && (!info.ids || info.ids.length === 0)"
                class="no-official-id-badge ml-[var(--pxd-space-xs)] inline-flex items-center px-1.5 py-0.5 rounded-[var(--radius-sm)] text-[length:var(--pxd-font-micro)] text-amber-500 bg-amber-500/10 border border-amber-500/25 shrink-0 select-none align-middle"
                :title="t('filterPane.badge.noOfficialIdBatchTitle')"
                data-badge="no-official-id"
              >
                {{ t('modItem.badge.noOfficialId') }}
              </span>
              <span
                class="selected-mod-vals vals-limit-trigger inline-flex items-center px-1.5 py-[1px] rounded-[var(--radius-sm)] border border-border/70 bg-muted/50 text-muted-foreground text-[length:var(--pxd-font-caption)] ml-[var(--pxd-space-xs)] cursor-pointer transition-colors hover:bg-accent hover:text-accent-foreground hover:border-border align-middle"
                v-if="info.mins || info.maxs"
                @click.stop="emit('toggle-max-limit', key)"
                :title="t('filterPane.selected.toggleMaxTitle')"
              >
                {{ getDisplayValues(info) }}
              </span>
            </div>
            <Button
              type="button"
              variant="ghost-destructive"
              size="icon-sm"
              class="shrink-0"
              :title="t('filterPane.selected.removeTitle')"
              data-filter-action="remove-selected"
              @click="emit('remove', key)"
            >
              <X />
            </Button>
          </div>
        </div>
      </div>
      <div
        v-if="selectedCount === 0"
        class="no-selected-placeholder text-muted-foreground text-center mt-[var(--pxd-space-2xl)] px-[var(--pxd-space-md)] flex flex-col gap-[var(--pxd-space-xs)]"
      >
        <span class="text-[length:var(--pxd-font-secondary)] italic">{{
          t('filterPane.selected.empty')
        }}</span>
        <span class="text-[length:var(--pxd-font-caption)] opacity-75 leading-relaxed">{{
          t('filterPane.selected.emptyHint')
        }}</span>
      </div>
    </div>

    <!-- 操作按鈕區 -->
    <div
      class="panel-actions flex flex-col gap-[var(--pxd-space-md)] pt-[var(--pxd-space-md)] border-t border-border"
    >
      <Button
        type="button"
        variant="default"
        size="default"
        class="w-full font-bold"
        :disabled="selectedCount === 0"
        data-filter-action="confirm-selected"
        @click="emit('confirm')"
      >
        {{ t('filterPane.actions.applyBatch', { count: selectedCount }) }}
      </Button>
      <div class="flex w-full gap-[var(--pxd-space-sm)]">
        <Button
          type="button"
          variant="outline"
          size="sm"
          class="flex-1 truncate font-medium"
          :disabled="selectedCount === 0"
          :title="t('filterPane.actions.applyT1Title')"
          data-filter-action="apply-t1"
          @click="emit('apply-t1')"
        >
          {{ t('filterPane.actions.applyT1') }}
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          class="flex-1 truncate font-medium"
          :disabled="selectedCount === 0"
          :title="t('filterPane.actions.clearSelectedTitle')"
          data-filter-action="clear-selected"
          @click="emit('clear')"
        >
          {{ t('filterPane.actions.clearSelected') }}
        </Button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { X } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import type { ModGroup, SelectedModInfo } from './types';
import { t, getActiveUiLocale } from '@/utils/i18n';

export interface SelectedModGroup {
  label: string;
  items: Array<[string, SelectedModInfo]>;
}

const props = defineProps<{
  selectedCount: number;
  groupedSelectedMods: SelectedModGroup[];
  currentTypeGroups: ModGroup[];
}>();

const emit = defineEmits<{
  'scroll-to-mod': [modId: string, affinity: string];
  'toggle-max-limit': [key: string];
  remove: [key: string];
  confirm: [];
  'apply-t1': [];
  clear: [];
}>();

const modById = computed(() => new Map(props.currentTypeGroups.map((m) => [m.id, m])));

const getDisplayTier = (modId: string, tierIndex: number) => {
  const modObj = modById.value.get(modId);
  if (modObj && modObj.tiers) {
    return modObj.tiers.length - tierIndex;
  }
  return tierIndex + 1;
};

const getDisplayValues = (info: SelectedModInfo) => {
  const count = Math.max(info.mins?.length ?? 0, info.maxs?.length ?? 0);
  if (count > 0) {
    const parts: string[] = [];
    for (let i = 0; i < count; i++) {
      const minVal = info.mins?.[i];
      const maxVal = info.maxs?.[i];
      if (minVal && maxVal) {
        parts.push(`${minVal}~${maxVal}`);
      } else if (minVal) {
        parts.push(`≥${minVal}`);
      } else if (maxVal) {
        parts.push(`≤${maxVal}`);
      }
    }
    return parts.join(', ');
  }
  return '';
};

const getPendingModLabel = (info: SelectedModInfo) => {
  const isEnglish = getActiveUiLocale() === 'en';
  const modObj = info.id ? modById.value.get(info.id) : undefined;

  if (isEnglish) {
    return modObj?.key || info.key || '';
  }
  return (
    modObj?.displayTemplate ||
    modObj?.displayKey ||
    modObj?.key ||
    info.displayTemplate ||
    info.displayKey ||
    info.key ||
    ''
  );
};

const formatModText = (text: string) => {
  if (!text) return '';
  return text.replace(/\|\|\|\|\|/g, '\n');
};
</script>
