<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import { usePageGuide } from '@/components/sidebar/page-guide/usePageGuide';
import type { PageGuideDemoState } from '@/utils/page-guide-demo-state';
import { t } from '@/utils/i18n';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import {
  activeTierSlots,
  getTierValues,
  type TierSlotDescriptor,
  type TierDropdownItemSpec,
} from '@/utils/tier-slot-registry';
import TierTuningBar from './TierTuningBar.vue';
import TierScrollItems from './TierScrollItems.vue';

const props = defineProps<{
  /** 測試可注入唯讀的 PageGuideDemoState；正式環境（獨立 Vue App）預設讀取 usePageGuide().demoState */
  demoState?: PageGuideDemoState;
}>();

const demoState = computed(() => props.demoState ?? usePageGuide().demoState);

interface SlotTuningState {
  min: string;
  max: string;
  appliedMin: string;
  appliedMax: string;
  selectedTierIds: string[];
}

const slotTuningMap = reactive<Record<string, SlotTuningState>>({});
const openStateMap = reactive<Record<string, boolean>>({});

// 初始導覽的階級示範：展開指定清單，示範結束時收起
watch(
  () => demoState.value.tierMenuSlotKey,
  (key, previousKey) => {
    if (previousKey) openStateMap[previousKey] = false;
    if (key) openStateMap[key] = true;
  },
  { immediate: true },
);

function isDemoTrigger(slotKey: string): boolean {
  return (
    demoState.value.tierTriggerSlotKey === slotKey || demoState.value.tierMenuSlotKey === slotKey
  );
}

function isDemoMenu(slotKey: string): boolean {
  return demoState.value.tierMenuSlotKey === slotKey;
}

function findMatchingTierIds(slot: TierSlotDescriptor, minVal: string, maxVal: string): string[] {
  const min = minVal.trim();
  const max = maxVal.trim();
  if (!min && !max) return [];

  const tierItems = slot.items.filter((i) => i.type === 'tier');
  if (tierItems.length === 0) return [];

  // 1. 精確符合單一階級（min+max、或單邊 min/max）
  const exactSingle = tierItems.find((tier) => {
    const vals = getTierValues(tier);
    if (min && max) return vals.min === min && vals.max === max;
    if (min && !max) return vals.min === min;
    if (!min && max) return vals.max === max;
    return false;
  });
  if (exactSingle) return [exactSingle.id];

  // 2. 嘗試匹配連續階級區間（min 對應下限階級的 valMin、max 對應上限階級的 valMax）
  if (min && max) {
    const startTier = tierItems.find((tier) => getTierValues(tier).max === max);
    const endTier = tierItems.find((tier) => getTierValues(tier).min === min);
    if (startTier && endTier && startTier.id !== endTier.id) {
      return [startTier.id, endTier.id];
    }
  }

  return [];
}

function syncTuningFromHost(slot: TierSlotDescriptor) {
  if (!slot.getCurrentValues) return;
  const current = slot.getCurrentValues();
  const min = current.min?.trim() || '';
  const max = current.max?.trim() || '';
  const tuning = getTuning(slot);
  tuning.min = min;
  tuning.max = max;
  tuning.appliedMin = min;
  tuning.appliedMax = max;
  tuning.selectedTierIds = findMatchingTierIds(slot, min, max);
}

function handleOpenChange(slot: TierSlotDescriptor, open: boolean) {
  if (isDemoMenu(slot.key) || isDemoTrigger(slot.key)) return;
  if (open) {
    syncTuningFromHost(slot);
  }
  openStateMap[slot.key] = open;
}

function hasTierItems(slot: TierSlotDescriptor): boolean {
  return slot.items.some((i) => i.type === 'tier' && Boolean(i.valMin || i.valMax));
}

function hasModGroups(slot: TierSlotDescriptor): boolean {
  return slot.items.some((i) => i.type === 'mod_group_option');
}

