import type { BookmarkCollectionView } from '@/utils/bookmark-coordinator';
import { t } from '@/utils/i18n';
import type { PoeVersion } from '@/utils/trade-context';
import {
  getTradeSearchCanonicalKey,
  parseTradeSearchUrl,
  stripLiveSuffix,
  type ParsedTradeSearchIdentity,
} from '@/utils/trade-search-identity';
import type { LiveSearchSubscription } from '@/utils/live-search-contract';
import {
  getResumeCanonicalKey,
  type LiveSearchResumeIdentity,
} from '@/utils/live-search-resume-store';
import { hasValidCover, type DedupEntry } from './connection-dedup';
import { reconcileRegistryOwnership } from './ownership-reconciler';
import {
  buildCanonicalTradeSearchUrl,
  extractSectionSourceCanonicalKey,
  getBookmarkCanonicalKey,
  sameLeague,
} from './source-filters';
import {
  PREVIOUS_SOURCE_ID_PREFIX,
  SESSION_SOURCE_ID_PREFIX,
  type CustomSourceRecord,
  type SessionConnectionMeta,
} from './types';

export interface CandidateInfo {
  parsed: ParsedTradeSearchIdentity | null;
  sourceUrl?: string;
  exists: boolean;
}

export interface UpsertCustomSourceInput {
  canonicalKey: string;
  canonicalIdentity: ParsedTradeSearchIdentity;
  name: string;
  url: string;
  coverImageUrl?: string;
  /** 若為 true，既有名稱非空時不覆寫（addCustom 未輸入名稱時沿用舊名） */
  preserveExistingName?: boolean;
  /** 若為 true，清除既有 provenance（addCustom 語意） */
  clearProvenance?: boolean;
}

export interface LiveSearchConnectionRegistry {
  // Read-only views
  getCustomSources(): readonly CustomSourceRecord[];
  getSessionEntries(): ReadonlyMap<string, SessionConnectionMeta>;
  getPendingSearchKeys(): ReadonlySet<string>;
  getLatestResumeIdentities(): readonly LiveSearchResumeIdentity[];
  hasAnyState(): boolean;
  findCustomById(sourceId: string): CustomSourceRecord | undefined;
  findCustomByCanonicalKey(canonicalKey: string): CustomSourceRecord | undefined;
  getSessionEntry(canonicalKey: string): SessionConnectionMeta | undefined;
  hasSessionEntry(canonicalKey: string): boolean;
  isPending(canonicalKey: string): boolean;
  findResumeEntryByCanonicalKey(canonicalKey: string): LiveSearchResumeIdentity | undefined;
  buildCombinedResumeMap(): Map<string, LiveSearchResumeIdentity>;

  // Resolution & dedup queries
  resolveCanonicalKeyBySourceId(
    sourceId: string,
    collection: BookmarkCollectionView | null,
  ): string | null;
  resolveCandidateInfo(sourceId: string, collection: BookmarkCollectionView | null): CandidateInfo;
  listSessionDedupEntries(
    liveSubscriptions: readonly Readonly<LiveSearchSubscription>[],
  ): DedupEntry[];
  listPreviousDedupEntries(
    gameVersion: PoeVersion,
    collection: BookmarkCollectionView | null,
    findActiveSub: (canonicalKey: string) => Readonly<LiveSearchSubscription> | undefined,
  ): DedupEntry[];
  sourceIdForDedupEntry(
    entry: DedupEntry,
    section: 'session' | 'previous',
    collection: BookmarkCollectionView | null,
  ): string;

  // Domain state transitions
  registerSessionEntry(meta: SessionConnectionMeta): void;
  patchSessionCover(canonicalKey: string, coverImageUrl: string | undefined): void;
  syncActiveSubscriptions(
    liveSubscriptions: readonly Readonly<LiveSearchSubscription>[],
    collection: BookmarkCollectionView | null,
  ): void;
  upsertCustomSource(input: UpsertCustomSourceInput): CustomSourceRecord;
  patchCustomSource(sourceId: string, patch: { name?: string; coverImageUrl?: string }): void;
  ensureCustomSourceForSectionKey(
    targetKey: string,
    opLeague: string,
  ): CustomSourceRecord | undefined;
  removeCustomByCanonicalKey(canonicalKey: string): boolean;
  removeCustomById(sourceId: string): {
    removed: CustomSourceRecord;
    wasPersistedInResume: boolean;
  } | null;
  removeSessionConnection(
    sourceId: string,
    canonicalKey: string | null,
  ): {
    hadLocalState: boolean;
    wasPersistedInResume: boolean;
  };
  markPending(canonicalKey: string): void;
  clearPending(canonicalKey: string): void;

