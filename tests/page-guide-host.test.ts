// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref, type App } from 'vue';
import PageGuideHost from '@/components/sidebar/page-guide/PageGuideHost.vue';
import PageGuideSetupControls from '@/components/sidebar/page-guide/PageGuideSetupControls.vue';
import SettingsRow from '@/components/sidebar/settings/SettingsRow.vue';
import PageGuideOfficialResult from '@/components/sidebar/page-guide/PageGuideOfficialResult.vue';
import {
  RESULT_FEATURE_KEYS,
  type PageGuideSetupBindings,
  type ResultFeatureFlags,
} from '@/components/sidebar/page-guide/page-guide-setup';
import { usePageGuide } from '@/components/sidebar/page-guide/usePageGuide';
import { PAGE_GUIDE_TOUR_STEPS } from '@/components/sidebar/page-guide/page-guide-tour';
import { removeLeftActionsByClass } from '@/entrypoints/content/logic/result-left-actions';
import { removeAllResultEnhancementStyles } from '@/entrypoints/content/logic/result-enhancement-styles';
import { createResultTranslator } from '@/utils/market-result-translator';
import { resetI18nStateForTests, setActiveDisplayLocalePreference } from '@/utils/i18n';

/** 沒有側欄提供條件時，條件步驟（市集漢化）不會出現 */
const visibleStepCount = PAGE_GUIDE_TOUR_STEPS.filter((step) => !step.when).length;

let app: App | null = null;
let container: HTMLElement;

function mountComponent(render: () => ReturnType<typeof h>) {
  container = document.createElement('div');
  document.body.appendChild(container);
  app = createApp({ render });
  app.mount(container);
}

async function flush() {
  for (let i = 0; i < 4; i += 1) {
    await Promise.resolve();
    await nextTick();
  }
}

beforeEach(() => {
  resetI18nStateForTests();
  setActiveDisplayLocalePreference('zh-TW');
});

