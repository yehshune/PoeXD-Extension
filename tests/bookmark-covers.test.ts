import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBookmarkWorkspace } from '@/components/sidebar/bookmark-workspace';
import {
  createFakeBookmarkWorkspaceHost,
  type FakeBookmarkWorkspaceHost,
} from '@/components/sidebar/bookmark-workspace/fake-host';
import type { Bookmark } from '@/components/sidebar/bookmark-types';
import { createBookmarkCollectionModule } from '@/utils/bookmark-collection';
import { isBookmarkCollectionState } from '@/utils/bookmark-collection-schema';
import { createBookmarkModel } from '@/components/sidebar/bookmark-model';
import { createFakeBookmarkModel } from './helpers/fake-bookmark-model';

describe('Bookmark Workspace — covers', () => {
  const dummyBookmark: Bookmark = {
    id: 'bm-1',
    name: 'Chaos Orb',
    url: 'https://www.pathofexile.com/trade/search/Standard/chaos',
    groupId: 'group-1',
    searchRecordId: 'chaos',
    order: 0,
  };

  let activeWorkspaces: Array<{ dispose: () => void }> = [];

  const setup = async (hostOverrides: Partial<FakeBookmarkWorkspaceHost['state']> = {}) => {
    const host = createFakeBookmarkWorkspaceHost(hostOverrides);
    const model = createFakeBookmarkModel({
      groups: [{ id: 'group-1', name: '預設', order: 0 }],
      bookmarks: [dummyBookmark],
    });
    const workspace = createBookmarkWorkspace(host, { version: 'poe1', model });
    activeWorkspaces.push(workspace);
    await workspace.start();
    return { host, model, workspace };
  };

  afterEach(() => {
    activeWorkspaces.forEach((ws) => ws.dispose());
    activeWorkspaces = [];
  });

  it('matches captured result images by search page URL (including /live suffix)', async () => {
    const { host, workspace } = await setup({
      location: { url: 'https://www.pathofexile.com/trade/search/Standard/other', title: 'Trade' },
    });

    host.emitCoverCapture({
      url: 'https://www.pathofexile.com/trade/search/Standard/chaos/live',
      images: ['https://web.poecdn.com/chaos.png', 'https://web.poecdn.com/exalt.png'],
    });

    expect(workspace.actions.getResultImagesForBookmark(dummyBookmark)).toEqual([
      'https://web.poecdn.com/chaos.png',
      'https://web.poecdn.com/exalt.png',
    ]);

    // Different search ID should not match captured images from an unrelated search
    const otherBookmark: Bookmark = {
      ...dummyBookmark,
      id: 'bm-2',
      url: 'https://www.pathofexile.com/trade/search/Standard/def',
    };
    expect(workspace.actions.getResultImagesForBookmark(otherBookmark)).toEqual([]);
  });

  it('validates cover image URLs against allowed PoE CDN hosts and protocol', async () => {
    const { host, workspace } = await setup();

    const validUrls = [
      'https://web.poecdn.com/image.png',
      'https://webtw.poecdn.com/image.png',
      'https://poecdn.game.qq.com/gen/image/WzI1LDE0LHsiZiI6IjJESXRlbXMvUmluZ3MvQmVyZWtzUGFzcyIsInciOjEsImgiOjEsInNjYWxlIjoxfV0/efb7743eeb/BereksPass.png',
    ];
    const invalidUrls: unknown[] = [
      'https://game.qq.com/image.png',
      'https://evil.poecdn.game.qq.com/image.png',
      'http://poecdn.game.qq.com/image.png',
      'https://evil.com/image.png',
      'https://google.com/image.png',
      'https://sub.web.poecdn.com/image.png',
      'javascript:alert(1)',
      'data:image/png;base64,AAAA',
      'http://web.poecdn.com/image.png',
      'not-a-url',
      '',
      null,
      `https://web.poecdn.com/${'a'.repeat(4090)}`,
    ];

    host.emitCoverCapture({
      url: dummyBookmark.url,
      images: [...validUrls, ...invalidUrls],
    });

    expect(workspace.actions.getResultImagesForBookmark(dummyBookmark)).toEqual(validUrls);
  });

  it('does not fall back to stale result images from a previous search', async () => {
    const currentUrl = 'https://www.pathofexile.com/trade/search/Standard/empty-search';
    const { host, workspace } = await setup({
      location: { url: currentUrl, title: 'Trade' },
    });

    host.emitCoverCapture({
      url: 'https://www.pathofexile.com/trade/search/Standard/old-search',
      images: ['https://web.poecdn.com/old.png'],
    });

    expect(
      workspace.actions.getResultImagesForBookmark({ ...dummyBookmark, url: currentUrl }),
    ).toEqual([]);
  });

  it('falls back to current page DOM cover images via host when no capture exists', async () => {
    const currentUrl = 'https://www.pathofexile.com/trade/search/Standard/chaos';
    const { workspace } = await setup({
      location: { url: currentUrl, title: 'Trade' },
      resultCoverImages: ['https://web.poecdn.com/dom-cover.png', 'https://evil.com/ignored.png'],
    });

    expect(workspace.actions.getResultImagesForBookmark(dummyBookmark)).toEqual([
      'https://web.poecdn.com/dom-cover.png',
    ]);
  });

  it('explicit cover open succeeds and opens submenu when images exist', async () => {
    const { host, workspace } = await setup();

    workspace.menus.setBookmarkMenuOpen('bm-1', true);
    workspace.menus.setMoveSubMenuOpen(true);

    host.emitCoverCapture({
      url: dummyBookmark.url,
      images: ['https://web.poecdn.com/chaos.png'],
    });

    await workspace.menus.requestOpenCoverSubMenu(dummyBookmark);

    expect(workspace.menus.isMoveSubMenu.value).toBe(false);
    expect(workspace.menus.isCoverSubMenu.value).toBe(true);
    expect(workspace.menus.activeBookmarkMenuId.value).toBe('bm-1');
    expect(host.state.alerts).toHaveLength(0);
  });

  it('explicit cover open does not alert and opens cover submenu while keeping active menu when no images exist', async () => {
    const { host, workspace } = await setup();

    workspace.menus.setBookmarkMenuOpen('bm-1', true);

    await workspace.menus.requestOpenCoverSubMenu(dummyBookmark);

    expect(workspace.menus.isCoverSubMenu.value).toBe(true);
    expect(workspace.menus.isMoveSubMenu.value).toBe(false);
    expect(workspace.menus.activeBookmarkMenuId.value).toBe('bm-1');
    expect(host.state.alerts).toHaveLength(0);
  });

  it('hover does not automatically trigger cover availability check or alert', async () => {
    const { host, workspace } = await setup();

    workspace.menus.setBookmarkMenuOpen('bm-1', true);
    workspace.menus.setCoverSubMenuOpen(true);

    expect(workspace.menus.isCoverSubMenu.value).toBe(false);
    expect(host.state.alerts).toHaveLength(0);
  });

  it('triggers select cover mutation and closes all menus on success', async () => {
    const { model, workspace } = await setup();

    workspace.menus.setBookmarkMenuOpen('bm-1', true);
    await workspace.menus.requestOpenCoverSubMenu(dummyBookmark);

    await workspace.actions.selectBookmarkCover(dummyBookmark, 'https://web.poecdn.com/chaos.png');

    expect(model.intents).toEqual([
      {
        type: 'set-bookmark-cover',
        bookmarkId: 'bm-1',
        coverImageUrl: 'https://web.poecdn.com/chaos.png',
      },
    ]);
    expect(workspace.menus.activeBookmarkMenuId.value).toBeNull();
    expect(workspace.menus.isCoverSubMenu.value).toBe(false);
  });

  it('triggers remove cover mutation and closes all menus on success', async () => {
    const { model, workspace } = await setup();

    workspace.menus.setBookmarkMenuOpen('bm-1', true);
    await workspace.menus.requestOpenCoverSubMenu(dummyBookmark);

    await workspace.actions.removeBookmarkCover(dummyBookmark);

    expect(model.intents).toEqual([
      {
        type: 'set-bookmark-cover',
        bookmarkId: 'bm-1',
      },
    ]);
    expect(workspace.menus.activeBookmarkMenuId.value).toBeNull();
    expect(workspace.menus.isCoverSubMenu.value).toBe(false);
  });

  it('prevents concurrent duplicate requestOpenCoverSubMenu execution via guard', async () => {
    const { host, workspace } = await setup();
    const initialRequests = host.state.coverCaptureRequests;

    await Promise.all([
      workspace.menus.requestOpenCoverSubMenu(dummyBookmark),
      workspace.menus.requestOpenCoverSubMenu(dummyBookmark),
    ]);

    expect(host.state.coverCaptureRequests).toBe(initialRequests + 1);
    expect(host.state.alerts).toHaveLength(0);
  });

  describe('Bookmark Cover URL Trust Boundary & Canonical Contract', () => {
    it('filters forged result-images to retain only valid PoE CDN URLs and drops arbitrary/dangerous URLs', async () => {
      const { host, workspace } = await setup();

      host.emitCoverCapture({
        url: 'https://www.pathofexile.com/trade/search/Standard/chaos',
        images: [
          'https://web.poecdn.com/image-1.png',
          'https://webtw.poecdn.com/image-2.png',
          'https://evil.com/malicious.png',
          'https://google.com/test.png',
          'javascript:alert(1)',
          'data:image/png;base64,bad',
        ],
      });

      expect(workspace.actions.getResultImagesForBookmark(dummyBookmark)).toEqual([
        'https://web.poecdn.com/image-1.png',
        'https://webtw.poecdn.com/image-2.png',
      ]);
    });

    it('selectBookmarkCover rejects arbitrary or dangerous URL and does not dispatch mutation intent', async () => {
      const { model, workspace } = await setup();
      workspace.menus.setBookmarkMenuOpen('bm-1', true);

      // 嘗試選取惡意 URL
      await workspace.actions.selectBookmarkCover(dummyBookmark, 'https://evil.com/hacked.png');
      expect(model.intents).toHaveLength(0);
      expect(workspace.menus.activeBookmarkMenuId.value).toBe('bm-1');

      await workspace.actions.selectBookmarkCover(dummyBookmark, 'javascript:alert(1)');
      expect(model.intents).toHaveLength(0);

      // 選取合法 URL 正常派發
      await workspace.actions.selectBookmarkCover(
        dummyBookmark,
        'https://web.poecdn.com/legit.png',
      );
      expect(model.intents).toEqual([
        {
          type: 'set-bookmark-cover',
          bookmarkId: 'bm-1',
          coverImageUrl: 'https://web.poecdn.com/legit.png',
        },
      ]);
      expect(workspace.menus.activeBookmarkMenuId.value).toBeNull();
    });

    it('prevents illegal set-bookmark-cover from writing to canonical state via model and collection', async () => {
      const putBookmarkSpy = vi.fn(async () => ({ ok: true as const, changed: true }));
      const client = {
        readCollection: vi.fn(async () => ({
          ok: true as const,
          value: {
            bookmarks: [dummyBookmark],
            groups: [{ id: 'group-1', name: '預設', order: 0 }],
          },
        })),
        putBookmark: putBookmarkSpy,
        subscribe: vi.fn(() => () => {}),
      } as any;
      const model = createBookmarkModel(client);
      await model.connect();

      // Model execute 拒絕非合法 cover URL
      const outcome = await model.execute({
        type: 'set-bookmark-cover',
        bookmarkId: 'bm-1',
        coverImageUrl: 'https://attacker.site/exploit.png',
      });
      expect(outcome.ok).toBe(false);
      expect(putBookmarkSpy).not.toHaveBeenCalled();

      // Collection state 直接拒絕包含非合法 coverImageUrl 的 put-bookmark 命令
      const collectionModule = createBookmarkCollectionModule({
        schemaVersion: 2,
        groups: [{ id: 'group-1', gameVersion: 'poe1', name: '預設', order: 0 }],
        bookmarks: [],
      });

      expect(() => {
        collectionModule.prepare({
          type: 'put-bookmark',
          bookmark: {
            id: 'bm-bad',
            gameVersion: 'poe1',
            groupId: 'group-1',
            name: '合法名稱',
            order: 0,
            coverImageUrl: 'javascript:alert("pwned")',
          },
        });
      }).toThrow(/Invalid bookmark cover URL/);
    });

    it('isBookmarkCollectionState rejects persisted collection containing illegal coverImageUrl', () => {
      const validState = {
        schemaVersion: 2,
        groups: [{ id: 'group-1', gameVersion: 'poe1', name: '預設', order: 0 }],
        bookmarks: [
          {
            id: 'bm-1',
            gameVersion: 'poe1',
            groupId: 'group-1',
            name: 'Chaos',
            order: 0,
            coverImageUrl: 'https://web.poecdn.com/chaos.png',
          },
        ],
      };
      expect(isBookmarkCollectionState(validState)).toBe(true);

      // 包含 external HTTPS URL
      const externalState = {
        ...validState,
        bookmarks: [
          {
            ...validState.bookmarks[0],
            coverImageUrl: 'https://evil.com/fake.png',
          },
        ],
      };
      expect(isBookmarkCollectionState(externalState)).toBe(false);

      // 包含 javascript: 協議
      const jsState = {
        ...validState,
        bookmarks: [
          {
            ...validState.bookmarks[0],
            coverImageUrl: 'javascript:alert(1)',
          },
        ],
      };
      expect(isBookmarkCollectionState(jsState)).toBe(false);

      // 包含長度超標 URL
      const longUrlState = {
        ...validState,
        bookmarks: [
          {
            ...validState.bookmarks[0],
            coverImageUrl: `https://web.poecdn.com/${'x'.repeat(4090)}`,
          },
        ],
      };
      expect(isBookmarkCollectionState(longUrlState)).toBe(false);
    });

    it('rejects import-collection with illegal coverImageUrl', () => {
      const collectionModule = createBookmarkCollectionModule({
        schemaVersion: 2,
        groups: [{ id: 'group-1', gameVersion: 'poe1', name: '預設', order: 0 }],
        bookmarks: [],
      });

      expect(() => {
        collectionModule.prepare({
          type: 'import-collection',
          gameVersion: 'poe1',
          mode: 'merge',
          groups: [{ id: 'group-1', name: '合法群組', order: 0 }],
          bookmarks: [
            {
              id: 'bm-bad-import',
              groupId: 'group-1',
              name: '合法書籤',
              order: 0,
              coverImageUrl: 'https://attacker.site/exploit.png',
            },
          ],
        });
      }).toThrow(/Invalid bookmark cover URL/);
    });
  });
});
