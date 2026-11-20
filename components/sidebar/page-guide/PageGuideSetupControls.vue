<script setup lang="ts">
import { PanelLeft, PanelRight, RotateCcw } from '@lucide/vue';
import { computed } from 'vue';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { t } from '@/utils/i18n';
import {
  FONT_SIZE_MODES,
  FONT_SIZE_SCALE_BOUNDS,
  SIDEBAR_POSITIONS,
  SIDEBAR_SIZES,
  type DisplayLocalePreference,
} from '@/utils/preferences-contract';
import type { PageGuideDemoFocus, PageGuideSetupKind } from './page-guide-tour';
import {
  PAGE_GUIDE_LOCALE_CHOICES,
  RESULT_FEATURE_TOGGLES,
  type PageGuideSetupBindings,
} from './page-guide-setup';

const props = defineProps<{
  kind: PageGuideSetupKind;
  bindings: PageGuideSetupBindings;
  /** 目前步驟 ID（供 demo-replay 重播對應步驟示範） */
  stepId?: string;
  /** result-features 步驟要列出哪一組開關 */
  focus?: PageGuideDemoFocus;
}>();

const POSITION_ICONS = { left: PanelLeft, right: PanelRight } as const;
const FONT_PERCENT = {
  min: Math.round(FONT_SIZE_SCALE_BOUNDS.min * 100),
  max: Math.round(FONT_SIZE_SCALE_BOUNDS.max * 100),
};

const fontPercent = computed(() => Math.round(props.bindings.fontSizeScale * 100));
const featureToggles = computed(() => (props.focus ? RESULT_FEATURE_TOGGLES[props.focus] : []));
const selectedLocaleLabel = computed(() => {
  const found = PAGE_GUIDE_LOCALE_CHOICES.find((c) => c.value === props.bindings.displayLocale);
  return found?.nativeLabel ?? t('settings.displayLocale.option.auto');
});
const isZhCnPreview = computed(() => {
  const loc = props.bindings.displayLocale;
  if (loc === 'zh-CN') return true;
  if (loc === 'zh-TW' || loc === 'en') return false;
  return typeof navigator !== 'undefined' && /^zh[-_](cn|hans|sg)/i.test(navigator.language);
});
const previewDropdownText = computed(() => {
  const en = t('pageGuide.setup.marketTranslation.previewStatEn');
  if (!props.bindings.marketTranslation) return en;
  const zh = isZhCnPreview.value
    ? '+# 最大生命'
    : t('pageGuide.setup.marketTranslation.previewStatZh');
  return props.bindings.marketTranslationBilingual ? `${zh} (${en})` : zh;
});
const previewResultZhText = computed(() =>
  isZhCnPreview.value
    ? '附加 20 至 31 冰霜伤害'
    : t('pageGuide.setup.marketTranslation.previewModZh'),
);
const previewResultEnText = computed(() => t('pageGuide.setup.marketTranslation.previewModEn'));

function onFontRange(event: Event) {
  const value = Number((event.target as HTMLInputElement).value);
  if (Number.isFinite(value)) props.bindings.setFontSizeScale(value / 100);
}

const segmentClass = 'grid gap-[var(--pxd-space-xs)]';
const rowLabelClass = 'text-[length:var(--pxd-font-secondary)] font-medium text-muted-foreground';
</script>

