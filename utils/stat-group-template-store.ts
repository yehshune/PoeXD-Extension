import { parseCriteriaOverlayStatGroups, type CriteriaOverlayStatGroup } from './criteria-overlay';
import type { PoeVersion } from './trade-context';

/** 最小 key-value 儲存介面（與 PreferencesStorage 相容，測試可替換為記憶體實作）。 */
export interface StatGroupTemplateStorage {
  get(keys: readonly string[]): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
  subscribe(listener: (changes: Record<string, unknown>) => void | Promise<void>): () => void;
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

/** 一筆 Stat Group Template（常用詞綴群組）。見 CONTEXT.md、ADR-0010。 */
export interface StatGroupTemplate {
  id: string;
  name: string;
  statGroups: CriteriaOverlayStatGroup[];
  createdAt: number;
  updatedAt: number;
}

export const STAT_GROUP_TEMPLATE_NAME_MAX_LENGTH = 60;

export function statGroupTemplateStorageKey(version: PoeVersion): string {
  return `poexdStatGroupTemplatesV1_${version}`;
}

export interface StatGroupTemplateStore {
  list(): Promise<StatGroupTemplate[]>;
  create(name: string, statGroups: readonly CriteriaOverlayStatGroup[]): Promise<StatGroupTemplate>;
  /** 一次寫入多筆（匯入用），附加在既有項目之後。 */
  createMany(
    entries: readonly { name: string; statGroups: readonly CriteriaOverlayStatGroup[] }[],
  ): Promise<StatGroupTemplate[]>;
  /** 清空此版本的常用詞綴群組；無法解析的原始項目仍保留。 */
  clear(): Promise<void>;
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
  reorder(orderedIds: readonly string[]): Promise<void>;
  subscribe(listener: (templates: StatGroupTemplate[]) => void): () => void;
}

interface StatGroupTemplateStoreDeps {
  storage?: StatGroupTemplateStorage;
  now?: () => number;
  createId?: () => string;
}

export function normalizeStatGroupTemplateName(name: string): string {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed) throw new Error('常用詞綴群組名稱不可為空白');
  if (trimmed.length > STAT_GROUP_TEMPLATE_NAME_MAX_LENGTH) {
    throw new Error(`常用詞綴群組名稱最多 ${STAT_GROUP_TEMPLATE_NAME_MAX_LENGTH} 個字`);
  }
  return trimmed;
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
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `stat-group-template:${random}`;
}

/**
 * 依遊戲版本隔離、只存在本機的常用詞綴群組儲存庫。不分 realm 與聯盟，不檢查重複。
 */
export function createStatGroupTemplateStore(
  version: PoeVersion,
  deps: StatGroupTemplateStoreDeps = {},
): StatGroupTemplateStore {
  const storage = deps.storage ?? createChromeLocalStorage();
  const now = deps.now ?? Date.now;
  const createId = deps.createId ?? defaultCreateId;
  const key = statGroupTemplateStorageKey(version);

  const buildTemplate = (
    name: string,
    statGroups: readonly CriteriaOverlayStatGroup[],
  ): StatGroupTemplate => {
    if (statGroups.length === 0) throw new Error('沒有可儲存的詞綴群組');
    const timestamp = now();
    return {
      id: createId(),
      name: normalizeStatGroupTemplateName(name),
      statGroups: JSON.parse(JSON.stringify(statGroups)),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  };

  const readStored = async () => parseStoredList((await storage.get([key]))[key]);

  const update = async (mutate: (templates: StatGroupTemplate[]) => StatGroupTemplate[]) => {
    const { templates, unparsed } = await readStored();
    await storage.set({ [key]: [...mutate(templates), ...unparsed] });
  };

  return {
    list: async () => (await readStored()).templates,

    async create(name, statGroups) {
      const template = buildTemplate(name, statGroups);
      await update((templates) => [...templates, template]);
      return template;
    },

    async createMany(entries) {
      const created = entries.map((entry) => buildTemplate(entry.name, entry.statGroups));
      await update((templates) => [...templates, ...created]);
      return created;
    },

    async clear() {
      await update(() => []);
    },

    async rename(id, name) {
      const normalized = normalizeStatGroupTemplateName(name);
      await update((templates) => {
        if (!templates.some((t) => t.id === id)) throw new Error('找不到指定的常用詞綴群組');
        return templates.map((t) =>
          t.id === id ? { ...t, name: normalized, updatedAt: now() } : t,
        );
      });
    },

    async remove(id) {
      await update((templates) => templates.filter((t) => t.id !== id));
    },

    async reorder(orderedIds) {
      await update((templates) => {
        const byId = new Map(templates.map((t) => [t.id, t]));
        const ordered = orderedIds
          .map((id) => byId.get(id))
          .filter((t): t is StatGroupTemplate => t !== undefined);
        const listed = new Set(ordered.map((t) => t.id));
        return [...ordered, ...templates.filter((t) => !listed.has(t.id))];
      });
    },

    subscribe(listener) {
      return storage.subscribe((changes) => {
        if (key in changes) listener(parseStoredList(changes[key]).templates);
      });
    },
  };
}
