import { ref } from 'vue';

/**
 * 初始導覽階級步驟要自動展開的 T 階清單（tier slot key）；null 表示沒有示範。
 * 側欄設定、TierDropdownHost 依此開關清單。
 */
export const tierMenuDemoSlotKey = ref<string | null>(null);

/** 頁面上第一個 T 階按鈕對應的 slot（導覽外框框住的就是它） */
export function findFirstTierSlotKey(root: ParentNode = document): string | null {
  const trigger = root.querySelector<HTMLElement>('.poexd-tier-trigger[data-tier-slot-key]');
  return trigger?.dataset.tierSlotKey ?? null;
}
