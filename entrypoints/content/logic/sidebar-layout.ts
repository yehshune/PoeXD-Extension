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
  SIDEBAR_LAYOUT_TRANSITION_EASING,
  SIDEBAR_LAYOUT_TRANSITION_MS,
} from '@/utils/sidebar-motion';
import {
  SIDEBAR_INSET_LEFT_VAR,
  SIDEBAR_INSET_RIGHT_VAR,
  SIDEBAR_LAYOUT_STYLE_ID,
} from '@/utils/sidebar-viewport-insets';

const POEXD_HOST_Z_INDEX = '2147483646';
const LAYOUT_STYLE_ID = SIDEBAR_LAYOUT_STYLE_ID;

interface PageLayoutState {
  collapsed: boolean;
  position: 'left' | 'right';
  width: number;
  /** 拖曳寬度時不加過場動畫；預留版面時也不加，避免頁面剛渲染就滑動 */
  animate: boolean;
}

/** 官網 `.content` 讓出側邊欄位置的樣式 */
function buildPageLayoutCss({ collapsed, position, width, animate }: PageLayoutState): string {
  const pageWidth = collapsed ? '100%' : `calc(100% - ${width}px)`;
  const pageMarginLeft = position === 'left' && !collapsed ? width : 0;
  const pageMarginRight = position === 'right' && !collapsed ? width : 0;
  const timing = `${SIDEBAR_LAYOUT_TRANSITION_MS / 1000}s ${SIDEBAR_LAYOUT_TRANSITION_EASING}`;
  const transitionProperty = animate
    ? `transition: width ${timing}, margin-left ${timing}, margin-right ${timing} !important;`
    : 'transition: none !important;';
  return `
      :root {
        ${SIDEBAR_INSET_LEFT_VAR}: ${pageMarginLeft}px;
        ${SIDEBAR_INSET_RIGHT_VAR}: ${pageMarginRight}px;
      }
      .content {
        ${transitionProperty}
        width: ${pageWidth} !important;
        margin-left: ${pageMarginLeft}px !important;
        margin-right: ${pageMarginRight}px !important;
      }
    `;
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
  ensureLayoutStyle().textContent = buildPageLayoutCss({
    collapsed,
    position: prefs.sidebarPosition,
    width: prefs.sidebarWidth,
    animate: false,
  });
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
  const updatePageLayout = () => {
    layoutStyle.textContent = buildPageLayoutCss({
      collapsed: currentCollapsed,
      position: currentPosition,
      width,
      animate: !isResizing,
    });
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
    updatePageLayout();
  });
  listenPoeEvent('poexd-sidebar-width-preview', (previewWidth) => {
    width = previewWidth;
    syncUiScalingVariables({ sidebarWidth: width });
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
