// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref, type App } from 'vue';
import PageGuideHost from '@/components/sidebar/page-guide/PageGuideHost.vue';
import SettingsRow from '@/components/sidebar/settings/SettingsRow.vue';
import PageGuideOfficialResult from '@/components/sidebar/page-guide/PageGuideOfficialResult.vue';
import {
  RESULT_FEATURE_KEYS,
  type ResultFeatureFlags,
} from '@/components/sidebar/page-guide/page-guide-setup';
import { usePageGuide } from '@/components/sidebar/page-guide/usePageGuide';
import { PAGE_GUIDE_TOUR_STEPS } from '@/components/sidebar/page-guide/page-guide-tour';
import { removeLeftActionsByClass } from '@/entrypoints/content/logic/result-left-actions';
import { ResultModHighlighter } from '@/entrypoints/content/logic/result-mod-highlighter';
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
    expect(bubble?.textContent).toContain('選擇語言');
    expect(portal.querySelector('[data-page-guide-counter]')?.textContent?.trim()).toBe(
      `1 / ${visibleStepCount}`,
    );
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
    const highlighter = new ResultModHighlighter();
    highlighter.cleanup();

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
});
