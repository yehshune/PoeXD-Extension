<script setup lang="ts">
import { computed, type PropType } from 'vue';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { t } from '@/utils/i18n';
import {
  extractStatDomain,
  getStatDomainBadgeLabel,
  getStatDomainStyle,
  shouldShowStatDomainBadge,
  STAT_DOMAIN_BADGE_CLASS,
} from '@/utils/stat-domain';
import type { PoeVersion } from '@/utils/trade-context';
import StatDomainMenu from '../stat-domain/StatDomainMenu.vue';
import { PREVIEW_BOUND_INPUT_CLASS, PREVIEW_STAT_ROW_CLASS } from './preview-classes';

export type PreviewStatBound = 'min' | 'max';
export interface PreviewStatBounds {
  min?: number | string;
  max?: number | string;
}

/**
 * 物品預覽的一列詞綴（PoB 物品預覽、書籤／歷史搜尋預覽共用）：勾選、網域標籤（可切換時為
 * 選單）、詞綴文字與下限／上限。兩邊各自把資料轉成這些 props，事件再轉回各自的調整方式。
 * 額外屬性（例如 data-*）套在列的根元素上。
 */
const props = defineProps({
  /** 網域前綴（`explicit`、`fractured`…）；決定標籤與顏色 */
  domain: { type: String as PropType<string | null>, default: null },
  /** 可切換的網域前綴（含目前的）；兩種以上時標籤變成選單 */
  domains: { type: Array as PropType<readonly string[]>, default: () => [] },
  domainDisabled: { type: Boolean, default: false },
  version: { type: String as PropType<PoeVersion>, default: 'poe1' },
  lines: { type: Array as PropType<readonly string[]>, required: true },
  /** 滑過詞綴文字時的提示（例如市集代碼） */
  title: { type: String, default: undefined },
  /** 長句換行顯示（PoB 詞綴）；否則每行截斷 */
  wrap: { type: Boolean, default: false },
  /** 是否帶入搜尋；undefined 表示這一列不能勾選 */
  checked: { type: Boolean as PropType<boolean | undefined>, default: undefined },
  /** 不能勾選時保留勾選框的空間，讓文字對齊 */
  reserveToggle: { type: Boolean, default: false },
  toggleDisabled: { type: Boolean, default: false },
  toggleAriaLabel: { type: String, default: undefined },
  /** 可編輯的下限／上限；null 表示不能改 */
  bounds: { type: Object as PropType<PreviewStatBounds | null>, default: null },
  boundsDisabled: { type: Boolean, default: false },
  /** 不能編輯時顯示的範圍文字 */
  rangeText: { type: String, default: '' },
  /** 未帶入搜尋時淡化 */
  dimmed: { type: Boolean, default: false },
});

const emit = defineEmits<{
  toggle: [checked: boolean];
  'select-domain': [domain: string];
  'commit-bound': [bound: PreviewStatBound, value: number | null];
}>();

const BOUNDS: readonly PreviewStatBound[] = ['min', 'max'];

const domainKey = computed(() => (props.domain ? extractStatDomain(`${props.domain}.x`) : null));
const canSwitchDomain = computed(() => props.domains.length > 1 && Boolean(props.domain));
const badgeLabel = computed(() =>
  shouldShowStatDomainBadge(domainKey.value)
    ? getStatDomainBadgeLabel(domainKey.value, props.version)
    : null,
);
const textClass = computed(() =>
  shouldShowStatDomainBadge(domainKey.value) ? 'pxd-stat-domain-text' : 'text-foreground',
);

function commitBound(bound: PreviewStatBound, event: Event): void {
  const raw = (event.target as HTMLInputElement).value.trim();
  if (raw === '') {
    emit('commit-bound', bound, null);
    return;
  }
  const value = Number(raw);
  if (Number.isFinite(value)) emit('commit-bound', bound, value);
}

function blurTarget(event: Event): void {
  (event.target as HTMLInputElement).blur();
}
</script>

<template>
  <div
    class="preview-stat-row"
    :class="[PREVIEW_STAT_ROW_CLASS, dimmed ? 'opacity-60' : '']"
    :data-stat-domain="domain ?? undefined"
    :data-searched="checked === undefined ? undefined : checked ? 'true' : 'false'"
    :style="getStatDomainStyle(domainKey)"
  >
    <div class="flex min-w-0 flex-1 items-center gap-[var(--pxd-space-sm)]">
      <Checkbox
        v-if="checked !== undefined"
        data-stat-toggle
        :model-value="checked"
        :disabled="toggleDisabled"
        :aria-label="toggleAriaLabel ?? lines.join(' ')"
        @update:model-value="(value) => emit('toggle', value === true)"
      />
      <span
        v-else-if="reserveToggle"
        class="size-[var(--checkbox-size,18px)] shrink-0"
        aria-hidden="true"
      />
      <StatDomainMenu
        v-if="canSwitchDomain"
        data-stat-domain-trigger
        :domain="domain!"
        :domains="domains"
        :version="version"
        :disabled="domainDisabled"
        @select="(value) => emit('select-domain', value)"
      />
      <span
        v-else-if="badgeLabel"
        :class="['stat-domain-badge', STAT_DOMAIN_BADGE_CLASS]"
        :data-stat-domain="domain ?? undefined"
        >{{ badgeLabel }}</span
      >
      <span class="stat-name flex min-w-0 flex-1 flex-col" :class="textClass" :title="title">
        <span
          v-for="(line, index) in lines"
          :key="index"
          class="stat-line"
          :class="wrap ? 'break-words' : 'truncate'"
          >{{ line }}</span
        >
      </span>
    </div>
    <span v-if="bounds" class="inline-flex shrink-0 items-center gap-[var(--pxd-space-xs)]">
      <Input
        v-for="bound in BOUNDS"
        :key="bound"
        size="sm"
        type="number"
        inputmode="decimal"
        step="any"
        data-stat-bound
        :data-bound="bound"
        :class="PREVIEW_BOUND_INPUT_CLASS"
        :model-value="bounds[bound] ?? ''"
        :placeholder="
          t(bound === 'min' ? 'tierDropdown.minPlaceholder' : 'tierDropdown.maxPlaceholder')
        "
        :disabled="boundsDisabled"
        :aria-label="
          t(bound === 'min' ? 'tierDropdown.minPlaceholder' : 'tierDropdown.maxPlaceholder')
        "
        @change="commitBound(bound, $event)"
        @keydown.enter.prevent="blurTarget"
      />
    </span>
    <span v-else-if="rangeText" class="stat-range shrink-0 font-mono text-foreground">{{
      rangeText
    }}</span>
  </div>
</template>
