import { ref, type Ref } from 'vue';
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
  isEmptyOverlayCriteria,
  parseCriteriaOverlayStatGroups,
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
import { loadTradeDictionaries, translateStatLines } from '@/utils/trade-stat-dictionary';
import { isTradeSearchFormUrl } from '@/utils/trade-search-identity';
import {
  labelCriteriaOverlayParts,
  type CriteriaOverlayPartLabel,
} from '@/components/injected/criteria-overlay-labels';

const DEFAULT_TIMEOUT_MS = 5000;
const TRANSFER_VERSION = 1;

export const STAT_GROUP_TEMPLATE_NAME_MAX_LENGTH = 60;
export const STAT_GROUP_TEMPLATE_TRANSFER_FORMAT = 'poexd-stat-group-templates';

export type OverlayToastTone = 'default' | 'success' | 'error';

/** 最小 key-value 儲存介面（與 PreferencesStorage 相容，測試可替換為記憶體實作）。 */
export interface StatGroupTemplateStorage {
  get(keys: readonly string[]): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
  subscribe(listener: (changes: Record<string, unknown>) => void | Promise<void>): () => void;
}

/** 一筆 Stat Group Template（常用詞綴群組）。見 GLOSSARY.md、ADR-0010。 */
export interface StatGroupTemplate {
  id: string;
  name: string;
  statGroups: CriteriaOverlayStatGroup[];
  createdAt: number;
  updatedAt: number;
}

/** 匯入時要新增的一筆常用詞綴群組（id 與時間由儲存層重新產生）。 */
export interface StatGroupTemplateEntry {
  name: string;
  statGroups: CriteriaOverlayStatGroup[];
}

export interface StatGroupTemplateTransfer {
  entries: StatGroupTemplateEntry[];
  /** 無法解析而略過的項目數。 */
  skipped: number;
}

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
    readonly diagnostics: PoeCriteriaOverlaySyncDiagnostics = {},
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

export function statGroupTemplateStorageKey(version: PoeVersion): string {
  return `poexdStatGroupTemplatesV1_${version}`;
}

export function normalizeStatGroupTemplateName(name: string): string {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed) throw new Error(t('statGroupTemplate.error.nameEmpty'));
  if (trimmed.length > STAT_GROUP_TEMPLATE_NAME_MAX_LENGTH) {
    throw new Error(
      t('statGroupTemplate.error.nameTooLong', { max: STAT_GROUP_TEMPLATE_NAME_MAX_LENGTH }),
    );
  }
  return trimmed;
}

/** 匯出成可分享的 JSON；只保留名稱與詞綴群組，不含本機 id 與時間。 */
export function serializeStatGroupTemplates(
  gameVersion: PoeVersion,
  templates: readonly StatGroupTemplate[],
): string {
  return JSON.stringify({
    format: STAT_GROUP_TEMPLATE_TRANSFER_FORMAT,
    version: TRANSFER_VERSION,
    gameVersion,
    templates: templates.map(({ name, statGroups }) => ({ name, statGroups })),
  });
}

function parseTransferEntry(value: unknown): StatGroupTemplateEntry | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const statGroups = parseCriteriaOverlayStatGroups(raw.statGroups);
  if (!statGroups || statGroups.length === 0 || typeof raw.name !== 'string') return undefined;
  try {
    return { name: normalizeStatGroupTemplateName(raw.name), statGroups };
  } catch {
    return undefined;
  }
}

/**
 * 解析匯入內容。詞綴 ID 依遊戲版本不同，因此拒絕其他版本匯出的內容。
 * @throws 內容不是常用詞綴群組匯出格式、版本不符或沒有任何有效項目時
 */
