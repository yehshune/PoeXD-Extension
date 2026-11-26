<template>
  <div
    v-show="!isSearching || matchesSearch"
    data-settings-group="result-mod-highlight-appearance"
    :data-expanded="isExpanded ? 'true' : 'false'"
    class="flex flex-col gap-[var(--pxd-space-sm)] pl-[var(--pxd-space-lg)]"
  >
    <button
      type="button"
      data-test="result-mod-highlight-toggle"
      :aria-expanded="isExpanded"
      class="flex w-full cursor-pointer select-none items-center justify-between gap-[var(--pxd-space-sm)] rounded-md border-0 bg-transparent px-0 py-[var(--pxd-space-xs)] text-left text-[length:var(--pxd-font-secondary)] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      @click="toggleExpanded"
    >
      <span class="min-w-0 truncate">{{ t('settings.resultModHighlight.appearance.toggle') }}</span>
      <span class="flex shrink-0 items-center gap-[var(--pxd-space-xs)]">
        <span
          class="size-2.5 shrink-0 rounded-full border border-border/80"
          :style="{ backgroundColor: activeColorSwatch }"
          aria-hidden="true"
        />
        <span
          data-test="result-mod-highlight-summary"
          class="text-[length:var(--pxd-font-caption)] font-normal text-muted-foreground"
        >
          {{ activeStyleLabel }} · {{ activeColorLabel }}
        </span>
        <ChevronDown
          :class="[
            'size-[var(--control-icon-sm,14px)] shrink-0 transition-transform duration-200',
            isExpanded ? '' : '-rotate-90',
          ]"
          aria-hidden="true"
        />
      </span>
    </button>

    <div
      v-show="isExpanded"
      data-test="result-mod-highlight-body"
      class="flex flex-col gap-[var(--pxd-space-sm)]"
    >
      <!-- 模擬 PoE 深色物品詞綴列的即時預覽，並可一鍵在官方頁面浮出完整示意結果列協作預覽 -->
      <div
        data-test="result-mod-highlight-preview"
        class="flex flex-col gap-[var(--pxd-space-xs)] rounded-sm border border-border/70 p-[var(--pxd-space-xs)]"
        style="background-color: oklch(0.14 0.005 250)"
      >
        <div
          class="flex flex-col gap-[2px] text-center text-[length:var(--pxd-font-caption)] leading-snug"
        >
          <div class="px-1.5 py-0.5 opacity-80" style="color: oklch(0.68 0.12 268)">
            {{ t('settings.resultModHighlight.previewNormal') }}
          </div>
          <div
            data-test="result-mod-highlight-preview-mod"
            class="transition-all duration-150"
            :style="[previewHighlightStyle, { color: 'oklch(0.73 0.12 268)' }]"
          >
            {{ t('settings.resultModHighlight.previewMatched') }}
          </div>
        </div>
        <div class="flex justify-end">
          <Button
            type="button"
            :variant="isPagePreviewOpen ? 'secondary' : 'outline'"
            size="sm"
            data-test="result-mod-highlight-page-preview"
            :aria-pressed="isPagePreviewOpen"
            @click="togglePagePreview"
          >
            <EyeOff v-if="isPagePreviewOpen" />
            <Eye v-else />
            {{
              isPagePreviewOpen
                ? t('settings.resultModHighlight.closePagePreview')
                : t('settings.resultModHighlight.openPagePreview')
            }}
          </Button>
        </div>
      </div>

      <SettingsRow
        :label="t('settings.resultModHighlight.style.label')"
        :keywords="searchKeywords"
        layout="stack"
      >
        <div
          role="group"
          :aria-label="t('settings.resultModHighlight.style.label')"
          data-test="result-mod-highlight-style"
          class="flex flex-wrap gap-[var(--pxd-space-xs)]"
        >
          <Button
            v-for="opt in RESULT_MOD_HIGHLIGHT_STYLE_OPTIONS"
            :key="opt.value"
            type="button"
            :variant="highlightStyle === opt.value ? 'default' : 'outline'"
            size="sm"
            :aria-pressed="highlightStyle === opt.value"
            :data-highlight-style="opt.value"
            class="flex-1"
            @click="handleStyleChange(opt.value)"
          >
            {{ opt.label }}
          </Button>
        </div>
      </SettingsRow>

      <SettingsRow
        :label="t('settings.resultModHighlight.color.label')"
        :keywords="searchKeywords"
        layout="stack"
      >
        <div
          role="group"
          :aria-label="t('settings.resultModHighlight.color.label')"
          data-test="result-mod-highlight-color"
          class="flex flex-wrap gap-[var(--pxd-space-xs)]"
        >
          <Button
            v-for="opt in RESULT_MOD_HIGHLIGHT_COLOR_OPTIONS"
            :key="opt.value"
            type="button"
            size="sm"
            :variant="highlightColor === opt.value ? 'default' : 'outline'"
            :aria-pressed="highlightColor === opt.value"
            :data-highlight-color="opt.value"
            @click="handleColorChange(opt.value)"
          >
            <span
              class="size-2.5 shrink-0 rounded-full border border-white/25"
              :style="{ backgroundColor: RESULT_MOD_HIGHLIGHT_PALETTES[opt.value].swatch }"
              aria-hidden="true"
            />
            <span>{{ opt.label }}</span>
          </Button>
        </div>
      </SettingsRow>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { ChevronDown, Eye, EyeOff } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import SettingsRow from './SettingsRow.vue';
