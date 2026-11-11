/**
 * Criteria Overlay（疊加套用）純領域模組。見 CONTEXT.md、ADR-0009 與 ADR-0010。
 *
 * - 擷取：把官方 Vuex `state.persistent` 的快照正規化為 OverlayCriteria。
 * - 選取：列出可勾選的片段，並依勾選結果取出子集合。
 * - 套用：依目前頁面快照規劃官方 mutation 序列與對應的復原序列（疊加語意）。
 *
 * 本模組不碰 DOM、Vuex 或 chrome.*，所有輸入輸出皆為可序列化的純資料。
 */

export interface CriteriaOverlayStatFilter {
  id: string;
  value?: Record<string, unknown>;
  disabled?: boolean;
}

export interface CriteriaOverlayStatGroup {
  type: string;
  value?: Record<string, unknown>;
  disabled?: boolean;
  filters: CriteriaOverlayStatFilter[];
}

export interface CriteriaOverlayField {
  section: string;
  field: string;
  value: Record<string, unknown>;
}

export interface CriteriaOverlayItem {
  name: string | null;
  type: string | null;
  disc: string | null;
  term: string | null;
}

export interface OverlayCriteria {
  item?: CriteriaOverlayItem;
  status?: string;
  statGroups: CriteriaOverlayStatGroup[];
  fields: CriteriaOverlayField[];
  /** 條件中有欄位的 section 在擷取當下是否為停用狀態。 */
  sectionDisabled: Record<string, boolean>;
}

/** 官方搜尋表單快照（`state.persistent` 中與條件相關的欄位）。 */
export interface CriteriaOverlayFormSnapshot {
  name?: unknown;
  type?: unknown;
  disc?: unknown;
  term?: unknown;
  status?: unknown;
  filters?: unknown;
  stats?: unknown;
}

export type CriteriaOverlayOp =
  | { kind: 'setItem'; item: CriteriaOverlayItem }
  | { kind: 'setStatus'; status: string }
  | {
      kind: 'setPropertyFilter';
      group: string;
      index: string;
      value: Record<string, unknown> | null;
    }
  | { kind: 'setPropertyFilterGroupDisabled'; group: string; disable: boolean }
  | { kind: 'pushStatGroup'; type: string; filters: CriteriaOverlayStatFilter[] }
  | { kind: 'setStatGroupValue'; group: number; value: Record<string, unknown> | null }
  | { kind: 'setStatGroupDisabled'; group: number; disable: boolean }
  | { kind: 'removeStatGroup'; group: number };

export type CriteriaOverlayOpKind = CriteriaOverlayOp['kind'];

export const CRITERIA_OVERLAY_OP_KINDS: readonly CriteriaOverlayOpKind[] = [
  'setItem',
  'setStatus',
  'setPropertyFilter',
  'setPropertyFilterGroupDisabled',
  'pushStatGroup',
  'setStatGroupValue',
  'setStatGroupDisabled',
  'removeStatGroup',
];

export interface CriteriaOverlayApplyReport {
  addedStatGroups: number;
  skippedDuplicateStatGroups: number;
  skippedUnknownStatFilters: number;
  changedFields: number;
  changedItem: boolean;
  changedStatus: boolean;
}

export interface CriteriaOverlayApplyPlan {
  ops: CriteriaOverlayOp[];
  undoOps: CriteriaOverlayOp[];
  report: CriteriaOverlayApplyReport;
}

export type CriteriaOverlayPartKind = 'item' | 'status' | 'stat-group' | 'field';

export interface CriteriaOverlayPart {
  key: string;
  kind: CriteriaOverlayPartKind;
}

// -------------------------------------------------------------
// Normalization helpers
// -------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

/** 深拷貝並移除空值；結果為空物件時回傳 undefined。 */
function cleanValue(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value)
    .filter(([, v]) => !isBlank(v))
    .map(([k, v]) => [k, isRecord(v) || Array.isArray(v) ? JSON.parse(JSON.stringify(v)) : v]);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function toNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function readStatus(value: unknown): string | undefined {
  if (typeof value === 'string' && value !== '') return value;
  if (isRecord(value) && typeof value.option === 'string' && value.option !== '') {
    return value.option;
  }
  return undefined;
}

function readItem(snapshot: CriteriaOverlayFormSnapshot): CriteriaOverlayItem {
  return {
    name: toNullableString(snapshot.name),
    type: toNullableString(snapshot.type),
    disc: toNullableString(snapshot.disc),
    term: toNullableString(snapshot.term),
  };
}

