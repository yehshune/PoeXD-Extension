// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RESULT_PIN_BUTTON_CLASS,
  RESULT_PINNED_ROW_CLASS,
  ResultPinButton,
  readRowCurrency,
} from '@/entrypoints/content/logic/result-pin-button';
import type { PinnedItemClient } from '@/utils/pinned-item-client';
import type { PinnedItemOutcome, PinnedItemSnapshot } from '@/utils/pinned-items';
import { TradeResultCache } from '@/utils/trade-result-cache';

function setupClient(pinOutcome: PinnedItemOutcome = { ok: true }) {
  let listener: ((items: PinnedItemSnapshot[]) => void) | undefined;
  const client = {
    list: vi.fn(async () => [] as PinnedItemSnapshot[]),
    subscribe: vi.fn((next: (items: PinnedItemSnapshot[]) => void) => {
      listener = next;
      return () => undefined;
    }),
    pin: vi.fn(async (_snapshot: PinnedItemSnapshot) => pinOutcome),
    unpin: vi.fn(async (): Promise<PinnedItemOutcome> => ({ ok: true })),
    clear: vi.fn(async (): Promise<PinnedItemOutcome> => ({ ok: true })),
  } satisfies PinnedItemClient;
  return { client, emit: (items: PinnedItemSnapshot[]) => listener?.(items) };
}

describe('ResultPinButton', () => {
  let cache: TradeResultCache;
  const notify = vi.fn();

  beforeEach(() => {
    document.body.innerHTML =
      '<div class="results"><div class="row" data-id="r1"><div class="left"></div></div>' +
      '<div class="row" data-id="r2"><div class="left"></div></div></div>';
    cache = new TradeResultCache();
    cache.ingestResult(
      {
        id: 'r1',
        item: { typeLine: 'Ring', frameType: 1 },
        listing: { hideout_token: 'secret', price: { amount: 1, currency: 'alch' } },
      },
      { sourceSearchId: 'q1', league: 'Covens' },
    );
    notify.mockReset();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  const create = (client: PinnedItemClient) =>
    new ResultPinButton('poe1', cache, client, {
      getOrigin: () => 'https://www.pathofexile.com',
      getPageLeague: () => 'Standard',
      getPageLocale: () => 'en',
      now: () => 42,
      notify,
      readCurrency: () => undefined,
      readCard: () => undefined,
    });

  it('mounts only on rows whose result data is cached', () => {
    const { client } = setupClient();
    create(client).setEnabled(true);
    expect(document.querySelector(`[data-id="r1"] .${RESULT_PIN_BUTTON_CLASS}`)).not.toBeNull();
    expect(document.querySelector(`[data-id="r2"] .${RESULT_PIN_BUTTON_CLASS}`)).toBeNull();
  });

  it('pins a sanitized snapshot with the cached league and search', async () => {
    const { client } = setupClient();
    const pin = create(client);
    pin.setEnabled(true);
    await pin.toggle('r1');
    const snapshot = client.pin.mock.calls[0]![0] as PinnedItemSnapshot;
    expect(snapshot).toMatchObject({
      id: 'r1',
      league: 'Covens',
      sourceSearchId: 'q1',
      pinnedAt: 42,
      listing: { instantBuyout: true },
    });
    expect(JSON.stringify(snapshot)).not.toContain('secret');
    expect(notify).toHaveBeenCalledWith(expect.any(String), 'success');
  });

  it('shows the pinned marker from storage updates and unpins on the next toggle', async () => {
    const { client, emit } = setupClient();
    const pin = create(client);
    pin.setEnabled(true);
    emit([{ id: 'r1' } as PinnedItemSnapshot]);
    const row = document.querySelector('[data-id="r1"]')!;
    expect(row.classList.contains(RESULT_PINNED_ROW_CLASS)).toBe(true);
    expect(row.querySelector(`.${RESULT_PIN_BUTTON_CLASS}`)?.getAttribute('aria-pressed')).toBe(
      'true',
    );
    await pin.toggle('r1');
    expect(client.unpin).toHaveBeenCalledWith('r1');
  });

  it('reports the limit without pinning', async () => {
    const { client } = setupClient({ ok: false, error: { code: 'limit', message: 'full' } });
    const pin = create(client);
    pin.setEnabled(true);
    await pin.toggle('r1');
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('50'), 'error');
  });

  it('reports a failure instead of staying silent when messaging throws', async () => {
    const { client } = setupClient();
    client.pin.mockRejectedValueOnce(new Error('Extension context invalidated.'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const pin = create(client);
    pin.setEnabled(true);
    await expect(pin.toggle('r1')).resolves.toBeUndefined();
    expect(notify).toHaveBeenCalledWith(expect.any(String), 'error');
    warn.mockRestore();
  });

  it('ignores repeated clicks while a toggle is in flight', async () => {
    const { client } = setupClient();
    const pin = create(client);
    pin.setEnabled(true);
    await Promise.all([pin.toggle('r1'), pin.toggle('r1')]);
    expect(client.pin).toHaveBeenCalledTimes(1);
  });

  it('removes buttons and markers when disabled', () => {
    const { client, emit } = setupClient();
    const pin = create(client);
    pin.setEnabled(true);
    emit([{ id: 'r1' } as PinnedItemSnapshot]);
    pin.setEnabled(false);
    expect(document.querySelector(`.${RESULT_PIN_BUTTON_CLASS}`)).toBeNull();
    expect(document.querySelector(`.${RESULT_PINNED_ROW_CLASS}`)).toBeNull();
  });

  it('reads the currency icon and name from the official price on the row', () => {
    document
      .querySelector('[data-id="r1"]')!
      .insertAdjacentHTML(
        'beforeend',
        '<div class="right"><div class="price"><span class="currency-text currency-image">' +
          '<img src="https://web.poecdn.com/gen/image/divine.png" alt="divine" title="divine">' +
          '<span>神聖石 (Divine Orb)</span></span></div></div>',
      );
    expect(readRowCurrency('r1')).toEqual({
      icon: 'https://web.poecdn.com/gen/image/divine.png',
      name: '神聖石 (Divine Orb)',
    });
    expect(readRowCurrency('r2')).toBeUndefined();
  });

  it('stores the row currency icon in the pinned snapshot', async () => {
    const { client } = setupClient();
    const pin = new ResultPinButton('poe1', cache, client, {
      getOrigin: () => 'https://www.pathofexile.com',
      getPageLeague: () => 'Standard',
      getPageLocale: () => 'en',
      now: () => 42,
      notify,
      readCurrency: () => ({ icon: 'https://web.poecdn.com/gen/image/alch.png', name: 'Alch' }),
      readCard: () => undefined,
    });
    pin.setEnabled(true);
    await pin.toggle('r1');
    expect(client.pin.mock.calls[0]![0].listing.price).toMatchObject({
      icon: 'https://web.poecdn.com/gen/image/alch.png',
      currencyName: 'Alch',
    });
  });
});
