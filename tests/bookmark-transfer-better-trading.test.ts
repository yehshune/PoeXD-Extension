import { describe, expect, it } from 'vitest';
import { decodeBookmarkTransfer } from '@/utils/bookmark-transfer';
import { encodeTftBase64 } from '@/utils/bookmark-transfer-tft';
import { parseBetterTradingExport } from '@/utils/bookmark-transfer-better-trading';

/** 與 Better Trading 相同：js-base64 的 Base64.encode 為 UTF-8 標準 Base64。 */
const btV3 = (folder: unknown) => `3:${encodeTftBase64(JSON.stringify(folder))}`;
const btV2 = (folder: unknown) => `2:${encodeTftBase64(JSON.stringify(folder))}`;
const btV1 = (folder: unknown) => btoa(JSON.stringify(folder));

const poe1Folder = {
  icn: 'chaos',
  tit: '通貨 ✓',
  ver: '1',
  trs: [
    { tit: '戒指', loc: '1:search:abc123' },
    { tit: '兌換', loc: '1:exchange:ex999' },
  ],
};

const poe2Folder = {
  icn: 'poe2-divine',
  tit: 'PoE2 武器',
  ver: '2',
  trs: [{ tit: '弓', loc: '2:search:bow42' }],
};

describe('Better Trading bookmark import', () => {
  it('imports a v3 folder code as Auto-league bookmarks for the current game version', async () => {
    const payload = await decodeBookmarkTransfer(btV3(poe1Folder), {
      gameVersion: 'poe1',
      fallbackLeague: 'Mercenaries',
    });
    expect(payload).toEqual({
      kind: 'poexd-bookmarks',
      schemaVersion: 2,
      gameVersion: 'poe1',
      scope: 'folder',
      folders: [
        {
          name: '通貨 ✓',
          bookmarks: [
            { name: '戒指', url: 'https://www.pathofexile.com/trade/search/Mercenaries/abc123' },
            { name: '兌換', url: 'https://www.pathofexile.com/trade/exchange/Mercenaries/ex999' },
          ],
        },
      ],
    });
  });

  it('infers PoE2 from a v3 code and builds trade2 URLs', async () => {
    const payload = await decodeBookmarkTransfer(btV3(poe2Folder));
    expect(payload.gameVersion).toBe('poe2');
    expect(payload.folders[0].bookmarks[0].url).toBe(
      'https://www.pathofexile.com/trade2/search/poe2/Standard/bow42',
    );
  });

  it('reads v2 and unprefixed v1 codes as PoE1 folders', async () => {
    const legacy = { icn: 'exalt', tit: 'Legacy', trs: [{ tit: 'Amulet', loc: 'search:amu1' }] };
    for (const code of [btV2(legacy), btV1(legacy)]) {
      const payload = await decodeBookmarkTransfer(code, { gameVersion: 'poe1' });
      expect(payload.folders).toEqual([
        {
          name: 'Legacy',
          bookmarks: [
            { name: 'Amulet', url: 'https://www.pathofexile.com/trade/search/Standard/amu1' },
          ],
        },
      ]);
    }
  });

  it('imports a multi-folder backup file including archived folders', async () => {
    const archived = {
      icn: 'map',
      tit: '已封存',
      ver: '1',
      trs: [{ tit: 'Map', loc: '1:search:map1' }],
    };
    const backup = [
      btV3(poe1Folder),
      btV3(poe2Folder),
      '--------------------',
      btV3(archived),
    ].join('\n');
    const payload = await decodeBookmarkTransfer(backup, { gameVersion: 'poe1' });
    expect(payload.scope).toBe('collection');
    expect(payload.folders.map((folder) => folder.name)).toEqual(['通貨 ✓', '已封存']);
  });

  it('keeps empty folders only for the matching game version', () => {
    const emptyPoe2 = { icn: 'poe2-chaos', tit: '空', ver: '2', trs: [] };
    const parsed = parseBetterTradingExport([btV3(poe1Folder), btV3(emptyPoe2)].join('\n'), {
      gameVersion: 'poe1',
    });
    expect(parsed?.value.folders.map((folder) => folder.name)).toEqual(['通貨 ✓']);
    expect(() => parseBetterTradingExport(btV3(emptyPoe2), { gameVersion: 'poe1' })).toThrow(
      'bookmarkTransfer.error.noBookmarksForVersion',
    );
  });

  it('rejects codes that only contain another game version', async () => {
    await expect(decodeBookmarkTransfer(btV3(poe2Folder), { gameVersion: 'poe1' })).rejects.toThrow(
      'bookmarkTransfer.error.noBookmarksForVersion',
    );
  });

  it('skips malformed lines in a backup and rejects fully malformed codes', async () => {
    const payload = await decodeBookmarkTransfer(`3:!!!\n${btV3(poe1Folder)}`, {
      gameVersion: 'poe1',
    });
    expect(payload.folders).toHaveLength(1);
    await expect(decodeBookmarkTransfer('3:abc')).rejects.toThrow(
      'bookmarkTransfer.error.betterTradingCorrupted',
    );
    await expect(decodeBookmarkTransfer(btV3({ tit: 'x' }))).rejects.toThrow(
      'bookmarkTransfer.error.betterTradingCorrupted',
    );
  });

  it('leaves TFT share codes to the TFT decoder', async () => {
    const tft = encodeTftBase64(JSON.stringify({ folders: [] }));
    expect(parseBetterTradingExport(tft)).toBeUndefined();
    await expect(decodeBookmarkTransfer(tft, { gameVersion: 'poe1' })).resolves.toMatchObject({
      folders: [],
    });
  });

  it('decodes the official Better Trading export fixtures (v1, v2, v3 PoE1/PoE2)', async () => {
    // 取自 exile-center/better-trading tests/fixtures/export-v*.ts
    const v1 =
      'eyJpY24iOiJleGFsdCIsInRpdCI6InRlc3QgZm9sZGVyIiwidHJzIjpbeyJ0aXQiOiJ0ZXN0IHRyYWRlIiwibG9jIjoic2VhcmNoOm93V0pRRWtpbCJ9XX0=';
    const v2 =
      '2:eyJpY24iOiJleGFsdCIsInRpdCI6InRlc3QgZm9sZGVyIPCfl4EiLCJ0cnMiOlt7InRpdCI6InRlc3QgdHJhZGUg8J+amiIsImxvYyI6InNlYXJjaDpvd1dKUUVraWwifV19';
    const v3poe1 =
      '3:eyJpY24iOiJhc2NlbmRhbnQiLCJ0aXQiOiJ0ZXN0IFBvRSAxIGZvbGRlciDwn5eBIiwidmVyIjoiMSIsInRycyI6W3sidGl0IjoidGVzdCBQb0UgMSB0cmFkZSDwn5qaIiwibG9jIjoiMTpzZWFyY2g6Zm9vYmFyIn1dfQ==';
    const v3poe2 =
      '3:eyJpY24iOiJhc2NlbmRhbnQiLCJ0aXQiOiJ0ZXN0IFBvRSAyIGZvbGRlciDwn5eBIiwidmVyIjoiMiIsInRycyI6W3sidGl0IjoidGVzdCBQb0UgMiB0cmFkZSDwn5qaIiwibG9jIjoiMjpzZWFyY2g6Zm9vYmFyIn1dfQ==';

    await expect(decodeBookmarkTransfer(v1)).resolves.toMatchObject({
      gameVersion: 'poe1',
      folders: [
        {
          name: 'test folder',
          bookmarks: [
            {
              name: 'test trade',
              url: 'https://www.pathofexile.com/trade/search/Standard/owWJQEkil',
            },
          ],
        },
      ],
    });
    await expect(decodeBookmarkTransfer(v2)).resolves.toMatchObject({
      folders: [{ name: 'test folder 🗁', bookmarks: [{ name: 'test trade 🚚' }] }],
    });
    await expect(decodeBookmarkTransfer(v3poe1)).resolves.toMatchObject({
      gameVersion: 'poe1',
      folders: [{ name: 'test PoE 1 folder 🗁', bookmarks: [{ name: 'test PoE 1 trade 🚚' }] }],
    });
    await expect(decodeBookmarkTransfer(v3poe2)).resolves.toMatchObject({
      gameVersion: 'poe2',
      folders: [
        {
          name: 'test PoE 2 folder 🗁',
          bookmarks: [
            {
              name: 'test PoE 2 trade 🚚',
              url: 'https://www.pathofexile.com/trade2/search/poe2/Standard/foobar',
            },
          ],
        },
      ],
    });
  });
});
