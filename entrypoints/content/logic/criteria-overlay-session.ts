import {
  dispatchPoeEvent,
  listenPoeEvent,
  parsePoeCriteriaOverlayCommitResult,
  parsePoeCriteriaOverlayReadResult,
  parsePoeCriteriaOverlaySyncResult,
  serializePoeCriteriaOverlayCommit,
  serializePoeCriteriaOverlayRead,
  serializePoeCriteriaOverlaySync,
  type PoeCriteriaOverlaySyncDiagnostics,
} from '@/utils/event-contracts';
import {
  captureOverlayCriteria,
  criteriaOverlayFormFingerprint,
  planCriteriaOverlayApplication,
  planStatGroupFiltersUpdate,
  planStatGroupReplacement,
  type CriteriaOverlayApplyPlan,
  type CriteriaOverlayApplyReport,
  type CriteriaOverlayFormSnapshot,
  type CriteriaOverlayItem,
  type CriteriaOverlayStatFilter,
  type CriteriaOverlayStatGroup,
  type OverlayCriteria,
  type CriteriaOverlayOp,
} from '@/utils/criteria-overlay';
import { getActiveUiLocale, t } from '@/utils/i18n';
import { isTradeSearchFormUrl } from '@/utils/trade-search-identity';

const DEFAULT_TIMEOUT_MS = 5000;

export interface CriteriaOverlayPageSnapshot {
  snapshot: Record<string, unknown>;
  knownStatIds: ReadonlySet<string> | null;
}

/** 與 Main World 往返的通道；測試時可替換。 */
export interface CriteriaOverlayPageChannel {
  read(): Promise<CriteriaOverlayPageSnapshot>;
  commit(ops: readonly CriteriaOverlayOp[]): Promise<void>;
}

/** 只把官方搜尋表單寫進網址（不修改表單）的通道；測試時可替換。 */
export interface CriteriaOverlayUrlSyncChannel {
  /** 官方 `save(true)` 寫完網址後回傳 `location.href`。 */
  syncToUrl(): Promise<string>;
}

/** 同步失敗的錯誤：message 已翻譯，code 與 diagnostics 供日誌追查。 */
export class CriteriaOverlaySyncError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly diagnostics: PoeCriteriaOverlaySyncDiagnostics = {},
  ) {
    super(message);
    this.name = 'CriteriaOverlaySyncError';
  }
}

export interface CriteriaOverlaySession {
  /** 從目前官方表單擷取完整條件（尚未經使用者勾選）。 */
  capture(): Promise<OverlayCriteria>;
  /** 讀取目前官方表單的原始快照（詞綴群組位置與頁面一致）。 */
  readSnapshot(): Promise<CriteriaOverlayFormSnapshot>;
  /** 把條件疊加到目前搜尋，並記住一次復原。 */
  apply(criteria: OverlayCriteria): Promise<CriteriaOverlayApplyReport>;
  /** 以單一群組取代第 index 個詞綴群組（可同時覆寫物品識別），並記住一次復原。 */
  replaceStatGroup(
    index: number,
    groups: readonly CriteriaOverlayStatGroup[],
    item?: CriteriaOverlayItem,
  ): Promise<CriteriaOverlayApplyReport>;
  /**
   * 原地改寫第 index 個詞綴群組的條件（可同時改 value），並記住一次復原。
   * 群組不存在時拋出錯誤。
   */
  updateStatGroup(
    index: number,
    filters: readonly CriteriaOverlayStatFilter[],
    value?: Record<string, unknown> | null,
  ): Promise<CriteriaOverlayApplyReport>;
  /** 復原上次套用；沒有可復原的套用時回傳 false。 */
  undo(): Promise<boolean>;
  canUndo(): boolean;
  subscribeUndo(listener: (canUndo: boolean) => void): () => void;
}

function createRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function awaitReply<T>(
  type:
    | 'poexd-criteria-overlay-read-result'
    | 'poexd-criteria-overlay-commit-result'
    | 'poexd-criteria-overlay-sync-result',
  requestId: string,
  parse: (detail: unknown) => (T & { requestId: string }) | undefined,
  send: () => void,
  timeoutMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      stop();
      reject(new Error(t('criteriaOverlay.session.noResponse')));
    }, timeoutMs);
    const stop = listenPoeEvent(type, (detail) => {
      const reply = parse(detail);
      if (!reply || reply.requestId !== requestId) return;
      clearTimeout(timer);
      stop();
      resolve(reply);
    });
    send();
  });
}

function translateAdapterError(
  error: string | undefined,
  fallbackKey:
    | 'criteriaOverlay.session.readFailed'
    | 'criteriaOverlay.session.commitFailed'
    | 'formUrlSync.unknownReason',
): string {
  if (!error) return t(fallbackKey);
  if (error === 'FORM_STATE_NOT_FOUND') return t('criteriaOverlay.session.formStateNotFound');
  if (error === 'TRADE_ROOT_NOT_FOUND') return t('criteriaOverlay.session.tradeRootNotFound');
  if (error === 'PAGE_NOT_LOADED') return t('criteriaOverlay.session.pageNotLoaded');
  return error;
}

