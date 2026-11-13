<script setup lang="ts">
import { Layers, Radio, SlidersHorizontal, X } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { t } from '@/utils/i18n';

defineProps<{
  /** 國際服英文市集且介面語言為中文時才顯示漢化開關 */
  showMarketTranslation: boolean;
  marketTranslation: boolean;
  /** 本頁開啟後漢化設定有變動，需重新整理才生效 */
  reloadRequired: boolean;
}>();

const emit = defineEmits<{
  dismiss: [];
  'update:marketTranslation': [value: boolean];
  reload: [];
}>();

const features = [
  { icon: SlidersHorizontal, key: 'onboarding.welcome.statGroups' },
  { icon: Layers, key: 'onboarding.welcome.tiers' },
  { icon: Radio, key: 'onboarding.welcome.liveSearch' },
] as const;
</script>

<template>
  <section
    data-onboarding-welcome
    class="relative flex flex-col gap-[var(--pxd-space-sm)] rounded-md border border-border bg-muted/30 p-[var(--pxd-space-md)] text-[length:var(--pxd-font-secondary)]"
    :aria-label="t('onboarding.welcome.title')"
  >
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      class="absolute top-[var(--pxd-space-xs)] right-[var(--pxd-space-xs)] text-muted-foreground"
      :title="t('onboarding.welcome.dismiss')"
      :aria-label="t('onboarding.welcome.dismiss')"
      data-onboarding-action="dismiss"
      @click="emit('dismiss')"
    >
      <X class="size-4" />
    </Button>

    <p
      class="m-0 pr-[var(--pxd-space-2xl)] text-[length:var(--pxd-font-body)] font-bold text-foreground"
    >
      {{ t('onboarding.welcome.title') }}
    </p>

    <ul class="m-0 flex list-none flex-col gap-[var(--pxd-space-xs)] p-0">
      <li
        v-for="feature in features"
        :key="feature.key"
        class="flex items-start gap-[var(--pxd-space-sm)] leading-snug text-muted-foreground"
      >
        <component :is="feature.icon" class="mt-0.5 size-4 shrink-0 text-primary" />
        <span>{{ t(feature.key) }}</span>
      </li>
    </ul>

    <div
      v-if="showMarketTranslation"
      class="flex flex-col gap-[var(--pxd-space-xs)] border-t border-border pt-[var(--pxd-space-sm)]"
    >
      <div class="flex items-center gap-[var(--pxd-space-md)]">
        <Checkbox
          id="onboarding-market-translation"
          :model-value="marketTranslation"
          data-onboarding-action="market-translation"
          @update:model-value="(value) => emit('update:marketTranslation', value === true)"
        />
        <label
          for="onboarding-market-translation"
          class="cursor-pointer select-none text-foreground"
        >
          {{ t('onboarding.welcome.marketTranslation') }}
        </label>
      </div>
      <div
        v-if="reloadRequired"
        class="flex items-center justify-between gap-[var(--pxd-space-sm)] text-[length:var(--pxd-font-caption)] text-muted-foreground"
      >
        <span>{{ t('onboarding.welcome.reloadHint') }}</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-onboarding-action="reload"
          @click="emit('reload')"
        >
          {{ t('onboarding.welcome.reload') }}
        </Button>
      </div>
    </div>
  </section>
</template>
