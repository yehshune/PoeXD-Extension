import { createApp, h, reactive } from 'vue';
import ToastHost from '@/components/ToastHost.vue';
import { listenPoeEvent, type PoeToastDetail } from '@/utils/event-contracts';
import { applyThemeToHost } from '@/lib/theme/theme-runtime';
import { DEFAULT_THEME_ID, THEME_ATTRIBUTE } from '@/lib/theme/theme-contract';
import { findThemeHost } from '@/lib/theme/page-theme-bridge';
import { syncUiRuntimeTokens } from '@/lib/tokens';
import { appendShadowHostStyle } from './shadow-host-style';

const DEFAULT_TOAST_DURATION = 3000;

export interface ToastHostState {
  message: string;
  tone: 'default' | 'success' | 'error';
  visible: boolean;
}

export interface ToastPreferencesSnapshot {
  theme?: unknown;
  fontSizeScale?: number;
  densityScale?: number;
}

let activeHostCleanup: (() => void) | null = null;
let activeToastShadowRoot: ShadowRoot | null = null;
let shadowHost: HTMLElement | null = null;

let currentTheme: unknown = DEFAULT_THEME_ID;
let currentScale = 1;
let currentDensity = 1;

export function getToastShadowRoot(): ShadowRoot | null {
  return activeToastShadowRoot;
}

export function syncToastPreferences(prefs: ToastPreferencesSnapshot): void {
  if (prefs.theme !== undefined) {
    currentTheme = prefs.theme;
  }
  if (prefs.fontSizeScale !== undefined) {
    currentScale = prefs.fontSizeScale;
  }
  if (prefs.densityScale !== undefined) {
    currentDensity = prefs.densityScale;
  }

  if (shadowHost) {
    applyThemeToHost(shadowHost, currentTheme);
    syncUiRuntimeTokens(shadowHost, {
      scale: currentScale,
      density: currentDensity,
    });
  }
}

export function initToastHost(
  ctx?: any,
  preferences?: {
    read: () => ToastPreferencesSnapshot;
    subscribe?: (fn: (snap: any) => void) => () => void;
  },
): () => void {
  if (activeHostCleanup) {
    return activeHostCleanup;
  }

  let disposed = false;
  let toastUi: any = null;
  let vueApp: any = null;
  let themeObserver: MutationObserver | null = null;
  let stopPreferencesSub: (() => void) | null = null;

  if (preferences && typeof preferences.read === 'function') {
    syncToastPreferences(preferences.read());
    if (typeof preferences.subscribe === 'function') {
      stopPreferencesSub = preferences.subscribe((snapshot) => {
        if (!disposed) {
          syncToastPreferences(snapshot);
        }
      });
    }
  }

  const state = reactive<ToastHostState>({
    message: '',
    tone: 'default',
    visible: false,
  });

  let activeTimer: ReturnType<typeof setTimeout> | null = null;

  const hideToast = () => {
    if (activeTimer) {
      clearTimeout(activeTimer);
      activeTimer = null;
    }
    state.visible = false;
  };

  const showToast = (detail: PoeToastDetail) => {
    if (typeof document === 'undefined') return;

    const tone = detail.tone ?? 'default';
    const duration = detail.durationMs !== undefined ? detail.durationMs : DEFAULT_TOAST_DURATION;

    // Clear old timer for latest message replacement
    if (activeTimer) {
      clearTimeout(activeTimer);
      activeTimer = null;
    }

    state.message = detail.message;
    state.tone = tone;
    state.visible = true;

    if (duration > 0) {
      activeTimer = setTimeout(() => {
        hideToast();
      }, duration);
    }
  };

  const hostCss = `
    :host {
      display: block !important;
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      width: 100vw !important;
      height: 0 !important;
      overflow: visible !important;
      z-index: 2147483647 !important;
      pointer-events: none !important;
    }
  `;

  const onMount = (container: HTMLElement, shadow?: ShadowRoot, host?: HTMLElement) => {
    container.style.fontFamily = "'Microsoft JhengHei', '微軟正黑體', sans-serif";
    container.style.color = 'var(--foreground)';

    vueApp = createApp({
      setup() {
        return () =>
          h(ToastHost, {
            message: state.message,
            tone: state.tone,
            visible: state.visible,
          });
      },
    });
    vueApp.mount(container);

    if (shadow) {
      activeToastShadowRoot = shadow;
    }
    if (host) {
      shadowHost = host;
      const initialTheme =
        currentTheme ?? findThemeHost()?.getAttribute(THEME_ATTRIBUTE) ?? DEFAULT_THEME_ID;
      applyThemeToHost(host, initialTheme);
      syncUiRuntimeTokens(host, {
        scale: currentScale,
        density: currentDensity,
      });

      if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
        themeObserver = new MutationObserver(() => {
          const docTheme = findThemeHost()?.getAttribute(THEME_ATTRIBUTE);
          if (docTheme && host.getAttribute(THEME_ATTRIBUTE) !== docTheme) {
            applyThemeToHost(host, docTheme);
          }
        });
        themeObserver.observe(document.documentElement, {
          attributes: true,
          subtree: true,
          attributeFilter: [THEME_ATTRIBUTE],
        });
      }
    }
  };

  const mountToastUi = async () => {
    if (typeof document === 'undefined') return;

    if (typeof createShadowRootUi === 'function' && ctx) {
      const ui = await createShadowRootUi(ctx, {
        name: 'poexd-toast-container',
        position: 'inline',
        anchor: 'body',
        onMount: (container: HTMLElement, shadow: ShadowRoot, host: HTMLElement) => {
          if (disposed) return;
          // 宿主樣式另外注入，讓 WXT 主樣式與側欄完全相同而共用解析結果（見 shadow-host-style.ts）
          appendShadowHostStyle(shadow, hostCss);
          return onMount(container, shadow, host);
        },
        onRemove: () => {
          vueApp?.unmount();
          vueApp = null;
        },
      });

      if (disposed) {
        return;
      }

      toastUi = ui;
      shadowHost = ui.shadowHost;
      ui.mount();
    } else {
      if (disposed) return;
      const host = document.createElement('poexd-toast-container');
      const shadow = host.attachShadow({ mode: 'open' });
      activeToastShadowRoot = shadow;
      const container = document.createElement('div');
      shadow.appendChild(container);
      shadowHost = host;
      document.body.appendChild(host);
      onMount(container, shadow, host);
    }
  };

  void mountToastUi();

  const removeListener = listenPoeEvent('poexd-toast', showToast);

  const cleanup = () => {
    disposed = true;
    removeListener();
    hideToast();
    stopPreferencesSub?.();
    stopPreferencesSub = null;
    themeObserver?.disconnect();
    themeObserver = null;

    if (toastUi) {
      toastUi.remove();
      toastUi = null;
      shadowHost = null;
    } else {
      if (vueApp) {
        vueApp.unmount();
        vueApp = null;
      }
      if (shadowHost) {
        shadowHost.remove();
        shadowHost = null;
      }
    }

    activeToastShadowRoot = null;
    activeHostCleanup = null;
  };

  activeHostCleanup = cleanup;
  return cleanup;
}
