import type { HostFilterGroup, HostFilterItem } from './host-types';
import { getVueStore } from './poe-runtime-reader';

export interface StoredFilterBinding {
  bindingId: string;
  statId: string;
  category: string | null;
}

export interface ActiveCategoryBindingSession {
  version: 1;
  sessionId: string;
  league: string;
  mode: 'search' | 'exchange';
  searchSlug: string | null;
  officialCategorySnapshot: string | null;
  bindings: StoredFilterBinding[];
}

export const ACTIVE_SESSION_STORAGE_KEY = 'poexd_active_category_session';

let bindingCounter = 0;
let activeBindingSession: ActiveCategoryBindingSession | null = null;

export function canonicalizeQuery(data: unknown): string {
  if (data === null || data === undefined) return '';
  if (typeof data !== 'object') {
    return JSON.stringify(data);
  }
  if (Array.isArray(data)) {
    return '[' + data.map((item) => canonicalizeQuery(item)).join(',') + ']';
  }
  let target = data as Record<string, any>;
  if ('query' in target && target.query && typeof target.query === 'object') {
    target = target.query;
  }
  const keys = Object.keys(target)
    .filter((k) => !k.startsWith('poexd') && !k.startsWith('__') && target[k] !== undefined)
    .sort();
  const entries = keys.map((k) => `${JSON.stringify(k)}:${canonicalizeQuery(target[k])}`);
  return '{' + entries.join(',') + '}';
}

export interface PendingSearchSubmission {
  requestId: number;
  sessionId: string;
  createdAt: number;
  queryFingerprint: string;
  hasResponded: boolean;
  isResponded?: () => boolean;
  timer?: ReturnType<typeof setTimeout>;
}

export interface StartPendingSearchSubmissionOptions {
  query?: unknown;
  hasResponded?: boolean;
  isResponded?: () => boolean;
}

let submissionSequence = 0;
const pendingSearchSubmissions = new Map<number, PendingSearchSubmission>();

export function startPendingSearchSubmission(
  optionsOrQuery?: StartPendingSearchSubmissionOptions | unknown,
): number {
  submissionSequence += 1;
  const reqId = submissionSequence;
  const currentSessionId = ensureActiveBindingSession().sessionId;

  let queryData: unknown = undefined;
  let hasResponded = true;
  let isResponded: (() => boolean) | undefined = undefined;

  if (
    optionsOrQuery &&
    typeof optionsOrQuery === 'object' &&
    ('query' in optionsOrQuery ||
      'hasResponded' in optionsOrQuery ||
      'isResponded' in optionsOrQuery)
  ) {
    const opts = optionsOrQuery as StartPendingSearchSubmissionOptions;
    queryData = opts.query;
    hasResponded = opts.hasResponded ?? (opts.isResponded ? false : true);
    isResponded = opts.isResponded;
  } else {
    queryData = optionsOrQuery;
  }

  if (queryData === undefined) {
    const store = getVueStore();
    queryData = store?.state?.query || store?.state?.persistent;
  }

  const queryFingerprint = canonicalizeQuery(queryData);

  const timer = setTimeout(() => {
    pendingSearchSubmissions.delete(reqId);
  }, 10000);

  pendingSearchSubmissions.set(reqId, {
    requestId: reqId,
    sessionId: currentSessionId,
    createdAt: Date.now(),
    queryFingerprint,
    hasResponded,
    isResponded,
    timer,
  });

  return reqId;
}

export function markSearchSubmissionResponded(reqId: number): void {
  const entry = pendingSearchSubmissions.get(reqId);
  if (entry) {
    entry.hasResponded = true;
  }
}

export function cancelPendingSearchSubmission(reqId: number): void {
  const entry = pendingSearchSubmissions.get(reqId);
  if (entry) {
    if (entry.timer) clearTimeout(entry.timer);
    pendingSearchSubmissions.delete(reqId);
  }
}

export function completePendingSearchSubmission(reqId: number, delayMs: number = 1000): void {
  const entry = pendingSearchSubmissions.get(reqId);
  if (entry) {
    entry.hasResponded = true;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      pendingSearchSubmissions.delete(reqId);
    }, delayMs);
  }
}

