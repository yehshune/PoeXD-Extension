import { ref, type Ref } from 'vue';
import type { ModTier } from '@/components/sidebar/types';
import { isTradeValueNegated } from '@/utils/trade-value-sign';
import {
  SUPPORTED_AFFIX_LOCALES,
  type AffixDisplayLocalePreference,
  type DisplayLocalePreference,
  type SupportedAffixLocale,
  type SupportedLocale,
  type SupportedUiLocale,
} from './preferences-contract';
import { getActiveDisplayLocale } from './i18n';
import { resolvePageLocale, type LocaleResolutionInput } from './locale-resolution';
import {
  describeShardMismatch,
  isShardCompatible,
  type ShardFingerprint,
} from './game-data-shard-compat';
import { getLocaleStatsAssetPath, getModsTiersAssetPath, type PoeVersion } from './trade-context';

export type {
  AffixDisplayLocalePreference,
  DisplayLocalePreference,
  SupportedAffixLocale,
  SupportedLocale,
  SupportedUiLocale,
};

export interface CompactModTier {
  modId: string;
  level: number;
  params: (number | [number, number])[];
  values: string[][];
  groupIdx: number;
  typeIdx: number;
  affinities: string[];
  generation_type: string;
  id?: string;
  ids?: string[];
  statIds?: string[];
  weight?: Record<string, number>;
}

export interface ModsTiersArtifact {
  /** 產生此檔的遊戲 patch（poexd-data） */
  patch?: string;
  typeTable: string[][];
  groups: string[];
  tiers: CompactModTier[];
}

export interface LocaleStatsShard {
  /** 產生此檔的遊戲 patch；tierTemplates 與 mods-tiers.json 的 tiers 以索引對齊 */
  patch?: string;
  templates: string[];
  tierTemplates: number[];
  statTemplates: Record<string, number>;
}

export const STAT_PREFIX_FALLBACKS = [
  'fractured.',
  'desecrated.',
  'enchant.',
  'rune.',
  'crafted.',
  'veiled.',
] as const;

export function renderGenericTemplate(
  rawTemplate: string,
  locale: SupportedAffixLocale | string = 'zh-TW',
): string {
  if (!rawTemplate) return '';
  return rawTemplate
    .split('|||||')
    .map((line) => {
      const s = line.replace(/\{\d+:\+[dn]\}/g, '+#').replace(/\{\d+:[dn]\}/g, '#');
      return (locale === 'en' ? s.toLowerCase() : s).replace(/^\+/, '').replace(/\s+/g, ' ').trim();
    })
    .join('|||||');
}

export function renderTierKey(
  rawTemplate: string,
  params: ReadonlyArray<number | readonly [number, number] | readonly number[]>,
  locale: SupportedAffixLocale | string = 'zh-TW',
): string {
  if (!rawTemplate) return '';
  return rawTemplate
    .split('|||||')
    .map((line) => {
      const s = line.replace(/\{(\d+):(\+d|\+n|d|n)\}/g, (match, idxStr, fmt) => {
        const p = parseInt(idxStr, 10);
        const param = params[p];
        if (param === undefined) return match;
        let min = typeof param === 'number' ? param : param[0];
        let max = typeof param === 'number' ? param : param.length > 1 ? param[1] : param[0];
        if (fmt === '+n' || fmt === 'n') {
          min = -min;
          max = -max;
          if (min > max) {
            const tmp = min;
            min = max;
            max = tmp;
          }
        }
        if (fmt === '+d' || fmt === '+n') {
          return min === max ? (min >= 0 ? `+${min}` : `${min}`) : `+(${min}-${max})`;
        }
        return min === max ? `${min}` : `(${min}-${max})`;
      });
      return locale === 'en' ? s.toLowerCase().trim() : s.trim();
    })
    .join('|||||');
}

export function getCandidateStatIds(statId: string): string[] {
  if (!statId) return [];
  const candidates = [statId];
  for (const prefix of STAT_PREFIX_FALLBACKS) {
    if (statId.startsWith(prefix)) {
      candidates.push(`explicit.${statId.slice(prefix.length)}`);
      break;
    }
  }
  return candidates;
}