function getModGroupItems(slot: TierSlotDescriptor): TierDropdownItemSpec[] {
  return slot.items.filter((i) => i.type === 'mod_group_option');
}

function getTuning(slot: TierSlotDescriptor): SlotTuningState {
  if (!slotTuningMap[slot.key]) {
    slotTuningMap[slot.key] = {
      min: '',
      max: '',
      appliedMin: '',
      appliedMax: '',
      selectedTierIds: [],
    };
  }
  return slotTuningMap[slot.key];
}

function isTuningDirty(slot: TierSlotDescriptor): boolean {
  const tuning = getTuning(slot);
  return (
    tuning.min.trim() !== tuning.appliedMin.trim() || tuning.max.trim() !== tuning.appliedMax.trim()
  );
}

function isSlotActive(slot: TierSlotDescriptor): boolean {
  const tuning = slotTuningMap[slot.key];
  if (!tuning) return false;
  return Boolean(
    tuning.appliedMin.trim() || tuning.appliedMax.trim() || tuning.selectedTierIds.length > 0,
  );
}

function selectTier(
  slot: TierSlotDescriptor,
  item: TierDropdownItemSpec,
  mode: 'min' | 'both' | 'max',
) {
  const { min, max } = getTierValues(item);
  const tuning = getTuning(slot);
  const appliedMin = mode === 'max' ? '' : min;
  const appliedMax = mode === 'min' ? '' : max;
  tuning.min = appliedMin;
  tuning.max = appliedMax;
  tuning.appliedMin = appliedMin;
  tuning.appliedMax = appliedMax;
  tuning.selectedTierIds = [item.id];
  openStateMap[slot.key] = false;
  slot.onSelect(item, mode);
}

function applyTuning(slot: TierSlotDescriptor) {
  const tuning = getTuning(slot);
  const minVal = tuning.min?.trim() || '';
  const maxVal = tuning.max?.trim() || '';
  let mode: 'min' | 'both' | 'max' = 'both';
  if (minVal && !maxVal) mode = 'min';
  else if (!minVal && maxVal) mode = 'max';

  tuning.appliedMin = minVal;
  tuning.appliedMax = maxVal;
  tuning.selectedTierIds = findMatchingTierIds(slot, minVal, maxVal);
  openStateMap[slot.key] = false;
  slot.onSelect(
    {
      id: 'custom-tuning',
      type: 'tier',
      label: 'custom',
      valMin: minVal,
      valMax: maxVal,
    },
    mode,
  );
}

function clearTuning(slot: TierSlotDescriptor) {
  const tuning = getTuning(slot);
  tuning.min = '';
  tuning.max = '';
  tuning.appliedMin = '';
  tuning.appliedMax = '';
  tuning.selectedTierIds = [];
  slot.onSelect(
    {
      id: 'custom-tuning',
      type: 'tier',
      label: 'custom',
      valMin: '',
      valMax: '',
    },
    'both',
  );
}

function getTierSelectionBounds(
  tierItems: TierDropdownItemSpec[],
  selectedIds: string[],
): { min: string; max: string } {
  if (selectedIds.length === 0) return { min: '', max: '' };
  if (selectedIds.length === 1) {
    const item = tierItems.find((i) => i.id === selectedIds[0]);
    return item ? getTierValues(item) : { min: '', max: '' };
  }
  const idx1 = tierItems.findIndex((i) => i.id === selectedIds[0]);
  const idx2 = tierItems.findIndex((i) => i.id === selectedIds[1]);
  if (idx1 === -1 || idx2 === -1) return { min: '', max: '' };

  const start = Math.min(idx1, idx2);
  const end = Math.max(idx1, idx2);
  const inRange = tierItems.slice(start, end + 1);

  const mins: number[] = [];
  const maxes: number[] = [];
  for (const tier of inRange) {
    const values = getTierValues(tier);
    const nMin = parseFloat(values.min);
    const nMax = parseFloat(values.max);
    if (!Number.isNaN(nMin)) mins.push(nMin);
    if (!Number.isNaN(nMax)) maxes.push(nMax);
  }

  const minStr = mins.length > 0 ? String(Math.min(...mins)) : '';
  const maxStr = maxes.length > 0 ? String(Math.max(...maxes)) : '';
  return { min: minStr, max: maxStr };
}

