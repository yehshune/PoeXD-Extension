// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { BookmarkCollectionView, BookmarkReadOutcome } from '@/utils/bookmark-coordinator';
import {
  createLiveSearchSourceController,
  type LiveSearchBookmarkSourcePort,
} from '@/entrypoints/content/logic/live-search-sources';
import { createLiveSearchPrimaryController } from '@/entrypoints/content/logic/live-search-primary-controller';
import { LiveSearchPrimaryRuntime } from '@/entrypoints/content/logic/live-search-primary-runtime';
import { LiveSearchOpenScheduler } from '@/entrypoints/content/logic/live-search-open-scheduler';
import type { ILiveSearchHostClient } from '@/entrypoints/content/logic/live-search-host-client';
import { createLiveSearchResumeStore } from '@/utils/live-search-resume-store';

const hostClient: ILiveSearchHostClient = {
  ensureContainer: async () => ({ success: true }),
  renderResult: async () => ({ success: true }),
  resetUnread: async () => ({ success: true }),
  dispose: () => {},
};

class CountingBookmarkSource implements LiveSearchBookmarkSourcePort {
  public readCount = 0;
  private listeners = new Set<() => void>();

  public async readCollection(): Promise<BookmarkReadOutcome<BookmarkCollectionView>> {
    this.readCount += 1;
    return { ok: true, value: { groups: [], bookmarks: [] } as BookmarkCollectionView };
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public triggerChange(): void {
    this.listeners.forEach((listener) => listener());
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('live search source reload drain', () => {
  it('honours a bookmark change that arrives while startup league resolution is pending', async () => {
    let releaseResumeRead!: () => void;
    const resumeReadGate = new Promise<void>((resolve) => {
      releaseResumeRead = resolve;
    });
    const resumeStore = createLiveSearchResumeStore('poe1', {
      async get() {
        await resumeReadGate;
        return {};
      },
      async set() {},
      async remove() {},
    });

    const runtime = new LiveSearchPrimaryRuntime('poe1', {
      hostClient,
      openScheduler: new LiveSearchOpenScheduler({ cooldownMs: 0 }),
      webSocketFactory: () => ({ close() {} }) as unknown as WebSocket,
    });
    const source = new CountingBookmarkSource();
    const sourceController = createLiveSearchSourceController(
      source,
      createLiveSearchPrimaryController(runtime),
      { resumeStore },
    );

    // The first reload has read the collection and is now awaiting resolveInitialLeague().
    await tick();
    expect(source.readCount).toBe(1);

    // A bookmark change during that await must not be stranded as hasPendingReload.
    source.triggerChange();
    releaseResumeRead();
    await tick();
    await tick();

    expect(source.readCount).toBe(2);

    const res = await sourceController.enqueueIncomingConnections!([
      { url: 'https://www.pathofexile.com/trade/search/Standard/H4sIreload_drain_1' },
    ]);
    expect(res.success).toBe(true);

    sourceController.dispose();
  });
});
