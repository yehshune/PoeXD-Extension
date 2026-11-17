import { ensureAffixLexiconLoaded, findModTiersByStatId } from './affix-lexicon';
import { createVisceraModIndex, type VisceraModIndex } from './pob-shopping-list';
import type { PoeVersion } from './trade-context';

/**
 * 臟器（PoE 1 3.30）詞綴索引：用詞綴字典（mods-tiers.json）裡臟器詞綴的部位標籤與代碼。
 * PoE 2 沒有臟器，回傳 undefined；字典載不到時判斷不出部位，購物清單會保留合成的臟器項目。
 */
export async function loadVisceraModIndex(
  version: PoeVersion,
): Promise<VisceraModIndex | undefined> {
  if (version !== 'poe1') return undefined;
  await ensureAffixLexiconLoaded(version, { displayLocale: 'en' });
  return createVisceraModIndex((statId) => findModTiersByStatId(statId, version, 'en'));
}
