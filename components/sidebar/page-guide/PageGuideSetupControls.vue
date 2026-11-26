<script setup lang="ts">
import { PanelLeft, PanelRight, RotateCcw } from '@lucide/vue';
import { computed } from 'vue';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import FontSizeScaleControl from '@/components/sidebar/settings/FontSizeScaleControl.vue';
import {
  RESULT_MOD_HIGHLIGHT_COLOR_OPTIONS,
  RESULT_MOD_HIGHLIGHT_STYLE_OPTIONS,
} from '@/components/sidebar/settings/settings-ui-metadata';
import { t } from '@/utils/i18n';
import { resolvePreferredChineseLocale } from '@/utils/locale-resolution';
import { SIDEBAR_POSITIONS, type DisplayLocalePreference } from '@/utils/preferences-contract';
import { RESULT_MOD_HIGHLIGHT_PALETTES } from '@/utils/result-mod-highlight';
import type { PageGuideDemoFocus, PageGuideSetupKind } from './page-guide-tour';
import { PAGE_GUIDE_LOCALE_CHOICES, RESULT_FEATURE_TOGGLES } from './page-guide-setup';
import { usePageGuide, type PageGuideSession } from './usePageGuide';

const props = defineProps<{
  kind: PageGuideSetupKind;
  /** 測試可注入隔離的 PageGuideSession；正式環境預設使用共用單例 */
  guide?: PageGuideSession;
  /** 目前步驟 ID（供 demo-replay 重播對應步驟示範） */
  stepId?: string;
  /** result-features 步驟要列出哪一組開關 */
  focus?: PageGuideDemoFocus;
}>();

const guide = props.guide ?? usePageGuide();
const setup = computed(() => guide.setup);

const POSITION_ICONS = { left: PanelLeft, right: PanelRight } as const;

const featureToggles = computed(() => (props.focus ? RESULT_FEATURE_TOGGLES[props.focus] : []));
const selectedLocaleLabel = computed(() => {
  const found = PAGE_GUIDE_LOCALE_CHOICES.find((c) => c.value === setup.value.displayLocale);
  return found?.nativeLabel ?? t('settings.displayLocale.option.auto');
});
const previewLocale = computed<'zh-TW' | 'zh-CN'>(() => {
  const loc = setup.value.displayLocale;
  if (loc === 'zh-CN' || loc === 'zh-TW') return loc;
  return resolvePreferredChineseLocale();
});
const previewDropdownText = computed(() => {
  const en = t('pageGuide.setup.marketTranslation.previewStatEn');
  if (!setup.value.marketTranslation) return en;
  const zh = t('pageGuide.setup.marketTranslation.previewStatZh', undefined, previewLocale.value);
  return setup.value.marketTranslationBilingual ? `${zh} (${en})` : zh;
});
const previewResultZhText = computed(() =>
  t('pageGuide.setup.marketTranslation.previewModZh', undefined, previewLocale.value),
);
const previewResultEnText = computed(() => t('pageGuide.setup.marketTranslation.previewModEn'));

