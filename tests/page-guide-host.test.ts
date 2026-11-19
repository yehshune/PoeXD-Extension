// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import PageGuideHost from '@/components/sidebar/page-guide/PageGuideHost.vue';
import SettingsRow from '@/components/sidebar/settings/SettingsRow.vue';
import WelcomeCard from '@/components/sidebar/WelcomeCard.vue';
import { usePageGuide } from '@/components/sidebar/page-guide/usePageGuide';
import { PAGE_GUIDE_TOUR_STEPS } from '@/components/sidebar/page-guide/page-guide-tour';
import { resetI18nStateForTests, setActiveDisplayLocalePreference } from '@/utils/i18n';

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
    expect(bubble?.textContent).toContain('側邊欄');
    expect(portal.querySelector('[data-page-guide-counter]')?.textContent?.trim()).toBe(
      `1 / ${PAGE_GUIDE_TOUR_STEPS.length}`,
    );
    expect(portal.querySelector('[data-page-guide-blocker]')).not.toBeNull();
    expect(portal.querySelector('[data-page-guide-action="previous"]')).toBeNull();

    (portal.querySelector('[data-page-guide-action="next"]') as HTMLElement).click();
    await flush();
    expect(portal.querySelector('[data-page-guide-counter]')?.textContent?.trim()).toBe(
      `2 / ${PAGE_GUIDE_TOUR_STEPS.length}`,
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

describe('WelcomeCard', () => {
  it('emits startTour from its tour button', () => {
    const onStartTour = vi.fn();
    mountComponent(() =>
      h(WelcomeCard, {
        showMarketTranslation: false,
        marketTranslation: false,
        reloadRequired: false,
        onStartTour,
      }),
    );
    container.querySelector<HTMLElement>('[data-onboarding-action="start-tour"]')!.click();
    expect(onStartTour).toHaveBeenCalledOnce();
  });
});
