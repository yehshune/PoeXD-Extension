// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ResultItemNormalizer } from '@/entrypoints/content/logic/result-item-normalizer';
import { resetI18nStateForTests } from '@/utils/i18n';

/**
 * 官方 itemPopupAdditional 在 modern 版型是 position:absolute 疊在物品文字上方，
 * PoeXD 標籤若塞進去會蓋住底下的屬性列。標籤必須放在獨立的正常排版列。
 */
const weaponItem = {
  id: 'weapon-res-1',
  item: {
    id: 'item-1',
    name: 'Demon Pile',
    typeLine: 'Sinister Quarterstaff',
    baseType: 'Sinister Quarterstaff',
    ilvl: 71,
    properties: [
      { name: 'Physical Damage', values: [['95-157', 0]] },
      { name: 'Attacks per Second', values: [['1.40', 0]] },
    ],
    sockets: [],
    extended: { category: 'warstaff', dps: 212, pdps: 212, edps: 0 },
  },
};

const armourItem = {
  id: 'armour-res-1',
  item: {
    id: 'item-2',
    name: 'Barrow Dweller',
    typeLine: 'Rogue Armour',
    baseType: 'Rogue Armour',
    ilvl: 32,
    properties: [{ name: 'Armour', values: [['102', 0]] }],
    sockets: [{ group: 0 }],
    extended: { category: 'body-armour', armour: 102 },
  },
};

function buildRow(id: string, withOfficialAdditional: boolean): HTMLElement {
  const row = document.createElement('div');
  row.className = 'row';
  row.setAttribute('data-id', id);
  const middle = document.createElement('div');
  middle.className = 'middle';
  const popup = document.createElement('div');
  popup.className = 'item-popup';
  middle.appendChild(popup);
  if (withOfficialAdditional) {
    const additional = document.createElement('div');
    additional.className = 'itemPopupAdditional';
    middle.appendChild(additional);
  }
  const right = document.createElement('div');
  right.className = 'right';
  const details = document.createElement('div');
  details.className = 'details';
  right.appendChild(details);
  row.append(middle, right);
  return row;
}

describe('result stat badges layout', () => {
  let weaponRow: HTMLElement;
  let armourRow: HTMLElement;

  beforeEach(() => {
    resetI18nStateForTests('en');
    document.body.innerHTML = '';
    const rowTotal = document.createElement('div');
    rowTotal.className = 'row row-total';
    const results = document.createElement('div');
    results.className = 'results';
    weaponRow = buildRow('weapon-res-1', true);
    armourRow = buildRow('armour-res-1', false);
    results.append(weaponRow, armourRow);
    document.body.append(rowTotal, results);

    new ResultItemNormalizer('poe2').handleFetchResponse(
      JSON.stringify({
        url: 'https://www.pathofexile.com/api/trade2/fetch/item-1?query=q',
        data: { result: [weaponItem, armourItem] },
      }),
    );
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders badges in a dedicated strip after the item popup, not inside the official overlay', () => {
    const strip = weaponRow.querySelector('.middle > .poexd-stat-badges');
    expect(strip).toBeTruthy();
    expect(strip?.querySelector('[data-field="poexd-potential"]')).toBeTruthy();
    expect(strip?.querySelector('[data-field="poexd-sockets"]')).toBeTruthy();
    expect(weaponRow.querySelector('.itemPopupAdditional .poexd-additional')).toBeNull();
  });

  it('does not fake an official container for items without one', () => {
    expect(armourRow.querySelector('.poexd-custom-additional')).toBeNull();
    expect(armourRow.querySelector('.itemPopupAdditional')).toBeNull();
    const strip = armourRow.querySelector('.middle > .poexd-stat-badges');
    expect(strip?.querySelector('[data-field="poexd-potential-def"]')).toBeTruthy();
  });

  it('keeps a single strip when results are re-applied', () => {
    new ResultItemNormalizer('poe2').handleFetchResponse(
      JSON.stringify({
        url: 'https://www.pathofexile.com/api/trade2/fetch/item-1?query=q',
        data: { result: [weaponItem, armourItem] },
      }),
    );
    expect(weaponRow.querySelectorAll('.poexd-stat-badges')).toHaveLength(1);
    expect(weaponRow.querySelectorAll('[data-field="poexd-potential"]')).toHaveLength(1);
  });
});
