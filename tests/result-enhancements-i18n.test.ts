// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { ResultItemNormalizer } from '@/entrypoints/content/logic/result-item-normalizer';
import { ResultPricePresenter } from '@/entrypoints/content/logic/result-price-presenter';
import { setActiveDisplayLocale, resetI18nStateForTests } from '@/utils/i18n';

describe('Seam 3: PoE 2 Rune Normalizer (`result-item-normalizer.ts`) & Price Comparison (`result-price-presenter.ts`)', () => {
  beforeEach(() => {
    resetI18nStateForTests('zh-TW');
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  describe('ResultItemNormalizer localization', () => {
    const mockWeaponItem = {
      id: 'weapon-res-1',
      item: {
        id: 'item-1',
        name: '巨鷹巨弓',
        typeLine: '巨鷹巨弓',
        baseType: '巨鷹巨弓',
        ilvl: 75,
        properties: [
          { name: 'Physical Damage', values: [['100-200', 0]] },
          { name: 'Attacks per Second', values: [['1.50', 0]] },
        ],
        sockets: [{ group: 0 }, { group: 0 }],
        extended: {
          category: 'bow',
          dps: 225,
          pdps: 225,
          edps: 0,
        },
      },
    };

    const mockArmourItem = {
      id: 'armour-res-1',
      item: {
        id: 'item-2',
        name: '征服者重甲',
        typeLine: '征服者重甲',
        baseType: '征服者重甲',
        ilvl: 75,
        properties: [{ name: 'Armour', values: [['500', 0]] }],
        sockets: [{ group: 0 }],
        extended: {
          category: 'body-armour',
          armour: 500,
        },
      },
    };

    it('renders and reactively updates toolbar dropdowns and item cards across zh-TW, en, zh-CN', async () => {
      setActiveDisplayLocale('zh-TW');

      const rowTotal = document.createElement('div');
      rowTotal.className = 'row row-total';
      document.body.appendChild(rowTotal);

      const resultsContainer = document.createElement('div');
      resultsContainer.className = 'results';
      document.body.appendChild(resultsContainer);

      const weaponRow = document.createElement('div');
      weaponRow.className = 'row';
      weaponRow.setAttribute('data-id', 'weapon-res-1');
      const weaponLeft = document.createElement('div');
      weaponLeft.className = 'left';
      const weaponAdditional = document.createElement('div');
      weaponAdditional.className = 'itemPopupAdditional';
      weaponAdditional.innerHTML =
        '<span data-field="dps" class="s lc">DPS<span class="colourAugmented">500</span></span>';
      const weaponDetails = document.createElement('div');
      weaponDetails.className = 'details';
      weaponRow.append(weaponLeft, weaponAdditional, weaponDetails);
      resultsContainer.appendChild(weaponRow);

      const armourRow = document.createElement('div');
      armourRow.className = 'row';
      armourRow.setAttribute('data-id', 'armour-res-1');
      const armourLeft = document.createElement('div');
      armourLeft.className = 'left';
      const armourAdditional = document.createElement('div');
      armourAdditional.className = 'itemPopupAdditional';
      armourAdditional.innerHTML =
        '<span data-field="ar" class="s lc">Armour<span class="colourAugmented">500</span></span>';
      const armourDetails = document.createElement('div');
      armourDetails.className = 'details';
      armourRow.append(armourLeft, armourAdditional, armourDetails);
      resultsContainer.appendChild(armourRow);

      const normalizer = new ResultItemNormalizer('poe2');

      const fetchDetail = JSON.stringify({
        url: 'https://www.pathofexile.com/api/trade2/fetch/item-1?query=test-query',
        data: {
          result: [mockWeaponItem, mockArmourItem],
        },
      });

      normalizer.handleFetchResponse(fetchDetail);

      // --- 1. Verify zh-TW ---
      const controls = document.querySelector('.poexd-total-controls');
      expect(controls).toBeTruthy();

      const weaponBtn = controls?.querySelector<HTMLButtonElement>('.poexd-weapon-btn');
      expect(weaponBtn?.title).toContain('完美鍛鐵符文 (增加 20% 物理傷害)');

      const weaponPopItems = controls?.querySelectorAll(
        '.poexd-weapon-popover .poexd-popover-item span',
      );
      const weaponPopTexts = Array.from(weaponPopItems || []).map((el) => el.textContent);
      expect(weaponPopTexts).toContain('完美鍛鐵符文 (增加 20% 物理傷害)');
      expect(weaponPopTexts).toContain('無符文 (純淨底)');

      const sortPopItems = controls?.querySelectorAll(
        '.poexd-sort-popover .poexd-popover-item span',
      );
      const sortPopTexts = Array.from(sortPopItems || []).map((el) => el.textContent);
      expect(sortPopTexts).toContain('覆寫 DPS (高 ➔ 低)');
      expect(sortPopTexts).toContain('覆寫總防禦 (高 ➔ 低)');
      expect(sortPopTexts).toContain('覆寫護甲 (高 ➔ 低)');
      expect(sortPopTexts).toContain('覆寫閃避 (高 ➔ 低)');
      expect(sortPopTexts).toContain('覆寫能量護盾 (高 ➔ 低)');
      expect(sortPopTexts).toContain('性價比 (覆寫/價格 高 ➔ 低)');

      const weaponOverride = weaponRow.querySelector('[data-field="dps"] .poexd-inline-override');
      expect(weaponOverride).toBeTruthy();
      expect(weaponOverride?.getAttribute('title')).toContain('【PoeXD 符文覆寫試算】');
      expect(weaponOverride?.getAttribute('title')).toContain('覆寫DPS');

      const armourOverride = armourRow.querySelector('[data-field="ar"] .poexd-inline-override');
      expect(armourOverride).toBeTruthy();
      expect(armourOverride?.getAttribute('title')).toContain('【PoeXD 符文覆寫試算】');
      expect(armourOverride?.getAttribute('title')).toContain('覆寫防禦');

      const socketWarn = armourRow.querySelector('.left [data-field="poexd-sockets"]');
      expect(socketWarn).toBeTruthy();
      expect(socketWarn?.innerHTML).toContain('打孔潛力');

      // --- 2. Switch to en ---
      setActiveDisplayLocale('en');
      normalizer.refreshLocale?.();

      expect(weaponBtn?.title).toContain('Perfect Iron Rune (20% increased Physical Damage)');

      const weaponPopTextsEn = Array.from(
        controls?.querySelectorAll('.poexd-weapon-popover .poexd-popover-item span') || [],
      ).map((el) => el.textContent);
      expect(weaponPopTextsEn).toContain('Perfect Iron Rune (20% increased Physical Damage)');
      expect(weaponPopTextsEn).toContain('No Runes (Clean Base)');

      const sortPopTextsEn = Array.from(
        controls?.querySelectorAll('.poexd-sort-popover .poexd-popover-item span') || [],
      ).map((el) => el.textContent);
      expect(sortPopTextsEn).toContain('Override DPS (High ➔ Low)');
      expect(sortPopTextsEn).toContain('Override Armour (High ➔ Low)');
      expect(sortPopTextsEn).toContain('Override Evasion (High ➔ Low)');
      expect(sortPopTextsEn).toContain('Override Energy Shield (High ➔ Low)');
      expect(sortPopTextsEn).toContain('Cost-Performance (Override/Price High ➔ Low)');

      const weaponOverrideEn = weaponRow.querySelector('[data-field="dps"] .poexd-inline-override');
      expect(weaponOverrideEn?.getAttribute('title')).toContain('[PoeXD Rune Override Simulation]');
      expect(weaponOverrideEn?.getAttribute('title')).toContain('Override DPS');

      const armourOverrideEn = armourRow.querySelector('[data-field="ar"] .poexd-inline-override');
      expect(armourOverrideEn?.getAttribute('title')).toContain('[PoeXD Rune Override Simulation]');
      expect(armourOverrideEn?.getAttribute('title')).toContain('Override Def');

      const socketWarnEn = armourRow.querySelector('.left [data-field="poexd-sockets"]');
      expect(socketWarnEn?.innerHTML).toContain('Socket Potential');

      // --- 3. Switch to zh-CN ---
      setActiveDisplayLocale('zh-CN');
      normalizer.refreshLocale?.();

      expect(weaponBtn?.title).toContain('完美锻铁符文 (增加 20% 物理伤害)');
      const weaponOverrideCn = weaponRow.querySelector('[data-field="dps"] .poexd-inline-override');
      const armourOverrideCn = armourRow.querySelector('[data-field="ar"] .poexd-inline-override');
      const socketWarnCn = armourRow.querySelector('.left [data-field="poexd-sockets"]');
      expect(weaponOverrideCn?.getAttribute('title')).toContain('覆写DPS');
      expect(armourOverrideCn?.getAttribute('title')).toContain('覆写防御');
      expect(socketWarnCn?.innerHTML).toContain('打孔潜力');

      normalizer.cleanup();
    });
  });

  describe('ResultPricePresenter localization', () => {
    it('renders and reactively updates price comparisons across zh-TW, en, zh-CN', async () => {
      setActiveDisplayLocale('zh-TW');

      const resultsContainer = document.createElement('div');
      resultsContainer.className = 'results';
      document.body.appendChild(resultsContainer);

      const row = document.createElement('div');
      row.className = 'row';
      row.setAttribute('data-id', 'res-price-1');

      const priceContainer = document.createElement('div');
      priceContainer.className = 'price';
      const priceField = document.createElement('span');
      priceField.setAttribute('data-field', 'price');
      priceContainer.appendChild(priceField);
      row.appendChild(priceContainer);

      resultsContainer.appendChild(row);

      const mockRates = {
        primary: 'divine',
        rates: {
          chaos: 0.005, // 200 chaos = 1 divine
          divine: 1,
        },
      };

      const presenter = new ResultPricePresenter(
        'poe1',
        vi.fn(async () => mockRates as any),
        true, // supported
      );

      const fetchDetail = JSON.stringify({
        url: 'https://www.pathofexile.com/api/trade/fetch/item-1?query=test-query',
        data: {
          result: [
            {
              id: 'res-price-1',
              listing: {
                price: {
                  amount: 400,
                  currency: 'chaos',
                },
              },
            },
          ],
        },
      });

      await presenter.handleFetchResponse(fetchDetail, 'Standard');

      const comparisonEl = priceContainer.querySelector('.poexd-price-comparison');
      expect(comparisonEl).toBeTruthy();

      // 1. zh-TW
      const imgTw = comparisonEl?.querySelector<HTMLImageElement>('img');
      expect(imgTw?.alt).toBe('神聖石');
      expect(imgTw?.title).toBe('神聖石');
      expect(comparisonEl?.getAttribute('title')).toContain('神聖石');
      expect(comparisonEl?.getAttribute('title')).toContain('poe.ninja Currency Exchange 換算：');

      // 2. Switch to en
      setActiveDisplayLocale('en');
      presenter.refreshLocale?.();

      const imgEn = comparisonEl?.querySelector<HTMLImageElement>('img');
      expect(imgEn?.alt).toBe('Divine Orb');
      expect(imgEn?.title).toBe('Divine Orb');
      expect(comparisonEl?.getAttribute('title')).toContain('Divine Orb');
      expect(comparisonEl?.getAttribute('title')).toContain(
        'poe.ninja Currency Exchange conversion:',
      );

      // 3. Switch to zh-CN
      setActiveDisplayLocale('zh-CN');
      presenter.refreshLocale?.();

      const imgCn = comparisonEl?.querySelector<HTMLImageElement>('img');
      expect(imgCn?.alt).toBe('神圣石');
      expect(imgCn?.title).toBe('神圣石');
      expect(comparisonEl?.getAttribute('title')).toContain('神圣石');
      expect(comparisonEl?.getAttribute('title')).toContain('poe.ninja Currency Exchange 换算：');

      presenter.cleanup();
    });
  });
});
