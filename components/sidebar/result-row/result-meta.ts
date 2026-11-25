/**
 * 物品結果列第二行的灰色資訊片段（釘選與看板共用）。
 * 一般資訊維持灰色；會影響能不能直接買的狀態（需私訊、AFK、離線）用顏色標出，掃一眼就分得出來。
 */
export type MetaTone = 'caution' | 'danger';

export interface MetaPart {
  text: string;
  tone?: MetaTone;
}

export const META_TONE_CLASSES: Readonly<Record<MetaTone, string>> = {
  caution: 'font-medium text-amber-700 dark:text-amber-400',
  danger: 'font-medium text-destructive',
};
