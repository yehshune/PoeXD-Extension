<template>
  <div class="flex flex-col gap-[var(--pxd-field-gap)]" data-pob-build-pane>
    <!-- 匯入區：還沒有 build 時直接顯示，之後收在按鈕裡 -->
    <Button
      v-if="builds.length > 0 && !showImport"
      variant="outline"
      size="default"
      class="w-full"
      data-pob-build-add
      @click="showImport = true"
    >
      {{ t('pobBuild.addBuildBtn') }}
    </Button>
    <template v-else>
      <p
        v-if="builds.length === 0"
        class="m-0 text-[length:var(--pxd-font-caption)] text-muted-foreground"
      >
        {{ t('pobBuild.description') }}
      </p>
      <textarea
        v-model="codeInput"
        data-pob-build-input
        rows="4"
        spellcheck="false"
        :placeholder="t('pobBuild.placeholder')"
        :disabled="isBusy"
        class="w-full resize-y rounded-md border border-input bg-transparent px-[var(--pxd-space-sm)] py-[var(--pxd-space-xs)] font-mono text-[length:var(--pxd-font-caption)] text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
      ></textarea>
      <div class="flex gap-[var(--pxd-space-sm)]">
        <Button
          variant="outline"
          size="default"
          class="min-w-0 flex-1"
          data-pob-build-import
          :disabled="isBusy || !codeInput.trim()"
          @click="handleImport"
        >
          {{ isBusy ? t('pobBuild.importingBtn') : t('pobBuild.importBtn') }}
        </Button>
        <Button
          v-if="builds.length > 0"
          variant="ghost"
          size="default"
          data-pob-build-import-cancel
          @click="closeImport"
        >
          {{ t('pobBuild.cancelBtn') }}
        </Button>
      </div>
    </template>

    <div
      v-if="errorKey"
      class="text-[length:var(--pxd-font-caption)] text-destructive"
      data-pob-build-error
    >
      {{ t(errorKey) }}
    </div>

    <!-- build 清單 -->
    <section
      v-for="build in builds"
      :key="build.id"
      class="flex flex-col gap-[var(--pxd-space-sm)] rounded-md border border-border p-[var(--pxd-space-sm)]"
      data-pob-build
    >
      <header class="group/build flex items-center gap-[var(--pxd-space-xs)]">
        <button
          type="button"
          data-pob-build-toggle
          class="inline-flex shrink-0 items-center justify-center border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground cursor-pointer"
          :aria-expanded="!build.collapsed"
          :aria-label="t('pobBuild.toggleBuildAria', { name: build.name })"
          @click="toggleCollapsed(build.id)"
        >
          <ChevronDown
            class="size-[var(--control-icon-sm,14px)] transition-transform duration-200"
            :class="{ '-rotate-90': build.collapsed }"
          />
        </button>

        <input
          v-if="renamingId === build.id"
          v-model="renameInput"
          data-pob-build-rename-input
          type="text"
          :maxlength="NAME_MAX_LENGTH"
          class="min-w-0 flex-1 rounded-sm border border-input bg-background px-[var(--pxd-space-xs)] py-[1px] text-[length:var(--pxd-font-secondary)] text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          @keydown.enter.prevent="commitRename(build.id)"
          @keydown.esc.prevent="renamingId = null"
          @blur="commitRename(build.id)"
        />
        <span
          v-else
          class="min-w-0 flex-1 truncate text-[length:var(--pxd-font-secondary)] font-bold text-foreground"
          data-pob-build-name
          :title="build.name"
        >
          {{ build.name }}
        </span>

        <span
          class="shrink-0 text-[length:var(--pxd-font-caption)] text-muted-foreground tabular-nums"
          data-pob-build-progress
          :title="
            t('pobBuild.progress', { done: build.progress.done, total: build.progress.total })
          "
        >
          {{ build.progress.done }}/{{ build.progress.total }}
        </span>

        <button
          v-if="confirmingDeleteId === build.id"
          type="button"
          data-pob-build-delete-confirm
          class="shrink-0 border-0 bg-transparent p-0 text-[length:var(--pxd-font-caption)] text-destructive hover:underline cursor-pointer"
          @click="confirmDelete(build.id)"
          @blur="confirmingDeleteId = null"
        >
          {{ t('pobBuild.confirmDelete') }}
        </button>
        <template v-else>
          <button
            type="button"
            data-pob-build-rename
            :class="HOVER_ICON_BUTTON_CLASS + ' group-hover/build:opacity-100'"
            :title="t('pobBuild.renameTitle')"
            :aria-label="t('pobBuild.renameTitle')"
            @click="startRename(build)"
          >
            <Pencil class="size-[var(--control-icon-sm,14px)]" />
          </button>
          <button
            type="button"
            data-pob-build-delete
            :class="
              HOVER_ICON_BUTTON_CLASS + ' group-hover/build:opacity-100 hover:text-destructive'
            "
            :title="t('pobBuild.deleteBuildTitle')"
            :aria-label="t('pobBuild.deleteBuildTitle')"
            @click="confirmingDeleteId = build.id"
          >
            <Trash2 class="size-[var(--control-icon-sm,14px)]" />
          </button>
        </template>
      </header>

      <template v-if="!build.collapsed">
        <label v-if="build.itemSetOptions.length > 1" :class="SELECT_ROW_CLASS">
          <span class="shrink-0">{{ t('pobBuild.itemSetLabel') }}</span>
          <select
            data-pob-build-item-set
            :value="build.itemSetId"
            :class="SELECT_CLASS"
            @change="selectItemSet(build.id, ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="option in build.itemSetOptions" :key="option.id" :value="option.id">
              {{ setLabel(option) }}
            </option>
          </select>
        </label>
        <label v-if="showSkillSets(build)" :class="SELECT_ROW_CLASS">
          <span class="shrink-0">{{ t('pobBuild.skillSetLabel') }}</span>
          <select
            data-pob-build-skill-set
            :value="build.skillSetId"
            :class="SELECT_CLASS"
            @change="selectSkillSet(build.id, ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="option in build.skillSetOptions" :key="option.id" :value="option.id">
              {{ setLabel(option) }}
            </option>
          </select>
        </label>

        <button
          v-if="build.removedCount > 0"
          type="button"
          data-pob-build-restore-removed
          class="self-start border-0 bg-transparent p-0 text-[length:var(--pxd-font-caption)] text-primary underline-offset-2 hover:underline cursor-pointer"
          @click="restoreRemoved(build.id)"
        >
          {{ t('pobBuild.restoreRemoved', { count: build.removedCount }) }}
        </button>

        <p
          v-if="build.groups.length === 0"
          class="m-0 text-[length:var(--pxd-font-caption)] text-muted-foreground"
          data-pob-build-empty
        >
          {{ t('pobBuild.empty') }}
        </p>

        <section
          v-for="group in build.groups"
          :key="group.kind"
          class="flex flex-col gap-[2px]"
          :data-pob-build-group="group.kind"
        >
          <h4
            class="m-0 pb-[2px] text-[length:var(--pxd-font-caption)] font-bold text-muted-foreground select-none"
          >
            {{ t(GROUP_TITLE_KEYS[group.kind]) }}
          </h4>
          <template v-for="row in group.rows" :key="row.key">
            <div
              data-pob-build-row
              :data-done="row.done ? 'true' : 'false'"
              class="group/row flex items-center gap-[var(--pxd-space-xs)] rounded-sm px-[2px] py-[2px] hover:bg-accent/60"
            >
              <Checkbox
                :model-value="row.done"
                :aria-label="t('pobBuild.doneAria', { name: row.label })"
                data-pob-build-done
                @update:model-value="toggleDone(build.id, row.key)"
              />
              <img
                v-if="row.icon"
                :src="row.icon"
                alt=""
                loading="lazy"
                data-pob-build-icon
                class="size-6 shrink-0 object-contain"
                :class="{ 'opacity-50': row.done }"
              />
              <button
                type="button"
                data-pob-build-search
                class="flex min-w-0 flex-1 items-center justify-between gap-[var(--pxd-space-sm)] border-0 bg-transparent p-0 text-left text-[length:var(--pxd-font-caption)] cursor-pointer disabled:cursor-not-allowed"
                :class="{ 'line-through opacity-50': row.done, 'opacity-60': !row.query }"
                :disabled="!row.query"
                :title="row.query ? t('pobBuild.searchTitle') : t('pobBuild.noSearchTitle')"
                @click="openSearch(build.id, row, 'current')"
              >
                <span class="min-w-0 truncate" :class="nameClass(row)">{{ row.label }}</span>
                <span class="shrink-0 text-muted-foreground">{{ rowDetail(row) }}</span>
              </button>
              <button
                v-if="row.mods?.length"
                type="button"
                data-pob-build-mods-toggle
                :class="ICON_BUTTON_CLASS"
                :aria-expanded="isExpanded(build.id, row.key)"
                :title="t('pobBuild.toggleModsTitle')"
                :aria-label="t('pobBuild.toggleModsTitle')"
                @click="toggleExpanded(build.id, row.key)"
              >
                <ChevronDown
                  class="size-[var(--control-icon-sm,14px)] transition-transform duration-200"
                  :class="{ '-rotate-90': !isExpanded(build.id, row.key) }"
                />
              </button>
              <button
                v-if="row.query"
                type="button"
                data-pob-build-open-new-tab
                :class="HOVER_ICON_BUTTON_CLASS + ' group-hover/row:opacity-100'"
                :title="t('pobBuild.openNewTabTitle')"
                :aria-label="t('pobBuild.openNewTabTitle')"
                @click="openSearch(build.id, row, 'new-tab')"
              >
                <ExternalLink class="size-[var(--control-icon-sm,14px)]" />
              </button>
              <button
                type="button"
                data-pob-build-remove
                :class="
                  HOVER_ICON_BUTTON_CLASS + ' group-hover/row:opacity-100 hover:text-destructive'
                "
                :title="t('pobBuild.removeTitle')"
                :aria-label="t('pobBuild.removeAria', { name: row.label })"
                @click="removeEntry(build.id, row.key)"
              >
                <X class="size-[var(--control-icon-sm,14px)]" />
              </button>
            </div>
            <ul
              v-if="row.mods?.length && isExpanded(build.id, row.key)"
              data-pob-build-mods
              class="m-0 flex list-none flex-col gap-[1px] border-l border-border py-[2px] pl-[var(--pxd-space-sm)] ml-[var(--pxd-space-md)] text-[length:var(--pxd-font-caption)]"
            >
              <li
                v-for="(mod, index) in row.mods"
                :key="index"
                :data-mod-kind="mod.kind"
                :data-mod-searched="mod.searched ? 'true' : 'false'"
                class="flex gap-[var(--pxd-space-xs)] break-words"
                :class="MOD_CLASSES[mod.kind]"
              >
                <span
                  class="shrink-0 select-none"
                  :class="mod.searched ? 'text-primary' : 'opacity-0'"
                  aria-hidden="true"
                  >●</span
                >
                <span class="min-w-0">{{ mod.text }}</span>
              </li>
            </ul>
          </template>
        </section>
      </template>
    </section>

    <p
      v-if="builds.length > 0"
      class="m-0 text-[length:var(--pxd-font-caption)] text-muted-foreground"
    >
      {{ t('pobBuild.listHint') }}
    </p>
  </div>
