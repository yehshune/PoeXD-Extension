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
        class="mb-[var(--pxd-space-md)] rounded-md border border-destructive/40 bg-destructive/10 px-[var(--pxd-space-md)] py-[var(--pxd-space-xs)] text-[length:var(--pxd-font-secondary)] text-destructive"
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
                  class="min-w-0 flex-1 truncate text-[length:var(--pxd-font-section-title)] font-bold text-foreground"
                  data-pob-build-name
                  :title="build.name"
                >
                  {{ build.name }}
                </span>

                <span
                  class="shrink-0 text-[length:var(--pxd-font-caption)] text-muted-foreground tabular-nums"
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
              :class="{ '!opacity-100 !pointer-events-auto': isBuildMenuOpen(build.id) }"
              class="absolute right-[var(--pxd-space-md)] top-1/2 -translate-y-1/2 z-(--pxd-z-raised) bg-[color-mix(in_srgb,var(--muted)_70%,var(--card))] pl-[var(--pxd-space-sm)] opacity-0 pointer-events-none transition-opacity duration-150 group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto flex items-center"
              @click.stop
            >
              <DropdownMenu
                :open="isBuildMenuOpen(build.id)"
                @update:open="(open) => setBuildMenuOpen(build.id, open)"
              >
                <DropdownMenuTrigger as-child>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    data-pob-build-menu
                    :title="t('pobBuild.moreActionsTitle')"
                    :aria-label="t('pobBuild.moreActionsTitle')"
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
                    {{ t('pobBuild.renameTitle') }}
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
                  build.progress.done > 0 ||
                  build.hideDone)
              "
              class="flex flex-col gap-[var(--pxd-space-sm)] border-b border-border bg-muted/20 px-[var(--pxd-space-md)] py-[var(--pxd-space-sm)]"
            >
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

              <div
                v-if="build.removedCount > 0 || build.progress.done > 0 || build.hideDone"
                class="flex items-center gap-[var(--pxd-space-md)]"
              >
                <span
                  v-if="build.progress.done > 0 || build.hideDone"
                  class="inline-flex items-center gap-[var(--pxd-space-xs)] text-[length:var(--pxd-font-secondary)] text-muted-foreground"
                >
                  <Checkbox
                    :id="`pob-hide-done-${build.id}`"
                    data-pob-build-hide-done
                    :model-value="build.hideDone"
                    @update:model-value="(value) => setHideDone(build.id, value === true)"
                  />
                  <label :for="`pob-hide-done-${build.id}`" class="cursor-pointer select-none">{{
                    t('pobBuild.hideDone')
                  }}</label>
                </span>
                <Button
                  v-if="build.removedCount > 0"
                  variant="link"
                  size="sm"
                  data-pob-build-restore-removed
                  class="ml-auto h-auto p-0 text-[length:var(--pxd-font-secondary)]"
                  @click="restoreRemoved(build.id)"
                >
                  {{ t('pobBuild.restoreRemoved', { count: build.removedCount }) }}
                </Button>
              </div>
            </div>

            <p
              v-if="build.groups.length === 0"
              class="m-0 px-[var(--pxd-space-md)] py-[var(--pxd-space-lg)] text-center text-[length:var(--pxd-font-secondary)] text-muted-foreground"
              data-pob-build-empty
            >
              {{
                build.hideDone && build.progress.done > 0
                  ? t('pobBuild.allDoneHidden', { count: build.progress.done })
                  : t('pobBuild.empty')
              }}
            </p>

            <section
              v-for="group in build.groups"
              :key="group.id"
              class="flex flex-col border-b border-border last:border-b-0"
              :data-pob-build-group="group.kind"
              :data-pob-build-group-id="group.id"
            >
              <h4
                class="m-0 flex items-center justify-between gap-[var(--pxd-space-sm)] border-b border-border bg-muted/35 px-[var(--pxd-space-md)] py-[var(--pxd-space-sm)] text-[length:var(--pxd-font-body)] font-bold text-foreground select-none"
              >
                <span class="min-w-0 truncate">{{ groupTitle(group) }}</span>
                <span
                  class="shrink-0 text-[length:var(--pxd-font-caption)] font-semibold text-muted-foreground tabular-nums"
                  >{{ group.rows.length }}</span
                >
              </h4>

              <template v-for="row in group.rows" :key="row.key">
                <div
                  data-pob-build-row
                  :data-done="row.done ? 'true' : 'false'"
                  :class="
                    isPreviewActive(build.id, row.key)
                      ? 'bg-primary/12 hover:bg-primary/15 shadow-[inset_2px_0_0_var(--primary)]'
                      : 'hover:bg-muted/40'
                  "
                  class="group/row relative flex items-center gap-[var(--pxd-space-sm)] border-0 border-b border-dashed border-border px-[var(--pxd-space-md)] py-[var(--pxd-bookmark-row-padding-y)] last:border-b-0 transition-colors"
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
                    class="flex min-h-[var(--control-height-sm)] min-w-0 flex-1 items-center justify-between gap-[var(--pxd-space-sm)] rounded-sm border-0 bg-transparent p-0 text-left text-[length:var(--pxd-font-body)] cursor-pointer disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    :class="{ 'line-through opacity-50': row.done, 'opacity-60': !row.query }"
                    :disabled="!row.query"
                    :title="row.query ? t('pobBuild.searchTitle') : t('pobBuild.noSearchTitle')"
                    @click="openSearch(build.id, row, 'current')"
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
                      class="flex shrink-0 items-center gap-[var(--pxd-space-xs)] text-[length:var(--pxd-font-caption)] text-muted-foreground"
                    >
                      <span>{{ rowDetail(row) }}</span>
                    </span>
                  </button>

                  <Button
                    v-if="row.mods?.length || row.searchOverride"
                    variant="ghost"
                    size="icon-sm"
                    class="-mr-[var(--pxd-space-xs)] shrink-0"
                    :class="
                      isPreviewActive(build.id, row.key)
                        ? 'text-primary bg-primary/15'
                        : 'text-muted-foreground'
                    "
                    data-pob-build-mods-toggle
                    :aria-expanded="isPreviewActive(build.id, row.key)"
                    :title="t('pobBuild.toggleModsTitle')"
                    :aria-label="t('pobBuild.toggleModsTitle')"
                    @click.stop="togglePreview(build.id, row.key, $event)"
                  >
                    <SlidersHorizontal />
                  </Button>

                  <div
                    :class="[
                      row.mods?.length || row.searchOverride
                        ? 'right-[calc(var(--pxd-space-md)+var(--control-height-sm))]'
                        : 'right-[var(--pxd-space-md)]',
                      isPreviewActive(build.id, row.key)
                        ? 'bg-[color-mix(in_srgb,var(--primary)_15%,var(--card))]'
                        : 'bg-[color-mix(in_srgb,var(--muted)_40%,var(--card))]',
                      { '!opacity-100 !pointer-events-auto': isMenuOpen(build.id, row.key) },
                    ]"
                    class="absolute top-1/2 -translate-y-1/2 z-(--pxd-z-raised) flex items-center gap-[var(--pxd-space-xs)] pl-[var(--pxd-space-sm)] opacity-0 pointer-events-none transition-opacity duration-150 group-hover/row:opacity-100 group-hover/row:pointer-events-auto group-focus-within/row:opacity-100 group-focus-within/row:pointer-events-auto"
                  >
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
                    <DropdownMenu
                      :open="isMenuOpen(build.id, row.key)"
                      @update:open="(open) => setMenuOpen(build.id, row.key, open)"
                    >
                      <DropdownMenuTrigger as-child>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          data-pob-build-more
                          :title="t('pobBuild.moreActionsTitle')"
                          :aria-label="t('pobBuild.moreActionsTitle')"
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
                          {{ t('pobBuild.sendToConsole') }}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          :disabled="!canSearch(row)"
                          data-pob-build-open-live
                          @click="openLiveSearch(build.id, row)"
                        >
                          <Radio class="text-muted-foreground" />
                          {{ t('pobBuild.openLiveSearch') }}
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
                            {{ t('pobBuild.addToBookmarks') }}
                          </DropdownMenuSubTrigger>
                          <DropdownMenuSubContent
                            class="w-[var(--pxd-menu-sub-width,192px)] max-h-[min(var(--pxd-menu-sub-max-height,180px),var(--reka-dropdown-menu-content-available-height,calc(100vh-32px)))] overflow-y-auto pxd-scrollbar"
                          >
                            <DropdownMenuItem
                              v-if="bookmarkFolders === null"
                              disabled
                              class="text-muted-foreground"
                            >
                              {{ t('pobBuild.loadingFolders') }}
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
                              <Folder class="shrink-0 text-muted-foreground" />
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
        :side="sidebarPosition === 'left' ? 'right' : 'left'"
        :reference="previewAnchorEl"
        :build-id="activePreview?.buildId ?? ''"
        :row="activePreview?.row ?? null"
        :row-detail-text="activePreview ? rowDetail(activePreview.row) : ''"
        :name-class="activePreview ? nameClass(activePreview.row) : ''"
        @update:open="(open) => !open && closePreview()"
        @save-selection="
          (selection) =>
            activePreview && saveSelection(activePreview.buildId, activePreview.row.key, selection)
        "
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
import {
  BookmarkPlus,
  ChevronDown,
  ChevronsUpDown,
  Ellipsis,
  ExternalLink,
  Folder,
  Pencil,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
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
import SidebarPane from '../layout/SidebarPane.vue';
import { rowAnchorFromEvent } from '../composables/usePinnedPreview';
import { t, type I18nKey } from '@/utils/i18n';
import { POB_BUILD_NAME_MAX_LENGTH } from '@/utils/pob-build-store';
import type { ShoppingEntry } from '@/utils/pob-shopping-list';
import { getPoeVersion } from '@/utils/trade-context';
import { getFolderItemIndentLevel } from '../bookmark-tree';
import PobBuildImportDialog from './PobBuildImportDialog.vue';
import PobEntryPreviewPopover from './PobEntryPreviewPopover.vue';
import type { PobBookmarkFolder } from './pob-bookmark-bridge';
import { formatPobSlot } from './pob-slot-label';
import {
  usePobBuild,
  type BuildView,
  type SetOption,
  type ShoppingGroup,
  type ShoppingRow,
} from './usePobBuild';

// 稀有度顏色取遊戲內的色相，亮度取在深淺主題都看得清楚的中間值
const RARITY_CLASSES: Readonly<Record<string, string>> = {
  UNIQUE: 'text-[oklch(0.68_0.15_50)]',
  RELIC: 'text-[oklch(0.68_0.15_50)]',
  RARE: 'text-[oklch(0.72_0.13_90)]',
  MAGIC: 'text-[oklch(0.66_0.13_255)]',
  NORMAL: 'text-foreground',
};
const GEM_CLASS = 'text-[oklch(0.7_0.1_190)]';

export default defineComponent({
  name: 'PobBuildPane',
  props: {
    sidebarPosition: {
      type: String as PropType<'left' | 'right'>,
      default: 'left',
    },
  },
  components: {
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
    Folder,
    Input,
    Pencil,
    Plus,
    PobBuildImportDialog,
    PobEntryPreviewPopover,
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
    SidebarPane,
    SlidersHorizontal,
    Trash2,
    X,
  },
  setup() {
    const version = getPoeVersion();
    const pob = usePobBuild(version);
    const isImportOpen = ref(false);
    /** 匯入對話框以「更新代碼」模式開啟時的目標 build */
    const updateTarget = ref<{ id: string; name: string } | null>(null);
    const isSearchVisible = ref(false);
    const searchQuery = ref('');
    const searchInputRef = ref<InstanceType<typeof Input> | null>(null);
    const renamingId = ref<string | null>(null);
    const renameInput = ref('');
    /** 目前在右側 Popover 檢視／調整詞綴的項目 */
    const activePreviewTarget = ref<{ buildId: string; key: string } | null>(null);
    const previewAnchorEl = ref<HTMLElement | null>(null);
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

    /** 有存回的搜尋或有條件時才能送主控台、加書籤 */
    const canSearch = (row: ShoppingRow) => row.searchOverride || row.query !== null;

    // PoE 2 的技能寶石不在市集交易，清單沒有寶石，技能組也就不必選
    const showSkillSets = (build: BuildView) =>
      version === 'poe1' && build.skillSetOptions.length > 1;

    const setLabel = (option: SetOption): string =>
      option.title || t('pobBuild.unnamedSet', { n: option.position });

    const activeSetLabel = (options: readonly SetOption[], activeId: string): string => {
      const found = options.find((option) => option.id === activeId);
      return found ? setLabel(found) : '';
    };

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

    /** 由可見清單即時查出目前預覽的項目，詞綴／數值更新時 Popover 同步反映，列消失時自動關閉 */
    const activePreview = computed<{ buildId: string; row: ShoppingRow } | null>(() => {
      const target = activePreviewTarget.value;
      if (!target) return null;
      const build = visibleBuilds.value.find((entry) => entry.id === target.buildId);
      if (!build || (build.collapsed && !isFiltering.value)) return null;
      for (const group of build.groups) {
        const found = group.rows.find((entry) => entry.key === target.key);
        if (found) return { buildId: build.id, row: found };
      }
      return null;
    });

    const isPreviewOpen = computed(() => activePreview.value !== null);

    const closePreview = () => {
      activePreviewTarget.value = null;
      previewAnchorEl.value = null;
    };

    watch(activePreview, (value) => {
      if (!value && activePreviewTarget.value) {
        closePreview();
      }
    });

    const isPreviewActive = (buildId: string, key: string) =>
      activePreview.value?.buildId === buildId && activePreview.value?.row.key === key;

    const togglePreview = (buildId: string, key: string, event: Event) => {
      if (isPreviewActive(buildId, key)) {
        closePreview();
        return;
      }
      const anchor = rowAnchorFromEvent(event, '[data-pob-build-row]');
      if (!anchor) return;
      activePreviewTarget.value = { buildId, key };
      previewAnchorEl.value = anchor;
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

    onMounted(() => {
      void pob.restore();
    });
    onUnmounted(() => pob.dispose());

    return {
      t,
      NAME_MAX_LENGTH: POB_BUILD_NAME_MAX_LENGTH,
      isImportOpen,
      updateTarget,
      isSearchVisible,
      searchQuery,
      searchInputRef,
      renamingId,
      renameInput,
      isFiltering,
      visibleBuilds,
      isAllCollapsed,
      activePreview,
      previewAnchorEl,
      isPreviewOpen,
      isPreviewActive,
      togglePreview,
      closePreview,
      isBuildMenuOpen,
      setBuildMenuOpen,
      isMenuOpen,
      setMenuOpen,
      bookmarkFolders,
      canSearch,
      getFolderItemIndentLevel,
      showSkillSets,
      setLabel,
      activeSetLabel,
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
      saveSelection: pob.saveSelection,
      resetSearch: pob.resetSearch,
      setHideDone: pob.setHideDone,
      openSharePermissionPage: pob.openSharePermissionPage,
      sendToLiveSearch: pob.sendToLiveSearch,
      openLiveSearch: pob.openLiveSearch,
      saveCurrentSearch: pob.saveCurrentSearch,
      addToBookmarks: pob.addToBookmarks,
    };
  },
});
</script>
