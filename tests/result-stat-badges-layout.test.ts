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
  const left = document.createElement('div');
  left.className = 'left';
  const iconContainer = document.createElement('div');
  iconContainer.className = 'newItemContainer';
  left.appendChild(iconContainer);
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
  row.append(left, middle, right);
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

  it('renders socket potential under .left image and removes legacy bottom stat badges strip', () => {
    expect(weaponRow.querySelector('.poexd-stat-badges')).toBeNull();
    expect(weaponRow.querySelector('[data-field="poexd-potential"]')).toBeNull();
    expect(armourRow.querySelector('[data-field="poexd-potential-def"]')).toBeNull();

    const leftStrip = weaponRow.querySelector('.left > .poexd-left-badges');
    expect(leftStrip).toBeTruthy();
    expect(leftStrip?.querySelector('[data-field="poexd-sockets"]')).toBeTruthy();
    expect(weaponRow.querySelector('.itemPopupAdditional .poexd-additional')).toBeNull();
  });

  it('does not fake an official container for items without one', () => {
    expect(armourRow.querySelector('.poexd-custom-additional')).toBeNull();
    expect(armourRow.querySelector('.itemPopupAdditional')).toBeNull();
    expect(armourRow.querySelector('.poexd-stat-badges')).toBeNull();
    expect(
      armourRow.querySelector('.left > .poexd-left-badges [data-field="poexd-sockets"]'),
    ).toBeTruthy();
  });

  it('keeps a single left socket strip when results are re-applied', () => {
    new ResultItemNormalizer('poe2').handleFetchResponse(
      JSON.stringify({
        url: 'https://www.pathofexile.com/api/trade2/fetch/item-1?query=q',
        data: { result: [weaponItem, armourItem] },
      }),
    );
    expect(weaponRow.querySelectorAll('.poexd-left-badges')).toHaveLength(1);
    expect(weaponRow.querySelectorAll('[data-field="poexd-sockets"]')).toHaveLength(1);
  });

  it('appends per-stat inline overrides inside .itemPopupAdditional without duplicating badges', () => {
    const hybridItem = {
      id: 'hybrid-armour-1',
      item: {
        id: 'item-3',
        realm: 'poe2',
        name: 'Beast Curtain',
        typeLine: 'Briar Cuirass',
        baseType: 'Briar Cuirass',
        ilvl: 75,
        properties: [
          { name: 'Armour', values: [['492', 1]], type: 16 },
          { name: 'Evasion Rating', values: [['448', 1]], type: 17 },
        ],
        explicitMods: [
          {
            description: '31% increased Armour and Evasion',
            hash: 'stat.explicit.stat_2451402625',
          },
        ],
        sockets: [],
        extended: { category: 'body-armour', ar: 492, ev: 448 },
      },
    };

    const hybridRow = buildRow('hybrid-armour-1', true);
    const additional = hybridRow.querySelector('.itemPopupAdditional')!;
    additional.innerHTML = [
      '<span data-field="ar" class="s lc s aug">護甲<span class="colourAugmented">492</span></span>',
      '<span data-field="ev" class="s lc s aug">閃避<span class="colourAugmented">448</span></span>',
      '<span data-field="es" class="s lc s invisible">能量護盾<span class="colourDefault"></span></span>',
    ].join('');
    document.querySelector('.results')!.appendChild(hybridRow);

    const normalizer = new ResultItemNormalizer('poe2');
    normalizer.handleFetchResponse(
      JSON.stringify({
        url: 'https://www.pathofexile.com/api/trade2/fetch/item-3?query=q2',
        data: { result: [hybridItem] },
      }),
    );

    const arInline = hybridRow.querySelector('[data-field="ar"] .poexd-inline-override');
    const evInline = hybridRow.querySelector('[data-field="ev"] .poexd-inline-override');
    const esInline = hybridRow.querySelector('[data-field="es"] .poexd-inline-override');

    expect(arInline?.textContent).toBe('➔642');
    expect(evInline?.textContent).toBe('➔585');
    expect(esInline).toBeNull();
    expect(hybridRow.querySelectorAll('.poexd-inline-override')).toHaveLength(2);
    expect(hybridRow.querySelector('.poexd-stat-badges')).toBeNull();
    expect(
      hybridRow.querySelector('.left > .poexd-left-badges [data-field="poexd-sockets"]'),
    ).toBeTruthy();

    // 切換目標符文時，行內預估值同步更新且不重複建立節點；停用後完整清除
    normalizer.setRuneConfig({ armourRune: { type: 'def_percent', value: 18 } });
    expect(hybridRow.querySelector('[data-field="ar"] .poexd-inline-override')?.textContent).toBe(
      '➔627',
    );
    expect(hybridRow.querySelectorAll('[data-field="ar"] .poexd-inline-override')).toHaveLength(1);

    normalizer.setEnabled(false);
    expect(hybridRow.querySelectorAll('.poexd-inline-override')).toHaveLength(0);
    expect(hybridRow.querySelectorAll('.poexd-left-badges')).toHaveLength(0);
  });

  it('skips redundant inline override when a stat is already unchanged after rune substitution', () => {
    const maxedWeapon = {
      id: 'maxed-weapon-1',
      item: {
        id: 'item-4',
        realm: 'poe2',
        name: 'Optimal Pole',
        typeLine: 'Sinister Quarterstaff',
        baseType: 'Sinister Quarterstaff',
        ilvl: 80,
        properties: [{ name: 'Attacks per Second', values: [['1.50', 0]], type: 13 }],
        sockets: [
          { group: 0, type: 'rune' },
          { group: 1, type: 'rune' },
        ],
        socketedItems: [{}, {}],
        runeMods: [
          { description: '40% increased Physical Damage', hash: 'stat.rune.stat_1509134228' },
        ],
        explicitMods: [
          { description: '100% increased Physical Damage', hash: 'stat.explicit.stat_1509134228' },
        ],
        extended: { dps: 500, pdps: 500, edps: 0 },
      },
    };

    const row = buildRow('maxed-weapon-1', true);
    row.querySelector('.itemPopupAdditional')!.innerHTML = [
      '<span data-field="dps" class="s lc">DPS<span class="colourAugmented">500</span></span>',
      '<span data-field="pdps" class="s lc">pDPS<span class="colourAugmented">500</span></span>',
    ].join('');
    document.querySelector('.results')!.appendChild(row);

    new ResultItemNormalizer('poe2').handleFetchResponse(
      JSON.stringify({
        url: 'https://www.pathofexile.com/api/trade2/fetch/item-4?query=q3',
        data: { result: [maxedWeapon] },
      }),
    );

    expect(row.querySelectorAll('.poexd-inline-override')).toHaveLength(0);
  });

  it('injects layout-specific inline override CSS suppressing official span::before colons', () => {
    const styleEl = document.getElementById('poexd-normalized-stats-style-v2');
    expect(styleEl?.textContent).toContain('.poexd-inline-override::before');
    expect(styleEl?.textContent).toContain('content: none !important');
    expect(styleEl?.textContent).toContain('.results.compact .row .middle .itemPopupAdditional');
    expect(styleEl?.textContent).toContain(
      '.results:not(.compact) .row .middle .itemPopupAdditional',
    );
  });

  it('compares potential against DOM-displayed popup number so quality-only overrides render when DOM is unprojected', () => {
    const row1 = buildRow('row-unprojected', true);
    const add1 = row1.querySelector('.itemPopupAdditional')!;
    add1.innerHTML =
      '<span class="s" data-field="ev"><span class="lc">Evasion</span><span class="colourDefault">265</span></span>';

    const row2 = buildRow('row-projected', true);
    const add2 = row2.querySelector('.itemPopupAdditional')!;
    add2.innerHTML =
      '<span class="s" data-field="ev"><span class="lc">Evasion</span><span class="colourDefault">318</span></span>';

    document.querySelector('.results')!.append(row1, row2);

    const makeArmourItem = (id: string) => ({
      id,
      item: {
        realm: 'poe2',
        name: '',
        typeLine: 'Leather Vest',
        baseType: 'Leather Vest',
        category: { armour: ['chest'] },
        ilvl: 75,
        corrupted: false,
        sockets: [],
        properties: [{ name: '[Evasion|Evasion Rating]', values: [['265', 0]], type: 17 }],
      },
    });

    const normalizer = new ResultItemNormalizer('poe2');
    normalizer.setRuneConfig({ armourRune: { type: 'none', value: 0 } });
    normalizer.handleFetchResponse(
      JSON.stringify({
        url: 'https://www.pathofexile.com/api/trade2/fetch/row-unprojected,row-projected?query=q4',
        data: {
          result: [makeArmourItem('row-unprojected'), makeArmourItem('row-projected')],
        },
      }),
    );

    const override1 = row1.querySelector('[data-field="ev"] .poexd-inline-override');
    expect(override1?.textContent).toContain('318');

    const override2 = row2.querySelector('[data-field="ev"] .poexd-inline-override');
    expect(override2).toBeNull();
  });
});
