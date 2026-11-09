import { describe, expect, it } from 'vitest';
import { decodeBookmarkTransfer, encodeBookmarkTransfer } from '@/utils/bookmark-transfer';
import {
  decodeTftBase64,
  encodeTftBase64,
  fromTftBookmarkExport,
  toTftBookmarkExport,
} from '@/utils/bookmark-transfer-tft';

const tftFixture = {
  folders: [
    {
      id: 'root',
      name: '裝備',
      parentId: null,
      depth: 0,
      childIds: ['child'],
      index: 0,
      isOpen: true,
      icon: 'TFT',
      bookmarks: [
        {
          id: 'b2',
          name: '第二個',
          league: 'Auto',
          poeVersion: 'Poe1',
          endpoint: 'second',
          type: 'search',
          idx: 1,
          isDone: false,
        },
        {
          id: 'b1',
          name: '固定聯盟',
          league: 'Hardcore Mercenaries',
          poeVersion: 'Poe1',
          endpoint: 'first',
          type: 'search',
          idx: 0,
          isDone: false,
        },
        {
          id: 'b3',
          name: 'PoE2 書籤',
          league: 'Auto',
          poeVersion: 'Poe2',
          endpoint: 'poe2only',
          type: 'search',
          idx: 2,
          isDone: false,
        },
      ],
    },
    {
      id: 'child',
      name: '通貨',
      parentId: 'root',
      depth: 1,
      childIds: [],
      index: 1,
      isOpen: true,
      icon: 'TFT',
      bookmarks: [
        {
          id: 'b4',
          name: '兌換',
          league: 'Auto',
          poeVersion: 'Poe1',
          endpoint: 'ex1',
          type: 'exchange',
          idx: 0,
          isDone: true,
        },
      ],
    },
    {
      id: 'poe2-folder',
      name: '只有 PoE2',
      parentId: null,
      depth: 0,
      childIds: [],
      index: 2,
      isOpen: true,
      icon: 'TFT',
      bookmarks: [
        {
          id: 'b5',
          name: 'x',
          league: 'Auto',
          poeVersion: 'Poe2',
          endpoint: 'y',
          type: 'search',
          idx: 0,
          isDone: false,
        },
      ],
    },
  ],
};

