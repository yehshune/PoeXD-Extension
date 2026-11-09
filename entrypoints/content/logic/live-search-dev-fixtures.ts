import type { LiveSearchDevResultOwner } from '@/utils/live-search-contract';
import type { PoeVersion } from '@/utils/trade-context';
import { getTradeSearchCanonicalKey } from '@/utils/trade-search-identity';
import type { SyntheticLiveSearchResult } from './live-search-primary-runtime';

/**
 * 開發測試用假結果（僅 dev build 使用）
 *
 * 形狀比照官方 /api/trade/fetch 回應的單筆 result（id + listing + item），
 * 讓官方 Vue 結果元件能正常渲染；不含任何真實帳號或交易資料。
 */

const FAKE_BASES = [
  { typeLine: 'Vaal Regalia', icon: 'Art/2DItems/Armours/BodyArmours/BodyInt1A.png', w: 2, h: 3 },
  { typeLine: 'Hubris Circlet', icon: 'Art/2DItems/Armours/Helmets/HelmetInt9.png', w: 2, h: 2 },
  { typeLine: 'Sorcerer Boots', icon: 'Art/2DItems/Armours/Boots/BootsInt6.png', w: 2, h: 2 },
  { typeLine: 'Stygian Vise', icon: 'Art/2DItems/Belts/Belt7.png', w: 2, h: 1 },
  { typeLine: 'Two-Stone Ring', icon: 'Art/2DItems/Rings/TopazSapphire.png', w: 1, h: 1 },
] as const;

const FAKE_MODS = [
  '+85 to maximum Life',
  '+42% to Fire Resistance',
  '+38% to Cold Resistance',
  '+31% to Lightning Resistance',
  '+45 to Intelligence',
  '12% increased Movement Speed',
  '+60 to maximum Energy Shield',
];

export const DEV_FALLBACK_SEARCH_IDS = ['devFakeSearchA', 'devFakeSearchB', 'devFakeSearchC'];

export function buildFallbackDevOwners(
  gameVersion: PoeVersion,
  league: string,
): LiveSearchDevResultOwner[] {
  return DEV_FALLBACK_SEARCH_IDS.map((searchId) => ({
    searchId,
    canonicalKey: getTradeSearchCanonicalKey({ gameVersion, league, searchId }),
  }));
}

export function buildFakeTradeResult(
  index: number,
  league: string,
  gameVersion: PoeVersion,
  now: number = Date.now(),
): SyntheticLiveSearchResult['itemData'] {
  const base = FAKE_BASES[index % FAKE_BASES.length];
  const mods = Array.from(
    { length: 3 + (index % 3) },
    (_, offset) => FAKE_MODS[(index + offset) % FAKE_MODS.length],
  );
  const id = `devfake${now.toString(36)}${index.toString(36).padStart(4, '0')}`;
  const amount = 1 + (index % 50);
  return {
    id,
    listing: {
      method: 'psapi',
      indexed: new Date(now - index * 1000).toISOString(),
      stash: { name: `~price ${amount} chaos`, x: index % 12, y: index % 12 },
      whisper: `@DevTester Hi, I would like to buy your Dev Fake ${index} listed for {0} in ${league}`,
      account: {
        name: 'DevTester#0000',
        online: { league },
        lastCharacterName: 'DevTesterChar',
        language: 'en_US',
        realm: gameVersion === 'poe2' ? 'poe2' : 'pc',
      },
      price: { type: '~price', amount, currency: 'chaos' },
    },
    item: {
      verified: true,
      w: base.w,
      h: base.h,
      icon: `https://web.poecdn.com/image/${base.icon}`,
      league,
      id: `${id}item`,
      name: `Dev Fake ${index}`,
      typeLine: base.typeLine,
      baseType: base.typeLine,
      identified: true,
      ilvl: 80 + (index % 7),
      frameType: 2,
      explicitMods: mods,
    },
  };
}

export function buildFakeTradeResults(
  count: number,
  league: string,
  gameVersion: PoeVersion,
  owners: readonly LiveSearchDevResultOwner[],
  now: number = Date.now(),
): SyntheticLiveSearchResult[] {
  if (owners.length === 0) return [];
  const safeCount = Math.max(0, Math.min(1000, Math.floor(count)));
  return Array.from({ length: safeCount }, (_, index) => {
    const owner = owners[index % owners.length];
    return {
      itemData: buildFakeTradeResult(index, league, gameVersion, now),
      sourceSearchId: owner.searchId,
      ownerKey: owner.canonicalKey,
    };
  });
}
