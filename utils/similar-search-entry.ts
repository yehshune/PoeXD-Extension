/**
 * 找相似（ADR-0020）在側邊欄的入口：釘選物品與結果看板透過這裡開啟市集頁上的同一個工作階段。
 * 市集頁裝上找相似時登記；沒登記（主控台頁、其他頁面）時入口不顯示。
 */
import { shallowRef } from 'vue';
import { isSimilarSearchEligible } from './similar-item-search';
import type { PoeVersion } from './trade-context';

export interface SimilarSearchEntryPoint {
  version: PoeVersion;
  /** 以這件物品為 Source Item 開啟面板，面板放在 anchor 旁邊 */
  open(item: unknown, anchor: Element): void;
}

const current = shallowRef<SimilarSearchEntryPoint | null>(null);

export function provideSimilarSearchEntry(entry: SimilarSearchEntryPoint): () => void {
  current.value = entry;
  return () => {
    if (current.value === entry) current.value = null;
  };
}

/** 這件物品能不能找相似（在 Vue 範本中使用時會隨登記狀態更新） */
export function canFindSimilar(item: unknown, gameVersion?: PoeVersion): boolean {
  const entry = current.value;
  if (!entry || (gameVersion !== undefined && gameVersion !== entry.version)) return false;
  return isSimilarSearchEligible(item, entry.version);
}

export function findSimilar(item: unknown, anchor: Element, gameVersion?: PoeVersion): boolean {
  if (!canFindSimilar(item, gameVersion)) return false;
  current.value?.open(item, anchor);
  return true;
}

/**
 * 找相似執行時用到的官方 search id。結果看板依 fetch 跟隨搜尋，官方在找相似批次上
 * 換藏身處 token 時也會發 fetch，看板要略過這些 id，保留自己的搜尋。
 */
const similarSearchIds = new Set<string>();
const MAX_SIMILAR_SEARCH_IDS = 200;

export function markSimilarSearchId(searchId: string): void {
  if (similarSearchIds.size >= MAX_SIMILAR_SEARCH_IDS) {
    const oldest = similarSearchIds.values().next().value;
    if (oldest !== undefined) similarSearchIds.delete(oldest);
  }
  similarSearchIds.add(searchId);
}

export function isSimilarSearchId(searchId: string): boolean {
  return similarSearchIds.has(searchId);
}