/** 透過跨世界事件與 Main World 的 criteria-overlay-adapter 溝通。 */
export function createPoeEventCriteriaOverlayChannel(
  timeoutMs = DEFAULT_TIMEOUT_MS,
): CriteriaOverlayPageChannel & CriteriaOverlayUrlSyncChannel {
  return {
    async read() {
      const requestId = createRequestId();
      const reply = await awaitReply(
        'poexd-criteria-overlay-read-result',
        requestId,
        parsePoeCriteriaOverlayReadResult,
        () =>
          dispatchPoeEvent(
            'poexd-criteria-overlay-read',
            serializePoeCriteriaOverlayRead({ requestId }),
          ),
        timeoutMs,
      );
      if (!reply.snapshot) {
        throw new Error(translateAdapterError(reply.error, 'criteriaOverlay.session.readFailed'));
      }
      return {
        snapshot: reply.snapshot,
        knownStatIds: reply.knownStatIds ? new Set(reply.knownStatIds) : null,
      };
    },
    async commit(ops) {
      const requestId = createRequestId();
      const reply = await awaitReply(
        'poexd-criteria-overlay-commit-result',
        requestId,
        parsePoeCriteriaOverlayCommitResult,
        () =>
          dispatchPoeEvent(
            'poexd-criteria-overlay-commit',
            serializePoeCriteriaOverlayCommit({ requestId, ops: [...ops] }),
          ),
        timeoutMs,
      );
      if (!reply.success) {
        throw new Error(translateAdapterError(reply.error, 'criteriaOverlay.session.commitFailed'));
      }
    },
    async syncToUrl() {
      const requestId = createRequestId();
      let reply;
      try {
        reply = await awaitReply(
          'poexd-criteria-overlay-sync-result',
          requestId,
          parsePoeCriteriaOverlaySyncResult,
          () =>
            dispatchPoeEvent(
              'poexd-criteria-overlay-sync',
              serializePoeCriteriaOverlaySync({ requestId }),
            ),
          timeoutMs,
        );
      } catch (error) {
        throw new CriteriaOverlaySyncError(
          error instanceof Error ? error.message : String(error),
          'NO_RESPONSE',
          { timeoutMs },
        );
      }
      if (!reply.success || typeof reply.url !== 'string') {
        throw new CriteriaOverlaySyncError(
          translateAdapterError(reply.error, 'formUrlSync.unknownReason'),
          reply.error ?? 'UNKNOWN',
          reply.diagnostics,
        );
      }
      return reply.url;
    },
  };
}

/** 只取路由前兩段（例如 `trade/search`），日誌不帶聯盟與查詢內容。 */
function describeRoute(url: string): string {
  try {
    return new URL(url).pathname.split('/').filter(Boolean).slice(0, 2).join('/');
  } catch {
    return '';
  }
}

export interface SyncSearchFormToUrlDeps {
  channel?: CriteriaOverlayUrlSyncChannel;
  readUrl?: () => string;
}

/**
 * 把官方搜尋表單目前的內容寫進網址後回傳網址（見 GLOSSARY.md「Bookmark」、ADR-0010）。
 * 官方網址不會隨每次表單修改更新，因此加入書籤前必須先同步；同步失敗時拋出錯誤，
 * 呼叫端不得退回儲存可能過時的網址。非搜尋路由（例如通貨兌換）直接回傳目前網址。
 */
export async function syncSearchFormToUrl(deps: SyncSearchFormToUrlDeps = {}): Promise<string> {
  const readUrl = deps.readUrl ?? (() => window.location.href);
  const before = readUrl();
  if (!isTradeSearchFormUrl(before)) return before;

  const channel = deps.channel ?? createPoeEventCriteriaOverlayChannel();
  const startedAt = Date.now();
  try {
    return await channel.syncToUrl();
  } catch (error) {
    const code = error instanceof CriteriaOverlaySyncError ? error.code : 'UNKNOWN';
    const diagnostics = error instanceof CriteriaOverlaySyncError ? error.diagnostics : {};
    console.error('[PoeXD] 同步搜尋表單到網址失敗:', {
      code,
      message: error instanceof Error ? error.message : String(error),
      route: describeRoute(before),
      elapsedMs: Date.now() - startedAt,
      visibility: typeof document !== 'undefined' ? document.visibilityState : undefined,
      readyState: typeof document !== 'undefined' ? document.readyState : undefined,
      ...diagnostics,
    });
    // 帶出實際原因（例如官方頁面沒有回應時要重新整理），而不是一律要使用者稍後再試
    const reason = error instanceof Error ? error.message.trim() : '';
    throw new Error(t('formUrlSync.failed', { reason: reason || t('formUrlSync.unknownReason') }), {
      cause: error,
    });
  }
}

