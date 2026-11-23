<script setup lang="ts">
/**
 * 購物清單的「裝備欄」檢視：依遊戲裝備視窗的位置排出 PoB 的裝備，下方是藥劑、護符、珠寶、
 * 柳條人與移植物。格子以稀有度上色，點擊開啟與清單相同的預覽；勾選完成用格子角落的按鈕。
 */
import { Check } from '@lucide/vue';
import { computed, ref } from 'vue';
import { t, type I18nKey } from '@/utils/i18n';
import { formatPobSlot } from './pob-slot-label';
import { GEAR_CELLS, gearLayout, type GearCellId } from './pob-gear-layout';
import type { ShoppingRow } from './usePobBuild';

const props = defineProps<{
  rows: readonly ShoppingRow[];
  activeKey?: string;
}>();

const emit = defineEmits<{
  select: [row: ShoppingRow, event: MouseEvent];
  toggleDone: [key: string];
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

const tileTitle = (row: ShoppingRow) => `${row.label} · ${formatPobSlot(row.slot ?? '')}`;
</script>

<template>
  <div
    data-pob-build-gear
    class="flex flex-col gap-[var(--pxd-space-sm)] bg-card p-[var(--pxd-space-md)]"
  >
    <div v-if="layout.hasSwap" class="flex justify-end">
      <div
        role="group"
        :aria-label="t('pobBuild.gear.weaponSet')"
        class="inline-flex overflow-hidden rounded-sm border border-border text-[length:var(--pxd-font-caption)] font-bold"
      >
        <button
          v-for="(swap, index) in [false, true]"
          :key="index"
          type="button"
          data-pob-build-gear-swap
          :aria-pressed="showSwap === swap"
          class="cursor-pointer px-[var(--pxd-space-sm)] py-[1px] transition-colors"
          :class="
            showSwap === swap
              ? 'bg-primary/15 text-primary'
              : 'bg-background/60 text-muted-foreground hover:bg-muted/60'
          "
          @click="showSwap = swap"
        >
          {{ swap ? 'II' : 'I' }}
        </button>
      </div>
    </div>

    <div data-pob-build-gear-grid class="pxd-gear-grid">
      <template v-for="{ id, cell, row } in cells" :key="id">
        <component
          :is="row ? 'button' : 'div'"
          :type="row ? 'button' : undefined"
          :data-pob-build-gear-tile="row ? id : undefined"
          :data-pob-build-gear-empty="row ? undefined : id"
          :data-done="row?.done ? 'true' : undefined"
          :aria-pressed="row ? activeKey === row.key : undefined"
          :title="row ? tileTitle(row) : cellLabel(id)"
          class="pxd-gear-tile"
          :class="[
            row ? tileClass(row) : 'pxd-gear-tile--empty',
            { 'is-active': row && activeKey === row.key },
          ]"
          :style="{
            gridColumn: `${cell.column} / span ${cell.width}`,
            gridRow: `${cell.row} / span ${cell.height}`,
          }"
          @click="row && emit('select', row, $event)"
        >
          <template v-if="row">
            <img
              v-if="row.icon"
              :src="row.icon"
              alt=""
              loading="lazy"
              class="pxd-gear-tile__icon"
            />
            <span v-else class="pxd-gear-tile__name">{{ row.label }}</span>
          </template>
          <span v-else class="pxd-gear-tile__slot">{{ cellLabel(id) }}</span>
          <span
            v-if="row?.searchCustomized"
            data-pob-build-gear-customized
            class="pxd-gear-tile__dot"
            :aria-label="t('pobBuild.customizedTitle')"
          />
          <span
            v-if="row"
            role="checkbox"
            tabindex="0"
            data-pob-build-gear-done
            :aria-checked="row.done"
            :aria-label="t('pobBuild.doneAria', { name: row.label })"
            class="pxd-gear-tile__check"
            @click.stop="emit('toggleDone', row.key)"
            @keydown.enter.stop.prevent="emit('toggleDone', row.key)"
            @keydown.space.stop.prevent="emit('toggleDone', row.key)"
          >
            <Check v-if="row.done" class="size-full" aria-hidden="true" />
          </span>
        </component>
      </template>
    </div>

    <div v-if="hasFlasks" data-pob-build-gear-flasks class="pxd-gear-row pxd-gear-row--flasks">
      <template v-for="(row, index) in layout.flasks" :key="index">
        <button
          v-if="row"
          type="button"
          data-pob-build-gear-tile="flask"
          :data-done="row.done ? 'true' : undefined"
          :aria-pressed="activeKey === row.key"
          :title="tileTitle(row)"
          class="pxd-gear-tile pxd-gear-tile--flask"
          :class="[tileClass(row), { 'is-active': activeKey === row.key }]"
          @click="emit('select', row, $event)"
        >
          <img v-if="row.icon" :src="row.icon" alt="" loading="lazy" class="pxd-gear-tile__icon" />
          <span v-else class="pxd-gear-tile__name">{{ row.label }}</span>
          <span v-if="row.searchCustomized" class="pxd-gear-tile__dot" />
          <span
            role="checkbox"
            tabindex="0"
            data-pob-build-gear-done
            :aria-checked="row.done"
            :aria-label="t('pobBuild.doneAria', { name: row.label })"
            class="pxd-gear-tile__check"
            @click.stop="emit('toggleDone', row.key)"
            @keydown.enter.stop.prevent="emit('toggleDone', row.key)"
            @keydown.space.stop.prevent="emit('toggleDone', row.key)"
          >
            <Check v-if="row.done" class="size-full" aria-hidden="true" />
          </span>
        </button>
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
        <button
          v-for="row in section.rows"
          :key="row.key"
          type="button"
          :data-pob-build-gear-tile="section.id"
          :data-done="row.done ? 'true' : undefined"
          :aria-pressed="activeKey === row.key"
          :title="tileTitle(row)"
          class="pxd-gear-tile pxd-gear-tile--small"
          :class="[tileClass(row), { 'is-active': activeKey === row.key }]"
          @click="emit('select', row, $event)"
        >
          <img v-if="row.icon" :src="row.icon" alt="" loading="lazy" class="pxd-gear-tile__icon" />
          <span v-else class="pxd-gear-tile__name">{{ row.label }}</span>
          <span v-if="row.count > 1" class="pxd-gear-tile__count">×{{ row.count }}</span>
          <span v-if="row.searchCustomized" class="pxd-gear-tile__dot" />
          <span
            role="checkbox"
            tabindex="0"
            data-pob-build-gear-done
            :aria-checked="row.done"
            :aria-label="t('pobBuild.doneAria', { name: row.label })"
            class="pxd-gear-tile__check"
            @click.stop="emit('toggleDone', row.key)"
            @keydown.enter.stop.prevent="emit('toggleDone', row.key)"
            @keydown.space.stop.prevent="emit('toggleDone', row.key)"
          >
            <Check v-if="row.done" class="size-full" aria-hidden="true" />
          </span>
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.pxd-gear-grid {
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  grid-template-rows: repeat(6, minmax(0, 1fr));
  aspect-ratio: 8 / 6;
  gap: var(--pxd-space-xs);
}

.pxd-gear-row {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(44px, 1fr));
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

button.pxd-gear-tile:hover {
  border-color: var(--pxd-gear-accent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--pxd-gear-accent) 45%, transparent);
}

button.pxd-gear-tile:focus-visible,
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

.pxd-gear-tile__count {
  position: absolute;
  bottom: 1px;
  left: 3px;
  font-size: var(--pxd-font-caption);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.pxd-gear-tile__check {
  position: absolute;
  top: 2px;
  right: 2px;
  display: flex;
  width: 14px;
  height: 14px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: color-mix(in srgb, var(--card) 85%, transparent);
  color: var(--primary-foreground);
  opacity: 0;
  transition: opacity 0.15s;
}

.pxd-gear-tile:hover .pxd-gear-tile__check,
.pxd-gear-tile__check:focus-visible,
.pxd-gear-tile[data-done='true'] .pxd-gear-tile__check {
  opacity: 1;
}

.pxd-gear-tile[data-done='true'] .pxd-gear-tile__check {
  border-color: var(--primary);
  background: var(--primary);
}
</style>
