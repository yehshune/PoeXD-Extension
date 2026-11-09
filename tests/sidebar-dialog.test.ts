// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick } from 'vue';
import Sidebar from '@/components/Sidebar.vue';
import { dispatchPoeEvent, listenPoeEvent } from '@/utils/event-contracts';
import { createUiRuntimeTokenValues } from '@/lib/tokens';

const sidebarSource = readFileSync('components/Sidebar.vue', 'utf8');
const dialogContentSource = readFileSync('components/ui/dialog/DialogContent.vue', 'utf8');

// Mock child components of Sidebar to isolate Sidebar and Dialog testing
vi.mock('@/components/sidebar/BookmarkPane.vue', () => ({
  default: { name: 'BookmarkPane', template: '<div data-test="bookmark-pane"></div>' },
}));
vi.mock('@/components/sidebar/FilterPane.vue', () => ({
  default: { name: 'FilterPane', template: '<div data-test="filter-pane"></div>' },
}));
vi.mock('@/components/sidebar/HistoryPane.vue', () => ({
  default: { name: 'HistoryPane', template: '<div data-test="history-pane"></div>' },
}));
vi.mock('@/components/sidebar/SettingsPane.vue', () => ({
  default: { name: 'SettingsPane', template: '<div data-test="settings-pane"></div>' },
}));

