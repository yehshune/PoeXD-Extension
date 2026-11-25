import { describe, expect, it, vi } from 'vitest';
import {
  broadcastToTradeTabs,
  callBackgroundWithUnavailable,
  createRefCountedChangeHub,
  createTradeTabBroadcastTransport,
  registerReadyGatedHandler,
  unavailableOutcome,
} from '@/utils/background-messaging';
import type { SearchRecordChange } from '@/utils/search-records';

function createFakeMessenger() {
  const handlers = new Map<string, (message: { data: any }) => any>();
  return {
    handlers,
    onMessage: vi.fn((type: string, handler: (message: { data: any }) => any) => {
      if (handlers.has(type)) {
        throw new Error(`Duplicate listener registered for ${type}`);
      }
      handlers.set(type, handler);
      return () => {
        handlers.delete(type);
      };
    }),
    sendMessage: vi.fn(async (type: string, data: any, _tabId?: number) => {
      const handler = handlers.get(type);
      if (handler) return handler({ data });
      return undefined;
    }),
  };
}

describe('background messaging primitives', () => {
  describe('unavailableOutcome & callBackgroundWithUnavailable', () => {
    it('builds a structured unavailable outcome', () => {
      expect(unavailableOutcome('Background unreachable')).toEqual({
        ok: false,
        error: {
          code: 'unavailable',
          message: 'Background unreachable',
        },
      });
    });

    it('passes through defined responses without wrapping', async () => {
      const result = await callBackgroundWithUnavailable(
        async () => ({ ok: true as const, changed: true }),
        'No response',
      );
      expect(result).toEqual({ ok: true, changed: true });
    });

    it('maps undefined responses to unavailableOutcome with noResponseMessage', async () => {
      const result = await callBackgroundWithUnavailable(async () => undefined, 'No response');
      expect(result).toEqual({
        ok: false,
        error: { code: 'unavailable', message: 'No response' },
      });
    });

    it('maps thrown Error instances and non-Error values to unavailableOutcome', async () => {
      const errorResult = await callBackgroundWithUnavailable(async () => {
        throw new Error('Extension context invalidated');
      }, 'No response');
      expect(errorResult).toEqual({
        ok: false,
        error: { code: 'unavailable', message: 'Extension context invalidated' },
      });

      const stringResult = await callBackgroundWithUnavailable(async () => {
        throw 'channel closed';
      }, 'No response');
      expect(stringResult).toEqual({
        ok: false,
        error: { code: 'unavailable', message: 'channel closed' },
      });
    });
  });

  describe('createRefCountedChangeHub', () => {
    it('hooks lazily on first subscriber, shares one hook across subscribers, isolates errors, unhooks on last leave, and re-hooks on next subscribe', async () => {
      const messenger = createFakeMessenger();
      const hub = createRefCountedChangeHub('searchRecord:change', messenger as any);

      expect(hub.subscriberCount).toBe(0);
      expect(messenger.onMessage).not.toHaveBeenCalled();

      const receivedA: SearchRecordChange[] = [];
      const receivedB: SearchRecordChange[] = [];

      const unsubA = hub.subscribe((change) => {
        receivedA.push(change);
        throw new Error('Listener failure should be isolated');
      });
      expect(hub.subscriberCount).toBe(1);
      expect(messenger.onMessage).toHaveBeenCalledTimes(1);
      expect(messenger.onMessage).toHaveBeenCalledWith('searchRecord:change', expect.any(Function));

      const unsubB = hub.subscribe((change) => {
        receivedB.push(change);
      });
      expect(hub.subscriberCount).toBe(2);
      expect(messenger.onMessage).toHaveBeenCalledTimes(1);

      const change1: SearchRecordChange = {
        command: { type: 'clear-history', gameVersion: 'poe1' },
      };
      await expect(messenger.sendMessage('searchRecord:change', change1, 1)).resolves.toBeUndefined();
      expect(receivedA).toEqual([change1]);
      expect(receivedB).toEqual([change1]);

      // Unsubscribing A keeps the single underlying listener attached for B
      unsubA();
      unsubA(); // idempotent
      expect(hub.subscriberCount).toBe(1);
      expect(messenger.handlers.has('searchRecord:change')).toBe(true);

      const change2: SearchRecordChange = {
        command: { type: 'set-history-enabled', gameVersion: 'poe2', enabled: false },
      };
      await messenger.sendMessage('searchRecord:change', change2, 1);
      expect(receivedA).toEqual([change1]);
      expect(receivedB).toEqual([change1, change2]);

      // Unsubscribing the last subscriber detaches the underlying listener
      unsubB();
      expect(hub.subscriberCount).toBe(0);
      expect(messenger.handlers.has('searchRecord:change')).toBe(false);

      // Re-subscribing later hooks again cleanly
      const receivedC: SearchRecordChange[] = [];
      const unsubC = hub.subscribe((change) => {
        receivedC.push(change);
      });
      expect(hub.subscriberCount).toBe(1);
      expect(messenger.onMessage).toHaveBeenCalledTimes(2);

      await messenger.sendMessage('searchRecord:change', change1, 1);
      expect(receivedC).toEqual([change1]);

      unsubC();
      expect(hub.subscriberCount).toBe(0);
      expect(messenger.handlers.has('searchRecord:change')).toBe(false);
    });
  });

  describe('broadcastToTradeTabs & createTradeTabBroadcastTransport', () => {
    it('delivers to all listed tab IDs and isolates single-tab rejections', async () => {
      const attemptedTabs: number[] = [];
      const payload = { command: { type: 'clear-history' as const, gameVersion: 'poe1' as const } };

      await expect(
        broadcastToTradeTabs(payload, {
          listTradeTabIds: async () => [10, 20, 30],
          sendChangeToTab: async (tabId, sent) => {
            attemptedTabs.push(tabId);
            expect(sent).toEqual(payload);
            if (tabId === 20) {
              throw new Error('Receiving end does not exist');
            }
          },
        }),
      ).resolves.toBeUndefined();

      expect(attemptedTabs).toEqual([10, 20, 30]);
    });

    it('builds a Trade-tab broadcast transport wired to a typed protocol channel', async () => {
      const messenger = createFakeMessenger();
      const delivered: Array<{ tabId: number; payload: unknown }> = [];
      messenger.sendMessage.mockImplementation(
        async (_type: string, data: any, tabId?: number) => {
          if (tabId === 2) throw new Error('Tab closed');
          delivered.push({ tabId: tabId!, payload: data });
        },
      );

      const transport = createTradeTabBroadcastTransport(
        'economy:change',
        async () => [1, 2, 3],
        messenger as any,
      );
      const change = {
        version: 'poe2' as const,
        league: 'Standard',
        metadata: {
          updatedAt: 1000,
          source: 'cache' as const,
          ttl: 3600000,
          hasData: true,
          isExpired: false,
        },
      };

      await expect(broadcastToTradeTabs(change, transport)).resolves.toBeUndefined();
      expect(messenger.sendMessage).toHaveBeenCalledTimes(3);
      expect(messenger.sendMessage).toHaveBeenCalledWith('economy:change', change, 1);
      expect(messenger.sendMessage).toHaveBeenCalledWith('economy:change', change, 2);
      expect(messenger.sendMessage).toHaveBeenCalledWith('economy:change', change, 3);
      expect(delivered).toEqual([
        { tabId: 1, payload: change },
        { tabId: 3, payload: change },
      ]);
    });
  });

  describe('registerReadyGatedHandler', () => {
    it('forwards payload to handle once getReady succeeds and unregisters on cleanup', async () => {
      const messenger = createFakeMessenger();
      const handle = vi.fn(async () => ({ ok: true as const, changed: true }));

      const unregister = registerReadyGatedHandler('searchRecord:execute', {
        messenger: messenger as any,
        getReady: async () => ({ ok: true, changed: false }),
        handle,
      });

      const command = { type: 'clear-history' as const, gameVersion: 'poe1' as const };
      const outcome = await messenger.sendMessage('searchRecord:execute', command);

      expect(outcome).toEqual({ ok: true, changed: true });
      expect(handle).toHaveBeenCalledTimes(1);
      expect(handle).toHaveBeenCalledWith(command);

      unregister();
      expect(messenger.handlers.has('searchRecord:execute')).toBe(false);
    });

    it('short-circuits without invoking handle when getReady returns a failure outcome', async () => {
      const messenger = createFakeMessenger();
      const handle = vi.fn();
      const failure = {
        ok: false as const,
        error: { code: 'storage-failure' as const, message: 'Migration failed' },
      };

      registerReadyGatedHandler('bookmark:read', {
        messenger: messenger as any,
        getReady: async () => failure,
        handle,
      });

      const outcome = await messenger.sendMessage('bookmark:read', {
        type: 'get-collection',
        gameVersion: 'poe2',
      });

      expect(outcome).toEqual(failure);
      expect(handle).not.toHaveBeenCalled();
    });

    it('wraps thrown errors from getReady or handle into unavailableOutcome', async () => {
      const messenger = createFakeMessenger();

      registerReadyGatedHandler('searchRecord:execute', {
        messenger: messenger as any,
        getReady: async () => {
          throw new Error('Init exploded');
        },
        handle: vi.fn(),
      });

      const readyErrorOutcome = await messenger.sendMessage('searchRecord:execute', {
        type: 'clear-history',
        gameVersion: 'poe1',
      });
      expect(readyErrorOutcome).toEqual({
        ok: false,
        error: { code: 'unavailable', message: 'Init exploded' },
      });

      registerReadyGatedHandler('searchRecord:read', {
        messenger: messenger as any,
        getReady: async () => ({ ok: true, changed: false }),
        handle: async () => {
          throw new Error('Handler exploded');
        },
      });

      const handleErrorOutcome = await messenger.sendMessage('searchRecord:read', {
        type: 'list-history',
        gameVersion: 'poe1',
      });
      expect(handleErrorOutcome).toEqual({
        ok: false,
        error: { code: 'unavailable', message: 'Handler exploded' },
      });
    });
  });
});
