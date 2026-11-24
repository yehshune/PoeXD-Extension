/**
 * 內部實作：將 PoB 條目、使用者調整與 build 整體設定解析成有效搜尋條件與官方市集 query。
 */
import type { PobBuildItem, PobDefence } from '../pob-build';
import { statDomainOf, withStatDomain } from '../stat-domain-order';
import type { PoeVersion } from '../trade-context';
import {
  DEFAULT_LINK_POLICY,
  DEFAULT_RARE_SEARCH,
  DEFAULT_STAT_PERCENT,
  LINK_POLICIES,
  NON_UNIQUE_RARITY,
  OFF_HAND_SLOT,
  RARE_SEARCH_MODES,
  STAT_PERCENT_OPTIONS,
  VISCERA_BUNDLE_COUNT_MIN,
  type BuildSearchDefaults,
  type DefenceSection,
  type EntryCategory,
  type EntryDefences,
  type EntrySearchSelection,
  type EntrySearchTarget,
  type GemFilters,
  type GemQualitySection,
  type PseudoContribution,
  type ResolvedEntrySearch,
  type ShoppingMod,
  type ShoppingStat,
  type ShoppingStatFilter,
  type RareSearchMode,
} from './types';

const INSTANT_BUYOUT_STATUS = { option: 'securable' } as const;
const IMPLICIT_PREFIX = 'implicit.';
const ENCHANT_PREFIX = 'enchant.';

const CATEGORY_BY_SLOT: Readonly<Record<string, string>> = {
  Helmet: 'armour.helmet',
  'Body Armour': 'armour.chest',
  Gloves: 'armour.gloves',
  Boots: 'armour.boots',
  Amulet: 'accessory.amulet',
  Belt: 'accessory.belt',
};
const RING_SLOT = /^Ring \d+$/;

const DEFENCES_BY_SECTION: Readonly<Record<DefenceSection, readonly PobDefence[]>> = {
  armour_filters: ['ar', 'ev', 'es', 'ward'],
  // PoE 2 沒有結界
  equipment_filters: ['ar', 'ev', 'es'],
};

function categoryIdOf(slot: string, item: PobBuildItem, version: PoeVersion): string | undefined {
  if (CATEGORY_BY_SLOT[slot]) return CATEGORY_BY_SLOT[slot];
  if (RING_SLOT.test(slot)) return 'accessory.ring';
  // PoE 2 的副手還有法器與輕盾，不能只憑有防禦就當成盾牌
  if (version === 'poe1' && OFF_HAND_SLOT.test(slot) && item.baseDefences) return 'armour.shield';
  return undefined;
}

/** 非傳奇裝備依部位推得的類別；沒有對應時為 undefined */
export function categoryOfItem(item: PobBuildItem, version: PoeVersion): EntryCategory | undefined {
  if (item.rarity === 'UNIQUE' || item.rarity === 'RELIC') return undefined;
  const id = categoryIdOf(item.slot, item, version);
  if (!id) return undefined;
  if (!id.startsWith('armour.')) return { id };
  const defenceSection: DefenceSection =
    version === 'poe1' ? 'armour_filters' : 'equipment_filters';
  const supported = DEFENCES_BY_SECTION[defenceSection];
  const defences = (item.baseDefences ?? []).filter((defence) => supported.includes(defence));
  return defences.length ? { id, defences, defenceSection } : { id };
}

/** 非傳奇裝備基底有的防禦數值（詞綴加上、基底沒有的防禦不算）；沒有時為 undefined */
export function defencesOfItem(item: PobBuildItem, version: PoeVersion): EntryDefences | undefined {
  if (item.rarity === 'UNIQUE' || item.rarity === 'RELIC') return undefined;
  const section: DefenceSection = version === 'poe1' ? 'armour_filters' : 'equipment_filters';
  const entries = (item.baseDefences ?? []).flatMap((defence) => {
    const value = item.defenceValues?.[defence];
    return value && DEFENCES_BY_SECTION[section].includes(defence)
      ? [[defence, value] as const]
      : [];
  });
  return entries.length ? { section, values: Object.fromEntries(entries) } : undefined;
}

