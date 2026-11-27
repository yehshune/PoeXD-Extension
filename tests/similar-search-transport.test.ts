import { describe, expect, it, vi } from 'vitest';
import { createSimilarTradeTransport } from '@/entrypoints/content/logic/similar-search-transport';

function fakeTimer() {
  let now = 0;
  const pending: { at: number; run: () => void }[] = [];
  return {
    timer: {
      now: () => now,
      setTimeout: (run: () => void, ms: number) => {
        const entry = { at: now + ms, run };
        pending.push(entry);
        return entry;
      },
      clearTimeout: (id: unknown) => {
        const index = pending.indexOf(id as (typeof pending)[number]);
        if (index >= 0) pending.splice(index, 1);
      },
    },
    advance(ms: number) {
      now += ms;
      for (const entry of pending.filter((candidate) => candidate.at <= now)) {
        pending.splice(pending.indexOf(entry), 1);
        entry.run();
      }
    },
  };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createSimilarTradeTransport', () => {
  it('PoE 1：POST 官方 search，GET 官方 fetch（帶 query）', async () => {
    const fetchClient = vi
      .fn()
      .mockResolvedValueOnce(json({ id: 'q1', result: ['a', 'b'], total: 2 }))
      .mockResolvedValueOnce(
        json({ result: [{ id: 'a', item: { name: 'A' }, listing: {} }, null] }),
      );
    const transport = createSimilarTradeTransport({
      origin: 'https://www.pathofexile.com',
      version: 'poe1',
      league: 'Covens',
      fetchClient,
    });

    const search = await transport.search({ query: { status: { option: 'securable' } } });
    expect(search).toEqual({
      ok: true,
      data: { id: 'q1', result: ['a', 'b'], total: 2, inexact: false },
    });
    const [searchUrl, searchInit] = fetchClient.mock.calls[0];
    expect(searchUrl).toBe('https://www.pathofexile.com/api/trade/search/Covens');
    expect(searchInit).toMatchObject({ method: 'POST', credentials: 'same-origin' });
    expect(JSON.parse(searchInit.body)).toEqual({ query: { status: { option: 'securable' } } });

    const fetched = await transport.fetch(['a', 'b'], 'q1');
    expect(fetched).toEqual({ ok: true, data: [{ id: 'a', item: { name: 'A' }, listing: {} }] });
    expect(fetchClient.mock.calls[1][0]).toBe(
      'https://www.pathofexile.com/api/trade/fetch/a,b?query=q1',
    );
  });

  it('PoE 2 使用 trade2 路徑與 realm', async () => {
    const fetchClient = vi
      .fn()
      .mockResolvedValueOnce(json({ id: 'q', result: [], total: 0 }))
      .mockResolvedValueOnce(json({ result: [] }));
    const transport = createSimilarTradeTransport({
      origin: 'https://www.pathofexile.com',
      version: 'poe2',
      league: 'Forbidden Rites',
      fetchClient,
    });
    await transport.search({});
    await transport.fetch(['x'], 'q');
    expect(fetchClient.mock.calls[0][0]).toBe(
      'https://www.pathofexile.com/api/trade2/search/poe2/Forbidden%20Rites',
    );
    expect(fetchClient.mock.calls[1][0]).toBe(
      'https://www.pathofexile.com/api/trade2/fetch/x?query=q&realm=poe2',
    );
  });

  it('429 不重試，回報 rateLimited；其他錯誤帶官方訊息', async () => {
    const fetchClient = vi
      .fn()
      .mockResolvedValueOnce(json({ error: { message: 'Rate limit exceeded' } }, 429))
      .mockResolvedValueOnce(json({ error: { message: 'Query is too complex.' } }, 400));
    const transport = createSimilarTradeTransport({
      origin: 'https://www.pathofexile.com',
      version: 'poe1',
      league: 'Covens',
      fetchClient,
      timer: fakeTimer().timer,
    });
    expect(await transport.search({})).toMatchObject({ ok: false, rateLimited: true, status: 429 });
    expect(fetchClient).toHaveBeenCalledTimes(1);
    const other = createSimilarTradeTransport({
      origin: 'https://www.pathofexile.com',
      version: 'poe1',
      league: 'Covens',
      fetchClient,
    });
    expect(await other.search({})).toEqual({
      ok: false,
      rateLimited: false,
      status: 400,
      error: 'HTTP 400: Query is too complex.',
    });
  });

  it('依 x-rate-limit 標頭排隊：用完額度時等視窗結束才送下一次搜尋', async () => {
    const clock = fakeTimer();
    const limited = {
      'x-rate-limit-rules': 'Account',
      'x-rate-limit-account': '3:5:60',
      'x-rate-limit-account-state': '3:5:0',
    };
    const fetchClient = vi
      .fn()
      .mockResolvedValueOnce(json({ id: 'q1', result: [], total: 0 }, 200, limited))
      .mockResolvedValueOnce(json({ id: 'q2', result: [], total: 0 }));
    const transport = createSimilarTradeTransport({
      origin: 'https://www.pathofexile.com',
      version: 'poe1',
      league: 'Covens',
      fetchClient,
      timer: clock.timer,
    });
    await transport.search({});
    const second = transport.search({});
    await flush();
    expect(fetchClient).toHaveBeenCalledTimes(1);
    clock.advance(5000);
    expect(await second).toMatchObject({ ok: true, data: { id: 'q2' } });
    expect(fetchClient).toHaveBeenCalledTimes(2);
  });

  it('中止後不再送出請求', async () => {
    const fetchClient = vi.fn();
    const controller = new AbortController();
    controller.abort();
    const transport = createSimilarTradeTransport({
      origin: 'https://www.pathofexile.com',
      version: 'poe1',
      league: 'Covens',
      fetchClient,
    });
    expect(await transport.search({}, controller.signal)).toMatchObject({
      ok: false,
      error: 'cancelled',
    });
    expect(fetchClient).not.toHaveBeenCalled();
    transport.dispose();
  });
});
