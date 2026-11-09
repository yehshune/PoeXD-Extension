import { describe, expect, it } from 'vitest';
import {
  buildBookmarkTransfer,
  decodeBookmarkTransfer,
  detectBookmarkImportConflict,
  encodeBookmarkTransfer,
  normalizeBookmarkTransfer,
  planBookmarkTransferImport,
  prepareBookmarkTransferImport,
  resolveUniqueFolderName,
} from '@/utils/bookmark-transfer';

const payload = {
  kind: 'poexd-bookmarks' as const,
  schemaVersion: 2 as const,
  gameVersion: 'poe1' as const,
  scope: 'collection' as const,
  folders: [
    {
      name: '高抗戒指',
      bookmarks: [
        {
          name: '生命抗性戒指',
          url: 'https://www.pathofexile.com/trade/search/Standard/H4sIabc123',
          coverImageUrl: 'https://web.poecdn.com/gen/image/item.png',
        },
      ],
    },
  ],
};

const sharedPayload = {
  kind: 'poexd-bookmarks' as const,
  schemaVersion: 2 as const,
  gameVersion: 'poe1' as const,
  scope: 'collection' as const,
  folders: [
    {
      name: 'Shared',
      bookmarks: [
        {
          name: 'Ring',
          url: 'https://www.pathofexile.com/trade/search/Standard/H4sIabc123',
          coverImageUrl: 'https://web.poecdn.com/gen/image/item.png',
        },
      ],
    },
  ],
};
const sharedCode =
  'poexd-bm1:VY27bsQgFET_ZWpi5KTjD9JmlTTRFtdwF5CBi4CNV1r53yNvkUc5OjNn7lhjcTCowjf3tIismdraodBt4Ewf3HqUAjMreMr8k4_F_KhJZRhYSYntOJjCRZLj1mE-7yiUD34K1NhB4ffjD32LxUPh2hIMwhi1G623bZsqjSAXvsXEk5WsRyPHujM1G_RpUHHUnKbFzs8vULDyxe01k-f3_ypepipsXXlYPBcdj5aOg_NUi8d-3s_7Nw';

