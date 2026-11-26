<template>
  <div
    data-settings-group="result-mod-highlight-appearance"
    class="flex flex-col gap-[var(--pxd-space-sm)] pl-[var(--pxd-space-lg)]"
  >
    <!-- 模擬 PoE 深色物品詞綴列的即時預覽 -->
    <div
      data-test="result-mod-highlight-preview"
      class="flex flex-col gap-[2px] rounded-sm border border-border/70 px-[var(--pxd-space-sm)] py-[var(--pxd-space-xs)] text-center text-[length:var(--pxd-font-caption)] leading-snug"
      style="background-color: oklch(0.14 0.005 250)"
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
        <button
          v-for="opt in RESULT_MOD_HIGHLIGHT_COLOR_OPTIONS"
          :key="opt.value"
          type="button"
          :aria-pressed="highlightColor === opt.value"
          :data-highlight-color="opt.value"
          :class="[
            'inline-flex cursor-pointer items-center gap-1.5 rounded-sm border px-[var(--pxd-space-sm)] py-[3px] text-[length:var(--pxd-font-caption)] leading-snug transition-colors',
            highlightColor === opt.value
              ? 'border-primary/70 bg-primary/15 font-medium text-foreground'
              : 'border-border/70 bg-card text-muted-foreground hover:bg-muted/60 hover:text-foreground',
          ]"
          @click="handleColorChange(opt.value)"
        >
          <span
            class="size-2.5 shrink-0 rounded-full border border-white/25"
            :style="{ backgroundColor: RESULT_MOD_HIGHLIGHT_PALETTES[opt.value].swatch }"
            aria-hidden="true"
          />
          <span>{{ opt.label }}</span>
        </button>
      </div>
    </SettingsRow>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Button } from '@/components/ui/button';
import SettingsRow from './SettingsRow.vue';
import {
  RESULT_MOD_HIGHLIGHT_COLOR_OPTIONS,
  RESULT_MOD_HIGHLIGHT_STYLE_OPTIONS,
} from './settings-ui-metadata';
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

const previewHighlightStyle = computed(() =>
  getResultModHighlightPreviewStyle(props.highlightStyle, props.highlightColor),
);

const searchKeywords = computed(() => [
  t('settings.resultModHighlight.label'),
  t('settings.resultModHighlight.style.label'),
  t('settings.resultModHighlight.color.label'),
]);

const handleStyleChange = (value: ResultModHighlightStyle) => {
  emit('update:highlightStyle', value);
};

const handleColorChange = (value: ResultModHighlightColor) => {
  emit('update:highlightColor', value);
};
</script>