interface VersionLexiconState {
  artifact: ModsTiersArtifact | null;
  /** 測試用：以已展開的 group → tiers 取代 mods-tiers artifact（setAffixLexiconMockData） */
  mockModsByGroup: Record<string, ModTier[]> | null;
  tierIndicesByStatId: Map<string, number[]>;
  tierIndicesByGroupIdx: Map<number, number[]>;
  shards: Map<SupportedAffixLocale, LocaleStatsShard>;
  artifactPromise: Promise<void> | null;
  shardPromises: Map<SupportedAffixLocale, Promise<LocaleStatsShard | null>>;
}

const lexiconByVersion = new Map<PoeVersion, VersionLexiconState>();
const lexiconRevisionRef = ref(0);

function bumpLexiconRevision() {
  lexiconRevisionRef.value += 1;
}

export function getAffixLexiconRevision(): Ref<number> {
  return lexiconRevisionRef;
}

function getOrCreateState(version: PoeVersion): VersionLexiconState {
  let state = lexiconByVersion.get(version);
  if (!state) {
    state = {
      artifact: null,
      mockModsByGroup: null,
      tierIndicesByStatId: new Map(),
      tierIndicesByGroupIdx: new Map(),
      shards: new Map(),
      artifactPromise: null,
      shardPromises: new Map(),
    };
    lexiconByVersion.set(version, state);
  }
  return state;
}

function resolveAssetUrl(assetPath: string): string {
  const runtimeGetUrl = (globalThis as any).chrome?.runtime?.getURL;
  return typeof runtimeGetUrl === 'function' ? runtimeGetUrl(assetPath) : assetPath;
}

const artifactFingerprint = (artifact: ModsTiersArtifact): ShardFingerprint => ({
  patch: artifact.patch,
  length: artifact.tiers.length,
});

const statsShardFingerprint = (shard: LocaleStatsShard): ShardFingerprint => ({
  patch: shard.patch,
  length: shard.tierTemplates.length,
});

/** 語系分片必須與目前的 mods-tiers 來自同一次建置，否則 tierTemplates 索引會錯位 */
function acceptStatsShard(
  state: VersionLexiconState,
  locale: SupportedAffixLocale,
  shard: LocaleStatsShard,
): boolean {
  if (!state.artifact) return true;
  const reference = artifactFingerprint(state.artifact);
  const candidate = statsShardFingerprint(shard);
  if (isShardCompatible(reference, candidate)) return true;
  console.warn(describeShardMismatch(`stats.json (${locale})`, reference, candidate));
  return false;
}

function indexArtifact(state: VersionLexiconState, artifact: ModsTiersArtifact) {
  state.artifact = artifact;
  state.mockModsByGroup = null;
  state.tierIndicesByStatId.clear();
  state.tierIndicesByGroupIdx.clear();
  for (const [locale, shard] of state.shards) {
    if (!acceptStatsShard(state, locale, shard)) state.shards.delete(locale);
  }

  for (let tierIdx = 0; tierIdx < artifact.tiers.length; tierIdx++) {
    const cTier = artifact.tiers[tierIdx];
    let groupList = state.tierIndicesByGroupIdx.get(cTier.groupIdx);
    if (!groupList) {
      groupList = [];
      state.tierIndicesByGroupIdx.set(cTier.groupIdx, groupList);
    }
    groupList.push(tierIdx);

    const statIds = cTier.statIds ?? cTier.ids ?? (cTier.id ? [cTier.id] : []);
    for (const sid of statIds) {
      let sidList = state.tierIndicesByStatId.get(sid);
      if (!sidList) {
        sidList = [];
        state.tierIndicesByStatId.set(sid, sidList);
      }
      sidList.push(tierIdx);
    }
  }
}

export function isModsTiersArtifact(data: unknown): data is ModsTiersArtifact {
  return (
    Boolean(data) &&
    typeof data === 'object' &&
    Array.isArray((data as ModsTiersArtifact).typeTable) &&
    Array.isArray((data as ModsTiersArtifact).groups) &&
    Array.isArray((data as ModsTiersArtifact).tiers)
  );
}