export function consumePendingSearchSubmission(
  sessionId: string,
  transitionFingerprint?: string,
): boolean {
  // 1. 嚴格 Fail-closed：transitionFingerprint 必須是有效非空字串
  if (!transitionFingerprint || typeof transitionFingerprint !== 'string') {
    return false;
  }

  for (const [reqId, entry] of pendingSearchSubmissions.entries()) {
    if (entry.sessionId !== sessionId) continue;

    const isReady = entry.hasResponded || (entry.isResponded ? entry.isResponded() : false);
    if (!isReady) {
      continue;
    }

    // 2. 嚴格 Fail-closed：entry.queryFingerprint 必須存在且完全匹配
    if (!entry.queryFingerprint || entry.queryFingerprint !== transitionFingerprint) {
      continue;
    }

    // 3. 匹配成功：獨立消耗此 request token，各 request 依 query fingerprint 獨立 correlation，不刪除其他 requests
    if (entry.timer) clearTimeout(entry.timer);
    pendingSearchSubmissions.delete(reqId);

    return true;
  }
  return false;
}

export function clearPendingSearchSubmissions(): void {
  for (const [, entry] of pendingSearchSubmissions.entries()) {
    if (entry.timer) clearTimeout(entry.timer);
  }
  pendingSearchSubmissions.clear();
}

export function extractLeagueAndModeFromUrl(url: string = window.location.href): {
  league: string | null;
  mode: 'search' | 'exchange' | 'other';
  searchSlug: string | null;
} {
  try {
    const urlObj = new URL(url);
    const parts = urlObj.pathname.split('/').filter(Boolean);
    const isPoe2 = parts[0] === 'trade2';
    const modeIdx = parts.findIndex((p) => p === 'search' || p === 'exchange');
    if (modeIdx === -1) {
      return { league: null, mode: 'other', searchSlug: null };
    }
    const mode = parts[modeIdx] as 'search' | 'exchange';
    const leagueIdx = modeIdx + (isPoe2 && parts[modeIdx + 1] === 'poe2' ? 2 : 1);
    const league = parts[leagueIdx] ? decodeURIComponent(parts[leagueIdx]) : null;
    const searchSlugPart = parts[leagueIdx + 1];
    const searchSlug =
      searchSlugPart && searchSlugPart !== 'live' ? decodeURIComponent(searchSlugPart) : null;
    return { league, mode, searchSlug };
  } catch {
    return { league: null, mode: 'other', searchSlug: null };
  }
}

export function generateSessionId(): string {
  const rand = Math.random().toString(36).substring(2, 9);
  return `pobs_${Date.now()}_${rand}`;
}

export function getActiveSessionId(): string {
  return ensureActiveBindingSession().sessionId;
}

export function getOfficialCategorySnapshot(): string | null {
  return ensureActiveBindingSession().officialCategorySnapshot;
}

export function setOfficialCategorySnapshot(category: string | null): void {
  const session = ensureActiveBindingSession();
  session.officialCategorySnapshot = category;
  saveActiveBindingSession(session);
}

export function generateBindingId(statId?: string): string {
  bindingCounter += 1;
  const rand = Math.random().toString(36).substring(2, 9);
  const prefix = statId ? statId.replace(/[^a-zA-Z0-9_-]/g, '_') : 'stat';
  return `pbf_${prefix}_${Date.now()}_${bindingCounter}_${rand}`;
}

export function ensureFilterBindingId(filter: HostFilterItem): string {
  if (typeof filter.poexdBindingId === 'string' && filter.poexdBindingId) {
    return filter.poexdBindingId;
  }
  const id = generateBindingId(filter.id);
  Object.defineProperty(filter, 'poexdBindingId', {
    value: id,
    writable: true,
    enumerable: false, // 確保 JSON.stringify 完全忽略，不影響官方 API payload
    configurable: true,
  });
  return id;
}

