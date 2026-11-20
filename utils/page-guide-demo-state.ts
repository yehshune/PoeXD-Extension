import { ref } from 'vue';

/**
 * 初始導覽階級步驟要自動展開的 T 階清單（tier slot key）；null 表示沒有示範。
 * 側欄設定、TierDropdownHost 依此開關清單。
 */
export const tierMenuDemoSlotKey = ref<string | null>(null);

/** 初始導覽階級步驟正在示範點擊的 T 按鈕（tier slot key），從游標移動開始即鎖定不可互動 */
export const tierTriggerDemoSlotKey = ref<string | null>(null);

/** 初始導覽詞綴選擇器示範中：鎖定詞綴與類別彈窗不可互動，避免使用者誤觸 */
export const affixDemoMode = ref(false);

/** 初始導覽詞綴選擇器示範時要呈現 hover 狀態（顯示立即加入鈕）的詞綴 ID */
export const affixDemoHoveredModId = ref<string | null>(null);

/** 優先開啟導覽示範詞綴的 T 階按鈕；demoOnly=true 時只找示範詞綴，找不到則回傳 null */
export function findFirstTierSlotKey(
  root: ParentNode = document,
  options: { demoOnly?: boolean } = {},
): string | null {
  const demoTrigger = root.querySelector<HTMLElement>(
    '[data-poexd-page-guide-demo="true"] .poexd-tier-trigger[data-tier-slot-key]',
  );
  if (demoTrigger?.dataset.tierSlotKey) return demoTrigger.dataset.tierSlotKey;
  if (options.demoOnly) return null;
  const trigger = root.querySelector<HTMLElement>('.poexd-tier-trigger[data-tier-slot-key]');
  return trigger?.dataset.tierSlotKey ?? null;
}
