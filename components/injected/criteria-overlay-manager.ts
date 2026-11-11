import { ref, type Ref } from 'vue';
import { dispatchPoeEvent } from '@/utils/event-contracts';
import {
  isEmptyOverlayCriteria,
  pickCriteriaOverlayParts,
  type CriteriaOverlayFormSnapshot,
  type CriteriaOverlayItem,
  type CriteriaOverlayStatFilter,
  type CriteriaOverlayStatGroup,
  type OverlayCriteria,
} from '@/utils/criteria-overlay';
import {
  createStatGroupTemplateStore,
  type StatGroupTemplate,
  type StatGroupTemplateStore,
} from '@/utils/stat-group-template-store';
import {
  parseStatGroupTemplateTransfer,
  serializeStatGroupTemplates,
} from '@/utils/stat-group-template-transfer';
import { getPoeVersion, type PoeVersion } from '@/utils/trade-context';
import { loadTradeDictionaries } from '@/utils/trade-stat-dictionary';
import {
  createCriteriaOverlaySession,
  describeCriteriaOverlayReport,
  type CriteriaOverlaySession,
} from '@/entrypoints/content/logic/criteria-overlay-session';
import {
  labelCriteriaOverlayParts,
  type CriteriaOverlayPartLabel,
} from './criteria-overlay-labels';

export type OverlayToastTone = 'default' | 'success' | 'error';

export interface CriteriaOverlayManagerDeps {
  version: PoeVersion;
  createStore?: (version: PoeVersion) => StatGroupTemplateStore;
  session?: CriteriaOverlaySession;
  notify?: (message: string, tone: OverlayToastTone) => void;
  confirm?: (message: string, title: string) => Promise<boolean>;
  prompt?: (message: string, defaultValue: string, title: string) => Promise<string | null>;
  loadDictionaries?: (version: PoeVersion) => Promise<unknown>;
}

export interface TemplateSaveDialogState {
  open: Ref<boolean>;
  parts: Ref<CriteriaOverlayPartLabel[]>;
}

/**
 * Criteria Overlay 與 Stat Group Template 的共用狀態與操作（見 CONTEXT.md、ADR-0010）。
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
  renameTemplate(template: StatGroupTemplate): Promise<void>;
  removeTemplate(template: StatGroupTemplate): Promise<void>;
  reorderTemplates(orderedIds: readonly string[]): Promise<void>;
  /** 目前清單的匯出內容（見 stat-group-template-transfer）。 */
  exportTemplates(): string;
  /** 請使用者貼上匯出內容後附加匯入。 */
  importTemplates(): Promise<void>;
  /** 確認後清空目前版本的所有常用詞綴群組。 */
  clearTemplates(): Promise<void>;
}

