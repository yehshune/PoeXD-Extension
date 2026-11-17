import { describe, expect, it, vi } from 'vitest';
import {
  fetchPobShareCode,
  POB_SHARE_PERMISSION_PAGE,
  registerPobShareBackgroundHandlers,
} from '@/utils/pob-share-fetch';

const respond = (
  body: string,
  init: { status?: number; url?: string; headers?: Record<string, string> } = {},
) => {
  const response = new Response(body, { status: init.status ?? 200, headers: init.headers });
  Object.defineProperty(response, 'url', { value: init.url ?? '' });
  return response;
};

const makeDeps = (fetchImpl: (...args: any[]) => Promise<Response>, permitted = true) => ({
  fetch: vi.fn(fetchImpl) as unknown as typeof fetch,
  hasPermission: vi.fn(async (_origin: string) => permitted),
});

const NINJA = 'https://poe.ninja/poe1/pob/abc';

describe('fetchPobShareCode', () => {
  it('以不帶 cookie 的請求取回原始代碼並去掉頭尾空白', async () => {
    const deps = makeDeps(async () =>
      respond('  eNrt-abc_123==\n', { url: 'https://poe.ninja/poe1/pob/raw/abc' }),
    );
    expect(await fetchPobShareCode(NINJA, deps)).toEqual({ ok: true, code: 'eNrt-abc_123==' });
    expect(deps.fetch).toHaveBeenCalledWith(
      'https://poe.ninja/poe1/pob/raw/abc',
      expect.objectContaining({ credentials: 'omit' }),
    );
    expect(deps.hasPermission).not.toHaveBeenCalled();
  });

  it('不支援的網址不連線', async () => {
    const deps = makeDeps(async () => respond('x'));
    expect(await fetchPobShareCode('https://example.com/a', deps)).toEqual({
      ok: false,
      error: 'invalid-url',
    });
    expect(await fetchPobShareCode(undefined, deps)).toEqual({ ok: false, error: 'invalid-url' });
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it('選用權限未授權（或查詢失敗）時不連線', async () => {
    const deps = makeDeps(async () => respond('abc'), false);
    expect(await fetchPobShareCode('https://pobb.in/abcdef', deps)).toEqual({
      ok: false,
      error: 'permission',
    });
    expect(deps.hasPermission).toHaveBeenCalledWith('https://pobb.in/*');
    deps.hasPermission.mockRejectedValueOnce(new Error('x'));
    expect(await fetchPobShareCode('https://pobb.in/abcdef', deps)).toEqual({
      ok: false,
      error: 'permission',
    });
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it('404 為找不到，其他錯誤狀態為 http', async () => {
    const paste = 'https://pastebin.com/abcd1234';
    expect(
      await fetchPobShareCode(
        paste,
        makeDeps(async () => respond('', { status: 404 })),
      ),
    ).toEqual({ ok: false, error: 'not-found' });
    expect(
      await fetchPobShareCode(
        paste,
        makeDeps(async () => respond('', { status: 503 })),
      ),
    ).toEqual({ ok: false, error: 'http' });
  });

  it('讀內容前就拒絕的回應會取消內容串流', async () => {
    const cancelled: string[] = [];
    const streamFor = (label: string) =>
      new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array(10).fill(97));
        },
        cancel() {
          cancelled.push(label);
        },
      });
    const withUrl = (response: Response, url: string) => {
      Object.defineProperty(response, 'url', { value: url });
      return response;
    };
    const paste = 'https://pastebin.com/abcd1234';
    await fetchPobShareCode(paste, makeDeps(async () => new Response(streamFor('404'), { status: 404 })));
    await fetchPobShareCode(
      NINJA,
      makeDeps(async () => withUrl(new Response(streamFor('redirect')), 'https://evil.example/raw')),
    );
    await fetchPobShareCode(
      NINJA,
      makeDeps(
        async () =>
          new Response(streamFor('declared'), { headers: { 'content-length': '500000' } }),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cancelled.sort()).toEqual(['404', 'declared', 'redirect']);
  });

  it('轉址到其他網站時不採用', async () => {
    const deps = makeDeps(async () => respond('abc', { url: 'https://evil.example/raw' }));
    expect(await fetchPobShareCode(NINJA, deps)).toEqual({ ok: false, error: 'invalid' });
  });

  it('過大或含非 Base64 字元的內容不採用', async () => {
    const declaredLarge = makeDeps(async () =>
      respond('abc', { headers: { 'content-length': '500000' } }),
    );
    expect(await fetchPobShareCode(NINJA, declaredLarge)).toEqual({
      ok: false,
      error: 'too-large',
    });
    const bodyLarge = makeDeps(async () => respond('a'.repeat(400_001)));
    expect(await fetchPobShareCode(NINJA, bodyLarge)).toEqual({ ok: false, error: 'too-large' });
    // 沒有 content-length 的串流：超過上限就中止讀取，不把剩下的內容讀完
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(100_000).fill(97));
      },
    });
    const streamed = makeDeps(async () => new Response(endless));
    expect(await fetchPobShareCode(NINJA, streamed)).toEqual({ ok: false, error: 'too-large' });
    expect(pulled).toBeLessThan(10);
    const html = makeDeps(async () => respond('<html>blocked</html>'));
    expect(await fetchPobShareCode(NINJA, html)).toEqual({ ok: false, error: 'invalid' });
    const blank = makeDeps(async () => respond('   '));
    expect(await fetchPobShareCode(NINJA, blank)).toEqual({ ok: false, error: 'invalid' });
  });

  it('逾時與網路錯誤', async () => {
    const hang = makeDeps(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init.signal!.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    expect(await fetchPobShareCode(NINJA, { ...hang, timeoutMs: 5 })).toEqual({
      ok: false,
      error: 'timeout',
    });
    const offline = makeDeps(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await fetchPobShareCode(NINJA, offline)).toEqual({ ok: false, error: 'network' });
  });
});

