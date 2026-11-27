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
/** 一側至少要有這麼高才往那一側開，否則佔滿視窗高度 */
const MIN_COMFORT_HEIGHT = 360;
/** 空間再多，面板也不超過這個高度 */
const PANEL_MAX_HEIGHT = 720;

const HOST_CSS = `
  :host {
    display: block !important;
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    width: 0 !important;
    height: 0 !important;
    overflow: visible !important;
    z-index: 2147483647 !important;
  }
`;

export type SimilarPanelPlacement = { left: number; maxHeight: number } & (
  | { top: number }
  | { bottom: number }
);

/**
 * 面板放在列的下方；下方放不下時往上開、貼齊列的上緣；兩邊都放不下時佔滿視窗高度。
 * 最大高度就是那一側的可用空間，內容在面板裡捲動，不會超出視窗。
 */
export function panelPosition(
  anchor: SimilarPanelAnchor,
  viewport: { width: number; height: number },
): SimilarPanelPlacement {
  const left = Math.max(MARGIN, Math.min(anchor.left, viewport.width - PANEL_WIDTH - MARGIN));
  const below = viewport.height - anchor.bottom - GAP - MARGIN;
  if (below >= MIN_COMFORT_HEIGHT) return { top: anchor.bottom + GAP, left, maxHeight: below };
  const above = anchor.top - GAP - MARGIN;
  if (above >= MIN_COMFORT_HEIGHT) {
    return { bottom: viewport.height - anchor.top + GAP, left, maxHeight: above };
  }
  return { top: MARGIN, left, maxHeight: viewport.height - MARGIN * 2 };
}

function placementStyle(placement: SimilarPanelPlacement): Record<string, string> {
  const [edge, offset] = 'top' in placement ? ['top', placement.top] : ['bottom', placement.bottom];
  return { position: 'fixed', left: `${placement.left}px`, [edge]: `${offset}px` };
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
  const viewport = shallowRef({ width: window.innerWidth, height: window.innerHeight });
  const onResize = () => {
    viewport.value = { width: window.innerWidth, height: window.innerHeight };
  };
  window.addEventListener('resize', onResize);
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
    const placement = panelPosition(current.anchor, viewport.value);
    return h(ConfigProvider, { teleportTo: portal.value ?? undefined, scrollBody: false }, () =>
      h('div', { style: placementStyle(placement) }, [
        h(SimilarSearchPanel, {
          state: current,
          maxHeight: Math.min(placement.maxHeight, PANEL_MAX_HEIGHT),
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
      window.removeEventListener('resize', onResize);
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
