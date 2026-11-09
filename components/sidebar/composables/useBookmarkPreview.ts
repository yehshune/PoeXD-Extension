import { computed, type Ref } from 'vue';
import type { Bookmark } from '../bookmark-types';
import type { PoeVersion } from '@/utils/trade-context';
import {
  useTradeSearchPreview,
  type TradeSearchPreviewData,
  type HoverPreviewData,
} from './useTradeSearchPreview';
import { usePinnedPreview } from './usePinnedPreview';

export type { HoverPreviewData, TradeSearchPreviewData };

export interface UseBookmarkPreviewOptions {
  isDragging?: Ref<boolean>;
  editingBookmarkId?: Ref<string | null>;
  version?: PoeVersion | Ref<PoeVersion>;
  enableBookmarkTooltip?: Ref<boolean>;
}

export function useBookmarkPreview(options?: UseBookmarkPreviewOptions) {
  const isDragging = options?.isDragging;
  const editingBookmarkId = options?.editingBookmarkId;
  const version = options?.version;
  const enableBookmarkTooltip = options?.enableBookmarkTooltip;

  const disabled = computed(
    () =>
      Boolean(isDragging?.value) ||
      Boolean(editingBookmarkId?.value) ||
      (enableBookmarkTooltip !== undefined && !enableBookmarkTooltip.value),
  );

  const {
    activeEntityKey: activeBookmarkId,
    activePreviewData,
    loadPreview,
    clearActivePreview,
    previewCache: bookmarkPreviewCache,
  } = useTradeSearchPreview({
    version,
    disabled,
  });

  const loadBookmarkPreview = async (bm: Bookmark) => {
    return loadPreview(bm.id, bm.url);
  };

  // 單例預覽狀態：以點擊切換開關，同一時間只開一個（見 CONTEXT.md「Search Preview」）
  const {
    activeItem: previewBookmark,
    anchorEl: previewAnchorEl,
    isOpen: isPreviewOpen,
    toggle: toggleBookmarkPreview,
    close: closePreview,
  } = usePinnedPreview<Bookmark>({
    disabled,
    onOpen: (bm) => void loadBookmarkPreview(bm),
    onClose: (bm) => clearActivePreview(bm.id),
  });

  return {
    activeBookmarkId,
    activePreviewData,
    loadBookmarkPreview,
    loadPreview,
    clearActivePreview,
    bookmarkPreviewCache,
    previewCache: bookmarkPreviewCache,
    previewBookmark,
    previewAnchorEl,
    isPreviewOpen,
    toggleBookmarkPreview,
    closePreview,
  };
}
