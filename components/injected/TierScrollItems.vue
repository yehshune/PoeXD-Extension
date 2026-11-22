<script setup lang="ts">
import { t } from '@/utils/i18n';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import {
  getTierParts,
  getTierValues,
  parseTierTagParts,
  type TierDropdownItemSpec,
} from '@/utils/tier-slot-registry';

defineProps<{
  items: TierDropdownItemSpec[];
  isTierSelected: (item: TierDropdownItemSpec) => boolean;
}>();

const emit = defineEmits<{
  toggleTier: [item: TierDropdownItemSpec];
  selectTier: [item: TierDropdownItemSpec, mode: 'min' | 'both' | 'max'];
}>();
</script>

<template>
  <div
    class="flex-1 min-h-0 overflow-y-auto pxd-scrollbar flex flex-col gap-[var(--pxd-space-xs)] p-0.5 pr-1.5"
  >
    <template v-for="item in items" :key="item.id">
      <!-- 一般靜態狀態列 (例如無可用類別提示，繼承一般 menu item 尺寸) -->
      <DropdownMenuItem
        v-if="item.type === 'header'"
        size="sm"
        disabled
        class="shrink-0 justify-center cursor-default text-muted-foreground data-[disabled]:opacity-90 font-normal select-none"
      >
        {{ item.label }}
      </DropdownMenuItem>

      <!-- Tier 資料項目 (統一為 [階級標籤] + [最小] [~] [最大] 三段式按鈕組) -->
      <div
        v-else-if="item.type === 'tier'"
        data-slot="tier-row"
        role="button"
        tabindex="0"
        class="shrink-0 flex items-center justify-between gap-[var(--pxd-space-xs)] px-[var(--pxd-space-xs)] py-0.5 rounded border transition-colors group cursor-pointer focus-visible:ring-1 focus-visible:ring-primary focus-visible:outline-hidden"
        :class="[
          isTierSelected(item)
            ? 'bg-primary/15 border-primary/50'
            : 'border-transparent hover:bg-accent/50',
        ]"
        @click="emit('toggleTier', item)"
        @keydown.enter.prevent="emit('toggleTier', item)"
        @keydown.space.prevent="emit('toggleTier', item)"
      >
        <!-- 1. 階級與等級 (左側區域為點擊熱區，固定欄寬垂直對齊，點選切換範圍選取並即時連動套用) -->
        <div class="flex-1 min-w-0 flex items-center">
          <div
            v-if="getTierParts(item).tag"
            data-tier-action="tune"
            class="inline-flex items-baseline font-mono transition-colors select-none px-[var(--pxd-space-xs)] py-0.5 text-left whitespace-nowrap"
            :class="
              isTierSelected(item)
                ? 'text-primary font-bold'
                : 'text-muted-foreground font-medium group-hover:text-foreground'
            "
            :title="
              getTierValues(item).min || getTierValues(item).max
                ? t('tierDropdown.rangeSelectTitle', {
                    min: getTierValues(item).min,
                    max: getTierValues(item).max,
                  })
                : t('tierDropdown.tierSelectTitle')
            "
          >
            <template v-if="parseTierTagParts(getTierParts(item).tag).level">
              <span
                class="inline-block w-[30px] shrink-0 text-[length:var(--pxd-font-secondary)]"
                :class="
                  isTierSelected(item)
                    ? 'text-primary font-bold'
                    : 'text-foreground/90 font-medium group-hover:text-foreground'
                "
                >{{ parseTierTagParts(getTierParts(item).tag).tier }}</span
              >{{ ' '
              }}<span
                class="text-[length:var(--pxd-font-caption)]"
                :class="
                  isTierSelected(item)
                    ? 'text-primary/80'
                    : 'text-muted-foreground/80 group-hover:text-muted-foreground'
                "
                >{{ parseTierTagParts(getTierParts(item).tag).level }}</span
              >
            </template>
            <span v-else class="text-[length:var(--pxd-font-secondary)]">{{
              getTierParts(item).tag
            }}</span>
          </div>
          <div
            v-else
            data-tier-action="tune"
            class="text-[length:var(--pxd-font-secondary)] font-mono font-medium text-foreground select-none px-[var(--pxd-space-xs)] py-0.5"
          >
            {{ item.label }}
          </div>
        </div>

        <!-- 2. 三段式數值按鈕組: [ 最小 ] [ ~ ] [ 最大 ] (原生按鈕，阻止冒泡以獨立快捷套用) -->
        <div
          v-if="getTierValues(item).min || getTierValues(item).max"
          class="inline-flex items-center ml-auto shrink-0 select-none font-mono text-[length:var(--pxd-font-secondary)]"
          @click.stop
        >
          <div
            class="inline-flex items-center rounded border border-border/70 bg-muted/20 overflow-hidden divide-x divide-border/50 shadow-xs"
          >
            <!-- 左側小值按鈕 (填入最小值) -->
            <button
              type="button"
              data-tier-action="min"
              class="h-[24px] min-w-[46px] px-[var(--pxd-space-xs)] py-0 cursor-pointer justify-center text-center font-mono hover:bg-accent hover:text-accent-foreground text-foreground select-none transition-colors focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary focus-visible:outline-hidden"
              :title="t('tierDropdown.fillMinTitle', { min: getTierValues(item).min })"
              @click="emit('selectTier', item, 'min')"
            >
              {{ getTierValues(item).min }}
            </button>

            <!-- 中間波浪號按鈕 (填入最大與最小) -->
            <button
              type="button"
              data-tier-action="both"
              class="h-[24px] w-[32px] px-[var(--pxd-space-xs)] py-0 cursor-pointer justify-center text-center font-mono font-bold bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground select-none transition-colors focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary focus-visible:outline-hidden"
              :title="
                t('tierDropdown.fillBothTitle', {
                  min: getTierValues(item).min,
                  max: getTierValues(item).max,
                })
              "
              @click="emit('selectTier', item, 'both')"
            >
              ~
            </button>

            <!-- 右側大值按鈕 (填入最大值) -->
            <button
              type="button"
              data-tier-action="max"
              class="h-[24px] min-w-[46px] px-[var(--pxd-space-xs)] py-0 cursor-pointer justify-center text-center font-mono text-muted-foreground hover:bg-accent hover:text-accent-foreground select-none transition-colors focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary focus-visible:outline-hidden"
              :title="t('tierDropdown.fillMaxTitle', { max: getTierValues(item).max })"
              @click="emit('selectTier', item, 'max')"
            >
              {{ getTierValues(item).max }}
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
