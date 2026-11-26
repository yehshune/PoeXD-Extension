import { computed, onUnmounted, ref, watch, type Ref } from 'vue';
import { createUiRuntimeTokenValues } from '@/lib/tokens';
import {
  COLLAPSED_TAB_DRAG_THRESHOLD,
  COLLAPSED_TAB_KEYBOARD_STEP,
  clampCollapsedTabTop,
  collapsedTabTopCss,
} from '@/utils/collapsed-tab-position';
import { dispatchPoeEvent } from '@/utils/event-contracts';
import { DEFAULT_PREFERENCES, type PreferencesModule } from '@/utils/preferences';
import { SIDEBAR_WIDTH_BOUNDS } from '@/utils/preferences-contract';

export interface UseSidebarGeometryOptions {
  isCollapsed: Ref<boolean>;
  sidebarPosition: Ref<'left' | 'right'>;
  sidebarWidth: Ref<number>;
  fontSizeScale: Ref<number>;
  previewFontSizeScale: Ref<number | null>;
  densityScale: Ref<number>;
  getPreferencesModule: () => PreferencesModule | undefined;
  onExpandFromTab: () => void;
}

export function useSidebarGeometry({
  isCollapsed,
  sidebarPosition,
  sidebarWidth,
  fontSizeScale,
  previewFontSizeScale,
  densityScale,
  getPreferencesModule,
  onExpandFromTab,
}: UseSidebarGeometryOptions) {
  const actualWidth = computed(() => sidebarWidth.value);
  const isResizing = ref(false);
  /** 拖曳寬度期間暫緩重算 40+ 個 CSS 變數，避免每幀讓側欄 Shadow DOM 內上萬節點樣式失效 */
  const tokenSidebarWidth = ref(sidebarWidth.value);

  watch(sidebarWidth, (nextWidth) => {
    if (!isResizing.value) {
      tokenSidebarWidth.value = nextWidth;
    }
  });

  const runtimeTokens = computed(() => {
    return createUiRuntimeTokenValues({
      scale: previewFontSizeScale.value ?? fontSizeScale.value,
      density: densityScale.value,
      sidebarWidth: tokenSidebarWidth.value,
    });
  });

  const isResizable = computed(() => !isCollapsed.value);

  let isDragging = false;
  let startX = 0;
  let startVisualWidth = 0;
  let resizeRafId: number | null = null;
  let pendingVisualWidth: number | null = null;

  const applyResizeWidth = (visualWidth: number) => {
    sidebarWidth.value = visualWidth;
    dispatchPoeEvent('poexd-sidebar-width-preview', visualWidth);
  };

  const handleResizeMove = (e: MouseEvent) => {
    if (!isDragging) return;
    const deltaX = e.clientX - startX;
    const diff = sidebarPosition.value === 'left' ? deltaX : -deltaX;
    let visualWidth = Math.round(startVisualWidth + diff);
    if (visualWidth < SIDEBAR_WIDTH_BOUNDS.min) visualWidth = SIDEBAR_WIDTH_BOUNDS.min;
    if (visualWidth > SIDEBAR_WIDTH_BOUNDS.max) visualWidth = SIDEBAR_WIDTH_BOUNDS.max;

    pendingVisualWidth = visualWidth;
    if (resizeRafId === null) {
      resizeRafId = window.requestAnimationFrame(() => {
        resizeRafId = null;
        if (pendingVisualWidth !== null && isDragging) {
          applyResizeWidth(pendingVisualWidth);
        }
      });
    }
  };

  const handleResizeEnd = () => {
    if (!isDragging) return;
    isDragging = false;
    isResizing.value = false;
    if (resizeRafId !== null) {
      window.cancelAnimationFrame(resizeRafId);
      resizeRafId = null;
    }
    if (pendingVisualWidth !== null) {
      applyResizeWidth(pendingVisualWidth);
      pendingVisualWidth = null;
    }
    tokenSidebarWidth.value = sidebarWidth.value;
    dispatchPoeEvent('poexd-sidebar-resizing-changed', false);
    window.removeEventListener('mousemove', handleResizeMove);
    window.removeEventListener('mouseup', handleResizeEnd);
    document.body.style.removeProperty('user-select');
    document.body.style.removeProperty('cursor');

    void getPreferencesModule()?.update({
      sidebarWidth: sidebarWidth.value,
    });
  };

  const handleResizeStart = (e: MouseEvent) => {
    if (!isResizable.value) return;
    isDragging = true;
    isResizing.value = true;
    startX = e.clientX;
    startVisualWidth = actualWidth.value;
    pendingVisualWidth = startVisualWidth;
    dispatchPoeEvent('poexd-sidebar-resizing-changed', true);
    window.addEventListener('mousemove', handleResizeMove);
    window.addEventListener('mouseup', handleResizeEnd);
    document.body.style.setProperty('user-select', 'none');
    document.body.style.setProperty('cursor', 'col-resize');
  };

  // 收合標籤：沿面板所在側邊上下拖曳；移動未超過門檻時仍視為點擊展開
  const collapsedTabTop = ref(DEFAULT_PREFERENCES.collapsedTabTop);
  const collapsedTabTopStyle = computed(() => collapsedTabTopCss(collapsedTabTop.value));
  const isCollapsedTabDragging = ref(false);
  let collapsedTabDrag: {
    pointerId: number;
    startY: number;
    startTop: number;
    tabHeight: number;
  } | null = null;
  let suppressCollapsedTabClick = false;

  const previewCollapsedTabTop = (top: number) => {
    collapsedTabTop.value = top;
    dispatchPoeEvent('poexd-sidebar-collapsed-top-preview', top);
  };

  const commitCollapsedTabTop = (top: number) => {
    previewCollapsedTabTop(top);
    void getPreferencesModule()
      ?.update({ collapsedTabTop: top })
      .then((outcome) => {
        if (!outcome.ok) console.error('[PoeXD Sidebar] 無法儲存收合標籤位置:', outcome.error);
      });
  };

  const readCollapsedTabMetrics = (el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    // 尚未完成排版（height <= 0）時退回目前儲存的位置與預設高度
    return {
      top: rect.height > 0 ? rect.top : collapsedTabTop.value,
      height: rect.height > 0 ? rect.height : 32,
    };
  };

  watch(isCollapsed, (collapsed) => {
    if (collapsed) return;
    collapsedTabDrag = null;
    if (isCollapsedTabDragging.value) {
      isCollapsedTabDragging.value = false;
      previewCollapsedTabTop(
        getPreferencesModule()?.read().collapsedTabTop ?? collapsedTabTop.value,
      );
    }
  });

  const handleCollapsedTabPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || !e.isPrimary) return;
    const { top, height } = readCollapsedTabMetrics(e.currentTarget as HTMLElement);
    // 從實際顯示位置起算：儲存值可能因視窗變小而被 CSS clamp 過
    collapsedTabDrag = {
      pointerId: e.pointerId,
      startY: e.clientY,
      startTop: top,
      tabHeight: height,
    };
    suppressCollapsedTabClick = false;
  };

  const handleCollapsedTabPointerMove = (e: PointerEvent) => {
    const drag = collapsedTabDrag;
    if (!drag || e.pointerId !== drag.pointerId) return;
    const deltaY = e.clientY - drag.startY;
    if (!isCollapsedTabDragging.value) {
      if (Math.abs(deltaY) < COLLAPSED_TAB_DRAG_THRESHOLD) return;
      isCollapsedTabDragging.value = true;
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    }
    previewCollapsedTabTop(
      clampCollapsedTabTop(drag.startTop + deltaY, window.innerHeight, drag.tabHeight),
    );
  };

  const finishCollapsedTabDrag = (e: PointerEvent, commit: boolean) => {
    const drag = collapsedTabDrag;
    if (!drag || e.pointerId !== drag.pointerId) return;
    collapsedTabDrag = null;
    if (!isCollapsedTabDragging.value) return;
    const target = e.currentTarget as HTMLElement;
    if (target.hasPointerCapture?.(e.pointerId)) {
      target.releasePointerCapture?.(e.pointerId);
    }
    isCollapsedTabDragging.value = false;
    if (commit) {
      // 拖曳結束後瀏覽器仍會送出 click，擋掉這一次避免誤觸展開
      suppressCollapsedTabClick = true;
      setTimeout(() => {
        suppressCollapsedTabClick = false;
      }, 0);
      commitCollapsedTabTop(collapsedTabTop.value);
    } else {
      previewCollapsedTabTop(getPreferencesModule()?.read().collapsedTabTop ?? drag.startTop);
    }
  };

  const handleCollapsedTabPointerUp = (e: PointerEvent) => finishCollapsedTabDrag(e, true);
  const handleCollapsedTabPointerCancel = (e: PointerEvent) => finishCollapsedTabDrag(e, false);

  const handleCollapsedTabClick = () => {
    if (suppressCollapsedTabClick) {
      suppressCollapsedTabClick = false;
      return;
    }
    onExpandFromTab();
  };

  /** Alt + ↑/↓ 以鍵盤調整收合標籤位置 */
  const handleCollapsedTabKeydown = (e: KeyboardEvent) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const { top: currentTop, height: tabHeight } = readCollapsedTabMetrics(
      e.currentTarget as HTMLElement,
    );
    const step = e.key === 'ArrowUp' ? -COLLAPSED_TAB_KEYBOARD_STEP : COLLAPSED_TAB_KEYBOARD_STEP;
    commitCollapsedTabTop(clampCollapsedTabTop(currentTop + step, window.innerHeight, tabHeight));
  };

  onUnmounted(() => {
    if (resizeRafId !== null) {
      window.cancelAnimationFrame(resizeRafId);
      resizeRafId = null;
    }
    if (isDragging) {
      window.removeEventListener('mousemove', handleResizeMove);
      window.removeEventListener('mouseup', handleResizeEnd);
      document.body.style.removeProperty('user-select');
      document.body.style.removeProperty('cursor');
    }
  });

  return {
    actualWidth,
    runtimeTokens,
    isResizable,
    handleResizeStart,
    collapsedTabTop,
    collapsedTabTopStyle,
    isCollapsedTabDragging,
    previewCollapsedTabTop,
    handleCollapsedTabPointerDown,
    handleCollapsedTabPointerMove,
    handleCollapsedTabPointerUp,
    handleCollapsedTabPointerCancel,
    handleCollapsedTabClick,
    handleCollapsedTabKeydown,
  };
}
