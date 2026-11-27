import type { TypeRowConfig } from '@/components/sidebar/typeMaps';

/**
 * 僅作為子類別容器的父類別（本身沒有獨立詞綴池）：
 * 類別選擇器隱藏父按鈕改為純標題、詞綴選擇器自動落至子類別並顯示子類快切列。
 */
export const CONTAINER_ONLY_PARENT_TYPES: ReadonlySet<string> = new Set([
  'cluster_jewel',
  'heist_equipment',
  'viscera',
]);

/**
 * 官方市集無細分、底下子類別各自擁有獨立詞綴池的父類別：
 * T 階下拉在此類父類別下會依互斥子類別拆組。
 */
export const SUBTYPE_SPLIT_PARENTS: ReadonlySet<string> = new Set([
  'cluster_jewel',
  'flask',
  'abyss_jewel',
  'heist_equipment',
  'viscera',
]);

export const SUBTYPE_MOD_GROUP_SEPARATOR = '@@';

export function formatSubtypeModGroupId(baseGroupId: string, subtypeSig: string): string {
  return `${baseGroupId}${SUBTYPE_MOD_GROUP_SEPARATOR}${subtypeSig || 'other'}`;
}

export function stripSubtypeModGroupSuffix(groupId: string): string {
  const idx = groupId.indexOf(SUBTYPE_MOD_GROUP_SEPARATOR);
  return idx === -1 ? groupId : groupId.slice(0, idx);
}

/** 取出分組 id 中 `@@` 後的子類鍵（`other` 與空白不算）；無後綴時回傳空陣列 */
export function getSubtypeModGroupKeys(groupId: string): string[] {
  const idx = groupId.indexOf(SUBTYPE_MOD_GROUP_SEPARATOR);
  if (idx === -1) return [];
  return groupId
    .slice(idx + SUBTYPE_MOD_GROUP_SEPARATOR.length)
    .split('|')
    .filter((key) => key && key !== 'other');
}

export function isContainerOnlyParentType(type: string): boolean {
  return CONTAINER_ONLY_PARENT_TYPES.has(type);
}

export function resolveAvailableContainerSubKeys(
  typeRowConfigs: readonly TypeRowConfig[],
  parentKey: string,
  availableTypes: readonly string[],
): string[] {
  if (!CONTAINER_ONLY_PARENT_TYPES.has(parentKey)) return [];
  const row = typeRowConfigs.find((r) => r.mainKey === parentKey);
  if (!row) return [];
  return Object.keys(row.subKeys).filter((sk) => availableTypes.includes(sk));
}

export interface ContainerSubtypeQuickSwitch {
  parentLabel: string;
  options: Array<{
    key: string;
    label: string;
    fullLabel: string;
  }>;
}

export function resolveActiveContainerSubtypes(options: {
  typeRowConfigs: readonly TypeRowConfig[];
  selectedType: string;
  availableTypes: readonly string[];
  typeNames: Record<string, string>;
  getTypeName: (type: string) => string;
}): ContainerSubtypeQuickSwitch | null {
  const { typeRowConfigs, selectedType, availableTypes, typeNames, getTypeName } = options;
  const row = typeRowConfigs.find(
    (r) =>
      CONTAINER_ONLY_PARENT_TYPES.has(r.mainKey) &&
      (r.mainKey === selectedType || Object.prototype.hasOwnProperty.call(r.subKeys, selectedType)),
  );
  if (!row) return null;

  const subOptions = Object.keys(row.subKeys)
    .filter((sk) => availableTypes.includes(sk))
    .map((sk) => ({
      key: sk,
      label: row.subKeys[sk],
      fullLabel: typeNames[sk] || getTypeName(sk),
    }));
  if (subOptions.length <= 1) return null;

  return {
    parentLabel: getTypeName(row.mainKey),
    options: subOptions,
  };
}

export function resolveSubTypeLabelsMap(
  typeRowConfigs: readonly TypeRowConfig[],
  typeNames: Record<string, string>,
  category: string | null | undefined,
): { parentLabel: string; subLabels: Record<string, string> } | null {
  if (!category || !SUBTYPE_SPLIT_PARENTS.has(category)) return null;
  const row = typeRowConfigs.find((r) => r.mainKey === category);
  if (!row || Object.keys(row.subKeys).length === 0) return null;
  const parentLabel = (typeNames[category] || category).replace(/\s*\([^)]*\)/g, '').trim();
  return { parentLabel, subLabels: row.subKeys };
}

export function matchKeywordSubcategory(
  rawText: string,
  entries: ReadonlyArray<readonly [string, readonly string[]]>,
): string | null {
  if (!rawText || typeof rawText !== 'string') return null;
  const normalized = rawText.trim().toLowerCase();
  if (!normalized) return null;

  for (const [categoryKey, keywords] of entries) {
    if (keywords.some((kw) => normalized.includes(kw.toLowerCase()))) {
      return categoryKey;
    }
  }
  return null;
}
