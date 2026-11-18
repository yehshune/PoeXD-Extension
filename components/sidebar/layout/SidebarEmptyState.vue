<script setup lang="ts">
defineProps<{
  message: string;
  hint?: string;
}>();
</script>

<template>
  <div
    class="flex flex-col items-center justify-center gap-[var(--pxd-space-sm)] px-[var(--pxd-space-md)] py-[var(--pxd-space-2xl)] text-center text-[length:var(--pxd-font-secondary)] text-muted-foreground"
  >
    <div v-if="$slots.icon" class="shrink-0 opacity-50 [&>svg]:size-6" aria-hidden="true">
      <slot name="icon" />
    </div>
    <p class="m-0 leading-relaxed">{{ message }}</p>
    <p v-if="hint" class="m-0 text-[length:var(--pxd-font-caption)] leading-relaxed opacity-85">
      {{ hint }}
    </p>
    <div
      v-if="$slots.actions"
      class="mt-[var(--pxd-space-xs)] flex flex-wrap items-center justify-center gap-[var(--pxd-space-sm)]"
    >
      <slot name="actions" />
    </div>
  </div>
</template>
