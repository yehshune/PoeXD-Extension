<script setup lang="ts">
import { onBeforeUnmount, type PropType } from 'vue';
import { ChevronDown } from '@lucide/vue';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
 * 可切換網域的詞綴標籤：外觀與網域徽章相同，點開選單直接選擇前綴。
 * 根節點是無外框的 DropdownMenu，額外屬性（例如 data-*）套在觸發鈕上。
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
let isOpen = false;
function onOpenChange(open: boolean): void {
  if (open === isOpen) return;
  isOpen = open;
  trackNestedMenuOpen(open);
}
onBeforeUnmount(() => onOpenChange(false));

function onSelect(value: unknown): void {
  const domain = String(value);
  if (domain !== props.domain && props.domains.includes(domain)) emit('select', domain);
}
</script>

<template>
  <DropdownMenu @update:open="onOpenChange">
    <DropdownMenuTrigger as-child :disabled="disabled">
      <button
        type="button"
        v-bind="$attrs"
        :class="[
          STAT_DOMAIN_BADGE_CLASS,
          'inline-flex cursor-pointer items-center gap-px bg-transparent hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50',
        ]"
        :style="getStatDomainStyle(keyOf(domain))"
        :data-stat-domain="domain"
        :title="t('pobBuild.mods.domainTitle')"
        :aria-label="t('pobBuild.mods.domainAria', { domain: labelOf(domain) })"
      >
        {{ labelOf(domain) }}
        <ChevronDown class="size-3 shrink-0" aria-hidden="true" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start">
      <DropdownMenuRadioGroup :model-value="domain" @update:model-value="onSelect">
        <DropdownMenuRadioItem
          v-for="option in domains"
          :key="option"
          :value="option"
          data-stat-domain-option
          :data-stat-domain="option"
          :class="option === 'explicit' ? undefined : 'pxd-stat-domain-text'"
          :style="getStatDomainStyle(keyOf(option))"
        >
          {{ labelOf(option) }}
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
