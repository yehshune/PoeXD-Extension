// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MainWorldBridge } from '@/entrypoints/main-world/bridge-bootstrap';
import { createCrossWorldRpcClient, requestMainWorld, rpcFail } from '@/utils/cross-world-rpc';
import { dispatchPoeEvent } from '@/utils/event-contracts';
import { setupTestMainWorldBridge } from './helpers/main-world-bridge-harness';

describe('Cross-World RPC seam', () => {
  const unsubs: Array<() => void> = [];
  let bridge: MainWorldBridge;

  beforeEach(() => {
    bridge = setupTestMainWorldBridge('rpc-test-nonce');
  });

  afterEach(() => {
    while (unsubs.length > 0) {
      unsubs.pop()?.();
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('correlates concurrent requests and responses over real window CustomEvents + nonce handshake', async () => {
    let resolveSlow!: (value: { url: string }) => void;
    unsubs.push(
      bridge.handle('criteria-overlay.sync', () => {
        return new Promise<{ url: string }>((resolve) => {
          resolveSlow = resolve;
        });
      }),
    );
    unsubs.push(bridge.handle('page-guide.demo', () => null));

    const client = createCrossWorldRpcClient();
    const slowPromise = client.request('criteria-overlay.sync', undefined);
    const fastOutcome = await client.request('page-guide.demo', { action: 'show-filters' });

    expect(fastOutcome).toEqual({ ok: true, data: null });

    resolveSlow({ url: 'https://www.pathofexile.com/trade/search/Standard/synced' });
    const slowOutcome = await slowPromise;
    expect(slowOutcome).toEqual({
      ok: true,
      data: { url: 'https://www.pathofexile.com/trade/search/Standard/synced' },
    });

    client.dispose();
  });

  it('returns TIMEOUT when no response arrives within timeoutMs', async () => {
    vi.useFakeTimers();
    unsubs.push(bridge.handle('criteria-overlay.sync', () => new Promise(() => {})));

    const client = createCrossWorldRpcClient();
    const pending = client.request('criteria-overlay.sync', undefined, { timeoutMs: 250 });

    await vi.advanceTimersByTimeAsync(250);
    const outcome = await pending;

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe('TIMEOUT');
    }
    client.dispose();
  });

  it('immediately settles in-flight requests with DISPOSED on dispose() and rejects post-dispose calls', async () => {
    unsubs.push(bridge.handle('criteria-overlay.sync', () => new Promise(() => {})));

    const client = createCrossWorldRpcClient();
    const inFlight = client.request('criteria-overlay.sync', undefined, { timeoutMs: 5000 });
    client.dispose();

    const cancelled = await inFlight;
    expect(cancelled).toMatchObject({ ok: false, code: 'DISPOSED' });

    const afterDispose = await client.request('page-guide.demo', { action: 'restore' });
    expect(afterDispose).toMatchObject({ ok: false, code: 'DISPOSED' });
  });

  it('ignores responses with wrong or missing nonce', async () => {
    vi.useFakeTimers();
    // No handler registered on bridge; instead listen for raw request and forge bad-nonce responses
    const onRawRequest = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      const req = JSON.parse(detail.payload);
      // Wrong nonce
      window.dispatchEvent(
        new CustomEvent('poexd-rpc-response', {
          detail: {
            source: 'poexd',
            nonce: 'wrong-nonce',
            payload: JSON.stringify({
              requestId: req.requestId,
              method: req.method,
              ok: true,
              data: null,
            }),
          },
        }),
      );
      // Missing nonce / forged source
      window.dispatchEvent(
        new CustomEvent('poexd-rpc-response', {
          detail: {
            source: 'page-script',
            payload: JSON.stringify({
              requestId: req.requestId,
              method: req.method,
              ok: true,
              data: null,
            }),
          },
        }),
      );
    };
    window.addEventListener('poexd-rpc-request', onRawRequest);
    unsubs.push(() => window.removeEventListener('poexd-rpc-request', onRawRequest));

    // Register a silent never-resolving handler so bridge doesn't reply UNREGISTERED_METHOD
    unsubs.push(bridge.handle('page-guide.demo', () => new Promise(() => {})));

    const pending = requestMainWorld('page-guide.demo', { action: 'restore' }, { timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    const outcome = await pending;
    expect(outcome).toMatchObject({ ok: false, code: 'TIMEOUT' });
  });

  it('returns immediate UNREGISTERED_METHOD when no handler is registered on the bridge', async () => {
    const outcome = await requestMainWorld(
      'page-guide.demo',
      { action: 'restore' },
      { timeoutMs: 5000 },
    );
    expect(outcome).toMatchObject({ ok: false, code: 'UNREGISTERED_METHOD' });
  });

  it('returns immediate INVALID_REQUEST when a malformed request payload arrives at the bridge', async () => {
    unsubs.push(bridge.handle('page-guide.demo', () => null));

    const outcome = await requestMainWorld(
      'page-guide.demo',
      { action: 'not-a-real-action' as any },
      { timeoutMs: 5000 },
    );
    expect(outcome).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
  });

  it('returns INVALID_RESPONSE when Main World replies with malformed data (ADR-0014)', async () => {
    unsubs.push(bridge.handle('criteria-overlay.sync', () => ({ url: 12345 as any })));

    const outcome = await requestMainWorld('criteria-overlay.sync', undefined, { timeoutMs: 5000 });
    expect(outcome).toMatchObject({ ok: false, code: 'INVALID_RESPONSE' });
  });

  it('captures synchronous and asynchronous handler exceptions into structured failure envelopes', async () => {
    unsubs.push(
      bridge.handle('page-guide.demo', () => {
        throw new Error('SYNC_BOOM');
      }),
    );
    unsubs.push(
      bridge.handle('criteria-overlay.commit', async () => {
        throw new Error('ASYNC_BOOM');
      }),
    );

    const syncOutcome = await requestMainWorld('page-guide.demo', { action: 'show-filters' });
    expect(syncOutcome).toMatchObject({ ok: false, error: 'SYNC_BOOM' });

    const asyncOutcome = await requestMainWorld('criteria-overlay.commit', { ops: [] });
    expect(asyncOutcome).toMatchObject({ ok: false, error: 'ASYNC_BOOM' });
  });

  it('passes structured failure codes and diagnostics through from handler to caller', async () => {
    unsubs.push(
      bridge.handle('criteria-overlay.sync', async () =>
        rpcFail('PAGE_NOT_LOADED', 'PAGE_NOT_LOADED', {
          loaded: false,
          rootFound: true,
          elapsedMs: 12,
        }),
      ),
    );

    const outcome = await requestMainWorld('criteria-overlay.sync', undefined);
    expect(outcome).toEqual({
      ok: false,
      code: 'PAGE_NOT_LOADED',
      error: 'PAGE_NOT_LOADED',
      diagnostics: {
        loaded: false,
        rootFound: true,
        elapsedMs: 12,
      },
    });
  });

  it('stops handling requests after handler unsubscription', async () => {
    const unsub = bridge.handle('page-guide.demo', () => null);
    expect(await requestMainWorld('page-guide.demo', { action: 'restore' })).toEqual({
      ok: true,
      data: null,
    });

    unsub();
    expect(await requestMainWorld('page-guide.demo', { action: 'restore' })).toMatchObject({
      ok: false,
      code: 'UNREGISTERED_METHOD',
    });
  });

  it('returns DISPATCH_FAILED when request payload cannot be serialized', async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    const outcome = await requestMainWorld('livesearch.render-result', {
      localId: 'c1',
      batchId: 'b1',
      sourceSearchId: 's1',
      token: 't1',
      itemData: circular,
      total: 1,
    });
    expect(outcome).toMatchObject({ ok: false, code: 'DISPATCH_FAILED' });
  });

  it('keeps synchronous handlers strictly synchronous on the Main World side', () => {
    const order: string[] = [];
    unsubs.push(
      bridge.handle('livesearch.render-result', () => {
        order.push('handler-start');
        order.push('handler-end');
        return null;
      }),
    );

    const client = createCrossWorldRpcClient();
    void client.request('livesearch.render-result', {
      localId: 'c1',
      batchId: 'b1',
      sourceSearchId: 's1',
      token: 't1',
      itemData: { id: 'item-1' },
      total: 1,
    });
    order.push('after-request-call');

    expect(order).toEqual(['handler-start', 'handler-end', 'after-request-call']);
    client.dispose();
  });

  it('ignores malformed response envelopes that lack a matching requestId without crashing', async () => {
    unsubs.push(bridge.handle('page-guide.demo', () => null));
    // Inject a malformed response with valid nonce before a real request
    dispatchPoeEvent('poexd-rpc-response', 'not-valid-json');
    const outcome = await requestMainWorld('page-guide.demo', { action: 'restore' });
    expect(outcome).toEqual({ ok: true, data: null });
  });
});
