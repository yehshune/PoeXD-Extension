<script setup lang="ts">
/**
 * 購物清單的「裝備欄」檢視：依遊戲裝備視窗的位置排出 PoB 的裝備，下方是藥劑、護符、珠寶、
 * 柳條人與移植物。格子以稀有度上色；滑鼠移入開啟與清單相同的預覽，點擊直接搜尋；
 * 勾選完成用格子角落的按鈕。
 */
import { computed, ref } from 'vue';
import { Checkbox } from '@/components/ui/checkbox';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { t, type I18nKey } from '@/utils/i18n';
import PobItemImage from './PobItemImage.vue';
import PobSocketOverlay from './PobSocketOverlay.vue';
import { formatPobSlot } from './pob-slot-label';
import {
  GEAR_CELLS,
  fitItemInTile,
  gearLayout,
  type GearCell,
  type GearCellId,
} from './pob-gear-layout';
import type { ShoppingRow, SocketContent } from './pob-build-view';

const props = defineProps<{
  rows: readonly ShoppingRow[];
  activeKey?: string;
  /** 按住 Alt 時顯示所有裝備的插槽、技能寶石與鑲嵌物 */
  revealSockets?: boolean;
}>();

const emit = defineEmits<{
  select: [row: ShoppingRow, event: Event];
  /** 滑鼠移入／移出有物品的格子（開關預覽） */
  hover: [row: ShoppingRow, event: MouseEvent];
  leave: [];
  toggleDone: [key: string];
  /** 點插槽裡的寶石（開該寶石的設定框） */
  selectContent: [content: SocketContent, event: Event];
  /** 切換主副武器組（通知外層關閉已開啟的預覽，避免錨點脫離 DOM） */
  weaponSetChange: [];
}>();

const showSwap = ref(false);

const layout = computed(() => gearLayout(props.rows));

/** 主裝備欄的每一格（空格也要畫出來，看得出缺哪個部位；第三戒指只有裝了才畫） */
const isWeapon = (id: GearCellId): id is 'weapon1' | 'weapon2' =>
  id === 'weapon1' || id === 'weapon2';

const cells = computed(() =>
  (Object.keys(GEAR_CELLS) as GearCellId[])
    .map((id) => ({
      id,
      cell: GEAR_CELLS[id],
      row: showSwap.value && isWeapon(id) ? layout.value.swap[id] : layout.value.equipped[id],
    }))
    .filter(({ id, row }) => id !== 'ring3' || row),
);

const CELL_LABELS: Readonly<Record<GearCellId, I18nKey>> = {
  weapon1: 'pobBuild.slot.mainHand',
  weapon2: 'pobBuild.slot.offHand',
  helmet: 'pobBuild.slot.helmet',
  bodyArmour: 'pobBuild.slot.bodyArmour',
  gloves: 'pobBuild.slot.gloves',
  boots: 'pobBuild.slot.boots',
  amulet: 'pobBuild.slot.amulet',
  ring1: 'pobBuild.slot.ring',
  ring2: 'pobBuild.slot.ring',
  ring3: 'pobBuild.slot.ring',
  belt: 'pobBuild.slot.belt',
};
const RING_NUMBERS: Partial<Record<GearCellId, number>> = { ring1: 1, ring2: 2, ring3: 3 };

const cellLabel = (id: GearCellId) => t(CELL_LABELS[id], { n: RING_NUMBERS[id] ?? '' });

/** 下方各列：沒有項目的列不顯示 */
const sections = computed(() => {
  const { charms, wickerman, grafts, jewels, others } = layout.value;
  const list: { id: string; label: I18nKey; rows: readonly ShoppingRow[] }[] = [
    { id: 'charm', label: 'pobBuild.gear.charms', rows: charms },
    { id: 'cluster', label: 'pobBuild.gear.clusterJewels', rows: jewels.cluster },
    { id: 'jewel', label: 'pobBuild.gear.jewels', rows: jewels.regular },
    { id: 'abyssal', label: 'pobBuild.gear.abyssalJewels', rows: jewels.abyssal },
    { id: 'wickerman', label: 'pobBuild.gear.wickerman', rows: wickerman },
    { id: 'graft', label: 'pobBuild.gear.grafts', rows: grafts },
    { id: 'other', label: 'pobBuild.gear.others', rows: others },
  ];
  return list.filter((section) => section.rows.length > 0);
});