function hasItem(item: CriteriaOverlayItem): boolean {
  return item.name !== null || item.type !== null || item.disc !== null || item.term !== null;
}

function normalizeStatFilter(raw: unknown): CriteriaOverlayStatFilter | undefined {
  if (!isRecord(raw) || typeof raw.id !== 'string' || raw.id === '') return undefined;
  const value = cleanValue(raw.value);
  return {
    id: raw.id,
    ...(value ? { value } : {}),
    ...(raw.disabled === true ? { disabled: true } : {}),
  };
}

function normalizeStatGroup(raw: unknown): CriteriaOverlayStatGroup | undefined {
  if (!isRecord(raw) || typeof raw.type !== 'string' || raw.type === '') return undefined;
  const filters = (Array.isArray(raw.filters) ? raw.filters : [])
    .map(normalizeStatFilter)
    .filter((f): f is CriteriaOverlayStatFilter => f !== undefined);
  if (filters.length === 0) return undefined;
  const value = cleanValue(raw.value);
  return {
    type: raw.type,
    filters,
    ...(value ? { value } : {}),
    ...(raw.disabled === true ? { disabled: true } : {}),
  };
}

function readSections(
  filters: unknown,
): Array<{ section: string; disabled: boolean; fields: CriteriaOverlayField[] }> {
  if (!isRecord(filters)) return [];
  return Object.entries(filters).flatMap(([section, raw]) => {
    if (!isRecord(raw) || !isRecord(raw.filters)) return [];
    const fields = Object.entries(raw.filters).flatMap(([field, value]) => {
      const cleaned = cleanValue(value);
      return cleaned ? [{ section, field, value: cleaned }] : [];
    });
    return fields.length > 0 ? [{ section, disabled: raw.disabled === true, fields }] : [];
  });
}

// -------------------------------------------------------------
// Capture & selection
// -------------------------------------------------------------

/** 讀取快照中的物品識別（名稱、基底、discriminator、搜尋字串）。 */
export function readSnapshotItem(snapshot: CriteriaOverlayFormSnapshot): CriteriaOverlayItem {
  return readItem(snapshot);
}

/**
 * 依官方表單上的位置讀取第 index 個詞綴群組（不略過空群組，位置與頁面一致）。
 * 該位置沒有群組時回傳 undefined；群組沒有詞綴時 filters 為空陣列。
 */
export function readSnapshotStatGroup(
  snapshot: CriteriaOverlayFormSnapshot,
  index: number,
): CriteriaOverlayStatGroup | undefined {
  const raw = Array.isArray(snapshot.stats) ? snapshot.stats[index] : undefined;
  if (!isRecord(raw) || typeof raw.type !== 'string' || raw.type === '') return undefined;
  return normalizeStatGroup(raw) ?? { type: raw.type, filters: [] };
}

/** 將官方表單快照正規化為可儲存的完整條件（尚未經使用者勾選）。 */
export function captureOverlayCriteria(snapshot: CriteriaOverlayFormSnapshot): OverlayCriteria {
  const item = readItem(snapshot);
  const status = readStatus(snapshot.status);
  const statGroups = (Array.isArray(snapshot.stats) ? snapshot.stats : [])
    .map(normalizeStatGroup)
    .filter((g): g is CriteriaOverlayStatGroup => g !== undefined);
  const sections = readSections(snapshot.filters);
  return {
    ...(hasItem(item) ? { item } : {}),
    ...(status ? { status } : {}),
    statGroups,
    fields: sections.flatMap((s) => s.fields),
    sectionDisabled: Object.fromEntries(sections.map((s) => [s.section, s.disabled])),
  };
}

export function fieldPartKey(field: Pick<CriteriaOverlayField, 'section' | 'field'>): string {
  return `field:${field.section}.${field.field}`;
}

export function statGroupPartKey(index: number): string {
  return `stat:${index}`;
}

/** 列出條件中可勾選的片段（儲存對話框用）。 */
export function listCriteriaOverlayParts(criteria: OverlayCriteria): CriteriaOverlayPart[] {
  return [
    ...(criteria.item ? [{ key: 'item', kind: 'item' as const }] : []),
    ...(criteria.status ? [{ key: 'status', kind: 'status' as const }] : []),
    ...criteria.statGroups.map((_, i) => ({
      key: statGroupPartKey(i),
      kind: 'stat-group' as const,
    })),
    ...criteria.fields.map((f) => ({ key: fieldPartKey(f), kind: 'field' as const })),
  ];
}