export function setAffixLexiconMockData(
  version: PoeVersion,
  modsDataOrArtifact: ModsTiersArtifact | Record<string, any> | null,
  shards?: Partial<Record<SupportedAffixLocale, LocaleStatsShard>>,
) {
  const state = getOrCreateState(version);
  state.artifactPromise = null;
  state.shardPromises.clear();
  state.shards.clear();
  state.tierIndicesByStatId.clear();
  state.tierIndicesByGroupIdx.clear();

  if (!modsDataOrArtifact) {
    state.artifact = null;
    state.mockModsByGroup = null;
    bumpLexiconRevision();
    return;
  }

  if (isModsTiersArtifact(modsDataOrArtifact)) {
    indexArtifact(state, modsDataOrArtifact);
  } else {
    state.artifact = null;
    state.mockModsByGroup = modsDataOrArtifact as Record<string, ModTier[]>;
  }

  if (shards) {
    for (const [locale, shard] of Object.entries(shards)) {
      if (shard) {
        state.shards.set(locale as SupportedAffixLocale, shard);
      }
    }
  }
  bumpLexiconRevision();
}

export function resetAffixLexiconCacheForTests() {
  lexiconByVersion.clear();
  bumpLexiconRevision();
}

export async function ensureLocaleShardLoaded(
  version: PoeVersion,
  locale: SupportedAffixLocale,
): Promise<LocaleStatsShard | null> {
  const state = getOrCreateState(version);
  const cached = state.shards.get(locale);
  if (cached) return cached;

  // 測試 mock 資料模式不載入網路分片
  if (state.mockModsByGroup && !state.artifact) {
    return null;
  }

  const inflight = state.shardPromises.get(locale);
  if (inflight) return inflight;

  const promise = (async () => {
    try {
      const url = resolveAssetUrl(getLocaleStatsAssetPath(version, locale));
      const res = await fetch(url);
      if (!res || res.ok === false) return null;
      const json = await res.json();
      if (
        json &&
        typeof json === 'object' &&
        Array.isArray(json.templates) &&
        Array.isArray(json.tierTemplates) &&
        json.statTemplates &&
        typeof json.statTemplates === 'object'
      ) {
        if (!acceptStatsShard(state, locale, json as LocaleStatsShard)) return null;
        state.shards.set(locale, json as LocaleStatsShard);
        bumpLexiconRevision();
        return json as LocaleStatsShard;
      }
      return null;
    } catch {
      return null;
    } finally {
      state.shardPromises.delete(locale);
    }
  })();

  state.shardPromises.set(locale, promise);
  return promise;
}

export function getRequiredLocalesForDisplay(
  displayLocale: SupportedAffixLocale,
): SupportedAffixLocale[] {
  if (displayLocale === 'zh-TW' || displayLocale === 'zh-CN') {
    return [displayLocale, 'en'];
  }
  return [displayLocale];
}

export async function ensureAffixLexiconLoaded(
  version: PoeVersion,
  options: {
    /** 要載入的語系分片；省略時使用目前的全域 Display Locale */
    displayLocale?: SupportedAffixLocale;
  } = {},
): Promise<void> {
  const state = getOrCreateState(version);
  const targetLocale = options.displayLocale ?? getActiveDisplayLocale();

  if (!state.artifact && !state.mockModsByGroup) {
    if (!state.artifactPromise) {
      state.artifactPromise = (async () => {
        try {
          const url = resolveAssetUrl(getModsTiersAssetPath(version));
          const res = await fetch(url);
          if (!res || res.ok === false) return;
          const json = await res.json();
          if (isModsTiersArtifact(json)) {
            indexArtifact(state, json);
            bumpLexiconRevision();
          }
        } catch {
          // ignore
        } finally {
          state.artifactPromise = null;
        }
      })();
    }
    await state.artifactPromise;
  }

  if (state.artifact) {
    const requiredLocales = getRequiredLocalesForDisplay(targetLocale);
    await Promise.all(requiredLocales.map((loc) => ensureLocaleShardLoaded(version, loc)));
  }
}

