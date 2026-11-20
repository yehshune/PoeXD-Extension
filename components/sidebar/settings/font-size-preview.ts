import type { InjectionKey } from 'vue';

/** 即時縮放預覽 callback；傳入 null 時恢復讀取正式偏好設定值 */
export type FontSizeScalePreviewSetter = (scale: number | null) => void;

export const FONT_SIZE_SCALE_PREVIEW_KEY: InjectionKey<FontSizeScalePreviewSetter> = Symbol(
  'poexd-font-size-scale-preview',
);