/** 依勾選的片段 key 取出條件子集合。 */
export function pickCriteriaOverlayParts(
  criteria: OverlayCriteria,
  keys: ReadonlySet<string>,
): OverlayCriteria {
  const fields = criteria.fields.filter((f) => keys.has(fieldPartKey(f)));
  const sections = new Set(fields.map((f) => f.section));
  return {
    ...(criteria.item && keys.has('item') ? { item: { ...criteria.item } } : {}),
    ...(criteria.status && keys.has('status') ? { status: criteria.status } : {}),
    statGroups: criteria.statGroups.filter((_, i) => keys.has(statGroupPartKey(i))),
    fields,
    sectionDisabled: Object.fromEntries(
      Object.entries(criteria.sectionDisabled).filter(([section]) => sections.has(section)),
    ),
  };
}

/** Search Preview 中可疊加的區塊（見 CONTEXT.md「Criteria Overlay」）。 */
export type OverlayTarget =
  | { kind: 'all' }
  | { kind: 'stats' }
  | { kind: 'stat-group'; index: number }
  | { kind: 'section'; section: string }
  | { kind: 'item' }
  | { kind: 'status' };

function overlayTargetKeys(criteria: OverlayCriteria, target: OverlayTarget) {
  const parts = listCriteriaOverlayParts(criteria);
  switch (target.kind) {
    case 'all':
      return parts.map((p) => p.key);
    case 'stats':
      return parts.filter((p) => p.kind === 'stat-group').map((p) => p.key);
    case 'stat-group':
      return [statGroupPartKey(target.index)];
    case 'section':
      return criteria.fields.filter((f) => f.section === target.section).map(fieldPartKey);
    case 'item':
      return ['item'];
    case 'status':
      return ['status'];
  }
}

/** 依疊加目標取出條件子集合；詞綴只會以整個群組取出，不會拆出單條詞綴。 */
export function sliceOverlayCriteria(
  criteria: OverlayCriteria,
  target: OverlayTarget,
): OverlayCriteria {
  return pickCriteriaOverlayParts(criteria, new Set(overlayTargetKeys(criteria, target)));
}

/** 官方 query 的 name/type 可能是字串或 `{ option, discriminator, disabled }`。 */
function readQueryOption(value: unknown): { option: string | null; disc: string | null } {
  if (typeof value === 'string') return { option: toNullableString(value), disc: null };
  if (!isRecord(value) || value.disabled === true) return { option: null, disc: null };
  return {
    option: toNullableString(value.option),
    disc: toNullableString(value.discriminator),
  };
}

/**
 * 把書籤或歷史搜尋 ID 解碼出的官方 query JSON（`{ query, sort }`）轉成條件。
 * query 的 `stats` / `filters` 結構與官方表單 `state.persistent` 相同。
 */
export function criteriaFromTradeQuery(payload: unknown): OverlayCriteria {
  const root = isRecord(payload) && isRecord(payload.query) ? payload.query : payload;
  const q = isRecord(root) ? root : {};
  const name = readQueryOption(q.name);
  const type = readQueryOption(q.type);
  return captureOverlayCriteria({
    name: name.option,
    type: type.option,
    disc: name.disc ?? type.disc ?? q.disc ?? null,
    term: q.term ?? null,
    status: q.status,
    filters: q.filters,
    stats: q.stats,
  });
}

export function isEmptyOverlayCriteria(criteria: OverlayCriteria): boolean {
  return (
    !criteria.item &&
    !criteria.status &&
    criteria.statGroups.length === 0 &&
    criteria.fields.length === 0
  );
}

// -------------------------------------------------------------
// Apply planning (overlay semantics)
// -------------------------------------------------------------

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** 官方表單快照的穩定指紋，用來判斷套用後頁面是否被改動過（決定能否安全復原）。 */
export function criteriaOverlayFormFingerprint(snapshot: CriteriaOverlayFormSnapshot): string {
  return canonicalJson({
    name: snapshot.name ?? null,
    type: snapshot.type ?? null,
    disc: snapshot.disc ?? null,
    term: snapshot.term ?? null,
    status: snapshot.status ?? null,
    filters: snapshot.filters ?? null,
    stats: snapshot.stats ?? null,
  });
}

