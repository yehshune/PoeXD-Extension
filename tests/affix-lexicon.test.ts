import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { nextTick, ref } from 'vue';
import {
  ensureAffixLexiconLoaded,
  resolveFallbackQueryForUnmatchedMod,
  resetAffixLexiconCacheForTests,
  type LocaleStatsShard,
  type ModsTiersArtifact,
} from '@/utils/affix-lexicon';
import {
  resolveDisplayLocale,
  resolvePageLocale,
  resolveUiLocale,
} from '@/utils/locale-resolution';
import { setActiveDisplayLocalePreference } from '@/utils/i18n';
import {
  loadTradeDictionaries,
  translateStat,
  translateStatLines,
} from '@/utils/trade-stat-dictionary';
import { createTierDomainService } from '@/entrypoints/content/logic/tier-domain-service';
import { useFilterData } from '@/components/sidebar/composables/useFilterData';

describe('Seam 2A: Page Locale & Affix Display Locale resolution', () => {
  it('resolves pageLocale from official hostnames and subdomains', () => {
    expect(resolvePageLocale({ hostname: 'www.pathofexile.com' })).toBe('en');
    expect(resolvePageLocale({ hostname: 'pathofexile.tw' })).toBe('zh-TW');
    expect(resolvePageLocale({ hostname: 'www.pathofexile.tw' })).toBe('zh-TW');
    expect(resolvePageLocale({ hostname: 'poe.game.qq.com' })).toBe('zh-CN');
    expect(resolvePageLocale({ hostname: 'ru.pathofexile.com' })).toBe('ru');
    expect(resolvePageLocale({ hostname: 'kr.pathofexile.com' })).toBe('ko');
    expect(resolvePageLocale({ hostname: 'jp.pathofexile.com' })).toBe('ja');
    expect(resolvePageLocale({ hostname: 'de.pathofexile.com' })).toBe('de');
    expect(resolvePageLocale({ hostname: 'fr.pathofexile.com' })).toBe('fr');
    expect(resolvePageLocale({ hostname: 'es.pathofexile.com' })).toBe('es');
    expect(resolvePageLocale({ hostname: 'br.pathofexile.com' })).toBe('pt');
    expect(resolvePageLocale({ hostname: 'pt.pathofexile.com' })).toBe('pt');
    expect(resolvePageLocale({ hostname: 'th.pathofexile.com' })).toBe('th');
  });

  it('auto-resolves displayLocale on www.pathofexile.com to zh-TW / zh-CN for Chinese browser locales while keeping pageLocale as en', () => {
    const twContext = { hostname: 'www.pathofexile.com', browserLocale: 'zh-TW' };
    expect(resolvePageLocale(twContext)).toBe('en');
    expect(resolveDisplayLocale('auto', twContext)).toBe('zh-TW');

    expect(
      resolveDisplayLocale('auto', { hostname: 'www.pathofexile.com', browserLocale: 'zh-HK' }),
    ).toBe('zh-TW');

    const cnContext = { hostname: 'www.pathofexile.com', browserLocale: 'zh-CN' };
    expect(resolvePageLocale(cnContext)).toBe('en');
    expect(resolveDisplayLocale('auto', cnContext)).toBe('zh-CN');

    expect(
      resolveDisplayLocale('auto', { hostname: 'www.pathofexile.com', browserLocale: 'zh-SG' }),
    ).toBe('zh-CN');

    // Non-Chinese browser on English site keeps pageLocale ('en')
    expect(
      resolveDisplayLocale('auto', { hostname: 'www.pathofexile.com', browserLocale: 'en-US' }),
    ).toBe('en');
    expect(
      resolveDisplayLocale('auto', { hostname: 'www.pathofexile.com', browserLocale: 'ja' }),
    ).toBe('en');
  });

  it('auto-resolves displayLocale to localized pageLocale on non-English Trade subdomains and regional hosts', () => {
    expect(
      resolveDisplayLocale('auto', { hostname: 'ru.pathofexile.com', browserLocale: 'zh-TW' }),
    ).toBe('ru');
    expect(
      resolveDisplayLocale('auto', { hostname: 'jp.pathofexile.com', browserLocale: 'en-US' }),
    ).toBe('ja');
    expect(
      resolveDisplayLocale('auto', { hostname: 'pathofexile.tw', browserLocale: 'en-US' }),
    ).toBe('zh-TW');
    expect(
      resolveDisplayLocale('auto', { hostname: 'poe.game.qq.com', browserLocale: 'en-US' }),
    ).toBe('zh-CN');
  });

  it('honors manual affixDisplayLocale preference override over auto-detection', () => {
    expect(
      resolveDisplayLocale('en', { hostname: 'www.pathofexile.com', browserLocale: 'zh-TW' }),
    ).toBe('en');
    expect(
      resolveDisplayLocale('ja', { hostname: 'www.pathofexile.com', browserLocale: 'zh-TW' }),
    ).toBe('ja');
    expect(
      resolveDisplayLocale('zh-TW', { hostname: 'ru.pathofexile.com', browserLocale: 'ru' }),
    ).toBe('zh-TW');
  });

  it('resolves displayLocale and uiLocale across Trade pages, standalone extension pages, and non-UI affix locales', () => {
    // Trade pages with auto
    expect(
      resolveDisplayLocale('auto', { hostname: 'pathofexile.tw', browserLocale: 'en-US' }),
    ).toBe('zh-TW');
    expect(resolveUiLocale('zh-TW')).toBe('zh-TW');

    expect(
      resolveDisplayLocale('auto', { hostname: 'poe.game.qq.com', browserLocale: 'en-US' }),
    ).toBe('zh-CN');
    expect(resolveUiLocale('zh-CN')).toBe('zh-CN');

    // Non-Chinese / non-English Trade subdomains -> affix locale ja/ko, UI fallback en
    const jaResolved = resolveDisplayLocale('auto', {
      hostname: 'jp.pathofexile.com',
      browserLocale: 'zh-TW',
    });
    expect(jaResolved).toBe('ja');
    expect(resolveUiLocale(jaResolved)).toBe('en');

    const koResolved = resolveDisplayLocale('auto', {
      hostname: 'kr.pathofexile.com',
      browserLocale: 'zh-CN',
    });
    expect(koResolved).toBe('ko');
    expect(resolveUiLocale(koResolved)).toBe('en');

    // Standalone extension pages (no Trade host) -> normalizes browserLocale to SupportedLocale, ignoring documentElement.lang
    expect(resolveDisplayLocale('auto', { hostname: '', browserLocale: 'zh-TW' })).toBe('zh-TW');
    expect(resolveDisplayLocale('auto', { hostname: '', browserLocale: 'zh-CN' })).toBe('zh-CN');
    expect(resolveDisplayLocale('auto', { hostname: '', browserLocale: 'en-US' })).toBe('en');
    expect(resolveDisplayLocale('auto', { hostname: '', browserLocale: 'ja-JP' })).toBe('ja');
    expect(
      resolveUiLocale(resolveDisplayLocale('auto', { hostname: '', browserLocale: 'ja-JP' })),
    ).toBe('en');
    expect(resolveDisplayLocale('auto', { hostname: '', browserLocale: 'sv-SE' })).toBe('en');

    // Pinned locales
    expect(resolveDisplayLocale('ko', { hostname: 'pathofexile.tw', browserLocale: 'zh-TW' })).toBe(
      'ko',
    );
    expect(resolveUiLocale('ko')).toBe('en');
    expect(resolveUiLocale('en')).toBe('en');
  });
});

