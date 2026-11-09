<template>
  <div
    ref="paneRootRef"
    data-sidebar-pane="live-search-primary"
    class="livesearch-primary-pane flex flex-col h-full min-h-0 select-none overflow-hidden"
  >
    <!-- 若 controller 未提供，顯示安全不可用狀態 -->
    <div
      v-if="!controller"
      data-test="controller-unavailable"
      class="flex flex-col items-center justify-center p-[var(--pxd-space-lg)] m-[var(--pxd-pane-padding)] rounded-md border border-dashed border-border bg-card/50 text-center gap-[var(--pxd-space-sm)] my-auto"
    >
      <Radio class="size-[var(--control-icon-lg,20px)] text-muted-foreground/40" />
      <span class="text-[length:var(--pxd-font-body)] font-medium text-muted-foreground">
        {{ t('liveSearch.primary.notInitialized') }}
      </span>
      <span
        class="text-[length:var(--pxd-font-caption)] text-muted-foreground max-w-[240px] leading-relaxed"
      >
        {{ t('liveSearch.primary.notInitializedHint') }}
      </span>
    </div>

    <template v-else>
      <!-- 固定區：Compact Status Header / Rate Details / Search & Filter Toolbar -->
      <div
        data-test="primary-fixed-area"
        class="shrink-0 flex flex-col gap-[var(--pxd-space-sm)] p-[var(--pxd-pane-padding)] pb-[var(--pxd-space-sm)]"
      >
        <!-- Compact Console Status Header -->
        <div
          data-test="runtime-summary"
          class="flex items-center justify-between gap-[var(--pxd-space-xs)] px-[var(--pxd-space-md)] py-[var(--pxd-space-xs)] rounded-md bg-muted/40 border border-border text-[length:var(--pxd-font-caption)]"
        >
          <div class="flex items-center gap-[var(--pxd-space-xs)] min-w-0 flex-1 overflow-hidden">
            <!-- League Selector (Compact Status Header) -->
            <DropdownMenu
              :open="isLeagueMenuOpen"
              @update:open="(open) => (isLeagueMenuOpen = open)"
            >
              <DropdownMenuTrigger as-child>
                <button
                  type="button"
                  data-test="league-selector-trigger"
                  class="inline-flex items-center gap-1 font-semibold text-foreground hover:bg-muted/70 px-1.5 py-0.5 rounded-sm cursor-pointer transition-colors max-w-[150px] truncate shrink-0"
                  :disabled="isSwitchingLeague || isBatchRunning"
                  :title="
                    t('liveSearch.primary.switchLeagueTitle', { league: selectedLeagueDisplay })
                  "
                >
                  <span data-test="summary-league" class="truncate">
                    {{ selectedLeagueDisplay }}
                  </span>
                  <Loader2
                    v-if="isSwitchingLeague"
                    class="size-[var(--control-icon-sm,14px)] animate-spin shrink-0 text-muted-foreground"
                  />
                  <ChevronDown
                    v-else
                    class="size-[var(--control-icon-sm,14px)] shrink-0 text-muted-foreground transition-transform duration-150"
                    :class="{ 'rotate-180': isLeagueMenuOpen }"
                  />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem
                  v-for="league in availableLeagues"
                  :key="league"
                  :data-test="`league-option-${league}`"
                  :disabled="isSwitchingLeague"
                  class="cursor-pointer flex items-center justify-between gap-2"
                  @click="handleSwitchLeague(league)"
                >
                  <span>{{ formatLiveSearchDisplayLeague(league) }}</span>
                  <Check
                    v-if="league.toLowerCase() === currentSelectedLeague.toLowerCase()"
                    class="size-[var(--control-icon-sm,14px)] text-primary"
                  />
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <span class="text-muted-foreground shrink-0">·</span>

            <span data-test="summary-count" class="font-medium text-foreground shrink-0 font-mono">
              {{ activeSubscriptionCount }} {{ t('liveSearch.primary.watching') }}
            </span>

            <template v-if="errorSubscriptionCount > 0">
              <span class="text-muted-foreground shrink-0">·</span>
              <span
                data-test="summary-error-count"
                class="font-medium text-destructive shrink-0 font-mono"
              >
                {{ errorSubscriptionCount }} {{ t('liveSearch.primary.error') }}
              </span>
            </template>
          </div>

          <!-- Compact API Rate Status Trigger -->
          <button
            type="button"
            data-test="btn-toggle-rate-details"
            class="shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded-sm hover:bg-muted transition-colors cursor-pointer"
            :aria-expanded="isRateDetailsOpen"
            :title="t('liveSearch.primary.rateToggleTitle')"
            @click="isRateDetailsOpen = !isRateDetailsOpen"
          >
            <span
              data-test="rate-limit-status"
              class="font-medium font-mono"
              :class="isRateWaiting ? 'text-amber-500' : 'text-emerald-500'"
            >
              {{
                isRateWaiting
                  ? t('liveSearch.primary.rateWaiting', { seconds: remainingWaitSeconds })
                  : t('liveSearch.primary.rateNormal')
              }}
            </span>
            <ChevronDown
              class="size-[var(--control-icon-sm,14px)] text-muted-foreground transition-transform duration-150"
              :class="{ 'rotate-180': isRateDetailsOpen }"
            />
          </button>
        </div>

        <!-- 展開式 API Rate Limit Details (Session UI State) -->
        <div
          v-show="isRateDetailsOpen"
          data-test="rate-limit-details"
          class="flex flex-col gap-[var(--pxd-space-xs)] p-[var(--pxd-space-sm)] rounded-md border border-border bg-card/60 text-[length:var(--pxd-font-caption)]"
        >
          <div
            class="flex items-center justify-between gap-[var(--pxd-space-sm)] text-muted-foreground"
          >
            <span class="truncate"> {{ t('liveSearch.primary.rateStatusTitle') }} </span>
            <span data-test="rate-limit-next-allowed" class="shrink-0 font-mono">
              {{
                t('liveSearch.primary.rateNextRequest', {
                  time:
                    remainingWaitSeconds > 0
                      ? t('liveSearch.primary.rateSeconds', { seconds: remainingWaitSeconds })
                      : t('liveSearch.primary.rateImmediate'),
                })
              }}
            </span>
          </div>

          <div
            v-if="rateRuleEntries.length === 0"
            data-test="rate-limit-empty"
            class="text-muted-foreground text-center py-[var(--pxd-space-xs)] border-t border-border/60"
          >
            {{ t('liveSearch.primary.noRateData') }}
          </div>
          <div
            v-for="[ruleName, windows] in rateRuleEntries"
            :key="ruleName"
            data-test="rate-limit-rule"
            :data-rule="ruleName"
            class="flex flex-col gap-[var(--pxd-space-xs)] p-[var(--pxd-space-xs)] rounded-sm bg-background/60 border border-border/50"
          >
            <span data-test="rate-limit-rule-name" class="font-semibold text-foreground">
              {{ formatRuleName(ruleName) }}
            </span>
            <div
              v-for="(win, idx) in windows"
              :key="idx"
              data-test="rate-limit-window"
              class="grid grid-cols-2 gap-x-[var(--pxd-space-xs)] gap-y-0.5 font-mono text-muted-foreground"
            >
              <span class="text-foreground font-semibold">{{
                t('liveSearch.rateLimit.used', { used: win.used, limit: win.limit })
              }}</span>
              <span>{{ t('liveSearch.rateLimit.window', { seconds: win.window }) }}</span>
              <span>{{ t('liveSearch.rateLimit.windowLeft', { seconds: win.windowLeft }) }}</span>
              <span>{{ t('liveSearch.rateLimit.cooldown', { seconds: win.cooldown }) }}</span>
              <span class="col-span-2">{{
                t('liveSearch.rateLimit.cooldownLeft', { seconds: win.cooldownLeft })
              }}</span>
            </div>
          </div>
        </div>

        <!-- 搜尋與狀態篩選固定主要工具列 -->
        <div data-test="search-connections-toolbar" class="flex flex-col gap-[var(--pxd-space-sm)]">
          <div class="flex items-center gap-[var(--pxd-space-xs)]">
            <div class="relative flex-1 min-w-0 flex items-center">
              <Search
                class="pointer-events-none absolute left-2.5 size-[var(--control-icon-sm,14px)] text-muted-foreground"
              />
              <Input
                v-model="searchQuery"
                type="text"
                size="sm"
                data-test="search-connections-input"
                :placeholder="t('liveSearch.primary.searchPlaceholder')"
                class="w-full pl-8 pr-7 text-[length:var(--pxd-font-caption)]"
                @keydown.esc.stop.prevent="clearSearch"
              />
              <Button
                v-if="searchQuery"
                type="button"
                variant="ghost"
                size="icon-sm"
                data-test="btn-clear-search"
                class="absolute right-1"
                :title="t('bookmark.search.clearTooltip')"
                @click="clearSearch"
              >
                <X />
              </Button>
            </div>
          </div>

          <ToggleGroup
            type="single"
            :model-value="statusFilter"
            variant="outline"
            size="sm"
            data-test="connection-status-filter-bar"
            class="w-full grid grid-cols-4 gap-0"
            @update:model-value="handleStatusFilterChange"
          >
            <ToggleGroupItem
              v-for="opt in statusFilterOptions"
              :key="opt.value"
              :value="opt.value"
              :data-test="`filter-status-${opt.value}`"
              class="text-[length:var(--pxd-font-caption)] px-1 w-full justify-center"
            >
              {{ opt.label }}
            </ToggleGroupItem>
          </ToggleGroup>

          <!-- 結果區依連線篩選提示 -->
          <div
            v-if="resultFilterKey"
            data-test="result-filter-banner"
            class="flex items-center justify-between gap-[var(--pxd-space-xs)] px-[var(--pxd-space-sm)] py-0.5 rounded-sm border border-primary/40 bg-primary/10 text-[length:var(--pxd-font-caption)]"
          >
            <span class="truncate min-w-0 text-foreground">
              {{ t('liveSearch.resultFilter.banner', { name: resultFilterName }) }}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              data-test="btn-clear-result-filter"
              :title="t('liveSearch.resultFilter.clear')"
              :aria-label="t('liveSearch.resultFilter.clear')"
              @click="clearResultFilter"
            >
              <X />
            </Button>
          </div>

          <!-- 開發模式：注入假結果測試官方展示區（不建立連線、不 fetch） -->
          <div
            v-if="isDevBuild && controller?.injectDevResults"
            data-test="dev-inject-bar"
            class="flex items-center gap-[var(--pxd-space-xs)] text-[length:var(--pxd-font-caption)]"
          >
            <span class="font-mono text-muted-foreground shrink-0">DEV</span>
            <Button
              v-for="count in DEV_INJECT_COUNTS"
              :key="count"
              type="button"
              variant="outline"
              size="sm"
              :data-test="`btn-dev-inject-${count}`"
              class="text-[length:var(--pxd-font-caption)] px-2"
              :disabled="isDevInjecting"
              @click="handleDevInject(count)"
            >
              +{{ count }}
            </Button>
            <span
              data-test="dev-inject-status"
              class="truncate min-w-0 font-mono text-muted-foreground"
            >
              {{ devInjectStatus }}
            </span>
          </div>

          <!-- 目前篩選結果統計與批次操作列 (僅在有搜尋關鍵字或狀態篩選非全部時顯示) -->
          <div
            v-if="isFilteredBatchBarVisible"
            data-test="filtered-batch-bar"
            class="flex items-center justify-between gap-[var(--pxd-space-xs)] pt-0.5 text-[length:var(--pxd-font-caption)]"
          >
            <span data-test="filtered-match-count" class="text-muted-foreground font-mono">
              {{ t('liveSearch.primary.filterMatched', { count: filteredSourceIds.length }) }}
            </span>

            <DropdownMenu :open="isFilteredBatchMenuOpen" @update:open="setFilteredBatchMenuOpen">
              <DropdownMenuTrigger as-child>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  data-test="btn-filtered-batch-menu"
                  class="text-[length:var(--pxd-font-caption)] gap-1 px-2"
                  :disabled="filteredSourceIds.length === 0 || isBatchRunning"
                  @pointerdown.capture="handleFilteredTriggerPointerDown"
                  @click.capture="handleMenuTriggerClickCapture"
                  @click.stop="handleFilteredTriggerClick"
                >
                  <span>{{ t('liveSearch.primary.batchAction') }}</span>
                  <ChevronDown class="size-[var(--control-icon-sm,14px)] text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>

              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  data-test="btn-batch-enable-filtered"
                  :disabled="filteredSourceIds.length === 0 || isBatchRunning"
                  @click="handleBatchEnableFiltered"
                >
                  {{ t('liveSearch.primary.enableFiltered') }}
                </DropdownMenuItem>
                <DropdownMenuItem
                  data-test="btn-batch-stop-filtered"
                  :disabled="filteredSourceIds.length === 0 || isBatchRunning"
                  @click="handleBatchStopFiltered"
                >
                  {{ t('liveSearch.primary.stopFiltered') }}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <Separator class="mt-[var(--pxd-space-xs)]" />
      </div>

      <!-- flex-1：單一搜尋連線 list (採用 ScrollArea Foundation) -->
      <TooltipProvider :delay-duration="200">
        <ScrollAreaRoot class="flex-1 box-border h-full min-h-0 relative overflow-hidden">
          <ScrollAreaViewport
            data-test="search-connections-list"
            class="flex flex-col gap-[var(--pxd-bookmark-tree-gap)] box-border h-full w-full min-h-0 px-[var(--pxd-pane-padding)] pb-[var(--pxd-pane-scroll-end-space)] pt-[var(--pxd-space-xs)]"
          >
            <!-- Persistent source loading failure -->
            <div
              v-if="sourceSnapshot?.error"
              data-test="connections-source-error"
              class="flex flex-col items-center justify-center p-[var(--pxd-space-lg)] rounded-md border border-destructive/40 bg-destructive/10 text-center text-destructive gap-[var(--pxd-space-xs)]"
            >
              <span class="font-medium text-[length:var(--pxd-font-caption)]">
                {{ t('liveSearch.primary.loadConnectionsFailed') }}
              </span>
              <span class="text-[length:var(--pxd-font-caption)] opacity-90">{{
                sourceSnapshot.error
              }}</span>
            </div>

            <div
              v-else-if="sourceSnapshot?.loading && !hasAnySources"
              data-test="connections-loading"
              class="text-[length:var(--pxd-font-caption)] text-muted-foreground p-[var(--pxd-space-lg)] text-center"
            >
              {{ t('liveSearch.primary.loadingConnections') }}
            </div>

            <div
              v-else-if="filteredGroups.length === 0"
              data-test="connections-empty"
              class="flex flex-col items-center justify-center p-[var(--pxd-space-lg)] rounded-md border border-dashed border-border text-center text-muted-foreground gap-[var(--pxd-space-xs)]"
            >
              <span class="text-[length:var(--pxd-font-caption)]">
                {{
                  hasAnySources
                    ? t('liveSearch.primary.noMatchingConnections')
                    : t('liveSearch.primary.noAvailableConnections')
                }}
              </span>
              <span v-if="!hasAnySources" class="text-[length:var(--pxd-font-caption)] opacity-70">
                {{ t('liveSearch.primary.emptyGuide') }}
              </span>
              <Button
                v-if="!hasAnySources"
                type="button"
                variant="secondary"
                size="sm"
                data-test="btn-empty-add-connection"
                class="mt-1 text-[length:var(--pxd-font-caption)]"
                @click="handleOpenAddConnection"
              >
                <Plus />
                <span>{{ t('liveSearch.primary.addNewConnection') }}</span>
              </Button>
            </div>

            <template v-else>
              <div
                v-for="group in visibleGroups"
                :key="group.id"
                :data-group-id="group.id"
                :data-group-kind="group.kind"
                :data-parent-id="group.parentId"
                :data-depth="group.depth ?? 0"
                :style="getGroupIndentStyle(group)"
                data-test="connection-group"
                class="group-container flex flex-col rounded-md border border-border bg-card overflow-hidden shrink-0"
              >
                <!-- 可收合 Group Header + 群組批次選單 [⋯] -->
                <div
                  class="group-header-row group relative flex items-center justify-between cursor-pointer select-none border-0 border-solid border-l-2 bg-muted/40 hover:bg-muted/70 px-[var(--pxd-space-md)] py-[var(--pxd-bookmark-row-padding-y)]"
                  :class="{
                    'border-l-primary': group.id !== PREVIOUS_CONNECTIONS_GROUP_ID,
                    'border-l-muted-foreground/60': group.id === PREVIOUS_CONNECTIONS_GROUP_ID,
                    'border-b border-border': !isGroupCollapsed(group.id) && group.items.length > 0,
                  }"
                >
                  <button
                    type="button"
                    data-test="connection-group-header"
                    :data-group-toggle="group.id"
                    :aria-expanded="!isGroupCollapsed(group.id)"
                    class="flex flex-1 min-w-0 items-center justify-between gap-[var(--pxd-space-sm)] text-left cursor-pointer select-none"
                    @click="toggleGroupCollapse(group.id)"
                  >
                    <div class="flex items-center gap-[var(--pxd-space-md)] min-w-0 flex-1">
                      <Radio
                        v-if="group.id === SESSION_CONNECTIONS_GROUP_ID"
                        class="size-[var(--control-icon-sm,14px)] shrink-0 text-primary"
                      />
                      <RotateCcw
                        v-else-if="group.id === PREVIOUS_CONNECTIONS_GROUP_ID"
                        class="size-[var(--control-icon-sm,14px)] shrink-0 text-muted-foreground"
                      />
                      <Folder
                        v-else
                        class="size-[var(--control-icon-sm,14px)] shrink-0 text-muted-foreground"
                      />
                      <span
                        data-test="connection-group-name"
                        class="truncate text-[length:var(--pxd-font-secondary)] font-bold text-foreground"
                        :title="group.name"
                      >
                        {{ group.name }}
                      </span>
                    </div>

                    <div
                      data-test="connection-group-count"
                      class="shrink-0 flex items-center gap-1 text-[length:var(--pxd-font-caption)] font-mono text-muted-foreground"
                    >
                      <span>
                        {{ getGroupStats(group.id).enabledCount }} /
                        {{ getGroupStats(group.id).totalCount }}
                      </span>
                      <template v-if="getGroupStats(group.id).errorCount > 0">
                        <span>·</span>
                        <span
                          data-test="connection-group-error-count"
                          class="text-destructive font-medium"
                        >
                          {{ getGroupStats(group.id).errorCount }}
                          {{ t('liveSearch.primary.error') }}
                        </span>
                      </template>
                      <ChevronDown
                        class="size-[var(--control-icon-sm,14px)] shrink-0 text-muted-foreground transition-transform duration-150 ml-0.5"
                        :class="{ '-rotate-90': isGroupCollapsed(group.id) }"
                      />
                    </div>
                  </button>

                  <!-- 本次連線標題列快捷 [＋ 新增搜尋連線] -->
                  <Button
                    v-if="group.id === SESSION_CONNECTIONS_GROUP_ID"
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    data-test="btn-group-add-connection"
                    :title="t('liveSearch.primary.addNewConnection')"
                    :aria-label="t('liveSearch.primary.addNewConnection')"
                    class="shrink-0 text-muted-foreground hover:text-foreground ml-1"
                    @click.stop="handleOpenAddConnection"
                  >
                    <Plus />
                  </Button>

                  <!-- 群組快捷啟用操作：若群組或其子樹內存在尚未啟用的項目，直接提供低干擾的快捷啟用操作 -->
                  <Button
                    v-if="hasEnableableSourcesInGroup(group.id)"
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    :data-test="`btn-group-quick-enable-${group.id}`"
                    :title="
                      group.id === PREVIOUS_CONNECTIONS_GROUP_ID
                        ? t('liveSearch.primary.restoreAll')
                        : group.id === SESSION_CONNECTIONS_GROUP_ID
                          ? t('liveSearch.primary.enableAll')
                          : t('liveSearch.primary.enableGroup')
                    "
                    :aria-label="
                      group.id === PREVIOUS_CONNECTIONS_GROUP_ID
                        ? t('liveSearch.primary.restoreAll')
                        : group.id === SESSION_CONNECTIONS_GROUP_ID
                          ? t('liveSearch.primary.enableAll')
                          : t('liveSearch.primary.enableGroup')
                    "
                    class="shrink-0 text-primary hover:text-primary hover:bg-primary/10 ml-1"
                    :disabled="isBatchRunning"
                    @click.stop="handleBatchEnableGroup(group.id)"
                  >
                    <Play />
                  </Button>

                  <DropdownMenu
                    :open="activeGroupMenuId === group.id"
                    @update:open="(open) => setGroupMenuOpen(group.id, open)"
                  >
                    <DropdownMenuTrigger as-child>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        :data-test="`btn-group-menu-${group.id}`"
                        :title="t('liveSearch.primary.groupBatchAction')"
                        :aria-label="t('liveSearch.primary.groupBatchAction')"
                        class="shrink-0 text-muted-foreground hover:text-foreground ml-1"
                        :disabled="isBatchRunning"
                        @pointerdown.capture="handleGroupTriggerPointerDown(group.id, $event)"
                        @click.capture="handleMenuTriggerClickCapture"
                        @click.stop="handleGroupTriggerClick(group.id)"
                      >
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>

                    <DropdownMenuContent align="end">
                      <template v-if="group.id === PREVIOUS_CONNECTIONS_GROUP_ID">
                        <DropdownMenuItem
                          :data-test="`btn-group-enable-all-${group.id}`"
                          :disabled="isBatchRunning"
                          @click="handleBatchEnableGroup(group.id)"
                        >
                          {{ t('liveSearch.primary.restoreAll') }}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          :data-test="`btn-group-clear-${group.id}`"
                          :disabled="isBatchRunning"
                          class="text-destructive focus:text-destructive"
                          @click="handleClearPreviousConnections"
                        >
                          {{ t('liveSearch.primary.clearPreviousRecords') }}
                        </DropdownMenuItem>
                      </template>
                      <template v-else-if="group.id === SESSION_CONNECTIONS_GROUP_ID">
                        <DropdownMenuItem
                          :data-test="`btn-group-enable-all-${group.id}`"
                          :disabled="isBatchRunning"
                          @click="handleBatchEnableGroup(group.id)"
                        >
                          {{ t('liveSearch.primary.enableAll') }}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          :data-test="`btn-group-stop-all-${group.id}`"
                          :disabled="isBatchRunning"
                          @click="handleBatchStopGroup(group.id)"
                        >
                          {{ t('liveSearch.primary.stopAll') }}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          :data-test="`btn-group-clear-stopped-${group.id}`"
                          :disabled="isBatchRunning || !hasStoppedSourcesInGroup(group.id)"
                          class="text-destructive focus:text-destructive"
                          @click="handleClearStoppedSessionConnections"
                        >
                          {{ t('liveSearch.console.removeStopped') }}
                        </DropdownMenuItem>
                      </template>
                      <template v-else>
                        <DropdownMenuItem
                          :data-test="`btn-group-enable-all-${group.id}`"
                          :disabled="isBatchRunning"
                          @click="handleBatchEnableGroup(group.id)"
                        >
                          {{
                            group.kind === 'custom'
                              ? t('liveSearch.primary.enableAllInGroup')
                              : t('liveSearch.primary.enableAllInFolder')
                          }}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          :data-test="`btn-group-stop-all-${group.id}`"
                          :disabled="isBatchRunning"
                          @click="handleBatchStopGroup(group.id)"
                        >
                          {{
                            group.kind === 'custom'
                              ? t('liveSearch.primary.stopAllInGroup')
                              : t('liveSearch.primary.stopAllInFolder')
                          }}
                        </DropdownMenuItem>
                      </template>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <!-- Group Items (收合時隱藏；若該層無 direct items 亦不渲染空區塊) -->
                <div
                  v-if="!isGroupCollapsed(group.id) && group.items.length > 0"
                  data-test="connection-group-items"
                  class="flex flex-col gap-[var(--pxd-space-xs)] px-[var(--pxd-space-xs)] py-[var(--pxd-bookmark-folder-body-padding-y)] bg-background"
                >
                  <div
                    v-for="item in group.items"
                    :key="item.id"
                    :data-source-id="item.id"
                    :data-source-kind="item.kind"
                    :data-source-compatibility="item.compatibility"
                    data-test="connection-item"
                    :draggable="item.removable ? 'true' : undefined"
                    class="flex flex-col gap-[var(--pxd-space-xs)] py-[var(--pxd-bookmark-row-padding-y)] px-[var(--pxd-space-sm)] rounded-sm transition-colors"
                    :class="getConnectionRowClasses(item)"
                    @dragstart="handleConnectionDragStart(item, group.id, $event)"
                    @dragend="handleConnectionDragEnd"
                  >
                    <div
                      class="flex items-center justify-between gap-[var(--pxd-space-xs)] min-w-0"
                    >
                      <TradeSearchPreviewTooltip
                        :open="activeEntityKey === getPreviewEntityKey(item)"
                        :disabled="item.compatibility === 'invalid-url'"
                        :side="tooltipSide"
                        :source-name="item.name"
                        :boundary-anchor="paneRootRef"
                        :preview-data="
                          activeEntityKey === getPreviewEntityKey(item) ? activePreviewData : null
                        "
                        @update:open="(open) => handlePreviewOpenChange(item, open)"
                      >
                        <div
                          data-test="connection-item-identity"
                          class="flex items-center gap-[var(--pxd-space-sm)] min-w-0 flex-1 outline-none"
                          :class="
                            isResultFilterable(item, group) ? 'cursor-pointer' : 'cursor-default'
                          "
                          :data-result-filter-active="
                            isResultFilterTarget(item) ? 'true' : undefined
                          "
                          @click="handleToggleResultFilter(item, group)"
                        >
                          <img
                            v-if="item.coverImageUrl"
                            :key="item.coverImageUrl"
                            :src="item.coverImageUrl"
                            data-test="connection-item-thumbnail"
                            class="size-[var(--control-height-sm)] shrink-0 object-contain"
                            alt=""
                            draggable="false"
                            @error="handleCoverImageError"
                          />
                          <span
                            v-else-if="item.kind === 'bookmark'"
                            data-test="connection-item-placeholder"
                            class="flex size-[var(--control-height-sm)] shrink-0 items-center justify-center text-[length:var(--pxd-font-secondary)] leading-none text-muted-foreground select-none"
                            >•</span
                          >
                          <span
                            data-test="connection-item-name"
                            :data-folder="getItemFolderBadge(item, group) || undefined"
                            class="text-[length:var(--pxd-font-caption)] truncate min-w-0 flex-1"
                            :class="
                              isItemActive(item.status)
                                ? 'font-semibold text-foreground'
                                : 'font-medium text-foreground'
                            "
                          >
                            {{ item.name }}
                          </span>
                        </div>
                      </TradeSearchPreviewTooltip>

                      <div class="flex items-center gap-[var(--pxd-space-xs)] shrink-0">
                        <!-- 不相容且未處於 active/error：顯示單一精簡不相容原因標籤/Tooltip，禁止啟用 -->
                        <template
                          v-if="!isItemCompatible(item) && !isItemActiveOrError(item.status)"
                        >
                          <Tooltip>
                            <TooltipTrigger as-child>
                              <span
                                :data-test="`compatibility-${item.id}`"
                                :aria-label="item.compatibilityMessage"
                                class="px-1.5 py-0.5 rounded-sm text-[length:var(--pxd-font-caption)] font-medium whitespace-nowrap text-muted-foreground border border-border/50 bg-background/50 cursor-help"
                              >
                                {{ getIncompatibleLabel(item.compatibility) }}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent v-if="item.compatibilityMessage" side="top">
                              {{ item.compatibilityMessage }}
                            </TooltipContent>
                          </Tooltip>
                        </template>

                        <template v-else>
                          <!-- 單一狀態與操作合一按鈕：依連線狀態切換圖示、色彩與可點擊性 -->
                          <!-- 1. 排隊 / 連線中 / 重連中：轉換為旋轉圖示且不可按 -->
                          <Button
                            v-if="isItemConnectingOrPending(item)"
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            :data-test="
                              item.pending ? `btn-enable-${item.id}` : `btn-connecting-${item.id}`
                            "
                            :data-status="getItemStatusText(item)"
                            :title="getItemConnectingTitle(item)"
                            :aria-label="getItemConnectingTitle(item)"
                            class="shrink-0 text-amber-500 disabled:opacity-100"
                            disabled
                          >
                            <Loader2 class="animate-spin text-amber-500" />
                          </Button>

                          <!-- 2. 監聽中 (active)：點擊暫停 -->
                          <Button
                            v-else-if="item.status === 'active'"
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            :data-test="`btn-stop-${item.id}`"
                            data-status="監聽中"
                            :title="t('liveSearch.primary.pauseTooltip')"
                            :aria-label="t('liveSearch.primary.pause')"
                            class="shrink-0 text-emerald-500 hover:text-foreground hover:bg-muted/60"
                            :disabled="isBatchRunning"
                            @click="handleStopSource(item)"
                          >
                            <Pause />
                          </Button>

                          <!-- 3. 異常已停止 (error)：左側紅條 + 警示色重啟按鈕 -->
                          <Button
                            v-else-if="item.status === 'error'"
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            :data-test="`btn-retry-${item.id}`"
                            data-status="異常"
                            :title="
                              item.errorMessage
                                ? t('liveSearch.primary.errorRetryTooltip', {
                                    error: item.errorMessage,
                                  })
                                : t('liveSearch.primary.retryTooltip')
                            "
                            :aria-label="t('liveSearch.primary.retry')"
                            class="shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                            :disabled="isBatchRunning"
                            @click="handleRetrySource(item)"
                          >
                            <RotateCcw />
                          </Button>

                          <!-- 4. 未啟用 / 已暫停 (idle / closed)：點擊啟用 -->
                          <Button
                            v-else
                            type="button"
                            variant="secondary"
                            size="icon-sm"
                            :data-test="`btn-enable-${item.id}`"
                            data-status="未啟用"
                            :title="t('liveSearch.primary.enable')"
                            :aria-label="t('liveSearch.primary.enable')"
                            class="shrink-0"
                            :disabled="isBatchRunning"
                            @click="handleEnableSource(item.id)"
                          >
                            <Play />
                          </Button>
                        </template>

                        <!-- 次要操作選單 [⋯]：連線中取消或移除連線 -->
                        <DropdownMenu
                          v-if="hasItemSecondaryActions(item)"
                          :open="activeItemMenuId === item.id"
                          @update:open="(open) => setItemMenuOpen(item.id, open)"
                        >
                          <DropdownMenuTrigger as-child>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              :data-test="`btn-item-menu-${item.id}`"
                              :title="t('liveSearch.primary.moreActions')"
                              :aria-label="t('liveSearch.primary.moreActions')"
                              class="text-muted-foreground hover:text-foreground shrink-0"
                              @pointerdown.capture="handleItemTriggerPointerDown(item.id, $event)"
                              @click.capture="handleMenuTriggerClickCapture"
                              @click.stop="handleItemTriggerClick(item.id)"
                            >
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>

                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              v-if="item.status === 'connecting' || item.status === 'reconnecting'"
                              :data-test="`btn-stop-${item.id}`"
                              @click="handleStopSource(item)"
                            >
                              {{ t('liveSearch.primary.stopConnection') }}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              v-if="item.removable"
                              :data-test="`btn-remove-${item.id}`"
                              class="text-destructive focus:text-destructive"
                              @click="handleRemoveSource(item, group.id)"
                            >
                              {{
                                group.id === PREVIOUS_CONNECTIONS_GROUP_ID
                                  ? t('liveSearch.primary.removePreviousRecord')
                                  : group.id === SESSION_CONNECTIONS_GROUP_ID
                                    ? t('liveSearch.primary.removeFromSession')
                                    : t('liveSearch.primary.removeTempSearch')
                              }}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>

                    <!-- 錯誤訊息 (若適用) -->
                    <div
                      v-if="item.errorMessage"
                      :data-test="`error-${item.id}`"
                      class="text-[length:var(--pxd-font-caption)] text-destructive leading-tight break-words"
                    >
                      {{ item.errorMessage }}
                    </div>
                  </div>
                </div>
              </div>
            </template>
          </ScrollAreaViewport>
          <ScrollBar />
          <ScrollAreaCorner />
        </ScrollAreaRoot>
      </TooltipProvider>

      <!-- 拖曳刪除垃圾桶區 -->
      <DragTrashZone
        :ref="(c: any) => (trashZone = c ? (c.$el ?? c) : null)"
        data-test="live-search-drag-trash"
        :visible="isDragging"
        :over-trash="isOverTrash"
        :sidebar-position="sidebarPosition"
        :style="trashStyle"
        @drop.prevent="handleTrashDrop"
      >
        <div
          class="text-center text-[length:var(--pxd-font-secondary)] font-bold leading-snug select-none"
        >
          {{ t('liveSearch.primary.releaseToRemove') }}
        </div>
      </DragTrashZone>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted, type PropType } from 'vue';
