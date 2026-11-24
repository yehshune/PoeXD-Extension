// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import LiveSearchDroppedPanel from '@/components/sidebar/live-search/LiveSearchDroppedPanel.vue';
import LiveSearchConsoleSettingsPane from '@/components/sidebar/LiveSearchConsoleSettingsPane.vue';
import type { LiveSearchDroppedItem } from '@/utils/live-search-contract';
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

function makeDroppedItem(overrides?: Partial<LiveSearchDroppedItem>): LiveSearchDroppedItem {
  return {
    id: 'drop_1',
    subscriptionId: 'sub_1',
    ownerKey: 'poe1|standard|search_a',
    searchId: 'search_A',
    league: 'Standard',
    gameVersion: 'poe1',
    sourceName: '高價珠寶',
    token: 'tk_1',
    receivedAt: Date.now() - 12_000,
    droppedAt: Date.now() - 10_000,
    reason: 'rate-limit-cooldown',
    status: 'dropped',
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
  it('renders nothing when there are no dropped items', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    app = createApp(LiveSearchDroppedPanel, { items: [] });
    app.mount(container);

    expect(container.querySelector('[data-test="dropped-items-panel"]')).toBeNull();
  });

  it('expands to show dropped items and emits fetch, dismiss, and clear events', async () => {
    const onFetchItem = vi.fn();
    const onDismissItem = vi.fn();
    const onClearAll = vi.fn();
    const resolveSourceName = vi.fn((key: string) =>
      key === 'poe1|standard|search_a' ? '覆寫名稱' : undefined,
    );

    container = document.createElement('div');
    document.body.appendChild(container);
    app = createApp(LiveSearchDroppedPanel, {
      items: [
        makeDroppedItem({ id: 'drop_1', status: 'dropped' }),
        makeDroppedItem({ id: 'drop_2', status: 'failed', reason: 'expired' }),
      ],
      resolveSourceName,
      'onFetch-item': onFetchItem,
      'onDismiss-item': onDismissItem,
      'onClear-all': onClearAll,
    });
    app.mount(container);

    expect(container.querySelector('[data-test="dropped-items-panel"]')).not.toBeNull();
    const list = container.querySelector('[data-test="dropped-items-list"]') as HTMLElement;
    expect(list.style.display).toBe('none');

    (
      container.querySelector('[data-test="btn-toggle-dropped-items"]') as HTMLButtonElement
    ).click();
    await nextTick();
    expect(list.style.display).not.toBe('none');

    const rows = Array.from(container.querySelectorAll('[data-test="dropped-item-row"]'));
    expect(rows).toHaveLength(2);
    expect(rows[0]!.querySelector('[data-test="dropped-item-source"]')?.textContent?.trim()).toBe(
      '覆寫名稱',
    );

    (rows[0]!.querySelector('[data-test="btn-fetch-dropped-item"]') as HTMLButtonElement).click();
    expect(onFetchItem).toHaveBeenCalledWith('drop_1');

    (rows[1]!.querySelector('[data-test="btn-dismiss-dropped-item"]') as HTMLButtonElement).click();
    expect(onDismissItem).toHaveBeenCalledWith('drop_2');

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
