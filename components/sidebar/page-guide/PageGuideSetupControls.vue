<script setup lang="ts">
import { PanelLeft, PanelRight, RotateCcw } from '@lucide/vue';
import { computed } from 'vue';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { t } from '@/utils/i18n';
import {
  FONT_SIZE_MODES,
  FONT_SIZE_SCALE_BOUNDS,
  SIDEBAR_POSITIONS,
  SIDEBAR_SIZES,
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

function onFontRange(event: Event) {
  const value = Number((event.target as HTMLInputElement).value);
  if (Number.isFinite(value)) props.bindings.setFontSizeScale(value / 100);
}

const segmentClass = 'grid gap-[var(--pxd-space-xs)]';
const rowLabelClass = 'text-[length:var(--pxd-font-caption)] font-medium text-muted-foreground';
</script>

<template>
  <div
    data-page-guide-setup
    :data-setup-kind="kind"
    class="flex flex-col gap-[var(--pxd-space-sm)]"
  >
    <div
      v-if="kind === 'locale'"
      role="radiogroup"
      :aria-label="t('pageGuide.tour.locale.title')"
      :class="[segmentClass, 'grid-cols-2']"
    >
      <Button
        v-for="choice in PAGE_GUIDE_LOCALE_CHOICES"
        :key="choice.value"
        type="button"
        size="sm"
        role="radio"
        :variant="bindings.displayLocale === choice.value ? 'default' : 'outline'"
        :aria-checked="bindings.displayLocale === choice.value"
        :data-setup-locale="choice.value"
        @click="bindings.setDisplayLocale(choice.value)"
      >
        {{ choice.nativeLabel ?? t('settings.displayLocale.option.auto') }}
      </Button>
    </div>

    <div
      v-else-if="kind === 'market-translation'"
      class="flex items-center gap-[var(--pxd-space-md)]"
    >
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
      v-else-if="kind === 'collapse-drag'"
      type="button"
      size="sm"
      variant="outline"
      class="self-start"
      data-setup-action="replay-collapse-demo"
      :disabled="bindings.demoCursor !== null"
      @click="bindings.replayCollapseDemo()"
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
