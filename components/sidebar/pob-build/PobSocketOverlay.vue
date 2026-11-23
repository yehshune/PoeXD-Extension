<script setup lang="ts">
/**
 * 裝備欄格子上的插槽：依遊戲順序排出顏色與連結線，以自己的 SVG 繪製（不使用遊戲素材）。
 * 版面依物品的背包格數縮放，與圖片上的位置大致對齊。
 */
import { computed } from 'vue';
import { socketLayout, type SocketColor } from './pob-socket-layout';

const props = defineProps<{
  sockets: string;
  /** 物品的背包格數；沒有時當作 2×3 */
  width?: number;
  height?: number;
}>();

const CELL = 10;
const RADIUS = 2.9;

const layout = computed(() => socketLayout(props.sockets, props.width ?? 2, props.height ?? 3));

const center = (index: number) => {
  const socket = layout.value.sockets[index];
  return { x: socket.column * CELL + CELL / 2, y: socket.row * CELL + CELL / 2 };
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
</script>

<template>
  <svg
    v-if="layout.sockets.length > 0"
    data-pob-build-sockets
    :data-socket-count="layout.sockets.length"
    class="pxd-sockets"
    :viewBox="`0 0 ${layout.columns * CELL} ${layout.rows * CELL}`"
    :style="{ width: `${(layout.columns / Math.max(width ?? 2, 1)) * 72}%` }"
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
    <circle
      v-for="(socket, index) in layout.sockets"
      :key="index"
      :data-socket-color="socket.color"
      class="pxd-socket"
      :class="COLOR_CLASS[socket.color]"
      :cx="center(index).x"
      :cy="center(index).y"
      :r="RADIUS"
    />
  </svg>
</template>

<style scoped>
.pxd-sockets {
  position: absolute;
  top: 50%;
  left: 50%;
  max-height: 88%;
  transform: translate(-50%, -50%);
  pointer-events: none;
  filter: drop-shadow(0 0 1px rgb(0 0 0 / 0.8));
}

.pxd-socket-link {
  stroke: oklch(0.82 0.06 85);
  stroke-width: 2.4;
  stroke-linecap: round;
}

.pxd-socket {
  stroke: rgb(0 0 0 / 0.65);
  stroke-width: 0.9;
}

.pxd-socket--r {
  fill: oklch(0.58 0.19 27);
}
.pxd-socket--g {
  fill: oklch(0.66 0.17 140);
}
.pxd-socket--b {
  fill: oklch(0.58 0.15 255);
}
.pxd-socket--w {
  fill: oklch(0.93 0 0);
}
.pxd-socket--a {
  fill: oklch(0.32 0.02 280);
}
.pxd-socket--d {
  fill: oklch(0.6 0.1 70);
}
.pxd-socket--s {
  fill: oklch(0.7 0.05 90);
}
.pxd-socket--unknown {
  fill: oklch(0.55 0 0);
}
</style>
