<template>
  <div class="flex flex-col min-h-0 flex-1 overflow-hidden">
    <!-- 搜尋輸入框（附清空鈕與鍵盤 ↑↓ / Enter 選取） -->
    <div class="p-[var(--pxd-space-sm)] bg-popover border-b border-border shrink-0">
      <div class="relative flex items-center">
        <Input
          ref="searchInputRef"
          :model-value="searchQuery"
          type="text"
          size="default"
          :placeholder="t('filterPane.dialog.searchPlaceholder')"
          class="w-full pr-8"
          @update:model-value="handleSearchInput"
          @keydown="handleSearchKeydown"
        />
        <Button
          v-if="searchQuery"
          type="button"
          variant="ghost"
          size="icon-sm"
          class="absolute right-1 top-1/2 -translate-y-1/2"
          :title="t('filterPane.search.clearTitle')"
          @click="clearSearch"
        >
          <X />
        </Button>
      </div>
    </div>

    <!-- 類別清單捲動區 -->
    <div
      ref="optionsRootRef"
      class="flex-1 min-h-0 overflow-y-auto p-[var(--pxd-space-md)] pxd-scrollbar pxd-scrollbar-selection"
    >
      <!-- 最近使用快捷列（無搜尋關鍵字時顯示） -->
      <div
        v-if="!searchQuery.trim() && recentOptions.length > 0"
        class="type-group-section mb-[var(--pxd-space-md)] pb-[var(--pxd-space-sm)] border-b border-border/60"
      >
        <div
          class="type-group-title text-[length:var(--pxd-font-caption)] font-bold text-muted-foreground mb-[var(--pxd-space-xs)] border-l-2 border-primary pl-[var(--pxd-space-sm)] uppercase"
        >
          {{ t('filterPane.dialog.recent') }}
        </div>
        <div class="flex flex-wrap gap-[var(--pxd-space-xs)]">
          <Button
            v-for="opt in recentOptions"
            :key="opt.key"
            type="button"
            :variant="opt.key === activeCategory ? 'accent' : 'outline'"
            size="sm"
            class="w-auto truncate font-normal"
            :data-selected="opt.key === activeCategory ? 'true' : undefined"
            :title="opt.fullLabel"
            @click="$emit('select', opt.key)"
          >
            {{ opt.label }}
          </Button>
        </div>
      </div>

      <div
        v-for="group in groupedAvailableTypes"
        :key="group.groupLabel"
        class="type-group-section mb-[var(--pxd-space-md)] last:mb-0"
      >
        <div
          class="type-group-title text-[length:var(--pxd-font-secondary)] font-bold text-foreground mb-[var(--pxd-space-sm)] border-l-2 border-primary pl-[var(--pxd-space-sm)] uppercase"
        >
          {{ group.groupLabel }}
        </div>

        <!-- 橫向排列的多屬性類別行 (例如胸甲、手套等) -->
        <div
          v-if="group.rows && group.rows.length > 0"
          class="type-rows-container flex flex-col gap-[var(--pxd-space-xs)] mb-[var(--pxd-space-sm)] last:mb-0"
        >
          <div
            v-for="(row, rIdx) in group.rows"
            :key="rIdx"
            class="type-row-item flex items-center gap-[var(--pxd-space-sm)] py-[var(--pxd-space-xs)] px-[var(--pxd-space-sm)] bg-card border border-border rounded-[var(--radius-sm)]"
          >
            <!-- 主按鈕 (如: 胸甲) -->
            <div class="main-option-wrapper shrink-0 w-[92px]">
              <Button
                v-if="row.mainOption"
                type="button"
                :variant="row.mainOption.key === activeCategory ? 'accent' : 'outline'"
                size="sm"
                class="w-full truncate font-bold"
                :class="
                  highlightedKey === row.mainOption.key
                    ? 'ring-2 ring-primary ring-offset-1 ring-offset-background'
                    : ''
                "
                :data-selected="row.mainOption.key === activeCategory ? 'true' : undefined"
                :data-highlighted="highlightedKey === row.mainOption.key ? 'true' : undefined"
                :title="row.mainOption.fullLabel"
                @click="$emit('select', row.mainOption.key)"
              >
                {{ row.mainOption.label }}
              </Button>
              <span
                v-else
                class="type-row-fallback-label inline-flex items-center justify-center w-full min-h-[var(--control-height-sm)] text-muted-foreground text-[length:var(--pxd-font-caption)] font-bold border border-dashed border-border box-border bg-muted text-center select-none rounded-[var(--radius)]"
              >
                {{ row.rowLabel }}
              </span>
            </div>

            <!-- 子屬性按鈕列表 (如: 力, 敏, 智, 保護) -->
            <div
              v-if="row.subOptions && row.subOptions.length > 0"
              class="sub-options-wrapper flex flex-wrap gap-[var(--pxd-space-xs)] flex-1"
            >
              <Button
                v-for="subOpt in row.subOptions"
                :key="subOpt.key"
                type="button"
                :variant="subOpt.key === activeCategory ? 'accent' : 'outline'"
                size="sm"
                class="w-auto min-w-[38px] truncate font-normal"
                :class="
                  highlightedKey === subOpt.key
                    ? 'ring-2 ring-primary ring-offset-1 ring-offset-background'
                    : ''
                "
                :data-selected="subOpt.key === activeCategory ? 'true' : undefined"
                :data-highlighted="highlightedKey === subOpt.key ? 'true' : undefined"
                :title="subOpt.fullLabel"
                @click="$emit('select', subOpt.key)"
              >
                {{ subOpt.label }}
              </Button>
            </div>
          </div>
        </div>

        <!-- 單一按鈕的格點排列 -->
        <div
          v-if="group.singleOptions && group.singleOptions.length > 0"
          class="type-buttons-grid grid grid-cols-[repeat(auto-fill,minmax(124px,1fr))] gap-[var(--pxd-space-xs)]"
        >
          <Button
            v-for="opt in group.singleOptions"
            :key="opt.key"
            type="button"
            :variant="opt.key === activeCategory ? 'accent' : 'outline'"
            size="sm"
            class="w-full truncate font-normal"
            :class="
              highlightedKey === opt.key
                ? 'ring-2 ring-primary ring-offset-1 ring-offset-background'
                : ''
            "
            :data-selected="opt.key === activeCategory ? 'true' : undefined"
            :data-highlighted="highlightedKey === opt.key ? 'true' : undefined"
            :title="opt.fullLabel"
            @click="$emit('select', opt.key)"
          >
            {{ opt.label }}
          </Button>
        </div>
      </div>

      <SidebarFilterEmptyState
        v-if="groupedAvailableTypes.length === 0"
        compact
        mode="search"
        class="no-options-found"
        :message="t('filterPane.dialog.empty')"
        :active-filters="
          searchQuery.trim()
            ? [t('common.filterTag.keyword', { query: searchQuery.trim() })]
            : undefined
        "
        :show-reset="Boolean(searchQuery.trim())"
        @reset="clearSearch"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { X } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { t } from '@/utils/i18n';
