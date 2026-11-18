// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { renderPinnedItemCard } from '@/components/sidebar/pinned-items/pinned-item-card';
import { createResultTranslator } from '@/utils/market-result-translator';
import { createPinnedItemSnapshot } from '@/utils/pinned-items';

const XSS = '<img src=x onerror="alert(1)">';

function snapshotOf(item: Record<string, unknown>) {
  const snapshot = createPinnedItemSnapshot(
    { id: 'r1', item, listing: {} },
    { gameVersion: 'poe1', origin: 'https://www.pathofexile.com', league: 'Covens' },
    1,
  );
  if (!snapshot) throw new Error('snapshot failed');
  return snapshot;
}

describe('renderPinnedItemCard', () => {
  it('renders official classes for header, properties and mods', () => {
    const card = renderPinnedItemCard(
      snapshotOf({
        name: 'Kraken Span',
        typeLine: 'Goathide Boots',
        frameType: 2,
        ilvl: 70,
        icon: 'https://web.poecdn.com/gen/image/boots.png',
        properties: [{ name: 'Evasion Rating', values: [['120', 1]], displayMode: 0 }],
        requirements: [{ name: 'Level', values: [['52', 0]], displayMode: 0 }],
        implicitMods: ['[Dexterity|+10 to Dexterity]'],
        explicitMods: [
          { description: '+20 to maximum Life', hash: 'stat.explicit.stat_3299347043' },
        ],
        craftedMods: ['+15% to Fire Resistance'],
        corrupted: true,
      }),
    );
    expect(card.querySelector('.item-popup')?.className).toBe('item-popup item-popup--rare');
    expect(
      [...card.querySelectorAll('.item-popup__header-line')].map((n) => n.textContent),
    ).toEqual(['Kraken Span', 'Goathide Boots']);
    expect(card.querySelector('.item-popup__header--double')).not.toBeNull();
    expect(card.querySelector('.item-popup__property')?.textContent).toBe('Evasion Rating: 120');
    expect(card.querySelector('.item-mod--implicit')?.textContent).toBe('+10 to Dexterity');
    expect(card.querySelector('.item-mod--explicit')?.textContent).toBe('+20 to maximum Life');
    expect(card.querySelector('.item-mod--crafted')).not.toBeNull();
    expect(card.querySelector('.item-popup__content > div:not([class]) > .lc')?.textContent).toBe(
      'Corrupted',
    );
    expect(card.querySelector('img')?.getAttribute('src')).toBe(
      'https://web.poecdn.com/gen/image/boots.png',
    );
  });

  it('substitutes displayMode 3 placeholders', () => {
    const card = renderPinnedItemCard(
      snapshotOf({
        typeLine: 'Flask',
        frameType: 0,
        properties: [{ name: 'Lasts {0} Seconds', values: [['4.00', 0]], displayMode: 3 }],
      }),
    );
    expect(card.querySelector('.item-popup__property')?.textContent).toBe('Lasts 4.00 Seconds');
  });

  it('renders hostile strings as text only', () => {
    const card = renderPinnedItemCard(
      snapshotOf({
        name: XSS,
        typeLine: XSS,
        frameType: 2,
        note: XSS,
        explicitMods: [XSS],
        properties: [{ name: XSS, values: [[XSS, 0]], displayMode: 0 }],
      }),
    );
    expect(card.querySelectorAll('img')).toHaveLength(0);
    expect(card.querySelector('[onerror]')).toBeNull();
    expect(card.textContent).toContain(XSS);
  });

  it('does not render icons from other hosts', () => {
    const card = renderPinnedItemCard(
      snapshotOf({ typeLine: 'Ring', frameType: 1, icon: 'https://evil.example/x.png' }),
    );
    expect(card.querySelector('img')).toBeNull();
  });
});

describe('renderPinnedItemCard markup for Market Translation', () => {
  it('writes the official stat data-field from mod objects and extended.hashes', () => {
    const card = renderPinnedItemCard(
      snapshotOf({
        typeLine: 'Heavy Belt',
        implicitMods: ['+35 to Strength'],
        explicitMods: [
          { description: '+42 to Dexterity', hash: 'stat.explicit.stat_3261801346' },
          { description: 'Bad hash', hash: 'stat.explicit.<img>' },
          'Line one\nLine two',
        ],
        extended: {
          hashes: {
            implicit: [['implicit.stat_4080418644', [0]]],
            explicit: [
              ['explicit.stat_3261801346', [0]],
              ['explicit.stat_1', [1]],
              ['explicit.stat_2', [2]],
            ],
          },
        },
      }),
    );
    const fields = [...card.querySelectorAll('.item-mod > span')].map((span) =>
      span.getAttribute('data-field'),
    );
    expect(fields).toEqual([
      'stat.implicit.stat_4080418644',
      'stat.explicit.stat_3261801346',
      null,
      'stat.explicit.stat_2',
    ]);
    const multiLine = card.querySelectorAll('.item-mod--explicit > span')[2]!;
    expect(multiLine.querySelectorAll('br')).toHaveLength(1);
    expect(multiLine.textContent).toBe('Line oneLine two');
  });

  it('renders flags as unclassed div > span.lc like official rows', () => {
    const card = renderPinnedItemCard(
      snapshotOf({ typeLine: 'Heavy Belt', corrupted: true, identified: false }),
    );
    expect(
      [...card.querySelectorAll('.item-popup__content > div:not([class]) > .lc')].map(
        (n) => n.textContent,
      ),
    ).toEqual(['Unidentified', 'Corrupted']);
  });

  it('lets the Market Translation result translator translate the card', () => {
    const card = renderPinnedItemCard(
      snapshotOf({
        name: 'Mageblood',
        typeLine: 'Heavy Belt',
        ilvl: 75,
        explicitMods: [{ description: '+42 to Dexterity', hash: 'stat.explicit.stat_3261801346' }],
        corrupted: true,
      }),
    );
    document.body.appendChild(card);
    createResultTranslator({
      modLines: { '3261801346': [['{0:+d} to Dexterity', '{0:+d} 敏捷']] },
      items: { 'heavy belt': '重革腰帶' },
      labels: { 'Item Level': '物品等級', Corrupted: '已汙染' },
    }).translate(document.body);
    expect(
      [...card.querySelectorAll('.item-popup__header-line')].map((n) => n.textContent),
    ).toEqual(['Mageblood', '重革腰帶']);
    expect(card.querySelector('[data-field^="stat."]')?.textContent).toBe('+42 敏捷');
    expect(card.querySelector('.item-property')?.textContent).toContain('物品等級');
    expect(card.querySelector('.item-popup__content > div:not([class])')?.textContent).toBe(
      '已汙染',
    );
    card.remove();
  });
});
