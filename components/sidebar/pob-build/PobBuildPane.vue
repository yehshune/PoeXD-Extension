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
          <span class="pxd-toolbar-btn-text truncate">{{ t('pobBuild.addBuildBtn') }}</span>
        </Button>

        <Button
          variant="outline"
          size="sm"
          class="font-bold shrink-0"
          data-pob-build-expand-all
          :disabled="builds.length === 0"
          :title="isAllCollapsed ? t('common.expandAll') : t('common.collapseAll')"
          @click="toggleExpandAll"
        >
          <ChevronsUpDown />
          <span class="pxd-toolbar-btn-text truncate">
            {{ isAllCollapsed ? t('common.expandAll') : t('common.collapseAll') }}
          </span>
        </Button>

        <Button
          :variant="isSearchVisible ? 'default' : 'outline'"
          size="icon-sm"
          class="shrink-0"
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
          class="pointer-events-none absolute left-[var(--input-padding-x-sm)] size-[var(--control-icon-sm,14px)] text-muted-foreground"
        />
        <Input
          ref="searchInputRef"
          v-model="searchQuery"
          size="sm"
          :placeholder="t('pobBuild.searchPlaceholder')"
          class="w-full pl-[calc(var(--input-padding-x-sm)+var(--control-icon-sm,14px)+var(--pxd-space-sm))] pr-[calc(var(--control-height-sm)+var(--pxd-space-xs))]"
          data-pob-build-filter
          @keydown.esc.stop.prevent="closeSearch"
        />
        <Button
          v-if="searchQuery"
          variant="ghost"
          size="icon-sm"
          class="absolute right-[var(--pxd-space-xs)]"
          :title="t('common.clearSearch')"
          @click="searchQuery = ''"
        >
          <X />
        </Button>
      </div>

      <div
        v-if="errorKey && !isImportOpen"
        role="alert"
        data-pob-build-error
        class="mb-[var(--pxd-space-md)] rounded-md border border-destructive/40 bg-destructive/10 px-[var(--pxd-space-md)] py-[var(--pxd-space-xs)] text-[length:var(--pxd-font-secondary)] text-destructive"
      >
        {{ t(errorKey) }}
      </div>
    </template>

    <template #scroll>
      <div
        v-if="isLoading && builds.length === 0"
        data-pob-build-loading
        role="status"
        class="flex flex-col items-center justify-center gap-[var(--pxd-space-sm)] px-[var(--pxd-space-md)] py-[var(--pxd-space-2xl)] text-center text-[length:var(--pxd-font-secondary)] text-muted-foreground"
      >
        <Loader2 class="size-5 animate-spin opacity-60" aria-hidden="true" />
        <p class="m-0 leading-relaxed">{{ t('pobBuild.loading') }}</p>
      </div>

      <SidebarEmptyState
        v-else-if="builds.length === 0"
        :message="t('pobBuild.description')"
        data-pob-build-empty-state
      >
        <template #icon><ShoppingCart /></template>
        <template #actions>
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
        </template>
      </SidebarEmptyState>

      <SidebarFilterEmptyState
        v-else-if="visibleBuilds.length === 0"
        data-pob-build-no-match
        mode="search"
        :message="t('pobBuild.noMatch', { query: searchQuery.trim() })"
        @reset="searchQuery = ''"
      />

      <div v-else class="flex flex-col gap-[var(--pxd-bookmark-tree-gap)]">
        <section
          v-for="build in visibleBuilds"
          :key="build.id"
          class="rounded-md border border-border bg-card overflow-hidden"
          data-pob-build
        >
          <header
            class="group relative flex items-center justify-between cursor-pointer select-none border-0 border-solid border-l-2 border-l-primary bg-card hover:bg-muted/50 has-[[data-state=open]]:bg-muted/50 py-[var(--pxd-bookmark-folder-header-padding-y)] px-[var(--pxd-space-lg)]"
            :class="{ 'border-b border-border': !build.collapsed || isFiltering }"
            @click="toggleCollapsed(build.id)"
          >
            <div class="flex w-full min-w-0 items-center gap-[var(--pxd-space-sm)]">
              <button
                type="button"
                data-pob-build-toggle
                class="inline-flex shrink-0 items-center justify-center border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground cursor-pointer"
                :aria-expanded="!build.collapsed || isFiltering"
                :aria-label="t('pobBuild.toggleGroupAria', { name: build.name })"
                @click.stop="toggleCollapsed(build.id)"
              >
                <ChevronDown
                  class="size-[var(--control-icon-sm,14px)] transition-transform duration-200"
                  :class="{ '-rotate-90': build.collapsed && !isFiltering }"
                />
              </button>

              <FolderIcon v-if="build.icon" :icon="build.icon" data-pob-build-icon />

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
                  class="min-w-0 flex-1 truncate text-[length:var(--pxd-font-section-title)] font-bold text-foreground"
                  data-pob-build-name
                  :title="build.name"
                >
                  {{ build.name }}
                </span>

                <EyeOff
                  v-if="build.hideDone"
                  data-pob-build-hide-done-indicator
                  class="size-[var(--control-icon-sm,14px)] shrink-0 text-primary group-hover:opacity-0"
                  :class="{ 'opacity-0': isHeaderActive(build.id) }"
                  :aria-label="t('pobBuild.hideDoneOn')"
                />
                <span
                  class="shrink-0 text-[length:var(--pxd-font-caption)] text-muted-foreground tabular-nums group-hover:opacity-0"
                  :class="{ 'opacity-0': isHeaderActive(build.id) }"
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
              :class="{ '!opacity-100 !pointer-events-auto': isHeaderActive(build.id) }"
              class="pxd-hover-actions-overlay [--pxd-hover-overlay-bg:color-mix(in_srgb,var(--muted)_50%,var(--card))] absolute inset-y-0 right-0 z-(--pxd-z-raised) pr-[var(--pxd-space-lg)] pl-[var(--pxd-space-2xl)] opacity-0 pointer-events-none transition-opacity duration-150 group-hover:opacity-100 group-hover:pointer-events-auto flex items-center"
              @click.stop
            >
              <Button
                :variant="build.hideDone ? 'secondary' : 'ghost'"
                size="icon-sm"
                data-pob-build-hide-done
                :aria-pressed="build.hideDone"
                :title="t(build.hideDone ? 'pobBuild.showDone' : 'pobBuild.hideDone')"
                :aria-label="t(build.hideDone ? 'pobBuild.showDone' : 'pobBuild.hideDone')"
                @click.stop="setHideDone(build.id, !build.hideDone)"
              >
                <EyeOff v-if="build.hideDone" />
                <Eye v-else />
              </Button>
              <PobBuildSearchSettings
                :open="isSettingsOpen(build.id)"
                :build-name="build.name"
                :defaults="build.searchDefaults"
                @update:open="(open) => setSettingsOpen(build.id, open)"
                @change="(defaults) => setSearchDefaults(build.id, defaults)"
              />
              <DropdownMenu
                :open="isBuildMenuOpen(build.id)"
                @update:open="(open) => setBuildMenuOpen(build.id, open)"
              >
                <DropdownMenuTrigger as-child>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    data-pob-build-menu
                    :title="t('common.moreActions')"
                    :aria-label="t('common.moreActions')"
                    @click.stop
                  >
                    <Ellipsis />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  v-if="isBuildMenuOpen(build.id)"
                  align="end"
                  @close-auto-focus="
                    (e) => {
                      if (renamingId) e.preventDefault();
                    }
                  "
                >
                  <DropdownMenuItem data-pob-build-update-code @click="openUpdateDialog(build)">
                    <RefreshCw class="text-muted-foreground" />
                    {{ t('pobBuild.updateCodeTitle') }}
                  </DropdownMenuItem>
                  <DropdownMenuItem data-pob-build-rename @click="startRename(build)">
                    <Pencil class="text-muted-foreground" />
                    {{ t('common.rename') }}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    data-pob-build-delete
                    @click="confirmDeleteBuild(build)"
                  >
                    <Trash2 class="text-destructive" />
                    {{ t('pobBuild.deleteBuildTitle') }}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>

          <template v-if="!build.collapsed || isFiltering">
            <div
              v-if="
                !isFiltering &&
                (build.itemSetOptions.length > 1 ||
                  showSkillSets(build) ||
                  build.removedCount > 0 ||
                  buildCategories(build).length > 1 ||
                  hasEquipment(build))
              "
              class="flex flex-col gap-[var(--pxd-space-sm)] border-b border-border bg-muted/20 px-[var(--pxd-space-md)] py-[var(--pxd-space-sm)]"
            >
              <div
                v-if="hasEquipment(build)"
                class="flex items-center justify-between gap-[var(--pxd-space-md)]"
              >
                <span
                  class="shrink-0 text-[length:var(--pxd-font-secondary)] text-muted-foreground"
                >
                  {{ t('pobBuild.view.label') }}
                </span>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  class="w-[62%]"
                  data-pob-build-view
                  :model-value="viewMode(build)"
                  @update:model-value="(value) => setViewMode(build.id, value)"
                >
                  <ToggleGroupItem
                    v-for="mode in VIEW_MODES"
                    :key="mode"
                    :value="mode"
                    class="flex-1"
                    :data-pob-build-view-option="mode"
                  >
                    {{ t(mode === 'gear' ? 'pobBuild.view.gear' : 'pobBuild.view.list') }}
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>

              <div
                v-if="build.itemSetOptions.length > 1"
                class="flex items-center justify-between gap-[var(--pxd-space-md)]"
              >
                <span
                  class="shrink-0 text-[length:var(--pxd-font-secondary)] text-muted-foreground"
                >
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
                <span
                  class="shrink-0 text-[length:var(--pxd-font-secondary)] text-muted-foreground"
                >
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

              <div v-if="build.removedCount > 0" class="flex items-center">
                <Button
                  variant="link"
                  size="sm"
                  data-pob-build-restore-removed
                  class="ml-auto h-auto p-0 text-[length:var(--pxd-font-secondary)]"
                  @click="restoreRemoved(build.id)"
                >
                  {{ t('pobBuild.restoreRemoved', { count: build.removedCount }) }}
                </Button>
              </div>

              <div
                v-if="buildCategories(build).length > 1 && !isGearView(build)"
                data-pob-build-category-filter
                class="flex flex-wrap items-center gap-[var(--pxd-space-xs)]"
              >
                <button
                  v-for="cat in ['all', ...buildCategories(build)] as const"
                  :key="cat"
                  type="button"
                  :data-pob-build-category="cat"
                  :aria-pressed="activeCategory(build) === cat"
                  class="inline-flex cursor-pointer items-center rounded-sm border px-[var(--pxd-space-sm)] py-[1px] text-[length:var(--pxd-font-caption)] font-medium transition-colors"
                  :class="
                    activeCategory(build) === cat
                      ? 'border-primary/50 bg-primary/15 text-primary'
                      : 'border-border bg-background/60 text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                  "
                  @click="setActiveCategory(build.id, cat)"
                >
                  {{ categoryLabel(cat) }}
                </button>
              </div>
            </div>

            <PobGearView
              v-if="isGearView(build)"
              :rows="equipmentRows(build)"
              :active-key="pinnedPreviewKey(build.id)"
              :reveal-sockets="isAltHeld"
              @select="(row, event) => handleGearSelect(build.id, row, event)"
              @hover="(row, event) => hoverPreview(build.id, row, event)"
              @leave="leavePreviewTrigger"
              @toggle-done="(key) => toggleDone(build.id, key)"
              @select-content="(content, event) => selectSocketContent(build, content, event)"
              @weapon-set-change="closePreview"
            />

            <p
              v-if="listGroups(build).length === 0 && !isGearView(build)"
              class="m-0 bg-card px-[var(--pxd-space-md)] py-[var(--pxd-space-lg)] text-center text-[length:var(--pxd-font-secondary)] text-muted-foreground"
              data-pob-build-empty
            >
              {{
                build.hideDone && build.progress.done > 0
                  ? t('pobBuild.allDoneHidden', { count: build.progress.done })
                  : t('pobBuild.empty')
              }}
            </p>

            <section
              v-for="group in listGroups(build)"
              :key="group.id"
              class="flex flex-col bg-card border-b border-border last:border-b-0"
              :data-pob-build-group="group.kind"
              :data-pob-build-group-id="group.id"
            >
              <h4
                role="button"
                tabindex="0"
                data-pob-build-group-toggle
                :aria-expanded="!isGroupCollapsed(build, group.id)"
                :aria-label="t('pobBuild.toggleGroupAria', { name: groupTitle(group) })"
                :class="{ 'border-b border-border': !isGroupCollapsed(build, group.id) }"
                class="m-0 flex cursor-pointer items-center justify-between gap-[var(--pxd-space-sm)] bg-muted/35 hover:bg-muted/55 px-[var(--pxd-space-md)] py-[var(--pxd-space-sm)] text-[length:var(--pxd-font-body)] font-bold text-foreground select-none transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                @click="toggleGroupCollapsed(build.id, group.id)"
                @keydown.enter.prevent="toggleGroupCollapsed(build.id, group.id)"
                @keydown.space.prevent="toggleGroupCollapsed(build.id, group.id)"
              >
                <span class="min-w-0 truncate">{{ groupTitle(group) }}</span>
                <span
                  class="inline-flex shrink-0 items-center gap-[var(--pxd-space-xs)] text-[length:var(--pxd-font-caption)] font-semibold tabular-nums"
                  :class="isGroupAllDone(group) ? 'text-primary' : 'text-muted-foreground'"
                  data-pob-build-group-count
                >
                  <span>{{ groupCountLabel(group) }}</span>
                  <ChevronDown
                    class="size-[var(--control-icon-sm,14px)] transition-transform duration-150"
                    :class="{ '-rotate-90': isGroupCollapsed(build, group.id) }"
                    aria-hidden="true"
                  />
                </span>
              </h4>

              <template v-if="!isGroupCollapsed(build, group.id)">
                <template v-for="row in group.rows" :key="row.key">
                  <div
                    data-pob-build-row
                    :data-done="row.done ? 'true' : 'false'"
                    :class="[
                      isPreviewPinned(build.id, row.key)
                        ? 'bg-primary/12 hover:bg-primary/15 has-[[data-state=open]]:bg-primary/15 shadow-[inset_2px_0_0_var(--primary)]'
                        : 'hover:bg-muted/40 has-[[data-state=open]]:bg-muted/40',
                    ]"
                    class="group/row relative flex items-center gap-[var(--pxd-space-sm)] border-0 border-b border-dashed border-border px-[var(--pxd-space-md)] py-[var(--pxd-bookmark-row-padding-y)] last:border-b-0 transition-colors"
                  >
                    <Checkbox
                      :model-value="row.done"
                      :aria-label="t('pobBuild.doneAria', { name: row.label })"
                      data-pob-build-done
                      @update:model-value="toggleDone(build.id, row.key)"
                    />

                    <span
                      :aria-hidden="row.icon ? undefined : 'true'"
                      :data-pob-build-icon-hover="row.icon ? '' : undefined"
                      :data-pob-build-icon-placeholder="row.icon ? undefined : ''"
                      class="flex size-[var(--control-height-sm)] shrink-0 items-center justify-center"
                      :class="{
                        'opacity-50': row.done,
                        'cursor-pointer': canPreview(row),
                        'rounded-sm border border-border bg-muted text-[length:var(--pxd-font-micro)] font-bold text-muted-foreground':
                          !row.icon,
                      }"
                      @click.stop="canPreview(row) && togglePreview(build.id, row.key, $event)"
                      @mouseenter="hoverPreview(build.id, row, $event)"
                      @mouseleave="leavePreviewTrigger"
                    >
                      <PobItemImage
                        v-if="row.icon"
                        data-pob-build-icon
                        class="max-h-full max-w-full object-contain"
                        :src="row.icon"
                        :layers="row.iconLayers"
                        :width="row.iconSize?.width"
                        :height="row.iconSize?.height"
                        :foulborn="row.foulborn && !row.iconFoulborn"
                      />
                      <template v-else>?</template>
                    </span>

                    <component
                      :is="canSearch(row) ? 'a' : 'button'"
                      :type="canSearch(row) ? undefined : 'button'"
                      :disabled="canSearch(row) ? undefined : true"
                      :href="canSearch(row) ? resolveSearchUrl(build.id, row) : undefined"
                      :tabindex="canSearch(row) ? 0 : undefined"
                      :draggable="canSearch(row) ? 'false' : undefined"
                      data-pob-build-search
                      class="flex min-h-[var(--control-height-sm)] min-w-0 flex-1 items-center justify-between gap-[var(--pxd-space-sm)] rounded-sm border-0 bg-transparent p-0 text-left text-[length:var(--pxd-font-body)] text-foreground no-underline cursor-pointer disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      :class="{
                        'line-through opacity-50': row.done,
                        'opacity-60': !canSearch(row),
                      }"
                      :title="rowTooltip(row)"
                      @click.prevent="handleEntryPrimaryClick(build.id, row, $event)"
                      @auxclick="handleEntryAuxClick(build.id, row, $event)"
                      @keydown.enter.prevent="handleEntryPrimaryClick(build.id, row, $event)"
                      @keydown.space.prevent="toggleDone(build.id, row.key)"
                    >
                      <span class="flex min-w-0 items-baseline gap-[var(--pxd-space-xs)]">
                        <span class="min-w-0 truncate font-medium" :class="nameClass(row)">{{
                          row.label
                        }}</span>
                        <span
                          v-if="row.suffix"
                          data-pob-build-suffix
                          class="shrink-0 text-[length:var(--pxd-font-caption)] text-muted-foreground tabular-nums"
                          >{{ row.suffix }}</span
                        >
                        <span
                          v-if="row.foulborn"
                          data-pob-build-foulborn
                          class="shrink-0 text-[length:var(--pxd-font-caption)] font-semibold text-[var(--pxd-foulborn)]"
                          >{{ t('pobBuild.foulborn') }}</span
                        >
                        <span
                          v-if="row.corrupted"
                          data-pob-build-corrupted
                          class="shrink-0 text-[length:var(--pxd-font-caption)] font-semibold text-[var(--pxd-corrupted)]"
                          >{{ t('pobBuild.corrupted') }}</span
                        >
                        <span
                          v-if="row.count > 1"
                          data-pob-build-count
                          class="shrink-0 rounded-sm bg-muted px-[var(--pxd-space-xs)] text-[length:var(--pxd-font-caption)] font-bold text-foreground tabular-nums"
                          :title="t('pobBuild.countTitle', { count: row.count })"
                          >×{{ row.count }}</span
                        >
                        <span
                          v-if="row.searchCustomized"
                          data-pob-build-customized
                          role="img"
                          class="size-[6px] shrink-0 self-center rounded-full bg-primary"
                          :title="t('pobBuild.customizedTitle')"
                          :aria-label="t('pobBuild.customizedTitle')"
                        />
                      </span>
                      <span
                        class="flex shrink-0 items-center gap-[var(--pxd-space-xs)] text-[length:var(--pxd-font-caption)] text-muted-foreground group-hover/row:opacity-0"
                        :class="{ 'opacity-0': isMenuOpen(build.id, row.key) }"
                      >
                        <span>{{ rowDetail(row) }}</span>
                      </span>
                    </component>

                    <div
                      :class="[
                        isPreviewPinned(build.id, row.key)
                          ? '[--pxd-hover-overlay-bg:color-mix(in_srgb,var(--primary)_15%,var(--card))]'
                          : '[--pxd-hover-overlay-bg:color-mix(in_srgb,var(--muted)_40%,var(--card))]',
                        { '!opacity-100 !pointer-events-auto': isMenuOpen(build.id, row.key) },
                      ]"
                      class="pxd-hover-actions-overlay absolute inset-y-0 right-0 z-(--pxd-z-raised) flex items-center gap-[var(--pxd-space-xs)] pr-[var(--pxd-space-md)] pl-[var(--pxd-space-2xl)] opacity-0 pointer-events-none transition-opacity duration-150 group-hover/row:opacity-100 group-hover/row:pointer-events-auto"
                    >
                      <Button
                        v-if="searchEntryClickAction === 'preview' && canSearch(row)"
                        variant="ghost"
                        size="icon-sm"
                        data-pob-build-open
                        :title="t('pobBuild.searchCurrentBtn')"
                        :aria-label="t('pobBuild.searchCurrentBtn')"
                        @click.stop="openSearch(build.id, row, 'current')"
                      >
                        <ArrowRight />
                      </Button>
                      <Button
                        v-else-if="canPreview(row)"
                        variant="ghost"
                        size="icon-sm"
                        :class="
                          isPreviewPinned(build.id, row.key)
                            ? 'text-primary bg-primary/15'
                            : undefined
                        "
                        data-pob-build-mods-toggle
                        :aria-expanded="isPreviewPinned(build.id, row.key)"
                        :title="t('pobBuild.toggleModsTitle')"
                        :aria-label="t('pobBuild.toggleModsTitle')"
                        @click.stop="togglePreview(build.id, row.key, $event)"
                        @mouseenter="hoverPreview(build.id, row, $event)"
                        @mouseleave="leavePreviewTrigger"
                      >
                        <SlidersHorizontal />
                      </Button>
                      <Button
                        v-if="canSearch(row)"
                        variant="ghost"
                        size="icon-sm"
                        data-pob-build-open-new-tab
                        :title="t('pobBuild.openNewTabTitle')"
                        :aria-label="t('pobBuild.openNewTabTitle')"
                        @click.stop="openSearch(build.id, row, 'new-tab')"
                      >
                        <ExternalLink />
                      </Button>
                      <DropdownMenu
                        :open="isMenuOpen(build.id, row.key)"
                        @update:open="(open) => setMenuOpen(build.id, row.key, open)"
                      >
                        <DropdownMenuTrigger as-child>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            data-pob-build-more
                            :title="t('common.moreActions')"
                            :aria-label="t('common.moreActions')"
                            @click.stop
                          >
                            <Ellipsis />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          v-if="isMenuOpen(build.id, row.key)"
                          align="end"
                          class="max-h-[min(calc(var(--pxd-menu-max-height,240px)_*_1.5),var(--reka-dropdown-menu-content-available-height,calc(100vh-32px)))]"
                        >
                          <DropdownMenuItem
                            :disabled="!canSearch(row)"
                            data-pob-build-send-console
                            @click="sendToLiveSearch(build.id, row)"
                          >
                            <Send class="text-muted-foreground" />
                            {{ t('common.sendToConsole') }}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            :disabled="!canSearch(row)"
                            data-pob-build-open-live
                            @click="openLiveSearch(build.id, row)"
                          >
                            <Radio class="text-muted-foreground" />
                            {{ t('common.openLiveSearch') }}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            data-pob-build-save-current
                            @click="saveCurrentSearch(build.id, row)"
                          >
                            <Save class="text-muted-foreground" />
                            {{ t('pobBuild.saveCurrentSearch') }}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            v-if="row.searchCustomized"
                            data-pob-build-menu-reset
                            @click="resetSearch(build.id, row.key)"
                          >
                            <RotateCcw class="text-muted-foreground" />
                            {{ t('pobBuild.mods.reset') }}
                          </DropdownMenuItem>
                          <DropdownMenuSub>
                            <DropdownMenuSubTrigger
                              :disabled="!canSearch(row)"
                              data-pob-build-add-bookmark
                            >
                              <BookmarkPlus class="text-muted-foreground" />
                              {{ t('common.addToBookmarks') }}
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent
                              class="w-[var(--pxd-menu-sub-width,192px)] max-h-[min(var(--pxd-menu-sub-max-height,180px),var(--reka-dropdown-menu-content-available-height,calc(100vh-32px)))] overflow-y-auto pxd-scrollbar"
                            >
                              <DropdownMenuItem
                                data-pob-build-create-bookmark-folder
                                @click="addToNewBuildFolder(build.id, row)"
                              >
                                <FolderPlus class="shrink-0 text-muted-foreground" />
                                <span class="min-w-0 flex-1 truncate">{{
                                  t('pobBuild.createBuildFolder')
                                }}</span>
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                v-if="bookmarkFolders === null"
                                disabled
                                class="text-muted-foreground"
                              >
                                {{ t('common.loading') }}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                v-else-if="bookmarkFolders.length === 0"
                                disabled
                                class="text-muted-foreground"
                              >
                                {{ t('pobBuild.noFolders') }}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                v-for="folder in bookmarkFolders ?? []"
                                :key="folder.id"
                                data-pob-build-bookmark-folder
                                @click="addToBookmarks(build.id, row, folder.id)"
                              >
                                <span
                                  v-if="getFolderItemIndentLevel(folder.depth) > 0"
                                  class="flex shrink-0 items-center -mr-[var(--control-gap-sm)]"
                                  aria-hidden="true"
                                >
                                  <span
                                    v-for="step in getFolderItemIndentLevel(folder.depth)"
                                    :key="step"
                                    class="w-[var(--pxd-space-md)] shrink-0"
                                  />
                                </span>
                                <FolderIcon :icon="folder.icon" :color="folder.color" />
                                <span class="min-w-0 flex-1 truncate">{{ folder.name }}</span>
                              </DropdownMenuItem>
                            </DropdownMenuSubContent>
                          </DropdownMenuSub>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            data-pob-build-remove
                            @click="removeEntry(build.id, row.key)"
                          >
                            <Trash2 class="text-destructive" />
                            {{ t('pobBuild.removeTitle') }}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </template>
              </template>
            </section>
          </template>
        </section>
      </div>

      <p
        v-if="builds.length > 0"
        class="m-0 pt-[var(--pxd-space-md)] text-[length:var(--pxd-font-caption)] leading-relaxed text-muted-foreground"
      >
        {{ t('pobBuild.listHint') }}
      </p>

      <PobEntryPreviewPopover
        :open="isPreviewOpen"
        :pinned="previewPinned"
        :side="sidebarPosition === 'left' ? 'right' : 'left'"
        :reference="previewAnchor"
        :build-id="activePreview?.buildId ?? ''"
        :effective-row="activeEffectiveRow"
        :is-draft-modified="isActiveDraftModified"
        :row-detail-text="activePreview ? rowDetail(activePreview.row) : ''"
        :name-class="activePreview ? nameClass(activePreview.row) : ''"
        :search-defaults="activePreviewDefaults"
        @pointerdown="pinPreview"
        @focusin="pinPreview"
        @update:open="(open) => !open && closePreview()"
        @update-draft="updateActiveDraft"
        @save-draft="saveActiveDraft"
        @discard-draft="discardActiveDraft"
        @reset-search="
          () => activePreview && resetSearch(activePreview.buildId, activePreview.row.key)
        "
        @open-search="(mode, row) => activePreview && openSearch(activePreview.buildId, row, mode)"
      />

      <PobBuildImportDialog
        v-model:open="isImportOpen"
        :is-busy="isBusy"
        :error-key="errorKey"
        :mode="updateTarget ? 'update' : 'import'"
        :build-name="updateTarget?.name ?? ''"
        @submit="handleImport"
        @clear-error="errorKey = null"
        @open-permission="openSharePermissionPage"
      />
    </template>
  </SidebarPane>