const SAMPLE_MODS_TIERS: ModsTiersArtifact = {
  typeTable: [
    ['helmet', 'body-armour'],
    ['one-hand-sword', 'bow'],
  ],
  groups: [
    '# to maximum life',
    'adds # to # fire damage',
    '#% increased attack speed|||||+# to accuracy rating',
  ],
  tiers: [
    {
      modId: 'MaxLife1',
      level: 1,
      params: [[10, 19]],
      values: [['10', '19']],
      groupIdx: 0,
      typeIdx: 0,
      affinities: ['normal'],
      generation_type: '1',
      id: 'explicit.stat_3299347043',
    },
    {
      modId: 'MaxLife2',
      level: 12,
      params: [[20, 29]],
      values: [['20', '29']],
      groupIdx: 0,
      typeIdx: 0,
      affinities: ['normal'],
      generation_type: '1',
      id: 'explicit.stat_3299347043',
    },
    {
      modId: 'FlatFire1',
      level: 8,
      params: [
        [5, 10],
        [15, 25],
      ],
      values: [
        ['5', '10'],
        ['15', '25'],
      ],
      groupIdx: 1,
      typeIdx: 1,
      affinities: ['normal'],
      generation_type: '1',
      id: 'explicit.stat_fire',
    },
    {
      modId: 'HybridSpeedAcc1',
      level: 15,
      params: [
        [8, 12],
        [50, 100],
      ],
      values: [
        ['8', '12'],
        ['50', '100'],
      ],
      groupIdx: 2,
      typeIdx: 1,
      affinities: ['normal'],
      generation_type: '2',
      ids: ['explicit.stat_speed', 'explicit.stat_acc'],
    },
  ],
};