function statGroupSignature(group: CriteriaOverlayStatGroup): string {
  const filters = group.filters.map(canonicalJson).sort();
  return canonicalJson({
    type: group.type,
    value: group.value ?? null,
    disabled: group.disabled === true,
    filters,
  });
}

function withKnownStats(
  group: CriteriaOverlayStatGroup,
  knownStatIds: ReadonlySet<string> | null,
): { group: CriteriaOverlayStatGroup; dropped: number } {
  if (!knownStatIds) return { group, dropped: 0 };
  const filters = group.filters.filter((f) => knownStatIds.has(f.id));
  return { group: { ...group, filters }, dropped: group.filters.length - filters.length };
}

function readCurrentField(snapshot: CriteriaOverlayFormSnapshot, section: string, field: string) {
  const sectionRaw = isRecord(snapshot.filters) ? snapshot.filters[section] : undefined;
  const fields =
    isRecord(sectionRaw) && isRecord(sectionRaw.filters) ? sectionRaw.filters : undefined;
  return cleanValue(fields?.[field]) ?? null;
}

function readCurrentSectionDisabled(
  snapshot: CriteriaOverlayFormSnapshot,
  section: string,
): boolean {
  const sectionRaw = isRecord(snapshot.filters) ? snapshot.filters[section] : undefined;
  return isRecord(sectionRaw) && sectionRaw.disabled === true;
}

function planStatGroups(
  criteria: OverlayCriteria,
  snapshot: CriteriaOverlayFormSnapshot,
  knownStatIds: ReadonlySet<string> | null,
) {
  const current = (Array.isArray(snapshot.stats) ? snapshot.stats : [])
    .map(normalizeStatGroup)
    .filter((g): g is CriteriaOverlayStatGroup => g !== undefined);
  const seen = new Set(current.map(statGroupSignature));
  const baseIndex = Array.isArray(snapshot.stats) ? snapshot.stats.length : 0;

  const accepted: CriteriaOverlayStatGroup[] = [];
  let skippedDuplicates = 0;
  let skippedUnknown = 0;
  for (const original of criteria.statGroups) {
    const { group, dropped } = withKnownStats(original, knownStatIds);
    skippedUnknown += dropped;
    if (group.filters.length === 0) continue;
    const signature = statGroupSignature(group);
    if (seen.has(signature)) {
      skippedDuplicates += 1;
      continue;
    }
    seen.add(signature);
    accepted.push(group);
  }

  const ops: CriteriaOverlayOp[] = accepted.flatMap((group, i) => {
    const index = baseIndex + i;
    return [
      { kind: 'pushStatGroup' as const, type: group.type, filters: group.filters },
      ...(group.value
        ? [{ kind: 'setStatGroupValue' as const, group: index, value: group.value }]
        : []),
      ...(group.disabled
        ? [{ kind: 'setStatGroupDisabled' as const, group: index, disable: true }]
        : []),
    ];
  });
  const undoOps: CriteriaOverlayOp[] = accepted
    .map((_, i) => ({ kind: 'removeStatGroup' as const, group: baseIndex + i }))
    .reverse();

  return { ops, undoOps, added: accepted.length, skippedDuplicates, skippedUnknown };
}

function planFields(criteria: OverlayCriteria, snapshot: CriteriaOverlayFormSnapshot) {
  const fieldOps: CriteriaOverlayOp[] = criteria.fields.map((f) => ({
    kind: 'setPropertyFilter',
    group: f.section,
    index: f.field,
    value: f.value,
  }));
  const fieldUndo: CriteriaOverlayOp[] = criteria.fields.map((f) => ({
    kind: 'setPropertyFilter',
    group: f.section,
    index: f.field,
    value: readCurrentField(snapshot, f.section, f.field),
  }));
  const sectionEntries = Object.entries(criteria.sectionDisabled);
  const sectionOps: CriteriaOverlayOp[] = sectionEntries.map(([section, disable]) => ({
    kind: 'setPropertyFilterGroupDisabled',
    group: section,
    disable,
  }));
  const sectionUndo: CriteriaOverlayOp[] = sectionEntries.map(([section]) => ({
    kind: 'setPropertyFilterGroupDisabled',
    group: section,
    disable: readCurrentSectionDisabled(snapshot, section),
  }));
  return { ops: [...fieldOps, ...sectionOps], undoOps: [...fieldUndo, ...sectionUndo].reverse() };
}

