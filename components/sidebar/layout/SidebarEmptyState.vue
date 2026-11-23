<script setup lang="ts">
defineProps<{
  message: string;
  hint?: string;
  compact?: boolean;
}>();
</script>

<template>
  <div
    class="flex flex-col items-center justify-center text-center text-muted-foreground"
    :class="
      compact
        ? 'gap-[var(--pxd-space-xs)] px-[var(--pxd-space-sm)] py-[var(--pxd-space-md)] text-[length:var(--pxd-font-caption)]'
        : 'gap-[var(--pxd-space-sm)] px-[var(--pxd-space-md)] py-[var(--pxd-space-2xl)] text-[length:var(--pxd-font-body)]'
    "
  >
    <div
      v-if="$slots.icon"
      class="shrink-0 opacity-50"
      :class="compact ? '[&>svg]:size-5' : '[&>svg]:size-6'"
      aria-hidden="true"
    >
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
