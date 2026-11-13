<script setup lang="ts">
import { t } from '@/utils/i18n';

defineProps<{
  min: string;
  max: string;
}>();

const emit = defineEmits<{
  'update:min': [value: string];
  'update:max': [value: string];
  apply: [];
}>();
</script>

<template>
  <div
    data-slot="tier-tuning-bar"
    class="flex items-center justify-between gap-[var(--pxd-space-xs)] px-[var(--pxd-space-xs)] py-[var(--pxd-space-xs)] bg-muted/40 border-b border-border/50 text-[length:var(--pxd-font-micro)] select-none shrink-0"
    @click.stop
  >
    <span class="text-muted-foreground shrink-0 font-medium">{{ t('tierDropdown.tuning') }}</span>
    <div class="flex items-center gap-[var(--pxd-space-xs)]">
      <input
        :value="min"
        type="text"
        :placeholder="t('tierDropdown.minPlaceholder')"
        class="w-[52px] h-[22px] px-[var(--pxd-space-xs)] text-center font-mono text-[length:var(--pxd-font-small)] bg-background text-foreground border border-border rounded focus-visible:ring-1 focus-visible:ring-primary focus-visible:outline-hidden"
        @input="emit('update:min', ($event.target as HTMLInputElement).value)"
        @keydown.stop
        @keyup.enter="emit('apply')"
      />
      <span class="text-muted-foreground">~</span>
      <input
        :value="max"
        type="text"
        :placeholder="t('tierDropdown.maxPlaceholder')"
        class="w-[52px] h-[22px] px-[var(--pxd-space-xs)] text-center font-mono text-[length:var(--pxd-font-small)] bg-background text-foreground border border-border rounded focus-visible:ring-1 focus-visible:ring-primary focus-visible:outline-hidden"
        @input="emit('update:max', ($event.target as HTMLInputElement).value)"
        @keydown.stop
        @keyup.enter="emit('apply')"
      />
    </div>
    <button
      type="button"
      data-slot="tuning-apply-btn"
      class="h-[22px] px-[var(--pxd-space-xs)] text-[length:var(--pxd-font-micro)] bg-primary text-primary-foreground font-medium rounded hover:bg-primary/90 focus-visible:ring-1 focus-visible:ring-primary focus-visible:outline-hidden cursor-pointer shrink-0 transition-colors"
      :title="t('tierDropdown.applyTitle')"
      @click="emit('apply')"
    >
      {{ t('tierDropdown.apply') }}
    </button>
  </div>
</template>