const isDemoPlaying = computed(() =>
  Boolean(setup.value.demoPlaying || setup.value.demoCursor !== null),
);

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
        :model-value="setup.displayLocale"
        @update:model-value="
          (value) => void guide.setDisplayLocale(value as DisplayLocalePreference)
        "
      >
        <SelectTrigger
          size="default"
          class="w-[164px] shrink-0"
          :aria-label="t('settings.displayLocale.label')"
          data-setup-locale-trigger
        >
          <SelectValue>{{ selectedLocaleLabel }}</SelectValue>
        </SelectTrigger>
        <SelectContent class="z-(--pxd-z-guide-floating)">
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
      <div class="flex items-center justify-between gap-[var(--pxd-space-md)]">
        <label
          for="page-guide-market-translation"
          class="cursor-pointer select-none text-[length:var(--pxd-font-secondary)] font-medium text-foreground"
        >
          {{ t('pageGuide.setup.marketTranslation.label') }}
        </label>
        <Switch
          id="page-guide-market-translation"
          :model-value="setup.marketTranslation"
          data-setup-action="market-translation"
          @update:model-value="(value: boolean) => void guide.setMarketTranslation(value)"
        />
      </div>

      <div
        v-if="setup.marketTranslation"
        data-setup-group="market-translation-bilingual"
        class="ml-[var(--pxd-space-sm)] flex flex-col gap-[var(--pxd-space-xs)] border-l border-border/70 pl-[var(--pxd-space-md)]"
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
            :model-value="setup.marketTranslationBilingual"
            data-setup-action="market-translation-bilingual"
            @update:model-value="
              (value: boolean) => void guide.setMarketTranslationBilingual(value)
            "
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
            :model-value="setup.marketTranslationResultBilingual"
            data-setup-action="market-translation-result-bilingual"
            @update:model-value="
              (value: boolean) => void guide.setMarketTranslationResultBilingual(value)
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
              {{ setup.marketTranslation ? previewResultZhText : previewResultEnText }}
            </span>
            <span
              v-if="setup.marketTranslation && setup.marketTranslationResultBilingual"
              data-setup-preview-en
              class="text-[length:var(--pxd-font-caption)] leading-tight text-muted-foreground/75"
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
          :variant="setup.sidebarPosition === position ? 'default' : 'outline'"
          :aria-checked="setup.sidebarPosition === position"
          :data-setup-position="position"
          @click="void guide.setSidebarPosition(position)"
        >
          <component :is="POSITION_ICONS[position]" />
          {{ t(`settings.sidebarPosition.option.${position}`) }}
        </Button>
      </div>

      <div class="flex items-center justify-between gap-[var(--pxd-space-md)]">
        <span :class="rowLabelClass">{{ t('settings.fontSize.label') }}</span>
        <FontSizeScaleControl
          :scale="setup.fontSizeScale"
          in-guide
          @update:scale="(scale) => void guide.setFontSizeScale(scale)"
        />
      </div>

      <div class="flex items-center justify-between gap-[var(--pxd-space-md)]">
        <label
          for="page-guide-compact-density"
          :class="[rowLabelClass, 'cursor-pointer select-none']"
        >
          {{ t('settings.density.compactLabel') }}
        </label>
        <Switch
          id="page-guide-compact-density"
          :model-value="setup.compactDensity"
          data-setup-action="compact-density"
          @update:model-value="(value: boolean) => void guide.setCompactDensity(value)"
        />
      </div>

      <div class="flex items-center justify-between gap-[var(--pxd-space-md)]">
        <label
          for="page-guide-pure-background"
          :class="[rowLabelClass, 'cursor-pointer select-none']"
        >
          {{ t('settings.pureBackground.label') }}
        </label>
        <Switch
          id="page-guide-pure-background"
          :model-value="setup.enablePureBackground"
          data-setup-action="pure-background"
          @update:model-value="(value: boolean) => void guide.setEnablePureBackground(value)"
        />
      </div>
    </template>

    <Button
      v-else-if="kind === 'collapse-drag' || kind === 'demo-replay'"
      type="button"
      size="sm"
      variant="outline"
      class="self-start"
      :data-setup-action="kind === 'collapse-drag' ? 'replay-collapse-demo' : 'replay-step-demo'"
      :disabled="isDemoPlaying"
      @click="void guide.replayStepDemo(kind === 'collapse-drag' ? 'collapse' : (stepId ?? ''))"
    >
      <RotateCcw :class="isDemoPlaying ? 'motion-safe:animate-spin' : ''" />
      {{ isDemoPlaying ? t('pageGuide.setup.demo.playing') : t('pageGuide.setup.collapse.replay') }}
    </Button>

    <ul
      v-else-if="kind === 'result-features'"
      class="m-0 flex list-none flex-col gap-[var(--pxd-space-xs)] p-0"
    >
      <li
        v-for="toggle in featureToggles"
        :key="toggle.key"
        class="flex flex-col gap-[var(--pxd-space-xs)] text-[length:var(--pxd-font-secondary)]"
      >
        <div class="flex items-center justify-between gap-[var(--pxd-space-md)]">
          <label :for="`page-guide-feature-${toggle.key}`" class="cursor-pointer select-none">
            {{ t(toggle.labelKey) }}
          </label>
          <Switch
            :id="`page-guide-feature-${toggle.key}`"
            :model-value="setup.resultFeatures[toggle.key]"
            :data-setup-feature="toggle.key"
            @update:model-value="(value: boolean) => void guide.setResultFeature(toggle.key, value)"
          />
        </div>
        <div
          v-if="
            toggle.key === 'enableResultModHighlight' &&
            setup.resultFeatures.enableResultModHighlight
          "
          data-setup-group="result-mod-highlight-appearance"
          class="ml-[var(--pxd-space-sm)] flex flex-col gap-[var(--pxd-space-xs)] border-l border-border/70 pl-[var(--pxd-space-md)]"
        >
          <div
            role="group"
            :aria-label="t('settings.resultModHighlight.style.label')"
            class="flex flex-wrap gap-[var(--pxd-space-xs)]"
          >
            <Button
              v-for="opt in RESULT_MOD_HIGHLIGHT_STYLE_OPTIONS"
              :key="opt.value"
              type="button"
              size="sm"
              :variant="setup.resultModHighlightStyle === opt.value ? 'default' : 'outline'"
              :aria-pressed="setup.resultModHighlightStyle === opt.value"
              :data-setup-highlight-style="opt.value"
              class="flex-1"
              @click="void guide.setResultModHighlightStyle(opt.value)"
            >
              {{ opt.label }}
            </Button>
          </div>
          <div
            role="group"
            :aria-label="t('settings.resultModHighlight.color.label')"
            class="flex items-center gap-[var(--pxd-space-sm)]"
          >
            <button
              v-for="opt in RESULT_MOD_HIGHLIGHT_COLOR_OPTIONS"
              :key="opt.value"
              type="button"
              :title="opt.label"
              :aria-label="opt.label"
              :aria-pressed="setup.resultModHighlightColor === opt.value"
              :data-setup-highlight-color="opt.value"
              :class="[
                'inline-flex size-5 cursor-pointer items-center justify-center rounded-full border transition-transform',
                setup.resultModHighlightColor === opt.value
                  ? 'scale-110 border-primary ring-2 ring-primary/40'
                  : 'border-border/80 hover:scale-105',
              ]"
              @click="void guide.setResultModHighlightColor(opt.value)"
            >
              <span
                class="size-3 rounded-full"
                :style="{ backgroundColor: RESULT_MOD_HIGHLIGHT_PALETTES[opt.value].swatch }"
                aria-hidden="true"
              />
            </button>
          </div>
        </div>
      </li>
    </ul>

    <div
      v-if="kind === 'market-translation' && setup.reloadRequired"
      class="text-[length:var(--pxd-font-caption)] text-muted-foreground"
    >
      {{ t('pageGuide.setup.reloadAtEnd') }}
    </div>
  </div>
</template>
