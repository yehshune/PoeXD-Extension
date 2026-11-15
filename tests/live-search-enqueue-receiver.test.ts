import { describe, expect, it, vi } from 'vitest';
import { registerLiveSearchPrimaryEnqueueBridge } from '@/entrypoints/content/logic/live-search-enqueue-receiver';
import type { LiveSearchConsumePendingEnqueueResponse } from '@/utils/live-search-contract';

describe('registerLiveSearchPrimaryEnqueueBridge', () => {
  function createHarness() {
    const listeners = new Map<string, (msg: { data: any }) => any>();
    const docListeners = new Map<string, Set<() => void>>();
    const doc = {
      visibilityState: 'hidden' as DocumentVisibilityState,
      addEventListener: vi.fn((type: string, cb: () => void) => {
        if (!docListeners.has(type)) docListeners.set(type, new Set());
        docListeners.get(type)!.add(cb);
      }),
      removeEventListener: vi.fn((type: string, cb: () => void) => {
        docListeners.get(type)?.delete(cb);
      }),
    };

    let nextPending: LiveSearchConsumePendingEnqueueResponse = { items: [] };
    const enqueueIncoming = vi.fn(async (items: readonly any[]) => ({
      success: true,
      addedCount: items.length,
      skippedCount: 0,
    }));

    const messenger = {
      onMessage: vi.fn((type: string, handler: (msg: { data: any }) => any) => {
        listeners.set(type, handler);
        return () => listeners.delete(type);
      }),
      sendMessage: vi.fn(async (_type: string) => nextPending),
    };

    let disposed = false;
    const cleanup = registerLiveSearchPrimaryEnqueueBridge({
      version: 'poe1',
      messenger: messenger as any,
      enqueueIncoming,
      isDisposed: () => disposed,
      doc: doc as unknown as Document,
    });

    return {
      listeners,
      doc,
      enqueueIncoming,
      messenger,
      setNextPending: (res: LiveSearchConsumePendingEnqueueResponse) => {
        nextPending = res;
      },
      triggerVisible: () => {
        doc.visibilityState = 'visible';
        for (const cb of docListeners.get('visibilitychange') ?? []) {
          cb();
        }
      },
      dispose: () => {
        disposed = true;
        cleanup();
      },
    };
  }

  it('drains pending queue on visibilitychange when background tab wakes up', async () => {
    const h = createHarness();
    await Promise.resolve();
    expect(h.enqueueIncoming).not.toHaveBeenCalled();

    const item = { url: 'https://www.pathofexile.com/trade/search/Standard/H4sIwake_1', name: 'A' };
    h.setNextPending({
      items: [item],
      batches: [{ batchId: 'enq_1', items: [item] }],
    });
    h.triggerVisible();
    await vi.waitFor(() => expect(h.enqueueIncoming).toHaveBeenCalledTimes(1));
    expect(h.enqueueIncoming).toHaveBeenCalledWith([item]);

    h.dispose();
    expect(h.doc.removeEventListener).toHaveBeenCalledWith(
      'visibilitychange',
      expect.any(Function),
    );
  });

  it('skips duplicate batchId when fallback buffered batch was already handled via direct receive', async () => {
    const h = createHarness();
    await Promise.resolve();

    const item = {
      url: 'https://www.pathofexile.com/trade/search/Standard/H4sIslow_1',
      name: 'Slow',
    };
    const receive = h.listeners.get('liveSearch:receiveEnqueuedConnections')!;
    const directRes = await receive({
      data: { batchId: 'enq_same_1', items: [item] },
    });
    expect(directRes.success).toBe(true);
    expect(h.enqueueIncoming).toHaveBeenCalledTimes(1);

    h.setNextPending({
      items: [item],
      batches: [{ batchId: 'enq_same_1', items: [item] }],
    });
    h.triggerVisible();
    await Promise.resolve();
    await Promise.resolve();

    // Must not replay the already-handled batchId on visibility wakeup
    expect(h.enqueueIncoming).toHaveBeenCalledTimes(1);

    h.dispose();
  });
});