/** 只留下和預設不同、而且合法的欄位 */
export function normalizeSearchDefaults(value: BuildSearchDefaults): BuildSearchDefaults {
  const { statPercent, links, rareSearch, defenceMin, pseudo } = value;
  return {
    ...(statPercent !== undefined &&
    statPercent !== DEFAULT_STAT_PERCENT &&
    STAT_PERCENT_OPTIONS.includes(statPercent)
      ? { statPercent }
      : {}),
    ...(links !== undefined && links !== DEFAULT_LINK_POLICY && LINK_POLICIES.includes(links)
      ? { links }
      : {}),
    ...(rareSearch !== undefined &&
    rareSearch !== DEFAULT_RARE_SEARCH &&
    RARE_SEARCH_MODES.includes(rareSearch)
      ? { rareSearch }
      : {}),
    ...(defenceMin === true ? { defenceMin } : {}),
    ...(pseudo === true ? { pseudo } : {}),
  };
}

const statRatioOf = (defaults?: BuildSearchDefaults): number =>
  (defaults?.statPercent ?? DEFAULT_STAT_PERCENT) / 100;

const sumValues = (stats: readonly ShoppingStat[]): number | undefined => {
  const values = stats.map((stat) => stat.value).filter((value) => value !== undefined);
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) : undefined;
};

export const finiteOrUndefined = (value: number | null | undefined): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/** 使用者選的網域在可切換清單裡才採用；和原代碼相同時視為沒有切換 */
export function validDomain(
  stat: { id: string; domains?: readonly string[] },
  domain: string | undefined,
): string | undefined {
  return domain && domain !== statDomainOf(stat.id) && stat.domains?.includes(domain)
    ? domain
    : undefined;
}

/**
 * 預設的數值範圍：正數取 percent%（預設八成）當下限、負數（減少、降低需求）當上限；整數無條件捨去到整數，
 * 小於 10 的非整數保留一位小數（0.5% 暴擊率不會變成「有就好」）。
 */
function defaultStatBounds(
  value: number | undefined,
  exact = false,
  percent = DEFAULT_STAT_PERCENT,
): { min?: number; max?: number } {
  if (value === undefined || !Number.isFinite(value) || value === 0) return {};
  if (exact) return { min: value, max: value };
  const scaled = (value * percent) / 100;
  const keepDecimal = !Number.isInteger(value) && Math.abs(value) < 10;
  const factor = keepDecimal ? 10 : 1;
  const rounded =
    value > 0 ? Math.floor(scaled * factor) / factor : Math.ceil(scaled * factor) / factor;
  if (rounded === 0) return {};
  return value > 0 ? { min: rounded } : { max: rounded };
}

/** 同一個代碼的多行合併成一個條件（數值加總），再套用使用者的調整 */
export function entryStatFilters(
  entry: Pick<EntrySearchTarget, 'mods'>,
  selection?: EntrySearchSelection,
  defaults?: BuildSearchDefaults,
): ShoppingStatFilter[] {
  const groups = new Map<string, ShoppingStat[]>();
  for (const mod of entry.mods ?? []) {
    if (mod.stat) groups.set(mod.stat.id, [...(groups.get(mod.stat.id) ?? []), mod.stat]);
  }
  const percent = defaults?.statPercent ?? DEFAULT_STAT_PERCENT;
  return [...groups.entries()].map(([key, stats]) => {
    const [first] = stats;
    const value = first.option === undefined ? sumValues(stats) : undefined;
    const bounds = defaultStatBounds(value, first.exact, percent);
    const custom = selection?.stats?.[key];
    const id = withStatDomain(key, validDomain(first, custom?.domain));
    const pick = (boundKey: 'min' | 'max') =>
      custom && boundKey in custom ? finiteOrUndefined(custom[boundKey]) : bounds[boundKey];
    const min = pick('min');
    const max = pick('max');
    return {
      id,
      key,
      ...(first.domains ? { domains: first.domains } : {}),
      ...(value !== undefined ? { value } : {}),
      ...(first.option !== undefined ? { option: first.option } : {}),
      enabled: custom?.enabled ?? first.defaultEnabled,
      ...(min !== undefined ? { min } : {}),
      ...(max !== undefined ? { max } : {}),
      customized: custom !== undefined,
    };
  });
}

interface QueryStatFilter {
  id: string;
  value?: { min?: number; max?: number; option?: number };
}

