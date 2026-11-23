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
          class="modal-nav-anchors-inline pxd-scrollbar w-[var(--pxd-filter-nav-width)] shrink-0 flex flex-col gap-[2px] bg-background border-r border-border pt-[var(--pxd-space-sm)] pr-[var(--pxd-space-xs)] pb-[var(--pxd-space-sm)] pl-0 overflow-y-auto min-h-0 box-border"
          ref="navAnchorsRef"
          v-if="groupedAffixes.length > 0"
        >
          <template v-for="(cat, idx) in groupedAffixes" :key="cat.label">
            <div
              v-if="shouldShowNavDivider(idx)"
              class="my-[var(--pxd-space-xs)] mx-[var(--pxd-space-xs)] border-t border-border/60 shrink-0"
              aria-hidden="true"
            />
            <div
              class="anchor-btn-inline shrink-0 flex items-center justify-center gap-1 min-h-[28px] border border-transparent border-l-[3px] py-[var(--pxd-space-xs)] px-[var(--pxd-space-xs)] text-[length:var(--pxd-font-caption)] text-center cursor-pointer break-all whitespace-normal leading-[1.2] rounded-[var(--radius)] transition-colors select-none box-border"
              :class="
                currentActiveCategory === cat.label
                  ? 'active bg-primary/12 text-foreground border-l-primary font-semibold'
                  : 'bg-transparent text-muted-foreground border-l-transparent hover:bg-accent hover:text-accent-foreground'
              "
              @click="scrollToCategory(cat.label)"
              :title="t('filterPane.nav.jumpTo', { category: cat.label })"
            >
              <span class="anchor-text-inline">{{ cat.label }}</span>
              <span
                v-if="selectedCountByAffinity[cat.affinity]"
                class="inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full bg-primary/20 text-primary text-[10px] font-bold tabular-nums leading-none shrink-0"
              >
                {{ selectedCountByAffinity[cat.affinity] }}
              </span>
            </div>
          </template>
        </div>

        <!-- 左側主要區域 (包含 controls-row 與 mods-scroll-container) -->
        <div class="split-left-main flex-[7.2] flex flex-col min-h-0">
          <!-- 篩選控制項整合為單行（窄螢幕自動換行） -->
          <div
            class="controls-row flex flex-wrap gap-[var(--pxd-space-sm)] mb-[var(--pxd-row-gap)] items-center"
          >
            <!-- 物品類別選擇器（掛載於 Sidebar 時 Teleport 至頂部標題列；單獨掛載時留在控制列內） -->
            <Teleport :to="headerPortalTarget || 'body'" :disabled="!headerPortalTarget">
              <div
                class="control-item item-type custom-select-container flex items-center gap-[var(--pxd-space-sm)] min-w-0 select-none"
                :class="headerPortalTarget ? 'flex-1' : 'flex-[1_1_104px] relative w-full'"
              >
                <span
                  v-if="headerPortalTarget"
                  class="text-muted-foreground/60 text-[length:var(--pxd-font-body)] select-none shrink-0"
                  aria-hidden="true"
                >
                  /
                </span>
                <Popover :open="isTypePopoverOpen" @update:open="handleTypePopoverOpenChange">
                  <PopoverTrigger as-child>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      data-filter-action="open-type-dialog"
                      class="justify-between font-normal"
                      :class="
                        headerPortalTarget ? 'min-w-[110px] max-w-[190px] shrink-0' : 'w-full'
                      "
                    >
                      <span class="truncate text-left flex-1">{{ getTypeName(selectedType) }}</span>
                      <ChevronDown
                        class="text-muted-foreground shrink-0 transition-transform duration-150"
                        :class="isTypePopoverOpen ? 'rotate-180' : ''"
                      />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    side="bottom"
                    :side-offset="6"
                    data-sidebar-dialog="affix-type"
                    :inert="affixDemoMode || undefined"
                    :class="[
                      'flex max-h-[min(78vh,680px)] w-[min(740px,calc(100vw-48px))] flex-col gap-0 overflow-hidden p-0 shadow-xl',
                      affixDemoMode ? 'pointer-events-none select-none' : '',
                    ]"
                    @close-auto-focus="(e) => e.preventDefault()"
                    @pointer-down-outside="preventIfAffixDemo"
                    @interact-outside="preventIfAffixDemo"
                    @escape-key-down="preventIfAffixDemo"
                  >
                    <ItemTypeSelectorPanel
                      ref="typePopoverPanelRef"
                      :search-query="typeSearchQuery"
                      :active-category="dialogActiveCategory"
                      :grouped-available-types="groupedAvailableTypes"
                      :recent-options="recentTypeOptions"
                      @update:search-query="(val) => (typeSearchQuery = val)"
                      @select="selectTypeOption"
                    />
                  </PopoverContent>
                </Popover>

                <Button
                  v-if="headerPortalTarget && syncableOfficialCategory"
                  type="button"
                  variant="ghost"
                  size="sm"
                  data-filter-action="sync-official-category"
                  class="shrink-0 font-normal text-muted-foreground hover:text-foreground gap-1"
                  :title="
                    t('filterPane.header.syncCategoryTitle', {
                      category: syncableOfficialCategory.label,
                    })
                  "
                  @click="syncOfficialCategory"
                >
                  <ArrowUpRight class="size-[var(--control-icon-sm,14px)] shrink-0" />
                  <span class="truncate">{{
                    t('filterPane.header.syncCategory', {
                      category: syncableOfficialCategory.label,
                    })
                  }}</span>
                </Button>

                <span
                  v-if="headerPortalTarget && targetGroupIndex > 0"
                  class="ml-auto inline-flex items-center px-2 py-0.5 rounded-[var(--radius-sm)] bg-muted border border-border text-[length:var(--pxd-font-caption)] text-muted-foreground font-medium shrink-0 select-none"
                >
                  {{ t('filterPane.header.targetGroup', { index: targetGroupIndex + 1 }) }}
                </span>
              </div>
            </Teleport>

            <!-- 關鍵字搜尋輸入框 (帶有一鍵清空打叉按鈕) -->
            <div
              class="control-item item-search relative flex flex-[2.2_1_175px] min-w-0 w-full items-center"
            >
              <Input
                ref="searchInputRef"
                v-model="searchQuery"
                type="text"
                size="sm"
                data-filter-search
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

            <!-- 物品等級區間篩選輸入框 (下限 ~ 上限，帶有一鍵清空打叉按鈕) -->
            <div
              class="control-item item-level flex shrink-0 items-center gap-[var(--pxd-space-xs)]"
              :title="t('filterPane.itemLevel.title')"
            >
              <span
                class="text-[length:var(--pxd-font-caption)] text-muted-foreground whitespace-nowrap select-none"
              >
                {{ t('filterPane.itemLevel.label') }}
              </span>
              <div class="flex items-center gap-[var(--pxd-space-xs)]">
                <Input
                  id="filter-pane-item-level-min"
                  v-model="itemLevelMin"
                  type="number"
                  min="1"
                  max="100"
                  step="1"
                  size="sm"
                  :aria-label="t('filterPane.itemLevel.minAria')"
                  :placeholder="t('filterPane.itemLevel.minPlaceholder')"
                  class="w-[50px] text-center [appearance:textfield] [&::-webkit-outer-spin-button]:m-0 [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none"
                  :class="
                    isInvalidItemLevelRange
                      ? 'border-destructive/70 focus-visible:ring-destructive'
                      : ''
                  "
                />
                <span
                  class="text-[length:var(--pxd-font-caption)] text-muted-foreground select-none"
                >
                  ~
                </span>
                <Input
                  id="filter-pane-item-level-max"
                  v-model="itemLevelMax"
                  type="number"
                  min="1"
                  max="100"
                  step="1"
                  size="sm"
                  :aria-label="t('filterPane.itemLevel.maxAria')"
                  :placeholder="t('filterPane.itemLevel.maxPlaceholder')"
                  class="w-[50px] text-center [appearance:textfield] [&::-webkit-outer-spin-button]:m-0 [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none"
                  :class="
                    isInvalidItemLevelRange
                      ? 'border-destructive/70 focus-visible:ring-destructive'
                      : ''
                  "
                />
                <Button
                  v-if="hasItemLevelFilter"
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  :title="t('filterPane.itemLevel.clearTitle')"
                  @click="clearItemLevelFilter"
                >
                  <X />
                </Button>
              </div>
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

            <!-- 右側輔助操作：搜尋時顯示全選符合；一律提供全部收合／全部展開 -->
            <div class="ml-auto flex shrink-0 items-center gap-[var(--pxd-space-xs)]">
              <Button
                v-if="canSelectAllFiltered"
                type="button"
                variant="outline"
                size="sm"
                class="font-normal"
                :title="t('filterPane.actions.selectAllTitle')"
                @click="selectAllCurrent"
              >
                {{ t('filterPane.actions.selectAllFiltered', { count: filteredModTotalCount }) }}
              </Button>
              <Button
                v-if="!isEmpty"
                type="button"
                variant="outline"
                size="sm"
                data-filter-action="toggle-all-categories"
                class="font-normal gap-1"
                :title="
                  hasAnyExpandedCategory
                    ? t('filterPane.actions.collapseAllTitle')
                    : t('filterPane.actions.expandAllTitle')
                "
                @click="toggleAllCategories"
              >
                <ChevronsDownUp
                  v-if="hasAnyExpandedCategory"
                  class="size-[var(--control-icon-sm,14px)] shrink-0"
                />
                <ChevronsUpDown v-else class="size-[var(--control-icon-sm,14px)] shrink-0" />
                <span>{{
                  hasAnyExpandedCategory ? t('common.collapseAll') : t('common.expandAll')
                }}</span>
              </Button>
            </div>
          </div>

          <!-- 詞綴清單區 -->
          <div
            ref="scrollContainerRef"
            class="mods-scroll-container pxd-scrollbar flex-1 overflow-y-auto min-h-0 pr-[2px]"
            @scroll="handleScroll"
          >
            <FilterAffixSection
              v-for="cat in renderedCategories"
              :key="cat.label"
              :category="cat"
              :expanded="expandedCategories.has(cat.label)"
              :generation-filter="generationFilter"
              :search-query="searchQuery"
              :expanded-keys="expandedKeys"
              :item-level-max="itemLevelRange.max"
              :is-mod-selected="isModSelected"
              :is-tier-selected="isModTierSelected"
              :get-tier-number="resolveModTierNumber"
              @toggle-category="toggleCategory"
              @toggle-expand="toggleExpand"
              @toggle-select="toggleModSelection"
              @toggle-tier-select="handleToggleTierSelection"
              @add-filter="(m, aff) => addStatFilter({ ...m, affinities: [aff] })"
              @add-tier-filter="addTierFilter"
            />

            <div
              v-if="isEmpty"
              class="empty-mods text-center text-muted-foreground text-[length:var(--pxd-font-body)] py-[var(--pxd-space-2xl)]"
            >
              {{
                isInvalidItemLevelRange
                  ? t('filterPane.emptyInvalidItemLevelRange')
                  : t('filterPane.empty')
              }}
            </div>
          </div>
        </div>

        <FilterSelectedPanel
          :selected-count="selectedModsMap.size"
          :grouped-selected-mods="groupedSelectedMods"
          :current-type-groups="currentTypeGroups"
          @scroll-to-mod="scrollToMod"
          @toggle-max-limit="toggleMaxLimit"
          @remove="removeSingleSelection"
          @confirm="confirmBatchSelection"
          @apply-t1="applyT1ToSelected"
          @clear="clearAllSelection"
        />
      </div>

      <!-- 外部觸發（例如市集 T 階下拉切換物品類別）時的置中 Dialog -->
      <Dialog
        :open="isTypeDialogOpen"
        :modal="!affixDemoMode"
        @update:open="
          (open) => {
            if (!affixDemoMode) setSelectDialogOpen(open);
          }
        "
      >
        <DialogContent
          layer="nested"
          data-sidebar-dialog="affix-type"
          :inert="affixDemoMode || undefined"
          :overlay-class="affixDemoMode ? 'pointer-events-none' : undefined"
          close-class="top-[calc((var(--pxd-sidebar-affix-dialog-header-height)-var(--control-height-sm,28px))/2)] right-[var(--pxd-pane-padding)]"
          :class="[
            'flex h-auto max-h-[82vh] w-[calc(100vw-32px)] max-w-[740px] flex-col gap-0 overflow-hidden p-0',
            affixDemoMode ? 'pointer-events-none select-none' : '',
          ]"
          @close-auto-focus="(e) => e.preventDefault()"
          @pointer-down-outside="preventIfAffixDemo"
          @interact-outside="preventIfAffixDemo"
          @escape-key-down="preventIfAffixDemo"
        >
          <DialogHeader
            class="flex h-[var(--pxd-sidebar-affix-dialog-header-height)] shrink-0 flex-row items-center justify-between gap-[var(--pxd-space-md)] space-y-0 border-b border-border bg-background py-0 pl-[var(--pxd-pane-padding)] pr-[calc(var(--control-height-sm,28px)+var(--pxd-pane-padding)+var(--pxd-space-sm))]"
          >
            <DialogTitle class="text-[length:var(--pxd-font-section-title)] font-bold">
              {{ t('common.selectItemCategory') }}
            </DialogTitle>
            <div
              v-if="poexdSelectingTarget"
              class="inline-flex shrink-0 items-center gap-[var(--pxd-space-xs)]"
              data-test="tier-type-sync-official-wrap"
            >
              <Checkbox
                id="pxd-tier-type-sync-official"
                data-test="tier-type-sync-official"
                :model-value="syncOfficialOnTypeSelect"
                @update:model-value="(val) => (syncOfficialOnTypeSelect = val === true)"
              />
              <label
                for="pxd-tier-type-sync-official"
                class="cursor-pointer select-none whitespace-nowrap text-[length:var(--pxd-font-secondary)] text-muted-foreground hover:text-foreground"
                >{{ t('filterPane.dialog.syncOfficialCategory') }}</label
              >
            </div>
            <DialogDescription class="sr-only">{{
              t('filterPane.dialog.description')
            }}</DialogDescription>
          </DialogHeader>

          <ItemTypeSelectorPanel
            ref="typeDialogPanelRef"
            :search-query="typeSearchQuery"
            :active-category="dialogActiveCategory"
            :grouped-available-types="groupedAvailableTypes"
            :recent-options="recentTypeOptions"
            @update:search-query="(val) => (typeSearchQuery = val)"
            @select="selectTypeOption"
          />
        </DialogContent>
      </Dialog>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted, onUnmounted, computed, watch } from 'vue';
