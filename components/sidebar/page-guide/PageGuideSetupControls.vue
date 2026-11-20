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
import FontSizeScaleControl from '@/components/sidebar/settings/FontSizeScaleControl.vue';
import { t } from '@/utils/i18n';
import { resolvePreferredChineseLocale } from '@/utils/locale-resolution';
import { SIDEBAR_POSITIONS, type DisplayLocalePreference } from '@/utils/preferences-contract';
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

const featureToggles = computed(() => (props.focus ? RESULT_FEATURE_TOGGLES[props.focus] : []));
const selectedLocaleLabel = computed(() => {
  const found = PAGE_GUIDE_LOCALE_CHOICES.find((c) => c.value === props.bindings.displayLocale);
  return found?.nativeLabel ?? t('settings.displayLocale.option.auto');
});
const previewLocale = computed<'zh-TW' | 'zh-CN'>(() => {
  const loc = props.bindings.displayLocale;
  if (loc === 'zh-CN' || loc === 'zh-TW') return loc;
  return resolvePreferredChineseLocale();
});
const previewDropdownText = computed(() => {
  const en = t('pageGuide.setup.marketTranslation.previewStatEn');
  if (!props.bindings.marketTranslation) return en;
  const zh = t('pageGuide.setup.marketTranslation.previewStatZh', undefined, previewLocale.value);
  return props.bindings.marketTranslationBilingual ? `${zh} (${en})` : zh;
});
const previewResultZhText = computed(() =>
  t('pageGuide.setup.marketTranslation.previewModZh', undefined, previewLocale.value),
);
const previewResultEnText = computed(() => t('pageGuide.setup.marketTranslation.previewModEn'));

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
          :variant="bindings.sidebarPosition === position ? 'default' : 'outline'"
          :aria-checked="bindings.sidebarPosition === position"
          :data-setup-position="position"
          @click="bindings.setSidebarPosition(position)"
        >
          <component :is="POSITION_ICONS[position]" />
          {{ t(`settings.sidebarPosition.option.${position}`) }}
        </Button>
      </div>

      <p
        data-setup-hint="custom-width"
        class="m-0 text-[length:var(--pxd-font-caption)] text-primary"
      >
        {{ t('pageGuide.setup.customWidthHint') }}
      </p>

      <div class="flex items-center justify-between gap-[var(--pxd-space-md)]">
        <span :class="rowLabelClass">{{ t('settings.fontSize.label') }}</span>
        <FontSizeScaleControl
          :scale="bindings.fontSizeScale"
          in-guide
          @update:scale="bindings.setFontSizeScale"
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
