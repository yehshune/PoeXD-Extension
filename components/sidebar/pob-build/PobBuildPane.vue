<template>
  <SidebarPane data-pane="pob-build" class="pob-build-pane">
    <template #fixed>
      <div
        class="flex items-center gap-[var(--pxd-space-sm)] pb-[var(--pxd-space-md)] w-full max-w-full min-w-0"
      >
        <Button
          variant="default"
          size="sm"
          class="min-w-0 flex-1 font-bold"
          data-pob-build-add
          :title="t('pobBuild.addBuildBtn')"
          @click="openImportDialog"
        >
          <Plus />
          <span class="pxd-toolbar-btn-text ml-1.5 truncate">{{ t('pobBuild.addBuildBtn') }}</span>
        </Button>

        <Button
          variant="secondary"
          size="sm"
          class="font-bold shrink-0"
          data-pob-build-expand-all
          :disabled="builds.length === 0"
          :title="
            isAllCollapsed ? t('bookmark.action.expandAll') : t('bookmark.action.collapseAll')
          "
          @click="toggleExpandAll"
        >
          <ChevronsUpDown />
          <span class="pxd-toolbar-btn-text ml-1.5 truncate">
            {{ isAllCollapsed ? t('bookmark.action.expandAll') : t('bookmark.action.collapseAll') }}
          </span>
        </Button>

        <Button
          :variant="isSearchVisible ? 'default' : 'secondary'"
          size="icon-sm"
          data-pob-build-search-toggle
          :disabled="builds.length === 0 && !isSearchVisible"
          :title="isSearchVisible ? t('bookmark.search.closeTooltip') : t('pobBuild.searchTooltip')"
          @click="toggleSearch"
        >
          <Search />
        </Button>
      </div>

      <Separator class="mb-[var(--pxd-space-md)]" />

      <div v-if="isSearchVisible" class="relative mb-[var(--pxd-space-md)] flex items-center">
        <Search
          class="pointer-events-none absolute left-2.5 size-[var(--control-icon-sm,14px)] text-muted-foreground"
        />
        <Input
          ref="searchInputRef"
          v-model="searchQuery"
          size="sm"
          :placeholder="t('pobBuild.searchPlaceholder')"
          class="w-full pl-8 pr-7"
          data-pob-build-filter
          @keydown.esc.stop.prevent="closeSearch"
        />
        <Button
          v-if="searchQuery"
          variant="ghost"
          size="icon-sm"
          class="absolute right-1"
          :title="t('bookmark.search.clearTooltip')"
          @click="searchQuery = ''"
        >
          <X />
        </Button>
      </div>

      <div
        v-if="errorKey && !isImportOpen"
        role="alert"
        data-pob-build-error
        class="mb-[var(--pxd-space-md)] rounded-md border border-destructive/40 bg-destructive/10 px-[var(--pxd-space-md)] py-[var(--pxd-space-xs)] text-[length:var(--pxd-font-caption)] text-destructive"
      >
        {{ t(errorKey) }}
      </div>
    </template>

    <template #scroll>
      <div
        v-if="builds.length === 0"
        data-pob-build-empty-state
        class="flex flex-col items-center justify-center gap-[var(--pxd-space-md)] px-[var(--pxd-space-md)] py-[var(--pxd-space-2xl)] text-center"
      >
        <p
          class="m-0 text-[length:var(--pxd-font-secondary)] leading-relaxed text-muted-foreground"
        >
          {{ t('pobBuild.description') }}
        </p>
        <Button
          variant="default"
          size="sm"
          class="font-bold"
          data-pob-build-empty-import
          @click="openImportDialog"
        >
          <Plus />
          <span class="ml-1.5">{{ t('pobBuild.addBuildBtn') }}</span>
        </Button>
      </div>

      <p
        v-else-if="visibleBuilds.length === 0"
        data-pob-build-no-match
        class="m-0 py-[var(--pxd-space-lg)] text-center text-[length:var(--pxd-font-secondary)] text-muted-foreground"
      >
        {{ t('pobBuild.noMatch', { query: searchQuery.trim() }) }}
      </p>

      <div v-else class="flex flex-col gap-[var(--pxd-bookmark-tree-gap)]">
        <section
          v-for="build in visibleBuilds"
          :key="build.id"
          class="rounded-md border border-border bg-card overflow-hidden shadow-sm"
          data-pob-build
        >
          <header
            class="group relative flex items-center justify-between cursor-pointer select-none border-0 border-solid border-l-2 border-l-primary bg-muted/40 hover:bg-muted/70 py-[var(--pxd-bookmark-folder-header-padding-y)] px-[var(--pxd-space-lg)]"
            :class="{ 'border-b border-border': !build.collapsed || isFiltering }"
            @click="toggleCollapsed(build.id)"
          >
            <div class="flex w-full min-w-0 items-center gap-[var(--pxd-space-sm)]">
              <button
                type="button"
                data-pob-build-toggle
                class="inline-flex shrink-0 items-center justify-center border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground cursor-pointer"
                :aria-expanded="!build.collapsed || isFiltering"
                :aria-label="t('pobBuild.toggleBuildAria', { name: build.name })"
                @click.stop="toggleCollapsed(build.id)"
              >
                <ChevronDown
                  class="size-[var(--control-icon-sm,14px)] transition-transform duration-200"
                  :class="{ '-rotate-90': build.collapsed && !isFiltering }"
                />
              </button>

              <Input
                v-if="renamingId === build.id"
                :ref="focusRenameInput"
                v-model="renameInput"
                data-pob-build-rename-input
                size="sm"
                :maxlength="NAME_MAX_LENGTH"
                class="w-full min-w-0"
                @keydown.enter.prevent="commitRename(build.id)"
                @keydown.esc.prevent="renamingId = null"
                @blur="commitRename(build.id)"
                @click.stop
              />
              <template v-else>
                <span
                  class="min-w-0 flex-1 truncate text-[length:var(--pxd-font-secondary)] font-bold text-foreground"
                  data-pob-build-name
                  :title="build.name"
                >
                  {{ build.name }}
                </span>

                <span
                  class="shrink-0 text-[length:var(--pxd-font-micro)] text-muted-foreground tabular-nums"
                  data-pob-build-progress
                  :title="
                    t('pobBuild.progress', {
                      done: build.progress.done,
                      total: build.progress.total,
                    })
                  "
                >
                  {{ build.progress.done }}/{{ build.progress.total }}
                </span>
              </template>
            </div>

            <div
              v-if="renamingId !== build.id"
              class="absolute right-[var(--pxd-space-md)] top-1/2 -translate-y-1/2 z-(--pxd-z-raised) bg-[color-mix(in_srgb,var(--muted)_70%,var(--card))] pl-[var(--pxd-space-sm)] opacity-0 pointer-events-none transition-opacity duration-150 group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto flex items-center gap-[var(--pxd-space-xs)]"
              @click.stop
            >
              <Button
                variant="ghost"
                size="icon-sm"
                data-pob-build-rename
                :title="t('pobBuild.renameTitle')"
                :aria-label="t('pobBuild.renameTitle')"
                @click.stop="startRename(build)"
              >
                <Pencil />
              </Button>
              <Button
                variant="ghost-destructive"
                size="icon-sm"
                data-pob-build-delete
                :title="t('pobBuild.deleteBuildTitle')"
                :aria-label="t('pobBuild.deleteBuildTitle')"
                @click.stop="confirmDeleteBuild(build)"
              >
                <Trash2 />
              </Button>
            </div>
          </header>

          <template v-if="!build.collapsed || isFiltering">
            <div
              v-if="
                !isFiltering &&
                (build.itemSetOptions.length > 1 || showSkillSets(build) || build.removedCount > 0)
              "
              class="flex flex-col gap-[var(--pxd-space-sm)] border-b border-border bg-muted/20 px-[var(--pxd-space-md)] py-[var(--pxd-space-sm)]"
            >
              <div
                v-if="build.itemSetOptions.length > 1"
                class="flex items-center justify-between gap-[var(--pxd-space-md)]"
              >
                <span class="shrink-0 text-[length:var(--pxd-font-caption)] text-muted-foreground">
                  {{ t('pobBuild.itemSetLabel') }}
                </span>
                <Select
                  :model-value="build.itemSetId"
                  @update:model-value="(value) => selectItemSet(build.id, String(value))"
                >
                  <SelectTrigger size="sm" class="w-[62%] min-w-0" data-pob-build-item-set>
                    <SelectValue>{{
                      activeSetLabel(build.itemSetOptions, build.itemSetId)
                    }}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem
                      v-for="option in build.itemSetOptions"
                      :key="option.id"
                      :value="option.id"
                    >
                      {{ setLabel(option) }}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div
                v-if="showSkillSets(build)"
                class="flex items-center justify-between gap-[var(--pxd-space-md)]"
              >
                <span class="shrink-0 text-[length:var(--pxd-font-caption)] text-muted-foreground">
                  {{ t('pobBuild.skillSetLabel') }}
                </span>
                <Select
                  :model-value="build.skillSetId"
                  @update:model-value="(value) => selectSkillSet(build.id, String(value))"
                >
                  <SelectTrigger size="sm" class="w-[62%] min-w-0" data-pob-build-skill-set>
                    <SelectValue>{{
                      activeSetLabel(build.skillSetOptions, build.skillSetId)
                    }}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem
                      v-for="option in build.skillSetOptions"
                      :key="option.id"
                      :value="option.id"
                    >
                      {{ setLabel(option) }}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button
                v-if="build.removedCount > 0"
                variant="link"
                size="sm"
                data-pob-build-restore-removed
                class="h-auto self-start p-0 text-[length:var(--pxd-font-caption)]"
                @click="restoreRemoved(build.id)"
              >
                {{ t('pobBuild.restoreRemoved', { count: build.removedCount }) }}
              </Button>
            </div>

            <p
              v-if="build.groups.length === 0"
              class="m-0 px-[var(--pxd-space-md)] py-[var(--pxd-space-lg)] text-center text-[length:var(--pxd-font-caption)] text-muted-foreground"
              data-pob-build-empty
            >
              {{ t('pobBuild.empty') }}
            </p>

            <section
              v-for="group in build.groups"
              :key="group.kind"
              class="flex flex-col border-b border-border last:border-b-0"
              :data-pob-build-group="group.kind"
            >
              <h4
                class="m-0 flex items-center justify-between border-b border-border bg-muted/25 px-[var(--pxd-space-md)] py-[var(--pxd-space-xs)] text-[length:var(--pxd-font-micro)] font-bold text-muted-foreground select-none"
              >
                <span>{{ t(GROUP_TITLE_KEYS[group.kind]) }}</span>
                <span class="tabular-nums">{{ group.rows.length }}</span>
              </h4>

              <template v-for="row in group.rows" :key="row.key">
                <div
                  data-pob-build-row
                  :data-done="row.done ? 'true' : 'false'"
                  class="group/row relative flex items-center gap-[var(--pxd-space-sm)] border-0 border-b border-dashed border-border px-[var(--pxd-space-md)] py-[var(--pxd-bookmark-row-padding-y)] last:border-b-0 transition-colors hover:bg-muted/40"
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
                    class="size-[var(--control-height-sm)] shrink-0 object-contain"
                    :class="{ 'opacity-50': row.done }"
                  />

                  <button
                    type="button"
                    data-pob-build-search
                    class="flex min-h-[var(--control-height-sm)] min-w-0 flex-1 items-center justify-between gap-[var(--pxd-space-sm)] rounded-sm border-0 bg-transparent p-0 text-left text-[length:var(--pxd-font-secondary)] cursor-pointer disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    :class="{ 'line-through opacity-50': row.done, 'opacity-60': !row.query }"
                    :disabled="!row.query"
                    :title="row.query ? t('pobBuild.searchTitle') : t('pobBuild.noSearchTitle')"
                    @click="openSearch(build.id, row, 'current')"
                  >
                    <span class="flex min-w-0 items-baseline gap-[var(--pxd-space-xs)]">
                      <span class="min-w-0 truncate font-medium" :class="nameClass(row)">{{
                        row.label
                      }}</span>
                      <span
                        v-if="row.suffix"
                        data-pob-build-suffix
                        class="shrink-0 text-[length:var(--pxd-font-micro)] text-muted-foreground tabular-nums"
                        >{{ row.suffix }}</span
                      >
                      <span
                        v-if="row.count > 1"
                        data-pob-build-count
                        class="shrink-0 rounded-sm bg-muted px-1 text-[length:var(--pxd-font-micro)] font-bold text-foreground tabular-nums"
                        :title="t('pobBuild.countTitle', { count: row.count })"
                        >×{{ row.count }}</span
                      >
                      <span
                        v-if="row.searchCustomized"
                        data-pob-build-customized
                        role="img"
                        class="size-1.5 shrink-0 self-center rounded-full bg-primary"
                        :title="t('pobBuild.customizedTitle')"
                        :aria-label="t('pobBuild.customizedTitle')"
                      />
                    </span>
                    <span
                      class="flex shrink-0 items-center gap-[var(--pxd-space-xs)] text-[length:var(--pxd-font-micro)] text-muted-foreground"
                    >
                      <span>{{ rowDetail(row) }}</span>
                      <ChevronDown
                        v-if="row.mods?.length"
                        class="size-3 opacity-60 transition-transform duration-200"
                        :class="{ '-rotate-90': !isExpanded(build.id, row.key) }"
                        aria-hidden="true"
                      />
                    </span>
                  </button>

                  <div
                    class="absolute right-[var(--pxd-space-md)] top-1/2 -translate-y-1/2 z-(--pxd-z-raised) flex items-center gap-[var(--pxd-space-xs)] bg-[color-mix(in_srgb,var(--muted)_40%,var(--card))] pl-[var(--pxd-space-sm)] opacity-0 pointer-events-none transition-opacity duration-150 group-hover/row:opacity-100 group-hover/row:pointer-events-auto group-focus-within/row:opacity-100 group-focus-within/row:pointer-events-auto"
                  >
                    <Button
                      v-if="row.mods?.length"
                      variant="ghost"
                      size="icon-sm"
                      data-pob-build-mods-toggle
                      :aria-expanded="isExpanded(build.id, row.key)"
                      :title="t('pobBuild.toggleModsTitle')"
                      :aria-label="t('pobBuild.toggleModsTitle')"
                      @click.stop="toggleExpanded(build.id, row.key)"
                    >
                      <ChevronDown
                        class="transition-transform duration-200"
                        :class="{ '-rotate-90': !isExpanded(build.id, row.key) }"
                      />
                    </Button>
                    <Button
                      v-if="row.query"
                      variant="ghost"
                      size="icon-sm"
                      data-pob-build-open-new-tab
                      :title="t('pobBuild.openNewTabTitle')"
                      :aria-label="t('pobBuild.openNewTabTitle')"
                      @click.stop="openSearch(build.id, row, 'new-tab')"
                    >
                      <ExternalLink />
                    </Button>
                    <Button
                      variant="ghost-destructive"
                      size="icon-sm"
                      data-pob-build-remove
                      :title="t('pobBuild.removeTitle')"
                      :aria-label="t('pobBuild.removeAria', { name: row.label })"
                      @click.stop="removeEntry(build.id, row.key)"
                    >
                      <X />
                    </Button>
                  </div>
                </div>

                <div
                  v-if="row.mods?.length && isExpanded(build.id, row.key)"
                  data-pob-build-mods
                  class="[--checkbox-size:14px] [--checkbox-indicator-size:9px] border-0 border-b border-dashed border-border bg-muted/20 py-[var(--pxd-space-xs)] pr-[var(--pxd-space-md)] pl-[calc(var(--pxd-space-md)+var(--checkbox-size,18px)+var(--pxd-space-sm))] last:border-b-0 text-[length:var(--pxd-font-caption)]"
                >
                  <ul
                    class="m-0 flex list-none flex-col gap-[2px] border-0 border-l-2 border-solid border-border p-0 pl-[var(--pxd-space-sm)]"
                  >
                    <li
                      v-for="line in modLines(row)"
                      :key="line.index"
                      :data-mod-kind="line.mod.kind"
                      :data-mod-searched="line.mod.searched ? 'true' : 'false'"
                      class="flex items-center gap-[var(--pxd-space-xs)] break-words"
                      :class="[
                        MOD_CLASSES[line.mod.kind],
                        { 'opacity-60': line.mod.stat && !line.mod.searched },
                      ]"
                    >
                      <Checkbox
                        v-if="line.mod.stat"
                        data-pob-build-mod-toggle
                        :model-value="line.mod.searched"
                        :aria-label="t('pobBuild.mods.statAria', { text: line.mod.text })"
                        @update:model-value="
                          (value) =>
                            setStatEnabled(build.id, row.key, line.mod.stat!.id, value === true)
                        "
                      />
                      <span
                        v-else
                        class="size-[var(--checkbox-size)] shrink-0"
                        aria-hidden="true"
                      />
                      <span class="min-w-0 flex-1">{{ line.mod.text }}</span>
                      <template v-if="line.editor">
                        <span class="shrink-0 text-muted-foreground" aria-hidden="true">{{
                          line.editor.bound === 'min' ? '≥' : '≤'
                        }}</span>
                        <input
                          type="number"
                          inputmode="decimal"
                          step="any"
                          data-pob-build-mod-bound
                          :data-bound="line.editor.bound"
                          class="h-5 w-14 shrink-0 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none rounded-sm border border-solid border-input bg-background px-1 text-right text-[length:var(--pxd-font-caption)] text-foreground tabular-nums focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                          :value="line.editor.value ?? ''"
                          :disabled="!line.mod.searched"
                          :aria-label="
                            t(
                              line.editor.bound === 'min'
                                ? 'pobBuild.mods.minAria'
                                : 'pobBuild.mods.maxAria',
                            )
                          "
                          @change="commitBound(build.id, row.key, line.editor, $event)"
                          @keydown.enter.prevent="blurTarget"
                        />
                      </template>
                    </li>
                  </ul>

                  <div
                    v-if="row.filters.length > 0"
                    class="mt-[var(--pxd-space-xs)] flex flex-wrap items-center gap-x-[var(--pxd-space-md)] gap-y-[var(--pxd-space-xs)] text-muted-foreground"
                  >
                    <span class="inline-flex items-center gap-[var(--pxd-space-xs)]">
                      <Checkbox
                        :id="controlId(build.id, row.key, 'count')"
                        data-pob-build-count-mode
                        :model-value="row.countMin !== undefined"
                        @update:model-value="
                          (value) => toggleCountMode(build.id, row, value === true)
                        "
                      />
                      <!-- label 不包住 Checkbox：包住時點一下會被 label 再觸發一次而切回原狀 -->
                      <label :for="controlId(build.id, row.key, 'count')" class="cursor-pointer">{{
                        t('pobBuild.mods.countMode')
                      }}</label>
                    </span>
                    <span
                      v-if="row.countMin !== undefined"
                      class="inline-flex items-center gap-[var(--pxd-space-xs)]"
                    >
                      <input
                        type="number"
                        min="1"
                        :max="enabledCount(row)"
                        step="1"
                        data-pob-build-count-min
                        class="h-5 w-9 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none rounded-sm border border-solid border-input bg-background px-1 text-right text-[length:var(--pxd-font-caption)] text-foreground tabular-nums focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        :value="row.countMin"
                        :aria-label="t('pobBuild.mods.countAria')"
                        @change="commitCountMin(build.id, row, $event)"
                        @keydown.enter.prevent="blurTarget"
                      />
                      <span v-if="t('pobBuild.mods.countUnit')">{{
                        t('pobBuild.mods.countUnit')
                      }}</span>
                    </span>
                    <span
                      v-if="hasPseudo(row)"
                      class="inline-flex items-center gap-[var(--pxd-space-xs)]"
                    >
                      <Checkbox
                        :id="controlId(build.id, row.key, 'pseudo')"
                        data-pob-build-pseudo
                        :model-value="row.pseudo"
                        @update:model-value="
                          (value) => setPseudo(build.id, row.key, value === true)
                        "
                      />
                      <label :for="controlId(build.id, row.key, 'pseudo')" class="cursor-pointer">{{
                        t('pobBuild.mods.pseudo')
                      }}</label>
                    </span>
                    <Button
                      v-if="row.searchCustomized"
                      variant="link"
                      size="sm"
                      data-pob-build-reset-search
                      class="ml-auto h-auto p-0 text-[length:var(--pxd-font-caption)]"
                      @click="resetSearch(build.id, row.key)"
                    >
                      {{ t('pobBuild.mods.reset') }}
                    </Button>
                  </div>
                </div>
              </template>
            </section>
          </template>
        </section>
      </div>

      <p
        v-if="builds.length > 0"
        class="m-0 pt-[var(--pxd-space-md)] text-[length:var(--pxd-font-micro)] leading-relaxed text-muted-foreground"
      >
        {{ t('pobBuild.listHint') }}
      </p>

      <PobBuildImportDialog
        v-model:open="isImportOpen"
        :is-busy="isBusy"
        :error-key="errorKey"
        @submit="handleImport"
        @clear-error="errorKey = null"
      />
    </template>
  </SidebarPane>
