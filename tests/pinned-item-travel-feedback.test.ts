// @vitest-environment happy-dom
// @vitest-environment-options { "url": "https://www.pathofexile.com/trade/search/Covens" }
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';
import PinnedItemPane from '@/components/sidebar/pinned-items/PinnedItemPane.vue';
import { createPinnedItemSnapshot } from '@/utils/pinned-items';
import type { HideoutTravelOutcome, HideoutTravelPhase } from '@/utils/pinned-item-actions';

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

vi.mock('@/utils/pinned-item-client', () => ({
  createPinnedItemClient: () => ({
    list: mockList,
    subscribe: () => () => {},
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

    // Expand the item so the full action button is rendered
    container.querySelector<HTMLElement>('[data-pinned-item-toggle]')!.click();
    await flush();

    const btn = container.querySelector<HTMLButtonElement>('[data-pinned-item-travel]')!;
    expect(btn.textContent).toContain('前往藏身處');
    expect(btn.disabled).toBe(false);
    expect(btn.querySelector('.animate-spin')).toBeNull();

    // Phase 1: refreshing expired item/token via /fetch
    btn.click();
    await flush();

    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn.textContent).toContain('更新物品中…');
    expect(btn.querySelector('.animate-spin')).not.toBeNull();
    expect(container.querySelector('[data-pinned-item-busy]')?.textContent).toContain(
      '更新物品中…',
    );

    // Phase 2: /fetch succeeded, now sending /whisper teleport request
    emitPhase?.('traveling');
    await flush();

    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn.textContent).toContain('傳送中…');
    expect(container.querySelector('[data-pinned-item-busy]')?.textContent).toContain('傳送中…');

    resolveTravel?.({ status: 'teleporting' });
    await flush();

    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute('aria-busy')).toBeNull();
    expect(btn.textContent).toContain('已傳送');
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

    const btn = container.querySelector<HTMLButtonElement>('[data-pinned-item-travel]')!;
    btn.click();
    await flush();

    resolveTravel?.({ status: 'sold' });
    await flush();

    expect(mockMarkSold).toHaveBeenCalledWith('p1');
    expect(container.querySelector('[data-pinned-item-sold]')).not.toBeNull();
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toContain('已售出');

    // Subsequent clicks do not re-trigger travel once marked sold
    btn.click();
    await flush();
    expect(mockMarkSold).toHaveBeenCalledTimes(1);
  });

  it('renders persisted sold items as sold on load and supports clearing sold items', async () => {
    const soldItem = { ...item, id: 'p-sold', sold: true };
    const activeItem = { ...item, id: 'p-active' };
    mockList.mockResolvedValue([soldItem, activeItem]);

    const app = createApp({ render: () => h(PinnedItemPane) });
    app.mount(container);
    unmount = () => app.unmount();
    await flush();

    const rows = container.querySelectorAll<HTMLElement>('.pinned-item-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('[data-pinned-item-sold]')).not.toBeNull();
    expect(rows[1].querySelector('[data-pinned-item-sold]')).toBeNull();

    // Expand the persisted sold item and verify expanded travel button is disabled
    rows[0].querySelector<HTMLElement>('[data-pinned-item-toggle]')!.click();
    await flush();
    const travelBtn = rows[0].querySelector<HTMLButtonElement>('[data-pinned-item-travel]')!;
    expect(travelBtn.disabled).toBe(true);

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
});