/**
 * 規劃把條件疊加到目前搜尋表單的 mutation 序列與復原序列。
 *
 * - 物品識別與上架狀態：條件有定義才覆寫。
 * - 非詞綴欄位：只覆寫條件有定義的欄位，其餘保留。
 * - 詞綴群組：一律新增；與頁面上完全相同的群組略過；不在 knownStatIds 內的詞綴略過。
 *
 * @param knownStatIds 目前官方已知的 stat id；傳 null 表示無法取得，不做過濾。
 */
export function planCriteriaOverlayApplication(
  criteria: OverlayCriteria,
  snapshot: CriteriaOverlayFormSnapshot,
  knownStatIds: ReadonlySet<string> | null,
): CriteriaOverlayApplyPlan {
  const itemOps: CriteriaOverlayOp[] = criteria.item
    ? [{ kind: 'setItem', item: { ...criteria.item } }]
    : [];
  const itemUndo: CriteriaOverlayOp[] = criteria.item
    ? [{ kind: 'setItem', item: readItem(snapshot) }]
    : [];
  const statusOps: CriteriaOverlayOp[] = criteria.status
    ? [{ kind: 'setStatus', status: criteria.status }]
    : [];
  const currentStatus = readStatus(snapshot.status);
  const statusUndo: CriteriaOverlayOp[] =
    criteria.status && currentStatus ? [{ kind: 'setStatus', status: currentStatus }] : [];

  const fields = planFields(criteria, snapshot);
  const stats = planStatGroups(criteria, snapshot, knownStatIds);

  return {
    ops: [...itemOps, ...statusOps, ...fields.ops, ...stats.ops],
    // 復原依套用的相反順序執行
    undoOps: [...stats.undoOps, ...fields.undoOps, ...statusUndo, ...itemUndo],
    report: {
      addedStatGroups: stats.added,
      skippedDuplicateStatGroups: stats.skippedDuplicates,
      skippedUnknownStatFilters: stats.skippedUnknown,
      changedFields: criteria.fields.length,
      changedItem: itemOps.length > 0,
      changedStatus: statusOps.length > 0,
    },
  };
}

/**
 * 規劃以詞綴群組取代目前表單上第 index 個群組（可同時覆寫物品識別）。
 * groups 的第一個取代原群組，其餘依序附加（例如傭兵技能另需的 `and` 群組）。
 *
 * 官方只能在尾端新增群組，因此新群組會移到最後；復原時移除新群組並把原群組加回尾端。
 * index 超出範圍時視為新增。
 */
export function planStatGroupReplacement(
  snapshot: CriteriaOverlayFormSnapshot,
  index: number,
  groups: readonly CriteriaOverlayStatGroup[],
  item?: CriteriaOverlayItem,
): CriteriaOverlayApplyPlan {
  if (groups.length === 0) throw new Error('planStatGroupReplacement requires a group');
  const stats = Array.isArray(snapshot.stats) ? snapshot.stats : [];
  const raw = Number.isInteger(index) && index >= 0 ? stats[index] : undefined;
  const replacing = isRecord(raw) && typeof raw.type === 'string' && raw.type !== '';
  const baseIndex = stats.length - (replacing ? 1 : 0);

  const pushOps = (target: CriteriaOverlayStatGroup, at: number): CriteriaOverlayOp[] => [
    { kind: 'pushStatGroup', type: target.type, filters: target.filters },
    ...(target.value
      ? [{ kind: 'setStatGroupValue' as const, group: at, value: target.value }]
      : []),
    ...(target.disabled
      ? [{ kind: 'setStatGroupDisabled' as const, group: at, disable: true }]
      : []),
  ];

  const itemOps: CriteriaOverlayOp[] = item ? [{ kind: 'setItem', item: { ...item } }] : [];
  const itemUndo: CriteriaOverlayOp[] = item ? [{ kind: 'setItem', item: readItem(snapshot) }] : [];

  const original: CriteriaOverlayStatGroup | undefined = replacing
    ? (normalizeStatGroup(raw) ?? {
        type: raw.type as string,
        filters: [],
        ...(cleanValue(raw.value) ? { value: cleanValue(raw.value) } : {}),
        ...(raw.disabled === true ? { disabled: true } : {}),
      })
    : undefined;

  // 由後往前移除，前面的索引才不會位移
  const removeNew: CriteriaOverlayOp[] = groups
    .map((_, offset) => ({ kind: 'removeStatGroup' as const, group: baseIndex + offset }))
    .reverse();

  return {
    ops: [
      ...itemOps,
      ...(replacing ? [{ kind: 'removeStatGroup' as const, group: index }] : []),
      ...groups.flatMap((group, offset) => pushOps(group, baseIndex + offset)),
    ],
    undoOps: [...removeNew, ...(original ? pushOps(original, baseIndex) : []), ...itemUndo],
    report: {
      addedStatGroups: groups.length,
      skippedDuplicateStatGroups: 0,
      skippedUnknownStatFilters: 0,
      changedFields: 0,
      changedItem: itemOps.length > 0,
      changedStatus: false,
    },
  };
}

