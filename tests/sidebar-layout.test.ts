// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createUiRuntimeTokenValues } from '@/lib/tokens';
import {
  mountSidebarLayout,
  reserveSidebarPageLayout,
} from '@/entrypoints/content/logic/sidebar-layout';
import { dispatchPoeEvent } from '@/utils/event-contracts';

const layoutSource = readFileSync('entrypoints/content/logic/sidebar-layout.ts', 'utf8').replace(
  /\r\n/g,
  '\n',
);

const sidebarSource = readFileSync('components/Sidebar.vue', 'utf8').replace(/\r\n/g, '\n');

describe('Sidebar page layout', () => {
  it('animates the page left when a left sidebar collapses', () => {
    // 側邊欄本身的寬度動畫共用同一組時間（utils/sidebar-motion.ts）
    expect(layoutSource).toContain(
      'transition: width ${timing}, margin-left ${timing}, margin-right ${timing} !important;',
    );
    expect(sidebarSource).toContain('duration: SIDEBAR_LAYOUT_TRANSITION_MS,');
    expect(sidebarSource).toContain('easing: SIDEBAR_LAYOUT_TRANSITION_EASING,');
    expect(layoutSource).toContain(
      "const pageMarginLeft = position === 'left' && !collapsed ? width : 0;",
    );
    expect(layoutSource).toContain('margin-left: ${pageMarginLeft}px !important;');
  });

  it('decouples sidebar width from fontSizeScale and listens to live width preview', () => {
    expect(layoutSource).not.toContain('sidebarWidth * initialPreferences.fontSizeScale');
    expect(layoutSource).not.toContain('sidebarWidth * snapshot.fontSizeScale');
    expect(layoutSource).toContain("listenPoeEvent('poexd-sidebar-width-preview'");
  });

  it('establishes UI typography and foreground baseline on shadow uiContainer for appRoot and portalRoot inheritance', () => {
    expect(layoutSource).toContain(
      "container.style.fontFamily = \"'Microsoft JhengHei', '微軟正黑體', sans-serif\"",
    );
    expect(layoutSource).toContain("container.style.color = 'var(--foreground)';");
    expect(layoutSource).toContain("container.style.fontSize = 'var(--pxd-font-secondary)';");
    expect(layoutSource).not.toMatch(/wrapper\.style[\s\S]*?fontFamily/);
    expect(layoutSource).toContain('syncUiRuntimeTokens(wrapper,');
    expect(layoutSource).toContain('syncUiScalingVariables(initialPreferences);');
    expect(layoutSource).toContain('syncUiScalingVariables(snapshot);');
  });

  it('preserves currentDensity on partial updates such as live width preview without resetting to 1', () => {
    expect(layoutSource).toContain('let currentDensity = initialPreferences.densityScale ?? 1;');
    expect(layoutSource).toContain('if (prefs.densityScale !== undefined) {');
    expect(layoutSource).toContain('currentDensity = prefs.densityScale;');
    expect(layoutSource).toContain('density: currentDensity,');
    expect(layoutSource).not.toContain('density: prefs.densityScale ?? 1');
  });

  it('delegates modal scroll lock to ConfigProvider and does not manipulate body overflow or scroll position', () => {
    expect(layoutSource).toContain("listenPoeEvent('poexd-modal-active-changed'");
    expect(layoutSource).not.toContain('document.body.style.overflow');
    expect(layoutSource).not.toContain('document.documentElement.style.overflow');
    expect(layoutSource).not.toContain('savedScrollY');
    expect(layoutSource).not.toContain('window.scrollTo');
    expect(layoutSource).not.toContain('setTimeout');
  });

  it('establishes shadowHost CSS layout contract overriding WXT reset, and drives dynamic geometry via private custom properties bridge', () => {
    expect(layoutSource).toContain("const POEXD_HOST_Z_INDEX = '2147483647';");

    // 1. Host CSS in createShadowRootUi overrides WXT reset with !important
    expect(layoutSource).toContain('display: block !important;');
    expect(layoutSource).toContain('position: fixed !important;');
    expect(layoutSource).toContain('overflow: visible !important;');
    expect(layoutSource).toContain('z-index: ${POEXD_HOST_Z_INDEX} !important;');
    expect(layoutSource).toContain('top: var(--poexd-host-top, 0px) !important;');
    expect(layoutSource).toContain('left: var(--poexd-host-left, auto) !important;');
    expect(layoutSource).toContain('right: var(--poexd-host-right, auto) !important;');
    expect(layoutSource).toContain('width: var(--poexd-host-width, 380px) !important;');
    expect(layoutSource).toContain('height: var(--poexd-host-height, 100vh) !important;');

    // 2. No ordinary inline geometry properties assigned on wrapper.style
    expect(layoutSource).not.toMatch(/wrapper\.style\.width\s*=/);
    expect(layoutSource).not.toMatch(/wrapper\.style\.height\s*=/);
    expect(layoutSource).not.toMatch(/wrapper\.style\.top\s*=/);
    expect(layoutSource).not.toMatch(/wrapper\.style\.zIndex\s*=/);
    expect(layoutSource).not.toMatch(/wrapper\.style\[currentPosition\]\s*=/);

    // 3. Dynamic geometry updated exclusively via private custom properties
    expect(layoutSource).toContain("wrapper.style.setProperty('--poexd-host-width',");
    expect(layoutSource).toContain("wrapper.style.setProperty('--poexd-host-height',");
    expect(layoutSource).toContain("wrapper.style.setProperty('--poexd-host-top',");
    expect(layoutSource).toContain("wrapper.style.setProperty('--poexd-host-left',");
    expect(layoutSource).toContain("wrapper.style.setProperty('--poexd-host-right',");

    // 4. appRoot & portalRoot stacking contexts preserved
    expect(layoutSource).toContain("appRoot.style.position = 'relative';");
    expect(layoutSource).toContain("appRoot.style.zIndex = '0';");
    expect(layoutSource).toContain("portalRoot.style.position = 'relative';");
    expect(layoutSource).toContain("portalRoot.style.zIndex = '1';");
  });
});

