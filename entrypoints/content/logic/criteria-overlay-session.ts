import {
  dispatchPoeEvent,
  listenPoeEvent,
  parsePoeCriteriaOverlayCommitResult,
  parsePoeCriteriaOverlayReadResult,
  serializePoeCriteriaOverlayCommit,
  serializePoeCriteriaOverlayRead,
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
  type: 'poexd-criteria-overlay-read-result' | 'poexd-criteria-overlay-commit-result',
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

/** 透過跨世界事件與 Main World 的 criteria-overlay-adapter 溝通。 */
export function createPoeEventCriteriaOverlayChannel(
  timeoutMs = DEFAULT_TIMEOUT_MS,
): CriteriaOverlayPageChannel {
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
      if (!reply.snapshot) throw new Error(reply.error ?? t('criteriaOverlay.session.readFailed'));
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
      if (!reply.success) throw new Error(reply.error ?? t('criteriaOverlay.session.commitFailed'));
    },
  };
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
