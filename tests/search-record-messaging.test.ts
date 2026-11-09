import { describe, expect, it, vi } from 'vitest';
import {
  createInMemorySearchRecordStorage,
  createSearchRecordModule,
} from '@/utils/search-records';
import {
  broadcastSearchRecordChange,
  createSearchRecordClient,
  type SearchRecordClientTransport,
} from '@/utils/search-record-messaging';
import type { SearchRecordChange } from '@/utils/search-records';
import { createSearchRecordCaptureAdapter } from '@/entrypoints/content/logic/search-record-capture';
import { createHistoryDomainFeed } from '@/components/sidebar/history-domain-feed';

function createModuleTransport(now: () => number = Date.now) {
  const module = createSearchRecordModule(createInMemorySearchRecordStorage(), now);
  const changeListeners = new Set<(change: SearchRecordChange) => void>();
  const transport: SearchRecordClientTransport = {
    execute: (command) => module.execute(command),
    read: (read) => module.read(read),
    subscribe(listener) {
      changeListeners.add(listener);
      return () => changeListeners.delete(listener);
    },
  };
  module.subscribe((change) => {
    changeListeners.forEach((listener) => listener(change));
  });
  return { module, transport };
}

describe('Search Record typed messaging seam', () => {
  it('routes commands, reads, and committed changes through one logical client interface', async () => {
    const { module, transport } = createModuleTransport(() => 10);
    await module.initialize();
    const firstTab = createSearchRecordClient(transport);
    const secondTab = createSearchRecordClient(transport);
    const changes: unknown[] = [];
    const unsubscribe = secondTab.subscribe((change) => changes.push(change));

    expect(
      await firstTab.execute({
        type: 'record-history',
        identity: {
          gameVersion: 'poe1',
          url: 'https://www.pathofexile.com/trade/search/Standard/id-1',
        },
        entry: {
          name: 'Rings',
          url: 'https://www.pathofexile.com/trade/search/Standard/id-1',
        },
      }),
    ).toEqual({ ok: true, changed: true });

    expect(await secondTab.read({ type: 'get-history-view', gameVersion: 'poe1' })).toEqual({
      ok: true,
      value: [
        {
          id: 'history:poe1:standard:id-1',
          searchRecordId: 'poe1:standard:id-1',
          gameVersion: 'poe1',
          name: 'Rings',
          url: 'https://www.pathofexile.com/trade/search/Standard/id-1',
          visitedAt: 10,
        },
      ],
    });
    expect(changes).toHaveLength(1);
    unsubscribe();
  });

  it('returns an explicit unavailable outcome when the runtime transport fails', async () => {
    const client = createSearchRecordClient({
      async execute() {
        throw new Error('Extension context invalidated');
      },
      async read() {
        throw new Error('Extension context invalidated');
      },
      subscribe: () => () => undefined,
    });

    expect(await client.read({ type: 'list-history', gameVersion: 'poe2' })).toEqual({
      ok: false,
      error: {
        code: 'unavailable',
        message: 'Extension context invalidated',
      },
    });
  });

  it('uses background FIFO commit order across tabs and enrichment does not reorder history', async () => {
    let commitTime = 0;
    const { module, transport } = createModuleTransport(() => ++commitTime);
    await module.initialize();
    const firstTab = createSearchRecordClient(transport);
    const secondTab = createSearchRecordClient(transport);

    await Promise.all([
      firstTab.execute({
        type: 'record-history',
        identity: {
          gameVersion: 'poe1',
          url: 'https://www.pathofexile.com/trade/search/Standard/first',
        },
        entry: {
          name: 'First',
          url: 'https://www.pathofexile.com/trade/search/Standard/first',
        },
      }),
      secondTab.execute({
        type: 'record-history',
        identity: {
          gameVersion: 'poe1',
          url: 'https://www.pathofexile.com/trade/search/Standard/second',
        },
        entry: {
          name: 'Second',
          url: 'https://www.pathofexile.com/trade/search/Standard/second',
        },
      }),
    ]);
    await firstTab.execute({
      type: 'upsert-search-record',
      identity: {
        gameVersion: 'poe1',
        url: 'https://www.pathofexile.com/trade/search/Standard/first',
      },
      patch: { name: 'First enriched', icon: 'https://web.poecdn.com/image/late.png' },
      usedAt: 99,
    });

    const history = await secondTab.read({ type: 'get-history-view', gameVersion: 'poe1' });
    expect(
      history.ok &&
        history.value.map((entry) => ({
          name: entry.name,
          visitedAt: entry.visitedAt,
          icon: entry.icon,
        })),
    ).toEqual([
      { name: 'Second', visitedAt: 2, icon: undefined },
      { name: 'First enriched', visitedAt: 1, icon: 'https://web.poecdn.com/image/late.png' },
    ]);
  });

  it('fans a committed domain change out to every Trade tab', async () => {
    const deliveries: Array<{ tabId: number; change: unknown }> = [];
    await broadcastSearchRecordChange(
      {
        command: { type: 'clear-history', gameVersion: 'poe1' },
      },
      {
        async listTradeTabIds() {
          return [11, 22];
        },
        async sendChangeToTab(tabId, change) {
          deliveries.push({ tabId, change });
        },
      },
    );

    expect(deliveries.map((delivery) => delivery.tabId)).toEqual([11, 22]);
    expect(deliveries[0].change).toEqual({
      command: { type: 'clear-history', gameVersion: 'poe1' },
    });
    expect(deliveries[1].change).toEqual(deliveries[0].change);
  });
});
describe('page-capture adapter seam', () => {
  it('converts a valid search-use observation into a committed History Entry', async () => {
    const { module, transport } = createModuleTransport(() => 42);
    await module.initialize();
    const capture = createSearchRecordCaptureAdapter(createSearchRecordClient(transport), () => 42);

    expect(
      await capture.captureSearchUse({
        gameVersion: 'poe2',
        url: 'https://www.pathofexile.com/trade2/search/poe2/Standard/id%2Fone',
        name: 'Quarterstaff',
        icon: 'https://web.poecdn.com/image/item.png',
      }),
    ).toEqual({ ok: true, changed: true });

    expect(await module.read({ type: 'get-history-view', gameVersion: 'poe2' })).toEqual({
      ok: true,
      value: [
        expect.objectContaining({
          name: 'Quarterstaff',
          icon: 'https://web.poecdn.com/image/item.png',
          visitedAt: 42,
        }),
      ],
    });
  });

  it('enriches without reordering history and rejects malformed observations before messaging', async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true, changed: true });
    const capture = createSearchRecordCaptureAdapter(
      {
        execute,
        read: vi.fn(),
        subscribe: vi.fn(),
      },
      () => 20,
    );

    expect(
      await capture.captureEnrichment({
        gameVersion: 'poe1',
        url: 'https://www.pathofexile.com/trade/search/Standard/id-1',
        icon: 'https://web.poecdn.com/image/late.png',
      }),
    ).toEqual({ ok: true, changed: true });
    expect(execute).toHaveBeenCalledWith({
      type: 'upsert-search-record',
      identity: {
        gameVersion: 'poe1',
        url: 'https://www.pathofexile.com/trade/search/Standard/id-1',
      },
      patch: {
        icon: 'https://web.poecdn.com/image/late.png',
        url: 'https://www.pathofexile.com/trade/search/Standard/id-1',
      },
      usedAt: 20,
    });

    execute.mockClear();
    expect(
      await capture.captureSearchUse({
        gameVersion: 'poe1',
        url: 'not a Trade search URL',
      }),
    ).toEqual({
      ok: false,
      error: {
        code: 'invalid-identity',
        message: 'Page observation requires a valid Trade search URL',
      },
    });
    expect(execute).not.toHaveBeenCalled();

    expect(
      await capture.captureSearchUse({
        gameVersion: 'poe1',
        url: 'https://evil.example/trade/search/Standard/id-1',
      }),
    ).toEqual({
      ok: false,
      error: {
        code: 'invalid-identity',
        message: 'Page observation requires a valid Trade search URL',
      },
    });
    expect(execute).not.toHaveBeenCalled();

    for (const url of [
      'https://www.pathofexile.com/account/search/Standard/id-1',
      'https://www.pathofexile.com/trade/search/poe2/Standard/id-1',
    ]) {
      expect(
        await capture.captureSearchUse({
          gameVersion: 'poe1',
          url,
        }),
      ).toEqual({
        ok: false,
        error: {
          code: 'invalid-identity',
          message: 'Page observation requires a valid Trade search URL',
        },
      });
    }
    expect(execute).not.toHaveBeenCalled();
  });
});
describe('History domain feed', () => {
  it('subscribes before its initial read and catches a commit during mount', async () => {
    let changeListener: ((change: any) => void) | undefined;
    let historyReads = 0;
    const snapshots: string[][] = [];
    const client = {
      execute: vi.fn(),
      subscribe(listener: (change: any) => void) {
        changeListener = listener;
        return () => undefined;
      },
      async read(request: any) {
        if (request.type === 'get-history-enabled') {
          return { ok: true as const, value: true };
        }
        historyReads += 1;
        if (historyReads === 1) {
          changeListener?.({ command: { type: 'clear-history', gameVersion: 'poe1' } });
          return {
            ok: true as const,
            value: [{ name: 'Old snapshot' }],
          };
        }
        return {
          ok: true as const,
          value: [{ name: 'Committed during mount' }],
        };
      },
    };
    const feed = createHistoryDomainFeed(
      client as any,
      'poe1',
      (snapshot) => snapshots.push(snapshot.history.map((entry) => entry.name)),
      (error) => {
        throw new Error(error.message);
      },
    );

    await feed.start();
    await feed.whenIdle();
    expect(snapshots.at(-1)).toEqual(['Committed during mount']);
    expect(historyReads).toBe(2);
  });
});
