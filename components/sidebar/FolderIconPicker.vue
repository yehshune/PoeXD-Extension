<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RotateCcw } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { getActiveDisplayLocale, t } from '@/utils/i18n';
import type { PoeVersion } from '@/utils/trade-context';
import {
  FOLDER_COLORS,
  FOLDER_LUCIDE_ICONS,
  getFolderIconLabel,
  getFolderImageIcons,
  normalizeFolderColor,
  normalizeFolderIcon,
  resolveFolderImageUrl,
  type FolderIconPickerTab,
} from '@/utils/folder-icons';
import FolderIcon from './FolderIcon.vue';

const props = defineProps<{
  open: boolean;
  gameVersion: PoeVersion;
  icon?: string;
  color?: string;
}>();

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
  (e: 'select', payload: { icon?: string; color?: string }): void;
}>();

const locale = computed(() => getActiveDisplayLocale());

const activeTab = ref<FolderIconPickerTab>('class');

const normalizedIcon = computed(() => normalizeFolderIcon(props.icon));
const normalizedColor = computed(() => normalizeFolderColor(props.color));

const classIcons = computed(() => getFolderImageIcons('class', props.gameVersion));
const squareTabIcons = computed(() =>
  activeTab.value === 'item'
    ? getFolderImageIcons('item', props.gameVersion)
    : getFolderImageIcons('atlas', props.gameVersion),
);

const tabs = computed<Array<{ id: FolderIconPickerTab; label: string }>>(() => [
  { id: 'class', label: t('bookmark.folderIcon.tabClass') },
  { id: 'item', label: t('bookmark.folderIcon.tabItem') },
  { id: 'atlas', label: t('bookmark.folderIcon.tabAtlas') },
  { id: 'general', label: t('bookmark.folderIcon.tabGeneral') },
]);

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    const current = normalizedIcon.value;
    if (!current) {
      activeTab.value = normalizedColor.value ? 'general' : 'class';
    } else if (current.startsWith('poe1:') || current.startsWith('poe2:')) {
      activeTab.value = 'class';
    } else if (current.startsWith('item:')) {
      activeTab.value = 'item';
    } else if (current.startsWith('atlas:')) {
      activeTab.value = 'atlas';
    } else {
      activeTab.value = 'general';
    }
  },
);

const selectIcon = (iconId: string | undefined) => {
  emit('select', { icon: iconId, color: normalizedColor.value });
  emit('update:open', false);
};

const selectColor = (colorId: string | undefined) => {
  // 選擇顏色時若目前是彩色圖片圖示，改回預設資料夾讓顏色可見；Lucide 圖示則保留
  const nextIcon = normalizedIcon.value?.startsWith('lucide:') ? normalizedIcon.value : undefined;
  emit('select', { icon: nextIcon, color: colorId });
};

const resetAppearance = () => {
  emit('select', { icon: undefined, color: undefined });
  emit('update:open', false);
};
</script>