const hasFlasks = computed(() => layout.value.flasks.some(Boolean));

const RARITY_TILE: Readonly<Record<string, string>> = {
  UNIQUE: 'pxd-gear-tile--unique',
  RELIC: 'pxd-gear-tile--unique',
  RARE: 'pxd-gear-tile--rare',
  MAGIC: 'pxd-gear-tile--magic',
};
const tileClass = (row: ShoppingRow) => RARITY_TILE[row.rarity ?? 'NORMAL'] ?? '';

const tileTitle = (row: ShoppingRow) =>
  [
    row.label,
    formatPobSlot(row.slot ?? ''),
    row.foulborn ? t('pobBuild.foulborn') : '',
    row.corrupted ? t('pobBuild.corrupted') : '',
  ]
    .filter(Boolean)
    .join(' · ');

const onWeaponSetChange = (value: unknown) => {
  if (value !== '1' && value !== '2') return;
  const next = value === '2';
  if (next === showSwap.value) return;
  showSwap.value = next;
  emit('weaponSetChange');
};

/**
 * 物品圖片依「物品背包格數 ÷ 裝備格數」限制上限，避免高解析度原圖（例如 PoE2 的 1×3 法杖）
 * 在較大的 2×4 武器欄裡等比放大撐滿整格。
 */
const tileIconStyle = (row: ShoppingRow, cell: GearCell) => {
  if (!row.iconSize) return undefined;
  const fitted = fitItemInTile(row.iconSize.width, row.iconSize.height, cell.width, cell.height);
  return {
    maxWidth: `${fitted.width * 100}%`,
    maxHeight: `${fitted.height * 100}%`,
  };
};
</script>

