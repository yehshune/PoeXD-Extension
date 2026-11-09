// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { useBookmarkCovers } from '@/components/sidebar/composables/useBookmarkCovers';
import type { Bookmark } from '@/components/sidebar/bookmark-types';
import { dispatchPoeEvent } from '@/utils/event-contracts';
import {
  isBookmarkCollectionState,
  createBookmarkCollectionModule,
} from '@/utils/bookmark-collection';
import { createBookmarkModel } from '@/components/sidebar/bookmark-model';

describe('useBookmarkCovers', () => {
  const dummyBookmark: Bookmark = {
    id: 'bm-1',
    name: 'Chaos Orb',
    url: 'https://www.pathofexile.com/trade/search/Standard/chaos',
    groupId: 'group-1',
    searchRecordId: 'chaos',
    order: 0,
  };

  beforeEach(() => {
    (window as any).poexdAlert = vi.fn(async () => {});
  });

  it('correctly compares same search pages', () => {
    const executeBookmarkIntent = vi.fn(async () => true);
    const covers = useBookmarkCovers({
      executeBookmarkIntent,
      activeBookmarkMenuId: ref('bm-1'),
      isMoveSubMenu: ref(false),
      isCoverSubMenu: ref(false),
      closeAllMenus: vi.fn(),
    });

    expect(
      covers.sameSearchPage(
        'https://www.pathofexile.com/trade/search/Standard/abc',
        'https://www.pathofexile.com/trade/search/Standard/abc',
      ),
    ).toBe(true);

    // Live suffix stripping
    expect(
      covers.sameSearchPage(
        'https://www.pathofexile.com/trade/search/Standard/abc/live',
        'https://www.pathofexile.com/trade/search/Standard/abc',
      ),
    ).toBe(true);

    // Different search ID
    expect(
      covers.sameSearchPage(
        'https://www.pathofexile.com/trade/search/Standard/abc',
        'https://www.pathofexile.com/trade/search/Standard/def',
      ),
    ).toBe(false);

    // Empty URL
    expect(covers.sameSearchPage('', 'https://www.pathofexile.com/trade/search/Standard/abc')).toBe(
      false,
    );
  });

  it('validates cover image URLs against allowed host and protocol', () => {
    const covers = useBookmarkCovers({
      executeBookmarkIntent: vi.fn(async () => true),
      activeBookmarkMenuId: ref('bm-1'),
      isMoveSubMenu: ref(false),
      isCoverSubMenu: ref(false),
      closeAllMenus: vi.fn(),
    });

    // Allowed PoE CDN hosts
    expect(covers.isValidCoverUrl('https://web.poecdn.com/image.png')).toBe(true);
    expect(covers.isValidCoverUrl('https://webtw.poecdn.com/image.png')).toBe(true);
    expect(
      covers.isValidCoverUrl(
        'https://poecdn.game.qq.com/gen/image/WzI1LDE0LHsiZiI6IjJESXRlbXMvUmluZ3MvQmVyZWtzUGFzcyIsInciOjEsImgiOjEsInNjYWxlIjoxfV0/efb7743eeb/BereksPass.png',
      ),
    ).toBe(true);
    expect(covers.isValidCoverUrl('https://game.qq.com/image.png')).toBe(false);
    expect(covers.isValidCoverUrl('https://evil.poecdn.game.qq.com/image.png')).toBe(false);
    expect(covers.isValidCoverUrl('http://poecdn.game.qq.com/image.png')).toBe(false);

    // Arbitrary external HTTPS URLs rejected
    expect(covers.isValidCoverUrl('https://evil.com/image.png')).toBe(false);
    expect(covers.isValidCoverUrl('https://google.com/image.png')).toBe(false);
    expect(covers.isValidCoverUrl('https://sub.web.poecdn.com/image.png')).toBe(false);

    // Dangerous protocols rejected
    expect(covers.isValidCoverUrl('javascript:alert(1)')).toBe(false);
    expect(covers.isValidCoverUrl('data:image/png;base64,AAAA')).toBe(false);
    expect(covers.isValidCoverUrl('http://web.poecdn.com/image.png')).toBe(false);

    // Malformed and length limit
    expect(covers.isValidCoverUrl('not-a-url')).toBe(false);
    expect(covers.isValidCoverUrl('')).toBe(false);
    expect(covers.isValidCoverUrl(null as any)).toBe(false);
    expect(covers.isValidCoverUrl(`https://web.poecdn.com/${'a'.repeat(4090)}`)).toBe(false);
  });

  it('matches result images based on URL', () => {
    const covers = useBookmarkCovers({
      executeBookmarkIntent: vi.fn(async () => true),
      activeBookmarkMenuId: ref('bm-1'),
      isMoveSubMenu: ref(false),
      isCoverSubMenu: ref(false),
      closeAllMenus: vi.fn(),
    });

    covers.resultImagesUrl.value = 'https://www.pathofexile.com/trade/search/Standard/chaos';
    covers.resultImages.value = [
      'https://web.poecdn.com/chaos.png',
      'https://web.poecdn.com/exalt.png',
    ];

    const matched = covers.getResultImagesForBookmark(dummyBookmark);
    expect(matched).toEqual([
      'https://web.poecdn.com/chaos.png',
      'https://web.poecdn.com/exalt.png',
    ]);
  });

  it('does not fall back to stale result images from a previous search', () => {
    window.history.replaceState({}, '', '/trade/search/Standard/empty-search');
    const covers = useBookmarkCovers({
      executeBookmarkIntent: vi.fn(async () => true),
      activeBookmarkMenuId: ref('bm-1'),
      isMoveSubMenu: ref(false),
      isCoverSubMenu: ref(false),
      closeAllMenus: vi.fn(),
    });

    covers.resultImagesUrl.value = 'https://www.pathofexile.com/trade/search/Standard/old-search';
    covers.resultImages.value = ['https://web.poecdn.com/old.png'];

    expect(
      covers.getResultImagesForUrl(`${window.location.origin}/trade/search/Standard/empty-search`),
    ).toEqual([]);
  });

  it('explicit cover open succeeds and opens submenu when images exist', async () => {
    const activeBookmarkMenuId = ref<string | null>('bm-1');
    const isMoveSubMenu = ref(true);
    const isCoverSubMenu = ref(false);

    const covers = useBookmarkCovers({
      executeBookmarkIntent: vi.fn(async () => true),
      activeBookmarkMenuId,
      isMoveSubMenu,
      isCoverSubMenu,
      closeAllMenus: vi.fn(),
    });

    covers.resultImagesUrl.value = dummyBookmark.url;
    covers.resultImages.value = ['https://web.poecdn.com/chaos.png'];

    await covers.requestOpenCoverSubMenu(dummyBookmark);

    expect(isMoveSubMenu.value).toBe(false);
    expect(isCoverSubMenu.value).toBe(true);
    expect(activeBookmarkMenuId.value).toBe('bm-1');
    expect((window as any).poexdAlert).not.toHaveBeenCalled();
  });

  it('explicit cover open does not alert and opens cover submenu while keeping active menu when no images exist', async () => {
    const activeBookmarkMenuId = ref<string | null>('bm-1');
    const isMoveSubMenu = ref(false);
    const isCoverSubMenu = ref(false);

    const covers = useBookmarkCovers({
      executeBookmarkIntent: vi.fn(async () => true),
      activeBookmarkMenuId,
      isMoveSubMenu,
      isCoverSubMenu,
      closeAllMenus: vi.fn(),
    });

    // No result images
    covers.resultImagesUrl.value = '';
    covers.resultImages.value = [];

    await covers.requestOpenCoverSubMenu(dummyBookmark);

    expect(isCoverSubMenu.value).toBe(true);
    expect(isMoveSubMenu.value).toBe(false);
    expect(activeBookmarkMenuId.value).toBe('bm-1');
    expect((window as any).poexdAlert).not.toHaveBeenCalled();
  });

  it('hover does not automatically trigger cover availability check or alert in this composable', () => {
    const activeBookmarkMenuId = ref<string | null>('bm-1');
    const isCoverSubMenu = ref(false);

    useBookmarkCovers({
      executeBookmarkIntent: vi.fn(async () => true),
      activeBookmarkMenuId,
      isMoveSubMenu: ref(false),
      isCoverSubMenu,
      closeAllMenus: vi.fn(),
    });

    // Merely creating composable does not trigger alert or open submenu
    expect(isCoverSubMenu.value).toBe(false);
    expect((window as any).poexdAlert).not.toHaveBeenCalled();
  });

  it('triggers select cover mutation and closes all menus on success', async () => {
    const executeBookmarkIntent = vi.fn(async () => true);
    const closeAllMenus = vi.fn();

    const covers = useBookmarkCovers({
      executeBookmarkIntent,
      activeBookmarkMenuId: ref('bm-1'),
      isMoveSubMenu: ref(false),
      isCoverSubMenu: ref(true),
      closeAllMenus,
    });

    await covers.selectBookmarkCover(dummyBookmark, 'https://web.poecdn.com/chaos.png');

    expect(executeBookmarkIntent).toHaveBeenCalledWith({
      type: 'set-bookmark-cover',
      bookmarkId: 'bm-1',
      coverImageUrl: 'https://web.poecdn.com/chaos.png',
    });
    expect(closeAllMenus).toHaveBeenCalled();
  });

  it('triggers remove cover mutation and closes all menus on success', async () => {
    const executeBookmarkIntent = vi.fn(async () => true);
    const closeAllMenus = vi.fn();

    const covers = useBookmarkCovers({
      executeBookmarkIntent,
      activeBookmarkMenuId: ref('bm-1'),
      isMoveSubMenu: ref(false),
      isCoverSubMenu: ref(true),
      closeAllMenus,
    });

    await covers.removeBookmarkCover(dummyBookmark);

    expect(executeBookmarkIntent).toHaveBeenCalledWith({
      type: 'set-bookmark-cover',
      bookmarkId: 'bm-1',
    });
    expect(closeAllMenus).toHaveBeenCalled();
  });

  it('prevents concurrent duplicate requestOpenCoverSubMenu execution via guard', async () => {
    let resolveFirst: () => void;
    const firstPromise = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });

    const covers = useBookmarkCovers({
      executeBookmarkIntent: vi.fn(async () => true),
      activeBookmarkMenuId: ref('bm-1'),
      isMoveSubMenu: ref(false),
      isCoverSubMenu: ref(false),
      closeAllMenus: vi.fn(),
    });

    // Simulate in-flight check
    covers.isCoverSubmenuChecking.value = true;

    // Second call should bail out early
    await covers.requestOpenCoverSubMenu(dummyBookmark);
    expect((window as any).poexdAlert).not.toHaveBeenCalled();

    covers.isCoverSubmenuChecking.value = false;
  });

  describe('Bookmark Cover URL Trust Boundary & Canonical Contract', () => {
    it('filters forged result-images to retain only valid PoE CDN URLs and drops arbitrary/dangerous URLs', () => {
      let coversInstance: ReturnType<typeof useBookmarkCovers> | undefined;
      const TestComponent = defineComponent({
        setup() {
          coversInstance = useBookmarkCovers({
            executeBookmarkIntent: vi.fn(async () => true),
            activeBookmarkMenuId: ref('bm-1'),
            isMoveSubMenu: ref(false),
            isCoverSubMenu: ref(false),
            closeAllMenus: vi.fn(),
          });
          return () => h('div');
        },
      });

      // 掛載組件以觸發 onMounted 中的 listener
      const { createApp } = require('vue');
      const root = document.createElement('div');
      const app = createApp(TestComponent);
      app.mount(root);

      try {
        // 模擬 Host Page 偽造 poexd-result-images 事件
        dispatchPoeEvent('poexd-result-images', {
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

        // 斷言：只接受合法 PoE CDN URL
        expect(coversInstance!.resultImages.value).toEqual([
          'https://web.poecdn.com/image-1.png',
          'https://webtw.poecdn.com/image-2.png',
        ]);
      } finally {
        app.unmount();
      }
    });

    it('selectBookmarkCover rejects arbitrary or dangerous URL and does not dispatch mutation intent', async () => {
      const executeBookmarkIntent = vi.fn(async () => true);
      const closeAllMenus = vi.fn();

      const covers = useBookmarkCovers({
        executeBookmarkIntent,
        activeBookmarkMenuId: ref('bm-1'),
        isMoveSubMenu: ref(false),
        isCoverSubMenu: ref(false),
        closeAllMenus,
      });

      // 嘗試選取惡意 URL
      await covers.selectBookmarkCover(dummyBookmark, 'https://evil.com/hacked.png');
      expect(executeBookmarkIntent).not.toHaveBeenCalled();
      expect(closeAllMenus).not.toHaveBeenCalled();

      await covers.selectBookmarkCover(dummyBookmark, 'javascript:alert(1)');
      expect(executeBookmarkIntent).not.toHaveBeenCalled();

      // 選取合法 URL 正常派發
      await covers.selectBookmarkCover(dummyBookmark, 'https://web.poecdn.com/legit.png');
      expect(executeBookmarkIntent).toHaveBeenCalledWith({
        type: 'set-bookmark-cover',
        bookmarkId: 'bm-1',
        coverImageUrl: 'https://web.poecdn.com/legit.png',
      });
      expect(closeAllMenus).toHaveBeenCalled();
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