export function createCriteriaOverlaySession(
  channel: CriteriaOverlayPageChannel = createPoeEventCriteriaOverlayChannel(),
): CriteriaOverlaySession {
  /** 上次套用的復原序列，以及套用完成當下的表單指紋。 */
  let pendingUndo: { ops: CriteriaOverlayOp[]; fingerprint: string } | null = null;
  const listeners = new Set<(canUndo: boolean) => void>();

  const setUndo = (next: { ops: CriteriaOverlayOp[]; fingerprint: string } | null) => {
    pendingUndo = next && next.ops.length > 0 ? next : null;
    listeners.forEach((listener) => listener(pendingUndo !== null));
  };

  const commitPlan = async (plan: CriteriaOverlayApplyPlan) => {
    if (plan.ops.length > 0) {
      setUndo(null);
      await channel.commit(plan.ops);
      const after = await channel.read();
      setUndo({ ops: plan.undoOps, fingerprint: criteriaOverlayFormFingerprint(after.snapshot) });
    }
    return plan.report;
  };

  return {
    async readSnapshot() {
      const { snapshot } = await channel.read();
      return snapshot;
    },

    async capture() {
      const { snapshot } = await channel.read();
      return captureOverlayCriteria(snapshot);
    },

    async apply(criteria) {
      const { snapshot, knownStatIds } = await channel.read();
      return commitPlan(planCriteriaOverlayApplication(criteria, snapshot, knownStatIds));
    },

    async replaceStatGroup(index, groups, item) {
      const { snapshot } = await channel.read();
      return commitPlan(planStatGroupReplacement(snapshot, index, groups, item));
    },

    async updateStatGroup(index, filters, value) {
      const { snapshot } = await channel.read();
      const plan = planStatGroupFiltersUpdate(snapshot, index, filters, value);
      if (!plan) throw new Error(`stat group ${index} not found`);
      return commitPlan(plan);
    },

    async undo() {
      if (!pendingUndo) return false;
      const { ops, fingerprint } = pendingUndo;
      const current = await channel.read();
      if (criteriaOverlayFormFingerprint(current.snapshot) !== fingerprint) {
        // 套用後頁面已被改動（手動編輯、清除或載入其他搜尋），復原會改錯對象
        setUndo(null);
        throw new Error(t('criteriaOverlay.session.undoConflict'));
      }
      await channel.commit(ops);
      setUndo(null);
      return true;
    },

    canUndo: () => pendingUndo !== null,

    subscribeUndo(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** 將套用結果整理成給使用者看的一句話。 */
export function describeCriteriaOverlayReport(
  name: string,
  report: CriteriaOverlayApplyReport,
): string {
  const parts: string[] = [];
  const activeUi = getActiveUiLocale();
  const sep = t('criteriaOverlay.report.separator');
  const enPlural = (count: number) => (activeUi === 'en' && count > 1 ? 's' : '');

  if (report.addedStatGroups > 0) {
    parts.push(
      t('criteriaOverlay.report.addedStatGroups', {
        count: report.addedStatGroups,
        s: enPlural(report.addedStatGroups),
      }),
    );
  }
  if (report.changedFields > 0) {
    parts.push(
      t('criteriaOverlay.report.changedFields', {
        count: report.changedFields,
        s: enPlural(report.changedFields),
      }),
    );
  }
  if ((report.updatedStatGroups ?? 0) > 0) {
    parts.push(
      t('criteriaOverlay.report.updatedStatGroups', {
        count: report.updatedStatGroups ?? 0,
        s: enPlural(report.updatedStatGroups ?? 0),
      }),
    );
  }
  if (report.changedItem) parts.push(t('criteriaOverlay.report.changedItem'));
  if (report.changedStatus) parts.push(t('criteriaOverlay.report.changedStatus'));

  const skipped: string[] = [];
  if (report.skippedDuplicateStatGroups > 0) {
    skipped.push(
      t('criteriaOverlay.report.skippedDuplicate', {
        count: report.skippedDuplicateStatGroups,
        s: enPlural(report.skippedDuplicateStatGroups),
      }),
    );
  }
  if (report.skippedUnknownStatFilters > 0) {
    skipped.push(
      t('criteriaOverlay.report.skippedUnknown', {
        count: report.skippedUnknownStatFilters,
        s: enPlural(report.skippedUnknownStatFilters),
      }),
    );
  }

  const done = parts.length > 0 ? parts.join(sep) : t('criteriaOverlay.report.noChanges');
  return skipped.length > 0
    ? t('criteriaOverlay.report.templateWithSkipped', { name, done, skipped: skipped.join(sep) })
    : t('criteriaOverlay.report.template', { name, done });
}
