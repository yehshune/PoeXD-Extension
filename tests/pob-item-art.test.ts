import { describe, expect, it, vi } from 'vitest';
import { itemArtFor, loadItemArt, parseItemArt } from '@/utils/pob-item-art';

const art = parseItemArt({
  patch: '3.27',
  schemaVersion: 1,
  bases: {
    'Royal Burgonet': ['Armours/Helmets/HelmetStr10', 2, 2],
    'Imperial Claw': ['Weapons/OneHandWeapons/Claws/Claw7', 2, 3],
    'Cobalt Jewel': ['Jewels/basicint', 1, 1],
    Absolution: ['Gems/AbsolutionBlastGem', 1, 1],
    'Quicksilver Flask': ['Flasks/sprint', 1, 2],
    'Added Fire Damage Support': ['Gems/Support/AddedFireDamage', 1, 1],
  },
  uniques: {
    'The Covetous Dark': ['Weapons/OneHandWeapons/Claws/Eyethief_Tier00'],
    Redbeak: ['Weapons/OneHandWeapons/OneHandSwords/OneHandSword1Unique', 1, 3],
  },
})!;

const CDN = 'https://web.poecdn.com/image/Art/2DItems/';

describe('pob item art', () => {
  it('底材以英文名稱查圖片與背包尺寸', () => {
    expect(itemArtFor(art, { kind: 'equipment', englishName: 'Royal Burgonet' })).toEqual({
      url: `${CDN}Armours/Helmets/HelmetStr10.png`,
      width: 2,
      height: 2,
    });
    expect(itemArtFor(art, { kind: 'equipment', englishName: 'Unknown Base' })).toBeUndefined();
  });

  it('傳奇用自己的圖片，尺寸取覆寫值或底材', () => {
    expect(
      itemArtFor(art, {
        kind: 'unique',
        englishName: 'The Covetous Dark',
        artBase: 'Imperial Claw',
      }),
    ).toEqual({
      url: `${CDN}Weapons/OneHandWeapons/Claws/Eyethief_Tier00.png`,
      width: 2,
      height: 3,
    });
    expect(itemArtFor(art, { kind: 'unique', englishName: 'Redbeak' })).toMatchObject({
      width: 1,
      height: 3,
    });
    // 查不到傳奇時退回底材圖片
    expect(
      itemArtFor(art, { kind: 'unique', englishName: 'Mystery', artBase: 'Cobalt Jewel' }),
    ).toMatchObject({ url: `${CDN}Jewels/basicint.png` });
  });

  it('寶石：轉換寶石退回原寶石的圖片', () => {
    expect(itemArtFor(art, { kind: 'gem', englishName: 'Absolution of Inspiring' })).toMatchObject({
      url: `${CDN}Gems/AbsolutionBlastGem.png`,
    });
    expect(
      itemArtFor(art, { kind: 'gem', englishName: 'Added Fire Damage Support' }),
    ).toMatchObject({ url: `${CDN}Gems/Support/AddedFireDamage.png` });
  });

  it('藥劑與寶石的圖是三格 sprite，附上疊加順序；一般裝備沒有', () => {
    expect(itemArtFor(art, { kind: 'equipment', englishName: 'Quicksilver Flask' })).toMatchObject({
      layers: [1, 2, 0],
    });
    expect(itemArtFor(art, { kind: 'gem', englishName: 'Absolution' })?.layers).toEqual([2, 0]);
    expect(
      itemArtFor(art, { kind: 'equipment', englishName: 'Royal Burgonet' }),
    ).not.toHaveProperty('layers');
  });

  it('格式不符的資料不採用；載入失敗回傳 undefined', async () => {
    expect(parseItemArt(null)).toBeUndefined();
    expect(parseItemArt({ bases: [], uniques: {} })).toBeUndefined();
    const loadJson = vi.fn(async () => {
      throw new Error('missing');
    });
    await expect(loadItemArt(loadJson, 'poe1')).resolves.toBeUndefined();
    expect(loadJson).toHaveBeenCalledWith('json/poe1/item-art.json');
  });
});