import {
  Check,
  ChevronDown,
  Folder,
  Loader2,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Radio,
  RotateCcw,
  Search,
  X,
} from '@lucide/vue';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  ScrollAreaCorner,
  ScrollAreaRoot,
  ScrollAreaViewport,
  ScrollBar,
} from '@/components/ui/scroll-area';
import DragTrashZone from './layout/DragTrashZone.vue';
import TradeSearchPreviewTooltip from './search-preview/TradeSearchPreviewTooltip.vue';
import { resolveBatchEnableToast, resolveBatchStopToast } from './live-search-presentation';
import { hideDragTrash, showDragTrash, useDragTrash } from './composables/useDragTrash';
import { useTradeSearchPreview } from './composables/useTradeSearchPreview';
import { getFolderAncestors, getFolderDepth } from '@/utils/bookmark-collection';
import { dispatchPoeEvent } from '@/utils/event-contracts';
import {
  DEFAULT_PREFERENCES,
  getPreferences,
  type Preferences,
  type PreferencesModule,
} from '@/utils/preferences';
import { getPoeVersion } from '@/utils/trade-context';
import { t } from '@/utils/i18n';
import type {
  LiveSearchPrimaryController,
  LiveSearchPrimaryViewSnapshot,
  LiveSearchSubscriptionStatus,
  TradeRateLimitWindow,
} from '@/utils/live-search-contract';
import {
  PREVIOUS_CONNECTIONS_GROUP_ID,
  SESSION_CONNECTIONS_GROUP_ID,
  createLiveSearchSourceController,
  filterLiveSearchSourceGroups,
  formatLiveSearchDisplayLeague,
  getLiveSearchGroupSubtreeItems,
  getLiveSearchGroupSubtreeSourceIds,
  matchesLiveSearchSourceStatusFilter,
  type LiveSearchBatchOutcome,
  type LiveSearchSourceCompatibility,
  type LiveSearchSourceController,
  type LiveSearchSourceGroup,
  type LiveSearchSourceItem,
  type LiveSearchSourceSnapshot,
  type LiveSearchSourceStatusFilter,
} from '@/entrypoints/content/logic/live-search-bookmark-controller';
import type {
  LiveSearchResumeController,
  LiveSearchResumeSnapshot,
} from '@/entrypoints/content/logic/live-search-resume-controller';

