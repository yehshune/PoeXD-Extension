import { createApp } from 'vue';
import Sidebar from '@/components/Sidebar.vue';
import { listenPoeEvent } from '@/utils/event-contracts';
import type { PreferencesModule } from '@/utils/preferences';
import {
  collectLegacyStorageMigration,
  createVersionedStorageKeys,
  readStorageValue,
} from '@/utils/storage-contracts';
import type { PoeVersion } from '@/utils/trade-context';
import type { TradePageRole } from '@/utils/live-search-contract';
import type { LiveSearchConsoleHandles } from './live-search-primary-session';
import { syncUiRuntimeTokens } from '@/lib/tokens';
import { applyThemeFromPreferences } from '@/lib/theme/theme-runtime';
import { appendShadowHostStyle } from './shadow-host-style';
import { collapsedTabTopCss } from '@/utils/collapsed-tab-position';
import {
  SIDEBAR_INSET_LEFT_ATTR,
  SIDEBAR_INSET_LEFT_VAR,
  SIDEBAR_INSET_RIGHT_ATTR,
  SIDEBAR_INSET_RIGHT_VAR,
  SIDEBAR_LAYOUT_STYLE_ID,
  TOAST_HOST_TAG,
} from '@/utils/sidebar-viewport-insets';

const POEXD_HOST_Z_INDEX = '2147483646';
const LAYOUT_STYLE_ID = SIDEBAR_LAYOUT_STYLE_ID;

interface PageLayoutState {
  collapsed: boolean;
  position: 'left' | 'right';
  width: number;
}

interface ResolvedPageLayoutMetrics {
  pageWidth: string;
  pageMarginLeft: number;
  pageMarginRight: number;
}

function resolvePageLayoutMetrics({
  collapsed,
  position,
  width,
}: PageLayoutState): ResolvedPageLayoutMetrics {
  const pageWidth = collapsed ? '100%' : `calc(100% - ${width}px)`;
  const pageMarginLeft = position === 'left' && !collapsed ? width : 0;
  const pageMarginRight = position === 'right' && !collapsed ? width : 0;
  return {
    pageWidth,
    pageMarginLeft,
    pageMarginRight,
  };
}

/**
 * 官網 `.content` 讓出側邊欄位置的樣式。
 * - 不對 `.content` 套用寬度過場動畫（`transition: none`）：官方市集有上萬 DOM 節點，
 *   逐幀改動寬度會觸發整頁重排與重繪掉幀；僅保留側邊欄自身純 GPU `transform` 滑動動畫。
 * - Toast 邊距變數限定在 `poexd-toast-container` 而非 `:root`，避免改動側欄寬度時觸發整份官方文件樣式重算。
 */
function buildPageLayoutCss(state: PageLayoutState): string {
  const { pageWidth, pageMarginLeft, pageMarginRight } = resolvePageLayoutMetrics(state);
  return `
      ${TOAST_HOST_TAG} {
        ${SIDEBAR_INSET_LEFT_VAR}: ${pageMarginLeft}px;
        ${SIDEBAR_INSET_RIGHT_VAR}: ${pageMarginRight}px;
      }
      .content {
        transition: none !important;
        width: ${pageWidth} !important;
        margin-left: ${pageMarginLeft}px !important;
        margin-right: ${pageMarginRight}px !important;
      }
    `;
}

function syncLayoutInsetAttrs(
  layoutStyle: HTMLStyleElement,
  marginLeft: number,
  marginRight: number,
): void {
  const leftStr = `${marginLeft}`;
  const rightStr = `${marginRight}`;
  if (layoutStyle.getAttribute(SIDEBAR_INSET_LEFT_ATTR) !== leftStr) {
    layoutStyle.setAttribute(SIDEBAR_INSET_LEFT_ATTR, leftStr);
  }
  if (layoutStyle.getAttribute(SIDEBAR_INSET_RIGHT_ATTR) !== rightStr) {
    layoutStyle.setAttribute(SIDEBAR_INSET_RIGHT_ATTR, rightStr);
  }
}