<template>
  <div
    data-page-guide-setup
    :data-setup-kind="kind"
    class="flex flex-col gap-[var(--pxd-space-sm)]"
  >
    <div
      v-if="kind === 'locale'"
      class="flex items-center justify-between gap-[var(--pxd-space-md)]"
    >
      <span class="text-[length:var(--pxd-font-secondary)] font-medium text-foreground">
        {{ t('settings.displayLocale.label') }}
      </span>
      <Select
        :model-value="bindings.displayLocale"
        @update:model-value="(value) => bindings.setDisplayLocale(value as DisplayLocalePreference)"
      >
        <SelectTrigger
          size="default"
          class="w-[164px] shrink-0"
          :aria-label="t('settings.displayLocale.label')"
          data-setup-locale-trigger
        >
          <SelectValue>{{ selectedLocaleLabel }}</SelectValue>
        </SelectTrigger>
        <SelectContent layer="guide">
          <SelectItem
            v-for="choice in PAGE_GUIDE_LOCALE_CHOICES"
            :key="choice.value"
            :value="choice.value"
            :data-setup-locale="choice.value"
          >
            {{ choice.nativeLabel ?? t('settings.displayLocale.option.auto') }}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>

    <div v-else-if="kind === 'market-translation'" class="flex flex-col gap-[var(--pxd-space-sm)]">
      <div class="flex items-center gap-[var(--pxd-space-md)]">
        <Checkbox
          id="page-guide-market-translation"
          :model-value="bindings.marketTranslation"
          data-setup-action="market-translation"
          @update:model-value="(value) => bindings.setMarketTranslation(value === true)"
        />
        <label
          for="page-guide-market-translation"
          class="cursor-pointer select-none text-[length:var(--pxd-font-secondary)] text-foreground"
        >
          {{ t('pageGuide.setup.marketTranslation.label') }}
        </label>
      </div>

      <div
        v-if="bindings.marketTranslation"
        data-setup-group="market-translation-bilingual"
        class="ml-[7px] flex flex-col gap-[var(--pxd-space-xs)] border-l border-border/70 pl-[var(--pxd-space-md)]"
      >
        <div class="flex items-center justify-between gap-[var(--pxd-space-md)]">
          <label
            for="page-guide-market-bilingual"
            class="cursor-pointer select-none text-[length:var(--pxd-font-secondary)] text-foreground"
          >
            {{ t('pageGuide.setup.marketTranslation.bilingual') }}
          </label>
          <Switch
            id="page-guide-market-bilingual"
            :model-value="bindings.marketTranslationBilingual"
            data-setup-action="market-translation-bilingual"
            @update:model-value="(value: boolean) => bindings.setMarketTranslationBilingual(value)"
          />
        </div>
        <div class="flex items-center justify-between gap-[var(--pxd-space-md)]">
          <label
            for="page-guide-market-result-bilingual"
            class="cursor-pointer select-none text-[length:var(--pxd-font-secondary)] text-foreground"
          >
            {{ t('pageGuide.setup.marketTranslation.resultBilingual') }}
          </label>
          <Switch
            id="page-guide-market-result-bilingual"
            :model-value="bindings.marketTranslationResultBilingual"
            data-setup-action="market-translation-result-bilingual"
            @update:model-value="
              (value: boolean) => bindings.setMarketTranslationResultBilingual(value)
            "
          />
        </div>
      </div>

      <!-- 即時效果預覽：依開關組合顯示篩選下拉與結果列詞綴 -->
      <div
        data-setup-preview="market-translation"
        class="mt-[var(--pxd-space-xs)] flex flex-col gap-[var(--pxd-space-xs)] rounded-sm border border-border/80 bg-muted/40 p-[var(--pxd-space-md)] text-[length:var(--pxd-font-secondary)]"
      >
        <span class="font-medium text-muted-foreground">
          {{ t('pageGuide.setup.marketTranslation.previewLabel') }}
        </span>
        <div class="flex items-baseline gap-[var(--pxd-space-xs)]">
          <span
            class="shrink-0 rounded bg-background px-1 py-0.5 text-[length:var(--pxd-font-micro)] text-muted-foreground"
          >
            {{ t('pageGuide.setup.marketTranslation.previewDropdownTag') }}
          </span>
          <span class="min-w-0 break-words text-foreground">{{ previewDropdownText }}</span>
        </div>
        <div class="flex items-start gap-[var(--pxd-space-xs)]">
          <span
            class="mt-0.5 shrink-0 rounded bg-background px-1 py-0.5 text-[length:var(--pxd-font-micro)] text-muted-foreground"
          >
            {{ t('pageGuide.setup.marketTranslation.previewResultTag') }}
          </span>
          <div class="flex min-w-0 flex-col">
            <span class="text-foreground">
              {{ bindings.marketTranslation ? previewResultZhText : previewResultEnText }}
            </span>
            <span
              v-if="bindings.marketTranslation && bindings.marketTranslationResultBilingual"
              data-setup-preview-en
              class="text-[0.9em] leading-tight text-muted-foreground/75"
            >
              {{ previewResultEnText }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <template v-else-if="kind === 'appearance'">
      <span :class="rowLabelClass">{{ t('settings.sidebarPosition.label') }}</span>
      <div
        role="radiogroup"
        :aria-label="t('settings.sidebarPosition.label')"
        :class="[segmentClass, 'grid-cols-2']"
      >
        <Button
          v-for="position in SIDEBAR_POSITIONS"
          :key="position"
          type="button"
          size="sm"
          role="radio"
          :variant="bindings.sidebarPosition === position ? 'default' : 'outline'"
          :aria-checked="bindings.sidebarPosition === position"
          :data-setup-position="position"
          @click="bindings.setSidebarPosition(position)"
        >
          <component :is="POSITION_ICONS[position]" />
          {{ t(`settings.sidebarPosition.option.${position}`) }}
        </Button>
      </div>

      <span :class="rowLabelClass">{{ t('settings.sidebarSize.label') }}</span>
      <div
        role="radiogroup"
        :aria-label="t('settings.sidebarSize.label')"
        :class="[segmentClass, 'grid-cols-4']"
      >
        <Button
          v-for="size in SIDEBAR_SIZES"
          :key="size"
          type="button"
          size="sm"
          role="radio"
          :variant="bindings.sidebarSize === size ? 'default' : 'outline'"
          :aria-checked="bindings.sidebarSize === size"
          :data-setup-size="size"
          @click="bindings.setSidebarSize(size)"
        >
          {{ t(`settings.sidebarSize.option.${size}`) }}
        </Button>
      </div>
      <p
        v-if="bindings.sidebarSize === 'custom'"
        data-setup-hint="custom-width"
        class="m-0 text-[length:var(--pxd-font-caption)] text-primary"
      >
        {{ t('pageGuide.setup.customWidthHint') }}
      </p>

      <span :class="rowLabelClass">
        {{ t('settings.fontSize.label', { percent: fontPercent }) }}
      </span>
      <div
        role="radiogroup"
        :aria-label="t('settings.fontSize.label', { percent: fontPercent })"
        :class="[segmentClass, 'grid-cols-4']"
      >
        <Button
          v-for="mode in FONT_SIZE_MODES"
          :key="mode"
          type="button"
          size="sm"
          role="radio"
          :variant="bindings.fontSizeMode === mode ? 'default' : 'outline'"
          :aria-checked="bindings.fontSizeMode === mode"
          :data-setup-font="mode"
          @click="bindings.setFontSizeMode(mode)"
        >
          {{ t(`settings.fontSize.option.${mode}`) }}
        </Button>
      </div>
      <input
        v-if="bindings.fontSizeMode === 'custom'"
        type="range"
        data-setup-font-range
        class="w-full accent-primary"
        :min="FONT_PERCENT.min"
        :max="FONT_PERCENT.max"
        step="5"
        :value="fontPercent"
        :aria-label="t('settings.fontSize.option.custom')"
        @input="onFontRange"
      />
    </template>

    <Button
      v-else-if="kind === 'collapse-drag' || kind === 'demo-replay'"
      type="button"
      size="sm"
      variant="outline"
      class="self-start"
      :data-setup-action="kind === 'collapse-drag' ? 'replay-collapse-demo' : 'replay-step-demo'"
      :disabled="Boolean(bindings.demoPlaying || bindings.demoCursor !== null)"
      @click="
        kind === 'collapse-drag'
          ? bindings.replayCollapseDemo()
          : bindings.replayStepDemo?.(stepId ?? '')
      "
    >
      <RotateCcw />
      {{ t('pageGuide.setup.collapse.replay') }}
    </Button>

    <ul
      v-else-if="kind === 'result-features'"
      class="m-0 flex list-none flex-col gap-[var(--pxd-space-xs)] p-0"
    >
      <li
        v-for="toggle in featureToggles"
        :key="toggle.key"
        class="flex items-center justify-between gap-[var(--pxd-space-md)] text-[length:var(--pxd-font-secondary)]"
      >
        <label :for="`page-guide-feature-${toggle.key}`" class="cursor-pointer select-none">
          {{ t(toggle.labelKey) }}
        </label>
        <Switch
          :id="`page-guide-feature-${toggle.key}`"
          :model-value="bindings.resultFeatures[toggle.key]"
          :data-setup-feature="toggle.key"
          @update:model-value="(value: boolean) => bindings.setResultFeature(toggle.key, value)"
        />
      </li>
    </ul>

    <div
      v-if="kind === 'market-translation' && bindings.reloadRequired"
      class="text-[length:var(--pxd-font-caption)] text-muted-foreground"
    >
      {{ t('pageGuide.setup.reloadAtEnd') }}
    </div>
  </div>
</template>
