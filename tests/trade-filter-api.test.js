import { describe, expect, it } from 'vitest';
import {
  LOCALE_REALM_HOSTS,
  buildArtifactFromApi,
  buildFiltersUrl,
  buildStatsUrl,
  extractPseudoStats,
  validateArtifact,
} from '../scripts/trade-filter-api.mjs';

const response = (overrides = {}) => ({
  result: [
    {
      id: 'status_filters',
      filters: [{ id: 'status', option: { options: [{ id: 'online', text: 'Online' }] } }],
    },
    {
      id: 'armour_filters',
      title: 'Armour Filters',
      filters: [
        { id: 'ar', text: 'Armour', tip: 'Includes base value', minMax: true },
        ...Array.from({ length: 10 }, (_, i) => ({ id: `f${i}`, text: `Field ${i}` })),
      ],
    },
    {
      id: 'trade_filters',
      title: 'Trade',
      filters: [
        {
          id: 'sale_type',
          text: 'Sale Type',
          option: {
            options: [
              { id: 'any', text: 'Any' },
              { id: null, text: 'Buyout or Fixed Price' },
              { id: 'unpriced', text: 'No Listed Price' },
            ],
          },
        },
      ],
    },
  ],
  ...overrides,
});

describe('trade filter API artifact', () => {
  it('builds per-locale realm URLs for both game versions', () => {
    expect(buildFiltersUrl('zh-TW', 'poe1')).toBe('https://pathofexile.tw/api/trade/data/filters');
    expect(buildFiltersUrl('pt', 'poe2')).toBe(
      'https://br.pathofexile.com/api/trade2/data/filters',
    );
    expect(Object.keys(LOCALE_REALM_HOSTS)).toHaveLength(11);
  });

  it('keys groups, fields and options by API id and keeps tips out of labels', () => {
    const artifact = buildArtifactFromApi(response(), { gameVersion: 'poe1', locale: 'en' });
    expect(artifact.groups).toEqual({ armour_filters: 'Armour Filters', trade_filters: 'Trade' });
    expect(artifact.fields.ar).toBe('Armour');
    expect(artifact.fields.status).toBeUndefined();
    expect(artifact.options.status).toEqual({ online: 'Online' });
    expect(artifact.options.sale_type).toEqual({
      any: 'Any',
      priced: 'Buyout or Fixed Price',
      unpriced: 'No Listed Price',
    });
  });

  it('does not map the null option to priced when priced is listed explicitly', () => {
    const data = response();
    data.result[2].filters[0].option.options = [
      { id: null, text: '任何' },
      { id: 'priced', text: '交易报盘或固定价' },
    ];
    const artifact = buildArtifactFromApi(data, { gameVersion: 'poe1', locale: 'zh-CN' });
    expect(artifact.options.sale_type).toEqual({ priced: '交易报盘或固定价' });
  });

  it('rejects a non-English locale whose labels are identical to en', () => {
    const en = buildArtifactFromApi(response(), { gameVersion: 'poe1', locale: 'en' });
    const ko = buildArtifactFromApi(response(), { gameVersion: 'poe1', locale: 'ko' });
    expect(() => validateArtifact(ko, en)).toThrow('網域可能回傳英文');
    expect(validateArtifact(en)).toBe(en);
  });

  it('rejects responses without enough fields', () => {
    const artifact = buildArtifactFromApi(
      { result: [{ id: 'a_filters', title: 'A', filters: [] }] },
      {
        gameVersion: 'poe1',
        locale: 'en',
      },
    );
    expect(() => validateArtifact(artifact)).toThrow('欄位只有 0 個');
  });

  describe('pseudo stats', () => {
    const statsResponse = {
      result: [
        {
          id: 'pseudo',
          label: 'Pseudo',
          entries: [
            { id: 'pseudo.pseudo_total_life', text: '+# total maximum Life', type: 'pseudo' },
            { id: 'pseudo.pseudo_count_elemental_resistances', text: '# Elemental  Resistances' },
            { id: 'pseudo.pseudo_empty', text: '' },
          ],
        },
        {
          id: 'explicit',
          entries: [{ id: 'explicit.stat_1', text: '# to Spirit', type: 'explicit' }],
        },
      ],
    };

    it('builds the stats URL next to the filters URL', () => {
      expect(buildStatsUrl('zh-CN', 'poe2')).toBe('https://poe.game.qq.com/api/trade2/data/stats');
    });

    it('keeps only pseudo entries with cleaned text, keyed by full stat id', () => {
      expect(extractPseudoStats(statsResponse)).toEqual({
        'pseudo.pseudo_total_life': '+# total maximum Life',
        'pseudo.pseudo_count_elemental_resistances': '# Elemental Resistances',
      });
    });

    it('rejects a stats response without a pseudo group', () => {
      expect(() => extractPseudoStats({ result: [] })).toThrow('pseudo');
    });

    it('adds pseudo stats to the artifact when a stats response is given', () => {
      const artifact = buildArtifactFromApi(response(), {
        gameVersion: 'poe2',
        locale: 'en',
        statsResponse,
      });
      expect(artifact.pseudoStats['pseudo.pseudo_total_life']).toBe('+# total maximum Life');
      expect(
        buildArtifactFromApi(response(), { gameVersion: 'poe2', locale: 'en' }).pseudoStats,
      ).toBeUndefined();
    });
  });
});
