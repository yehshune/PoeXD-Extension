import { describe, expect, it } from 'vitest';
import {
  MARKET_LOCALES,
  UI_DICTIONARY_SOURCES,
  buildStaticArtifact,
  buildStatsArtifact,
  buildUiArtifact,
  getUiDictionaryUrls,
  parseUiDictionary,
  validateStaticArtifact,
  validateStatsArtifact,
  validateUiArtifact,
} from '../scripts/market-translation-api.mjs';
import { buildStaticUrl } from '../scripts/trade-filter-api.mjs';

describe('parseUiDictionary', () => {
  it('解析官方 translate.*.js 的 __ 指派並處理跳脫的單引號', () => {
    const source = [
      '﻿',
      'var __ = {};',
      '',
      "__['Search Listed Items'] = '搜尋道具';",
      "__['You don\\'t have enough points!'] = '你沒有足夠的黯幣！';",
      "__['Back\\\\slash'] = '反斜線\\\\';",
    ].join('\n');
    expect(parseUiDictionary(source)).toEqual({
      'Search Listed Items': '搜尋道具',
      "You don't have enough points!": '你沒有足夠的黯幣！',
      'Back\\slash': '反斜線\\',
    });
  });

  it('略過官方未翻譯（值與鍵相同）與空值的條目', () => {
    const source = ['var __ = {};', "__['Warning!'] = 'Warning!';", "__['Empty'] = '';"].join('\n');
    expect(parseUiDictionary(source)).toEqual({});
  });

  it('遇到無法辨識的行就拒絕，避免格式改版時默默產出殘缺資料', () => {
    const source = ['var __ = {};', "__['A'] = 'B';", 'window.evil = 1;'].join('\n');
    expect(() => parseUiDictionary(source)).toThrow(/第 3 行/);
  });

  it('不接受雙引號或額外運算式', () => {
    expect(() => parseUiDictionary('__["A"] = "B";')).toThrow();
    expect(() => parseUiDictionary("__['A'] = 'B' + x;")).toThrow();
  });
});

describe('buildUiArtifact / validateUiArtifact', () => {
  it('兩個目標語系都有官方字典來源', () => {
    expect(MARKET_LOCALES).toEqual(['zh-TW', 'zh-CN']);
    expect(UI_DICTIONARY_SOURCES['zh-TW']).toBe('https://webtw.poecdn.com/js/translate.zh_TW.js');
    expect(UI_DICTIONARY_SOURCES['zh-CN']).toBe('https://poecdn.game.qq.com/js/translate.zh_CN.js');
  });

  it('國服字典有備援網址，台服只有主網址', () => {
    expect(getUiDictionaryUrls('zh-CN')).toEqual([
      'https://poecdn.game.qq.com/js/translate.zh_CN.js',
      'https://poe.game.qq.com/js/translate.zh_CN.js',
    ]);
    expect(getUiDictionaryUrls('zh-TW')).toEqual([
      'https://webtw.poecdn.com/js/translate.zh_TW.js',
    ]);
    expect(() => getUiDictionaryUrls('ja')).toThrow(/不支援/);
  });

  it('產生含來源與字串表的產物', () => {
    const artifact = buildUiArtifact("var __ = {};\n__['Search'] = '搜尋';", { locale: 'zh-TW' });
    expect(artifact).toEqual({
      schemaVersion: 1,
      locale: 'zh-TW',
      source: 'https://webtw.poecdn.com/js/translate.zh_TW.js',
      strings: { Search: '搜尋' },
    });
  });

  it('字串數過少時拒絕', () => {
    const artifact = buildUiArtifact("__['Search'] = '搜尋';", { locale: 'zh-CN' });
    expect(() => validateUiArtifact(artifact)).toThrow(/只有 1 個/);
  });
});

const statsResponse = (rows, extraGroups = []) => ({
  result: [
    {
      id: 'explicit',
      label: rows.label ?? 'Explicit',
      entries: rows.entries,
    },
    ...extraGroups,
  ],
});

