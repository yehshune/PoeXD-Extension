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
import { t } from '@/utils/i18n';
import { loadTradeDictionaries, translateStatLines } from '@/utils/trade-stat-dictionary';
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
  renameTemplate(template: StatGroupTemplate, newName?: string): Promise<void>;
  /** 把預覽中微調後的詞綴群組存回範本；成功回傳 true。 */
  updateTemplateStatGroups(
    template: StatGroupTemplate,
    statGroups: readonly CriteriaOverlayStatGroup[],
  ): Promise<boolean>;
  removeTemplate(template: StatGroupTemplate): Promise<void>;
  reorderTemplates(orderedIds: readonly string[]): Promise<void>;
  /** 目前清單的匯出內容（見 stat-group-template-transfer）。 */
  exportTemplates(): string;
  /** 請使用者貼上匯出內容後附加匯入。 */
  importTemplates(): Promise<void>;
  /** 直接附加匯入已解析的常用詞綴群組項目。 */
  importTemplateEntries(
    entries: readonly { name: string; statGroups: readonly CriteriaOverlayStatGroup[] }[],
    skipped?: number,
  ): Promise<boolean>;
  /** 確認後清空目前版本的所有常用詞綴群組。 */
  clearTemplates(): Promise<void>;
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

export const filterTemplatesByName = filterTemplates;

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
    if (!store) throw new Error(t('statGroupTemplate.error.storeNotReady'));
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
        notify(t('statGroupTemplate.error.noOverlayCriteria'), 'error');
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
        if (await session.undo()) notify(t('statGroupTemplate.toast.undone'), 'success');
      }),

    beginSaveTemplate: () =>
      run(async () => {
        const criteria = await session.capture();
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
      run(async () => {
        if (!captured) return;
        const picked = pickCriteriaOverlayParts(captured, new Set(payload.keys));
        await requireStore().create(payload.name, picked.statGroups);
        saveDialog.open.value = false;
        captured = null;
        notify(t('statGroupTemplate.toast.saved', { name: payload.name }), 'success');
      }),

    renameTemplate: (template, newName) =>
      run(async () => {
        const next =
          newName !== undefined
            ? newName
            : await prompt(
                t('statGroupTemplate.dialog.renamePrompt'),
                template.name,
                t('statGroupTemplate.dialog.renameTitle'),
              );
        if (next == null || next.trim() === '' || next.trim() === template.name) return;
        await requireStore().rename(template.id, next);
      }),

    updateTemplateStatGroups: async (template, statGroups) => {
      let saved = false;
      await run(async () => {
        await requireStore().updateStatGroups(template.id, statGroups);
        notify(t('statGroupTemplate.toast.updated', { name: template.name }), 'success');
        saved = true;
      });
      return saved;
    },

    removeTemplate: (template) =>
      run(async () => {
        const confirmed = await confirm(
          t('statGroupTemplate.dialog.deleteConfirm', { name: template.name }),
          t('statGroupTemplate.dialog.deleteTitle'),
        );
        if (!confirmed) return;
        await requireStore().remove(template.id);
      }),

    reorderTemplates: (orderedIds) => run(() => requireStore().reorder(orderedIds)),

    exportTemplates: () => serializeStatGroupTemplates(version, templates.value),

    importTemplateEntries: async (entries, skipped = 0) => {
      let imported = false;
      await run(async () => {
        if (entries.length === 0) return;
        await requireStore().createMany(entries);
        notify(
          skipped > 0
            ? t('statGroupTemplate.toast.importedWithSkipped', {
                count: entries.length,
                skipped,
              })
            : t('statGroupTemplate.toast.imported', { count: entries.length }),
          'success',
        );
        imported = true;
      });
      return imported;
    },

    importTemplates: () =>
      run(async () => {
        const text = await prompt(
          t('statGroupTemplate.dialog.importPrompt'),
          '',
          t('statGroupTemplate.dialog.importTitle'),
        );
        if (text == null || text.trim() === '') return;
        const { entries, skipped } = parseStatGroupTemplateTransfer(text.trim(), version);
        await requireStore().createMany(entries);
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
      run(async () => {
        if (templates.value.length === 0) return;
        const confirmed = await confirm(
          t('statGroupTemplate.dialog.clearConfirm', { count: templates.value.length }),
          t('statGroupTemplate.dialog.clearTitle'),
        );
        if (!confirmed) return;
        await requireStore().clear();
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