const props = defineProps({
  controller: {
    type: Object as PropType<LiveSearchPrimaryController | null>,
    default: null,
  },
  bookmarkController: {
    type: Object as PropType<LiveSearchSourceController | null>,
    default: null,
  },
  sourceController: {
    type: Object as PropType<LiveSearchSourceController | null>,
    default: null,
  },
  resumeController: {
    type: Object as PropType<LiveSearchResumeController | null>,
    default: null,
  },
  preferences: {
    type: Object as PropType<PreferencesModule | null>,
    default: null,
  },
});

const emit = defineEmits<{
  (e: 'open-add-connection'): void;
}>();

function handleOpenAddConnection() {
  emit('open-add-connection');
}

const statusFilterOptions = computed<
  ReadonlyArray<{
    value: LiveSearchSourceStatusFilter;
    label: string;
  }>
>(() => [
  { value: 'all', label: t('liveSearch.primary.filterAll') },
  { value: 'enabled', label: t('liveSearch.primary.filterEnabled') },
  { value: 'disabled', label: t('liveSearch.primary.filterDisabled') },
  { value: 'error', label: t('liveSearch.primary.filterError') },
]);

const paneRootRef = ref<HTMLElement | null>(null);
const snapshot = ref<Readonly<LiveSearchPrimaryViewSnapshot> | null>(null);
const sourceSnapshot = ref<Readonly<LiveSearchSourceSnapshot> | null>(null);