  // Ownership reconciliation (Temporary Search <-> Bookmark)
  reconcileOwnership(
    collection: BookmarkCollectionView | null,
    liveSubscriptions: readonly Readonly<LiveSearchSubscription>[],
    findActiveSub: (canonicalKey: string) => Readonly<LiveSearchSubscription> | undefined,
  ): LiveSearchResumeIdentity[];

  // LiveSearch Resume Plan state sync
  applyResumePlanSnapshot(identities: readonly LiveSearchResumeIdentity[]): void;
  applyInitialResumeRead(identities: readonly LiveSearchResumeIdentity[]): void;
  pruneBaselineForLeague(validBookmarkKeys: ReadonlySet<string>, selectedLeague: string): void;
  forgetPrevious(canonicalKey: string): boolean;
  clearPreviousForLeague(selectedLeague: string): string[];

  clear(): void;
}

function createCustomSourceId(): string {
  return `custom_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * 集中管理 LiveSearch Primary Page 的連線來源狀態、Temporary Search ↔ Bookmark
 * 歸屬轉換與 LiveSearch Resume Plan 基準狀態。
 */
export function createLiveSearchConnectionRegistry(): LiveSearchConnectionRegistry {
  const customSources: CustomSourceRecord[] = [];
  const sessionEntriesByKey = new Map<string, SessionConnectionMeta>();
  const baselineResumeByKey = new Map<string, LiveSearchResumeIdentity>();
  const pendingSearchKeys = new Set<string>();
  let latestResumeIdentities: LiveSearchResumeIdentity[] = [];

  function findResumeEntryByCanonicalKey(
    canonicalKey: string,
  ): LiveSearchResumeIdentity | undefined {
    return (
      latestResumeIdentities.find((id) => getResumeCanonicalKey(id) === canonicalKey) ??
      baselineResumeByKey.get(canonicalKey)
    );
  }

  function buildCombinedResumeMap(): Map<string, LiveSearchResumeIdentity> {
    const combined = new Map<string, LiveSearchResumeIdentity>();
    for (const [k, v] of baselineResumeByKey.entries()) {
      combined.set(k, v);
    }
    for (const id of latestResumeIdentities) {
      const k = getResumeCanonicalKey(id);
      const existing = combined.get(k);
      combined.set(k, {
        ...existing,
        ...id,
        name: id.name ?? existing?.name,
        url: id.url ?? existing?.url,
        coverImageUrl: id.coverImageUrl ?? existing?.coverImageUrl,
      });
    }
    return combined;
  }

  function registerSessionEntry(meta: SessionConnectionMeta): void {
    const existing = sessionEntriesByKey.get(meta.canonicalKey);
    sessionEntriesByKey.set(meta.canonicalKey, {
      canonicalKey: meta.canonicalKey,
      canonicalIdentity: { ...meta.canonicalIdentity },
      name: meta.name || existing?.name || t('liveSearch.defaultSearchName'),
      url: meta.url || existing?.url || '',
      coverImageUrl: meta.coverImageUrl ?? existing?.coverImageUrl,
      sourceBookmarkId: meta.sourceBookmarkId ?? existing?.sourceBookmarkId,
    });
  }

  return {
    getCustomSources: () => customSources,
    getSessionEntries: () => sessionEntriesByKey,
    getPendingSearchKeys: () => pendingSearchKeys,
    getLatestResumeIdentities: () => latestResumeIdentities,
    hasAnyState: () =>
      customSources.length > 0 || sessionEntriesByKey.size > 0 || baselineResumeByKey.size > 0,

    findCustomById: (sourceId) => customSources.find((c) => c.id === sourceId),
    findCustomByCanonicalKey: (canonicalKey) =>
      customSources.find((c) => c.canonicalKey === canonicalKey),
    getSessionEntry: (canonicalKey) => sessionEntriesByKey.get(canonicalKey),
    hasSessionEntry: (canonicalKey) => sessionEntriesByKey.has(canonicalKey),
    isPending: (canonicalKey) => pendingSearchKeys.has(canonicalKey),
    findResumeEntryByCanonicalKey,
    buildCombinedResumeMap,

    resolveCanonicalKeyBySourceId(sourceId, collection) {
      const trimmed = sourceId.trim();
      const sectionKey = extractSectionSourceCanonicalKey(trimmed);
      if (sectionKey) return sectionKey;
      if (sessionEntriesByKey.has(trimmed)) return trimmed;
      const custom = customSources.find((c) => c.id === trimmed);
      if (custom) return custom.canonicalKey;
      const bookmark = collection?.bookmarks.find((b) => b.id === trimmed);
      if (bookmark) return getBookmarkCanonicalKey(bookmark);
      return null;
    },

    resolveCandidateInfo(sourceId, collection) {
      const key = extractSectionSourceCanonicalKey(sourceId);
      if (key) {
        const sessionMeta = sessionEntriesByKey.get(key);
        if (sessionMeta) {
          return {
            parsed: sessionMeta.canonicalIdentity,
            sourceUrl: stripLiveSuffix(sessionMeta.url),
            exists: true,
          };
        }
        const resumeEntry = findResumeEntryByCanonicalKey(key);
        if (resumeEntry) {
          return {
            parsed: {
              gameVersion: resumeEntry.gameVersion,
              league: resumeEntry.league,
              searchId: resumeEntry.searchId,
            },
            sourceUrl: resumeEntry.url ? stripLiveSuffix(resumeEntry.url) : undefined,
            exists: true,
          };
        }
      }

      const custom = customSources.find((c) => c.id === sourceId);
      if (custom) {
        return { parsed: custom.canonicalIdentity, sourceUrl: undefined, exists: true };
      }

      const bookmark = collection?.bookmarks.find((b) => b.id === sourceId);
      if (bookmark) {
        const cleanUrl = stripLiveSuffix(bookmark.url);
        return { parsed: parseTradeSearchUrl(cleanUrl) ?? null, sourceUrl: cleanUrl, exists: true };
      }

      return { parsed: null, exists: false };
    },

    listSessionDedupEntries(liveSubscriptions) {
      const entries: DedupEntry[] = [];
      for (const [key, meta] of sessionEntriesByKey.entries()) {
        entries.push({
          key,
          identity: meta.canonicalIdentity,
          name: meta.name,
          url: meta.url,
          coverImageUrl: meta.coverImageUrl,
          sourceBookmarkId: meta.sourceBookmarkId,
        });
      }
      for (const sub of liveSubscriptions) {
        if (sub.status === 'closed') continue;
        const identity = {
          gameVersion: sub.gameVersion,
          league: sub.league,
          searchId: sub.searchId,
        };
        const key = getTradeSearchCanonicalKey(identity);
        if (sessionEntriesByKey.has(key)) continue;
        entries.push({
          key,
          identity,
          name: sub.name,
          url: sub.url,
          sourceBookmarkId: sub.sourceBookmarkId,
        });
      }
      return entries;
    },

    listPreviousDedupEntries(gameVersion, collection, findActiveSub) {
      const entries: DedupEntry[] = [];
      for (const [key, resumeId] of buildCombinedResumeMap().entries()) {
        if (resumeId.gameVersion !== gameVersion) continue;
        if (sessionEntriesByKey.has(key) || findActiveSub(key)) continue;
        const bookmark = collection?.bookmarks.find((b) => getBookmarkCanonicalKey(b) === key);
        entries.push({
          key,
          identity: {
            gameVersion: resumeId.gameVersion,
            league: resumeId.league,
            searchId: resumeId.searchId,
          },
          name: bookmark?.name ?? resumeId.name,
          url: bookmark?.url ?? resumeId.url,
          coverImageUrl: hasValidCover(bookmark?.coverImageUrl)
            ? bookmark?.coverImageUrl
            : resumeId.coverImageUrl,
          sourceBookmarkId: bookmark?.id,
        });
      }
      return entries;
    },

    sourceIdForDedupEntry(entry, section, collection) {
      if (
        entry.sourceBookmarkId &&
        collection?.bookmarks.some(
          (b) => b.id === entry.sourceBookmarkId && getBookmarkCanonicalKey(b) === entry.key,
        )
      ) {
        return entry.sourceBookmarkId;
      }
      const custom = customSources.find((c) => c.canonicalKey === entry.key);
      if (custom) return custom.id;
      return section === 'session'
        ? `${SESSION_SOURCE_ID_PREFIX}${entry.key}`
        : `${PREVIOUS_SOURCE_ID_PREFIX}${entry.key}`;
    },

    registerSessionEntry,

    patchSessionCover(canonicalKey, coverImageUrl) {
      const meta = sessionEntriesByKey.get(canonicalKey);
      if (meta && !hasValidCover(meta.coverImageUrl) && hasValidCover(coverImageUrl)) {
        meta.coverImageUrl = coverImageUrl;
      }
    },

    syncActiveSubscriptions(liveSubscriptions, collection) {
      for (const sub of liveSubscriptions) {
        if (sub.status === 'closed') continue;
        const canonicalIdentity: ParsedTradeSearchIdentity = {
          gameVersion: sub.gameVersion,
          league: sub.league,
          searchId: sub.searchId,
        };
        const canonicalKey = getTradeSearchCanonicalKey(canonicalIdentity);
        const matchingBookmark = collection?.bookmarks.find(
          (b) => getBookmarkCanonicalKey(b) === canonicalKey,
        );
        const validCover = hasValidCover(matchingBookmark?.coverImageUrl)
          ? matchingBookmark.coverImageUrl
          : undefined;
        registerSessionEntry({
          canonicalKey,
          canonicalIdentity,
          name: matchingBookmark?.name || sub.name || t('liveSearch.defaultSearchName'),
          url: matchingBookmark?.url || sub.url,
          coverImageUrl: validCover,
          // 書籤集合已載入卻找不到同 canonicalKey 的書籤時，不得沿用過期的 sub.sourceBookmarkId
          sourceBookmarkId: collection ? matchingBookmark?.id : sub.sourceBookmarkId,
        });
      }
    },

    upsertCustomSource(input) {
      let record = customSources.find((c) => c.canonicalKey === input.canonicalKey);
      if (record) {
        record.url = input.url;
        if (!input.preserveExistingName || !record.name) {
          if (input.name || !record.name) {
            record.name = input.name;
          }
        }
        if (input.coverImageUrl) {
          record.coverImageUrl = input.coverImageUrl;
        }
        if (input.clearProvenance) {
          record.provenance = undefined;
        }
        return record;
      }
      record = {
        id: createCustomSourceId(),
        name: input.name,
        url: input.url,
        canonicalIdentity: { ...input.canonicalIdentity },
        canonicalKey: input.canonicalKey,
        createdAt: Date.now(),
        coverImageUrl: input.coverImageUrl,
      };
      customSources.push(record);
      return record;
    },

    patchCustomSource(sourceId, patch) {
      const custom = customSources.find((c) => c.id === sourceId);
      if (!custom) return;
      if (patch.coverImageUrl !== undefined) custom.coverImageUrl = patch.coverImageUrl;
      if (patch.name) custom.name = patch.name;
    },

    ensureCustomSourceForSectionKey(targetKey, opLeague) {
      const existing = customSources.find((c) => c.canonicalKey === targetKey);
      if (existing) return existing;

      const sessionMeta = sessionEntriesByKey.get(targetKey);
      if (sessionMeta) {
        const created: CustomSourceRecord = {
          id: createCustomSourceId(),
          name: sessionMeta.name,
          url: sessionMeta.url,
          canonicalIdentity: { ...sessionMeta.canonicalIdentity },
          canonicalKey: targetKey,
          createdAt: Date.now(),
          coverImageUrl: sessionMeta.coverImageUrl,
        };
        customSources.push(created);
        return created;
      }

      const resumeEntry = findResumeEntryByCanonicalKey(targetKey);
      if (resumeEntry) {
        const resolvedUrl =
          resumeEntry.url ||
          buildCanonicalTradeSearchUrl(
            resumeEntry.gameVersion,
            opLeague || resumeEntry.league,
            resumeEntry.searchId,
          );
        const parsed = parseTradeSearchUrl(stripLiveSuffix(resolvedUrl)) ?? {
          gameVersion: resumeEntry.gameVersion,
          league: opLeague || resumeEntry.league,
          searchId: resumeEntry.searchId,
        };
        const created: CustomSourceRecord = {
          id: createCustomSourceId(),
          name:
            resumeEntry.name ||
            t('liveSearch.defaultSearchNameWithId', { id: resumeEntry.searchId }),
          url: resolvedUrl,
          canonicalIdentity: parsed,
          canonicalKey: targetKey,
          createdAt: Date.now(),
          coverImageUrl: resumeEntry.coverImageUrl,
        };
        customSources.push(created);
        return created;
      }

      return undefined;
    },

    removeCustomByCanonicalKey(canonicalKey) {
      const idx = customSources.findIndex((c) => c.canonicalKey === canonicalKey);
      if (idx === -1) return false;
      customSources.splice(idx, 1);
      return true;
    },

    removeCustomById(sourceId) {
      const idx = customSources.findIndex((c) => c.id === sourceId);
      if (idx === -1) return null;
      const [removed] = customSources.splice(idx, 1);
      sessionEntriesByKey.delete(removed.canonicalKey);
      const wasPersistedInResume = latestResumeIdentities.some(
        (id) => getResumeCanonicalKey(id) === removed.canonicalKey,
      );
      return { removed, wasPersistedInResume };
    },

    removeSessionConnection(sourceId, canonicalKey) {
      const customIdx = customSources.findIndex(
        (c) => c.id === sourceId || (canonicalKey !== null && c.canonicalKey === canonicalKey),
      );
      const hadSessionEntry = canonicalKey !== null && sessionEntriesByKey.has(canonicalKey);
      if (customIdx !== -1) {
        customSources.splice(customIdx, 1);
      }
      let wasPersistedInResume = false;
      if (canonicalKey) {
        sessionEntriesByKey.delete(canonicalKey);
        wasPersistedInResume = latestResumeIdentities.some(
          (id) => getResumeCanonicalKey(id) === canonicalKey,
        );
      }
      return { hadLocalState: customIdx !== -1 || hadSessionEntry, wasPersistedInResume };
    },

    markPending(canonicalKey) {
      pendingSearchKeys.add(canonicalKey);
    },

    clearPending(canonicalKey) {
      pendingSearchKeys.delete(canonicalKey);
    },

    reconcileOwnership(collection, liveSubscriptions, findActiveSub) {
      return reconcileRegistryOwnership(
        collection,
        liveSubscriptions,
        customSources,
        sessionEntriesByKey,
        findActiveSub,
      );
    },

    applyResumePlanSnapshot(identities) {
      latestResumeIdentities = [...identities];
      const currentPlanKeys = new Set(identities.map((id) => getResumeCanonicalKey(id)));
      for (const existingKey of Array.from(baselineResumeByKey.keys())) {
        if (!currentPlanKeys.has(existingKey)) {
          baselineResumeByKey.delete(existingKey);
        }
      }
      for (const id of identities) {
        const key = getResumeCanonicalKey(id);
        if (!sessionEntriesByKey.has(key) && !baselineResumeByKey.has(key)) {
          baselineResumeByKey.set(key, { ...id });
        } else if (baselineResumeByKey.has(key)) {
          const prev = baselineResumeByKey.get(key)!;
          baselineResumeByKey.set(key, {
            ...prev,
            ...(id.name ? { name: id.name } : {}),
            ...(id.url ? { url: id.url } : {}),
            ...(id.coverImageUrl ? { coverImageUrl: id.coverImageUrl } : {}),
          });
        }
      }
    },

    applyInitialResumeRead(identities) {
      latestResumeIdentities = [...identities];
      for (const id of identities) {
        const key = getResumeCanonicalKey(id);
        if (!baselineResumeByKey.has(key)) {
          baselineResumeByKey.set(key, { ...id });
        }
      }
    },

    pruneBaselineForLeague(validBookmarkKeys, selectedLeague) {
      for (const [k, v] of baselineResumeByKey.entries()) {
        if (
          !v.url &&
          !v.name &&
          !validBookmarkKeys.has(k) &&
          sameLeague(v.league, selectedLeague)
        ) {
          baselineResumeByKey.delete(k);
        }
      }
    },

    forgetPrevious(canonicalKey) {
      baselineResumeByKey.delete(canonicalKey);
      const wasPersisted = latestResumeIdentities.some(
        (id) => getResumeCanonicalKey(id) === canonicalKey,
      );
      latestResumeIdentities = latestResumeIdentities.filter(
        (id) => getResumeCanonicalKey(id) !== canonicalKey,
      );
      return wasPersisted;
    },

    clearPreviousForLeague(selectedLeague) {
      const isMatchingSelectedLeague = (league: string | undefined) =>
        !selectedLeague.trim() || sameLeague(league, selectedLeague);

      const keysToRemove: string[] = [];
      for (const [key, entry] of Array.from(baselineResumeByKey.entries())) {
        if (!sessionEntriesByKey.has(key) && isMatchingSelectedLeague(entry.league)) {
          baselineResumeByKey.delete(key);
          keysToRemove.push(key);
        }
      }
      for (const id of latestResumeIdentities) {
        const key = getResumeCanonicalKey(id);
        if (
          !sessionEntriesByKey.has(key) &&
          isMatchingSelectedLeague(id.league) &&
          !keysToRemove.includes(key)
        ) {
          keysToRemove.push(key);
        }
      }
      const removeKeySet = new Set(keysToRemove);
      latestResumeIdentities = latestResumeIdentities.filter(
        (id) => !removeKeySet.has(getResumeCanonicalKey(id)),
      );
      return keysToRemove;
    },

    clear() {
      pendingSearchKeys.clear();
      customSources.length = 0;
      sessionEntriesByKey.clear();
      baselineResumeByKey.clear();
      latestResumeIdentities = [];
    },
  };
}
