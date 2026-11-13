// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RESULT_MOD_QUICK_FILTER_ACTIONS_CLASS,
  RESULT_MOD_QUICK_FILTER_BUTTON_CLASS,
  RESULT_MOD_QUICK_FILTER_HOST_CLASS,
  ResultModQuickFilter,
} from '@/entrypoints/content/logic/result-mod-quick-filter';
import type { CriteriaOverlayPageChannel } from '@/entrypoints/content/logic/criteria-overlay-session';
import { initPoeEventNonce, listenPoeEvent, type PoeToastDetail } from '@/utils/event-contracts';
import { setActiveDisplayLocalePreference } from '@/utils/i18n';

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function mountSampleResults(): HTMLElement {
  document.body.innerHTML = `
    <div id="trade">
      <div class="results compact two">
        <div class="row" data-id="item-1">
          <div class="property"><span class="s" data-field="ilvl">Item Level: 82</span></div>
          <div class="explicitMod">
            <span class="lc l"><span class="d">+65</span></span>
            <span class="s" data-field="stat.explicit.stat_3299347043">+65 to maximum Life</span>
          </div>
          <div class="explicitMod">
            <span class="lc l"><span class="d">Tier 1</span></span>
            <span class="s" data-field="stat.explicit.stat_3891355829|1">Allocates Something</span>
          </div>
          <div class="item-popup__property--skill">
            <span class="s" data-field="stat.skill.parry">Grants Skill: Parry</span>
          </div>
        </div>
      </div>
    </div>
  `;
  return document.querySelector('.results') as HTMLElement;
}