function hydrateCompactTier(
  state: VersionLexiconState,
  tierIdx: number,
  displayLocale: SupportedAffixLocale,
): ModTier | null {
  const artifact = state.artifact;
  if (!artifact) return null;
  const cTier = artifact.tiers[tierIdx];
  if (!cTier) return null;

  const groupKey = artifact.groups[cTier.groupIdx] ?? '';
  const types = artifact.typeTable[cTier.typeIdx] ?? [];

  const displayShard = state.shards.get(displayLocale) ?? state.shards.get('en');
  const enShard = state.shards.get('en');

  const displayRawTemplate = displayShard
    ? (displayShard.templates[displayShard.tierTemplates[tierIdx]] ?? '')
    : '';
  const enRawTemplate = enShard ? (enShard.templates[enShard.tierTemplates[tierIdx]] ?? '') : '';

  const renderedDisplayKey = displayRawTemplate
    ? renderTierKey(displayRawTemplate, cTier.params, displayLocale)
    : groupKey;
  const renderedDisplayTemplate = displayRawTemplate
    ? renderGenericTemplate(displayRawTemplate, displayLocale)
    : groupKey;
  const renderedEnKey = enRawTemplate ? renderTierKey(enRawTemplate, cTier.params, 'en') : groupKey;

  const ids = cTier.ids ?? (cTier.id ? [cTier.id] : undefined);
  const enStatTemplateIdx = enShard && cTier.id ? enShard.statTemplates[cTier.id] : undefined;
  const tradeNegated =
    enStatTemplateIdx !== undefined &&
    isTradeValueNegated(enRawTemplate, enShard?.templates[enStatTemplateIdx]);

  return {
    affinities: cTier.affinities,
    generation_type: cTier.generation_type,
    key: renderedEnKey || renderedDisplayKey,
    displayKey: renderedDisplayKey,
    displayTemplate: renderedDisplayTemplate,
    level: String(cTier.level),
    values: cTier.values,
    types,
    id: cTier.id,
    ids,
    ...(tradeNegated ? { tradeNegated } : {}),
  };
}

export function findModTiersByStatId(
  statId: string,
  version: PoeVersion = 'poe1',
  localeOverride?: SupportedAffixLocale,
): ModTier[] | null {
  void lexiconRevisionRef.value;
  if (!statId) return null;
  const state = lexiconByVersion.get(version);
  if (!state) return null;

  const candidates = getCandidateStatIds(statId);
  const displayLocale = localeOverride ?? getActiveDisplayLocale();

  if (state.artifact) {
    for (const candidate of candidates) {
      const indices = state.tierIndicesByStatId.get(candidate);
      if (indices && indices.length > 0) {
        const result: ModTier[] = [];
        for (const tierIdx of indices) {
          const hydrated = hydrateCompactTier(state, tierIdx, displayLocale);
          if (hydrated) result.push(hydrated);
        }
        return result;
      }
    }
    return null;
  }

  if (state.mockModsByGroup) {
    for (const candidate of candidates) {
      const entry = state.mockModsByGroup[candidate];
      if (Array.isArray(entry) && entry.length > 0) {
        return entry;
      }
    }
    // Also support legacy mods-data keyed by template where tiers have id/ids
    for (const candidate of candidates) {
      const matched: ModTier[] = [];
      for (const tiers of Object.values(state.mockModsByGroup)) {
        if (!Array.isArray(tiers)) continue;
        for (const t of tiers) {
          if (t && (t.id === candidate || (Array.isArray(t.ids) && t.ids.includes(candidate)))) {
            matched.push(t);
          }
        }
      }
      if (matched.length > 0) return matched;
    }
  }

  return null;
}

interface StatTemplateMatch {
  /** 字典中實際登記的 stat id（例如 `rune.stat_N`） */
  key: string;
  tmplIdx: number;
}

/** stat 後綴（去掉 `explicit.` 等類別前綴）→ 字典登記；每個分片只建一次 */
const statSuffixIndexCache = new WeakMap<LocaleStatsShard, Map<string, StatTemplateMatch>>();

function statSuffix(statId: string): string {
  const dot = statId.indexOf('.');
  return dot === -1 ? statId : statId.slice(dot + 1);
}

function lookupStatTemplateBySuffix(
  shard: LocaleStatsShard,
  statId: string,
): StatTemplateMatch | undefined {
  let index = statSuffixIndexCache.get(shard);
  if (!index) {
    index = new Map();
    for (const [key, tmplIdx] of Object.entries(shard.statTemplates)) {
      const suffix = statSuffix(key);
      if (!index.has(suffix)) index.set(suffix, { key, tmplIdx });
    }
    statSuffixIndexCache.set(shard, index);
  }
  return index.get(statSuffix(statId));
}

/**
 * 混合詞綴模板（多行以 `|||||` 分隔）只保留引用該 stat 參數的行。
 * 參數 `{n}` 對應 tier 的 `ids[n]`；找不到對應時保留整段模板。
 */