export function parseStatGroupTemplateTransfer(
  text: string,
  gameVersion: PoeVersion,
): StatGroupTemplateTransfer {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(t('statGroupTemplate.error.importInvalidFormat'));
  }
  const raw = payload as Record<string, unknown> | null;
  if (
    !raw ||
    typeof raw !== 'object' ||
    raw.format !== STAT_GROUP_TEMPLATE_TRANSFER_FORMAT ||
    !Array.isArray(raw.templates)
  ) {
    throw new Error(t('statGroupTemplate.error.importInvalidFormat'));
  }
  if (raw.gameVersion !== gameVersion) {
    throw new Error(
      t('statGroupTemplate.error.importVersionMismatch', {
        sourceVersion: String(raw.gameVersion).toUpperCase(),
        targetVersion: gameVersion.toUpperCase(),
      }),
    );
  }
  const entries = raw.templates
    .map(parseTransferEntry)
    .filter((entry): entry is StatGroupTemplateEntry => entry !== undefined);
  if (entries.length === 0) throw new Error(t('statGroupTemplate.error.importEmpty'));
  return { entries, skipped: raw.templates.length - entries.length };
}

/** 依名稱、詞綴 ID 或群組內詞綴文字篩選（不分大小寫）；空白查詢回傳原陣列。 */
export function filterTemplates(
  templates: readonly StatGroupTemplate[],
  query: string,
  version?: PoeVersion,
): readonly StatGroupTemplate[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return templates;
  return templates.filter((t) => {
    if (t.name.toLowerCase().includes(needle)) return true;
    const groups = t.statGroups;
    if (!Array.isArray(groups)) return false;
    return groups.some((group) =>
      group.filters?.some((filter) => {
        if (!filter?.id) return false;
        if (filter.id.toLowerCase().includes(needle)) return true;
        return translateStatLines(filter.id, version).some((line) =>
          line.toLowerCase().includes(needle),
        );
      }),
    );
  });
}

function createRandomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function createRequestId(): string {
  return createRandomId();
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

function createChromeLocalStorage(): StatGroupTemplateStorage {
  return {
    get: (keys) => chrome.storage.local.get([...keys]),
    set: (values) => chrome.storage.local.set(values),
    subscribe(listener) {
      const handle = (changes: Record<string, { newValue?: unknown }>, areaName: string) => {
        if (areaName !== 'local') return;
        void listener(
          Object.fromEntries(Object.entries(changes).map(([k, change]) => [k, change.newValue])),
        );
      };
      chrome.storage.onChanged.addListener(handle);
      return () => chrome.storage.onChanged.removeListener(handle);
    },
  };
}

function parseStoredTemplate(value: unknown): StatGroupTemplate | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const statGroups = parseCriteriaOverlayStatGroups(raw.statGroups);
  if (
    typeof raw.id !== 'string' ||
    raw.id === '' ||
    typeof raw.name !== 'string' ||
    raw.name.trim() === '' ||
    !statGroups ||
    statGroups.length === 0 ||
    typeof raw.createdAt !== 'number' ||
    typeof raw.updatedAt !== 'number'
  ) {
    return undefined;
  }
  return {
    id: raw.id,
    name: raw.name,
    statGroups,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

interface StoredList {
  templates: StatGroupTemplate[];
  /** 無法解析的原始項目（例如較新版本寫入的格式），寫回時原樣保留。 */
  unparsed: unknown[];
}

function parseStoredList(value: unknown): StoredList {
  if (!Array.isArray(value)) return { templates: [], unparsed: [] };
  return value.reduce<StoredList>(
    (acc, raw) => {
      const parsed = parseStoredTemplate(raw);
      return parsed
        ? { ...acc, templates: [...acc.templates, parsed] }
        : { ...acc, unparsed: [...acc.unparsed, raw] };
    },
    { templates: [], unparsed: [] },
  );
}

function defaultCreateId(): string {
  return `stat-group-template:${createRandomId()}`;
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
  const storage = deps.storage ?? createChromeLocalStorage();
  const now = deps.now ?? Date.now;
  const createId = deps.createId ?? defaultCreateId;
  const notify = deps.notify ?? defaultNotify;
  const confirm = deps.confirm ?? defaultConfirm;
  const loadDictionaries = deps.loadDictionaries ?? loadTradeDictionaries;
  const storageKey = statGroupTemplateStorageKey(version);

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

  const buildTemplate = (
    name: string,
    statGroups: readonly CriteriaOverlayStatGroup[],
  ): StatGroupTemplate => {
    if (statGroups.length === 0) throw new Error(t('statGroupTemplate.error.emptyGroups'));
    const timestamp = now();
    return {
      id: createId(),
      name: normalizeStatGroupTemplateName(name),
      statGroups: JSON.parse(JSON.stringify(statGroups)),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  };

  const readStored = async () => parseStoredList((await storage.get([storageKey]))[storageKey]);

  const updateStored = async (mutate: (current: StatGroupTemplate[]) => StatGroupTemplate[]) => {
    const { templates: current, unparsed } = await readStored();
    const next = mutate(current);
    await storage.set({ [storageKey]: [...next, ...unparsed] });
    templates.value = next;
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
        storage.subscribe((changes) => {
          if (storageKey in changes) {
            templates.value = parseStoredList(changes[storageKey]).templates;
          }
        });
        templates.value = (await readStored()).templates;
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
        const template = buildTemplate(payload.name, picked.statGroups);
        await updateStored((current) => [...current, template]);
        saveDialog.open.value = false;
        captured = null;
        notify(t('statGroupTemplate.toast.saved', { name: payload.name }), 'success');
      }),

    renameTemplate: (template, newName) =>
      runVoid(async () => {
        if (newName == null || newName.trim() === '' || newName.trim() === template.name) return;
        const normalized = normalizeStatGroupTemplateName(newName);
        await updateStored((current) => {
          if (!current.some((item) => item.id === template.id)) {
            throw new Error(t('statGroupTemplate.error.notFound'));
          }
          return current.map((item) =>
            item.id === template.id ? { ...item, name: normalized, updatedAt: now() } : item,
          );
        });
      }),

    updateTemplateStatGroups: (template, statGroups) =>
      run(async () => {
        const parsed = parseCriteriaOverlayStatGroups(JSON.parse(JSON.stringify(statGroups)));
        if (!parsed || parsed.length === 0) {
          throw new Error(t('statGroupTemplate.error.emptyGroups'));
        }
        await updateStored((current) => {
          if (!current.some((item) => item.id === template.id)) {
            throw new Error(t('statGroupTemplate.error.notFound'));
          }
          return current.map((item) =>
            item.id === template.id ? { ...item, statGroups: parsed, updatedAt: now() } : item,
          );
        });
        notify(t('statGroupTemplate.toast.updated', { name: template.name }), 'success');
      }),

    removeTemplate: (template) =>
      runVoid(async () => {
        const confirmed = await confirm(
          t('statGroupTemplate.dialog.deleteConfirm', { name: template.name }),
          t('statGroupTemplate.dialog.deleteTitle'),
        );
        if (!confirmed) return;
        await updateStored((current) => current.filter((item) => item.id !== template.id));
      }),

    reorderTemplates: (orderedIds) =>
      runVoid(() =>
        updateStored((current) => {
          const byId = new Map(current.map((item) => [item.id, item]));
          const ordered = orderedIds
            .map((id) => byId.get(id))
            .filter((item): item is StatGroupTemplate => item !== undefined);
          const listed = new Set(ordered.map((item) => item.id));
          return [...ordered, ...current.filter((item) => !listed.has(item.id))];
        }),
      ),

    exportTemplates: () => serializeStatGroupTemplates(version, templates.value),

    importTemplateEntries: (entries, skipped = 0) =>
      run(async () => {
        if (entries.length === 0) return false;
        const created = entries.map((entry) => buildTemplate(entry.name, entry.statGroups));
        await updateStored((current) => [...current, ...created]);
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
        await updateStored(() => []);
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