import { filterModGroupsByItemLevel, getTierFilterBounds, isTradeStatId } from './utils';
import type { ModTier, ModGroup, SelectedModInfo, StatFilterModPayload } from './types';
import FilterAffixSection from './FilterAffixSection.vue';
import FilterSelectedPanel from './FilterSelectedPanel.vue';
import ItemTypeSelectorPanel from './ItemTypeSelectorPanel.vue';
import { useProgressiveAffixRender } from './composables/useProgressiveAffixRender';
import { useAffixFilter } from './composables/useAffixFilter';
import { useDebouncedRef } from './composables/useDebouncedSearch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ChevronDown, X } from '@lucide/vue';
import { ArrowUpRight, ChevronsDownUp, ChevronsUpDown } from '@lucide/vue';
import { useModSelection } from './composables/useModSelection';
import { dispatchPoeEvent, listenPoeEvent } from '@/utils/event-contracts';
import { resolveOfficialCategoryOption } from '@/utils/official-category-resolver';
import { refreshAndReopenTierSlot } from '@/utils/tier-slot-registry';
import { getPoeVersion } from '@/utils/trade-context';
import {
  resolveFallbackQueryForUnmatchedMod,
  resolveFallbackQuerySync,
} from '@/utils/affix-lexicon';
import { resolvePageLocale } from '@/utils/locale-resolution';
import { readMarketDropdownLocale } from '@/utils/market-translation';
import { getTradeMapping } from './mapping-registry';
import { getAffinityProfile, resolveScopedModGroupId } from '@/utils/affinity-registry';
import { useFilterData } from './composables/useFilterData';
import { useFilterNavigation } from './composables/useFilterNavigation';
import { t } from '@/utils/i18n';
import { affixDemoMode } from '@/utils/page-guide-demo-state';

