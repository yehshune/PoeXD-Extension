import {
  parseCriteriaOverlayStatGroups,
  type CriteriaOverlayStatGroup,
} from '@/utils/criteria-overlay';
import { t } from '@/utils/i18n';
import type { PoeVersion } from '@/utils/trade-context';
import { translateStatLines } from '@/utils/trade-stat-dictionary';

const TRANSFER_VERSION = 1;

export const STAT_GROUP_TEMPLATE_NAME_MAX_LENGTH = 60;
export const STAT_GROUP_TEMPLATE_TRANSFER_FORMAT = 'poexd-stat-group-templates';

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

export interface StoredStatGroupTemplateList {
  templates: StatGroupTemplate[];
  /** 無法解析的原始項目（例如較新版本寫入的格式），寫回時原樣保留。 */
  unparsed: unknown[];
}

export interface StatGroupTemplateStoreDeps {
  version: PoeVersion;
  storage?: StatGroupTemplateStorage;
  now?: () => number;
  createId?: () => string;
}

export interface StatGroupTemplateStore {
  readonly version: PoeVersion;
  readonly storageKey: string;
  load(): Promise<StatGroupTemplate[]>;
  subscribe(onChange: (templates: StatGroupTemplate[]) => void): () => void;
  add(name: string, statGroups: readonly CriteriaOverlayStatGroup[]): Promise<StatGroupTemplate[]>;
  addMany(entries: readonly StatGroupTemplateEntry[]): Promise<StatGroupTemplate[]>;
  rename(id: string, newName: string): Promise<StatGroupTemplate[]>;
  updateStatGroups(
    id: string,
    statGroups: readonly CriteriaOverlayStatGroup[],
  ): Promise<StatGroupTemplate[]>;
  remove(id: string): Promise<StatGroupTemplate[]>;
  reorder(orderedIds: readonly string[]): Promise<StatGroupTemplate[]>;
  clear(): Promise<StatGroupTemplate[]>;
  exportJson(templates: readonly StatGroupTemplate[]): string;
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
  return templates.filter((item) => {
    if (item.name.toLowerCase().includes(needle)) return true;
    const groups = item.statGroups;
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

export function createChromeLocalStatGroupTemplateStorage(): StatGroupTemplateStorage {
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

export function parseStoredStatGroupTemplates(value: unknown): StoredStatGroupTemplateList {
  if (!Array.isArray(value)) return { templates: [], unparsed: [] };
  return value.reduce<StoredStatGroupTemplateList>(
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

export function createStatGroupTemplateStore(
  deps: StatGroupTemplateStoreDeps,
): StatGroupTemplateStore {
  const { version } = deps;
  const storage = deps.storage ?? createChromeLocalStatGroupTemplateStorage();
  const now = deps.now ?? Date.now;
  const createId = deps.createId ?? defaultCreateId;
  const storageKey = statGroupTemplateStorageKey(version);

  const readStored = async (): Promise<StoredStatGroupTemplateList> =>
    parseStoredStatGroupTemplates((await storage.get([storageKey]))[storageKey]);

  const updateStored = async (
    mutate: (current: StatGroupTemplate[]) => StatGroupTemplate[],
  ): Promise<StatGroupTemplate[]> => {
    const { templates: current, unparsed } = await readStored();
    const next = mutate(current);
    await storage.set({ [storageKey]: [...next, ...unparsed] });
    return next;
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

  return {
    version,
    storageKey,

    async load() {
      return (await readStored()).templates;
    },

    subscribe(onChange) {
      return storage.subscribe((changes) => {
        if (storageKey in changes) {
          onChange(parseStoredStatGroupTemplates(changes[storageKey]).templates);
        }
      });
    },

    async add(name, statGroups) {
      const template = buildTemplate(name, statGroups);
      return updateStored((current) => [...current, template]);
    },

    async addMany(entries) {
      const created = entries.map((entry) => buildTemplate(entry.name, entry.statGroups));
      return updateStored((current) => [...current, ...created]);
    },

    async rename(id, newName) {
      const normalized = normalizeStatGroupTemplateName(newName);
      return updateStored((current) => {
        if (!current.some((item) => item.id === id)) {
          throw new Error(t('statGroupTemplate.error.notFound'));
        }
        return current.map((item) =>
          item.id === id ? { ...item, name: normalized, updatedAt: now() } : item,
        );
      });
    },

    async updateStatGroups(id, statGroups) {
      const parsed = parseCriteriaOverlayStatGroups(JSON.parse(JSON.stringify(statGroups)));
      if (!parsed || parsed.length === 0) {
        throw new Error(t('statGroupTemplate.error.emptyGroups'));
      }
      return updateStored((current) => {
        if (!current.some((item) => item.id === id)) {
          throw new Error(t('statGroupTemplate.error.notFound'));
        }
        return current.map((item) =>
          item.id === id ? { ...item, statGroups: parsed, updatedAt: now() } : item,
        );
      });
    },

    remove(id) {
      return updateStored((current) => current.filter((item) => item.id !== id));
    },

    reorder(orderedIds) {
      return updateStored((current) => {
        const byId = new Map(current.map((item) => [item.id, item]));
        const ordered = orderedIds
          .map((id) => byId.get(id))
          .filter((item): item is StatGroupTemplate => item !== undefined);
        const listed = new Set(ordered.map((item) => item.id));
        return [...ordered, ...current.filter((item) => !listed.has(item.id))];
      });
    },

    clear() {
      return updateStored(() => []);
    },

    exportJson(templates) {
      return serializeStatGroupTemplates(version, templates);
    },
  };
}