describe('TFT Trade Extension bookmark format', () => {
  it('encodes UTF-8 JSON as standard Base64 and decodes standard or URL-safe input', () => {
    const json = JSON.stringify({ name: '中文 ✓' });
    const encoded = encodeTftBase64(json);
    expect(encoded).toBe(btoa(String.fromCharCode(...new TextEncoder().encode(json))));
    expect(decodeTftBase64(encoded)).toBe(json);
    const urlSafe = encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(decodeTftBase64(urlSafe)).toBe(json);
    expect(() => decodeTftBase64('not base64!')).toThrow('malformed');
  });

  it('imports TFT folders into a nested PoeXD payload for the requested game version only', () => {
    const payload = fromTftBookmarkExport(tftFixture, {
      gameVersion: 'poe1',
      fallbackLeague: 'Mercenaries',
    });

    expect(payload.scope).toBe('folder');
    expect(payload.folders).toHaveLength(1);
    const [root] = payload.folders;
    expect(root.name).toBe('裝備');
    expect(root.bookmarks).toEqual([
      {
        name: '固定聯盟',
        url: 'https://www.pathofexile.com/trade/search/Hardcore%20Mercenaries/first',
        leaguePinned: true,
      },
      {
        name: '第二個',
        url: 'https://www.pathofexile.com/trade/search/Mercenaries/second',
      },
    ]);
    expect(root.folders?.[0]).toEqual({
      name: '通貨',
      bookmarks: [
        { name: '兌換', url: 'https://www.pathofexile.com/trade/exchange/Mercenaries/ex1' },
      ],
    });
  });

  it('imports PoE2 bookmarks with the trade2 route', () => {
    const payload = fromTftBookmarkExport(tftFixture, { gameVersion: 'poe2' });
    expect(payload.scope).toBe('collection');
    expect(payload.folders.map((folder) => folder.name)).toEqual(['裝備', '只有 PoE2']);
    expect(payload.folders[0].bookmarks[0].url).toBe(
      'https://www.pathofexile.com/trade2/search/poe2/Standard/poe2only',
    );
  });

  it('rejects a share code that has no bookmarks for the requested game version', () => {
    const poe2Only = { folders: [tftFixture.folders[2]] };
    expect(() => fromTftBookmarkExport(poe2Only, { gameVersion: 'poe1' })).toThrow(
      'bookmarkTransfer.error.noBookmarksForVersion',
    );
  });

  it('exports PoeXD bookmarks as TFT folders with Auto or pinned leagues', () => {
    let counter = 0;
    const exported = toTftBookmarkExport(
      {
        kind: 'poexd-bookmarks',
        schemaVersion: 2,
        gameVersion: 'poe1',
        scope: 'collection',
        folders: [
          {
            name: '根',
            bookmarks: [
              {
                name: '自動',
                url: 'https://poe.game.qq.com/trade/search/S29赛季/auto1',
                coverImageUrl: 'https://web.poecdn.com/gen/image/item.png',
              },
              {
                name: '固定',
                url: 'https://www.pathofexile.com/trade/search/Hardcore%20Settlers/pin1',
                leaguePinned: true,
              },
            ],
            folders: [{ name: '子', bookmarks: [] }],
          },
        ],
      },
      () => `id${counter++}`,
    );

    expect(exported.folders).toEqual([
      {
        id: 'id0',
        name: '根',
        parentId: null,
        depth: 0,
        childIds: ['id3'],
        index: 0,
        isOpen: true,
        icon: 'TFT',
        bookmarks: [
          {
            id: 'id1',
            name: '自動',
            league: 'Auto',
            poeVersion: 'Poe1',
            endpoint: 'auto1',
            type: 'search',
            idx: 0,
            isDone: false,
            coverImageUrl: 'https://web.poecdn.com/gen/image/item.png',
          },
          {
            id: 'id2',
            name: '固定',
            league: 'Hardcore Settlers',
            poeVersion: 'Poe1',
            endpoint: 'pin1',
            type: 'search',
            idx: 1,
            isDone: false,
          },
        ],
      },
      {
        id: 'id3',
        name: '子',
        parentId: 'id0',
        depth: 1,
        childIds: [],
        index: 1,
        isOpen: true,
        icon: 'TFT',
        bookmarks: [],
      },
    ]);
    expect(exported.poexd).toEqual({ scope: 'collection', gameVersion: 'poe1' });
  });

  it('decodes a raw TFT share code through the public transfer decoder', async () => {
    const code = encodeTftBase64(JSON.stringify(tftFixture));
    const payload = await decodeBookmarkTransfer(code, {
      gameVersion: 'poe1',
      fallbackLeague: 'Standard',
    });
    expect(payload.gameVersion).toBe('poe1');
    expect(payload.folders[0].bookmarks).toHaveLength(2);
  });

  it('keeps empty collections and pinned leagues across a PoeXD round trip', async () => {
    const empty = {
      kind: 'poexd-bookmarks' as const,
      schemaVersion: 2 as const,
      gameVersion: 'poe2' as const,
      scope: 'collection' as const,
      folders: [],
    };
    await expect(decodeBookmarkTransfer(await encodeBookmarkTransfer(empty))).resolves.toEqual(
      empty,
    );

    const pinned = {
      ...empty,
      gameVersion: 'poe1' as const,
      folders: [
        {
          name: 'A',
          bookmarks: [
            {
              name: 'p',
              url: 'https://www.pathofexile.com/trade/search/Hardcore/p1',
              leaguePinned: true as const,
            },
          ],
        },
      ],
    };
    await expect(decodeBookmarkTransfer(await encodeBookmarkTransfer(pinned))).resolves.toEqual(
      pinned,
    );
  });

  it('reports malformed Better Trading codes with a clear message', async () => {
    await expect(decodeBookmarkTransfer('3:abc')).rejects.toThrow(
      'bookmarkTransfer.error.betterTradingCorrupted',
    );
  });
});