/** 舊版 PoeXD 分享碼產生器（僅用於驗證舊格式已被拒絕）：deflate-raw + Base64URL 加前綴。 */
async function encodeLegacyCode(prefix: string, value: unknown) {
  const stream = new Blob([JSON.stringify(value)])
    .stream()
    .pipeThrough(new CompressionStream('deflate-raw' as CompressionFormat));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  return prefix + btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

const asV2 = <T extends { schemaVersion: number }>(value: T) => ({ ...value, schemaVersion: 2 });

describe('Bookmark Transfer interface', () => {
  it('encodes TFT-compatible unprefixed Base64 JSON and round-trips it', async () => {
    const encoded = await encodeBookmarkTransfer(payload);
    expect(encoded).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(encoded.startsWith('poexd-')).toBe(false);
    const json = JSON.parse(
      new TextDecoder().decode(Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))),
    );
    expect(Array.isArray(json.folders)).toBe(true);
    expect(json.folders[0]).toMatchObject({ name: '高抗戒指', parentId: null, depth: 0 });
    expect(json.folders[0].bookmarks[0]).toMatchObject({
      name: '生命抗性戒指',
      league: 'Auto',
      poeVersion: 'Poe1',
      endpoint: 'H4sIabc123',
      type: 'search',
    });
    await expect(decodeBookmarkTransfer(encoded)).resolves.toEqual(asV2(payload));
  });

  it('rejects legacy PoeXD share codes and legacy PoeXD JSON backups', async () => {
    await expect(decodeBookmarkTransfer(sharedCode)).rejects.toThrow(
      'bookmarkTransfer.error.generic',
    );
    await expect(
      decodeBookmarkTransfer(await encodeLegacyCode('poexd-bm2:', sharedPayload)),
    ).rejects.toThrow('bookmarkTransfer.error.generic');
    await expect(decodeBookmarkTransfer(JSON.stringify(sharedPayload))).rejects.toThrow(
      'bookmarkTransfer.error.unrecognizedFormat',
    );
  });

  it('supports PoE2 and empty versioned collections', async () => {
    const poe2 = {
      ...payload,
      gameVersion: 'poe2' as const,
      folders: [
        {
          name: 'PoE2',
          bookmarks: [
            {
              name: 'Exchange',
              url: 'https://www.pathofexile.com/trade2/exchange/poe2/Standard/xyz789',
            },
          ],
        },
      ],
    };
    await expect(decodeBookmarkTransfer(await encodeBookmarkTransfer(poe2))).resolves.toEqual(poe2);
    expect(normalizeBookmarkTransfer({ ...payload, folders: [] })).toEqual({
      ...payload,
      folders: [],
    });
  });

  it('rejects missing versions, ungrouped data, and mixed versions', () => {
    const { gameVersion: _gameVersion, ...withoutVersion } = payload;
    expect(() => normalizeBookmarkTransfer(withoutVersion)).toThrow('malformed');
    expect(() => normalizeBookmarkTransfer({ ...payload, ungrouped: [] })).toThrow('malformed');
    expect(() =>
      normalizeBookmarkTransfer({
        ...payload,
        folders: [
          {
            name: 'Mixed',
            bookmarks: [
              {
                name: 'PoE2',
                url: 'https://www.pathofexile.com/trade2/search/poe2/Standard/H4sIother',
              },
            ],
          },
        ],
      }),
    ).toThrow('another game version');
  });

  it('rejects importing another game version before overwrite', () => {
    const current = {
      groups: [{ id: 'existing-group', name: 'Existing', order: 0 }],
      bookmarks: [
        {
          id: 'existing-bookmark',
          name: 'Keep',
          url: 'https://www.pathofexile.com/trade/search/Standard/H4sIkeep',
          groupId: 'existing-group',
          order: 0,
        },
      ],
    };
    expect(() =>
      prepareBookmarkTransferImport(
        {
          ...payload,
          gameVersion: 'poe2',
          folders: [],
        },
        current,
        'poe1',
        'replace',
      ),
    ).toThrow('another game version');
    expect(current.bookmarks[0].name).toBe('Keep');
  });

  it('keeps repeated folder names as separate occurrences during overwrite', () => {
    const prepared = prepareBookmarkTransferImport(
      {
        ...payload,
        folders: [
          {
            name: 'Same',
            bookmarks: [
              { name: 'First', url: 'https://www.pathofexile.com/trade/search/Standard/H4sIfirst' },
            ],
          },
          {
            name: 'Same',
            bookmarks: [
              {
                name: 'Second',
                url: 'https://www.pathofexile.com/trade/search/Standard/H4sIsecond',
              },
            ],
          },
        ],
      },
      { groups: [], bookmarks: [] },
      'poe1',
      'replace',
      (() => {
        let id = 0;
        return () => String(++id);
      })(),
    );
    expect(prepared.groups).toHaveLength(2);
    expect(prepared.bookmarks.map((bookmark) => [bookmark.groupId, bookmark.name])).toEqual([
      ['group:1', 'First'],
      ['group:3', 'Second'],
    ]);
  });

  it('requires every exported Bookmark to belong to a folder', () => {
    expect(() =>
      buildBookmarkTransfer('poe1', 'collection', {
        groups: [],
        bookmarks: [
          {
            name: 'Loose',
            url: 'https://www.pathofexile.com/trade/search/Standard/H4sIloose',
            groupId: null as unknown as string,
            order: 0,
          },
        ],
      }),
    ).toThrow('belong to a folder');
  });

  it('drops unsupported covers and rejects legacy bundles', async () => {
    const normalized = normalizeBookmarkTransfer({
      ...payload,
      folders: [
        {
          name: 'Folder',
          bookmarks: [
            {
              name: 'Item',
              url: 'https://www.pathofexile.com/trade/search/Standard/H4sIitem',
              coverImageUrl: 'https://tracker.example/pixel.gif',
            },
          ],
        },
      ],
    });
    expect(normalized.folders[0].bookmarks[0]).not.toHaveProperty('coverImageUrl');
    await expect(
      decodeBookmarkTransfer(
        JSON.stringify({
          schemaVersion: 2,
          gameVersion: 'poe1',
          groups: [],
          bookmarks: [],
          searchRecords: [],
        }),
      ),
    ).rejects.toThrow('bookmarkTransfer.error.unrecognizedFormat');
  });

  it('supports long gzip-base64url trade URLs up to 8192 chars and automatically strips trailing /live', async () => {
    const rawHash = 'H4sIAAAAA'.repeat(400);
    const longHashUrl = `https://www.pathofexile.com/trade2/search/poe2/Standard/${rawHash}/live`;
    const cleanUrl = `https://www.pathofexile.com/trade2/search/poe2/Standard/${rawHash}`;
    expect(longHashUrl.length).toBeGreaterThan(2048);
    expect(longHashUrl.length).toBeLessThanOrEqual(8192);

    const encoded = await encodeBookmarkTransfer({
      ...payload,
      gameVersion: 'poe2',
      folders: [
        {
          name: 'GzipSearches',
          bookmarks: [{ name: 'Live Long Query', url: longHashUrl }],
        },
      ],
    });
    const decoded = await decodeBookmarkTransfer(encoded);
    expect(decoded.folders[0].bookmarks[0].url).toBe(cleanUrl);
  });

  it('rejects trade URLs exceeding 8192 chars', async () => {
    const tooLongUrl = `https://www.pathofexile.com/trade/search/Standard/${'u'.repeat(8200)}`;
    expect(() =>
      normalizeBookmarkTransfer({
        kind: 'poexd-bookmarks',
        schemaVersion: 2,
        gameVersion: 'poe1',
        scope: 'collection',
        folders: [
          {
            name: 'TooLong',
            bookmarks: [{ name: 'Overflow', url: tooLongUrl }],
          },
        ],
      }),
    ).toThrow('valid Path of Exile Trade URL');
  });

  it('accepts 200-char names and rejects 201-char names for both folders and bookmarks', async () => {
    const valid200Name = 'A'.repeat(200);
    const invalid201Name = 'A'.repeat(201);
    const validUrl = 'https://www.pathofexile.com/trade/search/Standard/H4sIabc123';

    // 200 chars folder and bookmark: valid
    const validPayload = {
      kind: 'poexd-bookmarks' as const,
      schemaVersion: 2 as const,
      gameVersion: 'poe1' as const,
      scope: 'collection' as const,
      folders: [
        {
          name: valid200Name,
          bookmarks: [{ name: valid200Name, url: validUrl }],
        },
      ],
    };
    const encoded = await encodeBookmarkTransfer(validPayload);
    const decoded = await decodeBookmarkTransfer(encoded);
    expect(decoded.folders[0].name).toBe(valid200Name);
    expect(decoded.folders[0].bookmarks[0].name).toBe(valid200Name);

    // 201 chars folder: rejected
    await expect(
      encodeBookmarkTransfer({
        ...validPayload,
        folders: [{ name: invalid201Name, bookmarks: [{ name: 'Ok', url: validUrl }] }],
      }),
    ).rejects.toThrow('invalid folder name');

    // 201 chars bookmark: rejected
    await expect(
      encodeBookmarkTransfer({
        ...validPayload,
        folders: [{ name: 'Ok', bookmarks: [{ name: invalid201Name, url: validUrl }] }],
      }),
    ).rejects.toThrow('invalid Bookmark name');
  });

  describe('Bookmark Transfer V2 Hierarchy Support', () => {
    const v2Payload = {
      kind: 'poexd-bookmarks' as const,
      schemaVersion: 2 as const,
      gameVersion: 'poe1' as const,
      scope: 'collection' as const,
      folders: [
        {
          name: '裝備',
          bookmarks: [
            {
              name: '衣服',
              url: 'https://www.pathofexile.com/trade/search/Standard/H4sIbody1',
              coverImageUrl: 'https://web.poecdn.com/gen/image/body.png',
            },
          ],
          folders: [
            {
              name: '武器',
              bookmarks: [
                {
                  name: '劍',
                  url: 'https://www.pathofexile.com/trade/search/Standard/H4sIsword1',
                },
              ],
              folders: [
                {
                  name: '弓',
                  bookmarks: [
                    {
                      name: '神弓',
                      url: 'https://www.pathofexile.com/trade/search/Standard/H4sIbow1',
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          name: '藥劑',
          bookmarks: [
            {
              name: '女王水',
              url: 'https://www.pathofexile.com/trade/search/Standard/H4sIflask1',
            },
          ],
        },
      ],
    };

    it('round-trips hierarchy through TFT format', async () => {
      const encoded = await encodeBookmarkTransfer(v2Payload);
      await expect(decodeBookmarkTransfer(encoded)).resolves.toEqual(v2Payload);
    });

    it('buildBookmarkTransfer exports collection scope with full forest and arbitrary depth', () => {
      const collection = {
        groups: [
          { id: 'f-equip', name: '裝備', order: 0 },
          { id: 'f-weapon', name: '武器', order: 0, parentId: 'f-equip' },
          { id: 'f-bow', name: '弓', order: 0, parentId: 'f-weapon' },
          { id: 'f-flask', name: '藥劑', order: 1 },
        ],
        bookmarks: [
          {
            name: '衣服',
            url: 'https://www.pathofexile.com/trade/search/Standard/H4sIbody1',
            coverImageUrl: 'https://web.poecdn.com/gen/image/body.png',
            groupId: 'f-equip',
            order: 0,
          },
          {
            name: '劍',
            url: 'https://www.pathofexile.com/trade/search/Standard/H4sIsword1',
            groupId: 'f-weapon',
            order: 0,
          },
          {
            name: '神弓',
            url: 'https://www.pathofexile.com/trade/search/Standard/H4sIbow1',
            groupId: 'f-bow',
            order: 0,
          },
          {
            name: '女王水',
            url: 'https://www.pathofexile.com/trade/search/Standard/H4sIflask1',
            groupId: 'f-flask',
            order: 0,
          },
        ],
      };

      const exported = buildBookmarkTransfer('poe1', 'collection', collection);
      expect(exported).toEqual(v2Payload);
    });

    it('buildBookmarkTransfer exports folder scope with subtree only', () => {
      const collection = {
        groups: [
          { id: 'f-equip', name: '裝備', order: 0 },
          { id: 'f-weapon', name: '武器', order: 0, parentId: 'f-equip' },
          { id: 'f-bow', name: '弓', order: 0, parentId: 'f-weapon' },
          { id: 'f-flask', name: '藥劑', order: 1 },
        ],
        bookmarks: [
          {
            name: '衣服',
            url: 'https://www.pathofexile.com/trade/search/Standard/H4sIbody1',
            groupId: 'f-equip',
            order: 0,
          },
          {
            name: '劍',
            url: 'https://www.pathofexile.com/trade/search/Standard/H4sIsword1',
            groupId: 'f-weapon',
            order: 0,
          },
          {
            name: '神弓',
            url: 'https://www.pathofexile.com/trade/search/Standard/H4sIbow1',
            groupId: 'f-bow',
            order: 0,
          },
        ],
      };

      const exported = buildBookmarkTransfer('poe1', 'folder', collection, 'f-weapon');
      expect(exported.schemaVersion).toBe(2);
      expect(exported.scope).toBe('folder');
      expect(exported.folders).toHaveLength(1);
      expect(exported.folders[0].name).toBe('武器');
      expect(exported.folders[0].bookmarks).toHaveLength(1);
      expect(exported.folders[0].bookmarks[0].name).toBe('劍');
      expect(exported.folders[0].folders).toHaveLength(1);
      expect(exported.folders[0].folders![0].name).toBe('弓');
      expect(exported.folders[0].folders![0].bookmarks[0].name).toBe('神弓');
    });

    it('prepareBookmarkTransferImport imports nested hierarchy in merge mode', () => {
      const current = {
        groups: [
          { id: 'g-equip', name: '裝備', order: 0 },
          { id: 'g-weapon', name: '武器', order: 0, parentId: 'g-equip' },
        ],
        bookmarks: [
          {
            id: 'b-sword-old',
            name: '劍',
            url: 'https://www.pathofexile.com/trade/search/Standard/H4sIsword1',
            groupId: 'g-weapon',
            order: 0,
          },
        ],
      };

      let idCounter = 100;
      const prepared = prepareBookmarkTransferImport(v2Payload, current, 'poe1', 'merge', () =>
        String(++idCounter),
      );

      // Existing groups matched
      expect(prepared.groups.find((g) => g.id === 'g-equip')).toBeDefined();
      expect(prepared.groups.find((g) => g.id === 'g-weapon')).toBeDefined();

      // New grandchild group '弓' created under 'g-weapon'
      const bowGroup = prepared.groups.find((g) => g.name === '弓');
      expect(bowGroup).toBeDefined();
      expect(bowGroup!.parentId).toBe('g-weapon');

      // New root group '藥劑' created
      const flaskGroup = prepared.groups.find((g) => g.name === '藥劑');
      expect(flaskGroup).toBeDefined();
      expect(flaskGroup!.parentId).toBeUndefined();

      // Sword bookmark deduplicated and retained existing id
      const swordBm = prepared.bookmarks.find(
        (b) => b.url === 'https://www.pathofexile.com/trade/search/Standard/H4sIsword1',
      );
      expect(swordBm?.id).toBe('b-sword-old');

      // Bow bookmark added under bowGroup.id
      const bowBm = prepared.bookmarks.find(
        (b) => b.url === 'https://www.pathofexile.com/trade/search/Standard/H4sIbow1',
      );
      expect(bowBm?.groupId).toBe(bowGroup!.id);
    });

    it('prepareBookmarkTransferImport imports nested hierarchy in overwrite mode', () => {
      let idCounter = 0;
      const prepared = prepareBookmarkTransferImport(
        v2Payload,
        {
          groups: [{ id: 'old-g', name: '舊資料夾', order: 0 }],
          bookmarks: [
            {
              id: 'old-b',
              name: '舊書籤',
              url: 'https://www.pathofexile.com/trade/search/Standard/H4sIold',
              groupId: 'old-g',
              order: 0,
            },
          ],
        },
        'poe1',
        'replace',
        () => String(++idCounter),
      );

      // Old groups and bookmarks completely replaced
      expect(prepared.groups.some((g) => g.id === 'old-g')).toBe(false);
      expect(prepared.bookmarks.some((b) => b.id === 'old-b')).toBe(false);

      // Reconstructed groups
      const equipGroup = prepared.groups.find((g) => g.name === '裝備');
      const weaponGroup = prepared.groups.find((g) => g.name === '武器');
      const bowGroup = prepared.groups.find((g) => g.name === '弓');
      const flaskGroup = prepared.groups.find((g) => g.name === '藥劑');

      expect(equipGroup?.parentId).toBeUndefined();
      expect(weaponGroup?.parentId).toBe(equipGroup?.id);
      expect(bowGroup?.parentId).toBe(weaponGroup?.id);
      expect(flaskGroup?.parentId).toBeUndefined();

      // Orders preserved
      expect(equipGroup?.order).toBe(0);
      expect(flaskGroup?.order).toBe(1);
      expect(weaponGroup?.order).toBe(0);
      expect(bowGroup?.order).toBe(0);
    });

    it('prepareBookmarkTransferImport imports flat payload as root folders', () => {
      const v1 = {
        kind: 'poexd-bookmarks' as const,
        schemaVersion: 2 as const,
        gameVersion: 'poe1' as const,
        scope: 'collection' as const,
        folders: [
          {
            name: 'Root1',
            bookmarks: [
              { name: 'B1', url: 'https://www.pathofexile.com/trade/search/Standard/H4sIu1' },
            ],
          },
          {
            name: 'Root2',
            bookmarks: [
              { name: 'B2', url: 'https://www.pathofexile.com/trade/search/Standard/H4sIu2' },
            ],
          },
        ],
      };

      const prepared = prepareBookmarkTransferImport(
        v1,
        { groups: [], bookmarks: [] },
        'poe1',
        'replace',
      );
      expect(prepared.groups).toHaveLength(2);
      expect(prepared.groups[0].parentId).toBeUndefined();
      expect(prepared.groups[1].parentId).toBeUndefined();
    });

    it('prepareBookmarkTransferImport in folder-scoped overwrite mode replaces matched folder subtree while preserving unrelated subtrees', () => {
      let idCounter = 100;
      const current = {
        groups: [
          // Target root subtree to overwrite
          { id: 'root-1', name: 'RootTarget', order: 0 },
          { id: 'old-child-1', name: 'OldChild', order: 0, parentId: 'root-1' },
          { id: 'old-grandchild-1', name: 'OldGrandchild', order: 0, parentId: 'old-child-1' },
          // Unrelated root subtree
          { id: 'root-2', name: 'UnrelatedRoot', order: 1 },
          { id: 'unrelated-child', name: 'UnrelatedChild', order: 0, parentId: 'root-2' },
        ],
        bookmarks: [
          {
            id: 'bm-old-1',
            name: 'Old BM 1',
            url: 'https://www.pathofexile.com/trade/search/Standard/H4sIold1',
            groupId: 'old-child-1',
            order: 0,
          },
          {
            id: 'bm-old-2',
            name: 'Old BM 2',
            url: 'https://www.pathofexile.com/trade/search/Standard/H4sIold2',
            groupId: 'root-1',
            order: 0,
          },
          {
            id: 'bm-keep',
            name: 'Keep BM',
            url: 'https://www.pathofexile.com/trade/search/Standard/H4sIkeep',
            groupId: 'unrelated-child',
            order: 0,
          },
        ],
      };

      const folderPayload: BookmarkTransferPayload = {
        kind: 'poexd-bookmarks',
        schemaVersion: 2,
        gameVersion: 'poe1',
        scope: 'folder',
        folders: [
          {
            name: 'RootTarget',
            bookmarks: [
              {
                name: 'New Root BM',
                url: 'https://www.pathofexile.com/trade/search/Standard/H4sInewroot',
              },
            ],
            folders: [
              {
                name: 'NewChild',
                bookmarks: [
                  {
                    name: 'New Child BM',
                    url: 'https://www.pathofexile.com/trade/search/Standard/H4sInewchild',
                  },
                ],
              },
            ],
          },
        ],
      };

      const prepared = prepareBookmarkTransferImport(
        folderPayload,
        current,
        'poe1',
        'replace',
        () => `new-${++idCounter}`,
      );

      // 1. RootTarget preserves root id
      const targetGroup = prepared.groups.find((g) => g.name === 'RootTarget');
      expect(targetGroup?.id).toBe('root-1');

      // 2. Old descendants of RootTarget are completely removed
      expect(prepared.groups.some((g) => g.id === 'old-child-1')).toBe(false);
      expect(prepared.groups.some((g) => g.id === 'old-grandchild-1')).toBe(false);
      expect(prepared.bookmarks.some((b) => b.id === 'bm-old-1')).toBe(false);
      expect(prepared.bookmarks.some((b) => b.id === 'bm-old-2')).toBe(false);

      // 3. New subtree is imported under RootTarget
      const newChild = prepared.groups.find((g) => g.name === 'NewChild');
      expect(newChild).toBeDefined();
      expect(newChild?.parentId).toBe('root-1');
      expect(
        prepared.bookmarks.some((b) => b.name === 'New Root BM' && b.groupId === 'root-1'),
      ).toBe(true);
      expect(
        prepared.bookmarks.some((b) => b.name === 'New Child BM' && b.groupId === newChild?.id),
      ).toBe(true);

      // 4. Unrelated root and its descendants remain intact
      expect(prepared.groups.some((g) => g.id === 'root-2')).toBe(true);
      expect(prepared.groups.some((g) => g.id === 'unrelated-child')).toBe(true);
      expect(prepared.bookmarks.some((b) => b.id === 'bm-keep')).toBe(true);
    });

    it('rejects malformed inputs: legacy schema versions, invalid subfolders and cycles', async () => {
      // 已移除的舊版 schemaVersion 1 -> rejected
      expect(() =>
        normalizeBookmarkTransfer({
          kind: 'poexd-bookmarks',
          schemaVersion: 1,
          gameVersion: 'poe1',
          scope: 'collection',
          folders: [],
        }),
      ).toThrow('malformed');

      // V2 subfolders not an array -> rejected
      expect(() =>
        normalizeBookmarkTransfer({
          kind: 'poexd-bookmarks',
          schemaVersion: 2,
          gameVersion: 'poe1',
          scope: 'collection',
          folders: [
            {
              name: 'Folder',
              bookmarks: [],
              folders: 'not-array',
            },
          ],
        }),
      ).toThrow('subfolders must be an array');

      // Folder cycle -> rejected
      const cyclicFolder: any = {
        name: 'Loop',
        bookmarks: [],
      };
      cyclicFolder.folders = [cyclicFolder];
      expect(() =>
        normalizeBookmarkTransfer({
          kind: 'poexd-bookmarks',
          schemaVersion: 2,
          gameVersion: 'poe1',
          scope: 'collection',
          folders: [cyclicFolder],
        }),
      ).toThrow('folder cycle');
    });

    it('accepts arbitrary depth > 32 (e.g. 40 levels) when within folder quota', async () => {
      let deep: any = { name: 'Level40', bookmarks: [] };
      for (let i = 39; i >= 1; i -= 1) {
        deep = { name: `Level${i}`, bookmarks: [], folders: [deep] };
      }
      const normalized = normalizeBookmarkTransfer({
        kind: 'poexd-bookmarks',
        schemaVersion: 2,
        gameVersion: 'poe1',
        scope: 'collection',
        folders: [deep],
      });
      expect(normalized.folders).toHaveLength(1);

      // Verify encoding and decoding round-trip for 40 levels
      const encoded = await encodeBookmarkTransfer(normalized);
      const decoded = await decodeBookmarkTransfer(encoded);
      expect(decoded.folders).toHaveLength(1);
    });
  });

  describe('planBookmarkTransferImport SSOT', () => {
    const current = {
      groups: [
        { id: 'g_existing', name: 'ExistingFolder', order: 0 },
        { id: 'g_other', name: 'OtherFolder', order: 1 },
      ],
      bookmarks: [
        {
          id: 'b_dup',
          name: 'ExistingBM',
          url: 'https://www.pathofexile.com/trade/search/Standard/H4sIdup123',
          groupId: 'g_existing',
          order: 0,
        },
        {
          id: 'b_keep',
          name: 'KeepBM',
          url: 'https://www.pathofexile.com/trade/search/Standard/H4sIkeep456',
          groupId: 'g_other',
          order: 0,
        },
      ],
    };

    const incomingPayload = {
      kind: 'poexd-bookmarks' as const,
      schemaVersion: 2 as const,
      gameVersion: 'poe1' as const,
      scope: 'collection' as const,
      folders: [
        {
          name: 'ExistingFolder',
          bookmarks: [
            {
              name: 'ExistingBM',
              url: 'https://www.pathofexile.com/trade/search/Standard/H4sIdup123',
              coverImageUrl: 'https://web.poecdn.com/image/item1.png',
            },
            {
              name: 'NewBM',
              url: 'https://www.pathofexile.com/trade/search/Standard/H4sInew789',
            },
          ],
        },
        {
          name: 'NewFolder',
          bookmarks: [
            {
              name: 'BrandNewBM',
              url: 'https://www.pathofexile.com/trade/search/Standard/H4sIbrand1',
            },
          ],
        },
      ],
    };

    it('accurately plans collection merge with duplicates and cover updates distinguished', () => {
      let idCounter = 1;
      const createId = () => `mock_${idCounter++}`;
      const plan = planBookmarkTransferImport(incomingPayload, current, 'poe1', 'merge', createId);

      // Summary assertions
      expect(plan.summary.createdFoldersCount).toBe(1); // NewFolder
      expect(plan.summary.retainedFoldersCount).toBe(2); // ExistingFolder + OtherFolder
      expect(plan.summary.deletedFoldersCount).toBe(0);
      expect(plan.summary.createdBookmarksCount).toBe(2); // NewBM + BrandNewBM
      expect(plan.summary.updatedBookmarksCount).toBe(1); // ExistingBM receives cover
      expect(plan.summary.skippedBookmarksCount).toBe(0);
      expect(plan.summary.retainedBookmarksCount).toBe(1); // KeepBM untouched
      expect(plan.summary.deletedBookmarksCount).toBe(0);

      // Conservation checks
      expect(plan.summary.deletedFoldersCount + plan.summary.retainedFoldersCount).toBe(
        current.groups.length,
      );
      expect(plan.summary.retainedFoldersCount + plan.summary.createdFoldersCount).toBe(
        plan.prepared.groups.length,
      );
      expect(
        plan.summary.deletedBookmarksCount +
          plan.summary.retainedBookmarksCount +
          plan.summary.updatedBookmarksCount,
      ).toBe(current.bookmarks.length);
      expect(
        plan.summary.retainedBookmarksCount +
          plan.summary.updatedBookmarksCount +
          plan.summary.createdBookmarksCount,
      ).toBe(plan.prepared.bookmarks.length);

      // Prepared equivalence with prepareBookmarkTransferImport
      let idCounter2 = 1;
      const directPrepared = prepareBookmarkTransferImport(
        incomingPayload,
        current,
        'poe1',
        'merge',
        () => `mock_${idCounter2++}`,
      );
      expect(plan.prepared).toEqual(directPrepared);

      // Tree verification
      const existingNode = plan.tree.find((f) => f.name === 'ExistingFolder');
      expect(existingNode).toBeDefined();
      expect(existingNode?.status).toBe('retain');
      const updatedBm = existingNode?.bookmarks.find(
        (b) => b.name === 'ExistingBM' && b.status === 'update',
      );
      expect(updatedBm).toBeDefined();
      const createdBm = existingNode?.bookmarks.find(
        (b) => b.name === 'NewBM' && b.status === 'create',
      );
      expect(createdBm).toBeDefined();
    });

    it('distinguishes cover update from pure duplicate skip in planning SSOT', () => {
      const state = {
        groups: [{ id: 'g1', name: 'Folder', order: 0 }],
        bookmarks: [
          {
            id: 'b_no_cover',
            name: 'ItemWithNoCover',
            url: 'https://www.pathofexile.com/trade/search/Standard/H4sIitem1',
            groupId: 'g1',
            order: 0,
          },
          {
            id: 'b_has_cover',
            name: 'ItemWithCover',
            url: 'https://www.pathofexile.com/trade/search/Standard/H4sIitem2',
            coverImageUrl: 'https://web.poecdn.com/existing.png',
            groupId: 'g1',
            order: 1,
          },
        ],
      };

      const payload = {
        kind: 'poexd-bookmarks' as const,
        schemaVersion: 2 as const,
        gameVersion: 'poe1' as const,
        scope: 'collection' as const,
        folders: [
          {
            name: 'Folder',
            bookmarks: [
              {
                name: 'ItemWithNoCover',
                url: 'https://www.pathofexile.com/trade/search/Standard/H4sIitem1',
                coverImageUrl: 'https://web.poecdn.com/new_cover.png',
              },
              {
                name: 'ItemWithCover',
                url: 'https://www.pathofexile.com/trade/search/Standard/H4sIitem2',
                coverImageUrl: 'https://web.poecdn.com/different_cover.png',
              },
            ],
          },
        ],
      };

      const plan = planBookmarkTransferImport(payload, state, 'poe1', 'merge');

      // Summary should clearly separate update and skip
      expect(plan.summary.updatedBookmarksCount).toBe(1);
      expect(plan.summary.skippedBookmarksCount).toBe(1);
      expect(plan.summary.retainedBookmarksCount).toBe(1); // ItemWithCover retained
      expect(plan.summary.createdBookmarksCount).toBe(0);

      // Verify prepared data
      const updatedItem = plan.prepared.bookmarks.find((b) => b.id === 'b_no_cover');
      expect(updatedItem?.coverImageUrl).toBe('https://web.poecdn.com/new_cover.png');
      const skippedItem = plan.prepared.bookmarks.find((b) => b.id === 'b_has_cover');
      expect(skippedItem?.coverImageUrl).toBe('https://web.poecdn.com/existing.png'); // not overwritten

      // Verify tree nodes
      const folderNode = plan.tree.find((f) => f.name === 'Folder');
      const updateNode = folderNode?.bookmarks.find((b) => b.name === 'ItemWithNoCover');
      expect(updateNode?.status).toBe('update');
      const skipNode = folderNode?.bookmarks.find(
        (b) => b.name === 'ItemWithCover' && b.status === 'skip',
      );
      expect(skipNode).toBeDefined();
    });

    it('accurately plans collection overwrite with all existing deleted and incoming created', () => {
      let idCounter = 1;
      const plan = planBookmarkTransferImport(
        incomingPayload,
        current,
        'poe1',
        'replace',
        () => `mock_${idCounter++}`,
      );

      expect(plan.summary.deletedFoldersCount).toBe(2);
      expect(plan.summary.retainedFoldersCount).toBe(0);
      expect(plan.summary.createdFoldersCount).toBe(2);
      expect(plan.summary.deletedBookmarksCount).toBe(2);
      expect(plan.summary.retainedBookmarksCount).toBe(0);
      expect(plan.summary.createdBookmarksCount).toBe(3);
      expect(plan.summary.skippedBookmarksCount).toBe(0);

      // Conservation checks
      expect(plan.summary.deletedFoldersCount + plan.summary.retainedFoldersCount).toBe(
        current.groups.length,
      );
      expect(plan.summary.retainedFoldersCount + plan.summary.createdFoldersCount).toBe(
        plan.prepared.groups.length,
      );
      expect(plan.summary.deletedBookmarksCount + plan.summary.retainedBookmarksCount).toBe(
        current.bookmarks.length,
      );
      expect(plan.summary.retainedBookmarksCount + plan.summary.createdBookmarksCount).toBe(
        plan.prepared.bookmarks.length,
      );

      // Deleted nodes in tree
      const deletedNodes = plan.tree.filter((f) => f.status === 'delete');
      expect(deletedNodes.map((n) => n.name).sort()).toEqual(['ExistingFolder', 'OtherFolder']);
      const createdNodes = plan.tree.filter((f) => f.status === 'create');
      expect(createdNodes.map((n) => n.name).sort()).toEqual(['ExistingFolder', 'NewFolder']);
    });

    it('accurately plans folder overwrite replacing target subtree and preserving other folders', () => {
      const folderPayload = {
        kind: 'poexd-bookmarks' as const,
        schemaVersion: 2 as const,
        gameVersion: 'poe1' as const,
        scope: 'folder' as const,
        folders: [
          {
            name: 'ExistingFolder',
            bookmarks: [
              {
                name: 'ReplacedBM',
                url: 'https://www.pathofexile.com/trade/search/Standard/H4sIrep999',
              },
            ],
          },
        ],
      };

      const plan = planBookmarkTransferImport(folderPayload, current, 'poe1', 'replace');

      // ExistingFolder targetGroup is retained (reused), OtherFolder is retained, direct bookmark in ExistingFolder is deleted
      expect(plan.summary.deletedFoldersCount).toBe(0); // no subfolders existed
      expect(plan.summary.retainedFoldersCount).toBe(2);
      expect(plan.summary.createdFoldersCount).toBe(0);
      expect(plan.summary.deletedBookmarksCount).toBe(1); // b_dup in ExistingFolder
      expect(plan.summary.retainedBookmarksCount).toBe(1); // b_keep in OtherFolder
      expect(plan.summary.createdBookmarksCount).toBe(1); // ReplacedBM

      // Conservation checks
      expect(plan.summary.deletedFoldersCount + plan.summary.retainedFoldersCount).toBe(
        current.groups.length,
      );
      expect(plan.summary.retainedFoldersCount + plan.summary.createdFoldersCount).toBe(
        plan.prepared.groups.length,
      );
      expect(plan.summary.deletedBookmarksCount + plan.summary.retainedBookmarksCount).toBe(
        current.bookmarks.length,
      );
      expect(plan.summary.retainedBookmarksCount + plan.summary.createdBookmarksCount).toBe(
        plan.prepared.bookmarks.length,
      );
    });

    it('rejects payload with mismatched gameVersion', () => {
      expect(() => planBookmarkTransferImport(incomingPayload, current, 'poe2', 'merge')).toThrow(
        'Bookmark Transfer belongs to another game version',
      );
    });
  });

  describe('Bookmark Transfer Folder Conflict Resolution', () => {
    const singleFolderPayload = {
      kind: 'poexd-bookmarks' as const,
      schemaVersion: 2 as const,
      gameVersion: 'poe1' as const,
      scope: 'folder' as const,
      folders: [
        {
          name: 'Equipment',
          bookmarks: [
            {
              name: 'Bow',
              url: 'https://www.pathofexile.com/trade/search/Standard/H4sIbow123',
            },
          ],
        },
      ],
    };

    it('1. existing 沒有同名 folder：原名建立 (create mode)', () => {
      const current = {
        groups: [{ id: 'g_other', name: 'Flasks', order: 0 }],
        bookmarks: [],
      };

      const conflict = detectBookmarkImportConflict(singleFolderPayload, current.groups);
      expect(conflict.hasConflict).toBe(false);
      expect(conflict.candidates).toHaveLength(0);

      const plan = planBookmarkTransferImport(singleFolderPayload, current, 'poe1', 'create');
      expect(plan.mode).toBe('create');
      expect(plan.summary.createdFoldersCount).toBe(1);
      expect(plan.summary.retainedFoldersCount).toBe(1);
      const createdFolder = plan.prepared.groups.find((g) => g.id !== 'g_other');
      expect(createdFolder?.name).toBe('Equipment');
    });

    it('2. existing 有 Folder：建立 Folder (2) (create mode)', () => {
      const current = {
        groups: [{ id: 'g_existing', name: 'Equipment', order: 0 }],
        bookmarks: [],
      };

      const conflict = detectBookmarkImportConflict(singleFolderPayload, current.groups);
      expect(conflict.hasConflict).toBe(true);
      expect(conflict.candidates).toHaveLength(1);
      expect(conflict.candidates[0].id).toBe('g_existing');

      const plan = planBookmarkTransferImport(singleFolderPayload, current, 'poe1', 'create');
      expect(plan.summary.createdFoldersCount).toBe(1);
      expect(plan.summary.retainedFoldersCount).toBe(1);
      const createdFolder = plan.prepared.groups.find((g) => g.id !== 'g_existing');
      expect(createdFolder?.name).toBe('Equipment (2)');
    });

    it('3. existing 有 Folder 與 Folder (2)：建立 Folder (3) 且遵守 30 字元長度限制', () => {
      const current = {
        groups: [
          { id: 'g1', name: 'Equipment', order: 0 },
          { id: 'g2', name: 'Equipment (2)', order: 1 },
        ],
        bookmarks: [],
      };

      const plan = planBookmarkTransferImport(singleFolderPayload, current, 'poe1', 'create');
      const createdFolder = plan.prepared.groups.find((g) => g.id !== 'g1' && g.id !== 'g2');
      expect(createdFolder?.name).toBe('Equipment (3)');

      // 測試接近與達到 200 字元上限時的截斷行為
      const longName = 'A'.repeat(200);
      const uniqueName1 = resolveUniqueFolderName(longName, [longName]);
      expect(uniqueName1.length).toBeLessThanOrEqual(200);
      expect(uniqueName1).toBe(`${'A'.repeat(196)} (2)`);

      const uniqueName2 = resolveUniqueFolderName(longName, [longName, uniqueName1]);
      expect(uniqueName2.length).toBeLessThanOrEqual(200);
      expect(uniqueName2).toBe(`${'A'.repeat(196)} (3)`);
    });

    it('4. nested 同名：A/B 與 C/B 不得互相誤認 (hierarchy-aware)', () => {
      const current = {
        groups: [
          { id: 'gA', name: 'A', order: 0 },
          { id: 'gB_under_A', name: 'B', parentId: 'gA', order: 0 },
          { id: 'gC', name: 'C', order: 1 },
          { id: 'gB_under_C', name: 'B', parentId: 'gC', order: 0 },
        ],
        bookmarks: [
          {
            id: 'bA',
            groupId: 'gB_under_A',
            name: 'OldInA',
            url: 'https://www.pathofexile.com/trade/search/Standard/H4sIoldA',
            order: 0,
          },
          {
            id: 'bC',
            groupId: 'gB_under_C',
            name: 'OldInC',
            url: 'https://www.pathofexile.com/trade/search/Standard/H4sIoldC',
            order: 0,
          },
        ],
      };

      // incoming 匯入 A 資料夾，其子資料夾有 B
      const incoming = {
        kind: 'poexd-bookmarks' as const,
        schemaVersion: 2 as const,
        gameVersion: 'poe1' as const,
        scope: 'folder' as const,
        folders: [
          {
            name: 'A',
            bookmarks: [],
            folders: [
              {
                name: 'B',
                bookmarks: [
                  {
                    name: 'NewInA_B',
                    url: 'https://www.pathofexile.com/trade/search/Standard/H4sInewAB',
                  },
                ],
              },
            ],
          },
        ],
      };

      const plan = planBookmarkTransferImport(incoming, current, 'poe1', {
        mode: 'merge',
        targetGroupId: 'gA',
      });

      // 驗證 NewInA_B 併入了 gB_under_A，沒有建立新的 B，且沒有動到 gB_under_C
      expect(plan.summary.createdFoldersCount).toBe(0);
      const newBookmark = plan.prepared.bookmarks.find((b) => b.name === 'NewInA_B');
      expect(newBookmark?.groupId).toBe('gB_under_A');

      // gB_under_C 的書籤依然存在且未受影響
      const oldCBookmark = plan.prepared.bookmarks.find((b) => b.id === 'bC');
      expect(oldCBookmark?.groupId).toBe('gB_under_C');
    });

    it('5. 唯一 conflict：merge / replace 綁定正確 targetGroupId', () => {
      const current = {
        groups: [
          { id: 'target_id', name: 'Equipment', order: 0 },
          { id: 'other_id', name: 'Gems', order: 1 },
        ],
        bookmarks: [
          {
            id: 'old_bm',
            groupId: 'target_id',
            name: 'OldBow',
            url: 'https://www.pathofexile.com/trade/search/Standard/H4sIoldbow',
            order: 0,
          },
          {
            id: 'gem_bm',
            groupId: 'other_id',
            name: 'GemBM',
            url: 'https://www.pathofexile.com/trade/search/Standard/H4sIgem1',
            order: 0,
          },
        ],
      };

      const conflict = detectBookmarkImportConflict(singleFolderPayload, current.groups);
      expect(conflict.candidates).toHaveLength(1);
      expect(conflict.candidates[0].id).toBe('target_id');

      // merge: 保留 target 既有書籤，加入 incoming
      const mergePlan = planBookmarkTransferImport(singleFolderPayload, current, 'poe1', {
        mode: 'merge',
        targetGroupId: 'target_id',
      });
      expect(mergePlan.summary.retainedBookmarksCount).toBe(2);
      expect(mergePlan.summary.createdBookmarksCount).toBe(1);
      expect(mergePlan.prepared.bookmarks.find((b) => b.name === 'Bow')?.groupId).toBe('target_id');
      expect(mergePlan.prepared.bookmarks.find((b) => b.id === 'old_bm')).toBeDefined();

      // replace: 清空 target 子樹與書籤，其餘資料夾（Gems）保留
      const replacePlan = planBookmarkTransferImport(singleFolderPayload, current, 'poe1', {
        mode: 'replace',
        targetGroupId: 'target_id',
      });
      expect(replacePlan.summary.deletedBookmarksCount).toBe(1); // old_bm 被刪除
      expect(replacePlan.summary.retainedBookmarksCount).toBe(1); // gem_bm 保留
      expect(replacePlan.summary.createdBookmarksCount).toBe(1); // Bow 新增
      expect(replacePlan.prepared.bookmarks.find((b) => b.id === 'old_bm')).toBeUndefined();
      expect(replacePlan.prepared.bookmarks.find((b) => b.id === 'gem_bm')).toBeDefined();
    });

    it('6. 多個同名候選：未指定 target 時拋錯，不得自動選第一個', () => {
      const current = {
        groups: [
          { id: 'root_equip', name: 'Equipment', order: 0 },
          { id: 'cat', name: 'Category', order: 1 },
          { id: 'sub_equip', name: 'Equipment', order: 0, parentId: 'cat' },
        ],
        bookmarks: [],
      };

      const conflict = detectBookmarkImportConflict(singleFolderPayload, current.groups);
      expect(conflict.candidates).toHaveLength(2);
      expect(conflict.candidates[0].path).toBe('Equipment');
      expect(conflict.candidates[1].path).toBe('Category / Equipment');

      // merge 未提供 targetGroupId -> throw
      expect(() => {
        planBookmarkTransferImport(singleFolderPayload, current, 'poe1', 'merge');
      }).toThrow('Multiple target folders found with the same name');

      // replace 未提供 targetGroupId -> throw
      expect(() => {
        planBookmarkTransferImport(singleFolderPayload, current, 'poe1', 'replace');
      }).toThrow('Multiple target folders found with the same name');

      // 提供明確 targetGroupId -> 成功
      const plan = planBookmarkTransferImport(singleFolderPayload, current, 'poe1', {
        mode: 'merge',
        targetGroupId: 'sub_equip',
      });
      expect(plan.prepared.bookmarks[0].groupId).toBe('sub_equip');
    });

    it('7. targetGroupId 已失效：安全失敗', () => {
      const current = {
        groups: [{ id: 'valid_id', name: 'Equipment', order: 0 }],
        bookmarks: [],
      };

      expect(() => {
        planBookmarkTransferImport(singleFolderPayload, current, 'poe1', {
          mode: 'merge',
          targetGroupId: 'deleted_or_stale_id',
        });
      }).toThrow('Target folder was not found or has been deleted');
    });

    it('target ID 存在但名稱已不匹配 incoming：merge fail closed 且不執行 mutation', () => {
      // existing 初始有 g1=Equipment，後被 rename 為 Gems
      const current = {
        groups: [
          { id: 'g1', name: 'Gems', order: 0 },
          { id: 'g1_sub', name: 'Support', order: 0, parentId: 'g1' },
        ],
        bookmarks: [
          {
            id: 'b_gem',
            groupId: 'g1_sub',
            name: 'GemBM',
            url: 'https://www.pathofexile.com/trade/search/Standard/H4sIgem123',
            order: 0,
          },
        ],
      };

      // incoming 是 Equipment，caller 仍持有舊的 targetGroupId = g1
      expect(() => {
        planBookmarkTransferImport(singleFolderPayload, current, 'poe1', {
          mode: 'merge',
          targetGroupId: 'g1',
        });
      }).toThrow('Target folder does not match incoming folder name');

      expect(() => {
        prepareBookmarkTransferImport(singleFolderPayload, current, 'poe1', {
          mode: 'merge',
          targetGroupId: 'g1',
        });
      }).toThrow('Target folder does not match incoming folder name');
    });

    it('target ID 存在但名稱已不匹配 incoming：replace fail closed 且 existing subtree 完整保留', () => {
      const current = {
        groups: [
          { id: 'g1', name: 'Gems', order: 0 },
          { id: 'g1_sub', name: 'Support', order: 0, parentId: 'g1' },
          { id: 'g_other', name: 'Flasks', order: 1 },
        ],
        bookmarks: [
          {
            id: 'b_gem',
            groupId: 'g1_sub',
            name: 'GemBM',
            url: 'https://www.pathofexile.com/trade/search/Standard/H4sIgem123',
            order: 0,
          },
        ],
      };

      // incoming 是 Equipment，使用 targetGroupId = g1 試圖 replace
      expect(() => {
        planBookmarkTransferImport(singleFolderPayload, current, 'poe1', {
          mode: 'replace',
          targetGroupId: 'g1',
        });
      }).toThrow('Target folder does not match incoming folder name');

      expect(() => {
        prepareBookmarkTransferImport(singleFolderPayload, current, 'poe1', {
          mode: 'replace',
          targetGroupId: 'g1',
        });
      }).toThrow('Target folder does not match incoming folder name');

      // 驗證 current 狀態完全未被破壞或異動
      expect(current.groups).toHaveLength(3);
      expect(current.groups.find((g) => g.id === 'g1')?.name).toBe('Gems');
      expect(current.groups.find((g) => g.id === 'g1_sub')).toBeDefined();
      expect(current.bookmarks).toHaveLength(1);
      expect(current.bookmarks[0].id).toBe('b_gem');
    });

    it('8. Preview plan.prepared 與 prepareBookmarkTransferImport 一致', () => {
      const current = {
        groups: [{ id: 'g1', name: 'Equipment', order: 0 }],
        bookmarks: [
          {
            id: 'b1',
            groupId: 'g1',
            name: 'Bow',
            url: 'https://www.pathofexile.com/trade/search/Standard/H4sIbow123',
            order: 0,
          },
        ],
      };

      const options = { mode: 'merge' as const, targetGroupId: 'g1' };
      const plan = planBookmarkTransferImport(singleFolderPayload, current, 'poe1', options);
      const prepared = prepareBookmarkTransferImport(singleFolderPayload, current, 'poe1', options);

      expect(plan.prepared).toEqual(prepared);
    });

    it('9. Folder scope create mode 永遠不攜帶 targetGroupId 且自動產生後綴', () => {
      const current = {
        groups: [{ id: 'g1', name: 'Equipment', order: 0 }],
        bookmarks: [
          {
            id: 'b1',
            groupId: 'g1',
            name: 'Bow',
            url: 'https://www.pathofexile.com/trade/search/Standard/H4sIbow123',
            order: 0,
          },
        ],
      };

      const plan = planBookmarkTransferImport(singleFolderPayload, current, 'poe1', 'create');
      expect(plan.mode).toBe('create');
      expect(plan.targetGroupId).toBeUndefined();
      expect(plan.prepared.groups).toHaveLength(2);
      expect(plan.prepared.groups.find((g) => g.id === 'g1')?.name).toBe('Equipment');
      expect(plan.prepared.groups.find((g) => g.id !== 'g1')?.name).toBe('Equipment (2)');

      // 即使傳入 options 帶有 targetGroupId，create mode 也保證 plan.targetGroupId 為 undefined
      const planWithOptions = planBookmarkTransferImport(singleFolderPayload, current, 'poe1', {
        mode: 'create',
        targetGroupId: 'g1',
      });
      expect(planWithOptions.targetGroupId).toBeUndefined();
    });
  });
});

describe('Bookmark Transfer import skips Legacy Search IDs (ADR-0008)', () => {
  const legacyPayload = {
    kind: 'poexd-bookmarks' as const,
    schemaVersion: 2 as const,
    gameVersion: 'poe1' as const,
    scope: 'collection' as const,
    folders: [
      {
        name: 'Mixed',
        bookmarks: [
          { name: 'Valid', url: 'https://www.pathofexile.com/trade/search/Standard/H4sIvalid1' },
          { name: 'Legacy', url: 'https://www.pathofexile.com/trade/search/Standard/Ab3dEf' },
          { name: 'Exchange', url: 'https://www.pathofexile.com/trade/exchange/Standard/Xy9zQ' },
        ],
      },
    ],
  };

  it('skips legacy item searches, keeps exchange bookmarks, and reports the count', () => {
    let id = 1;
    const plan = planBookmarkTransferImport(
      legacyPayload,
      { groups: [], bookmarks: [] },
      'poe1',
      'merge',
      () => `mock_${id++}`,
    );

    expect(plan.summary.createdBookmarksCount).toBe(2);
    expect(plan.summary.skippedBookmarksCount).toBe(1);
    expect(plan.summary.skippedLegacyBookmarksCount).toBe(1);
    expect(plan.prepared.bookmarks.map((b) => b.name)).toEqual(['Valid', 'Exchange']);
    const folder = plan.tree.find((f) => f.name === 'Mixed');
    expect(folder?.bookmarks).toContainEqual(
      expect.objectContaining({ name: 'Legacy', status: 'skip' }),
    );
  });
});