// -------------------------------------------------------------
// Wire validation (Main World 只執行通過白名單驗證的 ops)
// -------------------------------------------------------------

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function isGroupIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isNullableRecord(value: unknown): value is Record<string, unknown> | null {
  return value === null || isRecord(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isValidOp(op: unknown): op is CriteriaOverlayOp {
  if (!isRecord(op)) return false;
  switch (op.kind) {
    case 'setItem': {
      const item = op.item;
      return (
        isRecord(item) &&
        isNullableString(item.name) &&
        isNullableString(item.type) &&
        isNullableString(item.disc) &&
        isNullableString(item.term)
      );
    }
    case 'setStatus':
      return isNonEmptyString(op.status);
    case 'setPropertyFilter':
      return isNonEmptyString(op.group) && isNonEmptyString(op.index) && isNullableRecord(op.value);
    case 'setPropertyFilterGroupDisabled':
      return isNonEmptyString(op.group) && typeof op.disable === 'boolean';
    case 'pushStatGroup':
      return (
        isNonEmptyString(op.type) &&
        Array.isArray(op.filters) &&
        op.filters.every((f) => normalizeStatFilter(f) !== undefined)
      );
    case 'setStatGroupValue':
      return isGroupIndex(op.group) && isNullableRecord(op.value);
    case 'setStatGroupDisabled':
      return isGroupIndex(op.group) && typeof op.disable === 'boolean';
    case 'removeStatGroup':
      return isGroupIndex(op.group);
    default:
      return false;
  }
}

/** 驗證跨世界傳入的 ops；任何一筆不合法即整批拒絕。 */
export function parseCriteriaOverlayOps(value: unknown): CriteriaOverlayOp[] | undefined {
  if (!Array.isArray(value) || !value.every(isValidOp)) return undefined;
  return value as CriteriaOverlayOp[];
}

function parseStoredField(value: unknown): CriteriaOverlayField | undefined {
  if (!isRecord(value) || !isNonEmptyString(value.section) || !isNonEmptyString(value.field)) {
    return undefined;
  }
  const cleaned = cleanValue(value.value);
  return cleaned ? { section: value.section, field: value.field, value: cleaned } : undefined;
}

/** 驗證並正規化儲存中的詞綴群組陣列；任何一組不合法即回傳 undefined。 */
export function parseCriteriaOverlayStatGroups(
  value: unknown,
): CriteriaOverlayStatGroup[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const groups = value.map(normalizeStatGroup);
  return groups.includes(undefined) ? undefined : (groups as CriteriaOverlayStatGroup[]);
}

/** 驗證並正規化儲存中的條件；結構不合法時回傳 undefined。 */
export function parseOverlayCriteria(value: unknown): OverlayCriteria | undefined {
  if (!isRecord(value) || !Array.isArray(value.statGroups) || !Array.isArray(value.fields)) {
    return undefined;
  }
  const statGroups = value.statGroups.map(normalizeStatGroup);
  const fields = value.fields.map(parseStoredField);
  if (statGroups.includes(undefined) || fields.includes(undefined)) return undefined;
  const item = isRecord(value.item) ? readItem(value.item) : undefined;
  const status = readStatus(value.status);
  const sectionDisabled = isRecord(value.sectionDisabled)
    ? Object.fromEntries(
        Object.entries(value.sectionDisabled).filter(([, v]) => typeof v === 'boolean'),
      )
    : {};
  return {
    ...(item && hasItem(item) ? { item } : {}),
    ...(status ? { status } : {}),
    statGroups: statGroups as CriteriaOverlayStatGroup[],
    fields: fields as CriteriaOverlayField[],
    sectionDisabled: sectionDisabled as Record<string, boolean>,
  };
}
