import { getCurrentScope, onScopeDispose, readonly, ref, watch, type Ref } from 'vue';

/** 側邊欄與懸浮視窗搜尋輸入框的預設防抖延遲（ms） */
export const DEFAULT_SEARCH_DEBOUNCE_MS = 150;

/**
 * 將搜尋關鍵字 `Ref<string>` 轉為防抖後的唯讀 `Ref<string>`。
 *
 * - 清空（空字串或純空白）時立即更新，不等待延遲，讓按「清除」或關閉搜尋框時畫面零延遲復原。
 * - 離開目前 Vue effect scope 時自動取消未執行的 timer。
 */
export function useDebouncedRef(
  source: Ref<string>,
  delayMs: number = DEFAULT_SEARCH_DEBOUNCE_MS,
): Readonly<Ref<string>> {
  const debounced = ref(source.value);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const cancel = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  watch(source, (next) => {
    cancel();
    if (!next.trim() || delayMs <= 0) {
      debounced.value = next;
      return;
    }
    timer = setTimeout(() => {
      timer = undefined;
      debounced.value = next;
    }, delayMs);
  });

  if (getCurrentScope()) {
    onScopeDispose(cancel);
  }

  return readonly(debounced);
}