describe('Sidebar Width and UI Scale Decoupling Runtime Regression', () => {
  it('1. keeps sidebarWidth=380 independent of scale (0.85, 1.0, 1.2 -> 380px)', () => {
    const tokens85 = createUiRuntimeTokenValues({ scale: 0.85, sidebarWidth: 380 });
    const tokens100 = createUiRuntimeTokenValues({ scale: 1.0, sidebarWidth: 380 });
    const tokens120 = createUiRuntimeTokenValues({ scale: 1.2, sidebarWidth: 380 });

    expect(tokens85['--pxd-sidebar-width']).toBe('380px');
    expect(tokens100['--pxd-sidebar-width']).toBe('380px');
    expect(tokens120['--pxd-sidebar-width']).toBe('380px');
  });

  it('2. scales navigation controls, rail width, and collapsed geometry when Scale changes', () => {
    const tokens85 = createUiRuntimeTokenValues({ scale: 0.85, sidebarWidth: 380 });
    const tokens100 = createUiRuntimeTokenValues({ scale: 1.0, sidebarWidth: 380 });
    const tokens120 = createUiRuntimeTokenValues({ scale: 1.2, sidebarWidth: 380 });

    // Navigation control size changes (icon-lg button height)
    expect(tokens85['--control-height-lg']).toBe('34px');
    expect(tokens100['--control-height-lg']).toBe('40px');
    expect(tokens120['--control-height-lg']).toBe('48px');

    // Navigation rail width changes
    expect(tokens85['--pxd-sidebar-nav-width']).toBe('42.5px');
    expect(tokens100['--pxd-sidebar-nav-width']).toBe('50px');
    expect(tokens120['--pxd-sidebar-nav-width']).toBe('60px');

    // Collapsed control geometry changes
    expect(tokens85['--pxd-sidebar-collapsed-width']).toBe('54.4px');
    expect(tokens100['--pxd-sidebar-collapsed-width']).toBe('64px');
    expect(tokens120['--pxd-sidebar-collapsed-width']).toBe('76.8px');
    expect(tokens85['--control-height-default']).toBe('27.2px');
    expect(tokens100['--control-height-default']).toBe('32px');
    expect(tokens120['--control-height-default']).toBe('38.4px');
  });

  it('3. custom resize directly uses visual width 500px, persisting 500 and staying 500px across scale changes', () => {
    // Contract check: Sidebar resize does not divide by scale
    expect(sidebarSource).not.toContain('calcBaselineSidebarWidth');
    expect(sidebarSource).toContain('sidebarWidth.value = visualWidth');
    expect(sidebarSource).toContain('sidebarWidth: sidebarWidth.value');

    // Runtime token check: 500px width remains 500px across scale changes
    const tokens85 = createUiRuntimeTokenValues({ scale: 0.85, sidebarWidth: 500 });
    const tokens100 = createUiRuntimeTokenValues({ scale: 1.0, sidebarWidth: 500 });
    const tokens120 = createUiRuntimeTokenValues({ scale: 1.2, sidebarWidth: 500 });

    expect(tokens85['--pxd-sidebar-width']).toBe('500px');
    expect(tokens100['--pxd-sidebar-width']).toBe('500px');
    expect(tokens120['--pxd-sidebar-width']).toBe('500px');
  });
});

