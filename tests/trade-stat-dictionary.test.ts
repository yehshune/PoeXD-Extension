import { existsSync, readFileSync, statSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  formatFilterValue,
  setMockDictionaries,
  setMockItemShards,
  translateFilterGroup,
  translateFilterKey,
  translateItemName,
  translateStat,
  translateStatLines,
} from '../utils/trade-stat-dictionary';
import { resetI18nStateForTests, setActiveDisplayLocale } from '../utils/i18n';
import {
  resetOfficialStatTextForTests,
  setMockOfficialStatText,
} from '../utils/official-stat-text';

describe('trade-stat-dictionary (extension)', () => {
  afterEach(() => {
    resetI18nStateForTests('zh-TW');
    setMockDictionaries('poe1', null, null, null);
    setMockDictionaries('poe2', null, null, null);
    setMockItemShards('poe1', null);
    setMockItemShards('poe2', null);
    resetOfficialStatTextForTests();
  });

  describe('translateFilterGroup', () => {
    it('能正確解析 PoE1 與 PoE2 的官方群組名稱', () => {
      // PoE1
      expect(translateFilterGroup('type_filters', 'poe1')).toBe('類別過濾');
      expect(translateFilterGroup('weapon_filters', 'poe1')).toBe('武器篩選');
      expect(translateFilterGroup('armour_filters', 'poe1')).toBe('護甲篩選');
      expect(translateFilterGroup('req_filters', 'poe1')).toBe('物品需求');
      // 官方各語系市集皆未翻譯此群組，以官方為準
      expect(translateFilterGroup('map_filters', 'poe1')).toBe('Map/Chart Filters');
      expect(translateFilterGroup('trade_filters', 'poe1')).toBe('交易過濾');
      expect(translateFilterGroup('misc_filters', 'poe1')).toBe('其它');

      // PoE2
      expect(translateFilterGroup('type_filters', 'poe2')).toBe('類別過濾');
      expect(translateFilterGroup('equipment_filters', 'poe2')).toBe('裝備篩選器');
      expect(translateFilterGroup('map_filters', 'poe2')).toBe('終局篩選器');
      expect(translateFilterGroup('trade_filters', 'poe2')).toBe('交易過濾');
      expect(translateFilterGroup('misc_filters', 'poe2')).toBe('其它');
    });

    it('查不到時安全回傳 groupKey 原文', () => {
      expect(translateFilterGroup('non_existent_group', 'poe1')).toBe('non_existent_group');
    });

    it('優先使用快取的 mock filters 字典', () => {
      setMockDictionaries('poe1', null, {
        groups: {
          custom_group: '自訂群組名稱',
        },
      });
      expect(translateFilterGroup('custom_group', 'poe1')).toBe('自訂群組名稱');
    });
  });

  describe('translateFilterKey', () => {
    it('優先使用 trade-filters 字典的欄位與群組翻譯', () => {
      setMockDictionaries('poe1', null, {
        fields: {
          price: '直購價',
          category: '物品種類',
        },
        groups: {
          misc_filters: '其它',
        },
      });
      expect(translateFilterKey('trade_filters.price', 'poe1')).toBe('直購價');
      expect(translateFilterKey('type_filters.category', 'poe1')).toBe('物品種類');
      expect(translateFilterKey('misc_filters', 'poe1')).toBe('其它');
    });

    it('查不到時使用欄位名稱', () => {
      expect(translateFilterKey('misc_filters.unknown_key', 'poe1')).toBe('unknown_key');
    });
  });

  describe('formatFilterValue', () => {
    it('透過 trade-filters 的 options 格式化通貨單位與數值範圍', () => {
      setMockDictionaries('poe1', null, {
        options: {
          price: {
            divine: '神聖石',
            chaos: '混沌石',
          },
        },
      });
      expect(formatFilterValue({ min: 10, max: 50, option: 'divine' }, 'price', 'poe1')).toBe(
        '10 ~ 50 神聖石',
      );
      expect(formatFilterValue({ min: 100, option: 'chaos' }, 'price', 'poe1')).toBe(
        '≥ 100 混沌石',
      );
      expect(formatFilterValue({ max: 5 }, 'price', 'poe1')).toBe('≤ 5');
    });

    it('正確格式化布林選項', () => {
      expect(formatFilterValue({ option: 'true' })).toBe('是');
      expect(formatFilterValue({ option: false })).toBe('否');
    });

    it('若在 options 找不到，使用既有 typeNamesPoe1 對照表解析裝備種類', () => {
      expect(formatFilterValue({ option: 'staff' }, 'category', 'poe1')).toBe('長杖');
    });

    it('當輸入為純字串時，亦能正確解析對應 options', () => {
      setMockDictionaries('poe1', null, {
        options: {
          category: {
            'weapon.staff': '任一長杖',
          },
        },
      });
      expect(formatFilterValue('weapon.staff', 'category', 'poe1')).toBe('任一長杖');
    });

    it('正確解析並格式化 enabled 巢狀 option，絕不顯示 [object Object]', () => {
      // 巢狀字串 option
      expect(
        formatFilterValue({ option: { option: '20', disabled: false } }, 'gem_level', 'poe1'),
      ).toBe('20');

      // 巢狀布林 option
      expect(
        formatFilterValue({ option: { option: 'true', disabled: false } }, 'corrupted', 'poe1'),
      ).toBe('是');
      expect(
        formatFilterValue({ option: { option: false, disabled: false } }, 'corrupted', 'poe1'),
      ).toBe('否');

      // 巢狀帶有翻譯的 option + min/max
      setMockDictionaries('poe1', null, {
        options: {
          price: {
            divine: '神聖石',
          },
        },
      });
      expect(
        formatFilterValue(
          { min: 5, option: { option: 'divine', disabled: false } },
          'price',
          'poe1',
        ),
      ).toBe('≥ 5 神聖石');

      // disabled 巢狀 option 返回空字串（或僅保留未停用數值）
      expect(
        formatFilterValue({ option: { option: '20', disabled: true } }, 'gem_level', 'poe1'),
      ).toBe('');
      expect(
        formatFilterValue(
          { min: 10, option: { option: 'divine', disabled: true } },
          'price',
          'poe1',
        ),
      ).toBe('≥ 10');
    });
  });

  describe('translateItemName', () => {
    it('能將英文物品名稱與基底名稱轉換為繁中', () => {
      setMockDictionaries(
        'poe1',
        null,
        null,
        new Map([
          ['headhunter', '獵首'],
          ['leather belt', '皮革腰帶'],
        ]),
      );
      expect(translateItemName('Headhunter', 'poe1')).toBe('獵首');
      expect(translateItemName('Leather Belt', 'poe1')).toBe('皮革腰帶');
    });

    it('中文名稱保持不變', () => {
      expect(translateItemName('獵首', 'poe1')).toBe('獵首');
    });

    it('未命中字典時安全返回原文', () => {
      expect(translateItemName('Unknown Item Name', 'poe1')).toBe('Unknown Item Name');
    });

    it('支援跨語系雙向轉換 (en <-> zh-TW <-> zh-CN) 並依當前 Display Locale 輸出', () => {
      setMockItemShards('poe1', {
        en: { items: ['Headhunter', 'Leather Belt', 'Mageblood'] },
        'zh-TW': { items: ['獵首', '皮革腰帶', '魔血'] },
        'zh-CN': { items: ['猎首', '皮革腰带', '魔血'] },
      });

      setActiveDisplayLocale('zh-TW');
      expect(translateItemName('Headhunter', 'poe1')).toBe('獵首');
      expect(translateItemName('猎首', 'poe1')).toBe('獵首');
      expect(translateItemName('Leather Belt', 'poe1')).toBe('皮革腰帶');

      setActiveDisplayLocale('zh-CN');
      expect(translateItemName('Headhunter', 'poe1')).toBe('猎首');
      expect(translateItemName('獵首', 'poe1')).toBe('猎首');
      expect(translateItemName('皮革腰帶', 'poe1')).toBe('皮革腰带');

      setActiveDisplayLocale('en');
      expect(translateItemName('獵首', 'poe1')).toBe('Headhunter');
      expect(translateItemName('猎首', 'poe1')).toBe('Headhunter');
      expect(translateItemName('皮革腰帶', 'poe1')).toBe('Leather Belt');
      expect(translateItemName('皮革腰带', 'poe1')).toBe('Leather Belt');
      expect(translateItemName('headhunter', 'poe1')).toBe('Headhunter');
    });

    it('驗證緊湊語系物品分片 (locales/{locale}/items.json) 無 icon 且體積縮減 >90%，並移除舊版 items_translate.json', () => {
      const legacyPoe1Bytes = 1_924_805; // 1.88 MB legacy poe1/items_translate.json baseline
      for (const version of ['poe1', 'poe2'] as const) {
        const legacyPath = new URL(
          `../public/json/${version}/items_translate.json`,
          import.meta.url,
        );
        expect(existsSync(legacyPath), `${version}/items_translate.json should be removed`).toBe(
          false,
        );

        for (const locale of ['en', 'zh-TW', 'zh-CN'] as const) {
          const shardUrl = new URL(
            `../public/json/${version}/locales/${locale}/items.json`,
            import.meta.url,
          );
          expect(existsSync(shardUrl), `${version} ${locale} items.json should exist`).toBe(true);
          const raw = readFileSync(shardUrl, 'utf8');
          const sizeBytes = statSync(shardUrl).size;
          expect(raw.includes('"icon"')).toBe(false);
          expect(sizeBytes).toBeLessThan(legacyPoe1Bytes * 0.1);
          const parsed = JSON.parse(raw);
          expect(Array.isArray(parsed.items)).toBe(true);
          expect(parsed.items.length).toBeGreaterThan(1000);
        }
      }

      const wxtConfig = readFileSync(new URL('../wxt.config.ts', import.meta.url), 'utf8');
      expect(wxtConfig.includes('items_translate.json')).toBe(false);
      expect(wxtConfig.includes('locales/*/items.json')).toBe(true);
    });
  });

  describe('multi-locale non-stat trade filters (zh-TW / zh-CN / en)', () => {
    it('依當前 Display Locale 輸出群組、欄位、選項與布林值', () => {
      setMockDictionaries('poe1', null, null);
      setMockDictionaries('poe2', null, null);

      setActiveDisplayLocale('zh-TW');
      expect(translateFilterGroup('type_filters', 'poe1')).toBe('類別過濾');
      expect(translateFilterKey('trade_filters.price', 'poe1')).toBe('直購價');
      expect(formatFilterValue({ option: 'true' }, 'corrupted', 'poe1')).toBe('是');
      expect(formatFilterValue({ option: false }, 'corrupted', 'poe1')).toBe('否');
      expect(formatFilterValue({ min: 10, option: 'divine' }, 'price', 'poe1')).toBe('≥ 10 神聖石');

      setActiveDisplayLocale('zh-CN');
      expect(translateFilterGroup('type_filters', 'poe1')).toBe('类型过滤器');
      expect(translateFilterGroup('equipment_filters', 'poe2')).toBe('装备过滤器');
      expect(translateFilterKey('trade_filters.price', 'poe1')).toBe('一口价');
      expect(formatFilterValue({ option: 'true' }, 'corrupted', 'poe1')).toBe('是');
      expect(formatFilterValue({ option: false }, 'corrupted', 'poe1')).toBe('否');
      expect(formatFilterValue({ min: 10, option: 'divine' }, 'price', 'poe1')).toBe('≥ 10 神圣石');
      expect(formatFilterValue({ option: 'staff' }, 'category', 'poe1')).toBe('长杖');

      setActiveDisplayLocale('en');
      expect(translateFilterGroup('type_filters', 'poe1')).toBe('Type Filters');
      expect(translateFilterGroup('equipment_filters', 'poe2')).toBe('Equipment Filters');
      expect(translateFilterKey('trade_filters.price', 'poe1')).toBe('Buyout Price');
      expect(translateFilterKey('misc_filters.ilvl', 'poe1')).toBe('Item Level');
      expect(formatFilterValue({ option: 'true' }, 'corrupted', 'poe1')).toBe('Yes');
      expect(formatFilterValue({ option: false }, 'corrupted', 'poe1')).toBe('No');
      expect(formatFilterValue({ min: 10, option: 'divine' }, 'price', 'poe1')).toBe(
        '≥ 10 Divine Orb',
      );
      expect(formatFilterValue({ option: 'staff' }, 'category', 'poe1')).toBe('Staff');
    });
  });

  describe('translateStat', () => {
    it('優先採用官方市集的寫法（正負向跟市集一致），查不到才用詞綴字典', () => {
      setMockDictionaries('poe2', {
        'explicit.stat_3639275092': [{ displayTemplate: '減少 #% 能力值需求' }],
        'explicit.stat_only_game': [{ displayTemplate: '遊戲詞綴' }],
      });
      setMockOfficialStatText('poe2', 'en', {});
      setMockOfficialStatText('poe2', 'zh-TW', { 'explicit.stat_3639275092': '增加#%能力值需求' });

      expect(translateStat('explicit.stat_3639275092', 'poe2')).toBe('增加#%能力值需求');
      expect(translateStat('fractured.stat_3639275092', 'poe2')).toBe('增加#%能力值需求');
      expect(translateStat('explicit.stat_only_game', 'poe2')).toBe('遊戲詞綴');
    });

    it('支援直接查詢與 fractured / desecrated / enchant / rune fallback 至 explicit', () => {
      setMockDictionaries('poe2', {
        'explicit.stat_1234': [{ displayTemplate: '智慧提高 #%' }],
        'enchant.stat_direct': [{ displayTemplate: '已汙染附魔詞綴' }],
      });

      // 1. 直接命中
      expect(translateStat('enchant.stat_direct', 'poe2')).toBe('已汙染附魔詞綴');
      expect(translateStat('explicit.stat_1234', 'poe2')).toBe('智慧提高 #%');

      // 2. enchant fallback 至 explicit
      expect(translateStat('enchant.stat_1234', 'poe2')).toBe('智慧提高 #%');

      // 3. rune fallback 至 explicit
      expect(translateStat('rune.stat_1234', 'poe2')).toBe('智慧提高 #%');

      // 4. desecrated fallback 至 explicit
      expect(translateStat('desecrated.stat_1234', 'poe2')).toBe('智慧提高 #%');

      // 5. fractured fallback 至 explicit
      expect(translateStat('fractured.stat_1234', 'poe2')).toBe('智慧提高 #%');

      // 6. 未命中字典時移除前綴
      expect(translateStat('explicit.stat_unknown', 'poe2')).toBe('stat_unknown');
      expect(translateStat('enchant.stat_unknown', 'poe2')).toBe('stat_unknown');
    });
  });

  describe('translateStatLines', () => {
    it('把混合詞綴的 ||||| 分隔拆成多行，單一詞綴維持一行', () => {
      setMockDictionaries('poe2', {
        'explicit.stat_hybrid': [{ displayTemplate: '增加 #% 物理傷害|||||+# 命中值' }],
        'explicit.stat_single': [{ displayTemplate: '智慧提高 #%' }],
      });
      expect(translateStatLines('explicit.stat_hybrid', 'poe2')).toEqual([
        '增加 #% 物理傷害',
        '+# 命中值',
      ]);
      expect(translateStatLines('explicit.stat_single', 'poe2')).toEqual(['智慧提高 #%']);
      expect(translateStatLines('explicit.stat_missing', 'poe2')).toEqual(['stat_missing']);
    });
  });
});