export function setFilterCategory(
  filter: HostFilterItem,
  category: string | null | undefined,
): void {
  ensureFilterBindingId(filter);
  if (category) {
    Object.defineProperty(filter, 'poexdCategory', {
      value: category,
      writable: true,
      enumerable: false, // 確保 JSON.stringify 完全忽略
      configurable: true,
    });
  } else {
    try {
      delete filter.poexdCategory;
    } catch {
      filter.poexdCategory = undefined;
    }
  }
}

export function stampSessionIdToHistoryState(sessionId: string): void {
  try {
    if (typeof window !== 'undefined' && window.history && window.history.replaceState) {
      const currentState = window.history.state;
      if (!currentState || currentState.__poexdSessionId !== sessionId) {
        const nextState =
          typeof currentState === 'object' && currentState !== null
            ? { ...currentState, __poexdSessionId: sessionId }
            : { __poexdSessionId: sessionId };
        window.history.replaceState(nextState, '');
      }
    }
  } catch {}
}

export function isSameSessionHistoryEntry(sessionId: string): boolean {
  try {
    if (typeof window !== 'undefined' && window.history && window.history.state) {
      if (window.history.state.__poexdSessionId === sessionId) {
        return true;
      }
    }
  } catch {}
  return false;
}

export function isDocumentReload(): boolean {
  try {
    if (typeof window !== 'undefined' && window.performance) {
      const navEntries = window.performance.getEntriesByType('navigation');
      if (navEntries && navEntries.length > 0) {
        return (navEntries[0] as PerformanceNavigationTiming).type === 'reload';
      }
      return (window.performance as any).navigation?.type === 1; // Legacy PerformanceNavigation.TYPE_RELOAD
    }
  } catch {}
  return false;
}

function saveActiveBindingSession(session: ActiveCategoryBindingSession): void {
  try {
    sessionStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, JSON.stringify(session));
    stampSessionIdToHistoryState(session.sessionId);
  } catch (e) {
    console.error('[PoeXD] 保存 active category session 失敗:', e);
  }
}