function toQueryFilter(filter: {
  id: string;
  option?: number;
  min?: number;
  max?: number;
}): QueryStatFilter {
  const value = {
    ...(filter.option !== undefined ? { option: filter.option } : {}),
    ...(filter.min !== undefined ? { min: filter.min } : {}),
    ...(filter.max !== undefined ? { max: filter.max } : {}),
  };
  return { id: filter.id, ...(Object.keys(value).length > 0 ? { value } : {}) };
}

const isRequiredInCountMode = (statId: string, visceraBundle?: true): boolean =>
  !visceraBundle && (statId.startsWith(IMPLICIT_PREFIX) || statId.startsWith(ENCHANT_PREFIX));

/** 總和條件：勾選的抗性、生命、能力值換成總和，下限同樣依整體設定的比例 */
function mergeIntoPseudo(
  filters: readonly ShoppingStatFilter[],
  mods: readonly ShoppingMod[],
  ratio: number,
): QueryStatFilter[] {
  const pseudoOf = new Map<string, readonly PseudoContribution[]>();
  for (const mod of mods) if (mod.stat?.pseudo) pseudoOf.set(mod.stat.id, mod.stat.pseudo);
  const totals = new Map<string, number>();
  const rest: QueryStatFilter[] = [];
  for (const filter of filters) {
    const contributions = pseudoOf.get(filter.key);
    if (!contributions || filter.value === undefined) {
      rest.push(toQueryFilter(filter));
      continue;
    }
    const customBound = filter.value < 0 ? filter.max : filter.min;
    const lineMinimum = filter.customized ? (customBound ?? 0) : filter.value * ratio;
    for (const { id, weight } of contributions) {
      totals.set(id, (totals.get(id) ?? 0) + lineMinimum * weight);
    }
    if (filter.id.startsWith(IMPLICIT_PREFIX) || filter.id !== filter.key) {
      rest.push(toQueryFilter(filter));
    }
  }
  const pseudo = [...totals.entries()].map(([id, total]) => {
    const settled = Math.round(total * 1e6) / 1e6;
    const bound =
      settled > 0 ? { min: Math.floor(settled) } : settled < 0 ? { max: Math.ceil(settled) } : {};
    return toQueryFilter({ id, ...bound });
  });
  return [...pseudo, ...rest];
}

/** 以類別取代基底的搜尋：拿掉名稱與基底，帶入類別（只搜非傳奇）與每一種防禦的有無 */
function categorySearchBase(category: EntryCategory, status: unknown): Record<string, unknown> {
  const { defences, defenceSection } = category;
  const defenceFilters =
    defences && defenceSection
      ? {
          [defenceSection]: {
            filters: Object.fromEntries(
              DEFENCES_BY_SECTION[defenceSection].map((defence) => [
                defence,
                defences.includes(defence) ? { min: 1 } : { max: 0 },
              ]),
            ),
          },
        }
      : {};
  return {
    status,
    filters: {
      type_filters: {
        filters: { category: { option: category.id }, rarity: { option: NON_UNIQUE_RARITY } },
      },
      ...defenceFilters,
    },
  };
}

export function effectiveCountMin(
  entry: Pick<EntrySearchTarget, 'visceraBundle'>,
  selection?: EntrySearchSelection,
): number | undefined {
  return selection?.countMin ?? (entry.visceraBundle ? VISCERA_BUNDLE_COUNT_MIN : undefined);
}

export function effectiveLinks(
  entry: Pick<EntrySearchTarget, 'links'>,
  selection?: EntrySearchSelection,
  defaults?: BuildSearchDefaults,
): number | undefined {
  if (selection && 'links' in selection) return selection.links ?? undefined;
  if (entry.links === undefined) return undefined;
  const policy = defaults?.links ?? DEFAULT_LINK_POLICY;
  if (policy === 'none') return undefined;
  if (policy === 'six') return entry.links >= 6 ? 6 : undefined;
  return entry.links;
}

export function effectiveSearchBy(
  entry: Pick<EntrySearchTarget, 'category'>,
  selection?: EntrySearchSelection,
  defaults?: BuildSearchDefaults,
): RareSearchMode {
  if (!entry.category) return 'base';
  return selection?.searchBy ?? defaults?.rareSearch ?? DEFAULT_RARE_SEARCH;
}

export function effectivePseudo(
  entry: Pick<EntrySearchTarget, 'visceraBundle' | 'visceraPart'>,
  selection?: EntrySearchSelection,
  defaults?: BuildSearchDefaults,
): boolean {
  if (selection && typeof selection.pseudo === 'boolean') return selection.pseudo;
  if (entry.visceraBundle || entry.visceraPart) return false;
  return defaults?.pseudo === true;
}

