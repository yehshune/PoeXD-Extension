import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isShardCompatible } from '@/utils/game-data-shard-compat';
import {
  ensureAffixLexiconLoaded,
  isLocaleShardCached,
  resetAffixLexiconCacheForTests,
  type LocaleStatsShard,
  type ModsTiersArtifact,
} from '@/utils/affix-lexicon';
import {
  ensureItemShardLoaded,
  setMockItemShards,
  translateItemName,
} from '@/utils/trade-stat-dictionary';
import { resetI18nStateForTests, setActiveDisplayLocale } from '@/utils/i18n';

const MODS_TIERS: ModsTiersArtifact = {
  patch: '0.5.5.7',
  typeTable: [['ring']],
  groups: ['+# to maximum Life'],
  tiers: [
    {
      modId: 'Life1',
      level: 1,
      params: [[10, 19]],
      values: [['10', '19']],
      groupIdx: 0,
      typeIdx: 0,
      affinities: [],
      generation_type: 'prefix',
      statIds: ['explicit.stat_3299347043'],
    },
  ],
};

const statsShard = (patch: string, tierCount = 1): LocaleStatsShard => ({
  patch,
  templates: ['{0:+d} 最大生命'],
  tierTemplates: Array.from({ length: tierCount }, () => 0),
  statTemplates: { 'explicit.stat_3299347043': 0 },
});

function stubFetch(routes: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const match = Object.keys(routes).find((suffix) => url.endsWith(suffix));
      return match
        ? new Response(JSON.stringify(routes[match]), { status: 200 })
        : new Response('{}', { status: 404 });
    }),
  );
}

describe('isShardCompatible', () => {
  it('requires equal length and, when both are present, equal patch', () => {
    expect(isShardCompatible({ patch: '1', length: 3 }, { patch: '1', length: 3 })).toBe(true);
    expect(isShardCompatible({ patch: '1', length: 3 }, { patch: '2', length: 3 })).toBe(false);
    expect(isShardCompatible({ patch: '1', length: 3 }, { patch: '1', length: 4 })).toBe(false);
    // 舊資料或測試資料沒有 patch 時只比長度
    expect(isShardCompatible({ length: 3 }, { patch: '1', length: 3 })).toBe(true);
  });
});

describe('Game data shard compatibility at load time', () => {
  beforeEach(() => {
    resetI18nStateForTests('zh-TW');
    resetAffixLexiconCacheForTests();
    setMockItemShards('poe2', null);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('rejects a stats shard built from a different patch than mods-tiers.json', async () => {
    stubFetch({
      'poe2/mods-tiers.json': MODS_TIERS,
      'poe2/locales/zh-TW/stats.json': statsShard('0.5.4.0'),
      'poe2/locales/en/stats.json': statsShard('0.5.5.7'),
    });
    await ensureAffixLexiconLoaded('poe2');
    expect(isLocaleShardCached('poe2', 'zh-TW')).toBe(false);
    expect(isLocaleShardCached('poe2', 'en')).toBe(true);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('stats.json (zh-TW)'));
  });

  it('ignores an item shard that does not align with the en shard and falls back to English', async () => {
    stubFetch({
      'poe2/locales/en/items.json': { patch: '0.5.5.7', items: ['Chaos Orb', 'Divine Orb'] },
      'poe2/locales/zh-TW/items.json': { patch: '0.5.5.7', items: ['混沌石', '神聖石'] },
      'poe2/locales/zh-CN/items.json': { patch: '0.5.4.0', items: ['神圣石', '混沌石'] },
    });
    await Promise.all([
      ensureItemShardLoaded('poe2', 'zh-CN'),
      ensureItemShardLoaded('poe2', 'zh-TW'),
    ]);

    expect(translateItemName('Chaos Orb', 'poe2')).toBe('混沌石');
    setActiveDisplayLocale('zh-CN');
    // zh-CN 分片被拒絕：不可顯示錯位的「神圣石」，改退回 UI 語系或英文
    expect(translateItemName('Chaos Orb', 'poe2')).not.toBe('神圣石');
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('items.json (zh-CN)'));
  });
});