<template>
  <Popover :open="open" @update:open="emit('update:open', $event)">
    <PopoverTrigger as-child>
      <slot />
    </PopoverTrigger>
    <PopoverContent
      align="start"
      :side-offset="6"
      class="w-[min(var(--pxd-folder-icon-picker-width,368px),calc(100vw-32px))] text-[length:var(--pxd-font-secondary)]"
      @click.stop
    >
      <div class="flex flex-col gap-[var(--pxd-space-md)]">
        <!-- 分類頁籤 -->
        <div
          role="tablist"
          class="grid grid-cols-4 gap-[var(--pxd-space-xs)] rounded-md bg-muted/60 p-[var(--pxd-space-xs)]"
        >
          <button
            v-for="tab in tabs"
            :key="tab.id"
            type="button"
            role="tab"
            :aria-selected="activeTab === tab.id"
            class="rounded-sm px-[var(--pxd-space-sm)] py-[var(--pxd-space-xs)] text-[length:var(--pxd-font-caption)] font-medium transition-colors truncate"
            :class="
              activeTab === tab.id
                ? 'bg-background text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            "
            @click="activeTab = tab.id"
          >
            {{ tab.label }}
          </button>
        </div>

        <!-- 職業與昇華（寬版頭像） -->
        <div
          v-if="activeTab === 'class'"
          class="pxd-scrollbar grid h-[var(--pxd-folder-icon-picker-panel-height,264px)] content-start grid-cols-4 gap-[var(--pxd-space-sm)] overflow-y-auto pr-[var(--pxd-space-xs)]"
        >
          <button
            v-for="entry in classIcons"
            :key="entry.id"
            type="button"
            class="flex flex-col items-center justify-center rounded-md border p-[var(--pxd-space-xs)] transition-colors hover:bg-muted/70"
            :class="
              normalizedIcon === entry.id
                ? 'border-primary bg-primary/10 ring-1 ring-primary'
                : 'border-border/50 bg-card/50'
            "
            :title="getFolderIconLabel(entry.labels, locale)"
            @click="selectIcon(entry.id)"
          >
            <img
              :src="resolveFolderImageUrl(entry.file)"
              class="h-[var(--pxd-folder-icon-picker-wide-height,45px)] w-[var(--pxd-folder-icon-picker-wide-width,60px)] rounded-xs object-cover"
              :alt="getFolderIconLabel(entry.labels, locale)"
              loading="lazy"
            />
            <span
              class="mt-[var(--pxd-space-xs)] w-full truncate text-center text-[length:var(--pxd-font-micro)] text-muted-foreground"
            >
              {{ getFolderIconLabel(entry.labels, locale) }}
            </span>
          </button>
        </div>

        <!-- 通貨與裝備 / 輿圖與機制（共用 5 欄方形圖片網格） -->
        <div
          v-else-if="activeTab === 'item' || activeTab === 'atlas'"
          class="pxd-scrollbar grid h-[var(--pxd-folder-icon-picker-panel-height,264px)] content-start grid-cols-5 gap-[var(--pxd-space-sm)] overflow-y-auto pr-[var(--pxd-space-xs)]"
        >
          <button
            v-for="entry in squareTabIcons"
            :key="entry.id"
            type="button"
            class="flex aspect-square items-center justify-center rounded-md border p-1.5 transition-colors hover:bg-muted/70"
            :class="
              normalizedIcon === entry.id
                ? 'border-primary bg-primary/10 ring-1 ring-primary'
                : 'border-border/50 bg-card/50'
            "
            :title="getFolderIconLabel(entry.labels, locale)"
            @click="selectIcon(entry.id)"
          >
            <img
              :src="resolveFolderImageUrl(entry.file)"
              class="size-full object-contain"
              :alt="getFolderIconLabel(entry.labels, locale)"
              loading="lazy"
            />
          </button>
        </div>

        <!-- 通用：資料夾顏色 + Lucide 圖示 -->
        <div
          v-else
          class="pxd-scrollbar flex h-[var(--pxd-folder-icon-picker-panel-height,264px)] flex-col gap-[var(--pxd-space-md)] overflow-y-auto pr-[var(--pxd-space-xs)]"
        >
          <div>
            <div
              class="mb-[var(--pxd-space-sm)] text-[length:var(--pxd-font-caption)] font-medium text-muted-foreground"
            >
              {{ t('bookmark.folderIcon.colorLabel') }}
            </div>
            <div class="flex flex-wrap items-center gap-[var(--pxd-space-sm)]">
              <button
                type="button"
                class="flex size-[var(--pxd-folder-icon-picker-swatch-size,26px)] items-center justify-center rounded-full border text-[length:var(--pxd-font-secondary)] transition-transform hover:scale-105"
                :class="
                  !normalizedColor
                    ? 'border-primary ring-1 ring-primary bg-muted text-foreground'
                    : 'border-border bg-muted/60 text-muted-foreground'
                "
                :title="t('bookmark.folderIcon.defaultColor')"
                @click="selectColor(undefined)"
              >
                ×
              </button>
              <button
                v-for="c in FOLDER_COLORS"
                :key="c.id"
                type="button"
                class="size-[var(--pxd-folder-icon-picker-swatch-size,26px)] rounded-full border transition-transform hover:scale-105"
                :style="{ backgroundColor: c.swatch }"
                :class="
                  normalizedColor === c.id
                    ? 'border-foreground ring-2 ring-primary ring-offset-1 ring-offset-popover'
                    : 'border-black/20'
                "
                :title="getFolderIconLabel(c.labels, locale)"
                @click="selectColor(c.id)"
              />
            </div>
          </div>

          <div>
            <div
              class="mb-[var(--pxd-space-sm)] text-[length:var(--pxd-font-caption)] font-medium text-muted-foreground"
            >
              {{ t('bookmark.folderIcon.symbolLabel') }}
            </div>
            <div class="grid grid-cols-6 gap-[var(--pxd-space-sm)]">
              <button
                v-for="entry in FOLDER_LUCIDE_ICONS"
                :key="entry.id"
                type="button"
                class="flex aspect-square items-center justify-center rounded-md border transition-colors hover:bg-muted/70"
                :class="
                  normalizedIcon === entry.id
                    ? 'border-primary bg-primary/10 ring-1 ring-primary'
                    : 'border-border/50 bg-card/50'
                "
                :title="getFolderIconLabel(entry.labels, locale)"
                @click="selectIcon(entry.id)"
              >
                <FolderIcon :icon="entry.id" :color="normalizedColor" size="lg" />
              </button>
            </div>
          </div>
        </div>

        <!-- 底部重設 -->
        <div
          class="flex items-center justify-between border-t border-border/60 pt-[var(--pxd-space-sm)]"
        >
          <span class="text-[length:var(--pxd-font-caption)] text-muted-foreground">
            {{ t('bookmark.folderIcon.hint') }}
          </span>
          <Button
            variant="ghost"
            size="sm"
            :class="{ invisible: !normalizedIcon && !normalizedColor }"
            :disabled="!normalizedIcon && !normalizedColor"
            @click="resetAppearance"
          >
            <RotateCcw />
            {{ t('bookmark.folderIcon.reset') }}
          </Button>
        </div>
      </div>
    </PopoverContent>
  </Popover>
</template>