</template>

<script lang="ts">
import {
  computed,
  defineComponent,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  watch,
  type PropType,
} from 'vue';
import { useDebouncedRef } from '../composables/useDebouncedSearch';
import {
  ArrowRight,
  BookmarkPlus,
  ChevronDown,
  ChevronsUpDown,
  Ellipsis,
  ExternalLink,
  Eye,
  EyeOff,
  FolderPlus,
  Loader2,
  Pencil,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  ShoppingCart,
  SlidersHorizontal,
  Trash2,
  X,
} from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import SidebarPane from '../layout/SidebarPane.vue';
import SidebarEmptyState from '../layout/SidebarEmptyState.vue';
import SidebarFilterEmptyState from '../layout/SidebarFilterEmptyState.vue';
import { rowAnchorFromEvent } from '../composables/useTradeSearchPreview';
import type { PreviewAnchor } from '../item-preview/preview-classes';
import { t, type I18nKey } from '@/utils/i18n';
import { POB_BUILD_NAME_MAX_LENGTH } from '@/utils/pob-build-store';
import type { ShoppingEntry } from '@/utils/pob-shopping-list';
import { getPreferences } from '@/utils/preferences';
import { DEFAULT_PREFERENCES, type SearchEntryClickAction } from '@/utils/preferences-contract';
import { getPoeVersion } from '@/utils/trade-context';
import FolderIcon from '../FolderIcon.vue';
import { getFolderItemIndentLevel } from '../bookmark-tree';
import PobBuildImportDialog from './PobBuildImportDialog.vue';
import PobBuildSearchSettings from './PobBuildSearchSettings.vue';
import PobEntryPreviewPopover from './PobEntryPreviewPopover.vue';
import PobGearView from './PobGearView.vue';
import PobItemImage from './PobItemImage.vue';
import type { PobBookmarkFolder } from './pob-bookmark-bridge';
import { formatPobSlot } from './pob-slot-label';
import { usePobBuild } from './usePobBuild';
import type {
  BuildView,
  SetOption,
  ShoppingGroup,
  ShoppingRow,
  SocketContent,
} from './pob-build-view';
import {
  usePobWorkspaceSession,
  VIEW_MODES,
  type ShoppingCategory,
} from './usePobWorkspaceSession';

