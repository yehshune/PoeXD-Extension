import { ref, type Ref } from 'vue';
import { requestMainWorld, type RpcDiagnostics } from '@/utils/cross-world-rpc';
import { dispatchPoeEvent } from '@/utils/event-contracts';
import {
  captureOverlayCriteria,
  criteriaOverlayFormFingerprint,
  isEmptyOverlayCriteria,
  pickCriteriaOverlayParts,
  planCriteriaOverlayApplication,
  planStatGroupFiltersUpdate,
  planStatGroupReplacement,
  type CriteriaOverlayApplyPlan,
  type CriteriaOverlayApplyReport,
  type CriteriaOverlayFormSnapshot,
  type CriteriaOverlayItem,
  type CriteriaOverlayOp,
  type CriteriaOverlayStatFilter,
  type CriteriaOverlayStatGroup,
  type OverlayCriteria,
} from '@/utils/criteria-overlay';
import { getPoeVersion, type PoeVersion } from '@/utils/trade-context';
import { getActiveUiLocale, t } from '@/utils/i18n';
import { loadTradeDictionaries } from '@/utils/trade-stat-dictionary';
import { isTradeSearchFormUrl } from '@/utils/trade-search-identity';
import {
  labelCriteriaOverlayParts,
  type CriteriaOverlayPartLabel,
} from '@/components/injected/criteria-overlay-labels';
import {
  STAT_GROUP_TEMPLATE_NAME_MAX_LENGTH,
  STAT_GROUP_TEMPLATE_TRANSFER_FORMAT,
  createStatGroupTemplateStore,
  filterTemplates,
  normalizeStatGroupTemplateName,
  parseStatGroupTemplateTransfer,
  serializeStatGroupTemplates,
  statGroupTemplateStorageKey,
  type StatGroupTemplate,
  type StatGroupTemplateEntry,
  type StatGroupTemplateStorage,
  type StatGroupTemplateTransfer,
} from '@/utils/stat-group-template-store';

export {
  STAT_GROUP_TEMPLATE_NAME_MAX_LENGTH,
  STAT_GROUP_TEMPLATE_TRANSFER_FORMAT,
  filterTemplates,
  normalizeStatGroupTemplateName,
  parseStatGroupTemplateTransfer,
  serializeStatGroupTemplates,
  statGroupTemplateStorageKey,
  type StatGroupTemplate,
  type StatGroupTemplateEntry,
  type StatGroupTemplateStorage,
  type StatGroupTemplateTransfer,
};

const DEFAULT_TIMEOUT_MS = 5000;

export type OverlayToastTone = 'default' | 'success' | 'error';

export interface CriteriaOverlayPageSnapshot {
  snapshot: Record<string, unknown>;
  knownStatIds: ReadonlySet<string> | null;
}

/** 與 Main World 往返的通道；測試時可替換為記憶體 adapter。 */
export interface CriteriaOverlayPageChannel {
  read(): Promise<CriteriaOverlayPageSnapshot>;
  commit(ops: readonly CriteriaOverlayOp[]): Promise<void>;
}

/** 只把官方搜尋表單寫進網址（不修改表單）的通道；測試時可替換。 */
export interface CriteriaOverlayUrlSyncChannel {
  /** 官方寫完網址（`updateUrl()`，退回 `save(true)`）後回傳 `location.href`。 */
  syncToUrl(): Promise<string>;
}

/** 同步失敗的錯誤：message 已翻譯，code 與 diagnostics 供日誌追查。 */
export class CriteriaOverlaySyncError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly diagnostics: RpcDiagnostics = {},
  ) {
    super(message);
    this.name = 'CriteriaOverlaySyncError';
  }
}

export interface SyncSearchFormToUrlDeps {
  channel?: CriteriaOverlayUrlSyncChannel;
  readUrl?: () => string;
}

export interface CriteriaOverlayManagerDeps {
  version: PoeVersion;
  channel?: CriteriaOverlayPageChannel;
  storage?: StatGroupTemplateStorage;
  now?: () => number;
  createId?: () => string;
  notify?: (message: string, tone: OverlayToastTone) => void;
  confirm?: (message: string, title: string) => Promise<boolean>;
  loadDictionaries?: (version: PoeVersion) => Promise<unknown>;
}