</template>

<script lang="ts">
import { computed, defineComponent, nextTick, onMounted, onUnmounted, ref } from 'vue';
import {
  ChevronDown,
  ChevronsUpDown,
  ExternalLink,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import SidebarPane from '../layout/SidebarPane.vue';
import { t, type I18nKey } from '@/utils/i18n';
import { POB_BUILD_NAME_MAX_LENGTH } from '@/utils/pob-build-store';
import {
  isRequiredInCountMode,
  type ShoppingEntry,
  type ShoppingEntryKind,
  type ShoppingMod,
  type ShoppingModKind,
} from '@/utils/pob-shopping-list';
import { getPoeVersion } from '@/utils/trade-context';
import PobBuildImportDialog from './PobBuildImportDialog.vue';
import { formatPobSlot } from './pob-slot-label';
import {
  usePobBuild,
  type BuildView,
  type SetOption,
  type ShoppingRow,
  type StatBound,
} from './usePobBuild';

interface BoundEditor {
  statId: string;
  bound: StatBound;
  value?: number;
}

interface ModLine {
  index: number;
  mod: ShoppingMod;
  /** 數值輸入框；只放在同一個條件的第一行 */
  editor?: BoundEditor;
}

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
  enchant: 'text-[oklch(0.74_0.09_300)]',
  explicit: 'text-foreground',
  crafted: 'text-[oklch(0.72_0.1_230)]',
};