function isTierSelected(slot: TierSlotDescriptor, item: TierDropdownItemSpec): boolean {
  const tuning = getTuning(slot);
  const sel = tuning.selectedTierIds;
  if (!sel || sel.length === 0) return false;
  if (sel.length === 1) return sel[0] === item.id;
  const tierItems = slot.items.filter((i) => i.type === 'tier');
  const idx1 = tierItems.findIndex((i) => i.id === sel[0]);
  const idx2 = tierItems.findIndex((i) => i.id === sel[1]);
  if (idx1 === -1 || idx2 === -1) return false;
  const currentIdx = tierItems.findIndex((i) => i.id === item.id);
  if (currentIdx === -1) return false;
  const start = Math.min(idx1, idx2);
  const end = Math.max(idx1, idx2);
  return currentIdx >= start && currentIdx <= end;
}

function toggleTierSelection(slot: TierSlotDescriptor, item: TierDropdownItemSpec) {
  const tuning = getTuning(slot);
  const tierItems = slot.items.filter((i) => i.type === 'tier');
  const activeSelectedIds = tuning.selectedTierIds.filter((id) =>
    tierItems.some((tier) => tier.id === id),
  );
  const vals = getTierValues(item);

  if (activeSelectedIds.length === 0) {
    tuning.selectedTierIds = [item.id];
    tuning.min = vals.min;
    tuning.max = vals.max;
    tuning.appliedMin = vals.min;
    tuning.appliedMax = vals.max;
    slot.onSelect(item, 'both');
  } else if (activeSelectedIds.length === 1) {
    if (activeSelectedIds[0] === item.id) {
      tuning.selectedTierIds = [];
      tuning.min = '';
      tuning.max = '';
      tuning.appliedMin = '';
      tuning.appliedMax = '';
      slot.onSelect(
        {
          id: 'custom-tuning',
          type: 'tier',
          label: 'custom',
          valMin: '',
          valMax: '',
        },
        'both',
      );
    } else {
      tuning.selectedTierIds = [activeSelectedIds[0], item.id];
      const bounds = getTierSelectionBounds(tierItems, tuning.selectedTierIds);
      tuning.min = bounds.min;
      tuning.max = bounds.max;
      tuning.appliedMin = bounds.min;
      tuning.appliedMax = bounds.max;
      slot.onSelect(
        {
          id: 'range-tuning',
          type: 'tier',
          label: 'range',
          valMin: bounds.min,
          valMax: bounds.max,
        },
        'both',
      );
    }
  } else {
    tuning.selectedTierIds = [item.id];
    tuning.min = vals.min;
    tuning.max = vals.max;
    tuning.appliedMin = vals.min;
    tuning.appliedMax = vals.max;
    slot.onSelect(item, 'both');
  }
}

function preventIfDemoMenu(slotKey: string, event: Event) {
  if (isDemoMenu(slotKey)) event.preventDefault();
}
</script>

