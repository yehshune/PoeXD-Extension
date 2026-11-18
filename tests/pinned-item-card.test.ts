// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { renderPinnedItemCard } from '@/components/sidebar/pinned-items/pinned-item-card';
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
    expect(card.querySelector('.item-mod--corrupted')).not.toBeNull();
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