afterEach(async () => {
  await usePageGuide().stop();
  app?.unmount();
  app = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('PageGuideHost', () => {
  it('shows nothing while idle', () => {
    mountComponent(() => h(PageGuideHost, { portalTarget: null }));
    expect(document.querySelector('[data-page-guide-bubble]')).toBeNull();
  });

  it('renders the tour bubble with counter and moves through steps', async () => {
    const portal = document.createElement('div');
    document.body.appendChild(portal);
    mountComponent(() => h(PageGuideHost, { portalTarget: portal }));

    await usePageGuide().startTour();
    await flush();

    const bubble = portal.querySelector('[data-page-guide-bubble]');
    expect(bubble?.textContent).toContain('歡迎使用 PoeXD');
    const shortcuts = portal.querySelector('[data-page-guide-shortcuts]');
    expect(shortcuts?.textContent).toContain('←');
    expect(shortcuts?.textContent).toContain('→');
    expect(portal.querySelector('[data-page-guide-counter]')?.textContent?.trim()).toBe(
      `1 / ${visibleStepCount}`,
    );
    expect(portal.querySelector('[data-page-guide-progress]')).not.toBeNull();
    expect(portal.querySelector('[data-page-guide-action="close"]')).not.toBeNull();
    expect(portal.querySelector('[data-page-guide-blocker]')).not.toBeNull();
    expect(portal.querySelector('[data-page-guide-action="previous"]')).toBeNull();

    (portal.querySelector('[data-page-guide-action="next"]') as HTMLElement).click();
    await flush();
    expect(portal.querySelector('[data-page-guide-counter]')?.textContent?.trim()).toBe(
      `2 / ${visibleStepCount}`,
    );

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flush();
    expect(portal.querySelector('[data-page-guide-bubble]')).toBeNull();
  });

  it('blocks official page pointer events around the collapse target while keeping the cutout interactive', async () => {
    const portal = document.createElement('div');
    document.body.appendChild(portal);

    const collapseBtn = document.createElement('button');
    collapseBtn.dataset.sidebarAction = 'collapse';
    collapseBtn.getBoundingClientRect = () =>
      ({
        top: 100,
        left: 340,
        width: 28,
        height: 28,
        right: 368,
        bottom: 128,
        x: 340,
        y: 100,
        toJSON: () => ({}),
      }) as DOMRect;
    document.body.appendChild(collapseBtn);

    mountComponent(() => h(PageGuideHost, { portalTarget: portal }));

    await usePageGuide().startTour();
    await flush();
    while (usePageGuide().state.stepId !== 'collapse') {
      await usePageGuide().nextStep();
    }
    await flush();
    await new Promise((r) => setTimeout(r, 30));
    await flush();

    expect(portal.querySelector('[data-page-guide-blocker]')).toBeNull();
    const pageBlocker = portal.querySelector<HTMLElement>('[data-page-guide-page-blocker]');
    expect(pageBlocker).not.toBeNull();
    expect(pageBlocker?.getAttribute('style')).toContain('clip-path');

    collapseBtn.remove();
  });

  it('does not stop the tour on Escape when a select dropdown is open', async () => {
    const portal = document.createElement('div');
    document.body.appendChild(portal);
    mountComponent(() => h(PageGuideHost, { portalTarget: portal }));

    await usePageGuide().startTour();
    await flush();

    const openSelect = document.createElement('div');
    openSelect.setAttribute('data-slot', 'select-content');
    openSelect.setAttribute('data-state', 'open');
    portal.appendChild(openSelect);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flush();
    expect(portal.querySelector('[data-page-guide-bubble]')).not.toBeNull();

    openSelect.remove();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flush();
    expect(portal.querySelector('[data-page-guide-bubble]')).toBeNull();
  });

  it('skips the tour from the first step', async () => {
    const portal = document.createElement('div');
    document.body.appendChild(portal);
    mountComponent(() => h(PageGuideHost, { portalTarget: portal }));

    await usePageGuide().startTour();
    await flush();
    (portal.querySelector('[data-page-guide-action="skip"]') as HTMLElement).click();
    await flush();
    expect(usePageGuide().state.mode).toBe('idle');
  });

  it('does not hijack ArrowLeft/ArrowRight when an input control is focused', async () => {
    const portal = document.createElement('div');
    document.body.appendChild(portal);
    mountComponent(() => h(PageGuideHost, { portalTarget: portal }));

    await usePageGuide().startTour();
    await flush();

    const range = document.createElement('input');
    range.type = 'range';
    portal.appendChild(range);
    range.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await flush();
    expect(portal.querySelector('[data-page-guide-counter]')?.textContent?.trim()).toBe(
      `1 / ${visibleStepCount}`,
    );

    range.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flush();
    expect(usePageGuide().state.mode).toBe('idle');
  });
});

describe('SettingsRow guide button', () => {
  it('appears inside the opened details and points at the target', async () => {
    const pointAt = vi.spyOn(usePageGuide(), 'pointAt').mockResolvedValue();
    mountComponent(() =>
      h(SettingsRow, { label: '價格換算', details: '說明', guideTarget: 'result-price' }),
    );
    const button = container.querySelector<HTMLElement>('[data-settings-guide]')!;
    expect(button.style.display).toBe('none');

    container.querySelector<HTMLElement>('[data-settings-details-toggle]')!.click();
    await nextTick();
    expect(button.style.display).toBe('');
    expect(button.textContent).toContain('在頁面上指出');

    button.click();
    expect(pointAt).toHaveBeenCalledWith('result-price', '價格換算');
  });

  it('is absent without a guide target', () => {
    mountComponent(() => h(SettingsRow, { label: '主題', details: '說明' }));
    expect(container.querySelector('[data-settings-guide]')).toBeNull();
  });
});

describe('PageGuideOfficialResult', () => {
  const allOn = Object.fromEntries(RESULT_FEATURE_KEYS.map((key) => [key, true])) as Record<
    keyof ResultFeatureFlags,
    boolean
  >;

  it('renders an official-style row inside #trade that enhancers ignore', async () => {
    const trade = document.createElement('div');
    trade.id = 'trade';
    document.body.appendChild(trade);
    mountComponent(() => h(PageGuideOfficialResult, { features: allOn }));
    await flush();

    const mock = trade.querySelector<HTMLElement>('[data-poexd-guide-mock]');
    expect(mock).not.toBeNull();
    expect(mock!.classList.contains('results')).toBe(true);
    expect(mock!.matches('.results:not([data-poexd-guide-mock])')).toBe(false);
    expect(mock!.querySelector('.poexd-pob-copy-btn')).not.toBeNull();
    expect(mock!.querySelector('.poexd-pin-btn')).not.toBeNull();
    expect(mock!.querySelector('.poexd-result-link-btn')).not.toBeNull();
    expect(mock!.querySelector('.poexd-filter-mod-highlight')).not.toBeNull();
    expect(mock!.querySelectorAll('.poexd-result-mod-actions').length).toBe(3);
    expect(mock!.querySelector('.poexd-price-comparison')).not.toBeNull();
  });

  it('follows the feature switches', async () => {
    const features = ref<Record<keyof ResultFeatureFlags, boolean>>({ ...allOn });
    mountComponent(() => h(PageGuideOfficialResult, { features: features.value }));
    await flush();

    features.value = {
      ...allOn,
      enableResultPobCopy: false,
      enableResultModHighlight: false,
      enablePriceComparison: false,
    };
    await flush();

    const mock = document.querySelector<HTMLElement>('[data-poexd-guide-mock]')!;
    expect(mock.querySelector('.poexd-pob-copy-btn')).toBeNull();
    expect(mock.querySelector('.poexd-filter-mod-highlight')).toBeNull();
    expect(mock.querySelector('.poexd-price-comparison')).toBeNull();
    expect(mock.querySelector('.poexd-pin-btn')).not.toBeNull();
  });

  it('rebuilds the row when a feature comes back after a cleanup removed its nodes', async () => {
    const features = ref<Record<keyof ResultFeatureFlags, boolean>>({ ...allOn });
    mountComponent(() => h(PageGuideOfficialResult, { features: features.value }));
    await flush();

    // 全部關掉後，結果強化的清理會掃整頁移除空的按鈕容器與快篩按鈕
    features.value = {
      ...allOn,
      sidebarModulePinnedItems: false,
      enableResultPobCopy: false,
      enableResultExternalLinks: false,
      enableResultModQuickFilter: false,
    };
    await flush();
    document
      .querySelectorAll('.poexd-left-actions, .poexd-result-mod-actions')
      .forEach((el) => el.remove());

    features.value = { ...allOn };
    await flush();
    const mock = document.querySelector<HTMLElement>('[data-poexd-guide-mock]')!;
    expect(mock.querySelector('.poexd-left-actions .poexd-pob-copy-btn')).not.toBeNull();
    expect(mock.querySelectorAll('.poexd-result-mod-actions').length).toBe(3);
  });

  it('keeps mock nodes, styles, and text untouched when enhancers clean up or translator runs', async () => {
    mountComponent(() => h(PageGuideOfficialResult, { features: allOn }));
    await flush();

    removeLeftActionsByClass('poexd-pob-copy-btn');
    removeAllResultEnhancementStyles();

    const mock = document.querySelector<HTMLElement>('[data-poexd-guide-mock]')!;
    expect(mock.querySelector('.poexd-pob-copy-btn')).not.toBeNull();
    expect(mock.querySelector('.poexd-filter-mod-highlight')).not.toBeNull();
    expect(document.getElementById('poexd-result-left-actions-style')).not.toBeNull();
    expect(document.getElementById('poexd-filter-mod-highlight-style')).not.toBeNull();

    const translator = createResultTranslator({
      modLines: {},
      items: {},
      labels: { DB: '資料庫' },
    });
    translator.translate(document);
    expect(mock.querySelector('.poexd-result-link-btn')?.textContent?.trim()).toBe('DB');
  });

  it('renders English mod subtitles in the mock row when resultBilingual is enabled', async () => {
    mountComponent(() => h(PageGuideOfficialResult, { features: allOn, resultBilingual: true }));
    await flush();

    const mock = document.querySelector<HTMLElement>('[data-poexd-guide-mock]')!;
    const subtitles = mock.querySelectorAll('.poexd-result-mod-en');
    expect(subtitles).toHaveLength(3);
    expect(subtitles[0]?.textContent).toBe('Adds 20 to 31 Cold Damage');
  });

  it('matches official default vs compact layouts without 2x width overflow and reacts to layout changes', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
    const trade = document.createElement('div');
    trade.id = 'trade';
    trade.getBoundingClientRect = () =>
      ({ left: 400, top: 0, width: 1000, height: 800, right: 1400, bottom: 800 }) as DOMRect;
    const realResults = document.createElement('div');
    realResults.className = 'results';
    trade.appendChild(realResults);
    document.body.appendChild(trade);

    mountComponent(() => h(PageGuideOfficialResult, { features: allOn }));
    await flush();

    const frame = trade.querySelector<HTMLElement>('[data-page-guide-mock-frame]')!;
    const mock = trade.querySelector<HTMLElement>('[data-poexd-guide-mock]')!;
    expect(mock.classList.contains('compact')).toBe(false);
    expect(mock.classList.contains('two')).toBe(false);
    expect(mock.style.width).toBe('100%');
    expect(frame.style.width).toBe('840px');
    expect(frame.style.overflow).toBe('clip');

    realResults.className = 'results compact';
    await flush();
    expect(mock.classList.contains('compact')).toBe(true);
    expect(mock.classList.contains('two')).toBe(false);
    expect(mock.style.width).toBe('100%');
    expect(frame.style.width).toBe('620px');

    realResults.className = 'results compact two';
    await flush();
    expect(mock.classList.contains('compact')).toBe(true);
    expect(mock.classList.contains('two')).toBe(false);
    expect(frame.style.width).toBe('620px');

    realResults.className = 'results';
    await flush();
    expect(mock.classList.contains('compact')).toBe(false);
    expect(frame.style.width).toBe('840px');
  });

  it('stays clear of the left and right sidebar in default layout when #trade is narrower than 840px', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1250 });
    const trade = document.createElement('div');
    trade.id = 'trade';
    trade.getBoundingClientRect = () =>
      ({ left: 476, top: 75, width: 754, height: 500, right: 1230, bottom: 575 }) as DOMRect;
    const realResults = document.createElement('div');
    realResults.className = 'results nosort';
    trade.appendChild(realResults);
    document.body.appendChild(trade);

    document.documentElement.style.setProperty('--poexd-toast-inset-left', '471px');
    document.documentElement.style.setProperty('--poexd-toast-inset-right', '0px');

    mountComponent(() => h(PageGuideOfficialResult, { features: allOn }));
    await flush();

    const frame = trade.querySelector<HTMLElement>('[data-page-guide-mock-frame]')!;
    const mock = trade.querySelector<HTMLElement>('[data-poexd-guide-mock]')!;
    const left = Number.parseFloat(frame.style.left);
    const width = Number.parseFloat(frame.style.width);
    expect(left).toBeGreaterThanOrEqual(476);
    expect(left + width).toBeLessThanOrEqual(1230);
    expect(width).toBe(722);
    expect(mock.classList.contains('compact')).toBe(false);

    // 側邊欄在右側且可用寬度低於三欄門檻時，仍不越過側邊欄並退回精簡版面
    trade.getBoundingClientRect = () =>
      ({ left: 20, top: 75, width: 640, height: 500, right: 660, bottom: 575 }) as DOMRect;
    document.documentElement.style.setProperty('--poexd-toast-inset-left', '0px');
    document.documentElement.style.setProperty('--poexd-toast-inset-right', '580px');
    window.dispatchEvent(new Event('resize'));
    await flush();

    const rightModeLeft = Number.parseFloat(frame.style.left);
    const rightModeWidth = Number.parseFloat(frame.style.width);
    expect(rightModeLeft).toBeGreaterThanOrEqual(20);
    expect(rightModeLeft + rightModeWidth).toBeLessThanOrEqual(660);
    expect(mock.classList.contains('compact')).toBe(true);

    document.documentElement.style.removeProperty('--poexd-toast-inset-left');
    document.documentElement.style.removeProperty('--poexd-toast-inset-right');
  });
});

