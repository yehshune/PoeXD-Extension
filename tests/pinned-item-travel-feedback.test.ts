// @vitest-environment happy-dom
// @vitest-environment-options { "url": "https://www.pathofexile.com/trade/search/Covens" }
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';
import PinnedItemPane from '@/components/sidebar/pinned-items/PinnedItemPane.vue';
import { createPinnedItemSnapshot } from '@/utils/pinned-items';
import type { HideoutTravelOutcome, HideoutTravelPhase } from '@/utils/pinned-item-actions';
import { initPoeEventNonce, listenPoeEvent, type PoeToastDetail } from '@/utils/event-contracts';

let resolveTravel: ((outcome: HideoutTravelOutcome) => void) | undefined;
let emitPhase: ((phase: HideoutTravelPhase) => void) | undefined;

vi.mock('@/utils/pinned-item-actions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/pinned-item-actions')>();
  return {
    ...actual,
    travelToHideout: vi.fn(
      (_snapshot, _deps, options?: { onPhaseChange?: (phase: HideoutTravelPhase) => void }) => {
        emitPhase = options?.onPhaseChange;
        emitPhase?.('refreshing');
        return new Promise<HideoutTravelOutcome>((resolve) => {
          resolveTravel = resolve;
        });
      },
    ),
  };
});

const item = createPinnedItemSnapshot(
  {
    id: 'p1',
    item: { name: 'Loath Visor', typeLine: 'Destroyer Regalia', frameType: 2 },
    listing: {
      hideout_token: 'tok',
      account: { name: 'Seller#1234' },
      price: { amount: 1, currency: 'divine' },
    },
  },
  { gameVersion: 'poe1', origin: 'https://www.pathofexile.com', league: 'Covens' },
  100,
)!;

const { mockList, mockClear, mockMarkSold, mockClearSold } = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockClear: vi.fn(async () => ({ ok: true })),
  mockMarkSold: vi.fn(async () => ({ ok: true })),
  mockClearSold: vi.fn(async () => ({ ok: true })),
}));

let emitSubscribed: ((items: (typeof item)[]) => void) | undefined;

vi.mock('@/utils/pinned-item-client', () => ({
  createPinnedItemClient: () => ({
    list: mockList,
    subscribe: (next: (items: (typeof item)[]) => void) => {
      emitSubscribed = next;
      return () => {
        emitSubscribed = undefined;
      };
    },
    pin: vi.fn(async () => ({ ok: true })),
    unpin: vi.fn(async () => ({ ok: true })),
    reorder: vi.fn(async () => ({ ok: true })),
    clear: mockClear,
    markSold: mockMarkSold,
    clearSold: mockClearSold,
  }),
}));

vi.mock('@/utils/trade-context', () => ({
  getPoeVersion: () => 'poe1',
  getTradeLeague: () => 'Covens',
}));

