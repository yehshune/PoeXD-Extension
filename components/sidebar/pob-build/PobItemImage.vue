<script setup lang="ts">
/**
 * 物品圖片。一般物品直接顯示圖片；藥劑、寶石的圖是橫排三格的 sprite（外殼／液體／晶體分開），
 * 依 `layers` 把指定的格子疊成一張。
 */
import { computed } from 'vue';
import { SPRITE_FRAMES } from '@/utils/pob-item-art';

const props = defineProps<{
  src: string;
  layers?: readonly number[];
  /** 背包格數，決定疊加後的長寬比；省略時為正方形 */
  width?: number;
  height?: number;
}>();

const layerStyle = (frame: number) => ({
  backgroundImage: `url("${props.src}")`,
  backgroundSize: `${SPRITE_FRAMES * 100}% 100%`,
  backgroundPosition: `${(frame / (SPRITE_FRAMES - 1)) * 100}% 0`,
});

const aspectRatio = computed(() => `${props.width ?? 1} / ${props.height ?? 1}`);
</script>

<template>
  <span
    v-if="layers?.length"
    role="img"
    data-pob-item-sprite
    class="pxd-item-sprite"
    :style="{ aspectRatio }"
  >
    <span
      v-for="frame in layers"
      :key="frame"
      :data-sprite-frame="frame"
      class="pxd-item-sprite__layer"
      :style="layerStyle(frame)"
    />
  </span>
  <img v-else :src="src" alt="" loading="lazy" />
</template>

<style scoped>
.pxd-item-sprite {
  position: relative;
  display: inline-block;
  height: 100%;
  max-width: 100%;
}

.pxd-item-sprite__layer {
  position: absolute;
  inset: 0;
  background-repeat: no-repeat;
}
</style>