</template>

<script lang="ts">
import { defineComponent, onMounted, onUnmounted, ref } from 'vue';
import { ChevronDown, ExternalLink, Pencil, Trash2, X } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { t, type I18nKey } from '@/utils/i18n';
import { POB_BUILD_NAME_MAX_LENGTH } from '@/utils/pob-build-store';
import type { ShoppingEntry, ShoppingEntryKind, ShoppingModKind } from '@/utils/pob-shopping-list';
import { getPoeVersion } from '@/utils/trade-context';
import { formatPobSlot } from './pob-slot-label';
import { usePobBuild, type BuildView, type SetOption } from './usePobBuild';

const GROUP_TITLE_KEYS: Readonly<Record<ShoppingEntryKind, I18nKey>> = {
  unique: 'pobBuild.group.unique',
  equipment: 'pobBuild.group.equipment',
  gem: 'pobBuild.group.gem',
};

// 稀有度顏色取遊戲內的色相，亮度取在深淺主題都看得清楚的中間值
const RARITY_CLASSES: Readonly<Record<string, string>> = {
  UNIQUE: 'text-[oklch(0.68_0.15_50)]',
  RELIC: 'text-[oklch(0.68_0.15_50)]',
  RARE: 'text-[oklch(0.72_0.13_90)]',
  MAGIC: 'text-[oklch(0.66_0.13_255)]',
  NORMAL: 'text-foreground',
};
const GEM_CLASS = 'text-[oklch(0.7_0.1_190)]';