describe('PinnedItemPane travel feedback', () => {
  let container: HTMLElement;
  let unmount: (() => void) | undefined;

  beforeEach(() => {
    resolveTravel = undefined;
    emitPhase = undefined;
    mockList.mockResolvedValue([item]);
    mockClear.mockClear();
    mockMarkSold.mockClear();
    mockClearSold.mockClear();
    delete (window as { poexdConfirm?: unknown }).poexdConfirm;
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    unmount?.();
    unmount = undefined;
    container.remove();
  });

  const flush = async () => {
    for (let i = 0; i < 4; i += 1) {
      await nextTick();
      await new Promise((r) => setTimeout(r, 0));
    }
  };

  it('distinguishes refreshing item info from actually sending teleport request', async () => {
    const app = createApp({ render: () => h(PinnedItemPane) });
    app.mount(container);
    unmount = () => app.unmount();
    await flush();

    // Expand the item; hover actions remain in the top-right bar
    container.querySelector<HTMLElement>('[data-pinned-item-toggle]')!.click();
    await flush();

    const btn = container.querySelector<HTMLButtonElement>('[data-pinned-item-travel]')!;
    expect(btn.getAttribute('aria-label')).toBe('前往藏身處');
    expect(btn.disabled).toBe(false);
    expect(btn.querySelector('.animate-spin')).toBeNull();

    // Phase 1: refreshing expired item/token via /fetch
    btn.click();
    await flush();

    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn.getAttribute('aria-label')).toBe('更新物品中…');
    expect(btn.querySelector('.animate-spin')).not.toBeNull();
    expect(container.querySelector('[data-pinned-item-busy]')?.textContent).toContain(
      '更新物品中…',
    );

    // Phase 2: /fetch succeeded, now sending /whisper teleport request
    emitPhase?.('traveling');
    await flush();

    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn.getAttribute('aria-label')).toBe('傳送中…');
    expect(container.querySelector('[data-pinned-item-busy]')?.textContent).toContain('傳送中…');

    resolveTravel?.({ status: 'teleporting' });
    await flush();

    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute('aria-busy')).toBeNull();
    expect(btn.getAttribute('aria-label')).toBe('已傳送');
    expect(btn.querySelector('.animate-spin')).toBeNull();
    expect(container.querySelector('[data-pinned-item-busy]')).toBeNull();
  });

  it('persists sold state on sold outcome and keeps travel disabled while expanded', async () => {
    const app = createApp({ render: () => h(PinnedItemPane) });
    app.mount(container);
    unmount = () => app.unmount();
    await flush();

    container.querySelector<HTMLElement>('[data-pinned-item-toggle]')!.click();
    await flush();

    // 售出後該列會移到底部的「已售出」區塊重新渲染，因此每次都重新查詢按鈕
    const btn = () => container.querySelector<HTMLButtonElement>('[data-pinned-item-travel]')!;
    btn().click();
    await flush();

    resolveTravel?.({ status: 'sold' });
    await flush();

    expect(mockMarkSold).toHaveBeenCalledWith('p1');
    expect(container.querySelector('[data-pinned-item-sold]')).not.toBeNull();
    expect(
      container.querySelector('[data-pinned-items-sold-list] [data-pinned-item-id="p1"]'),
    ).not.toBeNull();
    expect(btn().disabled).toBe(true);
    expect(btn().getAttribute('aria-label')).toBe('已售出');

    // Subsequent clicks do not re-trigger travel once marked sold
    btn().click();
    await flush();
    expect(mockMarkSold).toHaveBeenCalledTimes(1);

    // Re-pinning overwrites snapshot without sold -> clears in-memory sold state immediately
    emitSubscribed?.([{ ...item, pinnedAt: 200 }]);
    await flush();
    expect(container.querySelector('[data-pinned-item-sold]')).toBeNull();
    expect(container.querySelector('[data-pinned-items-sold-group]')).toBeNull();
    expect(btn().disabled).toBe(false);
    expect(btn().getAttribute('aria-label')).toBe('前往藏身處');
  });

  it('keeps the seller out of the row meta, omits the instant-buyout badge, moves PoB copy into row menu when collapsed, and falls back to window.confirm when poexdConfirm is absent', async () => {
    const previousConfirm = window.confirm;
    const windowConfirmSpy = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    (window as { confirm?: unknown }).confirm = windowConfirmSpy;
    try {
      const app = createApp({ render: () => h(PinnedItemPane) });
      app.mount(container);
      unmount = () => app.unmount();
      await flush();

      const meta = container.querySelector('[data-pinned-item-meta]')?.textContent ?? '';
      expect(meta).not.toContain('直購');
      expect(meta).not.toContain('Seller#1234');

      // Collapsed outer hover bar hides PoB button and exposes it inside the ⋯ menu
      expect(container.querySelector('[data-pinned-item-pob]')).toBeNull();
      const rowMenuTrigger = container.querySelector<HTMLElement>('[data-pinned-item-menu]')!;
      rowMenuTrigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
      rowMenuTrigger.click();
      await flush();
      expect(document.body.querySelector('[data-pinned-item-pob]')).not.toBeNull();
      rowMenuTrigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await flush();

      // Expanding keeps the top summary row (without the small icon) with left framed large icon,
      // middle details, hover controls in the top-right, and popup card below
      container.querySelector<HTMLElement>('[data-pinned-item-toggle]')!.click();
      await flush();
      expect(container.querySelector('[data-pinned-item-name]')).not.toBeNull();
      expect(container.querySelector('[data-pinned-item-price]')).not.toBeNull();
      expect(container.querySelector('[data-result-row-icon]')).toBeNull();
      expect(container.querySelector('[data-result-row-expanded-icon]')).not.toBeNull();
      expect(container.querySelector('[data-pinned-item-pob]')).toBeNull();
      expect(container.querySelector('[data-pinned-item-pinned-at]')?.textContent).toContain(
        '釘選於',
      );
      // 展開後賣家改列在明細，不放在名稱下方的灰色資訊
      expect(container.querySelector('[data-pinned-item-meta]')?.textContent ?? '').not.toContain(
        'Seller#1234',
      );
      expect(container.querySelector('[data-pinned-item-seller]')?.textContent?.trim()).toBe(
        '賣家：Seller#1234',
      );
      expect(container.querySelector('[data-pinned-item-listing-meta]')).toBeNull();
      container.querySelector<HTMLElement>('[data-pinned-item-toggle]')!.click();
      await flush();
      expect(container.querySelector('[data-pinned-item-name]')).not.toBeNull();
      expect(container.querySelector('[data-result-row-icon]')).not.toBeNull();
      expect(container.querySelector('[data-result-row-expanded-icon]')).toBeNull();

      const trigger = container.querySelector<HTMLElement>('[data-pinned-items-clear]')!;
      trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
      trigger.click();
      await flush();
      document.body.querySelector<HTMLElement>('[data-pinned-items-clear-all]')!.click();
      await flush();

      expect(windowConfirmSpy).toHaveBeenCalledTimes(1);
      expect(mockClear).not.toHaveBeenCalled();

      trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
      trigger.click();
      await flush();
      document.body.querySelector<HTMLElement>('[data-pinned-items-clear-all]')!.click();
      await flush();

      expect(windowConfirmSpy).toHaveBeenCalledTimes(2);
      expect(mockClear).toHaveBeenCalledWith('Covens');
    } finally {
      (window as { confirm?: unknown }).confirm = previousConfirm;
    }
  });

  it('renders persisted sold items as sold on load and supports clearing sold items', async () => {
    const soldItem = { ...item, id: 'p-sold', sold: true };
    const activeItem = { ...item, id: 'p-active' };
    mockList.mockResolvedValue([soldItem, activeItem]);

    const app = createApp({ render: () => h(PinnedItemPane) });
    app.mount(container);
    unmount = () => app.unmount();
    await flush();

    // 已售出的釘選沉到底部的「已售出」區塊，未售出的維持在可拖曳的清單
    const rows = container.querySelectorAll<HTMLElement>('.pinned-item-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].dataset.pinnedItemId).toBe('p-active');
    expect(rows[0].matches('[data-pinned-item-sold]')).toBe(false);
    expect(rows[1].dataset.pinnedItemId).toBe('p-sold');
    expect(rows[1].matches('[data-pinned-item-sold]')).toBe(true);
    expect(rows[1].closest('[data-pinned-items-sold-list]')).not.toBeNull();
    expect(container.querySelector('[data-pinned-items-sold-toggle]')?.textContent?.trim()).toBe(
      '已售出 (1)',
    );

    // Expand the persisted sold item and verify expanded travel button is disabled
    rows[1].querySelector<HTMLElement>('[data-pinned-item-toggle]')!.click();
    await flush();
    const travelBtn = container.querySelector<HTMLButtonElement>(
      '[data-pinned-item-id="p-sold"] [data-pinned-item-travel]',
    )!;
    expect(travelBtn.disabled).toBe(true);

    // 收合「已售出」區塊後只剩未售出的列
    container.querySelector<HTMLElement>('[data-pinned-items-sold-toggle]')!.click();
    await flush();
    expect(container.querySelectorAll('.pinned-item-row')).toHaveLength(1);
    container.querySelector<HTMLElement>('[data-pinned-items-sold-toggle]')!.click();
    await flush();

    const confirmSpy = vi.fn(async () => false);
    (window as { poexdConfirm?: unknown }).poexdConfirm = confirmSpy;

    // Open clear dropdown menu and click "Clear sold items" (should not prompt confirmation)
    const openClearMenu = async () => {
      const clearTrigger = container.querySelector<HTMLElement>('[data-pinned-items-clear]')!;
      clearTrigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
      clearTrigger.click();
      await flush();
    };

    await openClearMenu();
    const clearSoldBtn = document.body.querySelector<HTMLElement>('[data-pinned-items-clear-sold]');
    expect(clearSoldBtn).not.toBeNull();
    clearSoldBtn!.click();
    await flush();

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(mockClearSold).toHaveBeenCalledWith('Covens');

    // "Clear league/all" must prompt poexdConfirm and abort when cancelled
    await openClearMenu();
    document.body.querySelector<HTMLElement>('[data-pinned-items-clear-all]')!.click();
    await flush();

    expect(confirmSpy).toHaveBeenCalledWith(
      '確定要清除「Covens」聯盟的 2 件釘選物品嗎？此操作無法復原。',
      '清除目前聯盟的釘選',
    );
    expect(mockClear).not.toHaveBeenCalled();

    // Confirmed clear executes client.clear
    confirmSpy.mockResolvedValueOnce(true);
    await openClearMenu();
    document.body.querySelector<HTMLElement>('[data-pinned-items-clear-all]')!.click();
    await flush();

    expect(mockClear).toHaveBeenCalledWith('Covens');
  });

  it('localizes backend Trade API error messages in pinned travel failure toast', async () => {
    initPoeEventNonce('pinned-travel-toast-test');
    const toasts: PoeToastDetail[] = [];
    const unlisten = listenPoeEvent('poexd-toast', (detail) => toasts.push(detail));
    try {
      const app = createApp({ render: () => h(PinnedItemPane) });
      app.mount(container);
      unmount = () => app.unmount();
      await flush();

      container.querySelector<HTMLElement>('[data-pinned-item-toggle]')!.click();
      await flush();

      container.querySelector<HTMLButtonElement>('[data-pinned-item-travel]')!.click();
      await flush();

      resolveTravel?.({
        status: 'error',
        message: 'Your account must be in-game to use this feature.',
      });
      await flush();

      expect(toasts).toHaveLength(1);
      expect(toasts[0].tone).toBe('error');
      expect(toasts[0].message).toContain('您的帳號必須在遊戲中才能使用此功能。');
    } finally {
      unlisten();
    }
  });
});
