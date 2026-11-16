<template>
  <Collapsible v-model:open="isOpen" class="flex flex-col" data-pob-build-section>
    <CollapsibleTrigger
      class="flex w-full items-center justify-between py-[var(--pxd-space-sm)] text-[length:var(--pxd-font-secondary)] font-bold text-foreground hover:text-primary transition-colors select-none"
    >
      <span>{{ t('tools.pobBuild.title') }}</span>
      <ChevronDown
        class="size-[var(--control-icon-sm,14px)] text-muted-foreground transition-transform duration-200"
        :class="{ '-rotate-90': !isOpen }"
      />
    </CollapsibleTrigger>
    <CollapsibleContent class="flex flex-col gap-[var(--pxd-field-gap)] pt-[var(--pxd-space-sm)]">
      <template v-if="!build">
        <p class="m-0 text-[length:var(--pxd-font-caption)] text-muted-foreground">
          {{ t('tools.pobBuild.description') }}
        </p>
        <textarea
          v-model="codeInput"
          data-pob-build-input
          rows="3"
          spellcheck="false"
          :placeholder="t('tools.pobBuild.placeholder')"
          :disabled="isBusy"
          class="w-full resize-y rounded-md border border-input bg-transparent px-[var(--pxd-space-sm)] py-[var(--pxd-space-xs)] font-mono text-[length:var(--pxd-font-caption)] text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
        ></textarea>
        <Button
          variant="outline"
          size="default"
          class="w-full"
          data-pob-build-import
          :disabled="isBusy || !codeInput.trim()"
          @click="handleImport"
        >
          {{ isBusy ? t('tools.pobBuild.importingBtn') : t('tools.pobBuild.importBtn') }}
        </Button>
      </template>

      <template v-else>
        <div class="flex items-center justify-between gap-[var(--pxd-space-md)]">
          <span
            class="min-w-0 truncate text-[length:var(--pxd-font-secondary)] text-foreground"
            data-pob-build-summary
          >
            {{ summary }}
          </span>
          <Button variant="ghost" size="sm" data-pob-build-clear @click="handleClear">
            {{ t('tools.pobBuild.clearBtn') }}
          </Button>
        </div>
        <section
          v-for="group in groups"
          :key="group.kind"
          class="flex flex-col gap-[var(--pxd-space-xs)]"
          :data-pob-build-group="group.kind"
        >
          <h4
            class="m-0 text-[length:var(--pxd-font-caption)] font-bold text-muted-foreground select-none"
          >
            {{ t(GROUP_TITLE_KEYS[group.kind]) }} ({{ group.entries.length }})
          </h4>
          <button
            v-for="(entry, index) in group.entries"
            :key="`${group.kind}-${index}`"
            type="button"
            data-pob-build-entry
            class="flex w-full items-center justify-between gap-[var(--pxd-space-sm)] rounded-sm border-0 bg-transparent px-[var(--pxd-space-xs)] py-[2px] text-left text-[length:var(--pxd-font-caption)] text-foreground hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
            :disabled="!entry.query"
            :title="
              entry.query ? t('tools.pobBuild.searchTitle') : t('tools.pobBuild.noSearchTitle')
            "
            @click="openSearch(entry)"
          >
            <span class="min-w-0 truncate">{{ entry.label }}</span>
            <span class="shrink-0 text-muted-foreground">{{ entryDetail(entry) }}</span>
          </button>
        </section>
        <p class="m-0 text-[length:var(--pxd-font-caption)] text-muted-foreground">
          {{ t('tools.pobBuild.listHint') }}
        </p>
      </template>

      <div
        v-if="errorKey"
        class="text-[length:var(--pxd-font-caption)] text-destructive"
        data-pob-build-error
      >
        {{ t(errorKey) }}
      </div>
    </CollapsibleContent>
  </Collapsible>
</template>

<script lang="ts">
import { computed, defineComponent, onMounted, ref } from 'vue';
import { ChevronDown } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { t, type I18nKey } from '@/utils/i18n';
import type { ShoppingEntry, ShoppingEntryKind } from '@/utils/pob-shopping-list';
import { getPoeVersion } from '@/utils/trade-context';
import { usePobBuild } from './usePobBuild';

const GROUP_TITLE_KEYS: Readonly<Record<ShoppingEntryKind, I18nKey>> = {
  unique: 'tools.pobBuild.group.unique',
  equipment: 'tools.pobBuild.group.equipment',
  gem: 'tools.pobBuild.group.gem',
};

export default defineComponent({
  name: 'PobBuildSection',
  components: { Button, Collapsible, CollapsibleContent, CollapsibleTrigger, ChevronDown },
  setup() {
    const isOpen = ref(true);
    const codeInput = ref('');
    const { build, groups, errorKey, isBusy, restore, importCode, clear, openSearch } =
      usePobBuild(getPoeVersion());

    const summary = computed(() => {
      const current = build.value;
      if (!current) return '';
      return t('tools.pobBuild.summary', {
        name: current.ascendancy || current.className,
        level: current.level,
      });
    });

    const entryDetail = (entry: ShoppingEntry): string =>
      entry.kind === 'gem'
        ? t('tools.pobBuild.gemDetail', { level: entry.level ?? 1, quality: entry.quality ?? 0 })
        : (entry.slot ?? '');

    const handleImport = async () => {
      if (await importCode(codeInput.value)) codeInput.value = '';
    };

    const handleClear = () => {
      void clear();
    };

    onMounted(() => {
      void restore();
    });

    return {
      t,
      GROUP_TITLE_KEYS,
      isOpen,
      codeInput,
      build,
      groups,
      errorKey,
      isBusy,
      summary,
      entryDetail,
      handleImport,
      handleClear,
      openSearch,
    };
  },
});
</script>