export default defineComponent({
  name: 'PobBuildPane',
  components: {
    Button,
    Checkbox,
    ChevronDown,
    ChevronsUpDown,
    ExternalLink,
    Input,
    Pencil,
    Plus,
    PobBuildImportDialog,
    Search,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Separator,
    SidebarPane,
    Trash2,
    X,
  },
  setup() {
    const version = getPoeVersion();
    const pob = usePobBuild(version);
    const isImportOpen = ref(false);
    const isSearchVisible = ref(false);
    const searchQuery = ref('');
    const searchInputRef = ref<InstanceType<typeof Input> | null>(null);
    const renamingId = ref<string | null>(null);
    const renameInput = ref('');
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

    const activeSetLabel = (options: readonly SetOption[], activeId: string): string => {
      const found = options.find((option) => option.id === activeId);
      return found ? setLabel(found) : '';
    };

    const rowDetail = (entry: ShoppingEntry): string =>
      entry.kind === 'gem'
        ? t('pobBuild.gemDetail', { level: entry.level ?? 1, quality: entry.quality ?? 0 })
        : formatPobSlot(entry.slot ?? '');

    /**
     * 展開後的每一行詞綴。同一個代碼的多行是同一個條件，數值輸入只放在第一行；精確數值
     * （種子編號、附魔）、選項型與沒有數值的條件不能改數值。
     */
    const modLines = (row: ShoppingRow): ModLine[] => {
      const seen = new Set<string>();
      return (row.mods ?? []).map((mod, index) => {
        const stat = mod.stat;
        if (!stat || seen.has(stat.id)) return { index, mod };
        seen.add(stat.id);
        const filter = row.filters.find((entry) => entry.id === stat.id);
        if (!filter || filter.value === undefined || stat.exact) return { index, mod };
        const bound: StatBound = filter.value < 0 ? 'max' : 'min';
        return { index, mod, editor: { statId: stat.id, bound, value: filter[bound] } };
      });
    };

    /** label 與 Checkbox 以 id 連結；key 含分隔字元，轉成只含安全字元的 id */
    const controlId = (buildId: string, key: string, name: string) =>
      `pob-${name}-${Array.from(rowId(buildId, key), (char) => char.charCodeAt(0).toString(36)).join('')}`;

    const blurTarget = (event: Event) => (event.target as HTMLInputElement).blur();

    const commitBound = (buildId: string, key: string, editor: BoundEditor, event: Event) => {
      const raw = (event.target as HTMLInputElement).value.trim();
      const value = raw === '' ? null : Number(raw);
      if (value !== null && !Number.isFinite(value)) return;
      pob.setStatBound(buildId, key, editor.statId, editor.bound, value);
    };

    /** 參與「至少符合 N 項」的條件數（固定詞綴與附魔一定要符合，不算在內） */
    const enabledCount = (row: ShoppingRow) =>
      row.filters.filter((filter) => filter.enabled && !isRequiredInCountMode(filter.id)).length;

    const toggleCountMode = (buildId: string, row: ShoppingRow, on: boolean) => {
      // 預設允許少一項；條件只有一項時就是一項
      pob.setCountMin(buildId, row.key, on ? Math.max(1, enabledCount(row) - 1) : undefined);
    };

    const commitCountMin = (buildId: string, row: ShoppingRow, event: Event) => {
      const value = Math.floor(Number((event.target as HTMLInputElement).value));
      if (!Number.isFinite(value) || value < 1) return;
      pob.setCountMin(buildId, row.key, value);
    };

    const hasPseudo = (row: ShoppingRow) => row.mods?.some((mod) => mod.stat?.pseudo) ?? false;

    const nameClass = (entry: ShoppingEntry): string =>
      entry.kind === 'gem' ? GEM_CLASS : (RARITY_CLASSES[entry.rarity ?? 'NORMAL'] ?? '');

    const isFiltering = computed(() => searchQuery.value.trim().length > 0);

    const visibleBuilds = computed<BuildView[]>(() => {
      const needle = searchQuery.value.trim().toLowerCase();
      if (!needle) return pob.builds.value;
      return pob.builds.value
        .map((build) => ({
          ...build,
          groups: build.groups
            .map((group) => ({
              ...group,
              rows: group.rows.filter(
                (entry) =>
                  entry.label.toLowerCase().includes(needle) ||
                  // 名稱以顯示語言呈現，英文原名也要找得到
                  entry.englishName.toLowerCase().includes(needle) ||
                  rowDetail(entry).toLowerCase().includes(needle),
              ),
            }))
            .filter((group) => group.rows.length > 0),
        }))
        .filter((build) => build.groups.length > 0);
    });

    const isAllCollapsed = computed(
      () => pob.builds.value.length > 0 && pob.builds.value.every((build) => build.collapsed),
    );

    const toggleExpandAll = () => {
      const targetCollapsed = !isAllCollapsed.value;
      pob.builds.value
        .filter((build) => build.collapsed !== targetCollapsed)
        .forEach((build) => pob.toggleCollapsed(build.id));
    };

    const closeSearch = () => {
      isSearchVisible.value = false;
      searchQuery.value = '';
    };

    const toggleSearch = async () => {
      if (isSearchVisible.value) {
        closeSearch();
        return;
      }
      isSearchVisible.value = true;
      await nextTick();
      (searchInputRef.value?.$el as HTMLInputElement | undefined)?.focus?.();
    };

    const openImportDialog = () => {
      isImportOpen.value = true;
    };

    const handleImport = async (code: string) => {
      if (await pob.importCode(code)) {
        isImportOpen.value = false;
      }
    };

    const startRename = (build: BuildView) => {
      renamingId.value = build.id;
      renameInput.value = build.name;
    };

    const focusRenameInput = (el: unknown) => {
      const input = (el as { $el?: HTMLInputElement } | null)?.$el;
      if (input && document.activeElement !== input) {
        void nextTick(() => input.focus?.());
      }
    };

    const commitRename = (buildId: string) => {
      if (renamingId.value !== buildId) return;
      pob.rename(buildId, renameInput.value);
      renamingId.value = null;
    };

    const confirmDeleteBuild = async (build: BuildView) => {
      const confirmed = await (window as any).poexdConfirm?.(
        t('pobBuild.deleteBuildConfirm', { name: build.name }),
        t('pobBuild.deleteBuildTitle'),
      );
      if (!confirmed) return;
      pob.removeBuild(build.id);
    };

    onMounted(() => {
      void pob.restore();
    });
    onUnmounted(() => pob.dispose());

    return {
      t,
      GROUP_TITLE_KEYS,
      MOD_CLASSES,
      NAME_MAX_LENGTH: POB_BUILD_NAME_MAX_LENGTH,
      isImportOpen,
      isSearchVisible,
      searchQuery,
      searchInputRef,
      renamingId,
      renameInput,
      isFiltering,
      visibleBuilds,
      isAllCollapsed,
      isExpanded,
      toggleExpanded,
      showSkillSets,
      setLabel,
      activeSetLabel,
      rowDetail,
      nameClass,
      modLines,
      blurTarget,
      controlId,
      commitBound,
      enabledCount,
      toggleCountMode,
      commitCountMin,
      hasPseudo,
      openImportDialog,
      handleImport,
      toggleExpandAll,
      toggleSearch,
      closeSearch,
      startRename,
      focusRenameInput,
      commitRename,
      confirmDeleteBuild,
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
      resetSearch: pob.resetSearch,
      setStatEnabled: pob.setStatEnabled,
      setPseudo: pob.setPseudo,
    };
  },
});
</script>
