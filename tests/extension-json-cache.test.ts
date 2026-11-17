import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadExtensionJson } from '@/utils/extension-json-cache';

function stubFetch(handler: (url: string) => unknown | Promise<unknown>) {
  const fetchMock = vi.fn(async (url: string) => {
    const body = await handler(url);
    if (body instanceof Response) return body;
    return new Response(JSON.stringify(body), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('loadExtensionJson', () => {
  it('shares one request between concurrent callers', async () => {
    const fetchMock = stubFetch(() => ({ items: ['a'] }));

    const [left, right] = await Promise.all([
      loadExtensionJson('json/poe1/locales/en/items.json'),
      loadExtensionJson('json/poe1/locales/en/items.json'),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(left).toBe(right);
  });

  it('reuses parsed data while it is still held', async () => {
    const fetchMock = stubFetch(() => ({ items: ['a'] }));

    const first = await loadExtensionJson('json/a.json');
    const second = await loadExtensionJson('json/a.json');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('resolves the asset through chrome.runtime.getURL', async () => {
    const fetchMock = stubFetch(() => ({}));
    vi.stubGlobal('chrome', {
      runtime: { getURL: (path: string) => `chrome-extension://id${path}` },
    });

    await loadExtensionJson('json/b.json');

    expect(fetchMock).toHaveBeenCalledWith('chrome-extension://id/json/b.json');
  });

  it('deep-freezes shared data so no caller can mutate it for the others', async () => {
    stubFetch(() => ({ stats: { id: ['text'] } }));

    const data = (await loadExtensionJson('json/c.json')) as { stats: { id: string[] } };

    expect(Object.isFrozen(data)).toBe(true);
    expect(Object.isFrozen(data.stats)).toBe(true);
    expect(Object.isFrozen(data.stats.id)).toBe(true);
    expect(() => data.stats.id.push('x')).toThrow(TypeError);
  });

  it('rejects on HTTP errors and retries on the next call', async () => {
    let ok = false;
    const fetchMock = stubFetch(() => (ok ? { ok: true } : new Response(null, { status: 404 })));

    await expect(loadExtensionJson('json/d.json')).rejects.toThrow('json/d.json: HTTP 404');
    ok = true;
    await expect(loadExtensionJson('json/d.json')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
