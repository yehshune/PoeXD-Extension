import type { CSSProperties } from 'vue';
import { getActiveDisplayLocale, getActiveUiLocale } from './i18n';
import { getOfficialStatDomainLabel } from './official-stat-text';
import type { SupportedUiLocale } from './preferences-contract';
import { splitStatId } from './stat-domain-order';
import type { PoeVersion } from './trade-context';

/** 所有在 `assets/main.css` 定義 `--pxd-stat-*` token 的官方詞綴網域。 */
export const STAT_DOMAIN_KEYS = [
  'explicit',
  'implicit',
  'crafted',
  'enchant',
  'fractured',
  'pseudo',
  'imbued',
  'scourge',
  'delve',
  'ultimatum',
  'sanctum',
  'crucible',
  'mercenary',
  'veiled',
  'monster',
  'rune',
  'desecrated',
  'skill',
] as const;

export type StatDomainKey = (typeof STAT_DOMAIN_KEYS)[number];

const STAT_DOMAIN_SET = new Set<string>(STAT_DOMAIN_KEYS);

/** PoB 與書籤／歷史預覽共用的網域標籤外觀類別。 */
export const STAT_DOMAIN_BADGE_CLASS =
  'pxd-stat-domain-badge shrink-0 whitespace-nowrap rounded-sm border border-transparent px-[var(--pxd-space-xs)] py-px text-[length:var(--pxd-font-caption)] font-semibold leading-[1.3]';

/**
 * 同步 fallback 對照表（取自各語系官方 trade-stats.json `labels`）：
 * 官方分片或即時頁面資料尚未載入／無網路時，仍能即時呈現一致的官方標籤。
 */
const FALLBACK_DOMAIN_LABELS: Readonly<
  Record<SupportedUiLocale, Readonly<Record<StatDomainKey, string>>>
> = {
  'zh-TW': {
    explicit: '隨機屬性',
    implicit: '固性屬性',
    crafted: '已工藝',
    enchant: '附魔',
    fractured: '破裂',
    pseudo: '偽屬性',
    imbued: '注能',
    scourge: '災魘聯盟',
    delve: '掘獄聯盟',
    ultimatum: '最後通牒',
    sanctum: '聖域',
    crucible: '熔火冥獄',
    mercenary: '傭兵',
    veiled: '隱匿',
    monster: '怪物',
    rune: '增幅',
    desecrated: '褻瀆',
    skill: '技能',
  },
  'zh-CN': {
    explicit: '外延',
    implicit: '基底',
    crafted: '工艺的',
    enchant: '附魔',
    fractured: '分裂的',
    pseudo: '综合',
    imbued: '灌注',
    scourge: '异度天灾',
    delve: '地心',
    ultimatum: '致命贪婪',
    sanctum: '禁域',
    crucible: '古神熔炉',
    mercenary: '佣兵',
    veiled: '影匿',
    monster: '怪物',
    rune: '增幅器',
    desecrated: '渎灵',
    skill: '技能',
  },
  en: {
    explicit: 'Explicit',
    implicit: 'Implicit',
    crafted: 'Crafted',
    enchant: 'Enchant',
    fractured: 'Fractured',
    pseudo: 'Pseudo',
    imbued: 'Imbued',
    scourge: 'Scourge',
    delve: 'Delve',
    ultimatum: 'Ultimatum',
    sanctum: 'Sanctum',
    crucible: 'Crucible',
    mercenary: 'Mercenary',
    veiled: 'Veiled',
    monster: 'Monster',
    rune: 'Augment',
    desecrated: 'Desecrated',
    skill: 'Skill',
  },
};

/** 從官方 stat id（例如 `fractured.stat_...`）解析網域前綴；不認得時回傳 null。 */
export function extractStatDomain(statId: string | undefined): StatDomainKey | null {
  const prefix = statId ? splitStatId(statId)?.domain : undefined;
  return prefix ? toStatDomainKey(prefix) : null;
}

/** 網域前綴字串（例如 `fractured`）轉成認得的網域鍵；不認得時回傳 null。 */
export function toStatDomainKey(domain: string | null | undefined): StatDomainKey | null {
  return domain && STAT_DOMAIN_SET.has(domain) ? (domain as StatDomainKey) : null;
}

/** 對齊官方市集：只有非 `explicit` 的網域需要顯示來源標籤徽章。 */
export function shouldShowStatDomainBadge(
  domain: StatDomainKey | null | undefined,
): domain is StatDomainKey {
  return Boolean(domain && domain !== 'explicit');
}

/** 回傳指定網域套用 `--pxd-stat-color` 的內聯 CSS 變數，與 `assets/main.css` 共用色票。 */
export function getStatDomainStyle(
  domain: StatDomainKey | null | undefined,
): CSSProperties | undefined {
  if (!domain || domain === 'explicit') return undefined;
  return { '--pxd-stat-color': `var(--pxd-stat-${domain})` } as CSSProperties;
}

/** 取得詞綴網域對應的官方分類顯示文字（優先讀即時／分片資料，無資料時退回內建官方對照表）。 */
export function getStatDomainLabel(
  domain: StatDomainKey | null | undefined,
  version: PoeVersion = 'poe1',
): string | null {
  if (!domain) return null;
  const liveOrShard = getOfficialStatDomainLabel(domain, version, getActiveDisplayLocale());
  if (liveOrShard) return liveOrShard;
  return FALLBACK_DOMAIN_LABELS[getActiveUiLocale()]?.[domain] ?? null;
}

/**
 * 標籤徽章用的簡短網域名稱（2～3 字）。官方分類名稱偏長（「隨機屬性」「已工藝」），
 * 徽章空間有限，中文介面改用簡稱；其他語言沿用官方名稱。
 */
const SHORT_DOMAIN_LABELS: Partial<Record<string, Readonly<Record<StatDomainKey, string>>>> = {
  'zh-TW': {
    explicit: '隨機',
    implicit: '固定',
    crafted: '工藝',
    enchant: '附魔',
    fractured: '破裂',
    pseudo: '偽屬性',
    imbued: '注能',
    scourge: '災魘',
    delve: '掘獄',
    ultimatum: '通牒',
    sanctum: '聖域',
    crucible: '熔火',
    mercenary: '傭兵',
    veiled: '隱匿',
    monster: '怪物',
    rune: '增幅',
    desecrated: '褻瀆',
    skill: '技能',
  },
  'zh-CN': {
    explicit: '外延',
    implicit: '基底',
    crafted: '工艺',
    enchant: '附魔',
    fractured: '分裂',
    pseudo: '综合',
    imbued: '灌注',
    scourge: '天灾',
    delve: '地心',
    ultimatum: '贪婪',
    sanctum: '禁域',
    crucible: '熔炉',
    mercenary: '佣兵',
    veiled: '影匿',
    monster: '怪物',
    rune: '增幅',
    desecrated: '渎灵',
    skill: '技能',
  },
};

/** 徽章用的網域名稱：中文顯示語言用簡稱，其餘沿用官方分類名稱（`getStatDomainLabel`）。 */
export function getStatDomainBadgeLabel(
  domain: StatDomainKey | null | undefined,
  version: PoeVersion = 'poe1',
): string | null {
  if (!domain) return null;
  return (
    SHORT_DOMAIN_LABELS[getActiveDisplayLocale()]?.[domain] ?? getStatDomainLabel(domain, version)
  );
}
