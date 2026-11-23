import { describe, expect, it } from 'vitest';
import {
  findAscendancyFolderIcon,
  getFolderImageIcons,
  normalizeFolderColor,
  normalizeFolderIcon,
  resolveFolderIcon,
} from '@/utils/folder-icons';

describe('folder icons catalog & helpers', () => {
  it('filters class/ascendancy portraits by game version', () => {
    const poe1Classes = getFolderImageIcons('class', 'poe1');
    const poe2Classes = getFolderImageIcons('class', 'poe2');

    expect(poe1Classes.some((i) => i.id === 'poe1:asc:Slayer')).toBe(true);
    expect(poe1Classes.some((i) => i.id === 'poe2:asc:Invoker')).toBe(false);

    expect(poe2Classes.some((i) => i.id === 'poe2:asc:Invoker')).toBe(true);
    expect(poe2Classes.some((i) => i.id === 'poe1:asc:Slayer')).toBe(false);
  });

  it('normalizes valid icons and colors while dropping TFT and unknown values', () => {
    expect(normalizeFolderIcon('TFT')).toBeUndefined();
    expect(normalizeFolderIcon('unknown:icon')).toBeUndefined();
    expect(normalizeFolderIcon('poe1:asc:Slayer')).toBe('poe1:asc:Slayer');
    expect(normalizeFolderIcon('item:divine')).toBe('item:divine');
    expect(normalizeFolderIcon('atlas:breach')).toBe('atlas:breach');
    expect(normalizeFolderIcon('lucide:star')).toBe('lucide:star');

    expect(normalizeFolderColor('amber')).toBe('amber');
    expect(normalizeFolderColor('invalid-color')).toBeUndefined();
  });

  it('resolves image and lucide icons with wide flag', () => {
    const wide = resolveFolderIcon('poe1:asc:Necromancer');
    expect(wide?.kind).toBe('image');
    if (wide?.kind === 'image') {
      expect(wide.wide).toBe(true);
      expect(wide.url).toContain('poe1-asc-necromancer.webp');
    }

    const square = resolveFolderIcon('item:divine');
    expect(square?.kind).toBe('image');
    if (square?.kind === 'image') {
      expect(square.wide).toBe(false);
    }

    const lucide = resolveFolderIcon('lucide:zap');
    expect(lucide).toMatchObject({ kind: 'lucide', iconKey: 'zap' });
  });

  it('matches PoB ascendancy and falls back to base class per game version', () => {
    expect(findAscendancyFolderIcon('poe1', 'Slayer', 'Duelist')).toBe('poe1:asc:Slayer');
    expect(findAscendancyFolderIcon('poe1', 'None', 'Witch')).toBe('poe1:class:Witch');
    expect(findAscendancyFolderIcon('poe2', 'Smith of Kitava', 'Warrior')).toBe(
      'poe2:asc:Smith of Kitava',
    );
    expect(findAscendancyFolderIcon('poe2', 'Invoker', 'Monk')).toBe('poe2:asc:Invoker');
    expect(findAscendancyFolderIcon('poe2', undefined, 'Sorceress')).toBe('poe2:class:Sorceress');
  });
});
