// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import LiveSearchDroppedPanel from '@/components/sidebar/live-search/LiveSearchDroppedPanel.vue';
import LiveSearchConsoleSettingsPane from '@/components/sidebar/LiveSearchConsoleSettingsPane.vue';
import type { LiveSearchDroppedGroup } from '@/utils/live-search-contract';
import { DEFAULT_PREFERENCES, type Preferences, type PreferencesModule } from '@/utils/preferences';

let app: App | undefined;
let container: HTMLElement | undefined;

afterEach(() => {
  app?.unmount();
  app = undefined;
  container?.remove();
  container = undefined;
  vi.restoreAllMocks();
});

function makeDroppedGroup(overrides?: Partial<LiveSearchDroppedGroup>): LiveSearchDroppedGroup {
  return {
    ownerKey: 'poe1|standard|search_a',
    searchId: 'search_A',
    league: 'Standard',
    gameVersion: 'poe1',
    sourceName: '高價珠寶',
    total: 3,
    counts: { 'rate-limit-cooldown': 3, expired: 0 },
    lastDroppedAt: Date.now() - 10_000,
    ...overrides,
  };
}

function createFakePreferences(): PreferencesModule {
  let state: Preferences = { ...DEFAULT_PREFERENCES };
  const listeners = new Set<(snapshot: Readonly<Preferences>) => void>();
  return {
    read: () => state,
    update: async (patch) => {
      state = { ...state, ...patch };
      for (const listener of listeners) listener(state);
      return { ok: true, changed: true };
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

describe('LiveSearchDroppedPanel', () => {
  it('renders nothing when there are no dropped groups', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    app = createApp(LiveSearchDroppedPanel, { groups: [] });
    app.mount(container);

    expect(container.querySelector('[data-test="dropped-items-panel"]')).toBeNull();
  });

  it('sums counts per search, shows the reason breakdown, and emits dismiss and clear events', async () => {
    const onDismissGroup = vi.fn();
    const onClearAll = vi.fn();
    const resolveSourceName = vi.fn((key: string) =>
      key === 'poe1|standard|search_a' ? '覆寫名稱' : undefined,
    );

    container = document.createElement('div');
    document.body.appendChild(container);
    app = createApp(LiveSearchDroppedPanel, {
      groups: [
        makeDroppedGroup(),
        makeDroppedGroup({
          ownerKey: 'poe1|standard|search_b',
          searchId: 'search_B',
          sourceName: undefined,
          total: 2,
          counts: { 'rate-limit-cooldown': 1, expired: 1 },
        }),
      ],
      resolveSourceName,
      'onDismiss-group': onDismissGroup,
      'onClear-all': onClearAll,
    });
    app.mount(container);

    expect(container.querySelector('[data-test="dropped-items-panel"]')).not.toBeNull();
    expect(container.querySelector('[data-test="dropped-items-count"]')?.textContent).toContain(
      '5',
    );
    const list = container.querySelector('[data-test="dropped-items-list"]') as HTMLElement;
    expect(list.style.display).toBe('none');

    (
      container.querySelector('[data-test="btn-toggle-dropped-items"]') as HTMLButtonElement
    ).click();
    await nextTick();
    expect(list.style.display).not.toBe('none');

    const rows = Array.from(container.querySelectorAll('[data-test="dropped-group-row"]'));
    expect(rows).toHaveLength(2);
    const text = (row: Element, testId: string) =>
      row.querySelector(`[data-test="${testId}"]`)?.textContent?.trim();
    expect(text(rows[0]!, 'dropped-group-source')).toBe('覆寫名稱');
    expect(text(rows[0]!, 'dropped-group-total')).toBe('3');
    // 只列出有發生的原因：第 1 列只有冷卻過久，第 2 列兩種原因都有
    const separators = (row: Element) => text(row, 'dropped-group-breakdown')?.split('·').length;
    expect(separators(rows[0]!)).toBe(2);
    expect(separators(rows[1]!)).toBe(3);
    expect(text(rows[1]!, 'dropped-group-source')).toBe('search_B');
    expect(text(rows[1]!, 'dropped-group-total')).toBe('2');

    // 推播 token 只有數秒效期，略過的項目無法補抓，不提供補抓按鈕
    expect(container.querySelector('[data-test="btn-fetch-dropped-item"]')).toBeNull();

    (
      rows[1]!.querySelector('[data-test="btn-dismiss-dropped-group"]') as HTMLButtonElement
    ).click();
    expect(onDismissGroup).toHaveBeenCalledWith('poe1|standard|search_b');

    (container.querySelector('[data-test="btn-clear-dropped-items"]') as HTMLButtonElement).click();
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });
});

describe('LiveSearchConsoleSettingsPane rate limit policy preferences', () => {
  it('updates liveSearchFetchOrder and liveSearchTokenMaxAgeSec preferences', async () => {
    const prefs = createFakePreferences();
    container = document.createElement('div');
    document.body.appendChild(container);
    app = createApp(LiveSearchConsoleSettingsPane, { preferences: prefs });
    app.mount(container);
    await nextTick();

    expect(prefs.read().liveSearchFetchOrder).toBe('newest');
    expect(prefs.read().liveSearchTokenMaxAgeSec).toBe(3);
    expect(container.querySelector('[data-test="pref-token-max-age"]')).toBeNull();

    (container.querySelector('[data-test="pref-fetch-order-oldest"]') as HTMLButtonElement).click();
    await nextTick();
    expect(prefs.read().liveSearchFetchOrder).toBe('oldest');

    const decBtn = container.querySelector(
      '[data-test="pref-token-max-age-decrease"]',
    ) as HTMLButtonElement;
    const incBtn = container.querySelector(
      '[data-test="pref-token-max-age-increase"]',
    ) as HTMLButtonElement;
    const input = container.querySelector(
      '[data-test="pref-token-max-age-input"]',
    ) as HTMLInputElement;

    // 加減號微調
    incBtn.click();
    await nextTick();
    expect(prefs.read().liveSearchTokenMaxAgeSec).toBe(4);
    expect(input.value).toBe('4');

    decBtn.click();
    await nextTick();
    expect(prefs.read().liveSearchTokenMaxAgeSec).toBe(3);

    // 自訂任意秒數（例如 45 秒）
    input.value = '45';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await nextTick();
    expect(prefs.read().liveSearchTokenMaxAgeSec).toBe(45);

    // 超出上限自動 clamp 至 300 秒
    input.value = '999';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await nextTick();
    expect(prefs.read().liveSearchTokenMaxAgeSec).toBe(300);
    expect(input.value).toBe('300');
    expect(incBtn.disabled).toBe(true);

    // 設為 0 時減號 disabled
    input.value = '0';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await nextTick();
    expect(prefs.read().liveSearchTokenMaxAgeSec).toBe(0);
    expect(decBtn.disabled).toBe(true);
  });
});