// 稀有度與技能寶石顏色統一引用 CSS 語意變數，自動隨明暗配色切換高對比色票
const RARITY_CLASSES: Readonly<Record<string, string>> = {
  UNIQUE: 'text-[var(--pxd-rarity-unique)]',
  RELIC: 'text-[var(--pxd-rarity-unique)]',
  RARE: 'text-[var(--pxd-rarity-rare)]',
  MAGIC: 'text-[var(--pxd-rarity-magic)]',
  NORMAL: 'text-foreground',
};
const GEM_CLASS = 'text-[var(--pxd-rarity-gem)]';
/** 預覽 Popover 的定位元素：清單的列或裝備欄的格子 */
const PREVIEW_ANCHOR = '[data-pob-build-row], [data-pob-build-gear-tile]';

export default defineComponent({
  name: 'PobBuildPane',
  props: {
    sidebarPosition: {
      type: String as PropType<'left' | 'right'>,
      default: 'left',
    },
    /** 此分頁是否正處於可見狀態（v-show 隱藏或側欄收合時為 false，停用全域 Alt 監聽） */
    active: {
      type: Boolean,
      default: true,
    },
  },
  components: {
    ArrowRight,
    BookmarkPlus,
    Button,
    Checkbox,
    ChevronDown,
    ChevronsUpDown,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
    Ellipsis,
    ExternalLink,
    Eye,
    EyeOff,
    FolderIcon,
    FolderPlus,
    Input,
    Loader2,
    Pencil,
    Plus,
    PobBuildImportDialog,
    PobBuildSearchSettings,
    PobEntryPreviewPopover,
    PobGearView,
    PobItemImage,
    ToggleGroup,
    ToggleGroupItem,
    Radio,
    RefreshCw,
    RotateCcw,
    Save,
    Search,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Send,
    Separator,
    ShoppingCart,
    SidebarEmptyState,
    SidebarFilterEmptyState,
    SidebarPane,
    SlidersHorizontal,
    Trash2,
    X,
  },
  setup(props) {
    const version = getPoeVersion();
    const pob = usePobBuild(version);
    const isLoading = ref(true);
    const isImportOpen = ref(false);
    /** 匯入對話框以「更新代碼」模式開啟時的目標 build */
    const updateTarget = ref<{ id: string; name: string } | null>(null);
    const isSearchVisible = ref(false);
    const searchQuery = ref('');
    const debouncedSearchQuery = useDebouncedRef(searchQuery);
    const searchInputRef = ref<InstanceType<typeof Input> | null>(null);
    const renamingId = ref<string | null>(null);
    const renameInput = ref('');
    /** 目前開啟「更多動作」選單的那一列 */
    const openMenuRow = ref<string | null>(null);
    /** 目前開啟操作選單的那份 build */
    const openBuildMenuId = ref<string | null>(null);
    /** 書籤資料夾；null 表示載入中 */
    const bookmarkFolders = ref<PobBookmarkFolder[] | null>(null);

    const rowId = (buildId: string, key: string) => `${buildId}\u0000${key}`;

    const isBuildMenuOpen = (buildId: string) => openBuildMenuId.value === buildId;
    const setBuildMenuOpen = (buildId: string, open: boolean) => {
      if (!open) {
        if (openBuildMenuId.value === buildId) openBuildMenuId.value = null;
        return;
      }
      openBuildMenuId.value = buildId;
    };

    /** 目前開啟整體搜尋設定的那份 build */
    const openSettingsId = ref<string | null>(null);
    const isSettingsOpen = (buildId: string) => openSettingsId.value === buildId;
    const setSettingsOpen = (buildId: string, open: boolean) => {
      if (open) openSettingsId.value = buildId;
      else if (openSettingsId.value === buildId) openSettingsId.value = null;
    };
    /** 標題的懸停操作在選單或設定開啟時保持顯示 */
    const isHeaderActive = (buildId: string) => isBuildMenuOpen(buildId) || isSettingsOpen(buildId);

    const isMenuOpen = (buildId: string, key: string) => openMenuRow.value === rowId(buildId, key);
    const setMenuOpen = (buildId: string, key: string, open: boolean) => {
      const id = rowId(buildId, key);
      if (!open) {
        if (openMenuRow.value === id) openMenuRow.value = null;
        return;
      }
      openMenuRow.value = id;
      // 每次開啟都重新讀資料夾，書籤面板的變動才會反映在這裡
      bookmarkFolders.value = null;
      void pob.listBookmarkFolders().then((folders) => {
        if (openMenuRow.value === id) bookmarkFolders.value = folders;
      });
    };

    const searchEntryClickAction = ref<SearchEntryClickAction>(
      DEFAULT_PREFERENCES.searchEntryClickAction,
    );

    const showSkillSets = (build: BuildView) => build.skillSetOptions.length > 1;

    const setLabel = (option: SetOption): string =>
      option.title || t('pobBuild.unnamedSet', { n: option.position });

    const activeSetLabel = (options: readonly SetOption[], activeId: string): string => {
      const found = options.find((option) => option.id === activeId);
      return found ? setLabel(found) : '';
    };

    const categoryLabel = (category: ShoppingCategory): string => {
      const keys: Record<ShoppingCategory, I18nKey> = {
        all: 'pobBuild.category.all',
        gear: 'pobBuild.category.gear',
        flask: 'pobBuild.category.flask',
        jewel: 'pobBuild.category.jewel',
        gem: 'pobBuild.category.gem',
      };
      return t(keys[category]);
    };

    const groupDoneCount = (group: ShoppingGroup): number =>
      group.rows.filter((row) => row.done).length;

    const groupCountLabel = (group: ShoppingGroup): string => {
      const done = groupDoneCount(group);
      return done > 0 ? `${done}/${group.rows.length}` : String(group.rows.length);
    };

    const isGroupAllDone = (group: ShoppingGroup): boolean =>
      group.rows.length > 0 && groupDoneCount(group) === group.rows.length;

    const groupTitle = (group: ShoppingGroup): string => {
      if (group.kind === 'equipment') return t('pobBuild.group.equipment');
      return group.slot
        ? t('pobBuild.group.gemSlot', { slot: formatPobSlot(group.slot) })
        : t('pobBuild.group.gemLink', { skill: group.skill ?? '' });
    };

    const rowDetail = (entry: ShoppingEntry): string =>
      entry.kind === 'gem'
        ? t('pobBuild.gemDetail', { level: entry.level ?? 1, quality: entry.quality ?? 0 })
        : formatPobSlot(entry.slot ?? '');

    const nameClass = (entry: ShoppingEntry): string =>
      entry.kind === 'gem' ? GEM_CLASS : (RARITY_CLASSES[entry.rarity ?? 'NORMAL'] ?? '');

    const workspace = usePobWorkspaceSession<PreviewAnchor>({
      builds: pob.builds,
      searchQuery: debouncedSearchQuery,
      formatRowDetail: rowDetail,
    });

    const setViewMode = (buildId: string, value: unknown) => {
      // ToggleGroup 再點一次已選的項目會送出空值，維持原選擇
      if (value !== 'list' && value !== 'gear') return;
      workspace.setViewMode(buildId, value);
    };

    /** 預覽的錨點：清單為該列、裝備欄為該物品格，讓詞綴調整框直接出現在物品旁邊 */
    const previewAnchorFromEvent = (event: Event): PreviewAnchor | null =>
      rowAnchorFromEvent(event, PREVIEW_ANCHOR);

    const hoverPreview = (buildId: string, row: ShoppingRow, event: Event) => {
      workspace.hoverPreview(buildId, row, previewAnchorFromEvent(event));
    };

    const togglePreview = (buildId: string, key: string, event: Event) => {
      workspace.togglePreview(buildId, key, previewAnchorFromEvent(event));
    };

    /**
     * 裝備欄的格子：滑鼠移入稍停就開預覽，點擊則開關預覽（固定開著）；Ctrl／⌘ 點擊開新分頁搜尋。
     * 沒有可調的條件時點擊直接搜尋
     */
    const handleGearSelect = (buildId: string, row: ShoppingRow, event: Event) => {
      if (
        workspace.canSearch(row) &&
        event instanceof MouseEvent &&
        (event.ctrlKey || event.metaKey)
      ) {
        pob.openSearch(buildId, row, 'new-tab');
        return;
      }
      if (workspace.canPreview(row)) togglePreview(buildId, row.key, event);
      else if (workspace.canSearch(row)) pob.openSearch(buildId, row, 'current');
    };

    /** 點裝備插槽裡的寶石或深淵珠寶：開關它的設定框，位置對齊所在的裝備格 */
    const selectSocketContent = (build: BuildView, content: SocketContent, event: Event) => {
      workspace.selectSocketContent(build, content, previewAnchorFromEvent(event));
    };

    const rowTooltip = (row: ShoppingRow) => {
      if (!workspace.canSearch(row)) return t('pobBuild.noSearchTitle');
      if (searchEntryClickAction.value === 'preview' && workspace.canPreview(row)) {
        return t('pobBuild.toggleModsTitle');
      }
      return t('pobBuild.searchTitle');
    };

    /** 左鍵／Enter 點擊項目：與書籤、歷史一致，依搜尋點擊設定切換預覽或直接前往搜尋 */
    const handleEntryPrimaryClick = (buildId: string, row: ShoppingRow, event: Event) => {
      if (!workspace.canSearch(row)) return;
      if (event instanceof MouseEvent && (event.ctrlKey || event.metaKey)) {
        pob.openSearch(buildId, row, 'new-tab');
        return;
      }
      if (searchEntryClickAction.value === 'preview' && workspace.canPreview(row)) {
        togglePreview(buildId, row.key, event);
        return;
      }
      pob.openSearch(buildId, row, 'current');
    };

    /** 中鍵點擊 `<a href>`：有有效網址時由瀏覽器原生開新分頁；無聯盟時改走 openSearch 提示錯誤 */
    const handleEntryAuxClick = (buildId: string, row: ShoppingRow, event: MouseEvent) => {
      if (event.button !== 1 || !workspace.canSearch(row)) return;
      if (pob.resolveSearchUrl(buildId, row)) return;
      pob.openSearch(buildId, row, 'new-tab');
    };

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
      updateTarget.value = null;
      isImportOpen.value = true;
    };

    const openUpdateDialog = (build: BuildView) => {
      updateTarget.value = { id: build.id, name: build.name };
      isImportOpen.value = true;
    };

    const handleImport = async (code: string) => {
      const target = updateTarget.value;
      const ok = target ? await pob.updateCode(target.id, code) : await pob.importCode(code);
      if (ok) isImportOpen.value = false;
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

    /** 按住 Alt／AltGraph 鍵時，裝備欄同步顯示所有裝備的插槽技能與鑲嵌物（僅在分頁可見時啟用） */
    const isAltHeld = ref(false);
    const isAltKey = (event: KeyboardEvent) => event.key === 'Alt' || event.key === 'AltGraph';
    const handleAltKeyDown = (event: KeyboardEvent) => {
      if (isAltKey(event)) isAltHeld.value = true;
    };
    const handleAltKeyUp = (event: KeyboardEvent) => {
      if (isAltKey(event)) isAltHeld.value = false;
    };
    const clearAltHeld = () => {
      isAltHeld.value = false;
    };

    let altListenersAttached = false;
    const attachAltListeners = () => {
      if (altListenersAttached) return;
      altListenersAttached = true;
      window.addEventListener('keydown', handleAltKeyDown);
      window.addEventListener('keyup', handleAltKeyUp);
      window.addEventListener('blur', clearAltHeld);
      document.addEventListener('visibilitychange', clearAltHeld);
    };
    const detachAltListeners = () => {
      if (!altListenersAttached) return;
      altListenersAttached = false;
      window.removeEventListener('keydown', handleAltKeyDown);
      window.removeEventListener('keyup', handleAltKeyUp);
      window.removeEventListener('blur', clearAltHeld);
      document.removeEventListener('visibilitychange', clearAltHeld);
      isAltHeld.value = false;
    };

    let mounted = false;
    watch(
      () => props.active,
      (active) => {
        if (!mounted) return;
        if (active) attachAltListeners();
        else detachAltListeners();
      },
    );

    let stopPreferences: (() => void) | undefined;
    let disposed = false;

    onMounted(async () => {
      mounted = true;
      if (props.active) attachAltListeners();
      void getPreferences(version).then((outcome) => {
        if (disposed || !outcome.ok) return;
        stopPreferences = outcome.value.subscribe((snapshot) => {
          searchEntryClickAction.value = snapshot.searchEntryClickAction;
        });
      });
      try {
        await pob.restore();
      } finally {
        isLoading.value = false;
      }
    });
    onUnmounted(() => {
      mounted = false;
      detachAltListeners();
      workspace.dispose();
      disposed = true;
      stopPreferences?.();
      stopPreferences = undefined;
      pob.dispose();
    });

    const saveActiveDraft = () => {
      const saved = workspace.saveActiveDraft();
      if (saved) pob.saveSelection(saved.buildId, saved.rowKey, saved.selection);
    };

    const resetSearch = (buildId: string, key: string) => {
      workspace.clearDraft(buildId, key);
      pob.resetSearch(buildId, key);
    };

    const saveCurrentSearch = (buildId: string, row: ShoppingRow) => {
      workspace.clearDraft(buildId, row.key);
      pob.saveCurrentSearch(buildId, row);
    };

    return {
      t,
      NAME_MAX_LENGTH: POB_BUILD_NAME_MAX_LENGTH,
      isLoading,
      isImportOpen,
      updateTarget,
      isSearchVisible,
      searchQuery,
      searchInputRef,
      renamingId,
      renameInput,
      isFiltering: workspace.isFiltering,
      visibleBuilds: workspace.visibleBuilds,
      isAllCollapsed,
      activePreview: workspace.activePreview,
      activeEffectiveRow: workspace.activeEffectiveRow,
      isActiveDraftModified: workspace.isActiveDraftModified,
      previewAnchor: workspace.previewAnchor,
      isPreviewOpen: workspace.isPreviewOpen,
      previewPinned: workspace.previewPinned,
      isPreviewPinned: workspace.isPreviewPinned,
      pinnedPreviewKey: workspace.pinnedPreviewKey,
      isPreviewActive: workspace.isPreviewActive,
      togglePreview,
      closePreview: workspace.closePreview,
      hoverPreview,
      leavePreviewTrigger: workspace.leavePreviewTrigger,
      pinPreview: workspace.pinPreview,
      updateActiveDraft: workspace.updateActiveDraft,
      saveActiveDraft,
      discardActiveDraft: workspace.discardActiveDraft,
      searchEntryClickAction,
      canSearch: workspace.canSearch,
      canPreview: workspace.canPreview,
      rowTooltip,
      handleEntryPrimaryClick,
      handleEntryAuxClick,
      isBuildMenuOpen,
      setBuildMenuOpen,
      isSettingsOpen,
      setSettingsOpen,
      isHeaderActive,
      activePreviewDefaults: workspace.activePreviewDefaults,
      setSearchDefaults: pob.setSearchDefaults,
      isMenuOpen,
      setMenuOpen,
      bookmarkFolders,
      getFolderItemIndentLevel,
      showSkillSets,
      setLabel,
      activeSetLabel,
      buildCategories: workspace.buildCategories,
      activeCategory: workspace.activeCategory,
      setActiveCategory: workspace.setActiveCategory,
      categoryLabel,
      listGroups: workspace.listGroups,
      VIEW_MODES,
      viewMode: workspace.viewMode,
      setViewMode,
      isGearView: workspace.isGearView,
      isAltHeld,
      hasEquipment: workspace.hasEquipment,
      equipmentRows: workspace.equipmentRows,
      handleGearSelect,
      selectSocketContent,
      isGroupCollapsed: workspace.isGroupCollapsed,
      toggleGroupCollapsed: workspace.toggleGroupCollapsed,
      groupCountLabel,
      isGroupAllDone,
      groupTitle,
      rowDetail,
      nameClass,
      openImportDialog,
      openUpdateDialog,
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
      resolveSearchUrl: pob.resolveSearchUrl,
      resetSearch,
      setHideDone: pob.setHideDone,
      openSharePermissionPage: pob.openSharePermissionPage,
      sendToLiveSearch: pob.sendToLiveSearch,
      openLiveSearch: pob.openLiveSearch,
      saveCurrentSearch,
      addToBookmarks: pob.addToBookmarks,
      addToNewBuildFolder: pob.addToNewBuildFolder,
    };
  },
});
</script>
