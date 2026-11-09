import { computed, ref, shallowRef, watch, type Ref } from 'vue';

export interface UsePinnedPreviewOptions<T> {
  /** 為 true 時不能開啟，已開啟的也會關閉（例如拖曳或編輯中）。 */
  disabled?: Ref<boolean>;
  onOpen?: (item: T) => void;
  onClose?: (item: T) => void;
}

/**
 * 側邊欄清單共用的單例 Search Preview 狀態：點擊切換、同一時間只開一個（見 CONTEXT.md「Search Preview」）。
 * 點同一筆再點一次關閉；點另一筆則直接切換到該筆。
 */
export function usePinnedPreview<T extends { id: string }>(
  options: UsePinnedPreviewOptions<T> = {},
) {
  const activeItem = shallowRef<T | null>(null);
  const anchorEl = ref<HTMLElement | null>(null);
  const isOpen = computed(() => activeItem.value !== null);

  const close = () => {
    const previous = activeItem.value;
    activeItem.value = null;
    anchorEl.value = null;
    if (previous) options.onClose?.(previous);
  };

  const toggle = (item: T, anchor: HTMLElement | null) => {
    if (options.disabled?.value || !anchor) return;
    if (activeItem.value?.id === item.id) {
      close();
      return;
    }
    activeItem.value = item;
    anchorEl.value = anchor;
    options.onOpen?.(item);
  };

  if (options.disabled) {
    watch(options.disabled, (isDisabled) => {
      if (isDisabled) close();
    });
  }

  return { activeItem, anchorEl, isOpen, toggle, close };
}

/** 以點擊目標所在的整列作為預覽錨點，讓 Popover 對齊整列而不是按鈕。 */
export function rowAnchorFromEvent(event: Event, rowSelector: string): HTMLElement | null {
  const target = event.currentTarget as HTMLElement | null;
  return target?.closest<HTMLElement>(rowSelector) ?? target;
}