describe('ResultModQuickFilter', () => {
  let toasts: PoeToastDetail[];
  let stopListeningToast: (() => void) | null;
  let channel: {
    read: ReturnType<typeof vi.fn>;
    commit: ReturnType<typeof vi.fn>;
  };
  let quickFilter: ResultModQuickFilter;

  beforeEach(() => {
    toasts = [];
    initPoeEventNonce('test-nonce');
    stopListeningToast = listenPoeEvent('poexd-toast', (detail) => toasts.push(detail));
    channel = {
      read: vi.fn().mockResolvedValue({
        snapshot: { stats: [{ type: 'and', filters: [] }] },
        knownStatIds: new Set([
          'explicit.stat_3299347043',
          'explicit.stat_3891355829|1',
          'skill.parry',
        ]),
      }),
      commit: vi.fn().mockResolvedValue(undefined),
    };
    quickFilter = new ResultModQuickFilter({
      channel: channel as unknown as CriteriaOverlayPageChannel,
      isSearchFormUrl: () => true,
      resolveStatText: (id) =>
        id === 'explicit.stat_3299347043' ? '+# to maximum Life' : undefined,
    });
  });

  afterEach(() => {
    setActiveDisplayLocalePreference('zh-TW');
    quickFilter.cleanup();
    stopListeningToast?.();
    document.body.innerHTML = '';
    document.head.innerHTML = '';
  });

  it('injects hover-only +AND and +NOT buttons only on stat.* fields and stays idempotent', () => {
    const results = mountSampleResults();
    quickFilter.apply(results);
    quickFilter.apply(results);

    const actions = document.querySelectorAll(`.${RESULT_MOD_QUICK_FILTER_ACTIONS_CLASS}`);
    expect(actions).toHaveLength(3);
    expect(Array.from(actions).map((el) => el.getAttribute('data-poexd-stat-id'))).toEqual([
      'explicit.stat_3299347043',
      'explicit.stat_3891355829|1',
      'skill.parry',
    ]);
    expect(document.querySelectorAll(`.${RESULT_MOD_QUICK_FILTER_HOST_CLASS}`)).toHaveLength(3);
    expect(
      document
        .querySelector('[data-field="ilvl"]')
        ?.parentElement?.classList.contains(RESULT_MOD_QUICK_FILTER_HOST_CLASS),
    ).toBe(false);

    const styleEl = document.getElementById('poexd-result-mod-quick-filter-style');
    expect(styleEl?.textContent).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(styleEl?.textContent).toContain('opacity: 0;');
    expect(styleEl?.textContent).toContain('pointer-events: none;');
    expect(styleEl?.textContent).toContain(':hover > .lc.l');
    expect(styleEl?.textContent).toContain(':hover > .lc.r');
  });

  it('adds stat to AND or NOT via channel commit without bubbling click to official DOM', async () => {
    const results = mountSampleResults();
    quickFilter.apply(results);

    const host = document.querySelector('[data-field="stat.explicit.stat_3299347043"]')!
      .parentElement as HTMLElement;
    const parentClickSpy = vi.fn();
    host.addEventListener('click', parentClickSpy);

    const andBtn = host.querySelector<HTMLButtonElement>(
      `.${RESULT_MOD_QUICK_FILTER_BUTTON_CLASS}[data-poexd-quick-group="and"]`,
    )!;
    andBtn.click();
    await flushMicrotasks();

    expect(parentClickSpy).not.toHaveBeenCalled();
    expect(channel.commit).toHaveBeenCalledTimes(1);
    expect(channel.commit).toHaveBeenCalledWith([
      {
        kind: 'setStatFilter',
        group: 0,
        filter: { id: 'explicit.stat_3299347043', disabled: false },
      },
    ]);
    expect(toasts[0]?.tone).toBe('success');
    expect(toasts[0]?.message).toContain('「和」');

    const notBtn = host.querySelector<HTMLButtonElement>(
      `.${RESULT_MOD_QUICK_FILTER_BUTTON_CLASS}[data-poexd-quick-group="not"]`,
    )!;
    notBtn.click();
    await flushMicrotasks();

    expect(channel.commit).toHaveBeenLastCalledWith([
      {
        kind: 'pushStatGroup',
        type: 'not',
        filters: [{ id: 'explicit.stat_3299347043', disabled: false }],
      },
    ]);
    expect(toasts[1]?.tone).toBe('success');
    expect(toasts[1]?.message).toContain('「不」');
  });

  it('localizes button labels across zh-TW, zh-CN, and en on refreshLocale()', () => {
    const results = mountSampleResults();
    quickFilter.apply(results);

    const getFirstLabels = () =>
      Array.from(
        document
          .querySelector('[data-field="stat.explicit.stat_3299347043"]')!
          .parentElement!.querySelectorAll<HTMLButtonElement>(
            `.${RESULT_MOD_QUICK_FILTER_BUTTON_CLASS}`,
          ),
      ).map((btn) => ({ text: btn.textContent, title: btn.title }));

    expect(getFirstLabels()).toEqual([
      { text: '+和', title: '加入「和」篩選條件' },
      { text: '+不', title: '加入「不」排除條件' },
    ]);

    setActiveDisplayLocalePreference('zh-CN');
    quickFilter.refreshLocale();
    expect(getFirstLabels()).toEqual([
      { text: '+和', title: '加入「和」筛选条件' },
      { text: '+不', title: '加入「不」排除条件' },
    ]);

    setActiveDisplayLocalePreference('en');
    quickFilter.refreshLocale();
    expect(getFirstLabels()).toEqual([
      { text: '+AND', title: 'Add to AND filter' },
      { text: '+NOT', title: 'Add to NOT filter' },
    ]);
  });

  it('skips commit and emits info/error toast for existing or unknown stats', async () => {
    const results = mountSampleResults();
    quickFilter.apply(results);

    channel.read.mockResolvedValueOnce({
      snapshot: { stats: [{ type: 'and', filters: [{ id: 'explicit.stat_3299347043' }] }] },
      knownStatIds: new Set(['explicit.stat_3299347043']),
    });
    const host = document.querySelector('[data-field="stat.explicit.stat_3299347043"]')!
      .parentElement as HTMLElement;
    host.querySelector<HTMLButtonElement>('[data-poexd-quick-group="and"]')!.click();
    await flushMicrotasks();

    expect(channel.commit).not.toHaveBeenCalled();
    expect(toasts[0]?.tone).toBe('default');

    channel.read.mockResolvedValueOnce({
      snapshot: { stats: [{ type: 'and', filters: [] }] },
      knownStatIds: new Set(['other.stat']),
    });
    host.querySelector<HTMLButtonElement>('[data-poexd-quick-group="not"]')!.click();
    await flushMicrotasks();

    expect(channel.commit).not.toHaveBeenCalled();
    expect(toasts[1]?.tone).toBe('error');
  });

  it('disables and cleans up on live-search-primary, non-search mode, or non-search URL', () => {
    const results = mountSampleResults();
    quickFilter.apply(results);
    expect(document.querySelectorAll(`.${RESULT_MOD_QUICK_FILTER_ACTIONS_CLASS}`)).toHaveLength(3);

    quickFilter.setPageRole('live-search-primary');
    expect(document.querySelectorAll(`.${RESULT_MOD_QUICK_FILTER_ACTIONS_CLASS}`)).toHaveLength(0);
    expect(document.querySelectorAll(`.${RESULT_MOD_QUICK_FILTER_HOST_CLASS}`)).toHaveLength(0);

    quickFilter.setPageRole('normal');
    expect(document.querySelectorAll(`.${RESULT_MOD_QUICK_FILTER_ACTIONS_CLASS}`)).toHaveLength(3);

    quickFilter.setPageMode('live');
    expect(document.querySelectorAll(`.${RESULT_MOD_QUICK_FILTER_ACTIONS_CLASS}`)).toHaveLength(0);

    const exchangeFilter = new ResultModQuickFilter({
      channel: channel as unknown as CriteriaOverlayPageChannel,
      isSearchFormUrl: () => false,
    });
    exchangeFilter.apply(results);
    expect(document.querySelectorAll(`.${RESULT_MOD_QUICK_FILTER_ACTIONS_CLASS}`)).toHaveLength(0);
    exchangeFilter.cleanup();
  });

  it('removes styles and injected elements cleanly on cleanup()', () => {
    const results = mountSampleResults();
    quickFilter.apply(results);
    expect(document.getElementById('poexd-result-mod-quick-filter-style')).not.toBeNull();

    quickFilter.cleanup();
    expect(document.getElementById('poexd-result-mod-quick-filter-style')).toBeNull();
    expect(document.querySelectorAll(`.${RESULT_MOD_QUICK_FILTER_ACTIONS_CLASS}`)).toHaveLength(0);
    expect(document.querySelectorAll(`.${RESULT_MOD_QUICK_FILTER_HOST_CLASS}`)).toHaveLength(0);
  });
});
