// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mockModsData } from './helpers/mock-mods-data';
import { createApp, nextTick } from 'vue';
import Sidebar from '@/components/Sidebar.vue';
import { dispatchPoeEvent, listenPoeEvent } from '@/utils/event-contracts';
import { registerTierSlotRefresher } from '@/utils/tier-slot-registry';

// Mock other unrelated sidebar panes to isolate Sidebar + real FilterPane
vi.mock('@/components/sidebar/BookmarkPane.vue', () => ({
  default: { name: 'BookmarkPane', template: '<div data-test="bookmark-pane"></div>' },
}));
vi.mock('@/components/sidebar/HistoryPane.vue', () => ({
  default: { name: 'HistoryPane', template: '<div data-test="history-pane"></div>' },
}));
vi.mock('@/components/sidebar/SettingsPane.vue', () => ({
  default: { name: 'SettingsPane', template: '<div data-test="settings-pane"></div>' },
}));

// Mock sortablejs
vi.mock('sortablejs', () => ({
  default: {
    create: vi.fn(() => ({ destroy: vi.fn(), option: vi.fn() })),
  },
}));

// Mock chrome extension APIs
(globalThis as any).chrome = {
  runtime: {
    getURL: vi.fn((path: string) => path),
  },
  storage: {
    local: {
      get: vi.fn(async () => ({})),
      set: vi.fn(async () => {}),
    },
    onChanged: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
};

const sampleModsData = {
  test_mod: [
    {
      id: 'stat_1',
      level: '1',
      types: ['body-armour', 'body_armours_str', 'helmet', 'boots', 'gloves', 'bow', 'shield'],
    },
  ],
};

global.fetch = vi.fn().mockImplementation(async () => ({
  ok: true,
  json: async () => sampleModsData,
}));

beforeEach(() => mockModsData(sampleModsData));

describe('Integration Regression: T-tier Dropdown -> 選擇物品類別 -> Direct Type Dialog Interaction', () => {
  let app: any = null;
  let host: HTMLElement | null = null;
  let appRoot: HTMLElement | null = null;
  let portalRoot: HTMLElement | null = null;

  beforeEach(() => {
    delete (window as any).__poexd_selecting_target__;
    host = document.createElement('div');
    host.id = 'poexd-test-host';
    document.body.appendChild(host);

    appRoot = document.createElement('div');
    appRoot.id = 'poexd-app-root';
    portalRoot = document.createElement('div');
    portalRoot.id = 'poexd-portal-root';

    host.appendChild(appRoot);
    host.appendChild(portalRoot);
  });

  afterEach(() => {
    if (app) {
      app.unmount();
      app = null;
    }
    if (host && host.parentNode) {
      host.parentNode.removeChild(host);
      host = null;
    }
    delete (window as any).__poexd_selecting_target__;
    vi.restoreAllMocks();
  });

  it('opens Type Dialog directly from T-tier request while Affix Dialog remains closed, allowing search and click replay', async () => {
    // Mount REAL Sidebar with REAL FilterPane and portalTarget
    app = createApp(Sidebar, { portalTarget: portalRoot });
    app.mount(appRoot!);
    await nextTick();
    await new Promise((r) => setTimeout(r, 60));

    const getAffixDialogContent = (): HTMLElement | null => {
      return (
        Array.from(portalRoot!.querySelectorAll<HTMLElement>('[data-slot="dialog-content"]')).find(
          (el) => el.className.includes('inset-x-[5vw]'),
        ) ?? null
      );
    };

    const getTypeDialogContent = (): HTMLElement | null => {
      return (
        Array.from(portalRoot!.querySelectorAll<HTMLElement>('[data-slot="dialog-content"]')).find(
          (el) => el.textContent?.includes('選擇物品類別'),
        ) ?? null
      );
    };

    const isAffixDialogOpen = (): boolean => {
      const el = getAffixDialogContent();
      return el !== null && el.getAttribute('data-state') === 'open';
    };

    const isTypeDialogOpen = (): boolean => {
      const el = getTypeDialogContent();
      return el !== null && el.getAttribute('data-state') === 'open';
    };

    // 1. 初始狀態：外層與內層 Dialog 均為關閉
    expect(isAffixDialogOpen()).toBe(false);
    expect(isTypeDialogOpen()).toBe(false);

    // 2. 設定 T 階目標 selecting target
    const reopenSpy = vi.fn();
    const unregisterRefresher = registerTierSlotRefresher(async (key) => {
      if (key === 'slot-nested-test') {
        reopenSpy();
        return true;
      }
      return false;
    });

    (window as any).__poexd_selecting_target__ = {
      slotKey: 'slot-nested-test',
      groupIndex: 0,
      filterIndex: 1,
      availableTypes: ['body-armour', 'bow'],
    };

    const modalActiveEvents: boolean[] = [];
    const removeModalActiveListener = listenPoeEvent('poexd-modal-active-changed', (active) => {
      modalActiveEvents.push(active);
    });

    // 3. 發送 T 階所使用的直接 Type request (poexd-trigger-select-type-modal)
    dispatchPoeEvent('poexd-trigger-select-type-modal');

    // 4. 等待 Reka UI 渲染
    await nextTick();
    await new Promise((r) => setTimeout(r, 80));
    await nextTick();

    // 5. 驗證外層 Affix Dialog 維持關閉 (全程 data-state 為 closed)
    expect(isAffixDialogOpen()).toBe(false);
    expect(getAffixDialogContent()?.getAttribute('data-state')).toBe('closed');

    // 6. 驗證「選擇物品類別」Dialog 已開啟，且收到 modal-active = true
    expect(isTypeDialogOpen()).toBe(true);
    expect(modalActiveEvents).toEqual([true]);
    const typeContent = getTypeDialogContent();
    expect(typeContent).toBeTruthy();

    // 7. 對搜尋 Input dispatch input 進行篩選
    const searchInput = typeContent!.querySelector(
      'input[placeholder="搜尋種類..."]',
    ) as HTMLInputElement;
    expect(searchInput).toBeTruthy();
    searchInput.value = '弓';
    searchInput.dispatchEvent(new Event('input'));
    await nextTick();

    expect(typeContent?.textContent).toContain('弓');

    // 8. 找到「弓」類別按鈕並執行點擊
    const bowButton = Array.from(typeContent!.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('弓'),
    );
    expect(bowButton).toBeTruthy();

    let updatedStatCategoryEvent: any = null;
    let closeAffixModalEventCount = 0;

    const removeUpdateListener = listenPoeEvent('poexd-update-stat-category', (detail) => {
      updatedStatCategoryEvent = detail;
    });
    const removeCloseListener = listenPoeEvent('poexd-close-affix-modal', () => {
      closeAffixModalEventCount++;
    });

    bowButton!.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 100));
    await nextTick();

    // 9. 驗證 click 實際生效：
    // - 發出 poexd-update-stat-category，類別為 'bow'
    expect(updatedStatCategoryEvent).toEqual({
      groupIndex: 0,
      filterIndex: 1,
      category: 'bow',
    });

    // - 全程不發出 poexd-close-affix-modal
    expect(closeAffixModalEventCount).toBe(0);

    // - 內層 Type Dialog 關閉
    expect(isTypeDialogOpen()).toBe(false);

    // - 外層 Affix Dialog 全程維持關閉
    expect(isAffixDialogOpen()).toBe(false);

    // - Type Dialog 關閉後收到 modal-active = false
    expect(modalActiveEvents).toEqual([true, false]);

    // - 透過 stable slotKey 刷新與重播原生 Trigger 原地重載
    expect(reopenSpy).toHaveBeenCalled();
    unregisterRefresher();

    removeUpdateListener();
    removeCloseListener();
    removeModalActiveListener();
  });

  it('manages aggregate modal-active ownership without race when Type Dialog opens and closes while Affix Dialog is already open', async () => {
    app = createApp(Sidebar, { portalTarget: portalRoot });
    app.mount(appRoot!);
    await nextTick();
    await new Promise((r) => setTimeout(r, 60));

    const getAffixDialogContent = (): HTMLElement | null => {
      return (
        Array.from(portalRoot!.querySelectorAll<HTMLElement>('[data-slot="dialog-content"]')).find(
          (el) => el.className.includes('inset-x-[5vw]'),
        ) ?? null
      );
    };

    const getTypeDialogContent = (): HTMLElement | null => {
      return (
        Array.from(portalRoot!.querySelectorAll<HTMLElement>('[data-slot="dialog-content"]')).find(
          (el) => el.textContent?.includes('選擇物品類別'),
        ) ?? null
      );
    };

    const isAffixDialogOpen = (): boolean => {
      const el = getAffixDialogContent();
      return el !== null && el.getAttribute('data-state') === 'open';
    };

    const isTypeDialogOpen = (): boolean => {
      const el = getTypeDialogContent();
      return el !== null && el.getAttribute('data-state') === 'open';
    };

    const modalActiveEvents: boolean[] = [];
    const removeModalActiveListener = listenPoeEvent('poexd-modal-active-changed', (active) => {
      modalActiveEvents.push(active);
    });

    // 1. 開啟 Affix Dialog -> 觸發 modal-active = true
    dispatchPoeEvent('poexd-open-affix-modal', { groupIndex: 0 });
    await nextTick();
    await new Promise((r) => setTimeout(r, 80));
    await nextTick();

    expect(isAffixDialogOpen()).toBe(true);
    expect(isTypeDialogOpen()).toBe(false);
    expect(modalActiveEvents).toEqual([true]);

    // 2. 在 Affix Dialog 已開啟情況下，喚起 Type Dialog
    (window as any).__poexd_selecting_target__ = {
      slotKey: 'slot-nested-2',
      groupIndex: 0,
      filterIndex: 1,
      availableTypes: ['body-armour', 'bow'],
    };

    dispatchPoeEvent('poexd-trigger-select-type-modal');
    await nextTick();
    await new Promise((r) => setTimeout(r, 80));
    await nextTick();

    // 雙方皆開啟，且不應產生 false 震盪或重複派發
    expect(isAffixDialogOpen()).toBe(true);
    expect(isTypeDialogOpen()).toBe(true);
    expect(modalActiveEvents).toEqual([true]);

    // 3. 關閉 Type Dialog (點選類別選項)
    const typeContent = getTypeDialogContent();
    const bowButton = Array.from(typeContent!.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('弓'),
    );
    expect(bowButton).toBeTruthy();

    bowButton!.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 100));
    await nextTick();

    // Type Dialog 已關閉，但 Affix Dialog 仍開啟 -> modal-active 仍維持 true，不觸發 false
    expect(isTypeDialogOpen()).toBe(false);
    expect(isAffixDialogOpen()).toBe(true);
    expect(modalActiveEvents).toEqual([true]);

    // 4. 最後關閉 Affix Dialog -> modal-active 變為 false
    dispatchPoeEvent('poexd-close-affix-modal');
    await nextTick();
    await new Promise((r) => setTimeout(r, 80));
    await nextTick();

    expect(isAffixDialogOpen()).toBe(false);
    expect(modalActiveEvents).toEqual([true, false]);

    removeModalActiveListener();
  });

  it('closes nested Type Dialog on first ESC while Affix Dialog remains open, then closes Affix Dialog on second ESC', async () => {
    app = createApp(Sidebar, { portalTarget: portalRoot });
    app.mount(appRoot!);
    await nextTick();
    await new Promise((r) => setTimeout(r, 60));

    const getAffixDialogContent = (): HTMLElement | null => {
      return (
        Array.from(portalRoot!.querySelectorAll<HTMLElement>('[data-slot="dialog-content"]')).find(
          (el) => el.className.includes('inset-x-[5vw]'),
        ) ?? null
      );
    };

    const getTypeDialogContent = (): HTMLElement | null => {
      return (
        Array.from(portalRoot!.querySelectorAll<HTMLElement>('[data-slot="dialog-content"]')).find(
          (el) => el.textContent?.includes('選擇物品類別'),
        ) ?? null
      );
    };

    const isAffixDialogOpen = (): boolean => {
      const el = getAffixDialogContent();
      return el !== null && el.getAttribute('data-state') === 'open';
    };

    const isTypeDialogOpen = (): boolean => {
      const el = getTypeDialogContent();
      return el !== null && el.getAttribute('data-state') === 'open';
    };

    const modalActiveEvents: boolean[] = [];
    const removeModalActiveListener = listenPoeEvent('poexd-modal-active-changed', (active) => {
      modalActiveEvents.push(active);
    });

    // 1. 開啟 Affix Dialog
    dispatchPoeEvent('poexd-open-affix-modal', { groupIndex: 0 });
    await nextTick();
    await new Promise((r) => setTimeout(r, 80));
    await nextTick();

    expect(isAffixDialogOpen()).toBe(true);
    expect(isTypeDialogOpen()).toBe(false);
    expect(modalActiveEvents).toEqual([true]);

    // 2. 從 Affix 內開啟 Type Dialog
    (window as any).__poexd_selecting_target__ = {
      slotKey: 'slot-nested-3',
      groupIndex: 0,
      filterIndex: 1,
      availableTypes: ['body-armour', 'bow'],
    };

    dispatchPoeEvent('poexd-trigger-select-type-modal');
    await nextTick();
    await new Promise((r) => setTimeout(r, 80));
    await nextTick();

    // 3. 確認：Affix = open, Type = open
    expect(isAffixDialogOpen()).toBe(true);
    expect(isTypeDialogOpen()).toBe(true);
    expect((window as any).__poexd_selecting_target__).toBeTruthy();

    // 4. 使用真實 window keydown Escape
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    // 5. 等待 Reka/Vue lifecycle settle
    await nextTick();
    await new Promise((r) => setTimeout(r, 80));
    await nextTick();

    // 6. 驗證：Type = closed, Affix = open, selecting target 正常清除, modal-active 沒有變 false
    expect(isTypeDialogOpen()).toBe(false);
    expect(isAffixDialogOpen()).toBe(true);
    expect((window as any).__poexd_selecting_target__).toBeNull();
    expect(modalActiveEvents).toEqual([true]);

    // 7. 再送第二次 ESC
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    // 等待 settle
    await nextTick();
    await new Promise((r) => setTimeout(r, 80));
    await nextTick();

    // 8. 驗證：Affix = closed, modal-active 此時才變 false
    expect(isAffixDialogOpen()).toBe(false);
    expect(modalActiveEvents).toEqual([true, false]);

    removeModalActiveListener();
  });

  it('handles 3-layer dialog priority: Shared -> Type -> Affix on consecutive ESC keys', async () => {
    app = createApp(Sidebar, { portalTarget: portalRoot });
    app.mount(appRoot!);
    await nextTick();
    await new Promise((r) => setTimeout(r, 60));

    const getAffixDialogContent = (): HTMLElement | null => {
      return (
        Array.from(portalRoot!.querySelectorAll<HTMLElement>('[data-slot="dialog-content"]')).find(
          (el) => el.className.includes('inset-x-[5vw]'),
        ) ?? null
      );
    };

    const getTypeDialogContent = (): HTMLElement | null => {
      return (
        Array.from(portalRoot!.querySelectorAll<HTMLElement>('[data-slot="dialog-content"]')).find(
          (el) => el.textContent?.includes('選擇物品類別'),
        ) ?? null
      );
    };

    const getSharedDialogContent = (): HTMLElement | null => {
      return (
        Array.from(portalRoot!.querySelectorAll<HTMLElement>('[data-slot="dialog-content"]')).find(
          (el) =>
            el.className.includes('w-[var(--pxd-sidebar-shared-dialog-width)]') ||
            el.textContent?.includes('三層測試確認'),
        ) ?? null
      );
    };

    const isAffixDialogOpen = (): boolean => {
      const el = getAffixDialogContent();
      return el !== null && el.getAttribute('data-state') === 'open';
    };

    const isTypeDialogOpen = (): boolean => {
      const el = getTypeDialogContent();
      return el !== null && el.getAttribute('data-state') === 'open';
    };

    const modalActiveEvents: boolean[] = [];
    const removeModalActiveListener = listenPoeEvent('poexd-modal-active-changed', (active) => {
      modalActiveEvents.push(active);
    });

    // 1. 開啟 Affix Dialog
    dispatchPoeEvent('poexd-open-affix-modal', { groupIndex: 0 });
    await nextTick();
    await new Promise((r) => setTimeout(r, 80));

    // 2. 開啟 Type Dialog
    (window as any).__poexd_selecting_target__ = {
      slotKey: 'slot-nested-4',
      groupIndex: 0,
      filterIndex: 1,
      availableTypes: ['body-armour'],
    };
    dispatchPoeEvent('poexd-trigger-select-type-modal');
    await nextTick();
    await new Promise((r) => setTimeout(r, 80));

    // 3. 開啟 Shared Dialog
    let confirmResolved: any = null;
    (window as any).poexdConfirm('三層測試確認').then((val: any) => {
      confirmResolved = val;
    });
    await nextTick();
    await new Promise((r) => setTimeout(r, 80));

    expect(isAffixDialogOpen()).toBe(true);
    expect(isTypeDialogOpen()).toBe(true);
    expect(confirmResolved).toBeNull();
    expect(modalActiveEvents).toEqual([true]);

    // 4. Portal DOM order regression gate (Visual Stacking SSOT: Affix < Type < Shared)
    const affixContent = getAffixDialogContent();
    const typeContent = getTypeDialogContent();
    const sharedContent = getSharedDialogContent();

    expect(affixContent).toBeTruthy();
    expect(typeContent).toBeTruthy();
    expect(sharedContent).toBeTruthy();

    expect(portalRoot!.contains(affixContent)).toBe(true);
    expect(portalRoot!.contains(typeContent)).toBe(true);
    expect(portalRoot!.contains(sharedContent)).toBe(true);

    const affixOverlay = affixContent!.previousElementSibling as HTMLElement | null;
    const typeOverlay = typeContent!.previousElementSibling as HTMLElement | null;
    const sharedOverlay = sharedContent!.previousElementSibling as HTMLElement | null;

    expect(affixOverlay?.getAttribute('data-slot')).toBe('dialog-overlay');
    expect(typeOverlay?.getAttribute('data-slot')).toBe('dialog-overlay');
    expect(sharedOverlay?.getAttribute('data-slot')).toBe('dialog-overlay');

    // Semantic Stacking: Overlay and Content share matching layer classes
    // Base layer (Affix Dialog): z-50
    expect(affixContent!.classList.contains('z-50')).toBe(true);
    expect(affixOverlay!.classList.contains('z-50')).toBe(true);

    // Nested layer (Type Dialog): z-[60]
    expect(typeContent!.classList.contains('z-[60]')).toBe(true);
    expect(typeOverlay!.classList.contains('z-[60]')).toBe(true);

    // System layer (Shared Dialog): z-[70]
    expect(sharedContent!.classList.contains('z-[70]')).toBe(true);
    expect(sharedOverlay!.classList.contains('z-[70]')).toBe(true);

    // ESC #1 -> 關閉 Shared Dialog
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextTick();
    await new Promise((r) => setTimeout(r, 80));
    await nextTick();

    expect(confirmResolved).toBe(false);
    expect(isTypeDialogOpen()).toBe(true);
    expect(isAffixDialogOpen()).toBe(true);
    expect(modalActiveEvents).toEqual([true]);

    // ESC #2 -> 關閉 Type Dialog
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextTick();
    await new Promise((r) => setTimeout(r, 80));
    await nextTick();

    expect(isTypeDialogOpen()).toBe(false);
    expect(isAffixDialogOpen()).toBe(true);
    expect((window as any).__poexd_selecting_target__).toBeNull();
    expect(modalActiveEvents).toEqual([true]);

    // ESC #3 -> 關閉 Affix Dialog
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextTick();
    await new Promise((r) => setTimeout(r, 80));
    await nextTick();

    expect(isAffixDialogOpen()).toBe(false);
    expect(modalActiveEvents).toEqual([true, false]);

    removeModalActiveListener();
  });
});
