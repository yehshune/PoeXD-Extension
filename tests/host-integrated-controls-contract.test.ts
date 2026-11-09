// @vitest-environment happy-dom
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createUiRuntimeTokenValues,
  HOST_TIER_TRIGGER_SPEC,
  HOST_FILTER_SELECT_BUTTON_SPEC,
  HOST_CATEGORY_BUTTON_SPEC,
} from '@/lib/tokens/ui-contract';
import {
  PAGE_THEME_BRIDGE_STYLE_ID,
  PAGE_INJECTED_SELECTORS,
  generatePageThemeBridgeCss,
  readThemeSemanticValues,
} from '@/lib/theme/page-theme-bridge';

describe('Phase 4.1: PoE Host-integrated Button Contract & Runtime Bridge Removal', () => {
  const commonTsPath = path.resolve(__dirname, '../entrypoints/content/logic/common.ts');
  const commonTsContent = fs.readFileSync(commonTsPath, 'utf-8');
  const injectedControlsTsPath = path.resolve(
    __dirname,
    '../entrypoints/content/logic/injected-controls.ts',
  );
  const injectedControlsTsContent = fs.readFileSync(injectedControlsTsPath, 'utf-8');
  const runtimeTsPath = path.resolve(__dirname, '../entrypoints/content/logic/runtime.ts');
  const runtimeTsContent = fs.readFileSync(runtimeTsPath, 'utf-8');
  const tokensIndexPath = path.resolve(__dirname, '../lib/tokens/index.ts');
  const tokensIndexContent = fs.readFileSync(tokensIndexPath, 'utf-8');
  const tierHostPath = path.resolve(__dirname, '../components/injected/TierDropdownHost.vue');
  const tierHostContent = fs.readFileSync(tierHostPath, 'utf-8');
  const bridgeFilePath = path.resolve(__dirname, '../lib/tokens/page-runtime-token-bridge.ts');

  // 1. 三個 Host button 皆不 consume scalable tokens
  it('1. ensures all three Host buttons do NOT consume scalable tokens (--control-*, --pxd-space-*)', () => {
    const tierMatch = injectedControlsTsContent.match(/\.poexd-tier-trigger\s*\{([\s\S]*?)\n\s*\}/);
    const filterMatch = injectedControlsTsContent.match(
      /\.poexd-filter-select-btn\s*\{([\s\S]*?)\n\s*\}/,
    );
    const categoryMatch = injectedControlsTsContent.match(
      /\.poexd-category-select-btn\s*\{([\s\S]*?)\n\s*\}/,
    );
    const inlineMatch = injectedControlsTsContent.match(/\.poexd-inline-btn\s*\{([\s\S]*?)\n\s*\}/);

    expect(tierMatch).toBeTruthy();
    expect(filterMatch).toBeTruthy();
    expect(categoryMatch).toBeTruthy();
    expect(inlineMatch).toBeTruthy();

    const rules = [tierMatch![1], filterMatch![1], categoryMatch![1], inlineMatch![1]];
    for (const rule of rules) {
      expect(rule).not.toContain('var(--control-height');
      expect(rule).not.toContain('var(--control-font');
      expect(rule).not.toContain('var(--control-icon');
      expect(rule).not.toContain('var(--control-padding');
      expect(rule).not.toContain('var(--button-padding');
      expect(rule).not.toContain('var(--pxd-space');
    }
  });

  // 2. 三個 Host button geometry production CSS 實際來自固定 Host specs
  it('2. verifies all three Host button geometries in production CSS are directly sourced from fixed Host specs', () => {
    expect(injectedControlsTsContent).toContain('import {');
    expect(injectedControlsTsContent).toContain('HOST_TIER_TRIGGER_SPEC');
    expect(injectedControlsTsContent).toContain('HOST_FILTER_SELECT_BUTTON_SPEC');
    expect(injectedControlsTsContent).toContain('HOST_CATEGORY_BUTTON_SPEC');

    // Tier Trigger spec usage
    expect(injectedControlsTsContent).toContain('width: ${HOST_TIER_TRIGGER_SPEC.widthPx}px');
    expect(injectedControlsTsContent).toContain('font-size: ${HOST_TIER_TRIGGER_SPEC.fontPx}px');
    expect(injectedControlsTsContent).toContain(
      'line-height: ${HOST_TIER_TRIGGER_SPEC.lineHeightPx}px',
    );
    expect(injectedControlsTsContent).toContain(
      'padding: 0 ${HOST_TIER_TRIGGER_SPEC.paddingXPx}px',
    );
    expect(injectedControlsTsContent).toContain(
      'font-weight: ${HOST_TIER_TRIGGER_SPEC.fontWeight}',
    );

    // Filter Select spec usage
    expect(injectedControlsTsContent).toContain(
      'width: ${HOST_FILTER_SELECT_BUTTON_SPEC.sizePx}px',
    );
    expect(injectedControlsTsContent).toContain(
      'height: ${HOST_FILTER_SELECT_BUTTON_SPEC.sizePx}px',
    );
    expect(injectedControlsTsContent).toContain(
      'width: ${HOST_FILTER_SELECT_BUTTON_SPEC.iconSizePx}px',
    );
    expect(injectedControlsTsContent).toContain(
      'height: ${HOST_FILTER_SELECT_BUTTON_SPEC.iconSizePx}px',
    );

    // Category Select spec usage
    expect(injectedControlsTsContent).toContain(
      'padding: ${HOST_CATEGORY_BUTTON_SPEC.paddingYPx}px ${HOST_CATEGORY_BUTTON_SPEC.paddingXPx}px',
    );
    expect(injectedControlsTsContent).toContain(
      'margin-left: ${HOST_CATEGORY_BUTTON_SPEC.marginLeftPx}px',
    );
    expect(injectedControlsTsContent).toContain('font-size: ${HOST_CATEGORY_BUTTON_SPEC.fontPx}px');
    expect(injectedControlsTsContent).toContain('height: ${HOST_CATEGORY_BUTTON_SPEC.heightPx}px');
    expect(injectedControlsTsContent).toContain(
      'line-height: ${HOST_CATEGORY_BUTTON_SPEC.lineHeightPx}px',
    );
  });

  // 3. Host buttons 固定 border-radius: 0 且不 consume var(--radius)
  it('3. verifies Host buttons have fixed border-radius: 0 and do NOT consume var(--radius)', () => {
    const inlineMatch = injectedControlsTsContent.match(/\.poexd-inline-btn\s*\{([\s\S]*?)\n\s*\}/);
    const tierMatch = injectedControlsTsContent.match(/\.poexd-tier-trigger\s*\{([\s\S]*?)\n\s*\}/);
    const catMatch = injectedControlsTsContent.match(
      /\.poexd-category-select-btn\s*\{([\s\S]*?)\n\s*\}/,
    );
    const filterMatch = injectedControlsTsContent.match(
      /\.poexd-filter-select-btn\s*\{([\s\S]*?)\n\s*\}/,
    );

    expect(inlineMatch![1]).toContain('border-radius: 0 !important');
    expect(inlineMatch![1]).not.toContain('var(--radius');

    expect(tierMatch![1]).toContain('border-radius: 0 !important');
    expect(tierMatch![1]).not.toContain('var(--radius');

    expect(catMatch![1]).not.toContain('var(--radius');
    expect(filterMatch![1]).not.toContain('var(--radius');
  });

  // 4. page-runtime-token-bridge.ts 完全移除且無殘留 imports / calls
  it('4. verifies page-runtime-token-bridge.ts is completely removed and no stale references exist', () => {
    expect(fs.existsSync(bridgeFilePath)).toBe(false);

    expect(runtimeTsContent).not.toContain('page-runtime-token-bridge');
    expect(runtimeTsContent).not.toContain('syncPageRuntimeTokenBridge');
    expect(runtimeTsContent).not.toContain('cleanupPageRuntimeTokenBridge');

    expect(commonTsContent).not.toContain('page-runtime-token-bridge');
    expect(commonTsContent).not.toContain('cleanupPageRuntimeTokenBridge');
    expect(injectedControlsTsContent).not.toContain('page-runtime-token-bridge');
    expect(injectedControlsTsContent).not.toContain('cleanupPageRuntimeTokenBridge');

    expect(tokensIndexContent).not.toContain('page-runtime-token-bridge');
  });

  // 5. createUiRuntimeTokenValues() 不再產生 --poexd-category-btn-*
  it('5. verifies createUiRuntimeTokenValues() does not produce dead --poexd-category-btn-* tokens', () => {
    const defaultTokens = createUiRuntimeTokenValues({ fontSizeScale: 1.0, densityScale: 1.0 });
    const scaledTokens = createUiRuntimeTokenValues({ fontSizeScale: 1.2, densityScale: 0.8 });

    const defaultCatKeys = Object.keys(defaultTokens).filter((k) =>
      k.startsWith('--poexd-category-btn'),
    );
    const scaledCatKeys = Object.keys(scaledTokens).filter((k) =>
      k.startsWith('--poexd-category-btn'),
    );

    expect(defaultCatKeys).toHaveLength(0);
    expect(scaledCatKeys).toHaveLength(0);
  });

  // 6. Tier slot / trigger layout geometry 保持完整
  it('6. verifies Tier slot positioning container and absolute stretch trigger contract remain intact', () => {
    const slotMatch = injectedControlsTsContent.match(
      /\.poexd-tier-trigger-slot\s*\{([\s\S]*?)\n\s*\}/,
    );
    const triggerMatch = injectedControlsTsContent.match(
      /\.poexd-tier-trigger\s*\{([\s\S]*?)\n\s*\}/,
    );

    expect(slotMatch![1]).toContain('display: table-cell !important');
    expect(slotMatch![1]).toContain('position: relative !important');
    expect(slotMatch![1]).toContain('vertical-align: middle !important');
    expect(slotMatch![1]).toContain('white-space: nowrap !important');
    expect(slotMatch![1]).toContain('width: ${HOST_TIER_TRIGGER_SPEC.widthPx}px !important');

    expect(triggerMatch![1]).toContain('position: absolute !important');
    expect(triggerMatch![1]).toContain('inset: 0 !important');
    expect(triggerMatch![1]).toContain('display: flex !important');
    expect(triggerMatch![1]).not.toContain('height: 100%');

    expect(tierHostContent).toContain('<DropdownMenuTrigger as-child>');
    expect(tierHostContent).toContain('class="btn poexd-tier-trigger"');
    expect(tierHostContent).toContain('<Teleport');
    expect(tierHostContent).toContain('activeTierSlots');
  });

  // 7. Page Theme Bridge 嚴格不輸出 Scale / Density token
  it('7. strictly prevents Page Theme Bridge from exporting any Scale or Density tokens', () => {
    const dummyHost = document.createElement('div');
    dummyHost.style.setProperty('--background', '#1e1e2e');
    dummyHost.style.setProperty('--control-height-sm', '28px');
    dummyHost.style.setProperty('--pxd-space-md', '8px');

    const themeValues = readThemeSemanticValues(dummyHost);
    const themeCss = generatePageThemeBridgeCss(themeValues);

    expect(themeCss).not.toContain('--control-height-');
    expect(themeCss).not.toContain('--control-font-');
    expect(themeCss).not.toContain('--control-icon-');
    expect(themeCss).not.toContain('--pxd-space-');
    expect(themeCss).not.toContain('fontSizeScale');
    expect(themeCss).not.toContain('densityScale');
  });
});