const sidebarPosition = ref<'left' | 'right'>(DEFAULT_PREFERENCES.sidebarPosition ?? 'right');
const tooltipSide = computed<'left' | 'right'>(() => {
  return sidebarPosition.value === 'left' ? 'right' : 'left';
});

const { activeEntityKey, activePreviewData, loadPreview, clearActivePreview } =
  useTradeSearchPreview({
    version: computed(() => getPoeVersion()),
  });

const activePreviewUrl = ref<string | null>(null);

function getPreviewEntityKey(item: { kind: string; id: string }): string {
  return `${item.kind}:${item.id}`;
}

function clearScopedActivePreview(entityKey?: string) {
  if (!entityKey || activeEntityKey.value === entityKey) {
    activePreviewUrl.value = null;
  }
  clearActivePreview(entityKey);
}

function handlePreviewOpenChange(item: LiveSearchSourceItem, open: boolean) {
  const entityKey = getPreviewEntityKey(item);
  if (open) {
    if (item.compatibility === 'invalid-url') {
      clearScopedActivePreview(entityKey);
      return;
    }
    activePreviewUrl.value = item.url;
    loadPreview(entityKey, item.url);
  } else {
    clearScopedActivePreview(entityKey);
  }
}

watch(activeEntityKey, (key) => {
  if (!key) {
    activePreviewUrl.value = null;
  }
});

