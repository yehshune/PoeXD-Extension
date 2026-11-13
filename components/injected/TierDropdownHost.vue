<script setup lang="ts">
import { reactive } from 'vue';
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

interface SlotTuningState {
  min: string;
  max: string;
  selectedTierIds: string[];
}

const slotTuningMap = reactive<Record<string, SlotTuningState>>({});
const openStateMap = reactive<Record<string, boolean>>({});

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
      selectedTierIds: [],
    };
  }
  return slotTuningMap[slot.key];
}

function selectTier(
  slot: TierSlotDescriptor,
  item: TierDropdownItemSpec,
  mode: 'min' | 'both' | 'max',
) {
  const { min, max } = getTierValues(item);
  const tuning = getTuning(slot);
  tuning.min = min;
  tuning.max = max;
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
    slot.onSelect(item, 'both');
  } else if (activeSelectedIds.length === 1) {
    if (activeSelectedIds[0] === item.id) {
      tuning.selectedTierIds = [];
      tuning.min = '';
      tuning.max = '';
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
    slot.onSelect(item, 'both');
  }
}
</script>

<template>
  <template v-for="slot in activeTierSlots" :key="slot.key">
    <DropdownMenu
      v-if="slot.targetEl && slot.targetEl.isConnected"
      v-model:open="openStateMap[slot.key]"
    >
      <Teleport :to="slot.targetEl">
        <DropdownMenuTrigger as-child>
          <button
            type="button"
            class="btn poexd-tier-trigger"
            :data-tier-slot-key="slot.key"
            :title="t('tierDropdown.triggerTitle')"
          >
            T
          </button>
        </DropdownMenuTrigger>
      </Teleport>

      <DropdownMenuContent
        side="bottom"
        :align="hasModGroups(slot) ? 'end' : 'start'"
        :side-offset="4"
        :collision-padding="8"
        :hide-when-detached="true"
        class="overflow-hidden flex flex-col gap-[var(--pxd-space-xs)] max-h-[min(var(--pxd-tier-menu-max-height,420px),var(--reka-dropdown-menu-content-available-height,calc(100vh-32px)))]"
        :style="{ '--pxd-menu-max-height': '420px' }"
      >
        <!-- 1. 頂部固定控制區：類別切換橫跨上方；單欄時含微調列 -->
        <div class="flex flex-col shrink-0 gap-[var(--pxd-space-xs)]">
          <template v-for="item in slot.items" :key="item.id">
            <!-- 分類切換按鈕 (有目前類別時) -->
            <DropdownMenuItem
              v-if="item.type === 'switch_category'"
              size="sm"
              class="shrink-0 justify-center text-primary font-medium cursor-pointer hover:bg-accent/50 focus:bg-transparent focus-visible:bg-accent/50 focus:text-primary border-b border-border/40"
              @select="slot.onSelect(item)"
            >
              {{ item.label }}
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
            @update:min="getTuning(slot).min = $event"
            @update:max="getTuning(slot).max = $event"
            @apply="applyTuning(slot)"
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
              class="px-[var(--pxd-space-xs)] py-0.5 text-[length:var(--pxd-font-micro)] font-medium text-muted-foreground shrink-0 select-none"
            >
              {{ t('tierDropdown.switchModGroup') }}
            </div>
            <div
              class="flex-1 min-h-0 overflow-y-auto pxd-scrollbar flex flex-col gap-[var(--pxd-space-xs)]"
            >
              <button
                v-for="item in getModGroupItems(slot)"
                :key="item.id"
                type="button"
                data-slot="mod-group-option"
                class="shrink-0 w-full text-left cursor-pointer rounded px-[var(--pxd-space-xs)] py-[var(--pxd-space-xs)] border-b border-border/40 last:border-b-0 transition-colors focus-visible:ring-1 focus-visible:ring-primary focus-visible:outline-hidden"
                :class="[
                  item.isActive
                    ? 'bg-primary/15 font-semibold text-primary'
                    : (item.groupIndex ?? 0) % 2 === 1
                      ? 'bg-muted/30 text-foreground hover:bg-accent/50'
                      : 'bg-transparent text-foreground hover:bg-accent/50',
                ]"
                @click.stop="slot.onSelect(item)"
              >
                <span
                  class="flex items-start justify-between w-full min-w-0 gap-[var(--pxd-space-xs)]"
                >
                  <span
                    class="whitespace-pre-line break-words text-[length:var(--pxd-font-body)] leading-snug select-none"
                    >{{ item.label }}</span
                  >
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
              @update:min="getTuning(slot).min = $event"
              @update:max="getTuning(slot).max = $event"
              @apply="applyTuning(slot)"
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
      </DropdownMenuContent>
    </DropdownMenu>
  </template>
</template>