describe('buildStatsArtifact', () => {
  const english = statsResponse({
    entries: [
      { id: 'explicit.stat_1', text: '+# to maximum Life', type: 'explicit' },
      { id: 'explicit.stat_2', text: 'Area has #% increased Experience', type: 'explicit' },
      { id: 'explicit.stat_2', text: 'Map has #% increased Experience', type: 'explicit' },
      {
        id: 'explicit.stat_3',
        text: 'Allocates #',
        type: 'explicit',
        option: {
          options: [
            { id: 1, text: 'Lesser' },
            { id: 2, text: 'Greater' },
          ],
        },
      },
      { id: 'explicit.stat_4', text: 'Line one\nLine two', type: 'explicit' },
    ],
  });

  it('en：以 id 為鍵，同 id 多次出現時依出現順序存成陣列，保留換行', () => {
    const artifact = buildStatsArtifact(english, { gameVersion: 'poe1', locale: 'en' });
    expect(artifact).toEqual({
      schemaVersion: 1,
      gameVersion: 'poe1',
      locale: 'en',
      source: 'www.pathofexile.com',
      labels: { explicit: 'Explicit' },
      stats: {
        'explicit.stat_1': '+# to maximum Life',
        'explicit.stat_2': ['Area has #% increased Experience', 'Map has #% increased Experience'],
        'explicit.stat_3': 'Allocates #',
        'explicit.stat_4': 'Line one\nLine two',
      },
      options: { 'explicit.stat_3': { 1: 'Lesser', 2: 'Greater' } },
    });
  });

  it('中文：只保留國際服存在的 id，出現次數與 en 不同的條目整筆略過', () => {
    const chinese = statsResponse({
      label: '外延',
      entries: [
        { id: 'explicit.stat_1', text: '+# 最大生命', type: 'explicit' },
        { id: 'explicit.stat_2', text: '區域增加 #% 經驗值', type: 'explicit' },
        {
          id: 'explicit.stat_3',
          text: '配置 #',
          type: 'explicit',
          option: {
            options: [
              { id: 1, text: '次級' },
              { id: 2, text: '高階' },
            ],
          },
        },
        { id: 'explicit.stat_4', text: '第一行\n第二行', type: 'explicit' },
        { id: 'explicit.stat_999', text: '國際服沒有的詞綴', type: 'explicit' },
      ],
    });
    const artifact = buildStatsArtifact(chinese, {
      gameVersion: 'poe1',
      locale: 'zh-TW',
      englishResponse: english,
    });
    expect(artifact.source).toBe('pathofexile.tw');
    expect(artifact.labels).toEqual({ explicit: '外延' });
    expect(artifact.stats).toEqual({
      'explicit.stat_1': '+# 最大生命',
      'explicit.stat_3': '配置 #',
      'explicit.stat_4': '第一行\n第二行',
    });
    expect(artifact.options).toEqual({ 'explicit.stat_3': { 1: '次級', 2: '高階' } });
  });

  it('中文與 en 同 id 出現次數相同時保留陣列', () => {
    const chinese = statsResponse({
      entries: [
        { id: 'explicit.stat_2', text: '區域增加 #% 經驗值', type: 'explicit' },
        { id: 'explicit.stat_2', text: '地圖增加 #% 經驗值', type: 'explicit' },
      ],
    });
    const artifact = buildStatsArtifact(chinese, {
      gameVersion: 'poe1',
      locale: 'zh-CN',
      englishResponse: english,
    });
    expect(artifact.stats['explicit.stat_2']).toEqual(['區域增加 #% 經驗值', '地圖增加 #% 經驗值']);
  });

  it('回應缺少 result 陣列時拒絕', () => {
    expect(() => buildStatsArtifact({}, { gameVersion: 'poe1', locale: 'en' })).toThrow(/result/);
  });
});

describe('validateStatsArtifact', () => {
  const artifactOf = (locale, stats) => ({ locale, labels: {}, stats, options: {} });
  const many = (prefix) =>
    Object.fromEntries(
      Array.from({ length: 600 }, (_, i) => [`explicit.stat_${i}`, `${prefix}${i}`]),
    );

  it('條目過少時拒絕', () => {
    expect(() => validateStatsArtifact(artifactOf('en', { a: 'b' }))).toThrow(/只有 1 筆/);
  });

  it('中文產物大多與 en 相同時視為網域回傳英文而拒絕', () => {
    const english = artifactOf('en', many('Text '));
    expect(() => validateStatsArtifact(artifactOf('zh-TW', many('Text ')), english)).toThrow(
      /與 en 相同/,
    );
    expect(validateStatsArtifact(artifactOf('zh-TW', many('文字 ')), english).locale).toBe('zh-TW');
  });
});

describe('buildStaticArtifact / validateStaticArtifact', () => {
  const english = {
    result: [
      {
        id: 'Currency',
        label: 'Currency',
        entries: [
          { id: 'alt', text: 'Orb of Alteration', image: '/a.png' },
          { id: 'chaos', text: 'Chaos Orb', image: '/c.png' },
        ],
      },
      { id: 'Fragments', label: 'Fragments', entries: [{ id: 'chaos', text: 'Chaos Fragment' }] },
    ],
  };

  it('static 的 id 跨群組可能重複，所以依群組分層', () => {
    const chinese = {
      result: [
        {
          id: 'Currency',
          label: '通貨',
          entries: [
            { id: 'alt', text: '改造石' },
            { id: 'chaos', text: '混沌石' },
            { id: 'only-tw', text: '台服才有' },
          ],
        },
        { id: 'Fragments', label: '碎片', entries: [{ id: 'chaos', text: '混沌碎片' }] },
        { id: 'TwOnly', label: '台服群組', entries: [{ id: 'x', text: 'x' }] },
      ],
    };
    const artifact = buildStaticArtifact(chinese, {
      gameVersion: 'poe1',
      locale: 'zh-TW',
      englishResponse: english,
    });
    expect(artifact).toEqual({
      schemaVersion: 1,
      gameVersion: 'poe1',
      locale: 'zh-TW',
      source: 'pathofexile.tw',
      labels: { Currency: '通貨', Fragments: '碎片' },
      entries: {
        Currency: { alt: '改造石', chaos: '混沌石' },
        Fragments: { chaos: '混沌碎片' },
      },
    });
  });

  it('條目過少或與 en 相同時拒絕', () => {
    const en = buildStaticArtifact(english, { gameVersion: 'poe1', locale: 'en' });
    expect(() => validateStaticArtifact(en)).toThrow(/只有 3 筆/);
  });

  it('static 端點網址', () => {
    expect(buildStaticUrl('zh-CN', 'poe2')).toBe('https://poe.game.qq.com/api/trade2/data/static');
  });
});
