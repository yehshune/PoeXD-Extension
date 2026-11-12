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
import type { LiveSearchPrimaryController, TradePageRole } from '@/utils/live-search-contract';
import type { LiveSearchBookmarkController } from './live-search-bookmark-controller';
import type { LiveSearchResumeController } from './live-search-resume-controller';
import { syncUiRuntimeTokens } from '@/lib/tokens';
import { applyThemeToHost } from '@/lib/theme/theme-runtime';
import { appendShadowHostStyle } from './shadow-host-style';

const POEXD_HOST_Z_INDEX = '2147483647';

export async function mountSidebarLayout(
  ctx: any,
  version: PoeVersion,
  preferences: PreferencesModule,
  isDisposed = () => false,
  pageRole: TradePageRole = 'normal',
  liveSearchController?: LiveSearchPrimaryController | null,
  liveSearchBookmarkController?: LiveSearchBookmarkController | null,
  liveSearchResumeController?: LiveSearchResumeController | null,
  initialArrivalSignal: boolean = false,
) {
  const keys = createVersionedStorageKeys(version);
  const data = await chrome.storage.local.get([keys.isCollapsed, 'isCollapsed']);
  if (isDisposed()) return;
  const collapsed = readStorageValue(data, keys.isCollapsed, 'isCollapsed', true);
  const migration = collectLegacyStorageMigration(data, [[keys.isCollapsed, 'isCollapsed']]);
  if (Object.keys(migration).length > 0) await chrome.storage.local.set(migration);
  if (isDisposed()) return;

  let layoutStyle = document.getElementById('poexd-layout-style') as HTMLStyleElement | null;
  if (!layoutStyle) {
    layoutStyle = document.createElement('style');
    layoutStyle.id = 'poexd-layout-style';
    (document.head || document.documentElement).appendChild(layoutStyle);
  }

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
        height: var(--poexd-host-height, 100vh) !important;
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

      container.appendChild(appRoot);
      container.appendChild(portalRoot);

      const app = createApp(Sidebar, {
        portalTarget: portalRoot,
        pageRole,
        liveSearchController,
        liveSearchBookmarkController,
        liveSearchResumeController,
        initialArrivalSignal,
      });
      app.mount(appRoot);
      return { app, appRoot, portalRoot };
    },
    onRemove: (mounted: any) => {
      mounted?.app?.unmount();
      mounted?.appRoot?.remove();
      mounted?.portalRoot?.remove();
      document.getElementById('poexd-layout-style')?.remove();
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
      wrapper.style.setProperty('--poexd-host-top', '100px');
    } else {
      wrapper.style.setProperty('--poexd-host-width', `${width}px`);
      wrapper.style.setProperty('--poexd-host-height', '100vh');
      wrapper.style.setProperty('--poexd-host-top', '0px');
    }
    wrapper.style.setProperty('--poexd-host-left', currentPosition === 'left' ? '0px' : 'auto');
    wrapper.style.setProperty('--poexd-host-right', currentPosition === 'right' ? '0px' : 'auto');
  };
  let isResizing = false;
  const updatePageLayout = () => {
    const pageWidth = currentCollapsed ? '100%' : `calc(100% - ${width}px)`;
    const pageMarginLeft = currentPosition === 'left' && !currentCollapsed ? width : 0;
    const pageMarginRight = currentPosition === 'right' && !currentCollapsed ? width : 0;
    const transitionProperty = isResizing
      ? 'transition: none !important;'
      : 'transition: width 0.15s ease, margin-left 0.15s ease, margin-right 0.15s ease !important;';
    layoutStyle.textContent = `
      .content {
        ${transitionProperty}
        width: ${pageWidth} !important;
        margin-left: ${pageMarginLeft}px !important;
        margin-right: ${pageMarginRight}px !important;
      }
    `;
  };
  const updateLayout = () => {
    updateWrapper();
    updatePageLayout();
  };

  applyThemeToHost(wrapper, initialPreferences.theme);
  syncUiScalingVariables(initialPreferences);
  updateLayout();
  ui.mount();
  const stopPreferences = preferences.subscribe((snapshot) => {
    applyThemeToHost(wrapper, snapshot.theme);
    currentPosition = snapshot.sidebarPosition;
    width = snapshot.sidebarWidth;
    syncUiScalingVariables(snapshot);
    updateLayout();
  });
  listenPoeEvent('poexd-sidebar-collapsed-changed', (detail) => {
    currentCollapsed = detail;
    updateLayout();
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
    if (active) {
      wrapper.style.setProperty('--poexd-host-width', '100vw');
      wrapper.style.setProperty('--poexd-host-height', '100vh');
      wrapper.style.setProperty('--poexd-host-top', '0px');
      wrapper.style.setProperty('--poexd-host-left', '0px');
      wrapper.style.setProperty('--poexd-host-right', '0px');
      return;
    }

    updateWrapper();
  });
  return stopPreferences;
}