<template>
  <div
    data-pob-build-gear
    :data-reveal-sockets="revealSockets ? 'true' : undefined"
    class="relative flex flex-col gap-[var(--pxd-space-sm)] bg-card p-[var(--pxd-space-md)]"
  >
    <div class="pxd-gear-body">
      <div v-if="layout.hasSwap" class="grid grid-cols-8 gap-[var(--pxd-space-xs)]">
        <div
          v-for="side in ['left', 'right'] as const"
          :key="side"
          class="flex justify-center"
          :class="side === 'left' ? 'col-span-2' : 'col-start-7 col-span-2'"
        >
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            :model-value="showSwap ? '2' : '1'"
            :aria-label="t('pobBuild.gear.weaponSet')"
            class="inline-grid grid-cols-2"
            @update:model-value="onWeaponSetChange"
          >
            <ToggleGroupItem
              value="1"
              data-pob-build-gear-swap
              class="px-[var(--button-padding-x-sm)] font-bold"
            >
              I
            </ToggleGroupItem>
            <ToggleGroupItem
              value="2"
              data-pob-build-gear-swap
              class="px-[var(--button-padding-x-sm)] font-bold"
            >
              II
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      <div data-pob-build-gear-grid class="pxd-gear-grid">
        <template v-for="{ id, cell, row } in cells" :key="id">
          <div
            :role="row ? 'button' : undefined"
            :tabindex="row ? 0 : undefined"
            :data-pob-build-gear-tile="row ? id : undefined"
            :data-pob-build-gear-empty="row ? undefined : id"
            :data-done="row?.done ? 'true' : undefined"
            :aria-pressed="row ? activeKey === row.key : undefined"
            :title="row ? tileTitle(row) : cellLabel(id)"
            class="pxd-gear-tile"
            :class="[
              row ? tileClass(row) : 'pxd-gear-tile--empty',
              {
                'is-active': row && activeKey === row.key,
                'pxd-gear-tile--corrupted': row?.corrupted,
              },
            ]"
            :style="{
              gridColumn: `${cell.column} / span ${cell.width}`,
              gridRow: `${cell.row} / span ${cell.height}`,
            }"
            @click="row && emit('select', row, $event)"
            @keydown.enter.self.prevent="row && emit('select', row, $event)"
            @keydown.space.self.prevent="row && emit('select', row, $event)"
            @mouseenter="row && emit('hover', row, $event)"
            @mouseleave="row && emit('leave')"
          >
            <template v-if="row">
              <PobItemImage
                v-if="row.icon"
                class="pxd-gear-tile__icon"
                :style="tileIconStyle(row, cell)"
                :src="row.icon"
                :layers="row.iconLayers"
                :width="row.iconSize?.width"
                :height="row.iconSize?.height"
                :foulborn="row.foulborn && !row.iconFoulborn"
              />
              <span v-else class="pxd-gear-tile__name">{{ row.label }}</span>
              <PobSocketOverlay
                v-if="row.sockets"
                class="pxd-gear-tile__sockets"
                :sockets="row.sockets"
                :width="row.iconSize?.width"
                :height="row.iconSize?.height"
                :tile-width="cell.width"
                :tile-height="cell.height"
                :contents="row.socketContents"
                @select-content="(content, event) => emit('selectContent', content, event)"
              />
            </template>
            <span v-else class="pxd-gear-tile__slot">{{ cellLabel(id) }}</span>
            <span
              v-if="row?.corrupted"
              data-pob-build-gear-corrupted
              class="pxd-gear-tile__corrupted"
              :aria-label="t('pobBuild.corrupted')"
            />
            <span
              v-if="row?.searchCustomized"
              data-pob-build-gear-customized
              class="pxd-gear-tile__dot"
              :aria-label="t('pobBuild.customizedTitle')"
            />
            <Checkbox
              v-if="row"
              :model-value="row.done"
              data-pob-build-gear-done
              :aria-label="t('pobBuild.doneAria', { name: row.label })"
              class="pxd-gear-tile__check"
              @click.stop
              @update:model-value="emit('toggleDone', row.key)"
            />
          </div>
        </template>
      </div>

      <div v-if="hasFlasks" data-pob-build-gear-flasks class="pxd-gear-row pxd-gear-row--flasks">
        <template v-for="(row, index) in layout.flasks" :key="index">
          <div
            v-if="row"
            role="button"
            tabindex="0"
            data-pob-build-gear-tile="flask"
            :data-done="row.done ? 'true' : undefined"
            :aria-pressed="activeKey === row.key"
            :title="tileTitle(row)"
            class="pxd-gear-tile pxd-gear-tile--flask"
            :class="[
              tileClass(row),
              { 'is-active': activeKey === row.key, 'pxd-gear-tile--corrupted': row.corrupted },
            ]"
            @click="emit('select', row, $event)"
            @keydown.enter.self.prevent="emit('select', row, $event)"
            @keydown.space.self.prevent="emit('select', row, $event)"
            @mouseenter="emit('hover', row, $event)"
            @mouseleave="emit('leave')"
          >
            <PobItemImage
              v-if="row.icon"
              class="pxd-gear-tile__icon"
              :src="row.icon"
              :layers="row.iconLayers"
              :width="row.iconSize?.width"
              :height="row.iconSize?.height"
              :foulborn="row.foulborn && !row.iconFoulborn"
            />
            <span v-else class="pxd-gear-tile__name">{{ row.label }}</span>
            <span
              v-if="row.searchCustomized"
              data-pob-build-gear-customized
              class="pxd-gear-tile__dot"
              :aria-label="t('pobBuild.customizedTitle')"
            />
            <span
              v-if="row.corrupted"
              data-pob-build-gear-corrupted
              class="pxd-gear-tile__corrupted"
              :aria-label="t('pobBuild.corrupted')"
            />
            <Checkbox
              :model-value="row.done"
              data-pob-build-gear-done
              :aria-label="t('pobBuild.doneAria', { name: row.label })"
              class="pxd-gear-tile__check"
              @click.stop
              @update:model-value="emit('toggleDone', row.key)"
            />
          </div>
          <div
            v-else
            data-pob-build-gear-empty="flask"
            class="pxd-gear-tile pxd-gear-tile--flask pxd-gear-tile--empty"
            :title="t('pobBuild.slot.flask', { n: index + 1 })"
          />
        </template>
      </div>

      <section
        v-for="section in sections"
        :key="section.id"
        :data-pob-build-gear-section="section.id"
        class="flex flex-col gap-[var(--pxd-space-xs)]"
      >
        <h5 class="m-0 text-[length:var(--pxd-font-caption)] font-semibold text-muted-foreground">
          {{ t(section.label) }}
        </h5>
        <div class="pxd-gear-row">
          <div
            v-for="row in section.rows"
            :key="row.key"
            role="button"
            tabindex="0"
            :data-pob-build-gear-tile="section.id"
            :data-done="row.done ? 'true' : undefined"
            :aria-pressed="activeKey === row.key"
            :title="tileTitle(row)"
            class="pxd-gear-tile pxd-gear-tile--small"
            :class="[
              tileClass(row),
              { 'is-active': activeKey === row.key, 'pxd-gear-tile--corrupted': row.corrupted },
            ]"
            @click="emit('select', row, $event)"
            @keydown.enter.self.prevent="emit('select', row, $event)"
            @keydown.space.self.prevent="emit('select', row, $event)"
            @mouseenter="emit('hover', row, $event)"
            @mouseleave="emit('leave')"
          >
            <PobItemImage
              v-if="row.icon"
              class="pxd-gear-tile__icon"
              :src="row.icon"
              :layers="row.iconLayers"
              :width="row.iconSize?.width"
              :height="row.iconSize?.height"
              :foulborn="row.foulborn && !row.iconFoulborn"
            />
            <span v-else class="pxd-gear-tile__name">{{ row.label }}</span>
            <span v-if="row.count > 1" class="pxd-gear-tile__count">×{{ row.count }}</span>
            <span
              v-if="row.searchCustomized"
              data-pob-build-gear-customized
              class="pxd-gear-tile__dot"
              :aria-label="t('pobBuild.customizedTitle')"
            />
            <span
              v-if="row.corrupted"
              data-pob-build-gear-corrupted
              class="pxd-gear-tile__corrupted"
              :aria-label="t('pobBuild.corrupted')"
            />
            <Checkbox
              :model-value="row.done"
              data-pob-build-gear-done
              :aria-label="t('pobBuild.doneAria', { name: row.label })"
              class="pxd-gear-tile__check"
              @click.stop
              @update:model-value="emit('toggleDone', row.key)"
            />
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.pxd-gear-grid {
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  grid-template-rows: repeat(6, minmax(0, 1fr));
  aspect-ratio: 8 / 6;
  /* aspect-ratio 預設會讓內容撐開最小高度；PoE2 的原圖較大，會把整列撐高 */
  min-height: 0;
  gap: var(--pxd-space-xs);
}