export function effectiveGemFilters(
  entry: Pick<EntrySearchTarget, 'kind' | 'level' | 'quality' | 'gemSockets'>,
  selection?: EntrySearchSelection,
): GemFilters {
  if (entry.kind !== 'gem') return {};
  const pick = (custom: number | null | undefined, hasCustom: boolean, pob: number | undefined) => {
    const value = hasCustom ? custom : pob;
    return typeof value === 'number' && value > 0 ? value : undefined;
  };
  const level = pick(
    selection?.gemLevel,
    selection !== undefined && 'gemLevel' in selection,
    entry.level !== undefined && entry.level > 1 ? entry.level : undefined,
  );
  const quality = pick(
    selection?.gemQuality,
    selection !== undefined && 'gemQuality' in selection,
    entry.quality,
  );
  const sockets = pick(
    selection?.gemSockets,
    selection !== undefined && 'gemSockets' in selection,
    entry.gemSockets,
  );
  return {
    ...(level !== undefined ? { level } : {}),
    ...(quality !== undefined ? { quality } : {}),
    ...(sockets !== undefined ? { sockets } : {}),
  };
}

function withLinks(
  base: Record<string, unknown>,
  links: number | undefined,
): Record<string, unknown> {
  if (links === undefined) return base;
  const filters = (base.filters ?? {}) as Record<string, unknown>;
  return {
    ...base,
    filters: {
      ...filters,
      socket_filters: { filters: { links: { min: links } } },
    },
  };
}

function withDefenceMins(
  base: Record<string, unknown>,
  defences: EntryDefences | undefined,
  defaults: BuildSearchDefaults | undefined,
): Record<string, unknown> {
  if (!defences || defaults?.defenceMin !== true) return base;
  const percent = defaults.statPercent ?? DEFAULT_STAT_PERCENT;
  const mins = Object.entries(defences.values).flatMap(([defence, value]) => {
    const { min } = defaultStatBounds(value, false, percent);
    return min !== undefined ? [[defence, { min }] as const] : [];
  });
  if (mins.length === 0) return base;
  const filters = (base.filters ?? {}) as Record<string, { filters?: Record<string, unknown> }>;
  const section = filters[defences.section]?.filters ?? {};
  return {
    ...base,
    filters: {
      ...filters,
      [defences.section]: { filters: { ...section, ...Object.fromEntries(mins) } },
    },
  };
}

function gemMiscFilters(
  gem: GemFilters,
  qualitySection: GemQualitySection = 'misc_filters',
): Record<string, { min: number }> {
  return {
    ...(gem.level !== undefined ? { gem_level: { min: gem.level } } : {}),
    ...(qualitySection === 'misc_filters' && gem.quality !== undefined
      ? { quality: { min: gem.quality } }
      : {}),
    ...(gem.sockets !== undefined ? { gem_sockets: { min: gem.sockets } } : {}),
  };
}

/** 換掉寶石搜尋的等級、品質與插槽數條件（其他條件保留） */
export function withGemFilters(
  searchBase: Record<string, unknown>,
  gem: GemFilters,
  qualitySection: GemQualitySection = 'misc_filters',
): Record<string, unknown> {
  const { filters, ...rest } = searchBase as { filters?: Record<string, any> };
  const { misc_filters: misc, type_filters: typeGroup, ...otherGroups } = filters ?? {};
  const {
    gem_level: _level,
    quality: _miscQuality,
    gem_sockets: _sockets,
    ...otherMisc
  } = misc?.filters ?? {};
  const miscFilters = {
    ...otherMisc,
    ...gemMiscFilters(gem, qualitySection),
  };
  let nextTypeGroup = typeGroup;
  if (qualitySection === 'type_filters') {
    const { quality: _typeQuality, ...otherType } = typeGroup?.filters ?? {};
    const typeFilters = {
      ...otherType,
      ...(gem.quality !== undefined ? { quality: { min: gem.quality } } : {}),
    };
    nextTypeGroup =
      Object.keys(typeFilters).length > 0 ? { ...typeGroup, filters: typeFilters } : undefined;
  }
  const groups = {
    ...otherGroups,
    ...(nextTypeGroup ? { type_filters: nextTypeGroup } : {}),
    ...(Object.keys(miscFilters).length > 0
      ? { misc_filters: { ...misc, filters: miscFilters } }
      : {}),
  };
  return Object.keys(groups).length > 0 ? { ...rest, filters: groups } : rest;
}

