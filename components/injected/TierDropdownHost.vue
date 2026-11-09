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
  getTierParts,
  getTierValues,
  type TierSlotDescriptor,
  type TierDropdownItemSpec,
} from '@/utils/tier-slot-registry';

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
  const vals = getTierValues(item);

  if (tuning.selectedTierIds.length === 0) {
    tuning.selectedTierIds = [item.id];
    tuning.min = vals.min;
    tuning.max = vals.max;
    slot.onSelect(item, 'both');
  } else if (tuning.selectedTierIds.length === 1) {
    if (tuning.selectedTierIds[0] === item.id) {
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
      tuning.selectedTierIds = [tuning.selectedTierIds[0], item.id];
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
        align="start"
        :side-offset="4"
        :collision-padding="8"
        :hide-when-detached="true"
        class="overflow-hidden flex flex-col gap-[var(--pxd-space-xs)] max-h-[min(var(--pxd-tier-menu-max-height,420px),var(--reka-dropdown-menu-content-available-height,calc(100vh-32px)))]"
        :style="{ '--pxd-menu-max-height': '420px' }"
      >
        <!-- 1. 頂部固定控制區：類別與分組隨時可選，不隨下方滾動捲出 -->
        <div class="flex flex-col shrink-0 gap-[var(--pxd-space-xs)]">
          <template v-for="item in slot.items" :key="item.id">
            <!-- 分類切換按鈕 (有目前類別時) -->
            <DropdownMenuItem
              v-if="item.type === 'switch_category'"
              size="sm"
              class="shrink-0 justify-center text-primary font-medium cursor-pointer focus:text-primary focus:bg-accent border-b border-border/40"
              @select="slot.onSelect(item)"
            >
              {{ item.label }}
            </DropdownMenuItem>

            <!-- 分類選擇導引 (無特定類別時) -->
            <DropdownMenuItem
              v-else-if="item.type === 'trigger_modal'"
              size="sm"
              class="shrink-0 justify-center text-primary font-medium cursor-pointer focus:text-primary focus:bg-accent"
              @select="slot.onSelect(item)"
            >
              {{ item.label }}
            </DropdownMenuItem>

            <!-- 詞綴分組切換按鈕 (頂部顯示目前詞綴，點選切換分組，具備獨立自適應高度) -->
            <DropdownMenuItem
              v-else-if="item.type === 'switch_mod_group'"
              size="sm"
              class="shrink-0 h-auto cursor-pointer text-left focus:bg-accent py-[var(--pxd-space-xs)] border-b border-border/50 bg-muted/20"
              @select.prevent="slot.onSelect(item)"
            >
              <div class="flex flex-col gap-[var(--pxd-space-xs)] w-full min-w-0">
                <div
                  class="flex items-center justify-between text-[length:var(--pxd-font-micro)] text-muted-foreground"
                >
                  <span class="font-medium">{{ t('tierDropdown.switchModGroup') }}</span>
                  <span class="text-primary font-medium">{{
                    t('tierDropdown.clickToSwitch')
                  }}</span>
                </div>
                <div
                  class="whitespace-pre-line text-[length:var(--pxd-font-body)] font-medium text-foreground leading-snug"
                >
                  {{ item.label }}
                </div>
              </div>
            </DropdownMenuItem>

            <!-- 返回階級清單 -->
            <DropdownMenuItem
              v-else-if="item.type === 'back_to_tiers'"
              size="sm"
              class="shrink-0 justify-center text-primary font-medium cursor-pointer focus:text-primary focus:bg-accent border-b border-border/50"
              @select.prevent="slot.onSelect(item)"
            >
              {{ item.label }}
            </DropdownMenuItem>
          </template>

          <!-- 頂部自訂微調列 (當前有 Tier 階級時顯示) -->
          <div
            v-if="hasTierItems(slot)"
            data-slot="tier-tuning-bar"
            class="flex items-center justify-between gap-[var(--pxd-space-xs)] px-[var(--pxd-space-xs)] py-[var(--pxd-space-xs)] bg-muted/40 border-b border-border/50 text-[length:var(--pxd-font-micro)] select-none shrink-0"
            @click.stop
          >
            <span class="text-muted-foreground shrink-0 font-medium">{{
              t('tierDropdown.tuning')
            }}</span>
            <div class="flex items-center gap-[var(--pxd-space-xs)]">
              <input
                v-model="getTuning(slot).min"
                type="text"
                :placeholder="t('tierDropdown.minPlaceholder')"
                class="w-[52px] h-[22px] px-[var(--pxd-space-xs)] text-center font-mono text-[length:var(--pxd-font-small)] bg-background text-foreground border border-border rounded focus-visible:ring-1 focus-visible:ring-primary focus-visible:outline-hidden"
                @keydown.stop
                @keyup.enter="applyTuning(slot)"
              />
              <span class="text-muted-foreground">~</span>
              <input
                v-model="getTuning(slot).max"
                type="text"
                :placeholder="t('tierDropdown.maxPlaceholder')"
                class="w-[52px] h-[22px] px-[var(--pxd-space-xs)] text-center font-mono text-[length:var(--pxd-font-small)] bg-background text-foreground border border-border rounded focus-visible:ring-1 focus-visible:ring-primary focus-visible:outline-hidden"
                @keydown.stop
                @keyup.enter="applyTuning(slot)"
              />
            </div>
            <!-- 套用按鈕 (原生按鈕，點擊套用並關閉選單) -->
            <button
              type="button"
              data-slot="tuning-apply-btn"
              class="h-[22px] px-[var(--pxd-space-xs)] text-[length:var(--pxd-font-micro)] bg-primary text-primary-foreground font-medium rounded hover:bg-primary/90 focus-visible:ring-1 focus-visible:ring-primary focus-visible:outline-hidden cursor-pointer shrink-0 transition-colors"
              :title="t('tierDropdown.applyTitle')"
              @click="applyTuning(slot)"
            >
              {{ t('tierDropdown.apply') }}
            </button>
          </div>
        </div>

        <!-- 2. 下方資料滾動區：滾動範圍僅在 T 階清單或分組選項內 -->
        <div
          class="flex-1 min-h-0 overflow-y-auto pxd-scrollbar flex flex-col gap-[var(--pxd-space-xs)]"
        >
          <template v-for="item in slot.items" :key="item.id">
            <!-- 一般靜態狀態列 (例如無可用類別提示，繼承一般 menu item 尺寸) -->
            <DropdownMenuItem
              v-if="item.type === 'header'"
              size="sm"
              disabled
              class="shrink-0 justify-center cursor-default text-muted-foreground data-[disabled]:opacity-90 font-normal select-none"
            >
              {{ item.label }}
            </DropdownMenuItem>

            <!-- 詞綴分組清單選項 (完整顯示該分組的詞綴，每個詞綴換行，具備對應高度、分隔線與交錯背景色) -->
            <DropdownMenuItem
              v-else-if="item.type === 'mod_group_option'"
              size="sm"
              class="shrink-0 h-auto cursor-pointer text-left focus:bg-accent py-[var(--pxd-space-xs)] border-b border-border/40 last:border-b-0"
              :class="[
                item.isActive
                  ? 'bg-primary/15 font-semibold text-primary'
                  : (item.groupIndex ?? 0) % 2 === 1
                    ? 'bg-muted/30 text-foreground'
                    : 'bg-transparent text-foreground',
              ]"
              @select.prevent="slot.onSelect(item)"
            >
              <div
                class="flex items-start justify-between w-full min-w-0 gap-[var(--pxd-space-sm)]"
              >
                <span
                  class="whitespace-pre-line text-[length:var(--pxd-font-body)] leading-snug select-none"
                  >{{ item.label }}</span
                >
                <span
                  v-if="item.isActive"
                  class="text-primary text-[length:var(--pxd-font-small)] shrink-0 font-bold mt-0.5"
                  >✓</span
                >
              </div>
            </DropdownMenuItem>

            <!-- Tier 資料項目 (統一為 [階級標籤] + [最小] [~] [最大] 三段式按鈕組) -->
            <div
              v-else-if="item.type === 'tier'"
              data-slot="tier-row"
              class="shrink-0 flex items-center justify-between gap-[var(--pxd-space-xs)] px-1 py-0.5 rounded transition-colors group cursor-pointer"
              :class="[
                isTierSelected(slot, item)
                  ? 'bg-primary/15 ring-1 ring-primary/40'
                  : 'hover:bg-accent/50',
              ]"
              @click="toggleTierSelection(slot, item)"
            >
              <!-- 1. 階級與等級 (左側區域為點擊熱區，點選切換範圍選取並即時連動套用) -->
              <div class="flex-1 min-w-0 flex items-center">
                <div
                  v-if="getTierParts(item).tag"
                  data-tier-action="tune"
                  class="text-[length:var(--pxd-font-small)] font-mono font-medium transition-colors select-none px-[var(--pxd-space-xs)] py-0.5 rounded text-left"
                  :class="[
                    getTierParts(item).tag.includes('Lv') ? 'min-w-[76px]' : 'min-w-[32px]',
                    isTierSelected(slot, item)
                      ? 'text-primary font-bold'
                      : 'text-muted-foreground group-hover:text-foreground',
                  ]"
                  :title="
                    getTierValues(item).min || getTierValues(item).max
                      ? t('tierDropdown.rangeSelectTitle', {
                          min: getTierValues(item).min,
                          max: getTierValues(item).max,
                        })
                      : t('tierDropdown.tierSelectTitle')
                  "
                >
                  {{ getTierParts(item).tag }}
                </div>
                <div
                  v-else
                  data-tier-action="tune"
                  class="text-[length:var(--pxd-font-small)] font-mono font-medium text-foreground select-none px-[var(--pxd-space-xs)] py-0.5"
                >
                  {{ item.label }}
                </div>
              </div>

              <!-- 2. 三段式數值按鈕組: [ 最小 ] [ ~ ] [ 最大 ] (原生按鈕，阻止冒泡以獨立快捷套用) -->
              <div
                v-if="getTierValues(item).min || getTierValues(item).max"
                class="inline-flex items-center ml-auto shrink-0 select-none font-mono text-[length:var(--pxd-font-small)]"
                @click.stop
              >
                <div
                  class="inline-flex items-center rounded border border-border/70 bg-muted/20 overflow-hidden divide-x divide-border/50 shadow-xs"
                >
                  <!-- 左側小值按鈕 (填入最小值) -->
                  <button
                    type="button"
                    data-tier-action="min"
                    class="h-[24px] min-w-[46px] px-1 py-0 cursor-pointer justify-center text-center font-mono hover:bg-accent hover:text-accent-foreground text-foreground select-none transition-colors"
                    :title="t('tierDropdown.fillMinTitle', { min: getTierValues(item).min })"
                    @click="selectTier(slot, item, 'min')"
                  >
                    {{ getTierValues(item).min }}
                  </button>

                  <!-- 中間波浪號按鈕 (填入最大與最小) -->
                  <button
                    type="button"
                    data-tier-action="both"
                    class="h-[24px] w-[32px] px-1 py-0 cursor-pointer justify-center text-center font-mono font-bold text-primary hover:bg-primary hover:text-primary-foreground select-none transition-colors"
                    :title="
                      t('tierDropdown.fillBothTitle', {
                        min: getTierValues(item).min,
                        max: getTierValues(item).max,
                      })
                    "
                    @click="selectTier(slot, item, 'both')"
                  >
                    ~
                  </button>

                  <!-- 右側大值按鈕 (填入最大值) -->
                  <button
                    type="button"
                    data-tier-action="max"
                    class="h-[24px] min-w-[46px] px-1 py-0 cursor-pointer justify-center text-center font-mono hover:bg-accent hover:text-accent-foreground text-foreground select-none transition-colors"
                    :title="t('tierDropdown.fillMaxTitle', { max: getTierValues(item).max })"
                    @click="selectTier(slot, item, 'max')"
                  >
                    {{ getTierValues(item).max }}
                  </button>
                </div>
              </div>
            </div>
          </template>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  </template>
</template>