function syncToastHostInsets(marginLeft: number, marginRight: number): void {
  const toastHost = document.querySelector<HTMLElement>(TOAST_HOST_TAG);
  if (!toastHost) return;
  toastHost.style.setProperty(SIDEBAR_INSET_LEFT_VAR, `${marginLeft}px`);
  toastHost.style.setProperty(SIDEBAR_INSET_RIGHT_VAR, `${marginRight}px`);
}

function applyDirectContentLayout(contentEl: HTMLElement, state: PageLayoutState): void {
  const { pageWidth, pageMarginLeft, pageMarginRight } = resolvePageLayoutMetrics(state);
  contentEl.style.setProperty('transition', 'none', 'important');
  contentEl.style.setProperty('width', pageWidth, 'important');
  contentEl.style.setProperty('margin-left', `${pageMarginLeft}px`, 'important');
  contentEl.style.setProperty('margin-right', `${pageMarginRight}px`, 'important');
}

function clearDirectContentLayout(contentEl: HTMLElement | null): void {
  if (!contentEl) return;
  contentEl.style.removeProperty('transition');
  contentEl.style.removeProperty('width');
  contentEl.style.removeProperty('margin-left');
  contentEl.style.removeProperty('margin-right');
}

function ensureLayoutStyle(): HTMLStyleElement {
  let layoutStyle = document.getElementById(LAYOUT_STYLE_ID) as HTMLStyleElement | null;
  if (!layoutStyle) {
    layoutStyle = document.createElement('style');
    layoutStyle.id = LAYOUT_STYLE_ID;
    (document.head || document.documentElement).appendChild(layoutStyle);
  }
  return layoutStyle;
}

async function readSidebarCollapsed(version: PoeVersion): Promise<boolean> {
  const keys = createVersionedStorageKeys(version);
  const data = await chrome.storage.local.get([keys.isCollapsed, 'isCollapsed']);
  return readStorageValue(data, keys.isCollapsed, 'isCollapsed', true);
}

/**
 * 側邊欄掛載前還要等攔截器與頁面角色；先依儲存的位置、寬度與收合狀態讓出版面，
 * 掛載時官方頁面才不會整個位移。回傳移除預留樣式的函式。
 */
export async function reserveSidebarPageLayout(
  version: PoeVersion,
  preferences: PreferencesModule,
  isDisposed = () => false,
): Promise<() => void> {
  const remove = () => document.getElementById(LAYOUT_STYLE_ID)?.remove();
  const collapsed = await readSidebarCollapsed(version);
  if (isDisposed() || document.getElementById(LAYOUT_STYLE_ID)) return remove;
  const prefs = preferences.read();
  const state: PageLayoutState = {
    collapsed,
    position: prefs.sidebarPosition,
    width: prefs.sidebarWidth,
  };
  const layoutStyle = ensureLayoutStyle();
  const metrics = resolvePageLayoutMetrics(state);
  syncLayoutInsetAttrs(layoutStyle, metrics.pageMarginLeft, metrics.pageMarginRight);
  syncToastHostInsets(metrics.pageMarginLeft, metrics.pageMarginRight);
  layoutStyle.textContent = buildPageLayoutCss(state);
  return remove;
}

export interface MountSidebarLayoutOptions {
  pageRole?: TradePageRole;
  liveSearchConsole?: LiveSearchConsoleHandles | null;
}

