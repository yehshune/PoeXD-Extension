<script setup lang="ts">
import { onBeforeUnmount, ref, type PropType } from 'vue';
import { ChevronDown } from '@lucide/vue';
import { SelectTrigger } from 'reka-ui';
import { Select, SelectContent, SelectItem } from '@/components/ui/select';
import { t } from '@/utils/i18n';
import {
  toStatDomainKey,
  getStatDomainBadgeLabel,
  getStatDomainStyle,
  STAT_DOMAIN_BADGE_CLASS,
} from '@/utils/stat-domain';
import type { PoeVersion } from '@/utils/trade-context';
import { trackNestedMenuOpen } from './nested-menu-guard';

/**
 * 可切換網域的詞綴標籤：外觀維持微型網域徽章，選單採用與群組類別一致的 Select，
 * 額外屬性（例如 data-*）套在觸發鈕上。
 */
defineOptions({ inheritAttrs: false });

const props = defineProps({
  /** 目前的網域前綴 */
  domain: { type: String, required: true },
  /** 可選的網域前綴（含目前的） */
  domains: { type: Array as PropType<readonly string[]>, required: true },
  disabled: { type: Boolean, default: false },
  version: { type: String as PropType<PoeVersion>, default: 'poe1' },
});

const emit = defineEmits<{ select: [domain: string] }>();

const keyOf = (domain: string) => toStatDomainKey(domain);
const labelOf = (domain: string) => getStatDomainBadgeLabel(keyOf(domain), props.version) ?? domain;

// 選單開著時被卸載（例如外層 Popover 關閉）不會收到關閉事件，自己補上，避免開啟計數卡住
const isOpen = ref(false);
function onOpenChange(open: boolean): void {
  if (open === isOpen.value) return;
  isOpen.value = open;
  trackNestedMenuOpen(open);
}
onBeforeUnmount(() => onOpenChange(false));

function onSelect(value: unknown): void {
  const domain = String(value);
  onOpenChange(false);
  if (domain !== props.domain && props.domains.includes(domain)) emit('select', domain);
}
</script>

<template>
  <Select
    :open="isOpen"
    :model-value="domain"
    :disabled="disabled"
    @update:open="onOpenChange"
    @update:model-value="onSelect"
  >
    <SelectTrigger as-child>
      <button
        type="button"
        v-bind="$attrs"
        :class="[
          STAT_DOMAIN_BADGE_CLASS,
          domain === 'explicit'
            ? 'border-border/50 bg-muted/40 font-normal text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground'
            : 'hover:border-current/35',
          'inline-flex cursor-pointer items-center gap-px transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        ]"
        :style="getStatDomainStyle(keyOf(domain))"
        :data-stat-domain="domain"
        :title="t('pobBuild.mods.domainTitle')"
        :aria-label="t('pobBuild.mods.domainAria', { domain: labelOf(domain) })"
      >
        {{ labelOf(domain) }}
        <ChevronDown class="size-3 shrink-0" aria-hidden="true" />
      </button>
    </SelectTrigger>
    <SelectContent align="start" class="min-w-24">
      <SelectItem
        v-for="option in domains"
        :key="option"
        :value="option"
        data-stat-domain-option
        :data-stat-domain="option"
        :class="option === 'explicit' ? undefined : 'pxd-stat-domain-text'"
        :style="getStatDomainStyle(keyOf(option))"
        @click="onSelect(option)"
      >
        {{ labelOf(option) }}
      </SelectItem>
    </SelectContent>
  </Select>
</template>