function handleCoverImageError(event: Event) {
  (event.currentTarget as HTMLImageElement).style.visibility = 'hidden';
}

const isBatchRunning = ref(false);

const searchQuery = ref('');
const statusFilter = ref<LiveSearchSourceStatusFilter>('all');

function handleStatusFilterChange(val: unknown) {
  if (typeof val === 'string' && val.trim()) {
    statusFilter.value = val as LiveSearchSourceStatusFilter;
  }
}
const isRateDetailsOpen = ref(false);
const isLeagueMenuOpen = ref(false);

const currentSelectedLeague = computed(() => {
  return sourceSnapshot.value?.selectedLeague || snapshot.value?.runtimeLeague || 'Standard';
});

const selectedLeagueDisplay = computed(() => {
  return formatLiveSearchDisplayLeague(currentSelectedLeague.value);
});

const availableLeagues = computed(() => {
  return sourceSnapshot.value?.availableLeagues ?? [currentSelectedLeague.value];
});

const isSwitchingLeague = computed(() => {
  return Boolean(sourceSnapshot.value?.isSwitchingLeague);
});

async function handleSwitchLeague(league: string) {
  isLeagueMenuOpen.value = false;
  const sourceCtrl = getActiveSourceController();
  if (!sourceCtrl || isSwitchingLeague.value) return;
  try {
    const success = await sourceCtrl.switchLeague(league);
    if (!success) {
      showToast(t('liveSearch.toast.switchLeagueFailed'), 'error');
    }
  } catch (err) {
    showToast(
      err instanceof Error ? err.message : t('liveSearch.toast.switchLeagueFailed'),
      'error',
    );
  }
}
const collapsedGroupIds = ref<Set<string>>(new Set());
const isFilteredBatchMenuOpen = ref(false);
const activeGroupMenuId = ref<string | null>(null);
const activeItemMenuId = ref<string | null>(null);
const nowMs = ref(Date.now());

const isFilteredBatchBarVisible = computed(() => {
  return Boolean(searchQuery.value.trim()) || statusFilter.value !== 'all';
});

let ignoreNextMenuClick = false;
let menuClickResetTimer: ReturnType<typeof setTimeout> | null = null;
let pointerDownToggledMenu = false;

let unsubscribe: (() => void) | null = null;
let unsubSource: (() => void) | null = null;
let stopPreferences: (() => void) | null = null;
let fallbackSourceController: LiveSearchSourceController | null = null;
let countdownTimer: ReturnType<typeof setInterval> | null = null;
let stopResumeSub: (() => void) | null = null;
const resumeSnapshot = ref<LiveSearchResumeSnapshot | null>(null);
let lastHandledAutoOutcome: LiveSearchBatchOutcome | null = null;

function bindResumeController(ctrl: LiveSearchResumeController | null | undefined) {
  stopResumeSub?.();
  stopResumeSub = null;
  lastHandledAutoOutcome = null;
  if (ctrl) {
    resumeSnapshot.value = ctrl.read();
    stopResumeSub = ctrl.subscribe((snap) => {
      resumeSnapshot.value = snap;
    });
  } else {
    resumeSnapshot.value = null;
  }
}

watch(
  () => resumeSnapshot.value?.autoRestoreOutcome,
  (newOutcome) => {
    if (newOutcome && newOutcome !== lastHandledAutoOutcome) {
      lastHandledAutoOutcome = newOutcome;
      presentBatchEnableOutcome(newOutcome);
    }
  },
  { immediate: true },
);

function showToast(message: string, tone: 'default' | 'error' = 'default') {
  dispatchPoeEvent('poexd-toast', {
    message,
    tone,
    durationMs: 3000,
  });
}

function setIgnoreNextMenuClick() {
  ignoreNextMenuClick = true;
  if (menuClickResetTimer) clearTimeout(menuClickResetTimer);
  menuClickResetTimer = setTimeout(() => {
    ignoreNextMenuClick = false;
    menuClickResetTimer = null;
  }, 400);
}

function handleMenuTriggerClickCapture(event: MouseEvent) {
  if (ignoreNextMenuClick) {
    event.preventDefault();
    event.stopPropagation();
    ignoreNextMenuClick = false;
    if (menuClickResetTimer) {
      clearTimeout(menuClickResetTimer);
      menuClickResetTimer = null;
    }
  }
}

function setFilteredBatchMenuOpen(open: boolean) {
  pointerDownToggledMenu = true;
  if (open) {
    activeGroupMenuId.value = null;
    activeItemMenuId.value = null;
  }
  isFilteredBatchMenuOpen.value = open;
}

function handleFilteredTriggerPointerDown(event: PointerEvent | MouseEvent) {
  pointerDownToggledMenu = false;
  if (isFilteredBatchMenuOpen.value) {
    event.preventDefault();
    event.stopPropagation();
    setIgnoreNextMenuClick();
    isFilteredBatchMenuOpen.value = false;
    pointerDownToggledMenu = true;
  }
}

function handleFilteredTriggerClick() {
  if (pointerDownToggledMenu) {
    pointerDownToggledMenu = false;
    return;
  }
  const next = !isFilteredBatchMenuOpen.value;
  if (next) {
    activeGroupMenuId.value = null;
    activeItemMenuId.value = null;
  }
  isFilteredBatchMenuOpen.value = next;
}

function setGroupMenuOpen(groupId: string, open: boolean) {
  pointerDownToggledMenu = true;
  if (open) {
    isFilteredBatchMenuOpen.value = false;
    activeItemMenuId.value = null;
    activeGroupMenuId.value = groupId;
    return;
  }
  if (activeGroupMenuId.value === groupId) {
    activeGroupMenuId.value = null;
  }
}

function handleGroupTriggerPointerDown(groupId: string, event: PointerEvent | MouseEvent) {
  pointerDownToggledMenu = false;
  if (activeGroupMenuId.value === groupId) {
    event.preventDefault();
    event.stopPropagation();
    setIgnoreNextMenuClick();
    activeGroupMenuId.value = null;
    pointerDownToggledMenu = true;
  }
}

function handleGroupTriggerClick(groupId: string) {
  if (pointerDownToggledMenu) {
    pointerDownToggledMenu = false;
    return;
  }
  if (activeGroupMenuId.value === groupId) {
    activeGroupMenuId.value = null;
  } else {
    isFilteredBatchMenuOpen.value = false;
    activeItemMenuId.value = null;
    activeGroupMenuId.value = groupId;
  }
}

function hasItemSecondaryActions(item: LiveSearchSourceItem): boolean {
  return Boolean(item.removable || item.status === 'connecting' || item.status === 'reconnecting');
}

function setItemMenuOpen(itemId: string, open: boolean) {
  pointerDownToggledMenu = true;
  if (open) {
    isFilteredBatchMenuOpen.value = false;
    activeGroupMenuId.value = null;
    activeItemMenuId.value = itemId;
    return;
  }
  if (activeItemMenuId.value === itemId) {
    activeItemMenuId.value = null;
  }
}

function handleItemTriggerPointerDown(itemId: string, event: PointerEvent | MouseEvent) {
  pointerDownToggledMenu = false;
  if (activeItemMenuId.value === itemId) {
    event.preventDefault();
    event.stopPropagation();
    setIgnoreNextMenuClick();
    activeItemMenuId.value = null;
    pointerDownToggledMenu = true;
  }
}

function handleItemTriggerClick(itemId: string) {
  if (pointerDownToggledMenu) {
    pointerDownToggledMenu = false;
    return;
  }
  if (activeItemMenuId.value === itemId) {
    activeItemMenuId.value = null;
  } else {
    isFilteredBatchMenuOpen.value = false;
    activeGroupMenuId.value = null;
    activeItemMenuId.value = itemId;
  }
}

function applyPreferencesSnapshot(prefSnapshot: Readonly<Preferences>) {
  sidebarPosition.value = prefSnapshot.sidebarPosition ?? 'right';
}

function bindPreferences(mod: PreferencesModule | null | undefined) {
  if (stopPreferences) {
    stopPreferences();
    stopPreferences = null;
  }
  if (mod) {
    stopPreferences = mod.subscribe(applyPreferencesSnapshot);
  }
}

watch(
  () => props.preferences,
  (newPref) => {
    if (newPref) {
      bindPreferences(newPref);
    }
  },
  { immediate: true },
);