/**
 * 一次解析 PoB 條目的完整搜尋狀態：合併後的詞綴條件、有效設定、可計數條件數與最終市集 query。
 * 保留 `entry.mods` 原有的文字（包含已在地化的譯文），只更新每一行的 `searched` 狀態。
 */
export function resolveEntrySearch(
  entry: EntrySearchTarget,
  selection?: EntrySearchSelection,
  defaults?: BuildSearchDefaults,
): ResolvedEntrySearch {
  const filters = entryStatFilters(entry, selection, defaults);
  const enabled = filters.filter((filter) => filter.enabled);
  const enabledKeys = new Set(enabled.map((filter) => filter.key));
  const mods = entry.mods
    ? entry.mods.map((mod) => ({
        ...mod,
        searched: mod.stat ? enabledKeys.has(mod.stat.id) : false,
      }))
    : undefined;
  const countableFilterCount = enabled.filter(
    (filter) => !isRequiredInCountMode(filter.id, entry.visceraBundle),
  ).length;
  const countMin = effectiveCountMin(entry, selection);
  const pseudo = effectivePseudo(entry, selection, defaults);
  const linksMin = effectiveLinks(entry, selection, defaults);
  const searchBy = effectiveSearchBy(entry, selection, defaults);
  const gem = effectiveGemFilters(entry, selection);

  let query: Record<string, unknown> | null;
  if (entry.kind === 'gem') {
    query = entry.searchBase
      ? withGemFilters(entry.searchBase, gem, entry.gemQualitySection)
      : null;
  } else {
    const searchBase =
      entry.category && searchBy === 'category'
        ? categorySearchBase(entry.category, INSTANT_BUYOUT_STATUS)
        : entry.searchBase;
    if (!searchBase) {
      query = null;
    } else {
      const base = withDefenceMins(withLinks(searchBase, linksMin), entry.defences, defaults);
      const queryFilters = pseudo
        ? mergeIntoPseudo(enabled, entry.mods ?? [], statRatioOf(defaults))
        : enabled.map(toQueryFilter);
      if (queryFilters.length === 0) {
        query = base;
      } else if (countMin === undefined || !Number.isInteger(countMin) || countMin < 1) {
        query = { ...base, stats: [{ type: 'and', filters: queryFilters }] };
      } else {
        const required = queryFilters.filter((filter) =>
          isRequiredInCountMode(filter.id, entry.visceraBundle),
        );
        const countable = queryFilters.filter(
          (filter) => !isRequiredInCountMode(filter.id, entry.visceraBundle),
        );
        const groups = [
          ...(required.length > 0 ? [{ type: 'and', filters: required }] : []),
          ...(countable.length > 0
            ? [
                {
                  type: 'count',
                  value: { min: Math.min(countMin, countable.length) },
                  filters: countable,
                },
              ]
            : []),
        ];
        query = { ...base, stats: groups };
      }
    }
  }

  return {
    ...(mods ? { mods } : {}),
    filters,
    countableFilterCount,
    ...(countMin !== undefined ? { countMin } : {}),
    pseudo,
    ...(linksMin !== undefined ? { linksMin } : {}),
    searchBy,
    ...(gem.level !== undefined ? { gemLevelMin: gem.level } : {}),
    ...(gem.quality !== undefined ? { gemQualityMin: gem.quality } : {}),
    ...(gem.sockets !== undefined ? { gemSocketsMin: gem.sockets } : {}),
    query,
  };
}

/** 將 `resolveEntrySearch` 的結果套用到既有列上，確保已被清空的選用欄位不會殘留舊值 */
export function applyResolvedEntrySearch<T extends Partial<ResolvedEntrySearch>>(
  target: T,
  resolved: ResolvedEntrySearch,
): T & ResolvedEntrySearch {
  const {
    countMin: _countMin,
    linksMin: _linksMin,
    gemLevelMin: _gemLevelMin,
    gemQualityMin: _gemQualityMin,
    gemSocketsMin: _gemSocketsMin,
    ...rest
  } = target;
  return { ...(rest as T), ...resolved };
}