const SHARD_EN: LocaleStatsShard = {
  templates: [
    '{0:+d} to maximum Life',
    'Adds {0:d} to {1:d} Fire Damage',
    '{0:d}% increased Attack Speed|||||{1:+d} to Accuracy Rating',
  ],
  tierTemplates: [0, 0, 1, 2],
  statTemplates: {
    'explicit.stat_3299347043': 0,
    'explicit.stat_fire': 1,
    'explicit.stat_speed': 2,
    'explicit.stat_acc': 2,
  },
};

const SHARD_ZH_TW: LocaleStatsShard = {
  templates: [
    '{0:+d} 最大生命',
    '附加 {0:d} 至 {1:d} 火焰傷害',
    '增加 {0:d}% 攻擊速度|||||{1:+d} 命中值',
  ],
  tierTemplates: [0, 0, 1, 2],
  statTemplates: {
    'explicit.stat_3299347043': 0,
    'explicit.stat_fire': 1,
    'explicit.stat_speed': 2,
    'explicit.stat_acc': 2,
  },
};

const SHARD_ZH_CN: LocaleStatsShard = {
  templates: [
    '{0:+d} 最大生命(簡)',
    '附加 {0:d} 至 {1:d} 火焰傷害(簡)',
    '攻擊速度提高 {0:d}%|||||{1:+d} 命中值(簡)',
  ],
  tierTemplates: [0, 0, 1, 2],
  statTemplates: {
    'explicit.stat_3299347043': 0,
    'explicit.stat_fire': 1,
    'explicit.stat_speed': 2,
    'explicit.stat_acc': 2,
  },
};

const SHARD_RU: LocaleStatsShard = {
  templates: [
    '{0:+d} к максимуму здоровья',
    'Добавляет от {0:d} до {1:d} урона от огня',
    '{0:d}% повышение скорости атаки|||||{1:+d} к меткости',
  ],
  tierTemplates: [0, 0, 1, 2],
  statTemplates: {
    'explicit.stat_3299347043': 0,
    'explicit.stat_fire': 1,
    'explicit.stat_speed': 2,
    'explicit.stat_acc': 2,
  },
};