function selectStatLines(state: VersionLexiconState, template: string, statKey: string): string {
  const lines = template.split('|||||');
  if (lines.length < 2 || !state.artifact) return template;
  for (const tierIdx of state.tierIndicesByStatId.get(statKey) ?? []) {
    const ids = state.artifact.tiers[tierIdx]?.ids;
    const paramIdx = ids?.indexOf(statKey) ?? -1;
    if (paramIdx < 0) continue;
    const placeholder = new RegExp(`\\{${paramIdx}[:}]`);
    const own = lines.filter((line) => placeholder.test(line));
    if (own.length > 0) return own.join('|||||');
  }
  return template;
}

export function translateAffixStat(
  statId: string,
  version: PoeVersion = 'poe1',
  localeOverride?: SupportedAffixLocale,
): string | null {
  void lexiconRevisionRef.value;
  if (!statId) return null;
  const state = lexiconByVersion.get(version);
  if (!state) return null;

  const candidates = getCandidateStatIds(statId);
  const displayLocale = localeOverride ?? getActiveDisplayLocale();

  if (state.artifact) {
    const shard = state.shards.get(displayLocale) ?? state.shards.get('en');
    const effectiveLocale = state.shards.has(displayLocale) ? displayLocale : 'en';
    if (shard) {
      for (const candidate of candidates) {
        const tmplIdx = shard.statTemplates[candidate];
        if (tmplIdx !== undefined && shard.templates[tmplIdx]) {
          return renderGenericTemplate(shard.templates[tmplIdx], effectiveLocale);
        }
      }
      // Fallback: check tierIndicesByStatId
      for (const candidate of candidates) {
        const indices = state.tierIndicesByStatId.get(candidate);
        if (indices && indices.length > 0) {
          const tierIdx = indices[0];
          const tmplIdx = shard.tierTemplates[tierIdx];
          if (tmplIdx !== undefined && shard.templates[tmplIdx]) {
            return renderGenericTemplate(shard.templates[tmplIdx], effectiveLocale);
          }
        }
      }
      // Fallback: 同一個 stat 在字典裡只登記在其他類別（例如只有 rune.stat_N）
      const match = lookupStatTemplateBySuffix(shard, statId);
      const template = match ? shard.templates[match.tmplIdx] : undefined;
      if (match && template) {
        return renderGenericTemplate(selectStatLines(state, template, match.key), effectiveLocale);
      }
    }
  }

  if (state.mockModsByGroup) {
    for (const candidate of candidates) {
      const entry = state.mockModsByGroup[candidate];
      if (Array.isArray(entry) && entry.length > 0) {
        const mod = entry[0];
        if (mod.displayTemplate) return mod.displayTemplate;
        if (mod.displayKey) return mod.displayKey;
        if (mod.key) return mod.key;
      }
    }
  }

  return null;
}

export function getHydratedModsByGroup(
  version: PoeVersion = 'poe1',
  localeOverride?: SupportedAffixLocale,
): Record<string, ModTier[]> {
  void lexiconRevisionRef.value;
  const state = lexiconByVersion.get(version);
  if (!state) return {};

  if (state.artifact) {
    const displayLocale = localeOverride ?? getActiveDisplayLocale();
    const result: Record<string, ModTier[]> = {};
    for (let groupIdx = 0; groupIdx < state.artifact.groups.length; groupIdx++) {
      const groupKey = state.artifact.groups[groupIdx];
      const tierIndices = state.tierIndicesByGroupIdx.get(groupIdx) ?? [];
      if (tierIndices.length === 0) continue;
      const tiers: ModTier[] = [];
      for (const tierIdx of tierIndices) {
        const hydrated = hydrateCompactTier(state, tierIdx, displayLocale);
        if (hydrated) tiers.push(hydrated);
      }
      if (tiers.length > 0) {
        result[groupKey] = tiers;
      }
    }
    return result;
  }

  if (state.mockModsByGroup) {
    return state.mockModsByGroup;
  }

  return {};
}

export function isLocaleShardCached(version: PoeVersion, locale: SupportedAffixLocale): boolean {
  const state = lexiconByVersion.get(version);
  return Boolean(state?.shards.has(locale));
}

