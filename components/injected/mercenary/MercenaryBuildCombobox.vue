<script setup lang="ts">
import { computed, ref } from 'vue';
import { Check, ChevronDown, Search } from '@lucide/vue';
import {
  ComboboxAnchor,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxPortal,
  ComboboxRoot,
  ComboboxTrigger,
  ComboboxViewport,
} from 'reka-ui';
import { t } from '@/utils/i18n';
import type { MercenaryBuildOption } from './useMercenaryPicker';

/** 可輸入搜尋的 Build 下拉；null 代表「不限 Build」。 */
const props = defineProps<{
  options: readonly MercenaryBuildOption[];
  modelValue: number | null;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: number | null] }>();

const ANY_BUILD = -1;
const query = ref('');

const filtered = computed(() => {
  const needle = query.value.trim().toLowerCase();
  if (!needle) return props.options;
  return props.options.filter((option) => option.keywords.some((k) => k.includes(needle)));
});

const selectedName = computed(
  () =>
    props.options.find((o) => o.index === props.modelValue)?.name ?? t('mercenaryPicker.anyBuild'),
);

function onSelect(value: unknown) {
  const index = Number(value);
  emit('update:modelValue', Number.isInteger(index) && index !== ANY_BUILD ? index : null);
  query.value = '';
}

const itemClass =
  'relative flex w-full cursor-default select-none items-center gap-[var(--pxd-space-md)] rounded-sm py-[var(--pxd-space-sm)] pl-[var(--pxd-space-md)] pr-[var(--pxd-space-2xl)] text-[length:var(--pxd-font-body)] outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground';
</script>

<template>
  <ComboboxRoot
    :model-value="modelValue ?? ANY_BUILD"
    ignore-filter
    open-on-click
    reset-search-term-on-blur
    @update:model-value="onSelect"
    @update:open="(open: boolean) => !open && (query = '')"
  >
    <ComboboxAnchor
      class="flex h-[var(--control-height-default)] w-[var(--pxd-mercenary-build-width)] max-w-full items-center gap-[var(--pxd-space-xs)] rounded-md border border-input bg-transparent px-[var(--input-padding-x-default)] text-[length:var(--pxd-font-control)] shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50"
    >
      <Search class="size-[var(--control-icon-sm)] shrink-0 text-muted-foreground" />
      <!-- 輸入框平時是空的、以 placeholder 顯示目前 Build，輸入時直接就是搜尋字 -->
      <ComboboxInput
        v-model="query"
        data-test="mercenary-build"
        class="h-full min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-foreground focus:placeholder:text-muted-foreground"
        :display-value="() => ''"
        :placeholder="selectedName"
        :title="t('mercenaryPicker.buildSearch')"
      />
      <ComboboxTrigger class="flex shrink-0 items-center text-muted-foreground">
        <ChevronDown class="size-[var(--control-icon-sm)]" />
      </ComboboxTrigger>
    </ComboboxAnchor>
    <ComboboxPortal>
      <ComboboxContent
        position="popper"
        :side-offset="4"
        class="z-(--pxd-z-floating) max-h-[var(--pxd-menu-max-height)] w-(--reka-combobox-trigger-width) min-w-[var(--pxd-mercenary-build-width)] overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md"
      >
        <!--
          reka 的 ComboboxInput 失焦時用 document.getElementById / document.activeElement 判斷焦點是否還在選單內，
          在 shadow root 裡兩者都抓不到，按下選項讓輸入框失焦就會被判定為離開而先關閉選單。
          阻止 mousedown 的預設行為讓焦點留在輸入框，click 仍會正常選取。
        -->
        <ComboboxViewport
          class="max-h-[var(--pxd-menu-max-height)] overflow-y-auto p-[var(--pxd-space-xs)] pxd-scrollbar"
          data-test="mercenary-build-options"
          @mousedown.prevent
        >
          <ComboboxEmpty
            class="py-[var(--pxd-space-md)] text-center text-[length:var(--pxd-font-secondary)] text-muted-foreground"
          >
            {{ t('mercenaryPicker.buildEmpty') }}
          </ComboboxEmpty>
          <ComboboxItem v-if="!query.trim()" :value="ANY_BUILD" :class="itemClass">
            {{ t('mercenaryPicker.anyBuild') }}
            <Check
              v-if="modelValue === null"
              class="absolute right-[var(--pxd-space-md)] size-[var(--control-icon-sm)]"
            />
          </ComboboxItem>
          <ComboboxItem
            v-for="option in filtered"
            :key="option.index"
            :value="option.index"
            :class="itemClass"
          >
            {{ option.name }}
            <Check
              v-if="modelValue === option.index"
              class="absolute right-[var(--pxd-space-md)] size-[var(--control-icon-sm)]"
            />
          </ComboboxItem>
        </ComboboxViewport>
      </ComboboxContent>
    </ComboboxPortal>
  </ComboboxRoot>
</template>