onMounted(async () => {
  if (props.preferences) return;
  try {
    const version = getPoeVersion();
    const outcome = await getPreferences(version);
    if (outcome.ok && !props.preferences) {
      bindPreferences(outcome.value);
    }
  } catch {
    // Use DEFAULT_PREFERENCES when storage is unavailable
  }
});

const activeSubscriptionCount = computed(() => {
  const subs = snapshot.value?.subscriptions ?? [];
  let count = 0;
  for (const sub of subs) {
    if (sub.status === 'connecting' || sub.status === 'active' || sub.status === 'reconnecting') {
      count += 1;
    }
  }
  return count;
});

const errorSubscriptionCount = computed(() => {
  const subs = snapshot.value?.subscriptions ?? [];
  let count = 0;
  for (const sub of subs) {
    if (sub.status === 'error') {
      count += 1;
    }
  }
  return count;
});

function clearCountdownTimer() {
  if (countdownTimer !== null) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

function computeRateCountdownEndAtMs(
  rateLimit: Readonly<LiveSearchPrimaryViewSnapshot['rateLimit']> | undefined,
): number {
  if (!rateLimit) return 0;
  let endAtMs = rateLimit.nextAllowedAtMs ?? 0;
  const observedAtMs = rateLimit.observedAtMs;
  if (typeof observedAtMs === 'number' && observedAtMs > 0 && rateLimit.rules) {
    let maxWindowOrCooldownSec = 0;
    for (const windows of Object.values(rateLimit.rules)) {
      if (!Array.isArray(windows)) continue;
      for (const win of windows) {
        if (win.windowLeft > maxWindowOrCooldownSec) {
          maxWindowOrCooldownSec = win.windowLeft;
        }
        if (win.cooldownLeft > maxWindowOrCooldownSec) {
          maxWindowOrCooldownSec = win.cooldownLeft;
        }
      }
    }
    if (maxWindowOrCooldownSec > 0) {
      endAtMs = Math.max(endAtMs, observedAtMs + maxWindowOrCooldownSec * 1000);
    }
  }
  return endAtMs;
}

function syncCountdownTimer(
  rateLimit: Readonly<LiveSearchPrimaryViewSnapshot['rateLimit']> | undefined,
) {
  nowMs.value = Date.now();
  const targetEndAtMs = computeRateCountdownEndAtMs(rateLimit);
  if (targetEndAtMs > nowMs.value) {
    if (countdownTimer === null) {
      countdownTimer = setInterval(() => {
        nowMs.value = Date.now();
        if (nowMs.value >= computeRateCountdownEndAtMs(snapshot.value?.rateLimit)) {
          clearCountdownTimer();
        }
      }, 250);
    }
  } else {
    clearCountdownTimer();
  }
}

const remainingWaitSeconds = computed(() => {
  const nextAllowedAtMs = snapshot.value?.rateLimit?.nextAllowedAtMs ?? 0;
  if (nextAllowedAtMs <= 0) return 0;
  const diffMs = nextAllowedAtMs - nowMs.value;
  return diffMs > 0 ? Math.ceil(diffMs / 1000) : 0;
});

const rateRuleEntries = computed<Array<[string, TradeRateLimitWindow[]]>>(() => {
  const rateLimit = snapshot.value?.rateLimit;
  const rules = rateLimit?.rules;
  if (!rules) return [];
  const observedAtMs = rateLimit?.observedAtMs;
  const elapsedSeconds =
    typeof observedAtMs === 'number' && observedAtMs > 0
      ? Math.floor(Math.max(0, nowMs.value - observedAtMs) / 1000)
      : 0;
  return Object.entries(rules)
    .filter(([, windows]) => Array.isArray(windows) && windows.length > 0)
    .map(([ruleName, windows]) => [
      ruleName,
      windows.map((win) => ({
        ...win,
        windowLeft: Math.max(0, win.windowLeft - elapsedSeconds),
        cooldownLeft: Math.max(0, win.cooldownLeft - elapsedSeconds),
      })),
    ]);
});

const isRateWaiting = computed(() => {
  return remainingWaitSeconds.value > 0;
});

function formatRuleName(rule: string): string {
  const lower = rule.toLowerCase();
  if (lower === 'account') return t('liveSearch.primary.rateAccount');
  if (lower === 'ip') return 'IP';
  if (lower === 'client') return t('liveSearch.primary.rateClient');
  return rule;
}

function clearSearch() {
  searchQuery.value = '';
}

function normalizeGroups(
  rawGroups: readonly LiveSearchSourceGroup[] | undefined,
): LiveSearchSourceGroup[] {
  if (!rawGroups) return [];
  const bookmarkRawGroups = rawGroups.filter((g) => (g.kind ?? 'bookmark') !== 'custom');
  return rawGroups.map((g, index) => {
    const groupKind = g.kind ?? 'bookmark';
    const rawItems = g.items ?? g.bookmarks ?? [];
    const normalizedItems: LiveSearchSourceItem[] = rawItems.map((item) => {
      const status = item.status ?? item.liveSearchStatus;
      const kind = item.kind ?? 'bookmark';
      return {
        ...item,
        kind,
        groupId: item.groupId ?? g.id,
        groupName: item.groupName ?? g.name,
        status,
        liveSearchStatus: status,
        canonicalIdentity: item.canonicalIdentity ?? null,
        canonicalKey: item.canonicalKey ?? null,
        compatibility: item.compatibility,
        compatibilityMessage: item.compatibilityMessage,
        removable: item.removable ?? kind === 'custom',
        coverImageUrl: item.coverImageUrl,
      };
    });
    const resolvedDepth =
      typeof g.depth === 'number'
        ? g.depth
        : groupKind === 'custom'
          ? 0
          : getFolderDepth(bookmarkRawGroups, g.id);
    return {
      ...g,
      kind: groupKind,
      order: typeof g.order === 'number' ? g.order : index,
      depth: resolvedDepth,
      items: normalizedItems,
      bookmarks: normalizedItems,
    };
  });
}

const rawConsoleGroups = computed<readonly LiveSearchSourceGroup[] | undefined>(() => {
  const snap = sourceSnapshot.value;
  if (!snap) return undefined;
  if (Array.isArray(snap.sessionConnections) || Array.isArray(snap.previousConnections)) {
    const result: LiveSearchSourceGroup[] = [];
    const sessionItems = snap.sessionConnections ?? [];
    const previousItems = snap.previousConnections ?? [];
    if (sessionItems.length > 0) {
      result.push({
        id: SESSION_CONNECTIONS_GROUP_ID,
        name: t('liveSearch.primary.sessionGroupName'),
        kind: 'custom',
        order: 0,
        depth: 0,
        items: sessionItems,
        bookmarks: sessionItems,
      });
    }
    if (previousItems.length > 0) {
      result.push({
        id: PREVIOUS_CONNECTIONS_GROUP_ID,
        name: t('liveSearch.primary.previousGroupName'),
        kind: 'custom',
        order: 1,
        depth: 0,
        items: previousItems,
        bookmarks: previousItems,
      });
    }
    return result;
  }
  return snap.groups;
});

const normalizedGroups = computed(() => normalizeGroups(rawConsoleGroups.value));

const groupStatsMap = computed(() => {
  const map = new Map<string, { enabledCount: number; totalCount: number; errorCount: number }>();
  for (const group of normalizedGroups.value) {
    const subtreeItems = getLiveSearchGroupSubtreeItems(normalizedGroups.value, group.id);
    let enabledCount = 0;
    let errorCount = 0;
    for (const item of subtreeItems) {
      if (matchesLiveSearchSourceStatusFilter(item.status, 'enabled')) {
        enabledCount += 1;
      } else if (item.status === 'error') {
        errorCount += 1;
      }
    }
    map.set(group.id, {
      enabledCount,
      totalCount: subtreeItems.length,
      errorCount,
    });
  }
  return map;
});

function getGroupStats(groupId: string) {
  return (
    groupStatsMap.value.get(groupId) ?? {
      enabledCount: 0,
      totalCount: 0,
      errorCount: 0,
    }
  );
}

function getGroupIndentStyle(group: LiveSearchSourceGroup): Record<string, string> {
  const depth = group.depth ?? 0;
  if (depth <= 0) return {};
  const step = '(var(--pxd-space-lg) + var(--pxd-space-md))';
  const sum = Array.from({ length: depth }, () => step).join(' + ');
  return {
    marginLeft: `calc(${sum})`,
  };
}

function isGroupCollapsed(groupId: string): boolean {
  if (isFilteredBatchBarVisible.value) return false;
  return collapsedGroupIds.value.has(groupId);
}

function toggleGroupCollapse(groupId: string) {
  const next = new Set(collapsedGroupIds.value);
  if (next.has(groupId)) {
    next.delete(groupId);
  } else {
    next.add(groupId);
  }
  collapsedGroupIds.value = next;
}

const hasAnySources = computed(() => {
  return normalizedGroups.value.some((g) => g.items.length > 0);
});

const filteredGroups = computed(() => {
  return filterLiveSearchSourceGroups(normalizedGroups.value, {
    query: searchQuery.value,
    statusFilter: statusFilter.value,
  });
});

const visibleGroups = computed<LiveSearchSourceGroup[]>(() => {
  if (isFilteredBatchBarVisible.value || collapsedGroupIds.value.size === 0) {
    return filteredGroups.value;
  }
  const bookmarkGroups = filteredGroups.value.filter((g) => (g.kind ?? 'bookmark') !== 'custom');
  return filteredGroups.value.filter((group) => {
    if (group.kind === 'custom') return true;
    const ancestors = getFolderAncestors(bookmarkGroups, group.id);
    return !ancestors.some((ancestor) => collapsedGroupIds.value.has(ancestor.id));
  });
});

const filteredSourceIds = computed<string[]>(() => {
  const ids: string[] = [];
  for (const group of filteredGroups.value) {
    for (const item of group.items) {
      ids.push(item.id);
    }
  }
  return ids;
});

watch([visibleGroups, collapsedGroupIds, isSwitchingLeague], () => {
  if (!activeEntityKey.value) return;
  if (isSwitchingLeague.value) {
    clearScopedActivePreview();
    return;
  }
  let activeItem: LiveSearchSourceItem | undefined;
  for (const g of visibleGroups.value) {
    if (isGroupCollapsed(g.id)) continue;
    for (const item of g.items) {
      if (getPreviewEntityKey(item) === activeEntityKey.value) {
        activeItem = item;
        break;
      }
    }
    if (activeItem) break;
  }

  if (
    !activeItem ||
    activeItem.compatibility === 'invalid-url' ||
    activePreviewUrl.value === null ||
    activeItem.url !== activePreviewUrl.value
  ) {
    clearScopedActivePreview();
  }
});

function getActiveSourceController(): LiveSearchSourceController | null {
  return props.sourceController ?? props.bookmarkController ?? fallbackSourceController;
}

watch(
  [() => props.controller, () => props.sourceController, () => props.bookmarkController],
  ([newController, newSourceCtrl, newBookmarkCtrl]) => {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    if (unsubSource) {
      unsubSource();
      unsubSource = null;
    }
    if (fallbackSourceController) {
      fallbackSourceController.dispose();
      fallbackSourceController = null;
    }

    if (newController) {
      unsubscribe = newController.subscribe((newSnapshot) => {
        snapshot.value = newSnapshot;
        syncCountdownTimer(newSnapshot.rateLimit);
      });
    } else {
      snapshot.value = null;
      clearCountdownTimer();
    }

    const externalSourceCtrl = newSourceCtrl ?? newBookmarkCtrl;
    if (externalSourceCtrl) {
      unsubSource = externalSourceCtrl.subscribe((newSnapshot) => {
        sourceSnapshot.value = newSnapshot;
      });
    } else if (newController) {
      fallbackSourceController = createLiveSearchSourceController(null, newController);
      unsubSource = fallbackSourceController.subscribe((newSnapshot) => {
        sourceSnapshot.value = newSnapshot;
      });
    } else {
      sourceSnapshot.value = null;
    }
  },
  { immediate: true },
);

const {
  trashZone,
  isDragging,
  isOverTrash,
  trashStyle,
  enableDragScrollBlock,
  disableDragScrollBlock,
  setupTrashListeners,
} = useDragTrash('[data-test="search-connections-list"]');

let trashCleanup: (() => void) | null = null;
const draggingConnection = ref<{ item: LiveSearchSourceItem; groupId: string } | null>(null);

watch(
  trashZone,
  (newEl) => {
    if (trashCleanup) {
      trashCleanup();
      trashCleanup = null;
    }
    if (newEl) {
      trashCleanup = setupTrashListeners(newEl);
    }
  },
  { immediate: true },
);

function handleConnectionDragStart(item: LiveSearchSourceItem, groupId: string, event: DragEvent) {
  if (!item.removable) {
    event.preventDefault();
    return;
  }
  clearScopedActivePreview();
  activeItemMenuId.value = null;
  activeGroupMenuId.value = null;
  isFilteredBatchMenuOpen.value = false;

  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    try {
      event.dataTransfer.setData('text/plain', item.id);
    } catch {}
  }

  draggingConnection.value = { item, groupId };
  isDragging.value = true;
  isOverTrash.value = false;
  if (trashZone.value) {
    trashZone.value.classList.remove('drag-hover');
    showDragTrash(trashZone.value);
  }
  enableDragScrollBlock();
}

