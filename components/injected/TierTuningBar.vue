<script setup lang="ts">
import { t } from '@/utils/i18n';

defineProps<{
  min: string;
  max: string;
  isDirty?: boolean;
}>();

const emit = defineEmits<{
  'update:min': [value: string];
  'update:max': [value: string];
  apply: [];
  clear: [];
}>();
</script>

<template>
  <div
    data-slot="tier-tuning-bar"
    class="flex items-center justify-between gap-[var(--pxd-space-xs)] px-[var(--pxd-space-xs)] py-[var(--pxd-space-xs)] bg-muted/40 border-b border-border/50 text-[length:var(--pxd-font-secondary)] select-none shrink-0"
    @click.stop
  >
    <span class="text-muted-foreground shrink-0 font-medium">{{ t('tierDropdown.tuning') }}</span>
    <div class="flex items-center gap-[var(--pxd-space-xs)] min-w-0">
      <input
        :value="min"
        type="text"
        :placeholder="t('tierDropdown.minPlaceholder')"
        class="w-[50px] h-[24px] px-[var(--pxd-space-xs)] text-center font-mono text-[length:var(--pxd-font-secondary)] bg-background text-foreground border border-border rounded focus-visible:ring-1 focus-visible:ring-primary focus-visible:outline-hidden"
        @input="emit('update:min', ($event.target as HTMLInputElement).value)"
        @keydown.stop
        @keyup.enter="emit('apply')"
      />
      <span class="text-muted-foreground text-[length:var(--pxd-font-caption)]">~</span>
      <input
        :value="max"
        type="text"
        :placeholder="t('tierDropdown.maxPlaceholder')"
        class="w-[50px] h-[24px] px-[var(--pxd-space-xs)] text-center font-mono text-[length:var(--pxd-font-secondary)] bg-background text-foreground border border-border rounded focus-visible:ring-1 focus-visible:ring-primary focus-visible:outline-hidden"
        @input="emit('update:max', ($event.target as HTMLInputElement).value)"
        @keydown.stop
        @keyup.enter="emit('apply')"
      />
    </div>
    <div class="flex items-center gap-[var(--pxd-space-xs)] shrink-0">
      <button
        v-if="min || max"
        type="button"
        data-slot="tuning-clear-btn"
        class="h-[24px] w-[22px] inline-flex items-center justify-center text-[length:var(--pxd-font-caption)] text-muted-foreground hover:text-foreground hover:bg-accent rounded cursor-pointer transition-colors focus-visible:ring-1 focus-visible:ring-primary focus-visible:outline-hidden"
        :title="t('tierDropdown.clearTitle')"
        :aria-label="t('tierDropdown.clearTitle')"
        @click="emit('clear')"
      >
        ×
      </button>
      <button
        type="button"
        data-slot="tuning-apply-btn"
        class="h-[24px] px-[var(--pxd-space-sm)] text-[length:var(--pxd-font-secondary)] font-medium rounded focus-visible:ring-1 focus-visible:ring-primary focus-visible:outline-hidden cursor-pointer shrink-0 transition-colors"
        :class="
          isDirty
            ? 'bg-primary text-primary-foreground hover:bg-primary/90'
            : 'bg-secondary text-secondary-foreground border border-border/70 hover:bg-accent hover:text-accent-foreground'
        "
        :title="t('tierDropdown.applyTitle')"
        @click="emit('apply')"
      >
        {{ t('tierDropdown.apply') }}
      </button>
    </div>
  </div>
</template>