import SidebarFilterEmptyState from './layout/SidebarFilterEmptyState.vue';

export interface TypeSelectorOption {
  key: string;
  label: string;
  fullLabel: string;
}

export interface TypeSelectorRow {
  rowLabel?: string;
  mainOption?: TypeSelectorOption;
  subOptions?: TypeSelectorOption[];
}

export interface TypeSelectorGroup {
  groupLabel: string;
  rows?: TypeSelectorRow[];
  singleOptions?: TypeSelectorOption[];
}

const props = defineProps<{
  searchQuery: string;
  activeCategory: string;
  groupedAvailableTypes: TypeSelectorGroup[];
  recentOptions: TypeSelectorOption[];
}>();

const emit = defineEmits<{
  (e: 'update:searchQuery', value: string): void;
  (e: 'select', key: string): void;
}>();

const searchInputRef = ref<HTMLInputElement | { $el?: HTMLInputElement } | null>(null);
const optionsRootRef = ref<HTMLElement | null>(null);
const highlightedIndex = ref(0);

const flatVisibleKeys = computed(() => {
  const keys: string[] = [];
  for (const group of props.groupedAvailableTypes) {
    if (group.rows) {
      for (const row of group.rows) {
        if (row.mainOption) keys.push(row.mainOption.key);
        if (row.subOptions) {
          for (const sub of row.subOptions) keys.push(sub.key);
        }
      }
    }
    if (group.singleOptions) {
      for (const opt of group.singleOptions) keys.push(opt.key);
    }
  }
  return keys;
});

const highlightedKey = computed(() => {
  if (!props.searchQuery.trim() && highlightedIndex.value === 0) return null;
  return flatVisibleKeys.value[highlightedIndex.value] ?? null;
});

watch(
  () => props.searchQuery,
  () => {
    highlightedIndex.value = 0;
  },
);

const handleSearchInput = (value: string | number) => {
  emit('update:searchQuery', String(value ?? ''));
};

const clearSearch = () => {
  emit('update:searchQuery', '');
  focusSearchInput();
};

const handleSearchKeydown = (e: KeyboardEvent) => {
  const keys = flatVisibleKeys.value;
  if (keys.length === 0) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    highlightedIndex.value = (highlightedIndex.value + 1) % keys.length;
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    highlightedIndex.value = (highlightedIndex.value - 1 + keys.length) % keys.length;
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const targetKey = keys[highlightedIndex.value] ?? keys[0];
    if (targetKey) {
      emit('select', targetKey);
    }
  }
};

const focusSearchInput = () => {
  const target = searchInputRef.value;
  const inputEl = target instanceof HTMLInputElement ? target : target?.$el;
  inputEl?.focus?.();
};

const scrollToSelected = () => {
  const selectedEl = optionsRootRef.value?.querySelector(
    '[data-selected="true"]',
  ) as HTMLElement | null;
  selectedEl?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
};

defineExpose({
  focusSearchInput,
  scrollToSelected,
  optionsRootRef,
});
</script>
