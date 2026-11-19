import { ref } from 'vue';

/**
 * 初始導覽階級步驟要自動展開的 T 階清單（tier slot key）；null 表示沒有示範。
 * 側欄設定、TierDropdownHost 依此開關清單。
 */
export const tierMenuDemoSlotKey = ref<string | null>(null);

/** 優先開啟導覽示範詞綴的 T 階按鈕，找不到示範標記時退回頁面上第一個 */
export function findFirstTierSlotKey(root: ParentNode = document): string | null {
  const demoTrigger = root.querySelector<HTMLElement>(
    '[data-poexd-page-guide-demo="true"] .poexd-tier-trigger[data-tier-slot-key]',
  );
  if (demoTrigger?.dataset.tierSlotKey) return demoTrigger.dataset.tierSlotKey;
  const trigger = root.querySelector<HTMLElement>('.poexd-tier-trigger[data-tier-slot-key]');
  return trigger?.dataset.tierSlotKey ?? null;
}
