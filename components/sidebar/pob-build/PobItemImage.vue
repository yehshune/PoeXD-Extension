<script setup lang="ts">
/**
 * 物品圖片。一般物品直接顯示圖片；藥劑、寶石的圖是橫排三格的 sprite（外殼／液體／晶體分開），
 * 依 `layers` 把指定的格子疊成一張。圖片一律用 `<img>` 且不送 Referer（PoE2 圖片放在自架的
 * GitHub Pages，不讓對方看到使用者所在的頁面）。
 *
 * 路徑規則之外仍可能遇到單張圖，所以載入後依實際長寬比確認：寬度不到兩格就改成直接顯示整張圖。
 */
import { computed, ref, watch } from 'vue';
import { SPRITE_FRAMES } from '@/utils/pob-item-art';

const props = defineProps<{
  src: string;
  layers?: readonly number[];
  /** 背包格數，決定疊加後的長寬比；省略時為正方形 */
  width?: number;
  height?: number;
  /** 穢生傳奇：官方圖是 GGG 伺服器即時加上紫色紋路，這裡以濾鏡近似 */
  foulborn?: boolean;
}>();

const singleImage = ref(false);
watch(
  () => props.src,
  () => {
    singleImage.value = false;
  },
);

const cellRatio = computed(() => (props.width ?? 1) / (props.height ?? 1));
const aspectRatio = computed(() => `${props.width ?? 1} / ${props.height ?? 1}`);
const showSprite = computed(() => Boolean(props.layers?.length) && !singleImage.value);

const layerStyle = (frame: number) => ({
  width: `${SPRITE_FRAMES * 100}%`,
  left: `${-frame * 100}%`,
});

/** 三格 sprite 的寬高比約為格子比例的三倍；不到兩倍視為單張圖 */
const checkSprite = (event: Event) => {
  const image = event.target as HTMLImageElement;
  if (!image.naturalWidth || !image.naturalHeight) return;
  if (image.naturalWidth / image.naturalHeight < cellRatio.value * 2) singleImage.value = true;
};
</script>

<template>
  <span
    v-if="showSprite"
    role="img"
    data-pob-item-sprite
    class="pxd-item-sprite"
    :class="{ 'pxd-item--foulborn': foulborn }"
    :style="{ aspectRatio }"
  >
    <span v-for="(frame, index) in layers" :key="frame" class="pxd-item-sprite__layer">
      <img
        :src="src"
        alt=""
        loading="lazy"
        referrerpolicy="no-referrer"
        :data-sprite-frame="frame"
        :style="layerStyle(frame)"
        @load="index === 0 && checkSprite($event)"
      />
    </span>
  </span>
  <img
    v-else
    :src="src"
    alt=""
    loading="lazy"
    referrerpolicy="no-referrer"
    :class="{ 'pxd-item--foulborn': foulborn }"
  />
</template>

<style scoped>
.pxd-item--foulborn {
  filter: saturate(0.35) brightness(0.9) drop-shadow(0 0 1px oklch(0.62 0.26 305))
    drop-shadow(0 0 3px oklch(0.55 0.25 300 / 0.8));
}

.pxd-item-sprite {
  position: relative;
  display: inline-block;
  height: 100%;
  max-width: 100%;
}

.pxd-item-sprite__layer {
  position: absolute;
  inset: 0;
  overflow: hidden;
}

.pxd-item-sprite__layer > img {
  position: absolute;
  top: 0;
  height: 100%;
  max-width: none;
}
</style>