describe('Seam 2B: Unified Affix Lexicon deduplication, prefix fallback & localized tier service', () => {
  beforeEach(() => {
    resetAffixLexiconCacheForTests();
    vi.restoreAllMocks();
  });

  it('deduplicates mods-tiers.json and locale shard fetches across loadTradeDictionaries, tierDomainService, and ensureAffixLexiconLoaded', async () => {
    const requestedUrls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        requestedUrls.push(url);
        if (url.endsWith('poe2/mods-tiers.json')) {
          return new Response(JSON.stringify(SAMPLE_MODS_TIERS), { status: 200 });
        }
        if (url.endsWith('poe2/locales/zh-TW/stats.json')) {
          return new Response(JSON.stringify(SHARD_ZH_TW), { status: 200 });
        }
        if (url.endsWith('poe2/locales/en/stats.json')) {
          return new Response(JSON.stringify(SHARD_EN), { status: 200 });
        }
        if (url.endsWith('poe2/locales/ru/stats.json')) {
          return new Response(JSON.stringify(SHARD_RU), { status: 200 });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      }),
    );

    setActiveDisplayLocalePreference('zh-TW');
    const tierService = createTierDomainService('poe2');

    await Promise.all([
      loadTradeDictionaries('poe2'),
      tierService.loadModsData(0, () => true),
      ensureAffixLexiconLoaded('poe2'),
    ]);

    const tiersFetches = requestedUrls.filter((u) => u.endsWith('poe2/mods-tiers.json'));
    const zhTwFetches = requestedUrls.filter((u) => u.endsWith('poe2/locales/zh-TW/stats.json'));
    const enFetches = requestedUrls.filter((u) => u.endsWith('poe2/locales/en/stats.json'));

    expect(tiersFetches).toHaveLength(1);
    expect(zhTwFetches).toHaveLength(1);
    expect(enFetches).toHaveLength(1);
    // Legacy files must never be fetched
    expect(requestedUrls.some((u) => u.includes('mods-data.json'))).toBe(false);
    expect(requestedUrls.some((u) => u.includes('mods-id-data.json'))).toBe(false);
  });

  it('applies unified prefix fallback (fractured, desecrated, enchant, rune, crafted, veiled -> explicit) in both translateStat and findModTiersByStatId', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('poe2/mods-tiers.json')) {
          return new Response(JSON.stringify(SAMPLE_MODS_TIERS), { status: 200 });
        }
        if (url.endsWith('poe2/locales/zh-TW/stats.json')) {
          return new Response(JSON.stringify(SHARD_ZH_TW), { status: 200 });
        }
        if (url.endsWith('poe2/locales/en/stats.json')) {
          return new Response(JSON.stringify(SHARD_EN), { status: 200 });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      }),
    );

    setActiveDisplayLocalePreference('zh-TW');
    const tierService = createTierDomainService('poe2');
    await tierService.loadModsData(0, () => true);

    const prefixes = [
      'explicit',
      'fractured',
      'desecrated',
      'enchant',
      'rune',
      'crafted',
      'veiled',
    ];
    for (const prefix of prefixes) {
      const statId = `${prefix}.stat_3299347043`;
      expect(translateStat(statId, 'poe2')).toBe('# 最大生命');
      const tiers = tierService.findModTiersByStatId(statId);
      expect(tiers).toHaveLength(2);
      expect(tiers?.[0].displayKey).toBe('+(10-19) 最大生命');
      expect(tiers?.[1].displayKey).toBe('+(20-29) 最大生命');
    }
  });

  it('renders translateStat, translateStatLines, and tierDomainService groups in the active displayLocale and updates live when locale changes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('poe2/mods-tiers.json')) {
          return new Response(JSON.stringify(SAMPLE_MODS_TIERS), { status: 200 });
        }
        if (url.endsWith('poe2/locales/zh-TW/stats.json')) {
          return new Response(JSON.stringify(SHARD_ZH_TW), { status: 200 });
        }
        if (url.endsWith('poe2/locales/zh-CN/stats.json')) {
          return new Response(JSON.stringify(SHARD_ZH_CN), { status: 200 });
        }
        if (url.endsWith('poe2/locales/en/stats.json')) {
          return new Response(JSON.stringify(SHARD_EN), { status: 200 });
        }
        if (url.endsWith('poe2/locales/ru/stats.json')) {
          return new Response(JSON.stringify(SHARD_RU), { status: 200 });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      }),
    );

    const tierService = createTierDomainService('poe2');
    setActiveDisplayLocalePreference('zh-TW');
    await tierService.loadModsData(0, () => true);

    expect(translateStat('explicit.stat_3299347043', 'poe2')).toBe('# 最大生命');
    expect(translateStatLines('explicit.stat_speed', 'poe2')).toEqual([
      '增加 #% 攻擊速度',
      '# 命中值',
    ]);

    const zhTiers = tierService.findModTiersByStatId('explicit.stat_3299347043')!;
    const zhGroups = tierService.groupTiersByMod(zhTiers);
    expect(zhGroups[0].label).toBe('# 最大生命');
    expect(tierService.parseTierValues(zhTiers[0], 'explicit.stat_3299347043')).toEqual({
      rangeText: ' (10 ~ 19)',
      valMin: '10',
      valMax: '19',
      isRange: true,
    });

    // Switch to Russian ('ru')
    setActiveDisplayLocalePreference('ru');
    await ensureAffixLexiconLoaded('poe2');
    expect(translateStat('explicit.stat_3299347043', 'poe2')).toBe('# к максимуму здоровья');
    expect(translateStatLines('explicit.stat_speed', 'poe2')).toEqual([
      '#% повышение скорости атаки',
      '# к меткости',
    ]);
    const ruTiers = tierService.findModTiersByStatId('explicit.stat_3299347043')!;
    expect(ruTiers[0].displayKey).toBe('+(10-19) к максимуму здоровья');
    expect(tierService.groupTiersByMod(ruTiers)[0].label).toBe('# к максимуму здоровья');

    // Switch to Simplified Chinese ('zh-CN')
    setActiveDisplayLocalePreference('zh-CN');
    await ensureAffixLexiconLoaded('poe2');
    expect(translateStat('explicit.stat_3299347043', 'poe2')).toBe('# 最大生命(簡)');
  });

  it('exposes stat_descriptions value-handler converted tier ranges from shipped poe2 data (per_minute_to_per_second regression)', async () => {
    const readShipped = (relPath: string) =>
      readFileSync(resolvePath(process.cwd(), 'public/json', relPath), 'utf8');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        for (const relPath of [
          'poe2/mods-tiers.json',
          'poe2/locales/en/stats.json',
          'poe2/locales/zh-TW/stats.json',
        ]) {
          if (url.endsWith(relPath)) return new Response(readShipped(relPath), { status: 200 });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      }),
    );

    setActiveDisplayLocalePreference('zh-TW');
    const tierService = createTierDomainService('poe2');
    await tierService.loadModsData(0, () => true);

    // Allies in your Presence Regenerate # Life per second：底層以每分鐘儲存，顯示需換算為每秒
    const statId = 'explicit.stat_4010677958';
    const tiers = tierService.findModTiersByStatId(statId)!;
    expect(tiers.length).toBeGreaterThan(0);
    const t2 = tiers.find((t: any) => t.level === '68')!;
    expect(t2).toBeTruthy();
    expect(t2.values).toEqual([['23.1', '29']]);
    expect(t2.key).toBe('allies in your presence regenerate (23.1-29) life per second');
    expect(tierService.parseTierValues(t2, statId)).toEqual({
      rangeText: ' (23.1 ~ 29)',
      valMin: '23.1',
      valMax: '29',
      isRange: true,
    });
  });
});