export function ensureActiveBindingSession(context?: {
  league?: string | null;
  mode?: 'search' | 'exchange' | 'other';
  searchSlug?: string | null;
  navigationType?: 'pushState' | 'replaceState' | 'initial';
  query?: unknown;
}): ActiveCategoryBindingSession {
  const route = extractLeagueAndModeFromUrl();
  const currentLeague = context?.league ?? route.league ?? 'Standard';
  const currentMode: 'search' | 'exchange' =
    context?.mode === 'exchange'
      ? 'exchange'
      : context?.mode === 'search'
        ? 'search'
        : route.mode === 'exchange'
          ? 'exchange'
          : 'search';
  const currentSlug = context?.searchSlug ?? route.searchSlug ?? null;

  if (activeBindingSession) {
    // 1. 檢查 context 是否發生實質改變（例如跨 league 切換、離開 search）
    if (
      activeBindingSession.league !== currentLeague ||
      activeBindingSession.mode !== currentMode
    ) {
      return rolloverBindingSession({
        league: currentLeague,
        mode: currentMode,
        searchSlug: currentSlug,
      });
    }

    // 2. 在同 league/mode 下，若透過 pushState 導航到了不同的 searchSlug：
    if (
      context?.navigationType === 'pushState' &&
      currentSlug !== activeBindingSession.searchSlug
    ) {
      let currentQuery = context?.query;
      if (!currentQuery) {
        const store = getVueStore();
        currentQuery = store?.state?.query || store?.state?.persistent;
      }
      const transitionFingerprint = canonicalizeQuery(currentQuery);

      const hasPendingTransition = consumePendingSearchSubmission(
        activeBindingSession.sessionId,
        transitionFingerprint,
      );
      if (!hasPendingTransition) {
        return rolloverBindingSession({
          league: currentLeague,
          mode: currentMode,
          searchSlug: currentSlug,
        });
      }
    }

    // 3. 普通 query editing（如 replaceState 或搜尋送出更新 slug）：延續 session 並同步更新 searchSlug
    if (currentSlug && currentSlug !== activeBindingSession.searchSlug) {
      activeBindingSession.searchSlug = currentSlug;
      saveActiveBindingSession(activeBindingSession);
    }
    return activeBindingSession;
  }

  // 嘗試從 sessionStorage 還原（例如 F5 Reload）
  try {
    const raw = sessionStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        parsed.version === 1 &&
        typeof parsed.sessionId === 'string' &&
        Array.isArray(parsed.bindings)
      ) {
        const storedLeague = parsed.league;
        const storedMode = parsed.mode;

        // 若 league 與 mode 一致（同一個 search session / 重新整理）
        const leagueMatches = !storedLeague || storedLeague === currentLeague;
        const modeMatches = !storedMode || storedMode === currentMode;

        if (leagueMatches && modeMatches) {
          const matchesHistoryState = isSameSessionHistoryEntry(parsed.sessionId);
          const matchesSlug = Boolean(
            parsed.searchSlug && currentSlug && parsed.searchSlug === currentSlug,
          );
          const isReload = isDocumentReload();

          // 判斷是否為同 league 的全新搜尋（例如在同分頁貼入 Search B）
          const isDifferentSearch =
            Boolean(parsed.searchSlug && currentSlug && parsed.searchSlug !== currentSlug) &&
            !matchesHistoryState &&
            !isReload;

          if (!isDifferentSearch) {
            activeBindingSession = {
              version: 1,
              sessionId: parsed.sessionId,
              league: currentLeague,
              mode: currentMode,
              searchSlug: currentSlug,
              officialCategorySnapshot:
                typeof parsed.officialCategorySnapshot === 'string'
                  ? parsed.officialCategorySnapshot
                  : null,
              bindings: parsed.bindings
                .filter(
                  (b: any) =>
                    b &&
                    typeof b.bindingId === 'string' &&
                    typeof b.statId === 'string' &&
                    (b.category === null || typeof b.category === 'string'),
                )
                .map((b: any) => ({
                  bindingId: b.bindingId,
                  statId: b.statId,
                  category: typeof b.category === 'string' && b.category ? b.category : null,
                })),
            };
            stampSessionIdToHistoryState(activeBindingSession.sessionId);
            return activeBindingSession;
          }
        }
      }
    }
  } catch (e) {
    console.warn('[PoeXD] 讀取 active category session 失敗，將建立新 session:', e);
  }

  // 建立全新 session
  activeBindingSession = {
    version: 1,
    sessionId: generateSessionId(),
    league: currentLeague,
    mode: currentMode,
    searchSlug: currentSlug,
    officialCategorySnapshot: null,
    bindings: [],
  };
  saveActiveBindingSession(activeBindingSession);
  return activeBindingSession;
}

export function rolloverBindingSession(context?: {
  league?: string | null;
  mode?: 'search' | 'exchange' | 'other';
  searchSlug?: string | null;
}): ActiveCategoryBindingSession {
  clearPendingSearchSubmissions();
  const route = extractLeagueAndModeFromUrl();
  const league = context?.league ?? route.league ?? 'Standard';
  const mode: 'search' | 'exchange' =
    context?.mode === 'exchange'
      ? 'exchange'
      : context?.mode === 'search'
        ? 'search'
        : route.mode === 'exchange'
          ? 'exchange'
          : 'search';
  const searchSlug = context?.searchSlug ?? route.searchSlug ?? null;

  activeBindingSession = {
    version: 1,
    sessionId: generateSessionId(),
    league,
    mode,
    searchSlug,
    officialCategorySnapshot: null,
    bindings: [],
  };
  saveActiveBindingSession(activeBindingSession);
  return activeBindingSession;
}

export function resetActiveBindingSessionForTest(keepStorage = false): void {
  activeBindingSession = null;
  clearPendingSearchSubmissions();
  if (!keepStorage) {
    try {
      sessionStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
      if (typeof window !== 'undefined' && window.history && window.history.replaceState) {
        const currentState = window.history.state;
        if (currentState && currentState.__poexdSessionId) {
          const { __poexdSessionId, ...rest } = currentState;
          window.history.replaceState(Object.keys(rest).length ? rest : null, '');
        }
      }
    } catch {}
  }
}