/*
 * 側欄拉寬時圖片不再跟著放大：一格最大約 52px（8 格加間距約 440px），裝備欄置中
 */
.pxd-gear-body {
  display: flex;
  width: 100%;
  max-width: 440px;
  flex-direction: column;
  gap: var(--pxd-space-sm);
  margin-inline: auto;
}

/* 珠寶、護身符等一格的物品和裝備欄同一種格子大小（與戒指一樣大） */
.pxd-gear-row {
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: var(--pxd-space-xs);
}

.pxd-gear-row--flasks {
  grid-template-columns: repeat(5, minmax(0, 1fr));
  width: 62.5%;
  margin-inline: auto;
}

.pxd-gear-tile {
  --pxd-gear-accent: var(--border);
  position: relative;
  display: flex;
  min-width: 0;
  min-height: 0;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--pxd-gear-accent) 70%, transparent);
  border-radius: var(--radius-sm, 4px);
  background:
    radial-gradient(
      ellipse at 50% 40%,
      color-mix(in srgb, var(--pxd-gear-accent) 14%, transparent),
      transparent 75%
    ),
    color-mix(in srgb, var(--muted) 45%, var(--card));
  padding: 2px;
  color: var(--foreground);
  font: inherit;
  cursor: pointer;
  transition:
    border-color 0.15s,
    box-shadow 0.15s,
    opacity 0.15s;
}