describe('Seam 2C: useFilterData multilingual search, lazy pageLocale fallbackQuery & live locale switching', () => {
  beforeEach(() => {
    resetAffixLexiconCacheForTests();
    vi.restoreAllMocks();
    (globalThis as any).chrome = {
      runtime: {
        getURL: (p: string) => p,
      },
      storage: {
        local: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => {}),
        },
        onChanged: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
      },
    };
  });

  it('preloads both zh-TW and en for Chinese displayLocale and exposes bilingual key + displayKey/displayTemplate on ModGroup', async () => {
    const requestedUrls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        requestedUrls.push(url);
        if (url.endsWith('poe2/mods-tiers.json')) {
          return new Response(JSON.stringify(SAMPLE_MODS_TIERS), { status: 200 });
        }
        if (url.endsWith('poe2/locales/zh-TW/stats.json')) {
          return new Response(JSON.stringify(SHARD_ZH_TW), { status: 200 });
        }
        if (url.endsWith('poe2/locales/en/stats.json')) {
          return new Response(JSON.stringify(SHARD_EN), { status: 200 });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      }),
    );

    setActiveDisplayLocalePreference('zh-TW');
    const selectedType = ref('helmet');
    const filterData = useFilterData('poe2', selectedType);
    await filterData.loadData();

    expect(requestedUrls.filter((u) => u.endsWith('poe2/locales/zh-TW/stats.json'))).toHaveLength(
      1,
    );
    expect(requestedUrls.filter((u) => u.endsWith('poe2/locales/en/stats.json'))).toHaveLength(1);

    const groups = filterData.currentTypeGroups.value;
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('# to maximum life');
    expect(groups[0].displayTemplate).toBe('# 最大生命');
    expect(groups[0].displayKey).toBe('+(10-19) 最大生命');
  });

  it('fetches only locales/{displayLocale}/stats.json when displayLocale is non-Chinese (e.g. ru)', async () => {
    const requestedUrls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        requestedUrls.push(url);
        if (url.endsWith('poe2/mods-tiers.json')) {
          return new Response(JSON.stringify(SAMPLE_MODS_TIERS), { status: 200 });
        }
        if (url.endsWith('poe2/locales/ru/stats.json')) {
          return new Response(JSON.stringify(SHARD_RU), { status: 200 });
        }
        if (url.endsWith('poe2/locales/en/stats.json')) {
          return new Response(JSON.stringify(SHARD_EN), { status: 200 });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      }),
    );

    setActiveDisplayLocalePreference('ru');
    const selectedType = ref('helmet');
    const filterData = useFilterData('poe2', selectedType);
    await filterData.loadData();

    expect(requestedUrls.filter((u) => u.endsWith('poe2/locales/ru/stats.json'))).toHaveLength(1);
    // Must NOT eagerly fetch en when displayLocale is ru
    expect(requestedUrls.filter((u) => u.endsWith('poe2/locales/en/stats.json'))).toHaveLength(0);

    const groups = filterData.currentTypeGroups.value;
    expect(groups).toHaveLength(1);
    expect(groups[0].displayTemplate).toBe('# к максимуму здоровья');
    expect(groups[0].displayKey).toBe('+(10-19) к максимуму здоровья');
  });

  it('resolves unmatched affix fallbackQuery without extra fetch when displayLocale === pageLocale, and lazily fetches pageLocale shard when displayLocale !== pageLocale', async () => {
    const requestedUrls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        requestedUrls.push(url);
        if (url.endsWith('poe2/mods-tiers.json')) {
          return new Response(JSON.stringify(SAMPLE_MODS_TIERS), { status: 200 });
        }
        if (url.endsWith('poe2/locales/zh-TW/stats.json')) {
          return new Response(JSON.stringify(SHARD_ZH_TW), { status: 200 });
        }
        if (url.endsWith('poe2/locales/en/stats.json')) {
          return new Response(JSON.stringify(SHARD_EN), { status: 200 });
        }
        if (url.endsWith('poe2/locales/ru/stats.json')) {
          return new Response(JSON.stringify(SHARD_RU), { status: 200 });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      }),
    );

    setActiveDisplayLocalePreference('zh-TW');
    await ensureAffixLexiconLoaded('poe2');

    // Case 1: displayLocale === pageLocale ('zh-TW' on pathofexile.tw) -> zero extra fetch
    const countBeforeTw = requestedUrls.length;
    const twFallback = await resolveFallbackQueryForUnmatchedMod(
      'poe2',
      { key: '# to maximum life', displayTemplate: '# 最大生命', displayKey: '+(10-19) 最大生命' },
      '# to maximum life',
      { hostname: 'pathofexile.tw' },
    );
    expect(twFallback).toBe('最大生命');
    expect(requestedUrls.length).toBe(countBeforeTw);

    // Case 2: displayLocale = 'zh-TW' on ru.pathofexile.com (pageLocale = 'ru') -> lazily fetches ru shard
    const ruFallback = await resolveFallbackQueryForUnmatchedMod(
      'poe2',
      { key: '# to maximum life', displayTemplate: '# 最大生命', displayKey: '+(10-19) 最大生命' },
      '# to maximum life',
      { hostname: 'ru.pathofexile.com' },
    );
    expect(ruFallback).toBe('к максимуму здоровья');
    expect(requestedUrls.filter((u) => u.endsWith('poe2/locales/ru/stats.json'))).toHaveLength(1);
  });

  it('reactively updates useFilterData groups when affixDisplayLocale changes at runtime', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('poe2/mods-tiers.json')) {
          return new Response(JSON.stringify(SAMPLE_MODS_TIERS), { status: 200 });
        }
        if (url.endsWith('poe2/locales/zh-TW/stats.json')) {
          return new Response(JSON.stringify(SHARD_ZH_TW), { status: 200 });
        }
        if (url.endsWith('poe2/locales/en/stats.json')) {
          return new Response(JSON.stringify(SHARD_EN), { status: 200 });
        }
        if (url.endsWith('poe2/locales/ru/stats.json')) {
          return new Response(JSON.stringify(SHARD_RU), { status: 200 });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      }),
    );

    setActiveDisplayLocalePreference('zh-TW');
    const selectedType = ref('helmet');
    const filterData = useFilterData('poe2', selectedType);
    await filterData.loadData();

    expect(filterData.currentTypeGroups.value[0].displayTemplate).toBe('# 最大生命');

    // Switch locale to 'ru'
    setActiveDisplayLocalePreference('ru');
    await ensureAffixLexiconLoaded('poe2');
    await nextTick();

    expect(filterData.currentTypeGroups.value[0].displayTemplate).toBe('# к максимуму здоровья');
    expect(filterData.currentTypeGroups.value[0].displayKey).toBe('+(10-19) к максимуму здоровья');
  });
});
