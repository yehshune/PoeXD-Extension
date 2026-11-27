<script setup lang="ts">
import { computed, type PropType } from 'vue';
import { SlidersHorizontal } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { t } from '@/utils/i18n';
import {
  DEFAULT_PREFERENCES,
  type BookmarkButtonPosition,
  type SearchEntryClickAction,
} from '@/utils/preferences-contract';
import {
  BOOKMARK_BUTTON_POSITION_OPTIONS,
  SEARCH_ENTRY_CLICK_ACTION_OPTIONS,
} from './settings/settings-ui-metadata';

/** 書籤與歷史面板頂部的就近設定 Popover：各自獨立管理該面板的操作偏好。 */
const props = defineProps({
  scope: {
    type: String as PropType<'bookmark' | 'history'>,
    required: true,
  },
  open: {
    type: Boolean,
    default: undefined,
  },
  addBookmarkBtnPosition: {
    type: String as PropType<BookmarkButtonPosition>,
    default: DEFAULT_PREFERENCES.addBookmarkBtnPosition,
  },
  clickAction: {
    type: String as PropType<SearchEntryClickAction>,
    default: DEFAULT_PREFERENCES.bookmarkClickAction,
  },
});

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
  (e: 'update:addBookmarkBtnPosition', value: BookmarkButtonPosition): void;
  (e: 'update:clickAction', value: SearchEntryClickAction): void;
}>();

const title = computed(() =>
  props.scope === 'bookmark' ? t('bookmark.settings.title') : t('history.settings.title'),
);
const clickActionLabel = computed(() =>
  props.scope === 'bookmark'
    ? t('bookmark.settings.clickActionLabel')
    : t('history.settings.clickActionLabel'),
);

function handleAddBookmarkBtnPositionChange(val?: unknown): void {
  const pos = Array.isArray(val) ? val[0] : val;
  if (pos === 'top' || pos === 'bottom') {
    emit('update:addBookmarkBtnPosition', pos);
  }
}

function handleClickActionChange(val?: unknown): void {
  const action = Array.isArray(val) ? val[0] : val;
  if (action === 'open' || action === 'preview') {
    emit('update:clickAction', action);
  }
}
</script>

<template>
  <Popover :open="open" @update:open="(value: boolean) => emit('update:open', value)">
    <PopoverTrigger as-child>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        class="shrink-0"
        :data-bookmark-settings="scope === 'bookmark' ? '' : undefined"
        :data-history-settings="scope === 'history' ? '' : undefined"
        :title="title"
        :aria-label="title"
        @click.stop
      >
        <SlidersHorizontal />
      </Button>
    </PopoverTrigger>
    <PopoverContent
      align="end"
      :side-offset="6"
      :collision-padding="8"
      :data-bookmark-settings-panel="scope === 'bookmark' ? '' : undefined"
      :data-history-settings-panel="scope === 'history' ? '' : undefined"
      class="flex w-[min(var(--pxd-overlay-inspect-width,300px),calc(100vw-32px))] flex-col gap-[var(--pxd-space-md)] text-[length:var(--pxd-font-secondary)]"
      @click.stop
    >
      <div class="flex items-center justify-between gap-[var(--pxd-space-sm)]">
        <span class="font-semibold text-foreground">{{ title }}</span>
      </div>

      <div v-if="scope === 'bookmark'" class="flex flex-col gap-[var(--pxd-space-xs)]">
        <span class="text-muted-foreground">{{ t('settings.bookmarkBtnPosition.label') }}</span>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          class="w-full"
          data-test="bookmark-btn-position"
          :model-value="addBookmarkBtnPosition"
          @update:model-value="handleAddBookmarkBtnPositionChange"
        >
          <ToggleGroupItem
            v-for="opt in BOOKMARK_BUTTON_POSITION_OPTIONS"
            :key="opt.value"
            :value="opt.value"
            :aria-label="opt.label"
            size="sm"
            class="flex-1"
          >
            {{ opt.label }}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div class="flex flex-col gap-[var(--pxd-space-xs)]">
        <span class="text-muted-foreground">{{ clickActionLabel }}</span>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          class="w-full"
          data-test="search-entry-click-action"
          :model-value="clickAction"
          @update:model-value="handleClickActionChange"
        >
          <ToggleGroupItem
            v-for="opt in SEARCH_ENTRY_CLICK_ACTION_OPTIONS"
            :key="opt.value"
            :value="opt.value"
            :aria-label="opt.label"
            size="sm"
            class="flex-1 px-1 whitespace-nowrap overflow-hidden"
            :title="opt.label"
          >
            <span class="truncate block w-full text-center">{{ opt.label }}</span>
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
    </PopoverContent>
  </Popover>
</template>
