<script setup lang="ts">
import { X } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { RELEASES_PAGE_URL } from '@/utils/support-links';
import { t } from '@/utils/i18n';
import { RELEASE_HIGHLIGHTS } from '@/utils/release-highlights';
import type { SettingsSectionId } from '@/utils/sidebar-modules';

defineProps<{
  version: string;
}>();

const emit = defineEmits<{
  dismiss: [];
  openSection: [section: SettingsSectionId];
}>();
</script>

<template>
  <section
    data-onboarding-update
    class="flex items-center justify-between gap-[var(--pxd-space-sm)] rounded-md border border-border bg-muted/30 py-[var(--pxd-space-xs)] pr-[var(--pxd-space-xs)] pl-[var(--pxd-space-md)] text-[length:var(--pxd-font-secondary)]"
    :aria-label="t('onboarding.update.title', { version })"
  >
    <div class="flex min-w-0 flex-1 flex-col gap-[var(--pxd-space-xs)]">
      <div
        class="flex min-w-0 flex-wrap items-center gap-x-[var(--pxd-space-sm)] gap-y-[var(--pxd-space-xs)]"
      >
        <span class="font-medium text-foreground">
          {{ t('onboarding.update.title', { version }) }}
        </span>
        <a
          :href="RELEASES_PAGE_URL"
          data-onboarding-action="release-notes"
          target="_blank"
          rel="noopener noreferrer"
          class="text-primary underline underline-offset-4 hover:opacity-80"
        >
          {{ t('onboarding.update.releaseNotes') }}
        </a>
      </div>

      <div
        v-if="RELEASE_HIGHLIGHTS.length > 0"
        class="flex min-w-0 flex-wrap items-center gap-[var(--pxd-space-xs)]"
      >
        <span class="text-muted-foreground">{{ t('onboarding.update.highlightsLabel') }}</span>
        <Button
          v-for="highlight in RELEASE_HIGHLIGHTS"
          :key="highlight.id"
          type="button"
          variant="outline"
          size="sm"
          :data-onboarding-highlight="highlight.id"
          @click="emit('openSection', highlight.section)"
        >
          {{ t(highlight.labelKey) }}
        </Button>
      </div>
    </div>

    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      class="shrink-0 self-start"
      :title="t('onboarding.update.dismiss')"
      :aria-label="t('onboarding.update.dismiss')"
      data-onboarding-action="dismiss-update"
      @click="emit('dismiss')"
    >
      <X />
    </Button>
  </section>
</template>
