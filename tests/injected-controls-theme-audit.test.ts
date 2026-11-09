import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('Injected Controls Theme Audit & Contract Tests', () => {
  const commonTsPath = path.resolve(__dirname, '../entrypoints/content/logic/common.ts');
  const commonTsContent = readFileSync(commonTsPath, 'utf-8');
  const injectedControlsTsPath = path.resolve(
    __dirname,
    '../entrypoints/content/logic/injected-controls.ts',
  );
  const injectedControlsTsContent = readFileSync(injectedControlsTsPath, 'utf-8');

  // ---------------------------------------------------------------------------
  // 1. Audit: Zero Generic Hardcoded Dark Palette in Injected Controls
  // ---------------------------------------------------------------------------
  describe('1. Audit: Zero Generic Hardcoded Dark Palette in Injected Controls', () => {
    it('contains NO hardcoded dark colors in injectCustomStyles except body.poexd-pure-bg domain color', () => {
      // 擷取 injectCustomStyles 內部的 CSS 字串
      const match = injectedControlsTsContent.match(
        /function\s+injectCustomStyles\s*\(\)\s*(?::\s*void\s*)?\{[\s\S]*?styleEl\.textContent\s*=\s*`([\s\S]*?)`;/,
      );
      expect(match).toBeTruthy();
      const css = match![1];

      // 擷取除 body.poexd-pure-bg 以外的所有 CSS 內容
      const cssWithoutPureBg = css.replace(/body\.poexd-pure-bg\s*\{[^}]*\}/g, '');

      // 嚴格斷言：不可包含任何十六進位色碼
      const hexMatches = cssWithoutPureBg.match(/#[0-9a-fA-F]{3,8}/g);
      expect(hexMatches).toBeNull();

      // 嚴格斷言：不可包含任何 rgb/rgba/hsl/hsla 色碼
      const rgbMatches = cssWithoutPureBg.match(/(rgb|hsl)a?\([^)]+\)/g);
      expect(rgbMatches).toBeNull();

      // 既有純色背景作為獨立 domain feature 予以保留
      expect(css).toMatch(
        /body\.poexd-pure-bg\s*\{[\s\S]*?background-color:\s*#060607\s*!important;[\s\S]*?\}/,
      );
    });

    it('removes generic hardcoded inline color, border, and backgroundColor on poexd-category-select-btn', () => {
      // 檢查 TypeScript 程式碼中建立 selectBtn 時不再有 inline 色彩
      expect(injectedControlsTsContent).not.toMatch(
        /selectBtn\.style\.color\s*=\s*['"]#[0-9a-fA-F]+['"]/,
      );
      expect(injectedControlsTsContent).not.toMatch(
        /selectBtn\.style\.border\s*=\s*['"][^'"]*#[0-9a-fA-F]+['"]/,
      );
      expect(injectedControlsTsContent).not.toMatch(
        /selectBtn\.style\.backgroundColor\s*=\s*['"]#[0-9a-fA-F]+['"]/,
      );
    });

    it('removes inline presentation and style assignments in TypeScript for poexd-category-select-btn', () => {
      // 確保 selectBtn 不再包含任何 inline style assignment
      expect(injectedControlsTsContent).not.toMatch(/selectBtn\.style\./);
    });

    it('manages category button geometry via fixed Host spec and semantic CSS class', () => {
      const catBtnMatch = injectedControlsTsContent.match(
        /\.poexd-category-select-btn\s*\{([\s\S]*?)\n\s*\}/,
      );
      expect(catBtnMatch).toBeTruthy();
      const rule = catBtnMatch![1];
      expect(rule).toContain(
        '${HOST_CATEGORY_BUTTON_SPEC.paddingYPx}px ${HOST_CATEGORY_BUTTON_SPEC.paddingXPx}px !important',
      );
      expect(rule).toContain('margin-left: ${HOST_CATEGORY_BUTTON_SPEC.marginLeftPx}px !important');
      expect(rule).toContain('font-size: ${HOST_CATEGORY_BUTTON_SPEC.fontPx}px !important');
      expect(rule).toContain('height: ${HOST_CATEGORY_BUTTON_SPEC.heightPx}px !important');
      expect(rule).toContain('line-height: ${HOST_CATEGORY_BUTTON_SPEC.lineHeightPx}px !important');
      expect(rule).not.toContain('var(--poexd-category-btn');
      expect(rule).not.toContain('var(--pxd-space-md');
    });

    it('separates icon button geometry from base poexd-inline-btn contract and binds to HOST_FILTER_SELECT_BUTTON_SPEC', () => {
      const inlineBtnMatch = injectedControlsTsContent.match(/\.poexd-inline-btn\s*\{([^}]+)\}/);
      expect(inlineBtnMatch).toBeTruthy();
      const inlineRule = inlineBtnMatch![1];
      expect(inlineRule).not.toContain('width: 28px');
      expect(inlineRule).not.toContain('height: 28px');

      const filterBtnMatch = injectedControlsTsContent.match(
        /\.poexd-filter-select-btn\s*\{([\s\S]*?)\n\s*\}/,
      );
      expect(filterBtnMatch).toBeTruthy();
      const filterRule = filterBtnMatch![1];
      expect(filterRule).toContain('width: ${HOST_FILTER_SELECT_BUTTON_SPEC.sizePx}px !important');
      expect(filterRule).toContain('height: ${HOST_FILTER_SELECT_BUTTON_SPEC.sizePx}px !important');
      expect(filterRule).not.toContain('var(--control-height-sm');
    });

    it('removes imperative li styling on switch_category header in favor of Vue text-primary', () => {
      expect(injectedControlsTsContent).not.toContain("li.style.color = '#41d7a6'");
      expect(injectedControlsTsContent).not.toContain("li.style.color = 'var(--primary)'");
      const tierHostPath = path.resolve(__dirname, '../components/injected/TierDropdownHost.vue');
      const tierHostContent = readFileSync(tierHostPath, 'utf-8');
      expect(tierHostContent).toContain('text-primary');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Semantic Vocabulary Verification
  // ---------------------------------------------------------------------------
  describe('2. Semantic Vocabulary Verification', () => {
    it('styles .poexd-tier-trigger with secondary surface, foreground, border, square radius, shadow, hover accent, and focus ring', () => {
      const match = injectedControlsTsContent.match(/\.poexd-tier-trigger\s*\{([\s\S]*?)\n\s*\}/);
      expect(match).toBeTruthy();
      const rule = match![1];

      expect(rule).toContain('background-color: var(--secondary)');
      expect(rule).toContain('color: var(--secondary-foreground)');
      expect(rule).toContain('border: 1px solid var(--border)');
      expect(rule).toContain('border-radius: 0 !important');
      expect(rule).not.toContain('var(--radius)');
      expect(rule).toContain('box-shadow: var(--shadow-sm)');

      const hoverMatch = injectedControlsTsContent.match(
        /\.poexd-tier-trigger:hover\s*\{([^}]+)\}/,
      );
      expect(hoverMatch).toBeTruthy();
      const hoverRule = hoverMatch![1];
      expect(hoverRule).toContain('background-color: var(--accent)');
      expect(hoverRule).toContain('color: var(--accent-foreground)');

      const focusMatch = injectedControlsTsContent.match(
        /\.poexd-tier-trigger:(focus|focus-visible)\s*\{([^}]+)\}/,
      );
      expect(focusMatch).toBeTruthy();
      expect(focusMatch![2]).toContain('box-shadow: 0 0 0 2px var(--ring)');
    });

    it('verifies .poexd-tier-dropdown and .tier-act-btn are removed from logic and migrated to Vue component', () => {
      // 驗證 common.ts 與 injected-controls.ts 均不再含有舊版命令式下拉選單樣式與九位數 z-index
      expect(commonTsContent).not.toContain('.poexd-tier-dropdown');
      expect(commonTsContent).not.toContain('.poexd-tier-item');
      expect(commonTsContent).not.toContain('.poexd-tier-group-header');
      expect(commonTsContent).not.toContain('.tier-act-btn');
      expect(commonTsContent).not.toContain('999999999');
      expect(commonTsContent).not.toContain('poe-scrollbar');

      expect(injectedControlsTsContent).not.toContain('.poexd-tier-dropdown');
      expect(injectedControlsTsContent).not.toContain('.poexd-tier-item');
      expect(injectedControlsTsContent).not.toContain('.poexd-tier-group-header');
      expect(injectedControlsTsContent).not.toContain('.tier-act-btn');
      expect(injectedControlsTsContent).not.toContain('999999999');
      expect(injectedControlsTsContent).not.toContain('poe-scrollbar');

      // 驗證 TierDropdownHost.vue 存在且使用語意 token、DropdownMenu、Teleport 與 activeTierSlots
      const tierHostPath = path.resolve(__dirname, '../components/injected/TierDropdownHost.vue');
      const tierHostContent = readFileSync(tierHostPath, 'utf-8');
      expect(tierHostContent).toContain('DropdownMenu');
      expect(tierHostContent).toContain('DropdownMenuTrigger');
      expect(tierHostContent).toContain('DropdownMenuContent');
      expect(tierHostContent).toContain('activeTierSlots');
      expect(tierHostContent).toContain('<Teleport');

      // 驗證 Sidebar.vue 註冊並掛載 TierDropdownHost
      const sidebarVuePath = path.resolve(__dirname, '../components/Sidebar.vue');
      const sidebarContent = readFileSync(sidebarVuePath, 'utf-8');
      expect(sidebarContent).toContain('TierDropdownHost');
    });

    it('styles .poexd-inline-btn and .poexd-category-select-btn with semantic tokens and square radius', () => {
      const inlineBtnMatch = injectedControlsTsContent.match(/\.poexd-inline-btn\s*\{([^}]+)\}/);
      expect(inlineBtnMatch).toBeTruthy();
      const inlineRule = inlineBtnMatch![1];
      expect(inlineRule).toContain('color: var(--muted-foreground)');
      expect(inlineRule).toContain('border-radius: 0 !important');
      expect(inlineRule).not.toContain('var(--radius)');

      const catBtnMatch = injectedControlsTsContent.match(
        /\.poexd-category-select-btn\s*\{([\s\S]*?)\n\s*\}/,
      );
      expect(catBtnMatch).toBeTruthy();
      const catRule = catBtnMatch![1];
      expect(catRule).toContain('background-color: var(--secondary)');
      expect(catRule).toContain('color: var(--secondary-foreground)');
      expect(catRule).toContain('border: 1px solid var(--border)');
      expect(catRule).not.toContain('var(--radius)');
    });

    it('preserves restored poexd-sortable-drag styling without opacity', () => {
      const dragMatch = injectedControlsTsContent.match(
        /\.poexd-sortable-drag\s*\{([\s\S]*?)\n\s*\}/,
      );
      expect(dragMatch).toBeTruthy();
      const dragRule = dragMatch![1];
      expect(dragRule).toContain('background-color: var(--popover) !important;');
      expect(dragRule).toContain('color: var(--popover-foreground) !important;');
      expect(dragRule).toContain('box-shadow: var(--shadow-md) !important;');
      expect(dragRule).toContain('border: 1px solid var(--border) !important;');
      expect(dragRule).toContain('border-radius: var(--radius) !important;');
      expect(dragRule).not.toContain('opacity');
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Lifecycle Integration
  // ---------------------------------------------------------------------------
  describe('3. Lifecycle Integration', () => {
    it('calls syncPageThemeBridge on initialize and cleanupPageThemeBridge on cleanup', () => {
      expect(commonTsContent).toContain('syncPageThemeBridge();');
      expect(commonTsContent).toContain('cleanupPageThemeBridge();');
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Host-page Injected UI Theme Residual Audit
  // ---------------------------------------------------------------------------
  describe('4. Host-page Injected UI Theme Residual Audit', () => {
    const toastVuePath = path.resolve(__dirname, '../components/ToastHost.vue');
    const toastVueContent = readFileSync(toastVuePath, 'utf-8');
    const toastHostTsPath = path.resolve(__dirname, '../entrypoints/content/logic/toast-host.ts');
    const toastHostContent = readFileSync(toastHostTsPath, 'utf-8');
    const contentTsPath = path.resolve(__dirname, '../entrypoints/content/index.ts');
    const contentTsContent = readFileSync(contentTsPath, 'utf-8');

    it('enforces single global toast host uses semantic theme variables without hardcoded palette', () => {
      // 嚴格斷言：移除所有舊有 hardcoded 顏色與 raw rgba shadow
      const forbiddenPatterns = [
        '#1e1e20',
        '#fff',
        '#4fb233',
        '#18181c',
        '#d03050',
        '#2c1e21',
        'rgba(0,0,0,0.3)',
      ];
      for (const pattern of forbiddenPatterns) {
        expect(toastVueContent).not.toContain(pattern);
        expect(toastHostContent).not.toContain(pattern);
      }

      // 斷言 toast-host.ts 徹底移除 inline presentation style 賦值
      expect(toastHostContent).not.toContain('currentToastEl');
      expect(toastHostContent).not.toContain('TOAST_CSS');

      // 斷言 ToastHost.vue 使用標準 shadcn / Tailwind 語意類別與 tokens
      expect(toastVueContent).toContain('bg-popover');
      expect(toastVueContent).toContain('text-popover-foreground');
      expect(toastVueContent).toContain('border-border');
      expect(toastVueContent).toContain('border-primary');
      expect(toastVueContent).toContain('border-destructive');
      expect(toastVueContent).toContain('var(--radius)');
      expect(toastVueContent).toContain('shadow-lg');

      // 斷言固定 viewport top-center 定位與唯一 hook (Scale & Density invariant)
      expect(toastVueContent).toContain('data-poexd-toast');
      expect(toastVueContent).toContain('fixed');
      expect(toastVueContent).toContain('top-[20px]');
      expect(toastVueContent).toContain('left-1/2');
      expect(toastVueContent).toContain('-translate-x-1/2');

      // 斷言使用 UI Foundation canonical typography 與 layout spacing tokens
      expect(toastVueContent).toContain('var(--pxd-font-section-title)');
      expect(toastVueContent).toContain('var(--pxd-space-md)');
      expect(toastVueContent).toContain('var(--pxd-space-xl)');
    });

    it('verifies content.ts has no obsolete #poexd-sync-overlay', () => {
      expect(contentTsContent).not.toContain('poexd-sync-overlay');
      expect(contentTsContent).not.toContain('showSyncOverlay');
    });
  });
});