describe('UI Namespace & Prefix Ownership Contract', () => {
  it('enforces pxd- prefix for PoeXD internal Shadow UI presentation wrapper and eliminates dead attributes', () => {
    expect(sidebarSource).toContain('pxd-sidebar-wrapper');
    expect(sidebarSource).not.toContain('poe-sidebar-wrapper');
    expect(sidebarSource).not.toContain('data-poexd-density');
  });

  it('guards PoeXD Shadow UI components against introducing extension-owned poe-* UI classes', () => {
    const componentFiles = [
      'components/Sidebar.vue',
      'components/sidebar/BookmarkPane.vue',
      'components/sidebar/FilterPane.vue',
      'components/sidebar/HistoryPane.vue',
      'components/sidebar/SettingsPane.vue',
      'components/sidebar/ModItem.vue',
    ];

    const forbiddenPoeUiClassRegex = /\bclass=(["'])[^"']*\bpoe-(?!1\b|2\b)[a-z0-9_-]+[^"']*\1/g;

    for (const relPath of componentFiles) {
      const content = readFileSync(relPath, 'utf8');
      const matches = content.match(forbiddenPoeUiClassRegex);
      expect(matches, `Found forbidden poe-* UI class in ${relPath}`).toBeNull();
      expect(content).not.toContain('poe-sidebar-wrapper');
      expect(content).not.toContain('poe-scrollbar');
    }
  });
});

describe('mountSidebarLayout transient width preview & live layout synchronization', () => {
  let layoutCleanups: (() => void)[] = [];

  beforeEach(() => {
    (globalThis as any).chrome = {
      storage: {
        local: {
          get: vi.fn(async () => ({ isCollapsed: false })),
          set: vi.fn(async () => {}),
        },
      },
    };
    (globalThis as any).createShadowRootUi = vi.fn(async (ctx: any, options: any) => {
      return ctx.createShadowRootUi(options);
    });
  });

  afterEach(() => {
    layoutCleanups.forEach((cleanup) => cleanup());
    layoutCleanups = [];
    document.getElementById('poexd-layout-style')?.remove();
    document.body.innerHTML = '';
  });

  const createMockCtx = () => {
    const shadowHost = document.createElement('div');
    const uiContainer = document.createElement('div');
    shadowHost.appendChild(uiContainer);
    return {
      shadowHost,
      uiContainer,
      createShadowRootUi: vi.fn(({ onRemove }: any) => ({
        shadowHost,
        uiContainer,
        mount: () => {
          document.body.appendChild(shadowHost);
        },
        remove: () => {
          onRemove?.();
          shadowHost.remove();
        },
      })),
    };
  };

  const createMockPreferences = (overrides: any = {}) => {
    const current = {
      sidebarPosition: 'left',
      sidebarSize: 'custom',
      sidebarWidth: 420,
      customSidebarWidth: 420,
      theme: 'default',
      fontSizeScale: 1,
      densityScale: 1,
      ...overrides,
    };
    return {
      read: () => current,
      getSnapshot: () => current,
      subscribe: vi.fn(() => () => {}),
      update: vi.fn(async () => {}),
    } as any;
  };

  it('reserves the page layout before the sidebar mounts so the page does not shift after results show', async () => {
    const prefs = createMockPreferences({ sidebarPosition: 'right', sidebarWidth: 400 });

    const remove = await reserveSidebarPageLayout('poe1', prefs);

    const layoutStyle = document.getElementById('poexd-layout-style') as HTMLStyleElement;
    const reserved = layoutStyle.textContent;
    expect(reserved).toContain('width: calc(100% - 400px) !important;');
    expect(reserved).toContain('margin-right: 400px !important;');
    expect(reserved).toContain('transition: none !important;');

    // 掛載沿用同一個樣式元素，版面數值不變
    const stop = await mountSidebarLayout(createMockCtx(), 'poe1', prefs);
    if (stop) layoutCleanups.push(stop);
    expect(document.querySelectorAll('#poexd-layout-style')).toHaveLength(1);
    expect(layoutStyle.textContent).toContain('width: calc(100% - 400px) !important;');
    expect(layoutStyle.textContent).toContain('margin-right: 400px !important;');

    remove();
    expect(document.getElementById('poexd-layout-style')).toBeNull();
  });

  it('reserves no space when the sidebar was left collapsed', async () => {
    (globalThis as any).chrome.storage.local.get = vi.fn(async () => ({ isCollapsed_poe1: true }));
    const remove = await reserveSidebarPageLayout('poe1', createMockPreferences());

    const layoutStyle = document.getElementById('poexd-layout-style') as HTMLStyleElement;
    expect(layoutStyle.textContent).toContain('width: 100% !important;');
    expect(layoutStyle.textContent).toContain('margin-left: 0px !important;');
    remove();
  });

  it('does not overwrite mounted layout style if reserveSidebarPageLayout resolves after mountSidebarLayout', async () => {
    let resolveReserveStorage!: (val: Record<string, unknown>) => void;
    let callCount = 0;
    (globalThis as any).chrome.storage.local.get = vi.fn(() => {
      callCount += 1;
      if (callCount === 1) {
        return new Promise((resolve) => {
          resolveReserveStorage = resolve;
        });
      }
      return Promise.resolve({ isCollapsed_poe1: false });
    });

    const prefs = createMockPreferences({ sidebarPosition: 'left', sidebarWidth: 420 });
    const reservePromise = reserveSidebarPageLayout('poe1', prefs);

    const stop = await mountSidebarLayout(createMockCtx(), 'poe1', prefs);
    if (stop) layoutCleanups.push(stop);

    const layoutStyle = document.getElementById('poexd-layout-style') as HTMLStyleElement;
    expect(layoutStyle.textContent).toContain(
      'transition: width 0.15s ease, margin-left 0.15s ease, margin-right 0.15s ease !important;',
    );

    // 較晚完成的 reserveSidebarPageLayout 不應把已掛載的過場動畫洗回 transition: none
    resolveReserveStorage({ isCollapsed_poe1: true });
    await reservePromise;

    expect(layoutStyle.textContent).toContain(
      'transition: width 0.15s ease, margin-left 0.15s ease, margin-right 0.15s ease !important;',
    );
    expect(layoutStyle.textContent).toContain('width: calc(100% - 420px) !important;');
  });

  it('updates PoE .content width and margin-left in real time upon poexd-sidebar-width-preview for left sidebar (420 -> 500)', async () => {
    const mockCtx = createMockCtx();
    const prefs = createMockPreferences({ sidebarPosition: 'left', sidebarWidth: 420 });

    const stop = await mountSidebarLayout(mockCtx, 'poe1', prefs);
    if (stop) layoutCleanups.push(stop);

    const layoutStyle = document.getElementById('poexd-layout-style') as HTMLStyleElement;
    expect(layoutStyle).not.toBeNull();

    // Baseline layout for left sidebar at 420px
    expect(layoutStyle.textContent).toContain('width: calc(100% - 420px) !important;');
    expect(layoutStyle.textContent).toContain('margin-left: 420px !important;');
    expect(layoutStyle.textContent).toContain('margin-right: 0px !important;');
    expect(mockCtx.shadowHost.style.getPropertyValue('--poexd-host-width')).toBe('420px');

    // Transient preview event triggers real-time contract update to 500px
    dispatchPoeEvent('poexd-sidebar-width-preview', 500);

    expect(layoutStyle.textContent).toContain('width: calc(100% - 500px) !important;');
    expect(layoutStyle.textContent).toContain('margin-left: 500px !important;');
    expect(layoutStyle.textContent).toContain('margin-right: 0px !important;');
    expect(mockCtx.shadowHost.style.getPropertyValue('--poexd-host-width')).toBe('500px');
  });

  it('updates PoE .content margin-right in real time upon poexd-sidebar-width-preview for right sidebar (420 -> 500)', async () => {
    const mockCtx = createMockCtx();
    const prefs = createMockPreferences({ sidebarPosition: 'right', sidebarWidth: 420 });

    const stop = await mountSidebarLayout(mockCtx, 'poe1', prefs);
    if (stop) layoutCleanups.push(stop);

    const layoutStyle = document.getElementById('poexd-layout-style') as HTMLStyleElement;
    expect(layoutStyle).not.toBeNull();

    // Baseline layout for right sidebar at 420px
    expect(layoutStyle.textContent).toContain('width: calc(100% - 420px) !important;');
    expect(layoutStyle.textContent).toContain('margin-left: 0px !important;');
    expect(layoutStyle.textContent).toContain('margin-right: 420px !important;');
    expect(mockCtx.shadowHost.style.getPropertyValue('--poexd-host-width')).toBe('420px');

    // Transient preview event triggers real-time contract update to 500px on right margin
    dispatchPoeEvent('poexd-sidebar-width-preview', 500);

    expect(layoutStyle.textContent).toContain('width: calc(100% - 500px) !important;');
    expect(layoutStyle.textContent).toContain('margin-left: 0px !important;');
    expect(layoutStyle.textContent).toContain('margin-right: 500px !important;');
    expect(mockCtx.shadowHost.style.getPropertyValue('--poexd-host-width')).toBe('500px');
  });

  it('confirms SettingsPane.vue does NOT listen to poexd-sidebar-width-preview and has no numeric width input', () => {
    const settingsSource = readFileSync('components/sidebar/SettingsPane.vue', 'utf8');
    expect(settingsSource).not.toContain("listenPoeEvent('poexd-sidebar-width-preview'");
    expect(settingsSource).not.toContain('poexd-sidebar-width-preview');
    expect(settingsSource).not.toContain('v-model:model-value="customWidth"');
  });

  it('syncs shadow host --poexd-host-top from collapsedTabTop preference and live preview events', async () => {
    (globalThis as any).chrome.storage.local.get = vi.fn(async () => ({ isCollapsed_poe1: true }));
    const mockCtx = createMockCtx();
    const prefs = createMockPreferences({ collapsedTabTop: 240 });

    const stop = await mountSidebarLayout(mockCtx, 'poe1', prefs);
    if (stop) layoutCleanups.push(stop);

    expect(mockCtx.shadowHost.style.getPropertyValue('--poexd-host-top')).toBe(
      'clamp(0px, 240px, calc(100vh - var(--control-height-default)))',
    );

    dispatchPoeEvent('poexd-sidebar-collapsed-top-preview', 360);
    expect(mockCtx.shadowHost.style.getPropertyValue('--poexd-host-top')).toBe(
      'clamp(0px, 360px, calc(100vh - var(--control-height-default)))',
    );
  });
});
