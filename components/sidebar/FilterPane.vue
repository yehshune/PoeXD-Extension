<template>
  <div
    class="filter-pane-container absolute top-[var(--pxd-pane-padding)] left-[var(--pxd-pane-padding)] right-[var(--pxd-pane-padding)] bottom-[var(--pxd-pane-padding)] flex flex-col"
  >
    <div class="tab-pane flex flex-col h-full box-border">
      <!-- 載入中狀態 -->
      <div
        v-if="loading"
        class="loading-state flex flex-col items-center justify-center py-[var(--pxd-space-2xl)]"
      >
        <div
          class="spinner size-6 border-2 border-border border-t-primary rounded-full animate-spin [animation-duration:0.8s] mb-[var(--pxd-space-md)]"
        ></div>
        <div class="loading-text text-[length:var(--pxd-font-body)] text-muted-foreground">
          {{ t('filterPane.loading') }}
        </div>
      </div>

      <div
        v-else
        class="pane-content split-layout flex flex-row flex-nowrap flex-1 gap-[var(--pxd-space-xl)] min-h-0 w-full"
      >
        <!-- 內嵌一體化左側快速跳轉導覽列 -->
        <div
          class="modal-nav-anchors-inline pxd-scrollbar w-[var(--pxd-filter-nav-width)] shrink-0 flex flex-col gap-[var(--pxd-space-xs)] bg-background border-r border-border pt-[var(--pxd-space-md)] pr-[var(--pxd-space-xs)] pb-[var(--pxd-space-md)] pl-0 overflow-y-auto min-h-0 box-border"
          ref="navAnchorsRef"
          v-if="groupedAffixes.length > 0"
        >
          <div
            v-for="cat in groupedAffixes"
            :key="cat.label"
            class="anchor-btn-inline shrink-0 flex items-center justify-center min-h-[var(--pxd-filter-anchor-min-height)] border border-transparent border-l-[3px] py-[var(--pxd-space-md)] px-[var(--pxd-space-xs)] text-[length:var(--pxd-font-caption)] text-center cursor-pointer break-all whitespace-normal leading-[1.25] rounded-[var(--radius)] transition-colors select-none box-border"
            :class="
              currentActiveCategory === cat.label
                ? 'active bg-primary/12 text-foreground border-l-primary font-semibold'
                : 'bg-transparent text-muted-foreground border-l-transparent hover:bg-accent hover:text-accent-foreground'
            "
            @click="scrollToCategory(cat.label)"
            :title="t('filterPane.nav.jumpTo', { category: cat.label })"
          >
            <span class="anchor-text-inline">{{ cat.label }}</span>
          </div>
        </div>

        <!-- 左側主要區域 (包含 controls-row 與 mods-scroll-container) -->
        <div class="split-left-main flex-[7.2] flex flex-col min-h-0">
          <!-- 篩選控制項整合為單行 -->
          <div
            class="controls-row flex gap-[var(--pxd-space-md)] mb-[var(--pxd-row-gap)] items-center"
          >
            <!-- 物品類別選擇器 (自訂搜尋下拉) -->
            <div
              class="control-item item-type custom-select-container flex flex-col flex-[1.2] min-w-0 relative w-full select-none"
            >
              <Button
                type="button"
                variant="outline"
                size="sm"
                class="w-full justify-between font-normal"
                @click="toggleSelectDropdown"
              >
                <span class="truncate text-left flex-1">{{ getTypeName(selectedType) }}</span>
                <ChevronDown class="text-muted-foreground shrink-0" />
              </Button>
            </div>

            <!-- 關鍵字搜尋輸入框 (帶有一鍵清空打叉按鈕) -->
            <div
              class="control-item item-search relative flex flex-[2] min-w-0 w-full items-center"
            >
              <Input
                ref="searchInputRef"
                v-model="searchQuery"
                type="text"
                size="sm"
                :placeholder="t('filterPane.search.placeholder')"
                class="w-full pr-7"
              />
              <Button
                v-if="searchQuery"
                type="button"
                variant="ghost"
                size="icon-sm"
                class="absolute right-1 top-1/2 -translate-y-1/2"
                :title="t('filterPane.search.clearTitle')"
                @click="clearSearchQuery"
              >
                <X />
              </Button>
            </div>

            <!-- 前/後綴快速篩選 ToggleGroup -->
            <ToggleGroup
              v-model="generationFilter"
              type="single"
              variant="outline"
              size="sm"
              class="shrink-0"
            >
              <ToggleGroupItem
                value="all"
                :title="t('filterPane.generation.allTitle')"
                class="select-none data-[state=on]:font-bold"
              >
                {{ t('filterPane.generation.all') }}
              </ToggleGroupItem>
              <ToggleGroupItem
                value="prefix"
                :title="t('filterPane.generation.prefixTitle')"
                class="select-none data-[state=on]:font-bold"
              >
                {{ t('filterPane.generation.prefix') }}
              </ToggleGroupItem>
              <ToggleGroupItem
                value="suffix"
                :title="t('filterPane.generation.suffixTitle')"
                class="select-none data-[state=on]:font-bold"
              >
                {{ t('filterPane.generation.suffix') }}
              </ToggleGroupItem>
            </ToggleGroup>

            <!-- 全選與取消全選 -->
            <div class="ml-auto flex shrink-0 items-center gap-[var(--pxd-space-sm)]">
              <Button
                type="button"
                variant="outline"
                size="sm"
                class="font-normal"
                :title="t('filterPane.actions.selectAllTitle')"
                @click="selectAllCurrent"
              >
                {{ t('filterPane.actions.selectAll') }}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                class="font-normal"
                :title="t('filterPane.actions.clearAllTitle')"
                @click="clearAllSelection"
              >
                {{ t('filterPane.actions.clearAll') }}
              </Button>
            </div>
          </div>

          <!-- 詞綴清單區 -->
          <div
            ref="scrollContainerRef"
            class="mods-scroll-container pxd-scrollbar flex-1 overflow-y-auto min-h-0 pr-[2px]"
            @scroll="handleScroll"
          >
            <div
              v-for="cat in groupedAffixes"
              :key="cat.label"
              class="mods-group mb-[var(--pxd-space-md)] [&+&]:pt-[var(--pxd-section-gap)]"
            >
              <!-- 區塊標題（包含展開收合狀態及 Toggle 功能） -->
              <div
                :id="'category_' + cat.label"
                class="group-header group/header flex items-center justify-between rounded-md cursor-pointer select-none transition-colors mb-[var(--pxd-space-sm)] px-[var(--pxd-space-sm)] py-[var(--pxd-space-sm)] text-[length:var(--pxd-font-section-title)] font-semibold text-foreground hover:bg-accent hover:text-accent-foreground"
                :class="expandedCategories.has(cat.label) ? 'bg-muted' : 'bg-transparent'"
                :aria-expanded="expandedCategories.has(cat.label)"
                @click="toggleCategory(cat.label)"
              >
                <div class="flex items-center gap-[var(--pxd-space-sm)] min-w-0">
                  <span class="group-title font-semibold text-current min-w-0 truncate">
                    {{ cat.label }}
                  </span>
                  <span
                    class="group-count text-[length:var(--pxd-font-caption)] text-muted-foreground group-hover/header:text-accent-foreground shrink-0 select-none"
                  >
                    {{ cat.prefixes.length + cat.suffixes.length + cat.all.length }}
                  </span>
                </div>
                <Minus
                  v-if="expandedCategories.has(cat.label)"
                  class="size-[var(--control-icon-sm,14px)] text-muted-foreground group-hover/header:text-accent-foreground shrink-0"
                />
                <Plus
                  v-else
                  class="size-[var(--control-icon-sm,14px)] text-muted-foreground group-hover/header:text-accent-foreground shrink-0"
                />
              </div>

              <!-- 展開狀態下顯示內容 -->
              <div
                v-if="expandedCategories.has(cat.label)"
                class="group-content mb-[var(--pxd-space-lg)]"
              >
                <!-- 雙欄排版 (前綴與後綴皆有項目) -->
                <template v-if="cat.hasBothSplit">
                  <div
                    class="category-columns flex flex-row flex-wrap gap-[var(--pxd-space-lg)] w-full"
                  >
                    <!-- 左側前綴欄 -->
                    <div class="column-left flex-1 min-w-[280px]">
                      <div
                        class="column-title text-[length:var(--pxd-font-secondary)] font-semibold text-muted-foreground py-[var(--pxd-space-xs)] px-[var(--pxd-space-sm)] mb-[var(--pxd-space-sm)] bg-transparent border-b border-border uppercase tracking-[0.5px]"
                      >
                        {{ t('filterPane.column.prefixes', { count: cat.prefixes.length }) }}
                      </div>
                      <div
                        class="mods-list-grid grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-[var(--pxd-space-sm)] items-start"
                      >
                        <ModItem
                          v-for="mod in cat.prefixes"
                          :key="mod.id"
                          class="mb-[2px]"
                          :mod="mod"
                          :affinity="cat.affinity"
                          :search-query="searchQuery"
                          :is-expanded="expandedKeys.has(mod.id)"
                          :is-selected="isModSelected(mod.id, cat.affinity)"
                          :is-tier-selected="(idx) => isTierSelected(mod.id, idx, cat.affinity)"
                          @toggle-expand="toggleExpand"
                          @toggle-select="toggleModSelection"
                          @toggle-tier-select="toggleTierSelection"
                          @add-filter="(m, aff) => addStatFilter({ ...m, affinities: [aff] })"
                          @add-tier-filter="addTierFilter"
                        />
                      </div>
                    </div>

                    <!-- 右側後綴欄 -->
                    <div class="column-right flex-1 min-w-[280px]">
                      <div
                        class="column-title text-[length:var(--pxd-font-secondary)] font-semibold text-muted-foreground py-[var(--pxd-space-xs)] px-[var(--pxd-space-sm)] mb-[var(--pxd-space-sm)] bg-transparent border-b border-border uppercase tracking-[0.5px]"
                      >
                        {{ t('filterPane.column.suffixes', { count: cat.suffixes.length }) }}
                      </div>
                      <div
                        class="mods-list-grid grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-[var(--pxd-space-sm)] items-start"
                      >
                        <ModItem
                          v-for="mod in cat.suffixes"
                          :key="mod.id"
                          class="mb-[2px]"
                          :mod="mod"
                          :affinity="cat.affinity"
                          :search-query="searchQuery"
                          :is-expanded="expandedKeys.has(mod.id)"
                          :is-selected="isModSelected(mod.id, cat.affinity)"
                          :is-tier-selected="(idx) => isTierSelected(mod.id, idx, cat.affinity)"
                          @toggle-expand="toggleExpand"
                          @toggle-select="toggleModSelection"
                          @toggle-tier-select="toggleTierSelection"
                          @add-filter="(m, aff) => addStatFilter({ ...m, affinities: [aff] })"
                          @add-tier-filter="addTierFilter"
                        />
                      </div>
                    </div>
                  </div>
                </template>

                <!-- 單欄排版 (僅有前綴命中) -->
                <template v-else-if="cat.hasOnlyPrefix">
                  <div class="category-single-column w-full">
                    <div
                      class="column-title text-[length:var(--pxd-font-secondary)] font-semibold text-muted-foreground py-[var(--pxd-space-xs)] px-[var(--pxd-space-sm)] mb-[var(--pxd-space-sm)] bg-transparent border-b border-border uppercase tracking-[0.5px]"
                    >
                      {{ t('filterPane.column.prefixes', { count: cat.prefixes.length }) }}
                    </div>
                    <div
                      class="mods-list-grid grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-[var(--pxd-space-sm)] items-start"
                    >
                      <ModItem
                        v-for="mod in cat.prefixes"
                        :key="mod.id"
                        class="mb-[2px]"
                        :mod="mod"
                        :affinity="cat.affinity"
                        :search-query="searchQuery"
                        :is-expanded="expandedKeys.has(mod.id)"
                        :is-selected="isModSelected(mod.id, cat.affinity)"
                        :is-tier-selected="(idx) => isTierSelected(mod.id, idx, cat.affinity)"
                        @toggle-expand="toggleExpand"
                        @toggle-select="toggleModSelection"
                        @toggle-tier-select="toggleTierSelection"
                        @add-filter="(m, aff) => addStatFilter({ ...m, affinities: [aff] })"
                        @add-tier-filter="addTierFilter"
                      />
                    </div>
                  </div>
                </template>

                <!-- 單欄排版 (僅有後綴命中) -->
                <template v-else-if="cat.hasOnlySuffix">
                  <div class="category-single-column w-full">
                    <div
                      class="column-title text-[length:var(--pxd-font-secondary)] font-semibold text-muted-foreground py-[var(--pxd-space-xs)] px-[var(--pxd-space-sm)] mb-[var(--pxd-space-sm)] bg-transparent border-b border-border uppercase tracking-[0.5px]"
                    >
                      {{ t('filterPane.column.suffixes', { count: cat.suffixes.length }) }}
                    </div>
                    <div
                      class="mods-list-grid grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-[var(--pxd-space-sm)] items-start"
                    >
                      <ModItem
                        v-for="mod in cat.suffixes"
                        :key="mod.id"
                        class="mb-[2px]"
                        :mod="mod"
                        :affinity="cat.affinity"
                        :search-query="searchQuery"
                        :is-expanded="expandedKeys.has(mod.id)"
                        :is-selected="isModSelected(mod.id, cat.affinity)"
                        :is-tier-selected="(idx) => isTierSelected(mod.id, idx, cat.affinity)"
                        @toggle-expand="toggleExpand"
                        @toggle-select="toggleModSelection"
                        @toggle-tier-select="toggleTierSelection"
                        @add-filter="(m, aff) => addStatFilter({ ...m, affinities: [aff] })"
                        @add-tier-filter="addTierFilter"
                      />
                    </div>
                  </div>
                </template>

                <!-- 單欄網格排版 (不分世代類別或特殊分類) -->
                <template v-else>
                  <div
                    class="mods-list-grid grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-[var(--pxd-space-sm)] items-start"
                  >
                    <ModItem
                      v-for="mod in cat.all"
                      :key="mod.id"
                      class="mb-[2px]"
                      :mod="mod"
                      :affinity="cat.affinity"
                      :search-query="searchQuery"
                      :is-expanded="expandedKeys.has(mod.id)"
                      :is-selected="isModSelected(mod.id, cat.affinity)"
                      :is-tier-selected="(idx) => isTierSelected(mod.id, idx, cat.affinity)"
                      @toggle-expand="toggleExpand"
                      @toggle-select="toggleModSelection"
                      @toggle-tier-select="toggleTierSelection"
                      @add-filter="(m, aff) => addStatFilter({ ...m, affinities: [aff] })"
                      @add-tier-filter="addTierFilter"
                    />
                  </div>
                </template>
              </div>
            </div>

            <div
              v-if="isEmpty"
              class="empty-mods text-center text-muted-foreground text-[length:var(--pxd-font-body)] py-[var(--pxd-space-2xl)]"
            >
              {{ t('filterPane.empty') }}
            </div>
          </div>
        </div>

        <!-- 右側已選展示與操作面板 -->
        <div
          class="split-right-panel flex-[2.8] border-l border-border pl-[var(--pxd-space-xl)] flex flex-col min-h-0 bg-background"
        >
          <div
            class="panel-header pb-[var(--pxd-space-md)] border-b border-border mb-[var(--pxd-space-md)]"
          >
            <span
              class="panel-title text-[length:var(--pxd-font-section-title)] font-bold text-foreground tracking-[0.5px]"
              >{{ t('filterPane.selected.title', { count: selectedModsMap.size }) }}</span
            >
          </div>

          <div
            class="selected-mods-list pxd-scrollbar flex-1 overflow-y-auto pr-[var(--pxd-space-xs)] mb-[var(--pxd-space-lg)] flex flex-col gap-[var(--pxd-space-sm)]"
          >
            <div
              v-for="group in groupedSelectedMods"
              :key="group.label"
              class="selected-group-section mb-[var(--pxd-space-lg)]"
            >
              <!-- 小區隔大類標題 -->
              <div
                class="selected-group-header text-[length:var(--pxd-font-caption)] font-bold text-muted-foreground py-[2px] px-[var(--pxd-space-sm)] bg-background border-b border-border mb-[var(--pxd-space-xs)] uppercase tracking-[0.5px]"
              >
                {{ group.label }}
              </div>
              <div class="selected-group-items flex flex-col gap-[var(--pxd-space-xs)]">
                <div
                  v-for="[key, info] in group.items"
                  :key="key"
                  class="selected-mod-item flex justify-between items-start bg-card border border-border rounded-[var(--radius)] py-[var(--pxd-space-sm)] px-[var(--pxd-space-md)] gap-[var(--pxd-space-md)]"
                >
                  <div
                    class="selected-mod-text text-[length:var(--pxd-font-secondary)] text-foreground leading-[1.35] break-all flex-1 cursor-pointer"
                    @click="scrollToMod(info.id, info.affinities[0])"
                    :title="t('filterPane.selected.jumpToMod')"
                  >
                    <span
                      class="selected-mod-tier bg-primary text-primary-foreground text-[length:var(--pxd-font-micro)] font-bold py-[1px] px-[4px] mr-[4px] inline-block align-middle"
                      v-if="info.selectedTierIndex !== undefined"
                    >
                      T{{ getDisplayTier(info.id, info.selectedTierIndex) }}+
                    </span>
                    <span class="selected-mod-name">
                      {{ formatModText(getPendingModLabel(info)) }}
                    </span>
                    <span
                      v-if="!info.officialId && (!info.ids || info.ids.length === 0)"
                      class="no-official-id-badge ml-[var(--pxd-space-xs)] inline-flex items-center px-1.5 py-0.5 rounded-[var(--radius-sm)] text-[length:var(--pxd-font-micro)] text-amber-500 bg-amber-500/10 border border-amber-500/25 shrink-0 select-none align-middle"
                      :title="t('filterPane.badge.noOfficialIdBatchTitle')"
                      data-badge="no-official-id"
                    >
                      {{ t('modItem.badge.noOfficialId') }}
                    </span>
                    <span
                      class="selected-mod-vals vals-limit-trigger text-muted-foreground text-[length:var(--pxd-font-caption)] ml-[var(--pxd-space-xs)] cursor-pointer border-b border-dotted border-muted-foreground transition-colors hover:text-foreground hover:border-foreground"
                      v-if="info.mins || info.maxs"
                      @click.stop="toggleMaxLimit(key)"
                      :title="t('filterPane.selected.toggleMaxTitle')"
                    >
                      ({{ getDisplayValues(info) }})
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost-destructive"
                    size="icon-sm"
                    class="shrink-0"
                    :title="t('filterPane.selected.removeTitle')"
                    data-filter-action="remove-selected"
                    @click="removeSingleSelection(key)"
                  >
                    <X />
                  </Button>
                </div>
              </div>
            </div>
            <div
              v-if="selectedModsMap.size === 0"
              class="no-selected-placeholder text-muted-foreground text-[length:var(--pxd-font-secondary)] text-center mt-[var(--pxd-space-2xl)] italic"
            >
              {{ t('filterPane.selected.empty') }}
            </div>
          </div>

          <!-- 操作按鈕區 -->
          <div
            class="panel-actions flex flex-col gap-[var(--pxd-space-md)] pt-[var(--pxd-space-md)] border-t border-border"
          >
            <Button
              type="button"
              variant="default"
              size="default"
              class="w-full font-bold"
              :disabled="selectedModsMap.size === 0"
              data-filter-action="confirm-selected"
              @click="confirmBatchSelection"
            >
              {{ t('filterPane.actions.applyBatch', { count: selectedModsMap.size }) }}
            </Button>
            <div class="flex w-full gap-[var(--pxd-space-sm)]">
              <Button
                type="button"
                variant="outline"
                size="sm"
                class="flex-1 truncate font-medium"
                :disabled="selectedModsMap.size === 0"
                :title="t('filterPane.actions.applyT1Title')"
                data-filter-action="apply-t1"
                @click="applyT1ToSelected"
              >
                {{ t('filterPane.actions.applyT1') }}
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                class="flex-1 truncate font-medium"
                :disabled="selectedModsMap.size === 0"
                :title="t('filterPane.actions.clearSelectedTitle')"
                data-filter-action="clear-selected"
                @click="clearAllSelection"
              >
                {{ t('filterPane.actions.clearSelected') }}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <!-- 物品類別選擇 Dialog -->
      <Dialog :open="isSelectDropdownOpen" @update:open="setSelectDialogOpen">
        <DialogContent
          layer="nested"
          class="flex h-auto max-h-[72vh] w-[calc(100vw-32px)] max-w-[720px] flex-col gap-0 overflow-hidden p-0"
          @close-auto-focus="(e) => e.preventDefault()"
        >
          <DialogHeader
            class="p-[var(--pxd-space-lg)] pr-12 border-b border-border bg-background flex flex-row items-center justify-between space-y-0"
          >
            <DialogTitle class="text-[length:var(--pxd-font-section-title)] font-bold">
              {{ t('filterPane.dialog.title') }}
            </DialogTitle>
            <DialogDescription class="sr-only">{{
              t('filterPane.dialog.description')
            }}</DialogDescription>
          </DialogHeader>

          <div class="p-[var(--pxd-space-sm)] bg-background border-b border-border">
            <Input
              ref="typeSearchInputRef"
              v-model="typeSearchQuery"
              type="text"
              size="default"
              :placeholder="t('filterPane.dialog.searchPlaceholder')"
              class="w-full"
            />
          </div>

          <div
            ref="typeOptionsRootRef"
            class="flex-1 min-h-0 overflow-y-auto p-[var(--pxd-space-lg)] pxd-scrollbar pxd-scrollbar-selection"
          >
            <div
              v-for="group in groupedAvailableTypes"
              :key="group.groupLabel"
              class="type-group-section mb-[var(--pxd-space-xl)]"
            >
              <div
                class="type-group-title text-[length:var(--pxd-font-secondary)] font-bold text-foreground mb-[var(--pxd-space-md)] border-l-2 border-primary pl-[var(--pxd-space-sm)] uppercase"
              >
                {{ group.groupLabel }}
              </div>

              <!-- 橫向排列的多屬性類別行 (例如胸甲、手套等) -->
              <div
                v-if="group.rows && group.rows.length > 0"
                class="type-rows-container flex flex-col gap-[var(--pxd-space-sm)] mb-[var(--pxd-row-gap)]"
              >
                <div
                  v-for="(row, rIdx) in group.rows"
                  :key="rIdx"
                  class="type-row-item flex items-center gap-[var(--pxd-space-md)] py-[var(--pxd-space-xs)] px-[var(--pxd-space-sm)] bg-card border border-border"
                >
                  <!-- 主按鈕 (如: 胸甲) -->
                  <div class="main-option-wrapper shrink-0 w-[95px]">
                    <Button
                      v-if="row.mainOption"
                      type="button"
                      :variant="row.mainOption.key === dialogActiveCategory ? 'accent' : 'outline'"
                      size="sm"
                      class="w-full truncate font-bold"
                      :data-selected="
                        row.mainOption.key === dialogActiveCategory ? 'true' : undefined
                      "
                      @click="selectTypeOption(row.mainOption.key)"
                      :title="row.mainOption.fullLabel"
                    >
                      {{ row.mainOption.label }}
                    </Button>
                    <span
                      v-else
                      class="type-row-fallback-label inline-flex items-center justify-center w-full min-h-[var(--control-height-sm)] text-muted-foreground text-[length:var(--pxd-font-caption)] font-bold border border-dashed border-border box-border bg-muted text-center select-none rounded-[var(--radius)]"
                    >
                      {{ row.rowLabel }}
                    </span>
                  </div>

                  <!-- 子屬性按鈕列表 (如: 力, 敏, 智) -->
                  <div
                    v-if="row.subOptions && row.subOptions.length > 0"
                    class="sub-options-wrapper flex flex-wrap gap-[var(--pxd-space-xs)] flex-1"
                  >
                    <Button
                      v-for="subOpt in row.subOptions"
                      :key="subOpt.key"
                      type="button"
                      :variant="subOpt.key === dialogActiveCategory ? 'accent' : 'outline'"
                      size="sm"
                      class="w-auto min-w-[38px] truncate font-normal"
                      :data-selected="subOpt.key === dialogActiveCategory ? 'true' : undefined"
                      @click="selectTypeOption(subOpt.key)"
                      :title="subOpt.fullLabel"
                    >
                      {{ subOpt.label }}
                    </Button>
                  </div>
                </div>
              </div>

              <!-- 單一按鈕的格點排列 (原本非多類別的按鈕) -->
              <div
                v-if="group.singleOptions && group.singleOptions.length > 0"
                class="type-buttons-grid grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-[var(--pxd-space-sm)]"
              >
                <Button
                  v-for="opt in group.singleOptions"
                  :key="opt.key"
                  type="button"
                  :variant="opt.key === dialogActiveCategory ? 'accent' : 'outline'"
                  size="sm"
                  class="w-full truncate font-normal"
                  :data-selected="opt.key === dialogActiveCategory ? 'true' : undefined"
                  @click="selectTypeOption(opt.key)"
                  :title="opt.fullLabel"
                >
                  {{ opt.label }}
                </Button>
              </div>
            </div>
            <div
              v-if="groupedAvailableTypes.length === 0"
              class="no-options-found p-[var(--pxd-space-md)] text-[length:var(--pxd-font-body)] text-muted-foreground text-center"
            >
              {{ t('filterPane.dialog.empty') }}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted, onUnmounted, computed, watch } from 'vue';
