/**
 * 詞綴代碼網域前綴（`explicit`、`fractured`、`crafted`…）的排序與可切換清單。
 * PoB 購物清單與搜尋預覽切換網域時共用。
 */

/** 常用的網域在前，其餘依市集資料的順序 */
const DOMAIN_ORDER = ['explicit', 'implicit', 'crafted', 'enchant', 'fractured'];
/** 總和條件的代碼不是物品上的詞綴，不提供切換 */
const NON_SWITCHABLE_DOMAINS = new Set(['pseudo']);
const STAT_ID = /^([a-z]+)\.([^|]+)/;

const rank = (domain: string): number => {
  const index = DOMAIN_ORDER.indexOf(domain);
  return index < 0 ? DOMAIN_ORDER.length : index;
};

/** 代碼後綴 → 市集上存在的網域前綴 */
export type StatDomainIndex = ReadonlyMap<string, readonly string[]>;

/** 由市集的所有代碼建立「後綴 → 可切換的網域」索引（依常用程度排序） */
export function buildStatDomainIndex(statIds: Iterable<string>): StatDomainIndex {
  const index = new Map<string, string[]>();
  for (const statId of statIds) {
    const parsed = STAT_ID.exec(statId);
    if (!parsed || NON_SWITCHABLE_DOMAINS.has(parsed[1])) continue;
    const domains = index.get(parsed[2]) ?? [];
    if (!domains.includes(parsed[1])) index.set(parsed[2], [...domains, parsed[1]]);
  }
  for (const [suffix, domains] of index) {
    index.set(
      suffix,
      [...domains].sort((left, right) => rank(left) - rank(right)),
    );
  }
  return index;
}

/** 同一個代碼後綴可切換的網域；代碼不在索引裡（或是總和代碼）時回傳空陣列 */
export function statDomainsOf(index: StatDomainIndex, statId: string): string[] {
  const parsed = STAT_ID.exec(statId);
  if (!parsed || NON_SWITCHABLE_DOMAINS.has(parsed[1])) return [];
  return [...(index.get(parsed[2]) ?? [])];
}

/** 市集代碼的網域前綴：`explicit.stat_1` → `explicit` */
export const statDomainOf = (statId: string): string => statId.slice(0, statId.indexOf('.'));

/** 換掉代碼的網域前綴；domain 省略時原樣回傳 */
export const withStatDomain = (statId: string, domain: string | undefined): string =>
  domain ? `${domain}${statId.slice(statId.indexOf('.'))}` : statId;