import { matchesSettingsQuery, useSettingsSearchQuery } from './settings-search';
import {
  RESULT_MOD_HIGHLIGHT_COLOR_OPTIONS,
  RESULT_MOD_HIGHLIGHT_STYLE_OPTIONS,
} from './settings-ui-metadata';
import { usePageGuide } from '../page-guide/usePageGuide';
import { t } from '@/utils/i18n';
import type {
  ResultModHighlightColor,
  ResultModHighlightStyle,
} from '@/utils/preferences-contract';
import {
  RESULT_MOD_HIGHLIGHT_PALETTES,
  getResultModHighlightPreviewStyle,
} from '@/utils/result-mod-highlight';

const props = defineProps<{
  highlightStyle: ResultModHighlightStyle;
  highlightColor: ResultModHighlightColor;
}>();

const emit = defineEmits<{
  'update:highlightStyle': [value: ResultModHighlightStyle];
  'update:highlightColor': [value: ResultModHighlightColor];
}>();

const expanded = ref(false);
const { query, isSearching } = useSettingsSearchQuery();

const previewHighlightStyle = computed(() =>
  getResultModHighlightPreviewStyle(props.highlightStyle, props.highlightColor),
);

const activeStyleLabel = computed(
  () =>
    RESULT_MOD_HIGHLIGHT_STYLE_OPTIONS.find((opt) => opt.value === props.highlightStyle)?.label ??
    '',
);

const activeColorLabel = computed(
  () =>
    RESULT_MOD_HIGHLIGHT_COLOR_OPTIONS.find((opt) => opt.value === props.highlightColor)?.label ??
    '',
);

const activeColorSwatch = computed(
  () => RESULT_MOD_HIGHLIGHT_PALETTES[props.highlightColor].swatch,
);

const searchKeywords = computed(() => [
  t('settings.resultModHighlight.label'),
  t('settings.resultModHighlight.appearance.toggle'),
  t('settings.resultModHighlight.style.label'),
  t('settings.resultModHighlight.color.label'),
  ...RESULT_MOD_HIGHLIGHT_STYLE_OPTIONS.map((opt) => opt.label),
  ...RESULT_MOD_HIGHLIGHT_COLOR_OPTIONS.map((opt) => opt.label),
]);

const matchesSearch = computed(() => {
  if (!isSearching.value) return false;
  return matchesSettingsQuery(query.value, [
    t('settings.section.resultDisplay'),
    ...searchKeywords.value,
  ]);
});

const isExpanded = computed(() => expanded.value || matchesSearch.value);

const guide = usePageGuide();
const isPagePreviewOpen = computed(
  () => guide.state.mode === 'preview' && guide.state.demoFocus === 'mods',
);

const toggleExpanded = () => {
  expanded.value = !expanded.value;
  if (!expanded.value && isPagePreviewOpen.value) {
    guide.closeResultPreview();
  }
};

const togglePagePreview = () => {
  if (isPagePreviewOpen.value) guide.closeResultPreview();
  else guide.openResultPreview('mods');
};

onBeforeUnmount(() => {
  guide.closeResultPreview();
});

const handleStyleChange = (value: ResultModHighlightStyle) => {
  emit('update:highlightStyle', value);
};

const handleColorChange = (value: ResultModHighlightColor) => {
  emit('update:highlightColor', value);
};
</script>
