/**
 * 釘選物品清單搜尋過濾：比對物品名稱、基底、詞綴、備註、賣家帳號、聯盟與快照彈窗文字。
 */
import type { PinnedCardNode } from '@/utils/pinned-card-dom';
import type { PinnedItemSnapshot } from '@/utils/pinned-items';

const MOD_KEYS = [
  'enchantMods',
  'implicitMods',
  'explicitMods',
  'craftedMods',
  'fracturedMods',
  'scourgeMods',
  'crucibleMods',
  'utilityMods',
  'runeMods',
  'desecratedMods',
  'sanctumMods',
  'veiledMods',
] as const;

const unwrapMarkup = (value: string): string => value.replace(/\[(?:[^\]|]*\|)?([^\]]*)\]/g, '$1');

const searchableTextCache = new WeakMap<PinnedItemSnapshot, string>();

function collectCardNodeText(node: PinnedCardNode, out: string[]): void {
  if (typeof node === 'string') {
    if (node.trim()) out.push(node);
    return;
  }
  if (node.k) {
    for (const child of node.k) {
      collectCardNodeText(child, out);
    }
  }
}

function collectModText(entry: unknown, out: string[]): void {
  if (typeof entry === 'string') {
    if (entry) out.push(unwrapMarkup(entry));
    return;
  }
  if (typeof entry === 'object' && entry !== null && !Array.isArray(entry)) {
    const desc = (entry as { description?: unknown }).description;
    if (typeof desc === 'string' && desc) out.push(unwrapMarkup(desc));
  }
}

export function getPinnedItemSearchText(snapshot: PinnedItemSnapshot): string {
  const cached = searchableTextCache.get(snapshot);
  if (cached !== undefined) return cached;

  const parts: string[] = [];
  const item = snapshot.item;
  for (const key of ['name', 'typeLine', 'baseType', 'note'] as const) {
    const val = item[key];
    if (typeof val === 'string' && val) parts.push(unwrapMarkup(val));
  }
  for (const key of MOD_KEYS) {
    const list = item[key];
    if (Array.isArray(list)) {
      for (const entry of list) collectModText(entry, parts);
    }
  }
  if (snapshot.listing.accountName) parts.push(snapshot.listing.accountName);
  if (snapshot.listing.price?.currency) parts.push(snapshot.listing.price.currency);
  if (snapshot.listing.price?.currencyName) parts.push(snapshot.listing.price.currencyName);
  if (snapshot.league) parts.push(snapshot.league);

  if (snapshot.card?.popup) {
    for (const node of snapshot.card.popup) {
      collectCardNodeText(node, parts);
    }
  }

  const normalized = parts.join('\n').toLowerCase();
  searchableTextCache.set(snapshot, normalized);
  return normalized;
}

export function filterPinnedItems(
  items: readonly PinnedItemSnapshot[],
  query: string,
): PinnedItemSnapshot[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [...items];
  return items.filter((item) => {
    const text = getPinnedItemSearchText(item);
    return tokens.every((token) => text.includes(token));
  });
}
