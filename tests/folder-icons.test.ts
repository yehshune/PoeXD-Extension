import { describe, expect, it } from 'vitest';
import { createUiRuntimeTokenValues, LAYOUT_TOKENS } from '@/lib/tokens';
import {
  applyFolderAppearance,
  findAscendancyFolderIcon,
  getFolderImageIcons,
  isDefaultAscendancyBuildName,
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

  it('recognizes default PoB build names across en, zh-TW, and zh-CN and applies folder appearance', () => {
    expect(
      isDefaultAscendancyBuildName('poe1', 'Chieftain Lv.97', 'Chieftain', 'Marauder', 97),
    ).toBe(true);
    expect(isDefaultAscendancyBuildName('poe1', '酋長 Lv.97', 'Chieftain', 'Marauder', 97)).toBe(
      true,
    );
    expect(isDefaultAscendancyBuildName('poe1', '酋长 Lv.97', 'Chieftain', 'Marauder', 97)).toBe(
      true,
    );
    expect(isDefaultAscendancyBuildName('poe1', 'My Custom RF', 'Chieftain', 'Marauder', 97)).toBe(
      false,
    );

    const target: { id: string; icon?: string; color?: string } = {
      id: 'g1',
      icon: 'item:divine',
      color: 'amber',
    };
    applyFolderAppearance(target, { icon: 'TFT', color: undefined });
    expect(target.icon).toBeUndefined();
    expect(target.color).toBeUndefined();
  });

  it('scales folder icon slot and picker geometry tokens with UI Scale while staying Density-invariant', () => {
    const s085 = createUiRuntimeTokenValues({ scale: 0.85, density: 1.0 });
    const s100 = createUiRuntimeTokenValues({ scale: 1.0, density: 1.0 });
    const s120 = createUiRuntimeTokenValues({ scale: 1.2, density: 1.0 });
    const sCompact = createUiRuntimeTokenValues({ scale: 1.0, density: 0.8 });

    expect(s100[LAYOUT_TOKENS.folderIconSlotWidthVar]).toBe('32px');
    expect(s100[LAYOUT_TOKENS.folderIconSlotHeightVar]).toBe('24px');
    expect(s100[LAYOUT_TOKENS.folderIconPickerPanelHeightVar]).toBe('264px');

    expect(s085[LAYOUT_TOKENS.folderIconSlotWidthVar]).toBe('27.2px');
    expect(s120[LAYOUT_TOKENS.folderIconSlotWidthVar]).toBe('38.4px');
    expect(s120[LAYOUT_TOKENS.folderIconPickerPanelHeightVar]).toBe('316.8px');

    expect(sCompact[LAYOUT_TOKENS.folderIconSlotWidthVar]).toBe(
      s100[LAYOUT_TOKENS.folderIconSlotWidthVar],
    );
    expect(sCompact[LAYOUT_TOKENS.folderIconPickerPanelHeightVar]).toBe(
      s100[LAYOUT_TOKENS.folderIconPickerPanelHeightVar],
    );
  });
});