describe('registerPobShareBackgroundHandlers', () => {
  it('取回代碼與開啟授權頁，取消註冊後移除', async () => {
    const handlers = new Map<string, (message: { data: unknown }) => unknown>();
    const messenger = {
      onMessage: vi.fn((type: string, handler: (message: { data: unknown }) => unknown) => {
        handlers.set(type, handler);
        return () => {
          handlers.delete(type);
        };
      }),
    };
    const openPage = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('x'));
    const unregister = registerPobShareBackgroundHandlers({
      messenger: messenger as never,
      deps: makeDeps(async () => respond('abc')),
      openPage,
    });

    const fetchCode = handlers.get('pobShare:fetchCode')!;
    expect(await fetchCode({ data: { url: 'https://poe.ninja/pob/abc' } })).toEqual({
      ok: true,
      code: 'abc',
    });
    expect(await fetchCode({ data: null })).toEqual({ ok: false, error: 'invalid-url' });

    const open = handlers.get('pobShare:openPermissionPage')!;
    expect(await open({ data: undefined })).toBe(true);
    expect(openPage).toHaveBeenCalledWith(POB_SHARE_PERMISSION_PAGE);
    expect(await open({ data: undefined })).toBe(false);

    unregister();
    expect(handlers.size).toBe(0);
  });

  it('pobb.in 翻譯腳本只能讀白名單內的資料檔，且只接受來自 pobb.in 分頁的請求', async () => {
    const handlers = new Map<string, (message: unknown) => unknown>();
    const messenger = {
      onMessage: vi.fn((type: string, handler: (message: unknown) => unknown) => {
        handlers.set(type, handler);
        return () => handlers.delete(type);
      }),
    };
    const loadAsset = vi.fn(async (path: string) => ({ path }));
    registerPobShareBackgroundHandlers({
      messenger: messenger as never,
      deps: makeDeps(async () => respond('abc')),
      loadAsset,
    });
    const load = handlers.get('pobbin:loadAsset')!;
    const fromPobbin = { url: 'https://pobb.in/abc123' };

    await expect(
      load({ data: { path: 'json/poe1/locales/zh-TW/mod-lines.json' }, sender: fromPobbin }),
    ).resolves.toEqual({ path: 'json/poe1/locales/zh-TW/mod-lines.json' });
    await expect(
      load({ data: { path: 'json/locales/zh-CN/trade-ui.json' }, sender: fromPobbin }),
    ).resolves.toEqual({ path: 'json/locales/zh-CN/trade-ui.json' });

    for (const path of [
      '../manifest.json',
      'json/poe1/../../manifest.json',
      'json/poe1/mods-tiers.json',
      'interceptor.js',
    ]) {
      expect(() => load({ data: { path }, sender: fromPobbin })).toThrow();
    }
    expect(() =>
      load({
        data: { path: 'json/poe1/locales/zh-TW/mod-lines.json' },
        sender: { url: 'https://evil.example/pobb.in' },
      }),
    ).toThrow();
    expect(loadAsset).toHaveBeenCalledTimes(2);
  });
});
