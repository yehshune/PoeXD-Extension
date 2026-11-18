// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';
import Sortable from 'sortablejs';
import { filterPinnedItems } from '@/components/sidebar/pinned-items/pinned-item-filter';
import PinnedItemPane from '@/components/sidebar/pinned-items/PinnedItemPane.vue';
import { createPinnedItemSnapshot, type PinnedItemSnapshot } from '@/utils/pinned-items';

const sortableOptionMock = vi.fn();

vi.mock('sortablejs', () => ({
  default: {
    create: vi.fn(() => ({
      destroy: vi.fn(),
      option: sortableOptionMock,
    })),
  },
}));

function makeSnapshot(
  id: string,
  item: Record<string, unknown>,
  options: {
    accountName?: string;
    currency?: string;
    currencyName?: string;
    league?: string;
    cardPopupText?: string;
  } = {},
): PinnedItemSnapshot {
  const snapshot = createPinnedItemSnapshot(
    {
      id,
      item,
      listing: {
        account: { name: options.accountName ?? 'Seller#1234' },
        price: { amount: 5, currency: options.currency ?? 'divine' },
      },
    },
    {
      gameVersion: 'poe1',
      origin: 'https://www.pathofexile.com',
      league: options.league ?? 'Covens',
      currency: options.currencyName ? { name: options.currencyName } : undefined,
      card: options.cardPopupText
        ? {
            popup: [{ t: 'div', c: 'item-popup', k: [options.cardPopupText] }],
          }
        : undefined,
    },
    100,
  );
  if (!snapshot) throw new Error(`Failed to build snapshot ${id}`);
  return snapshot;
}

const sampleItems = [
  makeSnapshot(
    'p1',
    {
      name: 'Apocalypse Barrage',
      typeLine: 'Imperial Bow',
      frameType: 2,
      explicitMods: [
        '+38% to Global Critical Strike Multiplier',
        '[Fire|Adds 43 to 67 Fire Damage]',
      ],
    },
    { accountName: 'BowMaster#1111', currencyName: '神聖石', cardPopupText: '帝國之弓' },
  ),
  makeSnapshot(
    'p2',
    {
      name: 'Loath Visor',
      typeLine: 'Destroyer Regalia',
      frameType: 2,
      implicitMods: [{ description: '+120 to maximum Life' }],
      craftedMods: ['+35% to Cold Resistance'],
    },
    { accountName: 'ArmorVendor#2222', currency: 'chaos', cardPopupText: '破城之盔' },
  ),
];

const mockPinnedList = vi.fn(async () => sampleItems);

vi.mock('@/utils/pinned-item-client', () => ({
  createPinnedItemClient: () => ({
    list: mockPinnedList,
    subscribe: () => () => {},
    pin: vi.fn(async () => ({ ok: true })),
    unpin: vi.fn(async () => ({ ok: true })),
    reorder: vi.fn(async () => ({ ok: true })),
    clear: vi.fn(async () => ({ ok: true })),
    markSold: vi.fn(async () => ({ ok: true })),
    clearSold: vi.fn(async () => ({ ok: true })),
  }),
}));

vi.mock('@/utils/trade-context', () => ({
  getPoeVersion: () => 'poe1',
  getTradeLeague: () => 'Covens',
}));

describe('filterPinnedItems', () => {
  it('returns all items when query is blank', () => {
    expect(filterPinnedItems(sampleItems, '')).toHaveLength(2);
    expect(filterPinnedItems(sampleItems, '   ')).toHaveLength(2);
  });

  it('matches across item name, unwrapped mods, seller account, currency, and card snapshot text', () => {
    expect(filterPinnedItems(sampleItems, 'apocalypse').map((i) => i.id)).toEqual(['p1']);
    expect(filterPinnedItems(sampleItems, 'fire damage').map((i) => i.id)).toEqual(['p1']);
    expect(filterPinnedItems(sampleItems, '神聖石').map((i) => i.id)).toEqual(['p1']);
    expect(filterPinnedItems(sampleItems, 'armorvendor').map((i) => i.id)).toEqual(['p2']);
    expect(filterPinnedItems(sampleItems, 'cold resistance').map((i) => i.id)).toEqual(['p2']);
    expect(filterPinnedItems(sampleItems, '破城之盔').map((i) => i.id)).toEqual(['p2']);
  });

  it('requires all whitespace-separated tokens to match', () => {
    expect(filterPinnedItems(sampleItems, 'loath cold').map((i) => i.id)).toEqual(['p2']);
    expect(filterPinnedItems(sampleItems, 'loath fire')).toEqual([]);
  });
});

describe('PinnedItemPane search bar', () => {
  let container: HTMLElement;
  let unmount: (() => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
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

  it('toggles search input, filters pinned rows, disables drag while filtering, and clears on Esc', async () => {
    const app = createApp({ render: () => h(PinnedItemPane) });
    app.mount(container);
    unmount = () => app.unmount();
    await flush();

    expect(container.querySelectorAll('[data-pinned-item-id]')).toHaveLength(2);
    expect(container.querySelector('[data-pinned-items-search]')).toBeNull();

    const toggle = container.querySelector<HTMLButtonElement>('[data-pinned-items-search-toggle]')!;
    toggle.click();
    await flush();

    const input = container.querySelector<HTMLInputElement>('[data-pinned-items-search]')!;
    expect(input).not.toBeNull();

    input.value = 'loath';
    input.dispatchEvent(new Event('input'));
    await flush();

    const rows = container.querySelectorAll('[data-pinned-item-id]');
    expect(rows).toHaveLength(1);
    expect(rows[0].getAttribute('data-pinned-item-id')).toBe('p2');
    expect(sortableOptionMock).toHaveBeenCalledWith('disabled', true);

    input.value = 'no-such-item-xyz';
    input.dispatchEvent(new Event('input'));
    await flush();

    expect(container.querySelectorAll('[data-pinned-item-id]')).toHaveLength(0);
    expect(container.querySelector('[data-pinned-items-no-match]')?.textContent).toContain(
      'no-such-item-xyz',
    );

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flush();

    expect(container.querySelector('[data-pinned-items-search]')).toBeNull();
    expect(container.querySelectorAll('[data-pinned-item-id]')).toHaveLength(2);
    expect(sortableOptionMock).toHaveBeenCalledWith('disabled', false);
    expect(vi.mocked(Sortable.create)).toHaveBeenCalled();
  });
});
