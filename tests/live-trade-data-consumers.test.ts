import { computed } from 'vue';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetI18nStateForTests, setActiveDisplayLocale } from '../utils/i18n';
import type { LiveStatLabels, LiveTradeFilters } from '../utils/live-trade-data';
import {
  getUsableLiveTradeData,
  resetLiveTradeDataForTests,
  setLiveTradeData,
} from '../utils/live-trade-data-store';
import {
  getOfficialStatLabel,
  resetOfficialStatTextForTests,
  setMockOfficialStatText,
} from '../utils/official-stat-text';
import {
  translateFilterGroup,
  translateFilterKey,
  translateStat,
} from '../utils/trade-stat-dictionary';

/** 模擬 3.30 上線當天：頁面有新欄位、改名的群組，打包資料還是舊的 */
const liveFilters: LiveTradeFilters = {
  groups: { map_filters: '即時地圖篩選' },
  fields: { brand_new_field: '即時新欄位' },
  options: {},
};
const liveStats: LiveStatLabels = {
  stats: {
    'explicit.stat_live_only': '即時才有的詞綴 #%',
    'explicit.stat_english_only': '+# to Something',
    'pseudo.pseudo_live_total': '+# 即時總計',
  },
  pseudoStats: { 'pseudo.pseudo_live_total': '+# 即時總計' },
};

const setLive = (pageLocale: 'zh-TW' | 'en' | 'ja') =>
  setLiveTradeData('poe1', { pageLocale, filters: liveFilters, statLabels: liveStats });

describe('即時市集資料接入（ADR-0014 第 3 階段）', () => {
  beforeEach(() => {
    setActiveDisplayLocale('zh-TW');
    setMockOfficialStatText('poe1', 'en', { 'explicit.stat_english_only': '+# to Something' });
    setMockOfficialStatText('poe1', 'zh-TW', {});
  });

  afterEach(() => {
    resetLiveTradeDataForTests();
    resetOfficialStatTextForTests();
    resetI18nStateForTests('zh-TW');
  });

  describe('語系閘門', () => {
    it('只有顯示語系等於頁面語系才可用', () => {
      setLive('zh-TW');
      expect(getUsableLiveTradeData('poe1', 'zh-TW', 'pathofexile.tw')).toBeDefined();
      expect(getUsableLiveTradeData('poe1', 'en', 'pathofexile.tw')).toBeUndefined();
      expect(getUsableLiveTradeData('poe2', 'zh-TW', 'pathofexile.tw')).toBeUndefined();
    });

    it('國際服只採用英文；顯示中文時頁面資料可能已被市集漢化改寫', () => {
      setLive('en');
      expect(getUsableLiveTradeData('poe1', 'en', 'www.pathofexile.com')).toBeDefined();
      setLive('zh-TW');
      expect(getUsableLiveTradeData('poe1', 'zh-TW', 'www.pathofexile.com')).toBeUndefined();
    });
  });

  describe('篩選標籤', () => {
    it('即時資料優先，沒有的 id 由打包分片補上', () => {
      setLive('zh-TW');
      expect(translateFilterGroup('map_filters', 'poe1')).toBe('即時地圖篩選');
      expect(translateFilterKey('brand_new_field', 'poe1')).toBe('即時新欄位');
      // 即時資料沒有的群組沿用打包的 zh-TW
      expect(translateFilterGroup('trade_filters', 'poe1')).toBe('交易過濾');
    });

    it('語系不同時只用打包資料', () => {
      setLive('ja');
      expect(translateFilterGroup('map_filters', 'poe1')).toBe('地圖篩選');
      expect(translateFilterKey('brand_new_field', 'poe1')).toBe('brand_new_field');
    });

    it('即時資料到達時，讀取標籤的 computed 會重新計算', () => {
      const label = computed(() => translateFilterKey('brand_new_field', 'poe1'));
      expect(label.value).toBe('brand_new_field');
      setLive('zh-TW');
      expect(label.value).toBe('即時新欄位');
    });
  });

  describe('市集寫法', () => {
    it('即時資料有的 id 直接採用，包含打包官方分片以外的語系', () => {
      setLive('zh-TW');
      expect(translateStat('explicit.stat_live_only', 'poe1')).toBe('即時才有的詞綴 #%');

      setActiveDisplayLocale('ja');
      setLive('ja');
      expect(getOfficialStatLabel('explicit.stat_live_only', 'poe1', 'ja')).toBe(
        '即時才有的詞綴 #%',
      );
    });

    it('非英文市集回傳英文原文時視為沒有翻譯', () => {
      setLive('zh-TW');
      expect(getOfficialStatLabel('explicit.stat_english_only', 'poe1', 'zh-TW')).toBeNull();
    });

    it('pseudo 偽屬性也用即時資料，呈現規則與打包的市集寫法相同', () => {
      setLive('zh-TW');
      // renderGenericTemplate 會去掉開頭的 +
      expect(translateStat('pseudo.pseudo_live_total', 'poe1')).toBe('# 即時總計');

      setActiveDisplayLocale('en');
      setLive('en');
      setMockOfficialStatText('poe1', 'en', {});
      expect(translateStat('pseudo.pseudo_live_total', 'poe1')).toBe('# 即時總計');
    });

    it('語系不同時不採用即時寫法', () => {
      setLive('zh-TW');
      setActiveDisplayLocale('en');
      expect(getOfficialStatLabel('explicit.stat_live_only', 'poe1', 'en')).toBeNull();
    });
  });
});