export function loadStoredBindings(): StoredFilterBinding[] {
  const session = ensureActiveBindingSession();
  return [...session.bindings];
}

export function persistBindings(groups: HostFilterGroup[]): void {
  try {
    const session = ensureActiveBindingSession();
    const bindings: StoredFilterBinding[] = [];

    // 僅以當前 active filters 儲存，已刪除的 filter 立即被淘汰
    groups.forEach((group) => {
      if (!Array.isArray(group.filters)) return;
      group.filters.forEach((f) => {
        if (!f || !f.id) return;
        const bindingId = typeof f.poexdBindingId === 'string' ? f.poexdBindingId : '';
        const category =
          typeof f.poexdCategory === 'string' && f.poexdCategory ? f.poexdCategory : null;
        if (bindingId) {
          bindings.push({
            bindingId,
            statId: f.id,
            category,
          });
        }
      });
    });

    session.bindings = bindings;
    saveActiveBindingSession(session);
  } catch (e) {
    console.error('[PoeXD] 持久化詞綴分類失敗:', e);
  }
}

export function reconcileFilterBindings(
  groups: HostFilterGroup[],
  officialCategory?: string | null,
): void {
  const session = ensureActiveBindingSession();
  const storedList = session.bindings;

  // 收集目前所有活著的有效 filters
  const currentFilters: HostFilterItem[] = [];
  groups.forEach((group) => {
    if (!Array.isArray(group.filters)) return;
    group.filters.forEach((f) => {
      if (f && f.id) {
        currentFilters.push(f);
      }
    });
  });

  // 1. 第一階段：精確匹配已有 bindingId 的 filters（物件引用存活期間）
  const boundBindingIds = new Set<string>();
  const resolvedFilters = new Set<HostFilterItem>();

  currentFilters.forEach((f) => {
    if (typeof f.poexdBindingId === 'string' && f.poexdBindingId) {
      const match = storedList.find((b) => b.bindingId === f.poexdBindingId);
      if (match) {
        if (!f.poexdCategory && match.category) {
          setFilterCategory(f, match.category);
        }
        boundBindingIds.add(f.poexdBindingId);
        resolvedFilters.add(f);
      } else if (f.poexdCategory) {
        resolvedFilters.add(f);
      }
    }
  });

  // 2. 第二階段：處理未解析 category 的 filters（Vuex object replacement / F5 刷新 / bindingId 未命中）
  // 僅使用未被第一階段認領的 stored bindings
  const availableStored = storedList.filter((b) => !boundBindingIds.has(b.bindingId));
  const unresolvedFilters = currentFilters.filter((f) => !resolvedFilters.has(f));

  if (unresolvedFilters.length > 0 && availableStored.length > 0) {
    // 按 statId 分組
    const storedByStat = new Map<string, StoredFilterBinding[]>();
    availableStored.forEach((b) => {
      const list = storedByStat.get(b.statId) || [];
      list.push(b);
      storedByStat.set(b.statId, list);
    });

    const currentByStat = new Map<string, HostFilterItem[]>();
    unresolvedFilters.forEach((f) => {
      const list = currentByStat.get(f.id!) || [];
      list.push(f);
      currentByStat.set(f.id!, list);
    });

    currentByStat.forEach((cFilters, statId) => {
      const sBindings = storedByStat.get(statId) || [];
      if (sBindings.length === 0) return;

      if (cFilters.length === 1 && sBindings.length === 1) {
        // 情況 A：單一無歧義 (Unambiguous)
        const matched = sBindings[0];
        Object.defineProperty(cFilters[0], 'poexdBindingId', {
          value: matched.bindingId,
          writable: true,
          enumerable: false,
          configurable: true,
        });
        if (matched.category) {
          setFilterCategory(cFilters[0], matched.category);
        } else {
          setFilterCategory(cFilters[0], null);
        }
        boundBindingIds.add(matched.bindingId);
        resolvedFilters.add(cFilters[0]);
      } else {
        // 情況 B：存在多個同 statId 實例 (Duplicate / Ambiguous)
        const nonNullCategories = sBindings
          .map((b) => b.category)
          .filter((c): c is string => typeof c === 'string' && c.length > 0);
        const uniqueCategories = new Set(nonNullCategories);

        if (uniqueCategories.size === 0) {
          // 全部為 unbound (category === null)，安全恢復 bindingId，category 維持 null
          cFilters.forEach((f, idx) => {
            const b = sBindings[idx];
            const bId = b ? b.bindingId : generateBindingId(f.id);
            Object.defineProperty(f, 'poexdBindingId', {
              value: bId,
              writable: true,
              enumerable: false,
              configurable: true,
            });
            setFilterCategory(f, null);
            if (b) boundBindingIds.add(b.bindingId);
            resolvedFilters.add(f);
          });
        } else if (uniqueCategories.size === 1 && nonNullCategories.length === sBindings.length) {
          // 所有歷史記錄分類完全一致且均非 null，安全賦予該分類，各自分配 bindingId
          const uniformCategory = Array.from(uniqueCategories)[0];
          cFilters.forEach((f, idx) => {
            const b = sBindings[idx];
            const bId = b ? b.bindingId : generateBindingId(f.id);
            Object.defineProperty(f, 'poexdBindingId', {
              value: bId,
              writable: true,
              enumerable: false,
              configurable: true,
            });
            setFilterCategory(f, uniformCategory);
            if (b) boundBindingIds.add(b.bindingId);
            resolvedFilters.add(f);
          });
        } else {
          // 存在多個同 statId 且分類衝突或部分 null：資訊不足以安全判定，寧可不恢復 category，絕不猜錯！
          cFilters.forEach((f) => {
            ensureFilterBindingId(f);
            if (officialCategory) {
              setFilterCategory(f, officialCategory);
            }
            resolvedFilters.add(f);
          });
        }
      }
    });
  }

  // 3. 第三階段：為所有仍無 bindingId 的全新 filter 生成 ID 與初始分類（已在第一或第二階段 resolved 的 filter 絕不重新給值！）
  currentFilters.forEach((f) => {
    if (!resolvedFilters.has(f)) {
      ensureFilterBindingId(f);
      if (!f.poexdCategory && officialCategory) {
        setFilterCategory(f, officialCategory);
      }
    }
  });

  // 持久化：僅保存當前活著的 filters，已刪除的 filter 自然被淘汰！
  persistBindings(groups);
}