.pxd-gear-tile[data-pob-build-gear-tile]:hover {
  border-color: var(--pxd-gear-accent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--pxd-gear-accent) 45%, transparent);
}

.pxd-gear-tile[data-pob-build-gear-tile]:focus-visible {
  outline: none;
  border-color: var(--ring);
  box-shadow: 0 0 0 1px var(--ring);
}

.pxd-gear-tile.is-active {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 1px var(--primary);
}

.pxd-gear-tile--unique {
  --pxd-gear-accent: var(--pxd-rarity-unique);
}
.pxd-gear-tile--rare {
  --pxd-gear-accent: var(--pxd-rarity-rare);
}
.pxd-gear-tile--magic {
  --pxd-gear-accent: var(--pxd-rarity-magic);
}

.pxd-gear-tile--empty {
  border-style: dashed;
  background: color-mix(in srgb, var(--muted) 20%, transparent);
  cursor: default;
}

.pxd-gear-tile--flask {
  aspect-ratio: 1 / 2;
}

.pxd-gear-tile--small {
  aspect-ratio: 1;
}

.pxd-gear-tile[data-done='true'] .pxd-gear-tile__icon,
.pxd-gear-tile[data-done='true'] .pxd-gear-tile__name {
  opacity: 0.35;
  filter: grayscale(0.7);
}

.pxd-gear-tile__sockets {
  opacity: 0;
  transition: opacity 0.15s;
}

/* 和遊戲一樣，平常只看圖片，滑過（或選取、鍵盤聚焦、按住 Alt）時才顯示插槽 */
.pxd-gear-tile:hover .pxd-gear-tile__sockets,
.pxd-gear-tile:focus-visible .pxd-gear-tile__sockets,
.pxd-gear-tile:focus-within .pxd-gear-tile__sockets,
.pxd-gear-tile.is-active .pxd-gear-tile__sockets,
[data-reveal-sockets='true'] .pxd-gear-tile__sockets {
  opacity: 1;
}

.pxd-gear-tile__icon {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.pxd-gear-tile__name,
.pxd-gear-tile__slot {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  text-align: center;
  font-size: var(--pxd-font-caption);
  line-height: 1.15;
  word-break: break-word;
}

.pxd-gear-tile__name {
  color: color-mix(in srgb, var(--pxd-gear-accent) 80%, var(--foreground));
  font-weight: 600;
}

.pxd-gear-tile__slot {
  color: var(--muted-foreground);
  opacity: 0.7;
}

.pxd-gear-tile__dot {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 6px;
  height: 6px;
  border-radius: 9999px;
  background: var(--primary);
}

.pxd-gear-tile--corrupted {
  border-color: color-mix(in srgb, var(--pxd-corrupted) 75%, transparent);
  background:
    radial-gradient(
      ellipse at 50% 45%,
      color-mix(in srgb, var(--pxd-corrupted) 30%, transparent),
      transparent 80%
    ),
    color-mix(in srgb, var(--pxd-corrupted) 12%, var(--card));
}

/* 已汙染：和 poe.ninja 一樣把整格染成暗紅，外加一圈內光，不另外畫線 */
.pxd-gear-tile__corrupted {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  box-shadow: inset 0 0 10px color-mix(in srgb, var(--pxd-corrupted) 70%, transparent);
  pointer-events: none;
}

.pxd-gear-tile__count {
  position: absolute;
  bottom: 2px;
  left: 2px;
  padding: 0 3px;
  border: 1px solid color-mix(in srgb, var(--border) 75%, transparent);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--card) 88%, transparent);
  color: var(--foreground);
  font-size: var(--pxd-font-caption);
  font-weight: 700;
  line-height: 1.25;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}

.pxd-gear-tile :deep(.pxd-gear-tile__check) {
  position: absolute;
  top: 2px;
  right: 2px;
  opacity: 0;
  transition: opacity 0.15s;
}

.pxd-gear-tile:hover :deep(.pxd-gear-tile__check),
.pxd-gear-tile :deep(.pxd-gear-tile__check:focus-visible),
.pxd-gear-tile[data-done='true'] :deep(.pxd-gear-tile__check) {
  opacity: 1;
}
</style>