const MOD_CLASSES: Readonly<Record<ShoppingModKind, string>> = {
  implicit: 'text-muted-foreground',
  explicit: 'text-foreground',
  crafted: 'text-[oklch(0.72_0.1_230)]',
};

const ICON_BUTTON_CLASS =
  'inline-flex shrink-0 items-center justify-center border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground cursor-pointer';
/** 平常隱藏、滑到該列或取得鍵盤焦點時才出現的按鈕 */
const HOVER_ICON_BUTTON_CLASS = `${ICON_BUTTON_CLASS} opacity-0 transition-opacity focus-visible:opacity-100`;
const SELECT_ROW_CLASS =
  'flex items-center justify-between gap-[var(--pxd-space-md)] text-[length:var(--pxd-font-caption)] text-foreground';
const SELECT_CLASS =
  'min-w-0 max-w-[65%] flex-1 rounded-md border border-input bg-background px-[var(--pxd-space-xs)] py-[2px] text-[length:var(--pxd-font-caption)] text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

export default defineComponent({
  name: 'PobBuildPane',
  components: { Button, Checkbox, ChevronDown, ExternalLink, Pencil, Trash2, X },
  setup() {
    const version = getPoeVersion();
    const pob = usePobBuild(version);
    const codeInput = ref('');
    const showImport = ref(false);
    const renamingId = ref<string | null>(null);
    const renameInput = ref('');
    const confirmingDeleteId = ref<string | null>(null);
    const expandedRows = ref<ReadonlySet<string>>(new Set());

    const rowId = (buildId: string, key: string) => `${buildId}\u0000${key}`;
    const isExpanded = (buildId: string, key: string) =>
      expandedRows.value.has(rowId(buildId, key));
    const toggleExpanded = (buildId: string, key: string) => {
      const next = new Set(expandedRows.value);
      const id = rowId(buildId, key);
      if (!next.delete(id)) next.add(id);
      expandedRows.value = next;
    };

    // PoE 2 的技能寶石不在市集交易，清單沒有寶石，技能組也就不必選
    const showSkillSets = (build: BuildView) =>
      version === 'poe1' && build.skillSetOptions.length > 1;

    const setLabel = (option: SetOption): string =>
      option.title || t('pobBuild.unnamedSet', { n: option.position });

    const rowDetail = (entry: ShoppingEntry): string =>
      entry.kind === 'gem'
        ? t('pobBuild.gemDetail', { level: entry.level ?? 1, quality: entry.quality ?? 0 })
        : formatPobSlot(entry.slot ?? '');

    const nameClass = (entry: ShoppingEntry): string =>
      entry.kind === 'gem' ? GEM_CLASS : (RARITY_CLASSES[entry.rarity ?? 'NORMAL'] ?? '');

    const closeImport = () => {
      showImport.value = false;
      codeInput.value = '';
      pob.errorKey.value = null;
    };

    const handleImport = async () => {
      if (await pob.importCode(codeInput.value)) closeImport();
    };

    const startRename = (build: BuildView) => {
      renamingId.value = build.id;
      renameInput.value = build.name;
    };

    const commitRename = (buildId: string) => {
      if (renamingId.value !== buildId) return;
      pob.rename(buildId, renameInput.value);
      renamingId.value = null;
    };

    const confirmDelete = (buildId: string) => {
      confirmingDeleteId.value = null;
      pob.removeBuild(buildId);
    };

    onMounted(() => {
      void pob.restore();
    });
    onUnmounted(() => pob.dispose());

    return {
      t,
      GROUP_TITLE_KEYS,
      MOD_CLASSES,
      ICON_BUTTON_CLASS,
      HOVER_ICON_BUTTON_CLASS,
      SELECT_ROW_CLASS,
      SELECT_CLASS,
      NAME_MAX_LENGTH: POB_BUILD_NAME_MAX_LENGTH,
      codeInput,
      showImport,
      renamingId,
      renameInput,
      confirmingDeleteId,
      isExpanded,
      toggleExpanded,
      showSkillSets,
      setLabel,
      rowDetail,
      nameClass,
      closeImport,
      handleImport,
      startRename,
      commitRename,
      confirmDelete,
      builds: pob.builds,
      errorKey: pob.errorKey,
      isBusy: pob.isBusy,
      toggleCollapsed: pob.toggleCollapsed,
      selectItemSet: pob.selectItemSet,
      selectSkillSet: pob.selectSkillSet,
      toggleDone: pob.toggleDone,
      removeEntry: pob.removeEntry,
      restoreRemoved: pob.restoreRemoved,
      openSearch: pob.openSearch,
    };
  },
});
</script>