export function getGroupTemplateInLocale(
  version: PoeVersion,
  groupKey: string,
  locale: SupportedAffixLocale,
): string | null {
  const state = lexiconByVersion.get(version);
  if (!state) return null;

  if (state.artifact) {
    const groupIdx = state.artifact.groups.indexOf(groupKey);
    if (groupIdx === -1) return null;
    if (locale === 'en' && !state.shards.has('en')) {
      return groupKey;
    }
    const shard = state.shards.get(locale);
    if (!shard) return locale === 'en' ? groupKey : null;
    const tierIndices = state.tierIndicesByGroupIdx.get(groupIdx);
    if (!tierIndices || tierIndices.length === 0) return null;
    const firstTierIdx = tierIndices[0];
    const tmplIdx = shard.tierTemplates[firstTierIdx];
    const rawTmpl = tmplIdx !== undefined ? shard.templates[tmplIdx] : undefined;
    if (!rawTmpl) return null;
    return renderGenericTemplate(rawTmpl, locale);
  }

  if (state.mockModsByGroup) {
    const tiers = state.mockModsByGroup[groupKey];
    if (Array.isArray(tiers) && tiers.length > 0) {
      if (locale === 'en') return groupKey;
      return tiers[0].displayTemplate || tiers[0].displayKey || groupKey;
    }
  }

  return null;
}

export function getTierKeyInLocale(
  version: PoeVersion,
  groupKey: string,
  locale: SupportedAffixLocale,
): string | null {
  const state = lexiconByVersion.get(version);
  if (!state) return null;

  if (state.artifact) {
    const groupIdx = state.artifact.groups.indexOf(groupKey);
    if (groupIdx === -1) return null;
    const shard = state.shards.get(locale);
    const tierIndices = state.tierIndicesByGroupIdx.get(groupIdx);
    if (!tierIndices || tierIndices.length === 0) return null;
    const firstTierIdx = tierIndices[0];
    const cTier = state.artifact.tiers[firstTierIdx];
    if (!shard) {
      return locale === 'en' ? groupKey : null;
    }
    const tmplIdx = shard.tierTemplates[firstTierIdx];
    const rawTmpl = tmplIdx !== undefined ? shard.templates[tmplIdx] : undefined;
    if (!rawTmpl) return null;
    return renderTierKey(rawTmpl, cTier.params, locale);
  }

  if (state.mockModsByGroup) {
    const tiers = state.mockModsByGroup[groupKey];
    if (Array.isArray(tiers) && tiers.length > 0) {
      if (locale === 'en') return tiers[0].key || groupKey;
      return tiers[0].displayKey || tiers[0].displayTemplate || tiers[0].key || groupKey;
    }
  }

  return null;
}

export function formatFallbackQuery(querySource: string): string {
  return querySource
    .split('|||||')[0]
    .replace(/#/g, '')
    .replace(/%/g, '')
    .replace(/^\+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function resolveFallbackQuerySync(
  version: PoeVersion,
  mod: { key?: string; displayKey?: string; displayTemplate?: string },
  matchKey?: string,
  localeInput?: LocaleResolutionInput,
): string | null {
  const pageLocale = resolvePageLocale(localeInput);
  const displayLocale = getActiveDisplayLocale();
  const groupKey = matchKey || mod.key || '';

  if (displayLocale === pageLocale) {
    const source =
      pageLocale === 'en'
        ? groupKey || mod.displayTemplate || mod.displayKey || ''
        : mod.displayTemplate || mod.displayKey || groupKey || '';
    return formatFallbackQuery(source);
  }

  const state = lexiconByVersion.get(version);
  if (!state?.artifact || isLocaleShardCached(version, pageLocale) || pageLocale === 'en') {
    const tmpl =
      getGroupTemplateInLocale(version, groupKey, pageLocale) ||
      (pageLocale === 'en'
        ? groupKey || mod.displayKey || mod.displayTemplate || ''
        : mod.displayTemplate || mod.displayKey || groupKey || '');
    return formatFallbackQuery(tmpl);
  }

  return null;
}

export async function resolveFallbackQueryForUnmatchedMod(
  version: PoeVersion,
  mod: { key?: string; displayKey?: string; displayTemplate?: string },
  matchKey?: string,
  localeInput?: LocaleResolutionInput,
): Promise<string> {
  const syncResult = resolveFallbackQuerySync(version, mod, matchKey, localeInput);
  if (syncResult !== null) {
    return syncResult;
  }

  const pageLocale = resolvePageLocale(localeInput);
  await ensureLocaleShardLoaded(version, pageLocale);
  const groupKey = matchKey || mod.key || '';
  const tmpl =
    getGroupTemplateInLocale(version, groupKey, pageLocale) ||
    groupKey ||
    mod.displayTemplate ||
    mod.displayKey ||
    '';
  return formatFallbackQuery(tmpl);
}
