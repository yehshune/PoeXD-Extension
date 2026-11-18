import { describe, expect, it, vi } from 'vitest';
import {
  buildPinnedItemFetchUrl,
  buildPinnedItemSourceUrl,
  readTokenExpiryMs,
  travelToHideout,
  type HideoutTravelDeps,
} from '@/utils/pinned-item-actions';
import { createPinnedItemSnapshot, type PinnedItemSnapshot } from '@/utils/pinned-items';

const NOW = 1_800_000_000_000;
const ORIGIN = 'https://www.pathofexile.com';

function jwt(expSeconds: number): string {
  const payload = btoa(JSON.stringify({ iss: 'x', exp: expSeconds }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `header.${payload}.signature`;
}

const FRESH = jwt(NOW / 1000 + 300);
const EXPIRED = jwt(NOW / 1000 - 1);

function pinned(overrides: Partial<PinnedItemSnapshot> = {}): PinnedItemSnapshot {
  const snapshot = createPinnedItemSnapshot(
    {
      id: 'item1',
      item: { typeLine: 'Ring', frameType: 1 },
      listing: { hideout_token: 'stored', price: { amount: 1, currency: 'alch' } },
    },
    { gameVersion: 'poe1', origin: ORIGIN, league: 'Covens', sourceSearchId: 'q1' },
    1,
  );
  if (!snapshot) throw new Error('snapshot failed');
  return { ...snapshot, ...overrides };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function deps(options: {
  cachedListing?: unknown;
  fetchResponse?: Response | null;
  whisperResponse?: Response | null;
}) {
  const fetchGate = { fetch: vi.fn(async () => options.fetchResponse ?? null) };
  const whisperGate = { fetch: vi.fn(async () => options.whisperResponse ?? null) };
  const rememberResult = vi.fn();
  const value: HideoutTravelDeps = {
    currentOrigin: ORIGIN,
    getCachedListing: () => options.cachedListing,
    rememberResult,
    fetchGate,
    whisperGate,
    now: () => NOW,
  };
  return { value, fetchGate, whisperGate, rememberResult };
}

const whisperBody = (gate: { fetch: ReturnType<typeof vi.fn> }) =>
  JSON.parse((gate.fetch.mock.calls[0]![1] as RequestInit).body as string);

describe('travelToHideout', () => {
  it('uses an unexpired cached token without fetching again', async () => {
    const d = deps({
      cachedListing: { hideout_token: FRESH },
      whisperResponse: json({ success: true }),
    });
    await expect(travelToHideout(pinned(), d.value)).resolves.toEqual({ status: 'teleporting' });
    expect(d.fetchGate.fetch).not.toHaveBeenCalled();
    expect(d.whisperGate.fetch).toHaveBeenCalledWith(
      `${ORIGIN}/api/trade/whisper`,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(whisperBody(d.whisperGate)).toEqual({ token: FRESH });
  });

  it('refetches with the source search when the cached token expired', async () => {
    const result = { id: 'item1', item: {}, listing: { hideout_token: FRESH } };
    const d = deps({
      cachedListing: { hideout_token: EXPIRED },
      fetchResponse: json({ result: [result] }),
      whisperResponse: json({ success: true }),
    });
    await expect(travelToHideout(pinned(), d.value)).resolves.toEqual({ status: 'teleporting' });
    expect(d.fetchGate.fetch).toHaveBeenCalledWith(
      `${ORIGIN}/api/trade/fetch/item1?query=q1`,
      expect.anything(),
    );
    expect(d.rememberResult).toHaveBeenCalledWith(result, 'q1');
  });

  it('reports sold items and stale searches without sending a whisper', async () => {
    const sold = deps({ fetchResponse: json({ result: [null] }) });
    await expect(travelToHideout(pinned(), sold.value)).resolves.toEqual({ status: 'sold' });

    const stale = deps({ fetchResponse: json({ result: [{ id: 'item1', listing: {} }] }) });
    await expect(travelToHideout(pinned(), stale.value)).resolves.toEqual({
      status: 'refresh-required',
    });
    expect(sold.whisperGate.fetch).not.toHaveBeenCalled();
    expect(stale.whisperGate.fetch).not.toHaveBeenCalled();
  });

  it('maps in-demand and sends continue on the next click', async () => {
    const d = deps({
      cachedListing: { hideout_token: FRESH },
      whisperResponse: json({ success: false }),
    });
    await expect(travelToHideout(pinned(), d.value)).resolves.toEqual({ status: 'in-demand' });

    const again = deps({
      cachedListing: { hideout_token: FRESH },
      whisperResponse: json({ success: true }),
    });
    await travelToHideout(pinned(), again.value, { continueInDemand: true });
    expect(whisperBody(again.whisperGate)).toEqual({ token: FRESH, continue: true });
  });

  it('treats sold items returned with gone: true as sold without sending a whisper', async () => {
    const d = deps({
      fetchResponse: json({
        result: [{ id: 'item1', gone: true, item: {}, listing: { hideout_token: FRESH } }],
      }),
    });
    await expect(travelToHideout(pinned(), d.value)).resolves.toEqual({ status: 'sold' });
    expect(d.whisperGate.fetch).not.toHaveBeenCalled();
    expect(d.rememberResult).not.toHaveBeenCalled();
  });

  it('maps official error code 1 (item no longer available) to sold and other errors to messages', async () => {
    const invalid = deps({
      cachedListing: { hideout_token: FRESH },
      whisperResponse: json(
        { error: { code: 1, message: 'Resource not found; Item no longer available' } },
        404,
      ),
    });
    await expect(travelToHideout(pinned(), invalid.value)).resolves.toEqual({ status: 'sold' });
    const notInGame = deps({
      cachedListing: { hideout_token: FRESH },
      whisperResponse: json(
        {
          error: {
            code: 2,
            message: 'Invalid query; Your account must be in-game to use this feature',
          },
        },
        400,
      ),
    });
    await expect(travelToHideout(pinned(), notInGame.value)).resolves.toEqual({
      status: 'error',
      message: 'Invalid query; Your account must be in-game to use this feature',
    });
    const other = deps({
      cachedListing: { hideout_token: FRESH },
      whisperResponse: json({ error: { code: 8, message: 'Unauthorized' } }, 401),
    });
    await expect(travelToHideout(pinned(), other.value)).resolves.toEqual({
      status: 'error',
      message: 'Unauthorized',
    });
  });

  it('refuses to act on another realm', async () => {
    const d = deps({ cachedListing: { hideout_token: FRESH } });
    d.value.currentOrigin = 'https://pathofexile.tw';
    await expect(travelToHideout(pinned(), d.value)).resolves.toEqual({
      status: 'realm-mismatch',
    });
    expect(d.whisperGate.fetch).not.toHaveBeenCalled();
  });
});

describe('URLs and tokens', () => {
  it('builds PoE 2 fetch and source URLs', () => {
    const poe2 = pinned({ gameVersion: 'poe2', league: 'Rise of the Abyssal' });
    expect(buildPinnedItemFetchUrl(poe2, 'q1')).toBe(
      `${ORIGIN}/api/trade2/fetch/item1?query=q1&realm=poe2`,
    );
    expect(buildPinnedItemSourceUrl(poe2)).toBe(
      `${ORIGIN}/trade2/search/poe2/Rise%20of%20the%20Abyssal/q1`,
    );
    expect(buildPinnedItemSourceUrl(pinned({ sourceSearchId: undefined }))).toBeUndefined();
  });

  it('reads JWT expiry and ignores malformed tokens', () => {
    expect(readTokenExpiryMs(FRESH)).toBe(NOW + 300_000);
    expect(readTokenExpiryMs('not-a-jwt')).toBeUndefined();
    expect(readTokenExpiryMs('a.%%%.c')).toBeUndefined();
  });
});
