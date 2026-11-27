/**
 * 找相似面板（ADR-0020）的 shadow host：浮在觸發的結果列附近，狀態全部來自工作階段。
 * 樣式與主題跟提示框（toast-host.ts）同一套做法。
 */
import { createApp, h, shallowRef, type App } from 'vue';
import { ConfigProvider } from 'reka-ui';
import SimilarSearchPanel from '@/components/similar-search/SimilarSearchPanel.vue';
import { applyThemeToHost, type ThemeOverridesInput } from '@/lib/theme/theme-runtime';
import { DEFAULT_THEME_ID } from '@/lib/theme/theme-contract';
import { syncUiRuntimeTokens } from '@/lib/tokens';
import type { PoeVersion } from '@/utils/trade-context';
import { appendShadowHostStyle } from './shadow-host-style';
import {
  HOME_BATCH_KEY,
  type SimilarPanelAnchor,
  type SimilarSearchSession,
  type SimilarSessionState,
} from './similar-search-session';

export const SIMILAR_PANEL_HOST_TAG = 'poexd-similar-search-panel';

export interface SimilarPanelAppearance {
  theme?: unknown;
  themeCustomOverrides?: unknown;
  fontSizeScale?: number;
  densityScale?: number;
}

export interface SimilarPanelHost {
  syncAppearance(appearance: SimilarPanelAppearance): void;
  dispose(): void;
}

const GAP = 6;
const MARGIN = 8;
const PANEL_WIDTH = 440;
const MIN_VISIBLE_HEIGHT = 360;

const HOST_CSS = `
  :host {
    display: block !important;
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    width: 0 !important;
    height: 0 !important;
    overflow: visible !important;
    z-index: 2147483000 !important;
  }
`;

/** 面板放在列的下方；下方空間不夠時往上移，左右不超出視窗 */
export function panelPosition(
  anchor: SimilarPanelAnchor,
  viewport: { width: number; height: number },
): { top: number; left: number } {
  const top = Math.max(MARGIN, Math.min(anchor.bottom + GAP, viewport.height - MIN_VISIBLE_HEIGHT));
  const left = Math.max(MARGIN, Math.min(anchor.left, viewport.width - PANEL_WIDTH - MARGIN));
  return { top, left };
}

interface MountedPanel {
  app: App;
  host: HTMLElement;
  remove(): void;
}

export function mountSimilarSearchPanelHost(input: {
  ctx: unknown;
  version: PoeVersion;
  session: SimilarSearchSession;
}): SimilarPanelHost {
  const { session, version } = input;
  const state = shallowRef<SimilarSessionState>(session.getState());
  const portal = shallowRef<HTMLElement | null>(null);
  let appearance: SimilarPanelAppearance = {};
  let mounted: MountedPanel | null = null;
  let disposed = false;

  const applyAppearance = () => {
    if (!mounted) return;
    applyThemeToHost(
      mounted.host,
      appearance.theme ?? DEFAULT_THEME_ID,
      appearance.themeCustomOverrides as ThemeOverridesInput,
    );
    syncUiRuntimeTokens(mounted.host, {
      scale: appearance.fontSizeScale ?? 1,
      density: appearance.densityScale ?? 1,
    });
  };

  const render = () => {
    const current = state.value;
    if (!current.open || !current.anchor) return null;
    const { top, left } = panelPosition(current.anchor, {
      width: window.innerWidth,
      height: window.innerHeight,
    });
    return h(ConfigProvider, { teleportTo: portal.value ?? undefined, scrollBody: false }, () =>
      h('div', { style: { position: 'fixed', top: `${top}px`, left: `${left}px` } }, [
        h(SimilarSearchPanel, {
          state: current,
          version,
          homeKey: HOME_BATCH_KEY,
          onUpdateDraft: (update: Parameters<SimilarSearchSession['updateDraft']>[0]) =>
            session.updateDraft(update),
          onStart: () => void session.start(),
          onActivate: (key: string) => void session.activate(key),
          onBack: () => void session.backToMySearch(),
          onClose: () => void session.close(),
        }),
      ]),
    );
  };

  const onMount = (container: HTMLElement, shadow: ShadowRoot, host: HTMLElement) => {
    appendShadowHostStyle(shadow, HOST_CSS);
    container.style.fontFamily = "'Microsoft JhengHei', '微軟正黑體', sans-serif";
    container.style.color = 'var(--foreground)';
    const portalTarget = document.createElement('div');
    shadow.appendChild(portalTarget);
    portal.value = portalTarget;
    const app = createApp({ setup: () => render });
    app.mount(container);
    return { app, host };
  };

  const stopState = session.subscribe((next) => {
    state.value = next;
  });

  void mountPanel(input.ctx, onMount).then((panel) => {
    if (disposed) {
      panel?.remove();
      return;
    }
    mounted = panel;
    applyAppearance();
  });

  return {
    syncAppearance(next) {
      appearance = { ...appearance, ...next };
      applyAppearance();
    },
    dispose() {
      disposed = true;
      stopState();
      mounted?.remove();
      mounted = null;
    },
  };
}

type OnMount = (
  container: HTMLElement,
  shadow: ShadowRoot,
  host: HTMLElement,
) => { app: App; host: HTMLElement };

async function mountPanel(ctx: unknown, onMount: OnMount): Promise<MountedPanel | null> {
  if (typeof document === 'undefined') return null;
  if (typeof createShadowRootUi === 'function' && ctx) {
    let app: App | null = null;
    const ui = await createShadowRootUi(ctx as Parameters<typeof createShadowRootUi>[0], {
      name: SIMILAR_PANEL_HOST_TAG,
      position: 'inline',
      anchor: 'body',
      onMount: (container, shadow, host) => {
        app = onMount(container, shadow, host).app;
      },
      onRemove: () => app?.unmount(),
    });
    ui.mount();
    return { app: app!, host: ui.shadowHost, remove: () => ui.remove() };
  }
  const host = document.createElement(SIMILAR_PANEL_HOST_TAG);
  const shadow = host.attachShadow({ mode: 'open' });
  const container = document.createElement('div');
  shadow.appendChild(container);
  document.body.appendChild(host);
  const { app } = onMount(container, shadow, host);
  return {
    app,
    host,
    remove: () => {
      app.unmount();
      host.remove();
    },
  };
}