export default defineComponent({
  name: 'FilterPane',
  components: {
    FilterAffixSection,
    FilterSelectedPanel,
    ItemTypeSelectorPanel,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    Popover,
    PopoverContent,
    PopoverTrigger,
    Input,
    Button,
    Checkbox,
    ToggleGroup,
    ToggleGroupItem,
    ArrowUpRight,
    ChevronDown,
    ChevronsDownUp,
    ChevronsUpDown,
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
    headerPortalTarget: {
      type: Object as () => HTMLElement | null,
      default: null,
    },
  },
  emits: ['type-dialog-open-changed'],
  setup(props, { emit, expose }) {
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
      applyT1ToSelected(
        filterModGroupsByItemLevel(currentTypeGroups.value, itemLevelRange.value),
        resolveCanonicalTierIndex,
      );
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
        const resolvedModGroup = resolveModGroupKey(modObj?.tiers?.[0]) ?? resolveModGroupKey(info);
        addStatFilter(
          {
            key: info.key,
            displayKey: info.displayKey,
            displayTemplate: info.displayTemplate,
            modGroup: resolvedModGroup,
            affinities: modObj?.tiers?.[0]?.affinities?.length
              ? modObj.tiers[0].affinities
              : info.affinities,
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
    const searchInputRef = ref<HTMLInputElement | { $el?: HTMLInputElement } | null>(null);

    const getSearchInputElement = (): HTMLInputElement | undefined => {
      const target = searchInputRef.value;
      if (!target) return undefined;
      if (target instanceof HTMLInputElement) return target;
      if ('$el' in target && target.$el instanceof HTMLInputElement) return target.$el;
      return undefined;
    };

    const setSelectDialogOpen = (open: boolean) => {
      if (open) {
        typeSearchQuery.value = '';
        isSelectDropdownOpen.value = true;
        return;
      }
      closeSelectDropdown();
    };

    const handleTypePopoverOpenChange = (open: boolean) => {
      if (affixDemoMode.value) return;
      setSelectDialogOpen(open);
    };

    // 自訂類別選擇器狀態（詞綴選擇器內用 Popover 展開於下方；外部由 T 階下拉觸發或主彈窗未開時改用置中 Dialog）
    const isSelectDropdownOpen = ref(false);
    const typeSearchQuery = ref('');
    const debouncedTypeSearchQuery = useDebouncedRef(typeSearchQuery);
    const typePopoverPanelRef = ref<InstanceType<typeof ItemTypeSelectorPanel> | null>(null);
    const typeDialogPanelRef = ref<InstanceType<typeof ItemTypeSelectorPanel> | null>(null);
    const poexdSelectingTarget = ref<any>(null);
    const forceCenteredTypeDialog = ref(false);
    const recentTypes = ref<string[]>([]);

    const useCenteredTypeDialog = computed(
      () => forceCenteredTypeDialog.value || Boolean(poexdSelectingTarget.value) || !props.isOpen,
    );
    const isTypePopoverOpen = computed(
      () => isSelectDropdownOpen.value && !useCenteredTypeDialog.value,
    );
    const isTypeDialogOpen = computed(
      () => isSelectDropdownOpen.value && useCenteredTypeDialog.value,
    );

    const recordRecentType = (type: string) => {
      if (!type) return;
      recentTypes.value = [type, ...recentTypes.value.filter((t) => t !== type)].slice(0, 6);
    };

    const closeSelectDropdown = () => {
      isSelectDropdownOpen.value = false;
      forceCenteredTypeDialog.value = false;
      poexdSelectingTarget.value = null;
      (window as any).__poexd_selecting_target__ = null;
    };

    watch(isSelectDropdownOpen, (isOpen) => {
      emit('type-dialog-open-changed', isOpen);
      if (isOpen) {
        poexdSelectingTarget.value = (window as any).__poexd_selecting_target__ || null;
        if (affixDemoMode.value) return;
        setTimeout(() => {
          const panel = useCenteredTypeDialog.value
            ? typeDialogPanelRef.value
            : typePopoverPanelRef.value;
          panel?.focusSearchInput();
          panel?.scrollToSelected();
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

    const fullModById = computed(() => new Map(currentTypeGroups.value.map((m) => [m.id, m])));

    const resolveCanonicalTierIndex = (mod: ModGroup, filteredTierIndex: number): number => {
      const tier = mod.tiers?.[filteredTierIndex];
      const fullMod = fullModById.value.get(mod.id);
      if (!tier || !fullMod) return filteredTierIndex;
      const idx = fullMod.tiers.indexOf(tier);
      return idx !== -1 ? idx : filteredTierIndex;
    };

    const isFilteredTierSelected = (mod: ModGroup, idx: number, affinity: string): boolean => {
      return isTierSelected(mod.id, resolveCanonicalTierIndex(mod, idx), affinity);
    };

    // ModItem 用的穩定函式參考：inline arrow 每次重繪都是新函式，會讓所有已掛載的 ModItem 一起重繪。
    // 模板上的 v-memo 依賴 [mod, affinity, searchQuery, 展開, 勾選]；新增會影響 ModItem 的 prop 時要一併加入。
    // tier 勾選狀態由 ModItem 渲染時自行讀取，不受 v-memo 影響。
    const isModTierSelected = (idx: number, mod: ModGroup, affinity: string): boolean =>
      isFilteredTierSelected(mod, idx, affinity);

    const resolveModTierNumber = (_tier: ModTier, idx: number, mod: ModGroup): number =>
      getFilteredTierNumber(mod, idx);

    const handleToggleTierSelection = (
      mod: ModGroup,
      tier: ModTier,
      idx: number,
      affinity: string,
    ) => {
      toggleTierSelection(mod, tier, resolveCanonicalTierIndex(mod, idx), affinity);
    };

    const getFilteredTierNumber = (mod: ModGroup, idx: number): number => {
      const fullMod = fullModById.value.get(mod.id);
      const total = fullMod?.tiers?.length ?? mod.tiers.length;
      const canonicalIdx = resolveCanonicalTierIndex(mod, idx);
      return Math.max(1, total - canonicalIdx);
    };

    const affinityProfile = getAffinityProfile(version);
    const categoryNames = affinityProfile.categoryNames;
    const categoryPriorities = affinityProfile.categoryPriorities;

    const getCategoryPriority = (key: string) => {
      return categoryPriorities[key] ?? 999;
    };

    const getCategoryLabel = (key: string) => {
      return categoryNames[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
    };

    const {
      searchQuery,
      clearSearchQuery,
      itemLevelMin,
      itemLevelMax,
      itemLevelRange,
      hasItemLevelFilter,
      isInvalidItemLevelRange,
      clearItemLevelFilter,
      generationFilter,
      groupedAffixes,
      isEmpty,
      filteredModTotalCount,
      canSelectAllFiltered,
      expandedCategories,
      toggleCategory,
      hasAnyExpandedCategory,
      toggleAllCategories,
    } = useAffixFilter({
      rawModsData,
      currentTypeGroups,
      getCategoryLabel,
      getCategoryPriority,
    });

    // 詞綴多的類別一次掛載上千個 ModItem 會卡住切換，改為分批渲染
    const { renderedCategories, revealMod } = useProgressiveAffixRender({
      categories: groupedAffixes,
      expandedCategories,
    });

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
      revealMod,
    });

    // 初次載入大類時預設將第一個大類設為目前導覽焦點
    watch(
      groupedAffixes,
      (newGroups) => {
        if (newGroups.length > 0 && !currentActiveCategory.value) {
          currentActiveCategory.value = newGroups[0].label;
        }
      },
      { immediate: true },
    );

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
      const query = debouncedTypeSearchQuery.value.trim().toLowerCase();

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

        // 2. 若使用者勾選「同時套用到官方道具過濾」，一併同步官方類別下拉選單
        if (syncOfficialOnTypeSelect.value) {
          const resolved = resolveOfficialCategoryOption(version, type);
          if (resolved) {
            dispatchPoeEvent('poexd-set-official-category', { option: resolved.option });
            officialCategory.value = resolved.mainCategory;
            showToast(
              t('filterPane.header.syncCategoryToast', {
                category: getTypeName(resolved.mainCategory),
              }),
            );
          }
        }

        // 3. 依 stable Tier slot identity 重新計算該 slot domain snapshot 並開啟原生 Trigger
        if (slotKey) {
          await refreshAndReopenTierSlot(slotKey);
        }
      } else {
        recordRecentType(type);
        selectedType.value = type;
      }
    };

    const recentTypeOptions = computed(() => {
      const availableSet = new Set(availableTypes.value);
      return recentTypes.value
        .filter((key) => availableSet.has(key))
        .map((key) => ({
          key,
          label: getTypeName(key),
          fullLabel: typeNames[key] || getTypeName(key),
        }));
    });

    const selectedCountByAffinity = computed<Record<string, number>>(() => {
      const counts: Record<string, number> = {};
      selectedModsMap.value.forEach((info) => {
        const aff = info.affinities?.[0] || 'normal';
        counts[aff] = (counts[aff] || 0) + 1;
      });
      return counts;
    });

    const resolveNavTier = (affinity: string): number => {
      if (affinity === 'normal' || affinity === 'cluster') return 0;
      if (
        [
          'searing',
          'eater',
          'shaper',
          'elder',
          'crusader',
          'redeemer',
          'hunter',
          'warlord',
        ].includes(affinity)
      ) {
        return 1;
      }
      if (['corrupted', 'enchant', 'heist'].includes(affinity)) return 3;
      return 2;
    };

    const shouldShowNavDivider = (index: number): boolean => {
      if (index <= 0) return false;
      const prev = groupedAffixes.value[index - 1];
      const curr = groupedAffixes.value[index];
      if (!prev || !curr) return false;
      return resolveNavTier(prev.affinity) !== resolveNavTier(curr.affinity);
    };

    const resolveModGroupKey = (
      source?: Pick<StatFilterModPayload, 'displayTemplate' | 'displayKey' | 'key'> | null,
    ): string | undefined => {
      if (!source) return undefined;
      return source.displayTemplate || source.displayKey || source.key || undefined;
    };

    const collectTargetStatIds = (mod: StatFilterModPayload): string[] => {
      const statIds: string[] = [];
      if (Array.isArray(mod.ids)) {
        mod.ids.forEach((id) => {
          if (id) statIds.push(id);
        });
      }
      if (mod.officialId) statIds.push(mod.officialId);
      if (mod.id && isTradeStatId(mod.id)) statIds.push(mod.id);
      return statIds;
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
      const affinities = mod.tiers?.[0]?.affinities?.length
        ? mod.tiers[0].affinities
        : mod.affinities || ['normal'];
      const baseModGroup = mod.modGroup || resolveModGroupKey(mod.tiers?.[0] || mod);
      const modGroup = resolveScopedModGroupId({
        baseModGroup,
        affinities,
        statIds: collectTargetStatIds(mod),
        typeGroups: currentTypeGroups.value,
      });

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

      const tierAffinities = tier.affinities?.length ? tier.affinities : [currentAffinity];
      const hasOfficialId = Boolean(tierOfficialId);
      if (!hasOfficialId) {
        addStatFilter(
          { ...tier, officialId: tierOfficialId, affinities: tierAffinities },
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
          affinities: tierAffinities,
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

    let lastDetectedType: string | null | undefined = undefined;
    let pendingDetectedType: string | null | undefined = undefined;
    // T 階按鈕開啟「選擇物品類別」時，是否同時將選取結果套用到官方道具類別過濾（工作階段內保留勾選狀態）
    const syncOfficialOnTypeSelect = ref(false);

    const officialCategory = ref<string | null>(null);

    const syncableOfficialCategory = computed(() => {
      const resolved = resolveOfficialCategoryOption(version, selectedType.value);
      if (!resolved) return null;
      if (officialCategory.value === resolved.mainCategory) return null;
      return {
        option: resolved.option,
        mainCategory: resolved.mainCategory,
        label: getTypeName(resolved.mainCategory),
      };
    });

    const syncOfficialCategory = () => {
      const target = syncableOfficialCategory.value;
      if (!target) return;
      dispatchPoeEvent('poexd-set-official-category', { option: target.option });
      officialCategory.value = target.mainCategory;
      showToast(t('filterPane.header.syncCategoryToast', { category: target.label }));
    };

    const applyEquipmentType = (detectedType: string | null) => {
      if (affixDemoMode.value) return;
      if (availableTypes.value.length === 0) {
        pendingDetectedType = detectedType;
        return;
      }
      pendingDetectedType = undefined;
      if (detectedType && availableTypes.value.includes(detectedType)) {
        if (detectedType !== lastDetectedType) {
          selectedType.value = detectedType;
          lastDetectedType = detectedType;
          searchQuery.value = ''; // 僅當裝備大類變更時清空搜尋
        }
      } else if (!detectedType) {
        if (lastDetectedType !== null) {
          selectedType.value = 'body-armour';
          lastDetectedType = null;
          searchQuery.value = '';
        }
      }
    };

    const handleEquipmentTypeChange = (detail: { type: string | null }) => {
      officialCategory.value = detail.type ?? null;
      applyEquipmentType(detail.type);
    };

    // flush: 'sync' 讓 rawModsData 載入當下先套用官方類別，再計算 groupedAffixes（避免先白算一次胸甲）
    watch(
      availableTypes,
      (types) => {
        if (types.length > 0 && pendingDetectedType !== undefined) {
          applyEquipmentType(pendingDetectedType);
        }
      },
      { flush: 'sync' },
    );

    const handleTriggerSelectTypeModal = () => {
      forceCenteredTypeDialog.value = true;
      typeSearchQuery.value = '';
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
      (isOpen, wasOpen) => {
        if (isOpen && !wasOpen && !affixDemoMode.value) {
          dispatchPoeEvent('poexd-request-official-category');
        }
      },
    );

    watch(
      [() => props.isOpen, loading],
      ([isOpen, isLoading], prev) => {
        if (isOpen && !isLoading) {
          const wasOpenAndLoaded = prev ? prev[0] && !prev[1] : false;
          if (!wasOpenAndLoaded && !affixDemoMode.value) {
            setTimeout(() => {
              const input = getSearchInputElement();
              input?.focus();
              input?.select();
            }, 60);
          }
        }
      },
      { immediate: true },
    );

    // 切換物品類別後，清空已選擇詞綴，並預設展開所有詞綴大類手風琴
    // flush: 'sync' 確保在 groupedAffixes 的 pre-watch 執行前先清空 expandedCategories，讓新類別能自動展開
    watch(
      selectedType,
      () => {
        if (!affixDemoMode.value) {
          selectedModsMap.value = new Map();
        }
        expandedCategories.value.clear();
      },
      { flush: 'sync' },
    );

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

    expose({
      isLoading: () => loading.value,
      getSnapshot: () => ({
        selectedType: selectedType.value,
        searchQuery: searchQuery.value,
      }),
      restoreSnapshot: (snapshot: { selectedType: string; searchQuery: string }) => {
        isSelectDropdownOpen.value = false;
        selectedType.value = snapshot.selectedType;
        searchQuery.value = snapshot.searchQuery;
      },
      selectTypeForDemo: (type: string) => {
        isSelectDropdownOpen.value = false;
        selectedType.value = type;
      },
      setSearchQueryForDemo: (query: string) => {
        searchQuery.value = query;
      },
      findDemoLifeMod: () => {
        const isPureLife = (m: ModGroup) =>
          (m.officialId === 'explicit.stat_3299347043' ||
            m.ids?.includes('explicit.stat_3299347043')) &&
          !m.key.includes('|||||');
        const found =
          currentTypeGroups.value.find(
            (m) => isPureLife(m) && (m.affinities?.includes('normal') ?? true),
          ) ??
          currentTypeGroups.value.find(isPureLife) ??
          currentTypeGroups.value.find(
            (m) =>
              m.officialId === 'explicit.stat_3299347043' ||
              m.ids?.includes('explicit.stat_3299347043'),
          );
        if (!found) return null;
        return {
          id: found.id,
          label: found.displayTemplate || found.displayKey || found.key,
        };
      },
    });

    const preventIfAffixDemo = (event: Event) => {
      if (affixDemoMode.value) event.preventDefault();
    };

    return {
      t,
      affixDemoMode,
      preventIfAffixDemo,
      loading,
      selectedType,
      currentTypeGroups,
      searchQuery,
      searchInputRef,
      itemLevelMin,
      itemLevelMax,
      itemLevelRange,
      hasItemLevelFilter,
      isInvalidItemLevelRange,
      clearItemLevelFilter,
      isModTierSelected,
      resolveModTierNumber,
      handleToggleTierSelection,
      generationFilter,
      availableTypes,
      groupedAffixes,
      renderedCategories,
      expandedCategories,
      toggleCategory,
      hasAnyExpandedCategory,
      toggleAllCategories,
      clearSearchQuery,
      isEmpty,
      isSelectDropdownOpen,
      isTypePopoverOpen,
      isTypeDialogOpen,
      handleTypePopoverOpenChange,
      setSelectDialogOpen,
      typeSearchQuery,
      typePopoverPanelRef,
      typeDialogPanelRef,
      recentTypeOptions,
      selectedCountByAffinity,
      filteredModTotalCount,
      canSelectAllFiltered,
      shouldShowNavDivider,
      closeSelectDropdown,
      groupedAvailableTypes,
      dialogActiveCategory,
      toggleSelectDropdown,
      selectTypeOption,
      poexdSelectingTarget,
      syncOfficialOnTypeSelect,
      syncableOfficialCategory,
      syncOfficialCategory,
      getTypeName,
      addStatFilter,
      addTierFilter,
      expandedKeys,
      toggleExpand,
      selectedModsMap,
      toggleMaxLimit,
      navAnchorsRef,
      scrollContainerRef,
      isModSelected,
      toggleModSelection,
      selectAllCurrent,
      clearAllSelection,
      applyT1ToSelected: handleApplyT1ToSelected,
      scrollToCategory,
      confirmBatchSelection,
      groupedSelectedMods,
      scrollToMod,
      currentActiveCategory,
      removeSingleSelection,
      handleScroll,
    };
  },
});
</script>