describe('PageGuideSetupControls market translation preview', () => {
  it('shows bilingual toggles when enabled and updates the live preview', async () => {
    const state = ref<PageGuideSetupBindings>({
      displayLocale: 'zh-TW',
      marketTranslation: false,
      marketTranslationBilingual: true,
      marketTranslationResultBilingual: false,
      reloadRequired: false,
      sidebarPosition: 'left',
      fontSizeScale: 1,
      resultFeatures: Object.fromEntries(
        RESULT_FEATURE_KEYS.map((k) => [k, true]),
      ) as ResultFeatureFlags,
      demoCursor: null,
      setDisplayLocale: vi.fn(),
      setMarketTranslation: (v) => {
        state.value = { ...state.value, marketTranslation: v };
      },
      setMarketTranslationBilingual: (v) => {
        state.value = { ...state.value, marketTranslationBilingual: v };
      },
      setMarketTranslationResultBilingual: (v) => {
        state.value = { ...state.value, marketTranslationResultBilingual: v };
      },
      setSidebarPosition: vi.fn(),
      setFontSizeScale: vi.fn(),
      setResultFeature: vi.fn(),
      replayCollapseDemo: vi.fn(),
      reload: vi.fn(),
    });

    mountComponent(() =>
      h(PageGuideSetupControls, { kind: 'market-translation', bindings: state.value }),
    );
    await flush();

    expect(container.querySelector('[data-setup-group="market-translation-bilingual"]')).toBeNull();
    const preview = () =>
      container.querySelector('[data-setup-preview="market-translation"]')?.textContent ?? '';
    expect(preview()).toContain('+# to maximum Life');
    expect(preview()).toContain('Adds 20 to 31 Cold Damage');

    state.value.setMarketTranslation(true);
    await flush();
    expect(
      container.querySelector('[data-setup-group="market-translation-bilingual"]'),
    ).not.toBeNull();
    expect(preview()).toContain('+# 最大生命 (+# to maximum Life)');
    expect(container.querySelector('[data-setup-preview-en]')).toBeNull();

    state.value.setMarketTranslationResultBilingual(true);
    await flush();
    expect(container.querySelector('[data-setup-preview-en]')?.textContent?.trim()).toBe(
      'Adds 20 to 31 Cold Damage',
    );
    expect(preview()).toContain('附加 20 至 31 冰冷傷害');

    state.value = { ...state.value, displayLocale: 'zh-CN' };
    await flush();
    expect(preview()).toContain('附加 20 至 31 冰霜伤害');
  });

  it('toggles compact density and pure background in the appearance setup step', async () => {
    const state = ref<PageGuideSetupBindings>({
      displayLocale: 'zh-TW',
      marketTranslation: false,
      marketTranslationBilingual: true,
      marketTranslationResultBilingual: false,
      reloadRequired: false,
      sidebarPosition: 'left',
      fontSizeScale: 1,
      compactDensity: false,
      enablePureBackground: false,
      resultFeatures: Object.fromEntries(
        RESULT_FEATURE_KEYS.map((k) => [k, true]),
      ) as ResultFeatureFlags,
      demoCursor: null,
      setDisplayLocale: vi.fn(),
      setMarketTranslation: vi.fn(),
      setMarketTranslationBilingual: vi.fn(),
      setMarketTranslationResultBilingual: vi.fn(),
      setSidebarPosition: vi.fn(),
      setFontSizeScale: vi.fn(),
      setCompactDensity: (v) => {
        state.value = { ...state.value, compactDensity: v };
      },
      setEnablePureBackground: (v) => {
        state.value = { ...state.value, enablePureBackground: v };
      },
      setResultFeature: vi.fn(),
      replayCollapseDemo: vi.fn(),
      reload: vi.fn(),
    });

    mountComponent(() => h(PageGuideSetupControls, { kind: 'appearance', bindings: state.value }));
    await flush();

    const compactToggle = container.querySelector<HTMLElement>(
      '[data-setup-action="compact-density"]',
    );
    expect(compactToggle).not.toBeNull();
    expect(compactToggle?.getAttribute('aria-checked')).toBe('false');

    compactToggle?.click();
    await flush();
    expect(state.value.compactDensity).toBe(true);
    expect(compactToggle?.getAttribute('aria-checked')).toBe('true');

    const pureBgToggle = container.querySelector<HTMLElement>(
      '[data-setup-action="pure-background"]',
    );
    expect(pureBgToggle).not.toBeNull();
    expect(pureBgToggle?.getAttribute('aria-checked')).toBe('false');

    pureBgToggle?.click();
    await flush();
    expect(state.value.enablePureBackground).toBe(true);
    expect(pureBgToggle?.getAttribute('aria-checked')).toBe('true');
  });

  it('lets the mods step customize highlight style and color and reflects them on the mock result frame', async () => {
    const state = ref<PageGuideSetupBindings>({
      displayLocale: 'auto',
      marketTranslation: false,
      marketTranslationBilingual: true,
      marketTranslationResultBilingual: false,
      reloadRequired: false,
      sidebarPosition: 'left',
      fontSizeScale: 1,
      resultFeatures: Object.fromEntries(
        RESULT_FEATURE_KEYS.map((k) => [k, true]),
      ) as ResultFeatureFlags,
      resultModHighlightStyle: 'glow',
      resultModHighlightColor: 'indigo',
      demoCursor: null,
      setDisplayLocale: vi.fn(),
      setMarketTranslation: vi.fn(),
      setMarketTranslationBilingual: vi.fn(),
      setMarketTranslationResultBilingual: vi.fn(),
      setSidebarPosition: vi.fn(),
      setFontSizeScale: vi.fn(),
      setResultFeature: vi.fn(),
      setResultModHighlightStyle: (v) => {
        state.value = { ...state.value, resultModHighlightStyle: v };
      },
      setResultModHighlightColor: (v) => {
        state.value = { ...state.value, resultModHighlightColor: v };
      },
      replayCollapseDemo: vi.fn(),
      reload: vi.fn(),
    });

    mountComponent(() =>
      h('div', [
        h(PageGuideSetupControls, {
          kind: 'result-features',
          focus: 'mods',
          bindings: state.value,
        }),
        h(PageGuideOfficialResult, {
          features: state.value.resultFeatures,
          highlightStyle: state.value.resultModHighlightStyle,
          highlightColor: state.value.resultModHighlightColor,
        }),
      ]),
    );
    await flush();

    const frame = document.querySelector<HTMLElement>('[data-page-guide-mock-frame]');
    expect(frame?.getAttribute('data-poexd-mod-highlight-style')).toBe('glow');
    expect(frame?.getAttribute('data-poexd-mod-highlight-color')).toBe('indigo');

    container.querySelector<HTMLButtonElement>('[data-setup-highlight-style="bar"]')?.click();
    container.querySelector<HTMLButtonElement>('[data-setup-highlight-color="gold"]')?.click();
    await flush();

    expect(state.value.resultModHighlightStyle).toBe('bar');
    expect(state.value.resultModHighlightColor).toBe('gold');
    expect(frame?.getAttribute('data-poexd-mod-highlight-style')).toBe('bar');
    expect(frame?.getAttribute('data-poexd-mod-highlight-color')).toBe('gold');
  });

  it('opens and closes non-blocking official result preview via usePageGuide preview mode', async () => {
    const guide = usePageGuide();
    const portal = document.createElement('div');
    document.body.appendChild(portal);

    const setup: PageGuideSetupBindings = {
      displayLocale: 'auto',
      marketTranslation: false,
      marketTranslationBilingual: true,
      marketTranslationResultBilingual: false,
      reloadRequired: false,
      sidebarPosition: 'left',
      fontSizeScale: 1,
      resultFeatures: Object.fromEntries(
        RESULT_FEATURE_KEYS.map((k) => [k, true]),
      ) as ResultFeatureFlags,
      resultModHighlightStyle: 'subtle',
      resultModHighlightColor: 'emerald',
      demoCursor: null,
      setDisplayLocale: vi.fn(),
      setMarketTranslation: vi.fn(),
      setMarketTranslationBilingual: vi.fn(),
      setMarketTranslationResultBilingual: vi.fn(),
      setSidebarPosition: vi.fn(),
      setFontSizeScale: vi.fn(),
      setResultFeature: vi.fn(),
      replayCollapseDemo: vi.fn(),
      reload: vi.fn(),
    };

    mountComponent(() => h(PageGuideHost, { portalTarget: portal, setup }));
    await flush();

    guide.openResultPreview('mods');
    await flush();

    expect(guide.state.mode).toBe('preview');
    expect(portal.querySelector('[data-page-guide-blocker]')).toBeNull();
    const frame = document.querySelector<HTMLElement>('[data-page-guide-mock-frame]');
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute('data-poexd-mod-highlight-style')).toBe('subtle');
    expect(frame?.getAttribute('data-poexd-mod-highlight-color')).toBe('emerald');

    guide.closeResultPreview();
    await flush();

    expect(guide.state.mode).toBe('idle');
    expect(document.querySelector('[data-page-guide-mock-frame]')).toBeNull();
    portal.remove();
  });
});
