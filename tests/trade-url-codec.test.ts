import { describe, expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';
import {
  isGzipHash,
  decodeGzipBase64UrlToQuery,
  decodeTradeSearchUrl,
  extractQueryMetadata,
} from '../utils/trade-url-codec';

describe('trade-url-codec (extension)', () => {
  const sampleQuery = {
    query: {
      name: '魔血',
      type: '重型腰帶',
      stats: [
        {
          filters: [{ id: 'explicit.stat_123', value: { min: 20 } }],
        },
      ],
      filters: {
        trade_filters: {
          filters: {
            price: { min: 50, option: 'divine' },
          },
        },
      },
    },
  };

  function createGzipHash(obj: any): string {
    return gzipSync(Buffer.from(JSON.stringify(obj), 'utf8')).toString('base64url');
  }

  describe('isGzipHash', () => {
    it('識別合法的 Gzip-Base64URL hash', () => {
      const hash = createGzipHash(sampleQuery);
      expect(isGzipHash(hash)).toBe(true);
    });

    it('識別非 Gzip 舊版短網址並回傳 false', () => {
      expect(isGzipHash('X8QWk6')).toBe(false);
      expect(isGzipHash('')).toBe(false);
    });
  });

  describe('decodeGzipBase64UrlToQuery', () => {
    it('使用 DecompressionStream 解碼 gzip hash 為原始 query', async () => {
      const hash = createGzipHash(sampleQuery);
      const decoded = await decodeGzipBase64UrlToQuery(hash);
      expect(decoded).toEqual(sampleQuery);
    });

    it('舊版短網址回傳 null', async () => {
      expect(await decodeGzipBase64UrlToQuery('X8QWk6')).toBeNull();
    });
  });

  describe('decodeTradeSearchUrl', () => {
    it('從完整市集網址解析條件', async () => {
      const hash = createGzipHash(sampleQuery);
      const url = `https://www.pathofexile.com/trade2/search/poe2/Standard/${hash}`;
      const res = await decodeTradeSearchUrl(url);
      expect(res).not.toBeNull();
      expect(res?.gameVersion).toBe('poe2');
      expect(res?.league).toBe('standard');
      expect(res?.query).toEqual(sampleQuery);
    });

    it('舊版短網址回傳 null', async () => {
      const legacyUrl = 'https://www.pathofexile.com/trade/search/Standard/X8QWk6';
      expect(await decodeTradeSearchUrl(legacyUrl)).toBeNull();
    });
  });

  describe('extractQueryMetadata', () => {
    it('Branch A: name + type -> "${name} (${type})"', () => {
      const meta = extractQueryMetadata(sampleQuery);
      expect(meta.suggestedName).toBe('魔血 (重型腰帶)');
      expect(meta.name).toBe('魔血');
      expect(meta.type).toBe('重型腰帶');
      expect(meta.stats).toHaveLength(1);
    });

    it('Branch A: name + type + rarity -> "${name} (${type}) ${rarity}"（且忽略 category）', () => {
      const meta = extractQueryMetadata(
        {
          query: {
            name: '魔血',
            type: '重型腰帶',
            filters: {
              type_filters: {
                filters: {
                  category: { option: 'accessory.belt' },
                  rarity: { option: 'unique' },
                },
              },
            },
          },
        },
        'poe2',
      );
      expect(meta.suggestedName).toBe('魔血 (重型腰帶) 傳奇');
    });

    it('Branch A: name === type（含無 rarity 與有 rarity）', () => {
      expect(
        extractQueryMetadata({
          query: {
            name: '重型腰帶',
            type: '重型腰帶',
          },
        }).suggestedName,
      ).toBe('重型腰帶');

      expect(
        extractQueryMetadata(
          {
            query: {
              name: '重型腰帶',
              type: '重型腰帶',
              filters: {
                type_filters: {
                  filters: {
                    rarity: { option: 'rare' },
                  },
                },
              },
            },
          },
          'poe1',
        ).suggestedName,
      ).toBe('重型腰帶 稀有');
    });

    it('Branch A: 僅 name 與 name + rarity', () => {
      expect(
        extractQueryMetadata({
          query: {
            name: '獵首',
          },
        }).suggestedName,
      ).toBe('獵首');

      expect(
        extractQueryMetadata(
          {
            query: {
              name: '獵首',
              filters: {
                type_filters: {
                  filters: {
                    rarity: { option: 'unique' },
                  },
                },
              },
            },
          },
          'poe1',
        ).suggestedName,
      ).toBe('獵首 傳奇');
    });

    it('Branch A: 僅 type 與 type + rarity', () => {
      expect(
        extractQueryMetadata({
          query: {
            type: '重型腰帶',
          },
        }).suggestedName,
      ).toBe('重型腰帶');

      expect(
        extractQueryMetadata(
          {
            query: {
              type: '重型腰帶',
              filters: {
                type_filters: {
                  filters: {
                    rarity: { option: 'unique' },
                  },
                },
              },
            },
          },
          'poe1',
        ).suggestedName,
      ).toBe('重型腰帶 傳奇');
    });

    it('Branch B: 無 name/type，僅有 category -> "${category}"', () => {
      const meta = extractQueryMetadata(
        {
          query: {
            filters: {
              type_filters: {
                filters: {
                  category: { option: 'armour.chest' },
                },
              },
            },
          },
        },
        'poe2',
      );
      expect(meta.suggestedName).toBe('胸甲');
    });

    it('Branch B: 無 name/type/category，僅有 rarity -> "${rarity}"', () => {
      expect(
        extractQueryMetadata(
          {
            query: {
              filters: {
                type_filters: {
                  filters: {
                    rarity: { option: 'unique' },
                  },
                },
              },
            },
          },
          'poe2',
        ).suggestedName,
      ).toBe('傳奇');

      expect(
        extractQueryMetadata(
          {
            query: {
              filters: {
                type_filters: {
                  filters: {
                    rarity: { option: 'rare' },
                  },
                },
              },
            },
          },
          'poe1',
        ).suggestedName,
      ).toBe('稀有');

      expect(
        extractQueryMetadata(
          {
            query: {
              filters: {
                type_filters: {
                  filters: {
                    rarity: { option: 'magic' },
                  },
                },
              },
            },
          },
          'poe1',
        ).suggestedName,
      ).toBe('魔法');

      expect(
        extractQueryMetadata(
          {
            query: {
              filters: {
                type_filters: {
                  filters: {
                    rarity: { option: 'normal' },
                  },
                },
              },
            },
          },
          'poe1',
        ).suggestedName,
      ).toBe('一般');
    });

    it('Branch B: 同時有 category 與 rarity -> "${category} ${rarity}"', () => {
      const meta = extractQueryMetadata(
        {
          query: {
            filters: {
              type_filters: {
                filters: {
                  category: { option: 'armour.chest' },
                  rarity: { option: 'unique' },
                },
              },
            },
          },
        },
        'poe2',
      );
      expect(meta.suggestedName).toBe('胸甲 傳奇');
    });

    it('Disabled 契約：category.disabled === true 時視為未生效', () => {
      // category disabled + rarity active -> 只剩 rarity
      expect(
        extractQueryMetadata(
          {
            query: {
              filters: {
                type_filters: {
                  filters: {
                    category: { option: 'armour.chest', disabled: true },
                    rarity: { option: 'unique' },
                  },
                },
              },
            },
          },
          'poe2',
        ).suggestedName,
      ).toBe('傳奇');

      // 僅 category 且 disabled -> 空字串
      expect(
        extractQueryMetadata(
          {
            query: {
              filters: {
                type_filters: {
                  filters: {
                    category: { option: 'armour.chest', disabled: true },
                  },
                },
              },
            },
          },
          'poe2',
        ).suggestedName,
      ).toBe('');
    });

    it('Disabled 契約：rarity.disabled === true 時視為未生效（Branch A 與 Branch B）', () => {
      // Branch A: name + type + disabled rarity -> 不附加 rarity
      expect(
        extractQueryMetadata(
          {
            query: {
              name: '魔血',
              type: '重型腰帶',
              filters: {
                type_filters: {
                  filters: {
                    rarity: { option: 'unique', disabled: true },
                  },
                },
              },
            },
          },
          'poe2',
        ).suggestedName,
      ).toBe('魔血 (重型腰帶)');

      // Branch B: active category + disabled rarity -> 只剩 category
      expect(
        extractQueryMetadata(
          {
            query: {
              filters: {
                type_filters: {
                  filters: {
                    category: { option: 'armour.chest' },
                    rarity: { option: 'unique', disabled: true },
                  },
                },
              },
            },
          },
          'poe2',
        ).suggestedName,
      ).toBe('胸甲');

      // Branch B: 僅 rarity 且 disabled -> 空字串
      expect(
        extractQueryMetadata(
          {
            query: {
              filters: {
                type_filters: {
                  filters: {
                    rarity: { option: 'unique', disabled: true },
                  },
                },
              },
            },
          },
          'poe2',
        ).suggestedName,
      ).toBe('');
    });

    it('Disabled 契約：type_filters.disabled === true 時整個分類/稀有度群組視為未生效', () => {
      // Branch B: type_filters 群組停用但內部殘留 category 與 rarity option -> 空字串
      expect(
        extractQueryMetadata(
          {
            query: {
              filters: {
                type_filters: {
                  disabled: true,
                  filters: {
                    category: { option: 'armour.chest' },
                    rarity: { option: 'magic' },
                  },
                },
              },
            },
          },
          'poe1',
        ).suggestedName,
      ).toBe('');

      // Branch A: name + type + type_filters 群組停用 -> 僅保留 name (type)，不附加殘留 rarity
      expect(
        extractQueryMetadata(
          {
            query: {
              name: '魔血',
              type: '重型腰帶',
              filters: {
                type_filters: {
                  disabled: true,
                  filters: {
                    rarity: { option: 'magic' },
                  },
                },
              },
            },
          },
          'poe1',
        ).suggestedName,
      ).toBe('魔血 (重型腰帶)');
    });

    it('無 name/type/category/rarity，只有 stats -> suggestedName === ""', () => {
      const meta = extractQueryMetadata({
        query: {
          stats: [
            {
              filters: [{ id: 'explicit.stat_123', value: { min: 20 } }],
            },
          ],
        },
      });
      expect(meta.suggestedName).toBe('');
    });

    it('完全空條件 -> suggestedName === ""', () => {
      const meta = extractQueryMetadata({ query: {} });
      expect(meta.suggestedName).toBe('');
      expect(meta.stats).toEqual([]);
      expect(meta.filters).toEqual([]);
    });

    describe('effective filter & grouping contract', () => {
      it('stat group disabled -> children 全數排除', () => {
        const meta = extractQueryMetadata({
          query: {
            stats: [
              {
                disabled: true,
                filters: [
                  { id: 'explicit.stat_1', value: { min: 10 } },
                  { id: 'explicit.stat_2', value: { min: 20 } },
                ],
              },
              {
                disabled: false,
                filters: [{ id: 'explicit.stat_3', value: { min: 30 } }],
              },
            ],
          },
        });
        expect(meta.stats).toHaveLength(1);
        expect(meta.stats[0].id).toBe('explicit.stat_3');
      });

      it('individual stat disabled -> 排除', () => {
        const meta = extractQueryMetadata({
          query: {
            stats: [
              {
                filters: [
                  { id: 'explicit.stat_1', value: { min: 10 }, disabled: true },
                  { id: 'explicit.stat_2', value: { min: 20 } },
                ],
              },
            ],
          },
        });
        expect(meta.stats).toHaveLength(1);
        expect(meta.stats[0].id).toBe('explicit.stat_2');
      });

      it('filter section disabled -> section children 全數排除', () => {
        const meta = extractQueryMetadata({
          query: {
            filters: {
              armour_filters: {
                disabled: true,
                filters: {
                  ar: { min: 500 },
                  es: { min: 100 },
                },
              },
              trade_filters: {
                filters: {
                  price: { min: 10, option: 'chaos' },
                },
              },
            },
          },
        });
        expect(meta.filters).toHaveLength(1);
        expect(meta.filters[0]).toEqual({
          sectionKey: 'trade_filters',
          fieldKey: 'price',
          value: { min: 10, option: 'chaos' },
        });
      });

      it('filter section.filters disabled -> section children 全數排除', () => {
        const meta = extractQueryMetadata({
          query: {
            filters: {
              armour_filters: {
                filters: {
                  disabled: true,
                  ar: { min: 500 },
                },
              },
            },
          },
        });
        expect(meta.filters).toHaveLength(0);
      });

      it('query.filters root disabled -> filters 全數排除', () => {
        const meta = extractQueryMetadata({
          query: {
            filters: {
              disabled: true,
              trade_filters: {
                filters: {
                  price: { min: 10, option: 'chaos' },
                },
              },
            },
          },
        });
        expect(meta.filters).toHaveLength(0);
      });

      it('individual filter disabled -> 排除（包含節點 disabled、殘留舊值與 option 內部 disabled）', () => {
        const meta = extractQueryMetadata({
          query: {
            filters: {
              misc_filters: {
                filters: {
                  ilvl: { min: 85, disabled: true },
                  corrupted: { option: 'true' },
                  gem_level: { option: { option: '20', disabled: true } },
                  empty_node: { disabled: false },
                },
              },
            },
          },
        });
        expect(meta.filters).toHaveLength(1);
        expect(meta.filters[0]).toEqual({
          sectionKey: 'misc_filters',
          fieldKey: 'corrupted',
          value: { option: 'true' },
        });
      });

      it('active filters 保留正確 section key / field key', () => {
        const meta = extractQueryMetadata(sampleQuery);
        expect(meta.filters).toEqual([
          {
            sectionKey: 'trade_filters',
            fieldKey: 'price',
            value: { min: 50, option: 'divine' },
          },
        ]);
      });

      it('PoE1 / PoE2 metadata contract 一致', () => {
        const query = {
          query: {
            stats: [
              {
                filters: [{ id: 'explicit.stat_1', value: { min: 10 } }],
              },
            ],
            filters: {
              trade_filters: {
                filters: {
                  price: { min: 1, option: 'exalted' },
                },
              },
            },
          },
        };
        const metaPoe1 = extractQueryMetadata(query, 'poe1');
        const metaPoe2 = extractQueryMetadata(query, 'poe2');

        expect(metaPoe1.stats).toEqual(metaPoe2.stats);
        expect(metaPoe1.filters).toEqual(metaPoe2.filters);
        expect(metaPoe1.filters[0]).toHaveProperty('sectionKey', 'trade_filters');
        expect(metaPoe1.filters[0]).toHaveProperty('fieldKey', 'price');
        expect(metaPoe1.filters[0]).toHaveProperty('value');
      });

      it('enabled 巢狀 option 正確納入 metadata，disabled 巢狀 option 徹底排除', () => {
        const meta = extractQueryMetadata({
          query: {
            filters: {
              misc_filters: {
                filters: {
                  gem_level: { option: { option: '20', disabled: false } },
                  corrupted: { option: { option: 'true', disabled: true } },
                  ilvl: { min: 80, option: { option: 'any', disabled: false } },
                },
              },
            },
          },
        });

        // corrupted (disabled nested option) 必須被排除
        // gem_level 與 ilvl (enabled nested option) 必須進入 metadata
        expect(meta.filters).toHaveLength(2);
        expect(meta.filters).toEqual([
          {
            sectionKey: 'misc_filters',
            fieldKey: 'gem_level',
            value: { option: { option: '20', disabled: false } },
          },
          {
            sectionKey: 'misc_filters',
            fieldKey: 'ilvl',
            value: { min: 80, option: { option: 'any', disabled: false } },
          },
        ]);
      });
    });
  });
});