function completeTrashDropIfActive() {
  const target = draggingConnection.value;
  if (!target) return;
  draggingConnection.value = null;
  handleRemoveSource(target.item, target.groupId);
}

function handleTrashDrop() {
  if (isOverTrash.value || draggingConnection.value) {
    completeTrashDropIfActive();
  }
  handleConnectionDragEnd();
}

function handleConnectionDragEnd() {
  if (isOverTrash.value && draggingConnection.value) {
    completeTrashDropIfActive();
  }
  draggingConnection.value = null;
  isDragging.value = false;
  isOverTrash.value = false;
  if (trashZone.value) {
    trashZone.value.classList.remove('drag-hover');
    hideDragTrash(trashZone.value);
  }
  disableDragScrollBlock();
}

watch(
  () => props.resumeController,
  (ctrl) => {
    bindResumeController(ctrl);
  },
  { immediate: true },
);

onUnmounted(() => {
  if (trashCleanup) {
    trashCleanup();
    trashCleanup = null;
  }
  disableDragScrollBlock();
  clearScopedActivePreview();
  stopResumeSub?.();
  stopResumeSub = null;
  clearCountdownTimer();
  if (menuClickResetTimer) {
    clearTimeout(menuClickResetTimer);
    menuClickResetTimer = null;
  }
  if (stopPreferences) {
    stopPreferences();
    stopPreferences = null;
  }
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  if (unsubSource) {
    unsubSource();
    unsubSource = null;
  }
  if (fallbackSourceController) {
    fallbackSourceController.dispose();
    fallbackSourceController = null;
  }
});

async function handleEnableSource(sourceId: string) {
  const sourceCtrl = getActiveSourceController();
  if (!sourceCtrl) return;
  try {
    const outcome =
      typeof sourceCtrl.enable === 'function'
        ? await sourceCtrl.enable(sourceId)
        : await sourceCtrl.add(sourceId);
    if (!outcome.success) {
      showToast(outcome.error || t('liveSearch.toast.enableFailed'), 'error');
    }
  } catch (err) {
    showToast(err instanceof Error ? err.message : t('common.error'), 'error');
  }
}

function presentBatchEnableOutcome(outcome: LiveSearchBatchOutcome) {
  const toast = resolveBatchEnableToast(outcome);
  showToast(toast.message, toast.tone);
}

function presentBatchStopOutcome(outcome: LiveSearchBatchOutcome) {
  const toast = resolveBatchStopToast(outcome);
  showToast(toast.message, toast.tone);
}