import { getTierFilterBounds, isTradeStatId } from './utils';
import type {
  ModTier,
  ModGroup,
  CategoryGroup,
  SelectedModInfo,
  StatFilterModPayload,
} from './types';
import ModItem from './ModItem.vue';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ChevronDown, X } from '@lucide/vue';
import { Plus, Minus } from '@lucide/vue';
import { useModSelection } from './composables/useModSelection';
import { dispatchPoeEvent, listenPoeEvent } from '@/utils/event-contracts';
import { refreshAndReopenTierSlot } from '@/utils/tier-slot-registry';
import { getPoeVersion } from '@/utils/trade-context';
import {
  resolveFallbackQueryForUnmatchedMod,
  resolveFallbackQuerySync,
} from '@/utils/affix-lexicon';
import { resolvePageLocale } from '@/utils/locale-resolution';
import { readMarketDropdownLocale } from '@/utils/market-translation';
import { getTradeMapping } from './mapping-registry';
import { getAffinityProfile } from '@/utils/affinity-registry';
import { useFilterData } from './composables/useFilterData';
import { useFilterNavigation } from './composables/useFilterNavigation';
import { t, getActiveDisplayLocale, getActiveUiLocale } from '@/utils/i18n';

export default defineComponent({
  name: 'FilterPane',
  components: {
    ModItem,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    Input,
    Button,
    ToggleGroup,
    ToggleGroupItem,
    ChevronDown,
    Plus,
    Minus,
    X,
  },
  props: {
    targetGroupIndex: {
      type: Number,
      default: 0,
    },
    isOpen: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['type-dialog-open-changed'],
  setup(props, { emit }) {
    const version = getPoeVersion();
    const tradeMapping = getTradeMapping(version);

    // 引入自定義的狀態管理 composable
    const {
      selectedModsMap,
      isModSelected,
      isTierSelected,
      toggleModSelection,
      toggleTierSelection,
      clearAllSelection,
      applyT1ToSelected,
    } = useModSelection();

    const expandedKeys = ref<Set<string>>(new Set());
    const toggleExpand = (key: string) => {
      if (expandedKeys.value.has(key)) {
        expandedKeys.value.delete(key);
      } else {
        expandedKeys.value.add(key);
      }
    };

    const getDisplayTier = (modId: string, tierIndex: number) => {
      const modObj = currentTypeGroups.value.find((m) => m.id === modId);
      if (modObj && modObj.tiers) {
        return modObj.tiers.length - tierIndex;
      }
      return tierIndex + 1;
    };

    const getDisplayValues = (info: SelectedModInfo) => {
      const count = Math.max(info.mins?.length ?? 0, info.maxs?.length ?? 0);
      if (count > 0) {
        const parts: string[] = [];
        for (let i = 0; i < count; i++) {
          const minVal = info.mins?.[i];
          const maxVal = info.maxs?.[i];
          if (minVal && maxVal) {
            parts.push(`${minVal}~${maxVal}`);
          } else if (minVal) {
            parts.push(`≥${minVal}`);
          } else if (maxVal) {
            parts.push(`≤${maxVal}`);
          }
        }
        return parts.join(', ');
      }
      return '';
    };

    const getPendingModLabel = (info: SelectedModInfo) => {
      const isEnglish = getActiveUiLocale() === 'en';
      const modObj = info.id ? currentTypeGroups.value.find((m) => m.id === info.id) : undefined;

      if (isEnglish) {
        return modObj?.key || info.key || '';
      }
      return (
        modObj?.displayTemplate ||
        modObj?.displayKey ||
        modObj?.key ||
        info.displayTemplate ||
        info.displayKey ||
        info.key ||
        ''
      );
    };

    const removeSingleSelection = (key: string) => {
      const newMap = new Map(selectedModsMap.value);
      newMap.delete(key);
      selectedModsMap.value = newMap;
    };

    const selectAllCurrent = () => {
      const newMap = new Map(selectedModsMap.value);
      groupedAffixes.value.forEach((cat) => {
        const allCurrentMods = [...cat.prefixes, ...cat.suffixes, ...cat.all];
        allCurrentMods.forEach((mod) => {
          const hasId = Boolean(mod.officialId || (mod.ids && mod.ids.length > 0));
          if (!hasId) return; // 略過無官方 ID 的詞綴，不加入待套用清單
          const key = `${mod.id}_${cat.affinity}`;
          if (!newMap.has(key)) {
            newMap.set(key, {
              id: mod.id,
              officialId: mod.officialId,
              ids: mod.ids,
              key: mod.key,
              displayKey: mod.displayKey,
              displayTemplate: mod.displayTemplate,
              affinities: [cat.affinity],
            });
          }
        });
      });
      selectedModsMap.value = newMap;
    };

    const handleApplyT1ToSelected = () => {
      applyT1ToSelected(currentTypeGroups.value);
    };

    const confirmBatchSelection = () => {
      if (selectedModsMap.value.size === 0) return;
      const items = Array.from(selectedModsMap.value.values());

      // 點擊後立即清空已選項目，防止重複點擊
      clearAllSelection();

      // 批次套用時過濾掉無官方 ID 的詞綴
      const validItems = items.filter((info) =>
        Boolean(info.officialId || (info.ids && info.ids.length > 0)),
      );

      if (validItems.length === 0) {
        showToast(t('filterPane.toast.noValidMods'));
        return;
      }

      // 同步派發事件，瞬間完成新增
      validItems.forEach((info) => {
        const modObj = info.id ? currentTypeGroups.value.find((m) => m.id === info.id) : undefined;
        const firstTier = modObj?.tiers?.[0];
        const resolvedModGroup =
          firstTier?.displayTemplate ||
          firstTier?.displayKey ||
          firstTier?.key ||
          info.displayTemplate ||
          info.displayKey ||
          info.key ||
          undefined;
        addStatFilter(
          {
            key: info.key,
            displayKey: info.displayKey,
            displayTemplate: info.displayTemplate,
            modGroup: resolvedModGroup,
            affinities: info.affinities,
            officialId: info.officialId,
            ids: info.ids,
          },
          info.mins || info.min,
          info.maxs || info.max,
          info.key,
          true, // isBatch = true (批次匯入，不單獨關閉 modal 且 silent)
        );
      });

      const skippedCount = items.length - validItems.length;
      if (skippedCount > 0) {
        showToast(
          t('filterPane.toast.batchAddedWithSkipped', {
            count: validItems.length,
            skipped: skippedCount,
          }),
        );
      } else {
        showToast(t('filterPane.toast.batchAdded', { count: validItems.length }));
      }
      dispatchPoeEvent('poexd-close-affix-modal');
    };

    const groupedSelectedMods = computed(() => {
      const groups: Record<string, { label: string; items: Array<[string, SelectedModInfo]> }> = {};

      selectedModsMap.value.forEach((info, key) => {
        const aff = info.affinities && info.affinities.length > 0 ? info.affinities[0] : 'normal';
        const label = getCategoryLabel(aff);

        if (!groups[aff]) {
          groups[aff] = {
            label,
            items: [],
          };
        }
        groups[aff].items.push([key, info]);
      });

      return Object.values(groups);
    });

    const selectedType = ref('body-armour');
    const searchQuery = ref('');
    const searchInputRef = ref<HTMLInputElement | { $el?: HTMLInputElement } | null>(null);

    const getSearchInputElement = (): HTMLInputElement | undefined => {
      const target = searchInputRef.value;
      if (!target) return undefined;
      if (target instanceof HTMLInputElement) return target;
      if ('$el' in target && target.$el instanceof HTMLInputElement) return target.$el;
      return undefined;
    };

    const generationFilter = ref<'all' | 'prefix' | 'suffix'>('all');
    watch(generationFilter, (val, oldVal) => {
      if (!val && oldVal) {
        generationFilter.value = oldVal;
      }
    });

    const setSelectDialogOpen = (open: boolean) => {
      if (open) {
        isSelectDropdownOpen.value = true;
        return;
      }
      closeSelectDropdown();
    };

    // 自訂類別下拉選單狀態
    const isSelectDropdownOpen = ref(false);
    const typeSearchQuery = ref('');
    const typeSearchInputRef = ref<HTMLInputElement | { $el?: HTMLInputElement } | null>(null);
    const typeOptionsRootRef = ref<HTMLElement | null>(null);
    const poexdSelectingTarget = ref<any>(null);

    const closeSelectDropdown = () => {
      isSelectDropdownOpen.value = false;
      poexdSelectingTarget.value = null;
      (window as any).__poexd_selecting_target__ = null;
    };

    watch(isSelectDropdownOpen, (isOpen) => {
      emit('type-dialog-open-changed', isOpen);
      if (isOpen) {
        poexdSelectingTarget.value = (window as any).__poexd_selecting_target__ || null;
        setTimeout(() => {
          const target = typeSearchInputRef.value;
          const inputEl = target instanceof HTMLInputElement ? target : target?.$el;
          inputEl?.focus?.();
          // 尋找已選取的類別按鈕並滾動定位
          const selectedEl = typeOptionsRootRef.value?.querySelector(
            '[data-selected="true"]',
          ) as HTMLElement | null;
          if (selectedEl) {
            selectedEl.scrollIntoView({ block: 'nearest', behavior: 'auto' });
          }
        }, 100);
      } else {
        poexdSelectingTarget.value = null;
        (window as any).__poexd_selecting_target__ = null;
      }
    });

    const {
      loading,
      rawModsData,
      knownStats,
      typeNames,
      availableTypes,
      currentTypeGroups,
      getTypeName,
    } = useFilterData(version, selectedType);

    const affinityProfile = getAffinityProfile(version);
    const categoryNames = affinityProfile.categoryNames;
    const categoryPriorities = affinityProfile.categoryPriorities;

    const getCategoryPriority = (key: string) => {
      return categoryPriorities[key] ?? 999;
    };

    const getCategoryLabel = (key: string) => {
      return categoryNames[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
    };

    // 依據目前選取種類進行大類分組與排序，並套用搜尋篩選
    const groupedAffixes = computed(() => {
      if (!rawModsData.value || Object.keys(rawModsData.value).length === 0) return [];

      const allGroups = currentTypeGroups.value;

      let filtered = allGroups;
      if (searchQuery.value.trim()) {
        const queries = searchQuery.value.toLowerCase().split(/\s+/).filter(Boolean);
        const displayLocale = getActiveDisplayLocale();
        const includeEnglishKey =
          displayLocale === 'zh-TW' || displayLocale === 'zh-CN' || displayLocale === 'en';
        filtered = allGroups.filter((m) => {
          return queries.every((q) => {
            const matchesDisplay =
              Boolean(m.displayKey && m.displayKey.toLowerCase().includes(q)) ||
              Boolean(m.displayTemplate && m.displayTemplate.toLowerCase().includes(q));
            if (matchesDisplay) return true;
            if (includeEnglishKey || (!m.displayKey && !m.displayTemplate)) {
              return m.key.toLowerCase().includes(q);
            }
            return false;
          });
        });
      }

      const categoriesMap: Record<string, CategoryGroup> = {};

      filtered.forEach((mod) => {
        const affinities =
          mod.affinities && mod.affinities.length > 0 ? mod.affinities : ['normal'];

        affinities.forEach((affKey) => {
          const label = getCategoryLabel(affKey);
          const priority = getCategoryPriority(affKey);

          if (!categoriesMap[affKey]) {
            categoriesMap[affKey] = {
              affinity: affKey,
              label,
              prefixes: [],
              suffixes: [],
              all: [],
              hasSplit: false,
              priority,
            };
          }

          const cat = categoriesMap[affKey];
          // 檢查是否已加入過此分類，避免重複
          const exists =
            cat.prefixes.some((p) => p.id === mod.id) ||
            cat.suffixes.some((s) => s.id === mod.id) ||
            cat.all.some((a) => a.id === mod.id);

          if (!exists) {
            if (String(mod.generation_type) === '1') {
              cat.prefixes.push(mod);
            } else if (String(mod.generation_type) === '2') {
              cat.suffixes.push(mod);
            } else {
              cat.all.push(mod);
            }
          }
        });
      });

      // 判斷哪些大類支援前綴/後綴分割（包含一般、精髓、褻瀆、影響力與特殊大類）
      const splitAffinityKeys = [
        'normal',
        'essence',
        'perfect_essence',
        'desecrated',
        'destruction',
        'berserking',
        'soul',
        'breach_otherworldly',
        'breach_minion',
        'breach_caster',
        'shaper',
        'elder',
        'crusader',
        'redeemer',
        'hunter',
        'warlord',
        'delve',
        'incursion',
        'veiled',
        'searing',
        'eater',
        'synthesis',
        'sentinel',
      ];

      for (const key in categoriesMap) {
        const cat = categoriesMap[key];

        // 依據世代類型篩選 Tab 過濾
        if (generationFilter.value === 'prefix') {
          cat.suffixes = [];
        } else if (generationFilter.value === 'suffix') {
          cat.prefixes = [];
        }

        const isCandidateForSplit =
          splitAffinityKeys.includes(key) || (cat.prefixes.length > 0 && cat.suffixes.length > 0);

        const hasPrefix = cat.prefixes.length > 0;
        const hasSuffix = cat.suffixes.length > 0;

        if (isCandidateForSplit && (hasPrefix || hasSuffix)) {
          cat.hasBothSplit = hasPrefix && hasSuffix;
          cat.hasOnlyPrefix = hasPrefix && !hasSuffix;
          cat.hasOnlySuffix = !hasPrefix && hasSuffix;
          cat.hasSplit = true;
        } else {
          cat.all = [...cat.prefixes, ...cat.suffixes, ...cat.all];
          cat.prefixes = [];
          cat.suffixes = [];
          cat.hasBothSplit = false;
          cat.hasOnlyPrefix = false;
          cat.hasOnlySuffix = false;
          cat.hasSplit = false;
        }
      }

      return Object.values(categoriesMap)
        .filter((c) => c.prefixes.length > 0 || c.suffixes.length > 0 || c.all.length > 0)
        .sort((a, b) => a.priority - b.priority);
    });

    const expandedCategories = ref<Set<string>>(new Set());

    const {
      navAnchorsRef,
      scrollContainerRef,
      currentActiveCategory,
      scrollToCategory,
      scrollToMod,
      handleScroll,
    } = useFilterNavigation({
      groupedAffixes,
      expandedCategories,
      expandedKeys,
      getCategoryLabel,
    });

    // 當搜尋時或剛載入時，自動展開所有匹配結果的區塊
    watch(
      () => groupedAffixes.value,
      (newGroups) => {
        if (searchQuery.value.trim() || expandedCategories.value.size === 0) {
          newGroups.forEach((g) => {
            expandedCategories.value.add(g.label);
          });
        }
        if (newGroups.length > 0 && !currentActiveCategory.value) {
          currentActiveCategory.value = newGroups[0].label;
        }
      },
      { immediate: true },
    );

    const toggleCategory = (label: string) => {
      if (expandedCategories.value.has(label)) {
        expandedCategories.value.delete(label);
      } else {
        expandedCategories.value.add(label);
      }
    };

    const clearSearchQuery = () => {
      searchQuery.value = '';
    };

    const isEmpty = computed(() => {
      return groupedAffixes.value.length === 0;
    });

    interface TypeOption {
      key: string;
      label: string;
      fullLabel: string;
      searchText: string;
    }
    interface TypeRow {
      mainOption?: TypeOption;
      subOptions: TypeOption[];
      rowLabel?: string;
    }
    interface TypeGroup {
      groupLabel: string;
      rows: TypeRow[];
      singleOptions: TypeOption[];
    }

    // 物品類別分組與過濾計算屬性
    const groupedAvailableTypes = computed((): TypeGroup[] => {
      let rawTypes = availableTypes.value;
      const target = poexdSelectingTarget.value;
      if (target && Array.isArray(target.availableTypes)) {
        rawTypes = target.availableTypes;
      }
      const query = typeSearchQuery.value.trim().toLowerCase();

      // 使用外部定義的 PoE1 / PoE2 側邊欄按鈕分行排版設定
      const typeRowConfigs = tradeMapping.typeRowConfigs;
      const groupsToUse = tradeMapping.groups;

      const getShortNameWithoutEnglish = (fullName: string) => {
        if (!fullName) return '';
        return fullName.replace(/\s*\([^)]*\)/g, '').trim();
      };

      const getOptionObj = (key: string, customShortLabel?: string): TypeOption => {
        const fullLabel = typeNames[key] || key.toUpperCase();
        // 如果是子按鈕且指定了縮寫，使用該縮寫。否則去除英文後作為 label
        const label = customShortLabel || getShortNameWithoutEnglish(fullLabel);
        const searchText = `${key} ${fullLabel} ${label}`.toLowerCase();
        return {
          key,
          label,
          fullLabel,
          searchText,
        };
      };

      return groupsToUse
        .map((g) => {
          const rows: TypeRow[] = [];
          const usedKeys = new Set<string>();

          typeRowConfigs.forEach((rowConfig) => {
            const mainKey = rowConfig.mainKey;
            const subKeysObj = rowConfig.subKeys as Record<string, string>;

            const isMainKeyInGroup = g.keys.includes(mainKey) && rawTypes.includes(mainKey);
            const availableSubKeys = Object.keys(subKeysObj).filter(
              (sk) => g.keys.includes(sk) && rawTypes.includes(sk),
            );

            if (isMainKeyInGroup || availableSubKeys.length > 0) {
              let mainOption = isMainKeyInGroup ? getOptionObj(mainKey) : undefined;
              if (isMainKeyInGroup) usedKeys.add(mainKey);

              let subOptions = availableSubKeys.map((sk) => {
                usedKeys.add(sk);
                return getOptionObj(sk, subKeysObj[sk]);
              });

              if (query) {
                if (mainOption && !mainOption.searchText.includes(query)) {
                  mainOption = undefined;
                }
                subOptions = subOptions.filter((so) => so.searchText.includes(query));
              }

              const rowLabel = getShortNameWithoutEnglish(
                typeNames[mainKey] || mainKey.toUpperCase(),
              );

              if (mainOption || subOptions.length > 0) {
                rows.push({
                  mainOption,
                  subOptions,
                  rowLabel,
                });
              }
            }
          });

          let singleOptions = g.keys
            .filter((k) => rawTypes.includes(k) && !usedKeys.has(k))
            .map((k) => getOptionObj(k));

          if (query) {
            singleOptions = singleOptions.filter((so) => so.searchText.includes(query));
          }

          return {
            groupLabel: g.groupLabel,
            rows,
            singleOptions,
          };
        })
        .filter((g) => g.rows.length > 0 || g.singleOptions.length > 0);
    });

    const dialogActiveCategory = computed(() => {
      const target = poexdSelectingTarget.value;
      if (target && target.currentCategory !== undefined) {
        return target.currentCategory;
      }
      return selectedType.value;
    });

    const toggleSelectDropdown = () => {
      isSelectDropdownOpen.value = !isSelectDropdownOpen.value;
      if (isSelectDropdownOpen.value) {
        typeSearchQuery.value = '';
      }
    };

    // 點擊選取自訂類別選項
    const selectTypeOption = async (type: string) => {
      const target = poexdSelectingTarget.value || (window as any).__poexd_selecting_target__;
      poexdSelectingTarget.value = null;
      (window as any).__poexd_selecting_target__ = null;
      isSelectDropdownOpen.value = false;

      if (target) {
        const { groupIndex, filterIndex, bindingId, slotKey } = target;

        // 1. 同步寫入 Vuex 的不可列舉屬性並標記 DOM
        dispatchPoeEvent('poexd-update-stat-category', {
          groupIndex,
          filterIndex,
          bindingId,
          category: type,
        });

        // 2. 依 stable Tier slot identity 重新計算該 slot domain snapshot 並開啟原生 Trigger
        if (slotKey) {
          await refreshAndReopenTierSlot(slotKey);
        }
      } else {
        selectedType.value = type;
      }
    };

    // 格式化顯示詞綴文字
    const formatModText = (text: string) => {
      if (!text) return '';
      return text.replace(/\|\|\|\|\|/g, '\n');
    };

    // 發送事件新增屬性篩選到官方網頁 (複合詞綴多事件發送處理)
    const addStatFilter = (
      mod: StatFilterModPayload,
      min?: string | string[],
      max?: string | string[],
      matchKey?: string,
      isBatch = false,
    ) => {
      const keyToMatch = matchKey || mod.key;
      const affinities = mod.affinities || ['normal'];
      const modGroupSource = mod.tiers?.[0] || mod;
      const modGroup =
        mod.modGroup ||
        modGroupSource.displayTemplate ||
        modGroupSource.displayKey ||
        modGroupSource.key ||
        undefined;

      const getSingleVal = (val?: string | string[]) => (Array.isArray(val) ? val[0] : val);

      // 0. 若具有預先解析的官方多 ID 組合 (方案 A: 複合詞多 ID 拆分)
      if (mod.ids && mod.ids.length > 1) {
        const subKeys = keyToMatch.includes('|||||') ? keyToMatch.split('|||||') : [keyToMatch];
        const subKeysZh = mod.displayKey ? mod.displayKey.split('|||||') : [];
        const subTemplatesZh = mod.displayTemplate ? mod.displayTemplate.split('|||||') : [];

        mod.ids.forEach((statId, index) => {
          const subKey = (subKeys[index] || subKeys[0] || '').trim();
          const subMod: StatFilterModPayload = {
            key: subKey,
            displayKey: subKeysZh[index] ? subKeysZh[index].trim() : undefined,
            displayTemplate: subTemplatesZh[index] ? subTemplatesZh[index].trim() : undefined,
            modGroup,
            affinities: affinities,
            officialId: statId, // ⚡ 直接帶入資料端精準解析的官方子 ID
          };
          const subMin = Array.isArray(min) ? min[index] : index === 0 ? min : undefined;
          const subMax = Array.isArray(max) ? max[index] : index === 0 ? max : undefined;
          addSingleStatFilter(subMod, subMin, subMax, subKey, isBatch);
        });

        if (!isBatch) {
          dispatchPoeEvent('poexd-close-affix-modal');
        }
        return;
      }

      addSingleStatFilter(
        modGroup && mod.modGroup !== modGroup ? { ...mod, modGroup } : mod,
        getSingleVal(min),
        getSingleVal(max),
        matchKey,
        isBatch,
      );

      // 帶入詞綴後，若非批次則關閉 modal
      if (!isBatch) {
        dispatchPoeEvent('poexd-close-affix-modal');
      }
    };

    const addSingleStatFilter = (
      mod: StatFilterModPayload,
      min?: string,
      max?: string,
      matchKey?: string,
      silent = false,
    ) => {
      const targetOfficialId =
        mod.officialId ||
        (mod.ids && mod.ids.length === 1 ? mod.ids[0] : undefined) ||
        (isTradeStatId(mod.id) ? mod.id : undefined);

      if (targetOfficialId) {
        const displayText =
          knownStats.value[targetOfficialId]?.text || mod.displayKey || matchKey || mod.key;
        if (!silent)
          console.log(
            `[PoeXD Match] ⚡ 透過資料端官方 ID 直接取值:`,
            displayText,
            '➔ ID:',
            targetOfficialId,
          );

        dispatchPoeEvent('poexd-add-stat-filter', {
          statId: targetOfficialId,
          groupIndex: props.targetGroupIndex,
          min,
          max,
          category: selectedType.value,
          ...(mod.modGroup ? { modGroup: mod.modGroup } : {}),
        });
        if (!silent) showToast(t('filterPane.toast.singleAdded', { text: displayText }));
      } else {
        // 無官方 ID 則依網站語系 (pageLocale) 帶入 input；市集漢化只顯示中文時改用翻譯語系
        const dropdownLocale = readMarketDropdownLocale(document);
        const localeInput = dropdownLocale
          ? { hostname: window.location.hostname, htmlLang: dropdownLocale }
          : undefined;
        const emitFallback = (fallbackQuery: string) => {
          dispatchPoeEvent('poexd-add-stat-filter', {
            statId: null,
            fallbackQuery,
            groupIndex: props.targetGroupIndex,
            category: selectedType.value,
          });
          if (!silent) {
            const toastTemplate =
              resolvePageLocale(localeInput) === 'en'
                ? t('filterPane.toast.unmatchedEn', { query: fallbackQuery })
                : t('filterPane.toast.unmatchedSite', { query: fallbackQuery });
            showToast(toastTemplate);
          }
        };

        const syncFallback = resolveFallbackQuerySync(version, mod, matchKey, localeInput);
        if (syncFallback !== null) {
          emitFallback(syncFallback);
        } else {
          void resolveFallbackQueryForUnmatchedMod(version, mod, matchKey, localeInput).then(
            emitFallback,
          );
        }
      }
    };

    // 點擊展開 Tier 加號時，自動帶入該階級的數值區間 (max 預設不帶入數值；無官方 ID 時不可帶入數值)
    const addTierFilter = (mod: ModGroup, tier: ModTier, currentAffinity: string) => {
      const tierOfficialId =
        tier.officialId ||
        (isTradeStatId(tier.id) ? tier.id : undefined) ||
        (tier.ids && tier.ids.length > 0 ? tier.ids[0] : undefined) ||
        mod.officialId ||
        (mod.ids && mod.ids.length > 0 ? mod.ids[0] : undefined);

      const hasOfficialId = Boolean(tierOfficialId);
      if (!hasOfficialId) {
        addStatFilter(
          { ...tier, officialId: tierOfficialId, affinities: [currentAffinity] },
          undefined,
          undefined,
          mod.key,
        );
        return;
      }
      const { atLeast } = getTierFilterBounds(mod.key, tier);
      addStatFilter(
        {
          ...tier,
          officialId: tierOfficialId,
          ids: tier.ids || (tierOfficialId ? [tierOfficialId] : mod.ids),
          affinities: [currentAffinity],
        },
        atLeast.mins,
        atLeast.maxs,
        mod.key,
      );
    };

    const showToast = (msg: string) => {
      dispatchPoeEvent('poexd-toast', {
        message: msg,
        tone: 'default',
        durationMs: 3000,
      });
    };

    let lastDetectedType: string | null = null;

    const handleEquipmentTypeChange = (detail: { type: string | null }) => {
      const detectedType = detail.type;
      if (detectedType && availableTypes.value.includes(detectedType)) {
        if (detectedType !== lastDetectedType) {
          selectedType.value = detectedType;
          lastDetectedType = detectedType;
          searchQuery.value = ''; // 僅當裝備大類變更時清空搜尋
        }
      } else if (!detectedType) {
        if (lastDetectedType !== 'body-armour') {
          selectedType.value = 'body-armour';
          lastDetectedType = 'body-armour';
          searchQuery.value = '';
        }
      }
    };

    const handleTriggerSelectTypeModal = () => {
      isSelectDropdownOpen.value = true;
    };

    let removeEquipmentTypeListener = () => {};
    let removeSelectTypeModalListener = () => {};

    onMounted(() => {
      removeEquipmentTypeListener = listenPoeEvent(
        'poexd-equipment-type-changed',
        handleEquipmentTypeChange,
      );
      removeSelectTypeModalListener = listenPoeEvent(
        'poexd-trigger-select-type-modal',
        handleTriggerSelectTypeModal,
      );
      dispatchPoeEvent('poexd-request-official-category');
    });

    onUnmounted(() => {
      if (isSelectDropdownOpen.value) {
        emit('type-dialog-open-changed', false);
      }
      removeEquipmentTypeListener();
      removeSelectTypeModalListener();
    });

    watch(
      () => props.isOpen,
      (newVal) => {
        if (newVal) {
          setTimeout(() => {
            const input = getSearchInputElement();
            input?.focus();
            input?.select();
          }, 60);
        }
      },
    );

    // 切換物品類別後，清空已選擇詞綴，並預設展開所有詞綴大類手風琴
    watch(selectedType, () => {
      selectedModsMap.value = new Map();
      expandedCategories.value.clear();
    });

    const toggleMaxLimit = (key: string) => {
      const newMap = new Map(selectedModsMap.value);
      const info = newMap.get(key);
      if (info) {
        const modObj = currentTypeGroups.value.find((m) => m.id === info.id);
        const tier =
          info.selectedTierIndex !== undefined
            ? modObj?.tiers?.[info.selectedTierIndex]
            : undefined;
        // 負值階級（市集填 -18）的「至少此階」在最大值，上限改在最小值
        const capField = tier?.tradeNegated ? 'mins' : 'maxs';
        if (info[capField]) {
          newMap.set(key, { ...info, [capField]: undefined });
        } else if (modObj && tier) {
          const { cap } = getTierFilterBounds(modObj.key, tier);
          newMap.set(key, { ...info, [capField]: cap });
        } else {
          newMap.set(key, { ...info });
        }
        selectedModsMap.value = newMap;
      }
    };

    return {
      t,
      loading,
      selectedType,
      searchQuery,
      searchInputRef,
      generationFilter,
      availableTypes,
      groupedAffixes,
      expandedCategories,
      toggleCategory,
      clearSearchQuery,
      isEmpty,
      isSelectDropdownOpen,
      setSelectDialogOpen,
      typeSearchQuery,
      typeSearchInputRef,
      typeOptionsRootRef,
      closeSelectDropdown,
      groupedAvailableTypes,
      dialogActiveCategory,
      toggleSelectDropdown,
      selectTypeOption,
      getTypeName,
      formatModText,
      addStatFilter,
      addTierFilter,
      expandedKeys,
      toggleExpand,
      selectedModsMap,
      toggleMaxLimit,
      navAnchorsRef,
      scrollContainerRef,
      isModSelected,
      isTierSelected,
      toggleModSelection,
      toggleTierSelection,
      selectAllCurrent,
      clearAllSelection,
      applyT1ToSelected: handleApplyT1ToSelected,
      scrollToCategory,
      confirmBatchSelection,
      groupedSelectedMods,
      scrollToMod,
      currentActiveCategory,
      getDisplayTier,
      getDisplayValues,
      getPendingModLabel,
      removeSingleSelection,
      handleScroll,
    };
  },
});
</script>