export function clearAllFilterCategories(groups: HostFilterGroup[]): void {
  setOfficialCategorySnapshot(null);
  groups.forEach((group) => {
    if (!Array.isArray(group.filters)) return;
    group.filters.forEach((f) => {
      if (!f || !f.id) return;
      // 保留 poexdBindingId，僅清空 poexdCategory
      setFilterCategory(f, null);
    });
  });
  persistBindings(groups);
}

export function batchUpdateAllCategories(groups: HostFilterGroup[], newCategory: string): void {
  setOfficialCategorySnapshot(newCategory);
  groups.forEach((group) => {
    if (!Array.isArray(group.filters)) return;
    group.filters.forEach((f) => {
      if (!f || !f.id) return;
      setFilterCategory(f, newCategory);
    });
  });
  persistBindings(groups);
}

export function updateSingleFilterCategory(
  groups: HostFilterGroup[],
  target: { bindingId: string; groupIndex?: number; filterIndex?: number },
  category: string,
): boolean {
  if (!target || typeof target.bindingId !== 'string' || !target.bindingId) {
    return false;
  }

  let targetFilter: HostFilterItem | null = null;
  for (const group of groups) {
    if (!Array.isArray(group.filters)) continue;
    for (const f of group.filters) {
      if (f && f.poexdBindingId === target.bindingId) {
        targetFilter = f;
        break;
      }
    }
    if (targetFilter) break;
  }

  // 若找不到對應 bindingId 的 filter（stale 或已刪除），絕不 fallback 到 groupIndex/filterIndex
  if (!targetFilter) {
    return false;
  }

  setFilterCategory(targetFilter, category);
  persistBindings(groups);
  return true;
}