export async function mountSidebarLayout(
  ctx: any,
  version: PoeVersion,
  preferences: PreferencesModule,
  isDisposed = () => false,
  options: MountSidebarLayoutOptions = {},
) {
  const { pageRole = 'normal', liveSearchConsole = null } = options;
  const keys = createVersionedStorageKeys(version);
  const data = await chrome.storage.local.get([keys.isCollapsed, 'isCollapsed']);
  if (isDisposed()) return;
  const collapsed = readStorageValue(data, keys.isCollapsed, 'isCollapsed', true);
  const migration = collectLegacyStorageMigration(data, [[keys.isCollapsed, 'isCollapsed']]);
  if (Object.keys(migration).length > 0) await chrome.storage.local.set(migration);
  if (isDisposed()) return;

  const layoutStyle = ensureLayoutStyle();
  let styledContentEl: HTMLElement | null = null;

  // 宿主樣式另外注入，讓 WXT 主樣式與 toast 完全相同而共用解析結果（見 shadow-host-style.ts）
  const hostCss = `
      :host {
        display: block !important;
        position: fixed !important;
        overflow: visible !important;
        z-index: ${POEXD_HOST_Z_INDEX} !important;
        top: var(--poexd-host-top, 0px) !important;
        left: var(--poexd-host-left, auto) !important;
        right: var(--poexd-host-right, auto) !important;
        width: var(--poexd-host-width, 380px) !important;
        height: var(--poexd-host-height, 100%) !important;
        pointer-events: var(--poexd-host-pointer-events, auto) !important;
      }
    `;

  const ui = await createShadowRootUi(ctx, {
    name: 'poexd-sidebar-container',
    position: 'inline',
    anchor: 'body',
    onMount: (container: HTMLElement, shadow: ShadowRoot) => {
      appendShadowHostStyle(shadow, hostCss);
      container.style.width = '100%';
      container.style.height = '100%';
      container.style.fontFamily = "'Microsoft JhengHei', '微軟正黑體', sans-serif";
      container.style.color = 'var(--foreground)';
      container.style.fontSize = 'var(--pxd-font-secondary)';
      const appRoot = document.createElement('div');
      appRoot.id = 'poexd-app-root';
      appRoot.style.position = 'relative';
      appRoot.style.zIndex = '0';
      appRoot.style.width = '100%';
      appRoot.style.height = '100%';

      const portalRoot = document.createElement('div');
      portalRoot.id = 'poexd-portal-root';
      portalRoot.style.position = 'relative';
      portalRoot.style.zIndex = '1';
      portalRoot.style.pointerEvents = 'auto';

      container.appendChild(appRoot);
      container.appendChild(portalRoot);

      const app = createApp(Sidebar, {
        portalTarget: portalRoot,
        pageRole,
        liveSearchConsole,
      });
      app.mount(appRoot);
      return { app, appRoot, portalRoot };
    },
    onRemove: (mounted: any) => {
      mounted?.app?.unmount();
      mounted?.appRoot?.remove();
      mounted?.portalRoot?.remove();
      clearDirectContentLayout(styledContentEl);
      styledContentEl = null;
      document.getElementById(LAYOUT_STYLE_ID)?.remove();
    },
  });
  if (isDisposed()) {
    layoutStyle.remove();
    return;
  }
  const wrapper = ui.shadowHost;

  const initialPreferences = preferences.read();
  let currentPosition = initialPreferences.sidebarPosition;
  let width = initialPreferences.sidebarWidth;
  let currentCollapsed = collapsed;
  let collapsedTop = initialPreferences.collapsedTabTop;
  let isModalActive = false;
  let currentScale = initialPreferences.fontSizeScale ?? 1;
  let currentDensity = initialPreferences.densityScale ?? 1;

  const syncUiScalingVariables = (prefs: {
    fontSizeScale?: number;
    densityScale?: number;
    sidebarWidth?: number;
  }) => {
    if (prefs.fontSizeScale !== undefined) {
      currentScale = prefs.fontSizeScale;
    }
    if (prefs.densityScale !== undefined) {
      currentDensity = prefs.densityScale;
    }
    if (prefs.sidebarWidth !== undefined) {
      width = prefs.sidebarWidth;
    }
    syncUiRuntimeTokens(wrapper, {
      scale: currentScale,
      density: currentDensity,
      sidebarWidth: width,
    });
  };
  const updateWrapper = () => {
    if (currentCollapsed) {
      wrapper.style.setProperty('--poexd-host-width', 'var(--pxd-sidebar-collapsed-width)');
      wrapper.style.setProperty('--poexd-host-height', 'var(--control-height-default)');
      wrapper.style.setProperty('--poexd-host-top', collapsedTabTopCss(collapsedTop));
      wrapper.style.setProperty('--poexd-host-pointer-events', 'none');
    } else {
      wrapper.style.setProperty('--poexd-host-width', `${width}px`);
      wrapper.style.setProperty('--poexd-host-height', '100%');
      wrapper.style.setProperty('--poexd-host-top', '0px');
      wrapper.style.setProperty('--poexd-host-pointer-events', 'auto');
    }
    wrapper.style.setProperty('--poexd-host-left', currentPosition === 'left' ? '0px' : 'auto');
    wrapper.style.setProperty('--poexd-host-right', currentPosition === 'right' ? '0px' : 'auto');
  };
  let isResizing = false;
  let appliedLayoutCss = layoutStyle.textContent ?? '';
  /** 同值不重寫：改 <style> 文字會讓整份官方文件重新解析與重算樣式 */
  const writeLayoutCss = (state: PageLayoutState) => {
    const css = buildPageLayoutCss(state);
    if (css === appliedLayoutCss) return;
    layoutStyle.textContent = css;
    appliedLayoutCss = css;
  };
  const updatePageLayout = () => {
    const state: PageLayoutState = {
      collapsed: currentCollapsed,
      position: currentPosition,
      width,
    };
    const metrics = resolvePageLayoutMetrics(state);
    syncLayoutInsetAttrs(layoutStyle, metrics.pageMarginLeft, metrics.pageMarginRight);
    syncToastHostInsets(metrics.pageMarginLeft, metrics.pageMarginRight);

    const contentEl = document.querySelector<HTMLElement>('.content');
    if (!contentEl) {
      writeLayoutCss(state);
      return;
    }

    styledContentEl = contentEl;
    applyDirectContentLayout(contentEl, state);
    // 拖曳寬度期間只寫 inline（熱路徑）；拖曳結束、收合、換邊等低頻事件時同步 <style> 當備援，
    // 避免官方重建 .content 讓 inline 消失後套到預留版面時的過期寬度
    if (!isResizing) writeLayoutCss(state);
  };
  const updateLayout = () => {
    updateWrapper();
    updatePageLayout();
  };

  applyThemeFromPreferences(wrapper, initialPreferences);
  syncUiScalingVariables(initialPreferences);
  updateLayout();
  ui.mount();
  const stopPreferences = preferences.subscribe((snapshot) => {
    applyThemeFromPreferences(wrapper, snapshot);
    currentPosition = snapshot.sidebarPosition;
    width = snapshot.sidebarWidth;
    collapsedTop = snapshot.collapsedTabTop;
    syncUiScalingVariables(snapshot);
    updateLayout();
  });
  listenPoeEvent('poexd-sidebar-collapsed-changed', (detail) => {
    currentCollapsed = detail;
    updateLayout();
  });
  listenPoeEvent('poexd-sidebar-collapsed-top-preview', (previewTop) => {
    collapsedTop = previewTop;
    if (!isModalActive) updateWrapper();
  });
  listenPoeEvent('poexd-sidebar-resizing-changed', (resizing) => {
    isResizing = resizing;
    if (!resizing) {
      syncUiScalingVariables({ sidebarWidth: width });
    }
    updatePageLayout();
  });
  listenPoeEvent('poexd-sidebar-width-preview', (previewWidth) => {
    width = previewWidth;
    if (!isResizing) {
      syncUiScalingVariables({ sidebarWidth: width });
    }
    updateLayout();
  });
  listenPoeEvent('poexd-modal-active-changed', (active) => {
    isModalActive = active;
    if (active) {
      wrapper.style.setProperty('--poexd-host-width', '100%');
      wrapper.style.setProperty('--poexd-host-height', '100%');
      wrapper.style.setProperty('--poexd-host-top', '0px');
      wrapper.style.setProperty('--poexd-host-left', '0px');
      wrapper.style.setProperty('--poexd-host-right', '0px');
      wrapper.style.setProperty('--poexd-host-pointer-events', 'auto');
      return;
    }

    updateWrapper();
  });
  return stopPreferences;
}