async function runBatchEnable(sourceIds: readonly string[]) {
  const sourceCtrl = getActiveSourceController();
  if (!sourceCtrl || isBatchRunning.value || sourceIds.length === 0) return;

  activeGroupMenuId.value = null;
  activeItemMenuId.value = null;
  isFilteredBatchMenuOpen.value = false;
  isBatchRunning.value = true;
  try {
    if (typeof sourceCtrl.enableMany === 'function') {
      const outcome = await sourceCtrl.enableMany(sourceIds);
      presentBatchEnableOutcome(outcome);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : t('liveSearch.toast.batchEnableFailed');
    showToast(msg, 'error');
  } finally {
    isBatchRunning.value = false;
  }
}

function runBatchStop(sourceIds: readonly string[]) {
  const sourceCtrl = getActiveSourceController();
  if (!sourceCtrl || isBatchRunning.value || sourceIds.length === 0) return;

  activeGroupMenuId.value = null;
  activeItemMenuId.value = null;
  isFilteredBatchMenuOpen.value = false;
  if (typeof sourceCtrl.stopMany === 'function') {
    const outcome = sourceCtrl.stopMany(sourceIds);
    presentBatchStopOutcome(outcome);
  }
}

async function handleBatchEnableGroup(groupId: string) {
  if (groupId === PREVIOUS_CONNECTIONS_GROUP_ID) {
    const sourceCtrl = getActiveSourceController();
    if (sourceCtrl && typeof sourceCtrl.restoreAllPreviousConnections === 'function') {
      if (isBatchRunning.value) return;
      activeGroupMenuId.value = null;
      activeItemMenuId.value = null;
      isFilteredBatchMenuOpen.value = false;
      isBatchRunning.value = true;
      try {
        const outcome = await sourceCtrl.restoreAllPreviousConnections();
        presentBatchEnableOutcome(outcome);
      } catch (err) {
        const msg = err instanceof Error ? err.message : t('liveSearch.toast.batchEnableFailed');
        showToast(msg, 'error');
      } finally {
        isBatchRunning.value = false;
      }
      return;
    }
  }
  const sourceIds = getLiveSearchGroupSubtreeSourceIds(normalizedGroups.value, groupId);
  if (sourceIds.length === 0) return;
  await runBatchEnable(sourceIds);
}

async function handleClearPreviousConnections() {
  const sourceCtrl = getActiveSourceController();
  if (!sourceCtrl || isBatchRunning.value) return;
  activeGroupMenuId.value = null;
  activeItemMenuId.value = null;
  if (typeof sourceCtrl.clearPreviousConnections === 'function') {
    await sourceCtrl.clearPreviousConnections();
  }
}

function isItemStoppedInSession(item: LiveSearchSourceItem): boolean {
  return !item.pending && !isItemActiveOrError(item.status);
}

function hasStoppedSourcesInGroup(groupId: string): boolean {
  const subtreeItems = getLiveSearchGroupSubtreeItems(normalizedGroups.value, groupId);
  return subtreeItems.some(isItemStoppedInSession);
}

function handleClearStoppedSessionConnections() {
  if (isBatchRunning.value) return;
  activeGroupMenuId.value = null;
  activeItemMenuId.value = null;
  const subtreeItems = getLiveSearchGroupSubtreeItems(
    normalizedGroups.value,
    SESSION_CONNECTIONS_GROUP_ID,
  );
  const stoppedItems = subtreeItems.filter(isItemStoppedInSession);
  for (const item of stoppedItems) {
    handleRemoveSource(item, SESSION_CONNECTIONS_GROUP_ID);
  }
}

function handleBatchStopGroup(groupId: string) {
  const sourceIds = getLiveSearchGroupSubtreeSourceIds(normalizedGroups.value, groupId);
  if (sourceIds.length === 0) return;
  runBatchStop(sourceIds);
}

async function handleBatchEnableFiltered() {
  await runBatchEnable(filteredSourceIds.value);
}

function handleBatchStopFiltered() {
  runBatchStop(filteredSourceIds.value);
}

function handleRetrySource(item: LiveSearchSourceItem) {
  const sourceCtrl = getActiveSourceController();
  if (sourceCtrl && typeof sourceCtrl.retry === 'function') {
    const outcome = sourceCtrl.retry(item.id);
    if (!outcome.success) {
      showToast(outcome.error || t('liveSearch.toast.retryFailed'), 'error');
    }
    return;
  }
  if (props.controller && item.subscriptionId) {
    const outcome = props.controller.retry(item.subscriptionId);
    if (!outcome.success) {
      showToast(outcome.error || t('liveSearch.toast.retryFailed'), 'error');
    }
  }
}

function handleStopSource(item: LiveSearchSourceItem) {
  const sourceCtrl = getActiveSourceController();
  if (sourceCtrl && typeof sourceCtrl.stop === 'function') {
    sourceCtrl.stop(item.id);
    return;
  }
  if (props.controller && item.subscriptionId) {
    props.controller.remove(item.subscriptionId);
  }
}

function handleRemoveSource(item: LiveSearchSourceItem, groupId: string) {
  const sourceCtrl = getActiveSourceController();
  if (!sourceCtrl) return;
  if (groupId === PREVIOUS_CONNECTIONS_GROUP_ID) {
    if (typeof sourceCtrl.removePreviousConnection === 'function') {
      void sourceCtrl.removePreviousConnection(item.id);
      return;
    }
  }
  if (groupId === SESSION_CONNECTIONS_GROUP_ID) {
    if (typeof sourceCtrl.removeSessionConnection === 'function') {
      sourceCtrl.removeSessionConnection(item.id);
      return;
    }
  }
  if (typeof sourceCtrl.removeCustom === 'function') {
    sourceCtrl.removeCustom(item.id);
  }
}

function isItemCompatible(item: LiveSearchSourceItem): boolean {
  return item.compatibility === 'compatible';
}

function getIncompatibleLabel(compatibility?: LiveSearchSourceCompatibility): string {
  switch (compatibility) {
    case 'wrong-version':
      return t('liveSearch.primary.diffVersion');
    case 'wrong-league':
      return t('liveSearch.primary.diffLeague');
    case 'invalid-url':
      return t('liveSearch.primary.invalidUrl');
    default:
      return '';
  }
}

function isItemActive(status?: LiveSearchSubscriptionStatus): boolean {
  return status === 'connecting' || status === 'active' || status === 'reconnecting';
}

function isItemActiveOrError(status?: LiveSearchSubscriptionStatus): boolean {
  return (
    status === 'connecting' ||
    status === 'active' ||
    status === 'reconnecting' ||
    status === 'error'
  );
}

function isItemConnectingOrPending(item: LiveSearchSourceItem): boolean {
  return Boolean(item.pending) || item.status === 'connecting' || item.status === 'reconnecting';
}

function getItemConnectingTitle(item: LiveSearchSourceItem): string {
  if (item.pending && (!item.status || item.status === 'idle' || item.status === 'closed')) {
    return t('liveSearch.tempDialog.starting');
  }
  return getItemStatusText(item);
}

function isItemEnableable(item: LiveSearchSourceItem): boolean {
  return isItemCompatible(item) && !item.pending && !isItemActiveOrError(item.status);
}

function hasEnableableSourcesInGroup(groupId: string): boolean {
  const subtreeItems = getLiveSearchGroupSubtreeItems(normalizedGroups.value, groupId);
  return subtreeItems.some(isItemEnableable);
}

function getConnectionRowClasses(item: LiveSearchSourceItem): Record<string, boolean> {
  const isActive = item.status === 'active';
  const isPendingOrConnecting =
    item.status === 'connecting' || item.status === 'reconnecting' || Boolean(item.pending);
  const isError = item.status === 'error';
  return {
    'border-l-2 border-l-emerald-500 bg-muted/30 border border-border/40': isActive,
    'border-l-2 border-l-amber-500 bg-muted/20 border border-border/40':
      !isActive && isPendingOrConnecting,
    'border-l-2 border-l-destructive bg-destructive/5 border border-destructive/30': isError,
    'bg-background/60 hover:bg-muted/40': !isActive && !isPendingOrConnecting && !isError,
    'opacity-60': !isItemCompatible(item) && !isItemActiveOrError(item.status),
    'cursor-grab active:cursor-grabbing': Boolean(item.removable),
    'ring-1 ring-primary/60': isResultFilterTarget(item),
  };
}

const isDevBuild = import.meta.env.DEV;
const DEV_INJECT_COUNTS = [50, 200, 600] as const;
const isDevInjecting = ref(false);
const devInjectStatus = ref('');

const resultFilterKey = computed(() => snapshot.value?.resultFilterKey ?? null);
const resultFilterName = computed(() => {
  const key = resultFilterKey.value;
  if (!key) return '';
  const match =
    sourceSnapshot.value?.sessionConnections?.find((item) => item.canonicalKey === key) ??
    sourceSnapshot.value?.groups
      ?.flatMap((group) => group.items)
      .find((item) => item.canonicalKey === key);
  return match?.name?.trim() || match?.canonicalIdentity?.searchId || key;
});

function isResultFilterable(item: LiveSearchSourceItem, group: LiveSearchSourceGroup): boolean {
  if (!item.canonicalKey || typeof props.controller?.setResultFilter !== 'function') return false;
  // 本次連線一律可篩選；其他分組（書籤、自訂網址）在已建立監聽時亦可篩選
  return group.id === SESSION_CONNECTIONS_GROUP_ID || Boolean(item.subscriptionId);
}

function isResultFilterTarget(item: LiveSearchSourceItem): boolean {
  return Boolean(resultFilterKey.value) && item.canonicalKey === resultFilterKey.value;
}

function handleToggleResultFilter(item: LiveSearchSourceItem, group: LiveSearchSourceGroup) {
  if (!isResultFilterable(item, group) || !item.canonicalKey) return;
  props.controller?.setResultFilter?.(
    resultFilterKey.value === item.canonicalKey ? null : item.canonicalKey,
  );
}

function clearResultFilter() {
  props.controller?.setResultFilter?.(null);
}

async function handleDevInject(count: number) {
  const inject = props.controller?.injectDevResults;
  if (!isDevBuild || !inject || isDevInjecting.value) return;
  isDevInjecting.value = true;
  devInjectStatus.value = '…';
  const owners = (sourceSnapshot.value?.sessionConnections ?? [])
    .filter((item) => item.canonicalKey && item.canonicalIdentity)
    .map((item) => ({
      canonicalKey: item.canonicalKey as string,
      searchId: item.canonicalIdentity!.searchId,
    }));
  const startedAt = performance.now();
  try {
    const outcome = await inject(count, owners);
    const elapsed = Math.round(performance.now() - startedAt);
    devInjectStatus.value = outcome.error
      ? outcome.error
      : `ok ${outcome.rendered} / fail ${outcome.failed} · ${elapsed}ms`;
  } catch (error) {
    devInjectStatus.value = error instanceof Error ? error.message : String(error);
  } finally {
    isDevInjecting.value = false;
  }
}

function getItemFolderBadge(item: LiveSearchSourceItem, group: LiveSearchSourceGroup): string {
  if (item.kind !== 'bookmark') return '';
  const folder = item.groupName?.trim() ?? '';
  if (
    !folder ||
    folder === '本次連線' ||
    folder === '上次連線' ||
    folder === '暫時搜尋' ||
    folder === t('liveSearch.primary.sessionGroupName') ||
    folder === t('liveSearch.primary.previousGroupName') ||
    folder === t('liveSearch.console.temporarySource') ||
    folder === group.name
  ) {
    return '';
  }
  return folder;
}

function getItemStatusText(item: LiveSearchSourceItem): string {
  const status = item.status;
  if (!status || status === 'idle' || status === 'closed') {
    if (item.pending) {
      return t('liveSearch.primary.pendingStart');
    }
    return t('liveSearch.primary.statusIdle');
  }
  if (status === 'connecting') {
    return t('liveSearch.primary.statusConnecting');
  }
  if (status === 'active') {
    return t('liveSearch.primary.statusActive');
  }
  if (status === 'reconnecting') {
    if (typeof item.reconnectInSeconds === 'number' && item.reconnectInSeconds > 0) {
      return t('liveSearch.primary.reconnectingIn', { seconds: item.reconnectInSeconds });
    }
    return t('liveSearch.primary.reconnecting');
  }
  if (status === 'error') {
    return t('liveSearch.primary.statusError');
  }
  return status;
}
</script>
