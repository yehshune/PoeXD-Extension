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

// 官方 /fetch 新版格式的詞綴為物件並附 stat hash；hash 取 PoE 1 實際 stat id，僅供官方卡片渲染
const FAKE_MODS = [
  { text: '+85 to maximum Life', stat: 'stat_3299347043', min: '80', max: '89' },
  { text: '+42% to Fire Resistance', stat: 'stat_3372524247', min: '42', max: '45' },
  { text: '+38% to Cold Resistance', stat: 'stat_4220027924', min: '36', max: '41' },
  { text: '+31% to Lightning Resistance', stat: 'stat_1671376347', min: '30', max: '35' },
  { text: '+45 to Intelligence', stat: 'stat_328541901', min: '43', max: '50' },
  { text: '12% increased Movement Speed', stat: 'stat_2250533757', min: '10', max: '14' },
  { text: '+60 to maximum Energy Shield', stat: 'stat_3489782002', min: '56', max: '67' },
] as const;

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

/**
 * 官方結果卡片以 `item.extended` 為渲染前提（缺少時整張卡片不渲染，2026-11-24 實機確認），
 * 因此假資料比照新版 /fetch：詞綴為 `{ description, domain, hash, mods }`，並附 rarity、
 * frameTypeId、extended（hashes 與 base64 物品文字）與 listing.fee。
 * 不附 hideout_token，避免誤點「前往藏身處」時以假 token 呼叫官方 API。
 */
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
  const name = `Dev Fake ${index}`;
  const ilvl = 80 + (index % 7);
  const note = `~price ${amount} chaos`;
  const itemText = [
    'Rarity: Rare',
    name,
    base.typeLine,
    '--------',
    `Item Level: ${ilvl}`,
    '--------',
    ...mods.map((mod) => mod.text),
    '--------',
    `Note: ${note}`,
    '',
  ].join('\r\n');
  return {
    id,
    listing: {
      method: 'psapi',
      indexed: new Date(now - index * 1000).toISOString(),
      stash: { name: note, x: index % 12, y: index % 12 },
      whisper: `@DevTester Hi, I would like to buy your ${name} listed for {0} in ${league}`,
      account: {
        name: 'DevTester#0000',
        online: { league },
        lastCharacterName: 'DevTesterChar',
        language: 'en_US',
        realm: gameVersion === 'poe2' ? 'poe2' : 'pc',
      },
      price: { type: '~price', amount, currency: 'chaos' },
      fee: amount * 10,
    },
    item: {
      verified: true,
      w: base.w,
      h: base.h,
      icon: `https://web.poecdn.com/image/${base.icon}`,
      league,
      id: `${id}item`,
      name,
      typeLine: base.typeLine,
      baseType: base.typeLine,
      rarity: 'Rare',
      identified: true,
      ilvl,
      note,
      frameType: 2,
      frameTypeId: 'Rare',
      explicitMods: mods.map((mod) => ({
        description: mod.text,
        domain: 'explicit',
        hash: `stat.explicit.${mod.stat}`,
        mods: [{ magnitudes: [{ min: mod.min, max: mod.max }] }],
      })),
      extended: {
        hashes: {
          explicit: mods.map((mod, modIndex) => [`explicit.${mod.stat}`, [modIndex]]),
        },
        text: btoa(itemText),
      },
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