/** 依名稱篩選（不分大小寫）；空白查詢回傳原陣列。 */
export function filterTemplatesByName(
  templates: readonly StatGroupTemplate[],
  query: string,
): readonly StatGroupTemplate[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return templates;
  return templates.filter((t) => t.name.toLowerCase().includes(needle));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type DialogWindow = Window & {
  poexdConfirm?: (message: string, title?: string) => Promise<boolean>;
  poexdPrompt?: (message: string, defaultValue?: string, title?: string) => Promise<string | null>;
};

function defaultConfirm(message: string, title: string): Promise<boolean> {
  const confirm = (window as DialogWindow).poexdConfirm;
  return confirm ? confirm(message, title) : Promise.resolve(false);
}

function defaultPrompt(message: string, defaultValue: string, title: string) {
  const prompt = (window as DialogWindow).poexdPrompt;
  return prompt ? prompt(message, defaultValue, title) : Promise.resolve(null);
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
  const session = deps.session ?? createCriteriaOverlaySession();
  const notify = deps.notify ?? defaultNotify;
  const confirm = deps.confirm ?? defaultConfirm;
  const prompt = deps.prompt ?? defaultPrompt;
  const loadDictionaries = deps.loadDictionaries ?? loadTradeDictionaries;
  const createStore = deps.createStore ?? createStatGroupTemplateStore;

  const templates = ref<StatGroupTemplate[]>([]);
  const canUndo = ref(session.canUndo());
  const busy = ref(false);
  const saveDialog: TemplateSaveDialogState = { open: ref(false), parts: ref([]) };
  let captured: OverlayCriteria | null = null;
  let store: StatGroupTemplateStore | null = null;
  let starting: Promise<void> | null = null;

  const requireStore = (): StatGroupTemplateStore => {
    if (!store) throw new Error('常用詞綴群組尚未就緒，請稍後再試');
    return store;
  };

  const run = async (task: () => Promise<void>) => {
    if (busy.value) return;
    busy.value = true;
    try {
      await task();
    } catch (error) {
      notify(errorMessage(error), 'error');
    } finally {
      busy.value = false;
    }
  };

  const overlay = async (criteria: OverlayCriteria, sourceName: string) => {
    let applied = false;
    await run(async () => {
      if (isEmptyOverlayCriteria(criteria)) {
        notify('沒有可疊加的條件', 'error');
        return;
      }
      const report = await session.apply(criteria);
      notify(describeCriteriaOverlayReport(sourceName, report), 'success');
      applied = true;
    });
    return applied;
  };

  const start = () => {
    starting ??= (async () => {
      session.subscribeUndo((value) => {
        canUndo.value = value;
      });
      try {
        const created = createStore(version);
        store = created;
        created.subscribe((next) => {
          templates.value = next;
        });
        templates.value = await created.list();
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
        return await session.readSnapshot();
      } catch (error) {
        notify(errorMessage(error), 'error');
        return null;
      }
    },

    replaceStatGroup: async (index, groups, sourceName, item) => {
      let replaced = false;
      await run(async () => {
        const report = await session.replaceStatGroup(index, groups, item);
        notify(describeCriteriaOverlayReport(sourceName, report), 'success');
        replaced = true;
      });
      return replaced;
    },

    updateStatGroup: async (index, filters, sourceName, value) => {
      let updated = false;
      await run(async () => {
        const report = await session.updateStatGroup(index, filters, value);
        notify(describeCriteriaOverlayReport(sourceName, report), 'success');
        updated = true;
      });
      return updated;
    },

    undo: () =>
      run(async () => {
        if (await session.undo()) notify('已復原上次套用', 'success');
      }),

    beginSaveTemplate: () =>
      run(async () => {
        const criteria = await session.capture();
        if (criteria.statGroups.length === 0) {
          notify('目前表單沒有可儲存的詞綴群組', 'error');
          return;
        }
        await loadDictionaries(version);
        captured = { statGroups: criteria.statGroups, fields: [], sectionDisabled: {} };
        saveDialog.parts.value = labelCriteriaOverlayParts(captured, version);
        saveDialog.open.value = true;
      }),

    saveTemplate: (payload) =>
      run(async () => {
        if (!captured) return;
        const picked = pickCriteriaOverlayParts(captured, new Set(payload.keys));
        await requireStore().create(payload.name, picked.statGroups);
        saveDialog.open.value = false;
        captured = null;
        notify(`已儲存常用詞綴群組「${payload.name}」`, 'success');
      }),

    renameTemplate: (template) =>
      run(async () => {
        const next = await prompt('請輸入新的名稱：', template.name, '重新命名常用詞綴群組');
        if (next == null || next.trim() === '' || next.trim() === template.name) return;
        await requireStore().rename(template.id, next);
      }),

    removeTemplate: (template) =>
      run(async () => {
        const confirmed = await confirm(
          `確定要刪除常用詞綴群組「${template.name}」嗎？`,
          '刪除常用詞綴群組',
        );
        if (!confirmed) return;
        await requireStore().remove(template.id);
      }),

    reorderTemplates: (orderedIds) => run(() => requireStore().reorder(orderedIds)),

    exportTemplates: () => serializeStatGroupTemplates(version, templates.value),

    importTemplates: () =>
      run(async () => {
        const text = await prompt('請貼上從常用詞綴群組匯出的內容：', '', '匯入常用詞綴群組');
        if (text == null || text.trim() === '') return;
        const { entries, skipped } = parseStatGroupTemplateTransfer(text.trim(), version);
        await requireStore().createMany(entries);
        const suffix = skipped > 0 ? `（略過 ${skipped} 筆無效項目）` : '';
        notify(`已匯入 ${entries.length} 筆常用詞綴群組${suffix}`, 'success');
      }),

    clearTemplates: () =>
      run(async () => {
        if (templates.value.length === 0) return;
        const confirmed = await confirm(
          `確定要刪除全部 ${templates.value.length} 筆常用詞綴群組嗎？此動作無法復原。`,
          '清空常用詞綴群組',
        );
        if (!confirmed) return;
        await requireStore().clear();
        notify('已清空常用詞綴群組', 'success');
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
