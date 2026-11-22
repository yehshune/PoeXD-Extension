import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setActiveDisplayLocale } from '@/utils/i18n';
import {
  extractStatDomain,
  toStatDomainKey,
  getStatDomainBadgeLabel,
  getStatDomainLabel,
  getStatDomainStyle,
  shouldShowStatDomainBadge,
  STAT_DOMAIN_KEYS,
} from '@/utils/stat-domain';
import {
  resetTradeLabelsForTests,
  setLiveTradeData,
  setTradeLabelTestData,
} from '@/utils/trade-label-resolver';

describe('stat-domain (詞綴網域色票與官方標籤)', () => {
  beforeEach(() => {
    setActiveDisplayLocale('zh-TW');
    resetTradeLabelsForTests();
  });

  afterEach(() => {
    setActiveDisplayLocale('zh-TW');
    resetTradeLabelsForTests();
  });

  it('從官方 stat id 解析所有支援的網域前綴', () => {
    for (const domain of STAT_DOMAIN_KEYS) {
      expect(extractStatDomain(`${domain}.stat_12345`)).toBe(domain);
    }
    expect(extractStatDomain('stat_12345')).toBeNull();
    expect(extractStatDomain('unknown_prefix.stat_1')).toBeNull();
    expect(extractStatDomain('')).toBeNull();
    expect(toStatDomainKey('fractured')).toBe('fractured');
    expect(toStatDomainKey('unknown_prefix')).toBeNull();
    expect(toStatDomainKey(undefined)).toBeNull();
  });

  it('對齊官方市集：只有非 explicit 的網域需要顯示標籤徽章', () => {
    expect(shouldShowStatDomainBadge('explicit')).toBe(false);
    expect(shouldShowStatDomainBadge(null)).toBe(false);
    expect(shouldShowStatDomainBadge('implicit')).toBe(true);
    expect(shouldShowStatDomainBadge('crafted')).toBe(true);
    expect(shouldShowStatDomainBadge('enchant')).toBe(true);
    expect(shouldShowStatDomainBadge('fractured')).toBe(true);
    expect(shouldShowStatDomainBadge('pseudo')).toBe(true);
    expect(shouldShowStatDomainBadge('desecrated')).toBe(true);
  });

  it('非 explicit 網域回傳對應的 --pxd-stat-* CSS 變數樣式', () => {
    expect(getStatDomainStyle('explicit')).toBeUndefined();
    expect(getStatDomainStyle(null)).toBeUndefined();
    expect(getStatDomainStyle('crafted')).toEqual({
      '--pxd-stat-color': 'var(--pxd-stat-crafted)',
    });
    expect(getStatDomainStyle('fractured')).toEqual({
      '--pxd-stat-color': 'var(--pxd-stat-fractured)',
    });
  });

  it('優先採用即時資料與分片 labels，無資料時退回與 trade-stats.json 一致的官方標籤', () => {
    expect(getStatDomainLabel('fractured', 'poe1')).toBe('破裂');
    expect(getStatDomainLabel('rune', 'poe2')).toBe('增幅');

    setActiveDisplayLocale('en');
    expect(getStatDomainLabel('rune', 'poe2')).toBe('Augment');

    setTradeLabelTestData({
      version: 'poe1',
      officialStats: {
        en: { stats: { 'explicit.stat_1': 'x' }, labels: { fractured: 'Fractured Override' } },
      },
    });
    expect(getStatDomainLabel('fractured', 'poe1')).toBe('Fractured Override');

    setLiveTradeData('poe1', {
      pageLocale: 'en',
      filters: null,
      statLabels: {
        stats: {},
        pseudoStats: {},
        domainLabels: { fractured: 'Live Fractured' },
      },
    });
    expect(getStatDomainLabel('fractured', 'poe1')).toBe('Live Fractured');
  });

  it('徽章用簡稱：中文為 2～3 字且涵蓋所有網域，其他語言沿用官方標籤', () => {
    setTradeLabelTestData({
      version: 'poe1',
      officialStats: {
        'zh-TW': { stats: { 'explicit.stat_1': 'x' }, labels: { crafted: '已工藝' } },
      },
    });
    expect(getStatDomainBadgeLabel('crafted')).toBe('工藝');
    expect(getStatDomainBadgeLabel('implicit')).toBe('固定');
    expect(getStatDomainBadgeLabel(null)).toBeNull();
    for (const locale of ['zh-TW', 'zh-CN'] as const) {
      setActiveDisplayLocale(locale);
      for (const domain of STAT_DOMAIN_KEYS) {
        expect([...(getStatDomainBadgeLabel(domain) ?? '')].length).toBeGreaterThanOrEqual(2);
        expect([...(getStatDomainBadgeLabel(domain) ?? '')].length).toBeLessThanOrEqual(3);
      }
    }
    expect(getStatDomainBadgeLabel('implicit')).toBe('基底');

    setActiveDisplayLocale('en');
    expect(getStatDomainBadgeLabel('crafted')).toBe('Crafted');
  });

  it('assets/main.css 針對所有網域皆宣告對應的 --pxd-stat-* token', () => {
    const mainCss = readFileSync('assets/main.css', 'utf8');
    for (const domain of STAT_DOMAIN_KEYS) {
      expect(mainCss).toContain(`--pxd-stat-${domain}:`);
    }
  });
});
