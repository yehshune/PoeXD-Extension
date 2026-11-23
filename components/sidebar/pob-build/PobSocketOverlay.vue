<script setup lang="ts">
/**
 * 裝備欄格子上的插槽：依遊戲順序排出顏色與連結線（連結線用 SVG，插槽用 HTML 才能放圖片）。
 * 有內容物時（PoE 1 寶石、PoE 2 符文）插槽內顯示其圖片，外圈保留插槽顏色；滑過插槽時
 * 通知父層顯示內容說明。版面依物品的背包格數縮放，與圖片上的位置大致對齊。
 */
import { computed } from 'vue';
import PobItemImage from './PobItemImage.vue';
import { socketLayout, type SocketColor } from './pob-socket-layout';
import type { SocketContent } from './usePobBuild';

const props = defineProps<{
  sockets: string;
  /** 物品的背包格數；沒有時當作 2×3 */
  width?: number;
  height?: number;
  contents?: readonly SocketContent[];
}>();

const emit = defineEmits<{
  /** 滑入有內容物的插槽時帶出內容與插槽元素；離開時為 null */
  hoverContent: [content: SocketContent | null, element: HTMLElement | null];
  /** 點有內容物的插槽（不會再觸發外層格子的點擊） */
  selectContent: [content: SocketContent, event: MouseEvent];
}>();

const CELL = 10;
/** 插槽直徑佔一格的比例；和 poe.ninja 一樣讓寶石圖看得清楚，幾乎填滿格子 */
const SOCKET_SIZE = 0.86;
/** 插槽區佔物品圖片寬度的比例（以背包格數換算） */
const AREA_WIDTH = 94;

const layout = computed(() => socketLayout(props.sockets, props.width ?? 2, props.height ?? 3));

const center = (index: number) => {
  const socket = layout.value.sockets[index];
  return { x: socket.column * CELL + CELL / 2, y: socket.row * CELL + CELL / 2 };
};

const socketStyle = (index: number) => {
  const socket = layout.value.sockets[index];
  const { columns, rows } = layout.value;
  return {
    left: `${((socket.column + 0.5) / columns) * 100}%`,
    top: `${((socket.row + 0.5) / rows) * 100}%`,
    width: `${(SOCKET_SIZE / columns) * 100}%`,
  };
};

const COLOR_CLASS: Readonly<Record<SocketColor, string>> = {
  R: 'pxd-socket--r',
  G: 'pxd-socket--g',
  B: 'pxd-socket--b',
  W: 'pxd-socket--w',
  A: 'pxd-socket--a',
  D: 'pxd-socket--d',
  S: 'pxd-socket--s',
  '?': 'pxd-socket--unknown',
};

const contentAt = (index: number) => props.contents?.[index];

const select = (index: number, event: MouseEvent) => {
  const content = contentAt(index);
  if (!content) return;
  event.stopPropagation();
  emit('selectContent', content, event);
};

const enter = (index: number, event: MouseEvent) => {
  const content = contentAt(index);
  if (content) emit('hoverContent', content, event.currentTarget as HTMLElement);
};
</script>

<template>
  <div
    v-if="layout.sockets.length > 0"
    data-pob-build-sockets
    :data-socket-count="layout.sockets.length"
    class="pxd-sockets"
    :style="{
      width: `${(layout.columns / Math.max(width ?? 2, 1)) * AREA_WIDTH}%`,
      aspectRatio: `${layout.columns} / ${layout.rows}`,
    }"
  >
    <svg
      class="pxd-socket-links"
      :viewBox="`0 0 ${layout.columns * CELL} ${layout.rows * CELL}`"
      aria-hidden="true"
    >
      <line
        v-for="([from, to], index) in layout.links"
        :key="`link-${index}`"
        class="pxd-socket-link"
        :x1="center(from).x"
        :y1="center(from).y"
        :x2="center(to).x"
        :y2="center(to).y"
      />
    </svg>
    <span
      v-for="(socket, index) in layout.sockets"
      :key="index"
      :data-socket-color="socket.color"
      :data-socket-filled="contentAt(index) ? 'true' : undefined"
      class="pxd-socket"
      :class="[COLOR_CLASS[socket.color], { 'is-filled': contentAt(index) }]"
      :style="socketStyle(index)"
      @mouseenter="enter(index, $event)"
      @mouseleave="emit('hoverContent', null, null)"
      @click="select(index, $event)"
    >
      <PobItemImage
        v-if="contentAt(index)?.icon"
        class="pxd-socket__content"
        :src="contentAt(index)!.icon!"
        :layers="contentAt(index)!.iconLayers"
      />
    </span>
  </div>
</template>

<style scoped>
.pxd-sockets {
  position: absolute;
  top: 50%;
  left: 50%;
  max-height: 98%;
  transform: translate(-50%, -50%);
  pointer-events: none;
  filter: drop-shadow(0 0 1px rgb(0 0 0 / 0.8));
}

.pxd-socket-links {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.pxd-socket-link {
  stroke: oklch(0.82 0.06 85);
  stroke-width: 3.2;
  stroke-linecap: round;
}

.pxd-socket {
  --pxd-socket-color: oklch(0.55 0 0);
  position: absolute;
  display: flex;
  aspect-ratio: 1;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 1px solid rgb(0 0 0 / 0.65);
  border-radius: 9999px;
  background: var(--pxd-socket-color);
  transform: translate(-50%, -50%);
  pointer-events: auto;
}

/* 有內容物時：外圈是插槽顏色，中間放內容物圖片 */
.pxd-socket.is-filled {
  cursor: pointer;
  border: 2px solid var(--pxd-socket-color);
  background: rgb(0 0 0 / 0.75);
  box-shadow: 0 0 0 1px rgb(0 0 0 / 0.65);
}

.pxd-socket__content {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.pxd-socket--r {
  --pxd-socket-color: oklch(0.58 0.19 27);
}
.pxd-socket--g {
  --pxd-socket-color: oklch(0.66 0.17 140);
}
.pxd-socket--b {
  --pxd-socket-color: oklch(0.58 0.15 255);
}
.pxd-socket--w {
  --pxd-socket-color: oklch(0.93 0 0);
}
.pxd-socket--a {
  --pxd-socket-color: oklch(0.32 0.02 280);
}
.pxd-socket--d {
  --pxd-socket-color: oklch(0.6 0.1 70);
}
.pxd-socket--s {
  --pxd-socket-color: oklch(0.7 0.05 90);
}
</style>
