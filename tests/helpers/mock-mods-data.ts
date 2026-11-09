import { setAffixLexiconMockData } from '@/utils/affix-lexicon';

/**
 * 以已展開的 group → tiers 測試資料取代 mods-tiers artifact（兩個遊戲版本皆套用）。
 * 正式環境只接受 mods-tiers artifact，舊格式資料只能透過此 mock 注入。
 */
export function mockModsData(modsByGroup: Record<string, unknown[]>): void {
  setAffixLexiconMockData('poe1', modsByGroup as never);
  setAffixLexiconMockData('poe2', modsByGroup as never);
}
