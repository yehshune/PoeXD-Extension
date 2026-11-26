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
import {
  buildCanonicalTradeSearchUrl,
  extractSectionSourceCanonicalKey,
  getBookmarkCanonicalKey,
  sameLeague,
} from './source-filters';
import {
  PREVIOUS_SOURCE_ID_PREFIX,
  SESSION_SOURCE_ID_PREFIX,
  type TemporarySearchRecord,
  type SessionConnectionMeta,
} from './types';

export interface CandidateInfo {
  parsed: ParsedTradeSearchIdentity | null;
  sourceUrl?: string;
  exists: boolean;
}

export interface UpsertTemporarySearchInput {
  canonicalKey: string;
  canonicalIdentity: ParsedTradeSearchIdentity;
  name: string;
  url: string;
  coverImageUrl?: string;
  /** 若為 true，既有名稱非空時不覆寫（addTemporarySearch 未輸入名稱時沿用舊名） */
  preserveExistingName?: boolean;
  /** 若為 true，清除既有 provenance（addTemporarySearch 語意） */
  clearProvenance?: boolean;
}

export interface LiveSearchConnectionRegistry {
  // Read-only views
  getTemporarySearches(): readonly TemporarySearchRecord[];
  getSessionEntries(): ReadonlyMap<string, SessionConnectionMeta>;
  getPendingSearchKeys(): ReadonlySet<string>;
  getMutedKeys(): ReadonlySet<string>;
  isMuted(canonicalKey: string): boolean;
  setMuted(canonicalKey: string, muted: boolean): boolean;
  getLatestResumeIdentities(): readonly LiveSearchResumeIdentity[];
  hasAnyState(): boolean;
  findTemporarySearchById(sourceId: string): TemporarySearchRecord | undefined;
  findTemporarySearchByCanonicalKey(canonicalKey: string): TemporarySearchRecord | undefined;
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
  upsertTemporarySearch(input: UpsertTemporarySearchInput): TemporarySearchRecord;
  patchTemporarySearch(sourceId: string, patch: { name?: string; coverImageUrl?: string }): void;
  ensureTemporarySearchForSectionKey(
    targetKey: string,
    opLeague: string,
  ): TemporarySearchRecord | undefined;
  removeTemporarySearchByCanonicalKey(canonicalKey: string): boolean;
  removeTemporarySearchById(sourceId: string): {
    removed: TemporarySearchRecord;
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
  clearAllPrevious(): void;

  clear(): void;
}

function createTemporarySearchId(): string {
  return `custom_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function withMuted(identity: LiveSearchResumeIdentity, muted: boolean): LiveSearchResumeIdentity {
  const next: LiveSearchResumeIdentity = { ...identity };
  if (muted) next.muted = true;
  else delete next.muted;
  return next;
}

export interface LiveSearchConnectionRegistryOptions {
  /** 官方市集 origin（供組裝 canonical URL，未提供時回退預設國際服） */
  origin?: string;
}

/**
 * 集中管理 LiveSearch Primary Page 的連線來源狀態、Temporary Search ↔ Bookmark
 * 歸屬轉換與 LiveSearch Resume Plan 基準狀態。
 */
export function createLiveSearchConnectionRegistry(
  options?: LiveSearchConnectionRegistryOptions,
): LiveSearchConnectionRegistry {
  const origin = options?.origin;
  const temporarySearches: TemporarySearchRecord[] = [];
  const sessionEntriesByKey = new Map<string, SessionConnectionMeta>();
  const baselineResumeByKey = new Map<string, LiveSearchResumeIdentity>();
  const pendingSearchKeys = new Set<string>();
  const mutedKeys = new Set<string>();
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
    getTemporarySearches: () => temporarySearches,
    getSessionEntries: () => sessionEntriesByKey,
    getPendingSearchKeys: () => pendingSearchKeys,
    getMutedKeys: () => mutedKeys,
    isMuted: (canonicalKey) => mutedKeys.has(canonicalKey),
    setMuted(canonicalKey, muted) {
      const changed = muted ? !mutedKeys.has(canonicalKey) : mutedKeys.has(canonicalKey);
      if (muted) mutedKeys.add(canonicalKey);
      else mutedKeys.delete(canonicalKey);
      const baseline = baselineResumeByKey.get(canonicalKey);
      if (baseline) {
        baselineResumeByKey.set(canonicalKey, withMuted(baseline, muted));
      }
      latestResumeIdentities = latestResumeIdentities.map((id) =>
        getResumeCanonicalKey(id) === canonicalKey ? withMuted(id, muted) : id,
      );
      return changed;
    },
    getLatestResumeIdentities: () => latestResumeIdentities,
    hasAnyState: () =>
      temporarySearches.length > 0 || sessionEntriesByKey.size > 0 || baselineResumeByKey.size > 0,

    findTemporarySearchById: (sourceId) => temporarySearches.find((c) => c.id === sourceId),
    findTemporarySearchByCanonicalKey: (canonicalKey) =>
      temporarySearches.find((c) => c.canonicalKey === canonicalKey),
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
      const custom = temporarySearches.find((c) => c.id === trimmed);
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

      const custom = temporarySearches.find((c) => c.id === sourceId);
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
      const custom = temporarySearches.find((c) => c.canonicalKey === entry.key);
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

    upsertTemporarySearch(input) {
      let record = temporarySearches.find((c) => c.canonicalKey === input.canonicalKey);
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
        id: createTemporarySearchId(),
        name: input.name,
        url: input.url,
        canonicalIdentity: { ...input.canonicalIdentity },
        canonicalKey: input.canonicalKey,
        createdAt: Date.now(),
        coverImageUrl: input.coverImageUrl,
      };
      temporarySearches.push(record);
      return record;
    },

    patchTemporarySearch(sourceId, patch) {
      const custom = temporarySearches.find((c) => c.id === sourceId);
      if (!custom) return;
      if (patch.coverImageUrl !== undefined) custom.coverImageUrl = patch.coverImageUrl;
      if (patch.name) custom.name = patch.name;
    },

    ensureTemporarySearchForSectionKey(targetKey, opLeague) {
      const existing = temporarySearches.find((c) => c.canonicalKey === targetKey);
      if (existing) return existing;

      const sessionMeta = sessionEntriesByKey.get(targetKey);
      if (sessionMeta) {
        const created: TemporarySearchRecord = {
          id: createTemporarySearchId(),
          name: sessionMeta.name,
          url: sessionMeta.url,
          canonicalIdentity: { ...sessionMeta.canonicalIdentity },
          canonicalKey: targetKey,
          createdAt: Date.now(),
          coverImageUrl: sessionMeta.coverImageUrl,
        };
        temporarySearches.push(created);
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
            origin,
          );
        const parsed = parseTradeSearchUrl(stripLiveSuffix(resolvedUrl)) ?? {
          gameVersion: resumeEntry.gameVersion,
          league: opLeague || resumeEntry.league,
          searchId: resumeEntry.searchId,
        };
        const created: TemporarySearchRecord = {
          id: createTemporarySearchId(),
          name:
            resumeEntry.name ||
            t('liveSearch.defaultSearchNameWithId', { id: resumeEntry.searchId }),
          url: resolvedUrl,
          canonicalIdentity: parsed,
          canonicalKey: targetKey,
          createdAt: Date.now(),
          coverImageUrl: resumeEntry.coverImageUrl,
        };
        temporarySearches.push(created);
        return created;
      }

      return undefined;
    },

    removeTemporarySearchByCanonicalKey(canonicalKey) {
      const idx = temporarySearches.findIndex((c) => c.canonicalKey === canonicalKey);
      if (idx === -1) return false;
      temporarySearches.splice(idx, 1);
      return true;
    },

    removeTemporarySearchById(sourceId) {
      const idx = temporarySearches.findIndex((c) => c.id === sourceId);
      if (idx === -1) return null;
      const [removed] = temporarySearches.splice(idx, 1);
      sessionEntriesByKey.delete(removed.canonicalKey);
      mutedKeys.delete(removed.canonicalKey);
      const wasPersistedInResume = latestResumeIdentities.some(
        (id) => getResumeCanonicalKey(id) === removed.canonicalKey,
      );
      return { removed, wasPersistedInResume };
    },

    removeSessionConnection(sourceId, canonicalKey) {
      const customIdx = temporarySearches.findIndex(
        (c) => c.id === sourceId || (canonicalKey !== null && c.canonicalKey === canonicalKey),
      );
      const hadSessionEntry = canonicalKey !== null && sessionEntriesByKey.has(canonicalKey);
      if (customIdx !== -1) {
        temporarySearches.splice(customIdx, 1);
      }
      let wasPersistedInResume = false;
      if (canonicalKey) {
        sessionEntriesByKey.delete(canonicalKey);
        mutedKeys.delete(canonicalKey);
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
      const bookmarkCanonicalKeys = new Set<string>();
      if (collection) {
        const bookmarksByKey = new Map<string, typeof collection.bookmarks>();
        for (const b of collection.bookmarks) {
          const parsed = parseTradeSearchUrl(stripLiveSuffix(b.url));
          if (parsed) {
            const key = getTradeSearchCanonicalKey(parsed);
            bookmarkCanonicalKeys.add(key);
            const list = bookmarksByKey.get(key);
            if (list) list.push(b);
            else bookmarksByKey.set(key, [b]);
          }
        }

        for (const [key, sessionMeta] of sessionEntriesByKey.entries()) {
          const candidates = bookmarksByKey.get(key);
          if (!candidates || candidates.length === 0) {
            // 來源書籤已被刪除或覆蓋為其他搜尋時，清除過期 sourceBookmarkId，改以暫時搜尋／session 身分運作
            sessionMeta.sourceBookmarkId = undefined;
            continue;
          }
          const preferred =
            (sessionMeta.sourceBookmarkId
              ? candidates.find((c) => c.id === sessionMeta.sourceBookmarkId)
              : undefined) ?? candidates[0];
          if (preferred) {
            sessionMeta.name = preferred.name;
            sessionMeta.url = preferred.url;
            sessionMeta.sourceBookmarkId = preferred.id;
            if (hasValidCover(preferred.coverImageUrl)) {
              sessionMeta.coverImageUrl = preferred.coverImageUrl;
            }
          }
        }
      }

      const promotedResumeIdentities: LiveSearchResumeIdentity[] = [];

      // 1. Temporary Search -> Bookmark Promotion
      for (let i = temporarySearches.length - 1; i >= 0; i--) {
        if (bookmarkCanonicalKeys.has(temporarySearches[i].canonicalKey)) {
          const promoted = temporarySearches[i];
          const activeSub = findActiveSub(promoted.canonicalKey);
          if (activeSub && activeSub.status !== 'closed') {
            promotedResumeIdentities.push({
              gameVersion: promoted.canonicalIdentity.gameVersion,
              league: promoted.canonicalIdentity.league,
              searchId: promoted.canonicalIdentity.searchId,
            });
          }
          temporarySearches.splice(i, 1);
        }
      }

      // 2. Active Bookmark Deletion / Canonical Split Fallback -> Temporary Search
      for (const sub of liveSubscriptions) {
        if (sub.status === 'closed') continue;
        const subKey = getTradeSearchCanonicalKey({
          gameVersion: sub.gameVersion,
          league: sub.league,
          searchId: sub.searchId,
        });
        if (bookmarkCanonicalKeys.has(subKey)) continue;
        if (!temporarySearches.some((c) => c.canonicalKey === subKey)) {
          temporarySearches.push({
            id: `custom_fallback_${sub.id}`,
            name: sub.name || t('liveSearch.defaultSearchName'),
            url: sub.url,
            canonicalIdentity: {
              gameVersion: sub.gameVersion,
              league: sub.league,
              searchId: sub.searchId,
            },
            canonicalKey: subKey,
            createdAt: Date.now(),
            provenance: 'origin-bookmark-removed',
          });
        }
      }

      return promotedResumeIdentities;
    },

    applyResumePlanSnapshot(identities) {
      latestResumeIdentities = [...identities];
      const currentPlanKeys = new Set(identities.map((id) => getResumeCanonicalKey(id)));
      for (const existingKey of Array.from(baselineResumeByKey.keys())) {
        if (!currentPlanKeys.has(existingKey)) {
          baselineResumeByKey.delete(existingKey);
        }
      }
      for (const existingKey of Array.from(mutedKeys)) {
        if (!currentPlanKeys.has(existingKey) && !sessionEntriesByKey.has(existingKey)) {
          mutedKeys.delete(existingKey);
        }
      }
      for (const id of identities) {
        const key = getResumeCanonicalKey(id);
        if (id.muted) mutedKeys.add(key);
        else mutedKeys.delete(key);
        if (!sessionEntriesByKey.has(key) && !baselineResumeByKey.has(key)) {
          baselineResumeByKey.set(key, { ...id });
        } else if (baselineResumeByKey.has(key)) {
          const prev = baselineResumeByKey.get(key)!;
          baselineResumeByKey.set(
            key,
            withMuted(
              {
                ...prev,
                ...(id.name ? { name: id.name } : {}),
                ...(id.url ? { url: id.url } : {}),
                ...(id.coverImageUrl ? { coverImageUrl: id.coverImageUrl } : {}),
              },
              Boolean(id.muted),
            ),
          );
        }
      }
    },

    applyInitialResumeRead(identities) {
      latestResumeIdentities = [...identities];
      for (const id of identities) {
        const key = getResumeCanonicalKey(id);
        if (id.muted) mutedKeys.add(key);
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
      mutedKeys.delete(canonicalKey);
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
          mutedKeys.delete(key);
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
          mutedKeys.delete(key);
          keysToRemove.push(key);
        }
      }
      const removeKeySet = new Set(keysToRemove);
      latestResumeIdentities = latestResumeIdentities.filter(
        (id) => !removeKeySet.has(getResumeCanonicalKey(id)),
      );
      return keysToRemove;
    },

    clearAllPrevious() {
      baselineResumeByKey.clear();
      latestResumeIdentities = [];
      for (const key of Array.from(mutedKeys)) {
        if (!sessionEntriesByKey.has(key)) {
          mutedKeys.delete(key);
        }
      }
    },

    clear() {
      pendingSearchKeys.clear();
      mutedKeys.clear();
      temporarySearches.length = 0;
      sessionEntriesByKey.clear();
      baselineResumeByKey.clear();
      latestResumeIdentities = [];
    },
  };
}