<template>
  <template v-for="slot in activeTierSlots" :key="slot.key">
    <DropdownMenu
      v-if="slot.targetEl && slot.targetEl.isConnected"
      :open="openStateMap[slot.key]"
      @update:open="(open) => handleOpenChange(slot, open)"
    >
      <Teleport :to="slot.targetEl">
        <DropdownMenuTrigger as-child>
          <button
            type="button"
            class="btn poexd-tier-trigger"
            :data-tier-slot-key="slot.key"
            :data-tier-active="isSlotActive(slot) ? 'true' : undefined"
            :title="t('tierDropdown.triggerTitle')"
            :aria-label="t('tierDropdown.triggerTitle')"
            :tabindex="isDemoTrigger(slot.key) ? -1 : undefined"
            :inert="isDemoTrigger(slot.key) || undefined"
            :style="isDemoTrigger(slot.key) ? { pointerEvents: 'none' } : undefined"
          >
            T
          </button>
        </DropdownMenuTrigger>
      </Teleport>

      <DropdownMenuContent
        side="bottom"
        align="end"
        :side-offset="4"
        :collision-padding="8"
        :hide-when-detached="true"
        :inert="isDemoMenu(slot.key) || undefined"
        :class="[
          'overflow-hidden flex flex-col gap-[var(--pxd-space-xs)] max-h-[min(var(--pxd-tier-menu-max-height,420px),var(--reka-dropdown-menu-content-available-height,calc(100vh-32px)))]',
          isDemoMenu(slot.key) ? 'pointer-events-none select-none' : '',
        ]"
        :style="{ '--pxd-tier-menu-max-height': '420px' }"
        @interact-outside="preventIfDemoMenu(slot.key, $event)"
        @pointer-down-outside="preventIfDemoMenu(slot.key, $event)"
        @focus-outside="preventIfDemoMenu(slot.key, $event)"
        @escape-key-down="preventIfDemoMenu(slot.key, $event)"
      >
        <!-- 1. 頂部固定控制區：類別切換橫跨上方；單欄時含微調列 -->
        <div class="flex flex-col shrink-0 gap-[var(--pxd-space-xs)]">
          <template v-for="item in slot.items" :key="item.id">
            <!-- 分類切換按鈕 (有目前類別時) -->
            <DropdownMenuItem
              v-if="item.type === 'switch_category'"
              size="sm"
              class="shrink-0 justify-between gap-[var(--pxd-space-xs)] text-primary font-medium cursor-pointer bg-muted/25 hover:bg-accent/50 focus:bg-transparent focus-visible:bg-accent/50 focus:text-primary border-b border-border/50 rounded-sm"
              @select="slot.onSelect(item)"
            >
              <template v-if="item.categoryLabel">
                <span class="font-semibold text-foreground truncate">{{ item.categoryLabel }}</span>
                <span
                  class="inline-flex items-center gap-[var(--pxd-space-xs)] px-[var(--pxd-space-xs)] py-0.5 rounded bg-primary/15 text-primary text-[length:var(--pxd-font-caption)] font-medium shrink-0"
                >
                  {{ t('tierDropdown.switchAction') }} ▾
                </span>
              </template>
              <span v-else class="w-full text-center">{{ item.label }}</span>
            </DropdownMenuItem>

            <!-- 分類選擇導引 (無特定類別時) -->
            <DropdownMenuItem
              v-else-if="item.type === 'trigger_modal'"
              size="sm"
              class="shrink-0 justify-center text-primary font-medium cursor-pointer hover:bg-accent/50 focus:bg-transparent focus-visible:bg-accent/50 focus:text-primary"
              @select="slot.onSelect(item)"
            >
              {{ item.label }}
            </DropdownMenuItem>
          </template>

          <TierTuningBar
            v-if="!hasModGroups(slot) && hasTierItems(slot)"
            :min="getTuning(slot).min"
            :max="getTuning(slot).max"
            :is-dirty="isTuningDirty(slot)"
            @update:min="getTuning(slot).min = $event"
            @update:max="getTuning(slot).max = $event"
            @apply="applyTuning(slot)"
            @clear="clearTuning(slot)"
          />
        </div>

        <!-- 2A. 多詞綴分組雙欄佈局：左側固定寬度可換行詞綴分組欄 + 右側微調與 T 階清單 -->
        <div
          v-if="hasModGroups(slot)"
          data-slot="tier-split-layout"
          class="flex-1 min-h-0 flex items-stretch gap-[var(--pxd-space-xs)]"
        >
          <div
            data-slot="mod-group-column"
            class="w-[var(--pxd-menu-sub-width,192px)] max-w-[45vw] shrink-0 min-h-0 flex flex-col gap-[var(--pxd-space-xs)] border-r border-border/50 pr-[var(--pxd-space-xs)]"
          >
            <div
              class="px-[var(--pxd-space-xs)] py-0.5 text-[length:var(--pxd-font-secondary)] font-medium text-muted-foreground shrink-0 select-none"
            >
              {{ t('tierDropdown.switchModGroup') }}
            </div>
            <div
              class="flex-1 min-h-0 overflow-y-auto pxd-scrollbar flex flex-col gap-[var(--pxd-space-xs)] pr-1"
            >
              <button
                v-for="item in getModGroupItems(slot)"
                :key="item.id"
                type="button"
                data-slot="mod-group-option"
                class="shrink-0 w-full text-left cursor-pointer rounded px-[var(--pxd-space-xs)] py-[var(--pxd-space-xs)] border-b border-border/40 last:border-b-0 border-l-2 transition-colors focus-visible:ring-1 focus-visible:ring-primary focus-visible:outline-hidden"
                :class="[
                  item.isActive
                    ? 'bg-primary/15 border-l-primary font-semibold text-primary'
                    : 'bg-transparent border-l-transparent text-foreground/85 hover:bg-accent/50 hover:text-foreground',
                ]"
                @click.stop="slot.onSelect(item)"
              >
                <span
                  class="flex items-start justify-between w-full min-w-0 gap-[var(--pxd-space-xs)]"
                >
                  <span class="flex flex-col min-w-0 gap-[var(--pxd-space-xs)] select-none">
                    <span
                      v-if="item.affinityLabel"
                      data-slot="mod-group-affinity"
                      class="text-[length:var(--pxd-font-caption)] font-medium leading-tight"
                      :class="item.isActive ? 'text-primary/90' : 'text-muted-foreground'"
                      >{{ item.affinityLabel }}</span
                    >
                    <span
                      class="whitespace-pre-line break-words text-[length:var(--pxd-font-body)] leading-snug"
                      >{{ item.label }}</span
                    >
                  </span>
                  <span
                    v-if="item.isActive"
                    class="text-primary text-[length:var(--pxd-font-caption)] shrink-0 font-bold mt-0.5"
                    >✓</span
                  >
                </span>
              </button>
            </div>
          </div>

          <div
            data-slot="tier-list-column"
            class="flex-1 min-w-0 min-h-0 flex flex-col gap-[var(--pxd-space-xs)]"
          >
            <TierTuningBar
              v-if="hasTierItems(slot)"
              :min="getTuning(slot).min"
              :max="getTuning(slot).max"
              :is-dirty="isTuningDirty(slot)"
              @update:min="getTuning(slot).min = $event"
              @update:max="getTuning(slot).max = $event"
              @apply="applyTuning(slot)"
              @clear="clearTuning(slot)"
            />
            <TierScrollItems
              :items="slot.items"
              :is-tier-selected="(item) => isTierSelected(slot, item)"
              @toggle-tier="(item) => toggleTierSelection(slot, item)"
              @select-tier="(item, mode) => selectTier(slot, item, mode)"
            />
          </div>
        </div>

        <!-- 2B. 單一分組單欄佈局：直接呈現下方資料滾動區 -->
        <TierScrollItems
          v-else
          :items="slot.items"
          :is-tier-selected="(item) => isTierSelected(slot, item)"
          @toggle-tier="(item) => toggleTierSelection(slot, item)"
          @select-tier="(item, mode) => selectTier(slot, item, mode)"
        />

        <!-- 3. 底部微提示列：讓跨階範圍選取與數值快捷填入一目瞭然 -->
        <div
          v-if="hasTierItems(slot)"
          data-slot="tier-interaction-hint"
          class="shrink-0 border-t border-border/40 pt-1 px-1 text-center text-[length:var(--pxd-font-micro)] text-muted-foreground/80 select-none"
        >
          {{ t('tierDropdown.interactionHint') }}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  </template>
</template>