export interface TemplateSaveDialogState {
  open: Ref<boolean>;
  parts: Ref<CriteriaOverlayPartLabel[]>;
}

/**
 * Criteria Overlay 與 Stat Group Template 的共用狀態與操作（見 GLOSSARY.md、ADR-0010）。
 * 「新增詞綴群組」選單、常用詞綴群組分頁與書籤／歷史的 Search Preview 共用同一份，
 * 因此「復原上次套用」不論從哪裡疊加都一致。
 */
export interface CriteriaOverlayManager {
  version: PoeVersion;
  templates: Ref<StatGroupTemplate[]>;
  canUndo: Ref<boolean>;
  busy: Ref<boolean>;
  saveDialog: TemplateSaveDialogState;
  start(): Promise<void>;
  /** 疊加條件；成功套用時回傳 true（失敗已通知使用者）。 */
  overlay(criteria: OverlayCriteria, sourceName: string): Promise<boolean>;
  /** 讀取目前官方表單的原始快照；失敗時通知使用者並回傳 null。 */
  readFormSnapshot(): Promise<CriteriaOverlayFormSnapshot | null>;
  /** 以單一群組取代第 index 個詞綴群組（可同時覆寫物品識別），可用「復原上次套用」還原。 */
  replaceStatGroup(
    index: number,
    groups: readonly CriteriaOverlayStatGroup[],
    sourceName: string,
    item?: CriteriaOverlayItem,
  ): Promise<boolean>;
  /** 原地改寫第 index 個詞綴群組的條件；成功回傳 true。 */
  updateStatGroup(
    index: number,
    filters: readonly CriteriaOverlayStatFilter[],
    sourceName: string,
    value?: Record<string, unknown> | null,
  ): Promise<boolean>;
  applyTemplate(template: StatGroupTemplate): Promise<void>;
  undo(): Promise<void>;
  beginSaveTemplate(): Promise<void>;
  saveTemplate(payload: { name: string; keys: readonly string[] }): Promise<void>;
  renameTemplate(template: StatGroupTemplate, newName: string): Promise<void>;
  /** 把預覽中微調後的詞綴群組存回範本；成功回傳 true。 */
  updateTemplateStatGroups(
    template: StatGroupTemplate,
    statGroups: readonly CriteriaOverlayStatGroup[],
  ): Promise<boolean>;
  removeTemplate(template: StatGroupTemplate): Promise<void>;
  reorderTemplates(orderedIds: readonly string[]): Promise<void>;
  /** 目前清單的匯出內容。 */
  exportTemplates(): string;
  /** 直接附加匯入已解析的常用詞綴群組項目。 */
  importTemplateEntries(
    entries: readonly StatGroupTemplateEntry[],
    skipped?: number,
  ): Promise<boolean>;
  /** 確認後清空目前版本的所有常用詞綴群組。 */
  clearTemplates(): Promise<void>;
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

/** 透過 Cross-World RPC 與 Main World 的 criteria-overlay-adapter 溝通。 */
export function createPoeEventCriteriaOverlayChannel(
  timeoutMs = DEFAULT_TIMEOUT_MS,
): CriteriaOverlayPageChannel & CriteriaOverlayUrlSyncChannel {
  return {
    async read() {
      const outcome = await requestMainWorld('criteria-overlay.read', undefined, { timeoutMs });
      if (!outcome.ok) {
        if (outcome.code === 'TIMEOUT') {
          throw new Error(t('criteriaOverlay.session.noResponse'));
        }
        throw new Error(translateAdapterError(outcome.error, 'criteriaOverlay.session.readFailed'));
      }
      return {
        snapshot: outcome.data.snapshot,
        knownStatIds: outcome.data.knownStatIds ? new Set(outcome.data.knownStatIds) : null,
      };
    },
    async commit(ops) {
      const outcome = await requestMainWorld(
        'criteria-overlay.commit',
        { ops: [...ops] },
        { timeoutMs },
      );
      if (!outcome.ok) {
        if (outcome.code === 'TIMEOUT') {
          throw new Error(t('criteriaOverlay.session.noResponse'));
        }
        throw new Error(
          translateAdapterError(outcome.error, 'criteriaOverlay.session.commitFailed'),
        );
      }
    },
    async syncToUrl() {
      const outcome = await requestMainWorld('criteria-overlay.sync', undefined, { timeoutMs });
      if (!outcome.ok) {
        if (outcome.code === 'TIMEOUT') {
          throw new CriteriaOverlaySyncError(
            t('criteriaOverlay.session.noResponse'),
            'NO_RESPONSE',
            { timeoutMs },
          );
        }
        throw new CriteriaOverlaySyncError(
          translateAdapterError(outcome.error, 'formUrlSync.unknownReason'),
          outcome.code || outcome.error || 'UNKNOWN',
          outcome.diagnostics,
        );
      }
      return outcome.data.url;
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
    const reason = error instanceof Error ? error.message.trim() : '';
    throw new Error(t('formUrlSync.failed', { reason: reason || t('formUrlSync.unknownReason') }), {
      cause: error,
    });
  }
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type DialogWindow = Window & {
  poexdConfirm?: (message: string, title?: string) => Promise<boolean>;
};

function defaultConfirm(message: string, title: string): Promise<boolean> {
  const confirm = (window as DialogWindow).poexdConfirm;
  return confirm ? confirm(message, title) : Promise.resolve(false);
}

function defaultNotify(message: string, tone: OverlayToastTone) {
  dispatchPoeEvent('poexd-toast', { message, tone });
}

const statGroupsOnly = (template: StatGroupTemplate): OverlayCriteria => ({
  statGroups: template.statGroups,
  fields: [],
  sectionDisabled: {},
});

export function createCriteriaOverlayManager(
  deps: CriteriaOverlayManagerDeps,
): CriteriaOverlayManager {
  const { version } = deps;
  const channel = deps.channel ?? createPoeEventCriteriaOverlayChannel();
  const store = createStatGroupTemplateStore({
    version,
    storage: deps.storage,
    now: deps.now,
    createId: deps.createId,
  });
  const notify = deps.notify ?? defaultNotify;
  const confirm = deps.confirm ?? defaultConfirm;
  const loadDictionaries = deps.loadDictionaries ?? loadTradeDictionaries;

  const templates = ref<StatGroupTemplate[]>([]);
  const canUndo = ref(false);
  const busy = ref(false);
  const saveDialog: TemplateSaveDialogState = { open: ref(false), parts: ref([]) };
  let captured: OverlayCriteria | null = null;
  let pendingUndo: { ops: CriteriaOverlayOp[]; fingerprint: string } | null = null;
  let starting: Promise<void> | null = null;

  const setUndo = (next: { ops: CriteriaOverlayOp[]; fingerprint: string } | null) => {
    pendingUndo = next && next.ops.length > 0 ? next : null;
    canUndo.value = pendingUndo !== null;
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

  const run = async (task: () => Promise<boolean | void>): Promise<boolean> => {
    if (busy.value) return false;
    busy.value = true;
    try {
      return (await task()) !== false;
    } catch (error) {
      notify(errorMessage(error), 'error');
      return false;
    } finally {
      busy.value = false;
    }
  };

  const runVoid = async (task: () => Promise<void>): Promise<void> => {
    await run(task);
  };

  const overlay = (criteria: OverlayCriteria, sourceName: string) =>
    run(async () => {
      if (isEmptyOverlayCriteria(criteria)) {
        notify(t('statGroupTemplate.error.noOverlayCriteria'), 'error');
        return false;
      }
      const { snapshot, knownStatIds } = await channel.read();
      const report = await commitPlan(
        planCriteriaOverlayApplication(criteria, snapshot, knownStatIds),
      );
      notify(describeCriteriaOverlayReport(sourceName, report), 'success');
    });

  const start = () => {
    starting ??= (async () => {
      try {
        store.subscribe((next) => {
          templates.value = next;
        });
        templates.value = await store.load();
      } catch (error) {
        console.warn('[PoeXD] 常用詞綴群組初始化失敗:', error);
      }
    })();
    return starting;
  };

  return {
    version,
    templates,
    canUndo,
    busy,
    saveDialog,
    start,
    overlay,

    applyTemplate: async (template) => {
      await overlay(statGroupsOnly(template), template.name);
    },

    readFormSnapshot: async () => {
      try {
        const { snapshot } = await channel.read();
        return snapshot;
      } catch (error) {
        notify(errorMessage(error), 'error');
        return null;
      }
    },

    replaceStatGroup: (index, groups, sourceName, item) =>
      run(async () => {
        const { snapshot } = await channel.read();
        const report = await commitPlan(planStatGroupReplacement(snapshot, index, groups, item));
        notify(describeCriteriaOverlayReport(sourceName, report), 'success');
      }),

    updateStatGroup: (index, filters, sourceName, value) =>
      run(async () => {
        const { snapshot } = await channel.read();
        const plan = planStatGroupFiltersUpdate(snapshot, index, filters, value);
        if (!plan) {
          throw new Error(t('criteriaOverlay.session.statGroupNotFound', { index: index + 1 }));
        }
        const report = await commitPlan(plan);
        notify(describeCriteriaOverlayReport(sourceName, report), 'success');
      }),

    undo: () =>
      runVoid(async () => {
        if (!pendingUndo) return;
        const { ops, fingerprint } = pendingUndo;
        const current = await channel.read();
        if (criteriaOverlayFormFingerprint(current.snapshot) !== fingerprint) {
          setUndo(null);
          throw new Error(t('criteriaOverlay.session.undoConflict'));
        }
        await channel.commit(ops);
        setUndo(null);
        notify(t('statGroupTemplate.toast.undone'), 'success');
      }),

    beginSaveTemplate: () =>
      runVoid(async () => {
        const { snapshot } = await channel.read();
        const criteria = captureOverlayCriteria(snapshot);
        if (criteria.statGroups.length === 0) {
          notify(t('statGroupTemplate.error.noSavableGroups'), 'error');
          return;
        }
        await loadDictionaries(version);
        captured = { statGroups: criteria.statGroups, fields: [], sectionDisabled: {} };
        saveDialog.parts.value = labelCriteriaOverlayParts(captured, version);
        saveDialog.open.value = true;
      }),

    saveTemplate: (payload) =>
      runVoid(async () => {
        if (!captured) return;
        const picked = pickCriteriaOverlayParts(captured, new Set(payload.keys));
        templates.value = await store.add(payload.name, picked.statGroups);
        saveDialog.open.value = false;
        captured = null;
        notify(t('statGroupTemplate.toast.saved', { name: payload.name }), 'success');
      }),

    renameTemplate: (template, newName) =>
      runVoid(async () => {
        if (newName == null || newName.trim() === '' || newName.trim() === template.name) return;
        templates.value = await store.rename(template.id, newName);
      }),

    updateTemplateStatGroups: (template, statGroups) =>
      run(async () => {
        templates.value = await store.updateStatGroups(template.id, statGroups);
        notify(t('statGroupTemplate.toast.updated', { name: template.name }), 'success');
      }),

    removeTemplate: (template) =>
      runVoid(async () => {
        const confirmed = await confirm(
          t('statGroupTemplate.dialog.deleteConfirm', { name: template.name }),
          t('statGroupTemplate.dialog.deleteTitle'),
        );
        if (!confirmed) return;
        templates.value = await store.remove(template.id);
      }),

    reorderTemplates: (orderedIds) =>
      runVoid(async () => {
        templates.value = await store.reorder(orderedIds);
      }),

    exportTemplates: () => store.exportJson(templates.value),

    importTemplateEntries: (entries, skipped = 0) =>
      run(async () => {
        if (entries.length === 0) return false;
        templates.value = await store.addMany(entries);
        notify(
          skipped > 0
            ? t('statGroupTemplate.toast.importedWithSkipped', {
                count: entries.length,
                skipped,
              })
            : t('statGroupTemplate.toast.imported', { count: entries.length }),
          'success',
        );
      }),

    clearTemplates: () =>
      runVoid(async () => {
        if (templates.value.length === 0) return;
        const confirmed = await confirm(
          t('statGroupTemplate.dialog.clearConfirm', { count: templates.value.length }),
          t('statGroupTemplate.dialog.clearTitle'),
        );
        if (!confirmed) return;
        templates.value = await store.clear();
        notify(t('statGroupTemplate.toast.cleared'), 'success');
      }),
  };
}

let shared: CriteriaOverlayManager | null = null;

/** 取得目前頁面共用的管理器（content script 生命週期內只建立一次）。 */
export function useCriteriaOverlayManager(): CriteriaOverlayManager {
  shared ??= createCriteriaOverlayManager({ version: getPoeVersion() });
  void shared.start();
  return shared;
}