// Mock preferences and chrome storage
vi.mock('@/utils/preferences', () => ({
  DEFAULT_PREFERENCES: {
    sidebarPosition: 'left',
    sidebarSize: 'medium',
    sidebarWidth: 340,
    fontSizeScale: 1,
    densityScale: 1,
  },
  getPreferences: vi.fn(async () => ({
    ok: true,
    value: {
      subscribe: vi.fn(() => () => {}),
      getSnapshot: vi.fn(() => ({
        sidebarPosition: 'left',
        sidebarSize: 'medium',
        sidebarWidth: 340,
        fontSizeScale: 1,
        densityScale: 1,
      })),
    },
  })),
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

describe('Sidebar Shared Dialog Migration (Static Contracts)', () => {
  it('eliminates deleted legacy shared dialog CSS classes from Sidebar.vue', () => {
    expect(sidebarSource).not.toContain('.dialog-overlay');
    expect(sidebarSource).not.toContain('.dialog-container');
    expect(sidebarSource).not.toContain('.dialog-body');
    expect(sidebarSource).not.toContain('.dialog-message');
    expect(sidebarSource).not.toContain('.dialog-input-wrapper');
    expect(sidebarSource).not.toContain('.dialog-actions');
    expect(sidebarSource).not.toContain('.w-full-btn');
    expect(sidebarSource).not.toContain('.poe-btn-confirm');
    expect(sidebarSource).not.toContain('.poe-btn-cancel');
  });

  it('eliminates legacy Affix Selector Modal classes and eliminates poe-btn-danger', () => {
    expect(sidebarSource).not.toContain('.poexd-modal-overlay');
    expect(sidebarSource).not.toContain('.poexd-modal-container');
    expect(sidebarSource).not.toContain('.modal-header');
    expect(sidebarSource).not.toContain('.modal-title');
    expect(sidebarSource).not.toContain('.modal-close-btn');
    expect(sidebarSource).not.toContain('.modal-body');
    expect(sidebarSource).not.toContain('.poe-btn-danger');
  });

  it('verifies Affix Selector Modal uses controlled Dialog with persistence', () => {
    expect(sidebarSource).toContain(':open="isModalOpen"');
    expect(sidebarSource).toContain(':unmount-on-hide="false"');
    expect(sidebarSource).toContain('@update:open="setAffixDialogOpen"');
    expect(sidebarSource).toContain('<FilterPane');
    expect(sidebarSource).toContain(':target-group-index="targetGroupIndex"');
    expect(sidebarSource).toContain(':is-open="isModalOpen"');
    expect(sidebarSource).toContain('@type-dialog-open-changed="handleTypeDialogOpenChange"');
  });

  it('enforces DialogContent primitive semantic stacking contract (base -> z-50, nested -> z-[60], system -> z-[70])', () => {
    expect(dialogContentSource).toContain("export type DialogLayer = 'base' | 'nested' | 'system'");
    expect(dialogContentSource).toContain("base: 'z-50'");
    expect(dialogContentSource).toContain("nested: 'z-[60]'");
    expect(dialogContentSource).toContain("system: 'z-[70]'");
    expect(sidebarSource).toContain('layer="system"');
  });

  it('enforces Density-invariant Shared Dialog viewport safety inset and Foundation header spacing', () => {
    // max-width and max-height are fixed 32px viewport safety inset, never polluted by density
    expect(sidebarSource).toContain('max-w-[calc(100vw-32px)]');
    expect(sidebarSource).toContain(
      'max-h-[min(var(--pxd-sidebar-shared-dialog-max-height),calc(100vh-32px))]',
    );
    expect(sidebarSource).not.toContain('max-w-[calc(100vw-var(--pxd-space');

    // DialogHeader uses semantic token spacing
    expect(sidebarSource).toContain(
      'gap-[var(--pxd-space-sm)] text-left pr-[var(--pxd-space-2xl)]',
    );

    // Header left uses semantic token spacing class
    expect(sidebarSource).toContain('header-left flex items-baseline gap-[var(--pxd-space-sm)]');
  });

  it('enforces Shared Dialog layout contract with scrollable body container and fixed boundaries', () => {
    expect(sidebarSource).toContain('data-sidebar-dialog-body');
    expect(sidebarSource).toContain('ScrollAreaRoot');
    expect(sidebarSource).toContain('ScrollAreaViewport');
    expect(sidebarSource).toContain(
      'shrink-0 gap-[var(--pxd-space-sm)] text-left pr-[var(--pxd-space-2xl)]',
    );
  });

  it('guarantees Shared Dialog visual geometry tokens are Scale-aware and strictly Density-invariant', () => {
    // Scale 1.0
    const tDefault = createUiRuntimeTokenValues({ scale: 1.0, density: 1.0 });
    const tCompact = createUiRuntimeTokenValues({ scale: 1.0, density: 0.8 });
    const tComfort = createUiRuntimeTokenValues({ scale: 1.0, density: 1.2 });

    expect(tDefault['--pxd-sidebar-shared-dialog-width']).toBe('340px');
    expect(tDefault['--pxd-sidebar-shared-dialog-max-height']).toBe('250px');

    // Density does NOT change visual geometry
    expect(tCompact['--pxd-sidebar-shared-dialog-width']).toBe('340px');
    expect(tCompact['--pxd-sidebar-shared-dialog-max-height']).toBe('250px');
    expect(tComfort['--pxd-sidebar-shared-dialog-width']).toBe('340px');
    expect(tComfort['--pxd-sidebar-shared-dialog-max-height']).toBe('250px');

    // Scale 1.2
    const tLgDefault = createUiRuntimeTokenValues({ scale: 1.2, density: 1.0 });
    const tLgCompact = createUiRuntimeTokenValues({ scale: 1.2, density: 0.8 });
    const tLgComfort = createUiRuntimeTokenValues({ scale: 1.2, density: 1.2 });

    expect(tLgDefault['--pxd-sidebar-shared-dialog-width']).toBe('408px');
    expect(tLgDefault['--pxd-sidebar-shared-dialog-max-height']).toBe('300px');
    expect(tLgCompact['--pxd-sidebar-shared-dialog-width']).toBe('408px');
    expect(tLgCompact['--pxd-sidebar-shared-dialog-max-height']).toBe('300px');
    expect(tLgComfort['--pxd-sidebar-shared-dialog-width']).toBe('408px');
    expect(tLgComfort['--pxd-sidebar-shared-dialog-max-height']).toBe('300px');
  });
});

describe('Sidebar Shared Dialog (Runtime Contracts)', () => {
  let host: HTMLElement;
  let appRoot: HTMLElement;
  let portalRoot: HTMLElement;
  let app: any;

  const mountSidebar = async () => {
    host = document.createElement('div');
    document.body.appendChild(host);

    appRoot = document.createElement('div');
    portalRoot = document.createElement('div');
    host.appendChild(appRoot);
    host.appendChild(portalRoot);

    app = createApp({
      setup() {
        return () => h(Sidebar, { portalTarget: portalRoot });
      },
    });

    app.mount(appRoot);
    await nextTick();
    await new Promise((r) => setTimeout(r, 40));
  };

  const getSharedDialogContent = (): HTMLElement | null => {
    return (
      Array.from(portalRoot.querySelectorAll<HTMLElement>('[data-slot="dialog-content"]')).find(
        (el) => el.className.includes('w-[var(--pxd-sidebar-shared-dialog-width)]'),
      ) ?? null
    );
  };

  const getSharedDialogOverlay = (): HTMLElement | null => {
    const content = getSharedDialogContent();
    if (!content) return null;
    return (content.previousElementSibling as HTMLElement | null)?.matches(
      '[data-slot="dialog-overlay"]',
    )
      ? (content.previousElementSibling as HTMLElement)
      : portalRoot.querySelector<HTMLElement>('[data-slot="dialog-overlay"]');
  };

  beforeEach(async () => {
    await mountSidebar();
  });

  afterEach(() => {
    if (app) {
      app.unmount();
      app = null;
    }
    if (host && host.parentNode) {
      host.parentNode.removeChild(host);
    }
    vi.restoreAllMocks();
  });

  it('A. renders confirm dialog with correct title, message, and stacking levels', async () => {
    const promise = (window as any).poexdConfirm('確定要執行此操作？', '重要提示');
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    const content = getSharedDialogContent();
    const overlay = getSharedDialogOverlay();
    expect(content).toBeTruthy();
    expect(overlay).toBeTruthy();

    expect(overlay!.className).toContain('z-[70]');
    expect(content!.className).toContain('z-[70]');
    expect(overlay!.className).not.toContain('z-50');
    expect(content!.className).not.toContain('z-50');

    expect(content!.textContent).toContain('重要提示');
    expect(content!.textContent).toContain('確定要執行此操作？');

    // Clean up dialog by resolving
    const confirmBtn = portalRoot.querySelector(
      '[data-sidebar-dialog-action="confirm"]',
    ) as HTMLButtonElement;
    confirmBtn.click();
    await promise;
  });

  it('B. confirm click resolves Promise true and closes Dialog', async () => {
    let resolvedValue: any = null;
    const promise = (window as any).poexdConfirm('確認訊息', '標題').then((val: any) => {
      resolvedValue = val;
    });
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    const confirmBtn = portalRoot.querySelector(
      '[data-sidebar-dialog-action="confirm"]',
    ) as HTMLButtonElement;
    expect(confirmBtn).toBeTruthy();
    confirmBtn.click();

    await promise;
    expect(resolvedValue).toBe(true);

    await nextTick();
    await new Promise((r) => setTimeout(r, 40));
    expect(getSharedDialogContent()).toBeNull();
  });

  it('C. cancel click resolves confirm with false and closes Dialog', async () => {
    let resolvedValue: any = null;
    const promise = (window as any).poexdConfirm('取消訊息', '標題').then((val: any) => {
      resolvedValue = val;
    });
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    const cancelBtn = portalRoot.querySelector(
      '[data-sidebar-dialog-action="cancel"]',
    ) as HTMLButtonElement;
    expect(cancelBtn).toBeTruthy();
    cancelBtn.click();

    await promise;
    expect(resolvedValue).toBe(false);

    await nextTick();
    await new Promise((r) => setTimeout(r, 40));
    expect(getSharedDialogContent()).toBeNull();
  });

  it('D. prompt displays default value, accepts input update, and resolves entered string on confirm', async () => {
    let resolvedValue: any = null;
    const promise = (window as any)
      .poexdPrompt('請輸入名稱：', '初始名稱', '輸入')
      .then((val: any) => {
        resolvedValue = val;
      });
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    const input = portalRoot.querySelector('[data-sidebar-dialog-input]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.classList.contains('dialog-input')).toBe(true);
    expect(input.value).toBe('初始名稱');

    input.value = '更新後的名稱';
    input.dispatchEvent(new Event('input'));
    await nextTick();

    const confirmBtn = portalRoot.querySelector(
      '[data-sidebar-dialog-action="confirm"]',
    ) as HTMLButtonElement;
    confirmBtn.click();

    await promise;
    expect(resolvedValue).toBe('更新後的名稱');
  });

  it('E. prompt cancel resolves null', async () => {
    let resolvedValue: any = null;
    const promise = (window as any).poexdPrompt('輸入測試', '預設值').then((val: any) => {
      resolvedValue = val;
    });
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    const cancelBtn = portalRoot.querySelector(
      '[data-sidebar-dialog-action="cancel"]',
    ) as HTMLButtonElement;
    expect(cancelBtn).toBeTruthy();
    cancelBtn.click();

    await promise;
    expect(resolvedValue).toBeNull();
  });

  it('F. alert displays no cancel button and resolves true on confirm', async () => {
    let resolvedValue: any = null;
    const promise = (window as any).poexdAlert('注意！這是一個提示', '警示').then((val: any) => {
      resolvedValue = val;
    });
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    const cancelBtn = portalRoot.querySelector('[data-sidebar-dialog-action="cancel"]');
    expect(cancelBtn).toBeNull();

    const confirmBtn = portalRoot.querySelector(
      '[data-sidebar-dialog-action="confirm"]',
    ) as HTMLButtonElement;
    expect(confirmBtn).toBeTruthy();
    confirmBtn.click();

    await promise;
    expect(resolvedValue).toBe(true);
  });

  it('G. custom dialog renders buttons in original order and resolves clicked btn.value', async () => {
    let resolvedValue: any = null;
    const buttons = [
      { label: '選項一', value: 'opt_1' },
      { label: '選項二', value: 'opt_2' },
      { label: '刪除', value: 'delete', variant: 'destructive' as const },
    ];
    const promise = (window as any)
      .poexdCustomDialog({
        title: '自訂對話框',
        message: '請選擇一個選項',
        buttons,
      })
      .then((val: any) => {
        resolvedValue = val;
      });
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    const customButtons = Array.from(
      portalRoot.querySelectorAll('[data-sidebar-dialog-action="custom"]'),
    ) as HTMLButtonElement[];
    expect(customButtons.length).toBe(3);
    expect(customButtons[0].textContent?.trim()).toBe('選項一');
    expect(customButtons[2].textContent?.trim()).toBe('刪除');
    expect(customButtons[2].classList.contains('bg-destructive')).toBe(true);

    customButtons[1].click();

    await promise;
    expect(resolvedValue).toBe('opt_2');
  });

  it('G2. custom dialog buttons use semantic variants and fallback to outline variant', async () => {
    let resolvedValue: any = null;
    const buttons = [
      { label: '與現有書籤合併', value: 'merge' },
      { label: '覆蓋目前書籤', value: 'overwrite', variant: 'destructive' as const },
      { label: '取消', value: 'cancel' },
    ];
    const promise = (window as any)
      .poexdCustomDialog({
        title: '匯入書籤',
        message: '請選擇匯入方式：',
        buttons,
      })
      .then((val: any) => {
        resolvedValue = val;
      });
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    const customButtons = Array.from(
      portalRoot.querySelectorAll('[data-sidebar-dialog-action="custom"]'),
    ) as HTMLButtonElement[];
    expect(customButtons.length).toBe(3);

    // merge button falls back to outline variant
    expect(customButtons[0].classList.contains('border-input')).toBe(true);

    // overwrite button uses destructive variant
    expect(customButtons[1].classList.contains('bg-destructive')).toBe(true);

    // cancel button falls back to outline variant
    expect(customButtons[2].classList.contains('border-input')).toBe(true);

    customButtons[0].click();
    await promise;
    expect(resolvedValue).toBe('merge');
  });

  it('H. custom dialog resolves first button value on Enter keydown', async () => {
    let resolvedValue: any = null;
    const buttons = [
      { label: '主要操作', value: 'primary_action' },
      { label: '次要操作', value: 'secondary_action' },
    ];
    const promise = (window as any)
      .poexdCustomDialog({
        title: 'Enter測試',
        message: 'Enter 應觸發第一個按鈕',
        buttons,
      })
      .then((val: any) => {
        resolvedValue = val;
      });
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    await promise;
    expect(resolvedValue).toBe('primary_action');
  });

  it('I. custom dialog Escape keydown resolves explicit cancel button value or falls back to last button', async () => {
    // Case 1: explicit cancel button
    let resolvedValue1: any = null;
    const promise1 = (window as any)
      .poexdCustomDialog({
        title: 'Escape 測試 1',
        message: '有取消按鈕',
        buttons: [
          { label: '確認', value: 'ok' },
          { label: '自訂取消', value: 'cancel_val' },
          { label: '其他', value: 'other' },
        ],
      })
      .then((val: any) => {
        resolvedValue1 = val;
      });
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await promise1;
    expect(resolvedValue1).toBe('cancel_val');

    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    // Case 2: no explicit cancel button -> falls back to last button
    let resolvedValue2: any = null;
    const promise2 = (window as any)
      .poexdCustomDialog({
        title: 'Escape 測試 2',
        message: '無明確取消按鈕',
        buttons: [
          { label: '選項 A', value: 'val_a' },
          { label: '選項 B', value: 'val_b' },
        ],
      })
      .then((val: any) => {
        resolvedValue2 = val;
      });
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await promise2;
    expect(resolvedValue2).toBe('val_b');
  });

  it('J. built-in X button runs cancel semantics and resolves pending Promise', async () => {
    // Confirm with X
    let confirmVal: any = null;
    const confirmPromise = (window as any).poexdConfirm('X 關閉測試').then((val: any) => {
      confirmVal = val;
    });
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    const sharedContent1 = getSharedDialogContent();
    expect(sharedContent1).toBeTruthy();
    const closeBtn1 = sharedContent1!.querySelector(
      '[data-slot="dialog-close"]',
    ) as HTMLButtonElement;
    expect(closeBtn1).toBeTruthy();
    closeBtn1.click();

    await confirmPromise;
    expect(confirmVal).toBe(false);

    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    // Custom dialog with X (must match Escape cancel resolution)
    let customVal: any = null;
    const customPromise = (window as any)
      .poexdCustomDialog({
        title: 'X 關閉自訂對話框',
        message: '測試自訂對話框點 X',
        buttons: [
          { label: '儲存', value: 'save' },
          { label: '取消並退出', value: 'cancelled' },
        ],
      })
      .then((val: any) => {
        customVal = val;
      });
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    const sharedContent2 = getSharedDialogContent();
    expect(sharedContent2).toBeTruthy();
    const closeBtn2 = sharedContent2!.querySelector(
      '[data-slot="dialog-close"]',
    ) as HTMLButtonElement;
    expect(closeBtn2).toBeTruthy();
    closeBtn2.click();

    await customPromise;
    expect(customVal).toBe('cancelled');
  });

  it('K. overlay / outside click keeps Dialog open and Promise pending', async () => {
    let resolved = false;
    (window as any).poexdConfirm('點擊遮罩測試').then(() => {
      resolved = true;
    });
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    const overlay = getSharedDialogOverlay();
    expect(overlay).toBeTruthy();

    // Simulate pointerdown outside / click on overlay
    overlay!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    overlay!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));

    // Promise remains pending and dialog remains open
    expect(resolved).toBe(false);
    expect(getSharedDialogContent()).toBeTruthy();

    // Clean up
    const cancelBtn = portalRoot.querySelector(
      '[data-sidebar-dialog-action="cancel"]',
    ) as HTMLButtonElement;
    cancelBtn.click();
    await nextTick();
  });

  it('L. Escape keydown triggers EXACTLY ONE resolution without duplicate call', async () => {
    const resolveSpy = vi.fn();
    dispatchPoeEvent('poexd-trigger-dialog', {
      type: 'confirm',
      title: '單次解析測試',
      message: 'Escape 測試',
      resolve: resolveSpy,
    });
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));

    expect(resolveSpy).toHaveBeenCalledTimes(1);
    expect(resolveSpy).toHaveBeenCalledWith(false);
  });

  it('M. Enter keydown triggers EXACTLY ONE resolution without duplicate call', async () => {
    const resolveSpy = vi.fn();
    dispatchPoeEvent('poexd-trigger-dialog', {
      type: 'confirm',
      title: '單次解析測試',
      message: 'Enter 測試',
      resolve: resolveSpy,
    });
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));

    expect(resolveSpy).toHaveBeenCalledTimes(1);
    expect(resolveSpy).toHaveBeenCalledWith(true);
  });

  it('N. long plain-text confirm establishes dedicated scrollable body container with fixed header and actions', async () => {
    const longMessage = Array.from(
      { length: 40 },
      (_, i) => `第 ${i + 1} 行：這是一段非常長的確認對話框文字訊息，用以模擬長內容環境。`,
    ).join('\n');
    let confirmed: any = null;
    const promise = (window as any).poexdConfirm(longMessage, '長內容確認測試').then((val: any) => {
      confirmed = val;
    });
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    const content = getSharedDialogContent();
    expect(content).toBeTruthy();

    // DialogContent 具備 max-height 及 viewport safety contract
    expect(content!.className).toContain(
      'max-h-[min(var(--pxd-sidebar-shared-dialog-max-height),calc(100vh-32px))]',
    );

    // [data-sidebar-dialog-body] 存在且為唯一 scroll owner
    const body = content!.querySelector<HTMLElement>('[data-sidebar-dialog-body]');
    expect(body).toBeTruthy();
    expect(body!.className).toContain('min-h-0');
    expect(body!.className).toContain('flex-1');
    expect(body!.className).toContain('overflow-hidden');
    const viewport = body!.querySelector('[data-reka-scroll-area-viewport]');
    expect(viewport).toBeTruthy();

    // Header 具有 shrink-0 且位於 body 外
    const header = content!.querySelector('[data-slot="dialog-header"]');
    expect(header).toBeTruthy();
    expect(header!.className).toContain('shrink-0');
    expect(body!.contains(header)).toBe(false);

    // Title 位於 header 內且位於 body 外
    const title = content!.querySelector('[data-slot="dialog-title"]');
    expect(title).toBeTruthy();
    expect(header!.contains(title)).toBe(true);
    expect(body!.contains(title)).toBe(false);
    expect(title!.textContent?.trim()).toBe('長內容確認測試');

    // Actions 具有 shrink-0 且位於 body 外
    const actionsContainer = content!.querySelector(
      '[data-sidebar-dialog-action="confirm"]',
    )?.parentElement;
    expect(actionsContainer).toBeTruthy();
    expect(actionsContainer!.className).toContain('shrink-0');
    expect(body!.contains(actionsContainer!)).toBe(false);

    // Confirm / Cancel 按鈕存在
    const confirmBtn = portalRoot.querySelector(
      '[data-sidebar-dialog-action="confirm"]',
    ) as HTMLButtonElement;
    const cancelBtn = portalRoot.querySelector(
      '[data-sidebar-dialog-action="cancel"]',
    ) as HTMLButtonElement;
    expect(confirmBtn).toBeTruthy();
    expect(cancelBtn).toBeTruthy();
    expect(body!.contains(confirmBtn)).toBe(false);
    expect(body!.contains(cancelBtn)).toBe(false);

    // Message 完整存在於 body 內，不被 truncate，且具備換行合約
    const description = body!.querySelector('[data-slot="dialog-description"]');
    expect(description).toBeTruthy();
    expect(description!.textContent).toContain('第 1 行：');
    expect(description!.textContent).toContain('第 40 行：');
    expect(description!.className).toContain('whitespace-pre-wrap');

    // 點擊確認解析並關閉
    confirmBtn.click();
    await promise;
    expect(confirmed).toBe(true);
  });

  it('O. unbroken long string wraps safely without horizontal scrolling', async () => {
    const unbrokenUrl = 'https://example.com/very/long/path/without/spaces/' + 'a'.repeat(200);
    const promise = (window as any).poexdAlert(unbrokenUrl, '超長連結警告');
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    const content = getSharedDialogContent();
    expect(content).toBeTruthy();

    const body = content!.querySelector<HTMLElement>('[data-sidebar-dialog-body]');
    expect(body).toBeTruthy();
    expect(body!.className).toContain('overflow-hidden');

    const description = body!.querySelector('[data-slot="dialog-description"]');
    expect(description).toBeTruthy();
    expect(description!.className).toContain('break-words');
    expect(description!.className).toContain('[overflow-wrap:anywhere]');
    expect(description!.textContent).toContain(unbrokenUrl);

    const confirmBtn = portalRoot.querySelector(
      '[data-sidebar-dialog-action="confirm"]',
    ) as HTMLButtonElement;
    confirmBtn.click();
    await promise;
  });

  it('P. HTML-like strings render strictly as plain text without DOM element injection', async () => {
    const maliciousMessage =
      '<strong>安全提示：</strong>\n<img src="x" onerror="alert(1)">\n<script>alert("xss")</script>\n詳細說明條款';

    let resolvedVal: any = null;
    const promise = (window as any)
      .poexdConfirm(maliciousMessage, 'XSS 防護測試')
      .then((val: any) => {
        resolvedVal = val;
      });
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    const content = getSharedDialogContent();
    expect(content).toBeTruthy();

    const body = content!.querySelector<HTMLElement>('[data-sidebar-dialog-body]');
    expect(body).toBeTruthy();

    // DOM 中絕不得產生 injected element
    expect(body!.querySelector('img')).toBeNull();
    expect(body!.querySelector('script')).toBeNull();
    expect(body!.querySelector('strong')).toBeNull();

    // 驗證 Description 純文字包含原本字串且保留 whitespace-pre-wrap
    const description = body!.querySelector('[data-slot="dialog-description"]');
    expect(description).toBeTruthy();
    expect(description!.textContent).toContain('<img src="x" onerror="alert(1)">');
    expect(description!.textContent).toContain('<strong>安全提示：</strong>');
    expect(description!.className).toContain('break-words');
    expect(description!.className).toContain('[overflow-wrap:anywhere]');
    expect(description!.className).toContain('whitespace-pre-wrap');

    // Confirm
    const confirmBtn = portalRoot.querySelector(
      '[data-sidebar-dialog-action="confirm"]',
    ) as HTMLButtonElement;
    confirmBtn.click();
    await promise;
    expect(resolvedVal).toBe(true);
  });

  it('P2. forged CustomEvent with isHtml does not bypass plain text rendering', async () => {
    let resolvedVal: any = null;
    dispatchPoeEvent('poexd-trigger-dialog', {
      type: 'confirm',
      title: '偽造事件測試',
      message: '<div id="forged-payload"><button onclick="alert(1)">點擊</button></div>',
      resolve: (val: any) => {
        resolvedVal = val;
      },
      ...({ isHtml: true } as any),
    });
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    const content = getSharedDialogContent();
    expect(content).toBeTruthy();

    const body = content!.querySelector<HTMLElement>('[data-sidebar-dialog-body]');
    expect(body).toBeTruthy();
    expect(body!.querySelector('#forged-payload')).toBeNull();
    expect(body!.querySelector('button')).toBeNull();

    const description = body!.querySelector('[data-slot="dialog-description"]');
    expect(description?.textContent).toContain('<div id="forged-payload">');

    const confirmBtn = portalRoot.querySelector(
      '[data-sidebar-dialog-action="confirm"]',
    ) as HTMLButtonElement;
    confirmBtn.click();
    await nextTick();
    expect(resolvedVal).toBe(true);
  });

  it('Q. long message with prompt keeps input fixed outside scroll body and resolves correctly', async () => {
    const longPromptMessage =
      '請根據以下長說明輸入數值：\n' +
      Array.from({ length: 30 }, (_, i) => `條款 ${i + 1}：這是一條必須仔細閱讀的條件。`).join(
        '\n',
      );

    let resolvedValue: any = null;
    const promise = (window as any)
      .poexdPrompt(longPromptMessage, '預設數值', '條款輸入')
      .then((val: any) => {
        resolvedValue = val;
      });
    await nextTick();
    await new Promise((r) => setTimeout(r, 30));

    const content = getSharedDialogContent();
    expect(content).toBeTruthy();

    const body = content!.querySelector<HTMLElement>('[data-sidebar-dialog-body]');
    expect(body).toBeTruthy();
    expect(body!.className).toContain('min-h-0');
    expect(body!.className).toContain('flex-1');
    const viewport = body!.querySelector('[data-reka-scroll-area-viewport]');
    expect(viewport).toBeTruthy();

    // Input 必須存在於 body 外，且 container 具有 shrink-0
    const input = portalRoot.querySelector('[data-sidebar-dialog-input]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(body!.contains(input)).toBe(false);

    const inputWrapper = input.parentElement;
    expect(inputWrapper).toBeTruthy();
    expect(inputWrapper!.className).toContain('shrink-0');
    expect(body!.contains(inputWrapper)).toBe(false);

    // 修改 input 值並確認
    input.value = '使用者輸入之測試值';
    input.dispatchEvent(new Event('input'));
    await nextTick();

    const confirmBtn = portalRoot.querySelector(
      '[data-sidebar-dialog-action="confirm"]',
    ) as HTMLButtonElement;
    confirmBtn.click();
    await promise;
    expect(resolvedValue).toBe('使用者輸入之測試值');
  });
});
