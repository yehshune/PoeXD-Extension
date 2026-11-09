import {
  fieldPartKey,
  statGroupPartKey,
  type OverlayCriteria,
  type OverlayTarget,
  type CriteriaOverlayStatGroup,
} from '@/utils/criteria-overlay';
import type { PoeVersion } from '@/utils/trade-context';
import {
  formatFilterValue,
  translateFilterGroup,
  translateFilterKey,
  translateItemName,
  translateStatLines,
} from '@/utils/trade-stat-dictionary';
import { createActiveUiLocaleProxy, t, type SupportedUiLocale } from '@/utils/i18n';

export interface CriteriaOverlayPartLabel {
  key: string;
  /** 分組標題（例如「詞綴群組」或官方 section 名稱）。 */
  group: string;
  label: string;
  detail?: string;
  /** 這一塊在 Criteria Overlay 中所屬的疊加區塊。 */
  target: OverlayTarget;
}

const STAT_GROUP_TYPE_LABELS_BY_LOCALE: Record<SupportedUiLocale, Record<string, string>> = {
  'zh-TW': {
    and: '且 (AND)',
    not: '非 (NOT)',
    if: '若 (IF)',
    count: '計數 (COUNT)',
    weight: '加權總和 (WEIGHT)',
    weight2: '加權總和 v2',
  },
  'zh-CN': {
    and: '且 (AND)',
    not: '非 (NOT)',
    if: '若 (IF)',
    count: '计数 (COUNT)',
    weight: '加权总和 (WEIGHT)',
    weight2: '加权总和 v2',
  },
  en: {
    and: 'AND',
    not: 'NOT',
    if: 'IF',
    count: 'COUNT',
    weight: 'WEIGHT',
    weight2: 'WEIGHT v2',
  },
};

const STATUS_LABELS_BY_LOCALE: Record<SupportedUiLocale, Record<string, string>> = {
  'zh-TW': {
    online: '僅限線上',
    onlineleague: '僅限線上（聯盟）',
    securable: '即刻購買與線上',
    available: '即刻購買',
    any: '任何狀態',
  },
  'zh-CN': {
    online: '仅限在线',
    onlineleague: '仅限在线（联赛）',
    securable: '即刻购买与在线',
    available: '即刻购买',
    any: '任何状态',
  },
  en: {
    online: 'Online Only',
    onlineleague: 'Online (League)',
    securable: 'Instant Buy & Online',
    available: 'Instant Buy',
    any: 'Any Status',
  },
};

export const STAT_GROUP_TYPE_LABELS: Record<string, string> = createActiveUiLocaleProxy<
  Record<string, string>
>(STAT_GROUP_TYPE_LABELS_BY_LOCALE);
export const STATUS_LABELS: Record<string, string> =
  createActiveUiLocaleProxy<Record<string, string>>(STATUS_LABELS_BY_LOCALE);

export function rangeText(value: Record<string, unknown> | undefined): string {
  if (!value) return '';
  const { min, max } = value;
  const hasMin = typeof min === 'number' || typeof min === 'string';
  const hasMax = typeof max === 'number' || typeof max === 'string';
  if (hasMin && hasMax) return `${min} ~ ${max}`;
  if (hasMin) return `≥ ${min}`;
  if (hasMax) return `≤ ${max}`;
  return '';
}

function describeStatGroup(
  group: CriteriaOverlayStatGroup,
  version: PoeVersion,
): CriteriaOverlayPartLabel['detail'] {
  return group.filters
    .map((f) => {
      const text = translateStatLines(f.id, version).join(' / ');
      const range = rangeText(f.value);
      const suffix = f.disabled ? t('criteriaOverlay.statGroup.disabled') : '';
      return `${text}${range ? ` ${range}` : ''}${suffix}`;
    })
    .join('\n');
}

/** 把條件中的每個可勾選片段轉成給使用者看的標籤。 */
export function labelCriteriaOverlayParts(
  criteria: OverlayCriteria,
  version: PoeVersion,
): CriteriaOverlayPartLabel[] {
  const labels: CriteriaOverlayPartLabel[] = [];
  if (criteria.item) {
    const { name, type, term } = criteria.item;
    const text = [name, type, term]
      .filter((v): v is string => Boolean(v))
      .map((v) => translateItemName(v, version))
      .join(' / ');
    labels.push({
      key: 'item',
      group: t('criteriaOverlay.group.item'),
      label: t('criteriaOverlay.label.item'),
      detail: text,
      target: { kind: 'item' },
    });
  }
  if (criteria.status) {
    labels.push({
      key: 'status',
      group: t('criteriaOverlay.group.status'),
      label: t('criteriaOverlay.label.status'),
      detail: STATUS_LABELS[criteria.status] ?? criteria.status,
      target: { kind: 'status' },
    });
  }
  criteria.statGroups.forEach((group, index) => {
    const typeLabel = STAT_GROUP_TYPE_LABELS[group.type] ?? group.type;
    const range = rangeText(group.value);
    const rangePart = range ? ` ${range}` : '';
    const unit =
      group.filters.length === 1
        ? t('criteriaOverlay.statGroup.filterUnitSingle')
        : t('criteriaOverlay.statGroup.filterUnitPlural');
    const disabledText = group.disabled ? t('criteriaOverlay.statGroup.disabled') : '';

    labels.push({
      key: statGroupPartKey(index),
      group: t('criteriaOverlay.group.statGroup'),
      label: t('criteriaOverlay.statGroup.label', {
        typeLabel,
        range: rangePart,
        count: group.filters.length,
        unit,
        disabled: disabledText,
      }),
      detail: describeStatGroup(group, version),
      target: { kind: 'stat-group', index },
    });
  });
  criteria.fields.forEach((field) => {
    labels.push({
      key: fieldPartKey(field),
      group: translateFilterGroup(field.section, version),
      label: translateFilterKey(field.field, version),
      detail: formatFilterValue(field.value, field.field, version),
      target: { kind: 'section', section: field.section },
    });
  });
  return labels;
}

export interface CriteriaOverlayLabelGroup {
  group: string;
  /** 整個區塊的疊加目標（詞綴群組區為全部詞綴群組）。 */
  target: OverlayTarget;
  parts: CriteriaOverlayPartLabel[];
}

/** 依區塊分組（物品、詞綴群組、各官方篩選區段），保持原本順序。 */
export function groupCriteriaOverlayPartLabels(
  labels: readonly CriteriaOverlayPartLabel[],
): CriteriaOverlayLabelGroup[] {
  return labels.reduce<CriteriaOverlayLabelGroup[]>((groups, part) => {
    const last = groups.at(-1);
    if (last && last.group === part.group) {
      return [...groups.slice(0, -1), { ...last, parts: [...last.parts, part] }];
    }
    const target: OverlayTarget =
      part.target.kind === 'stat-group' ? { kind: 'stats' } : part.target;
    return [...groups, { group: part.group, target, parts: [part] }];
  }, []);
}

/** 一行摘要，例如「2 個詞綴群組 · 1 個篩選欄位 · 上架狀態」。 */
export function summarizeOverlayCriteria(criteria: OverlayCriteria): string {
  const statGroupUnit =
    criteria.statGroups.length === 1
      ? t('criteriaOverlay.statGroup.unitSingle')
      : t('criteriaOverlay.statGroup.unitPlural');
  const fieldUnit =
    criteria.fields.length === 1
      ? t('criteriaOverlay.fields.unitSingle')
      : t('criteriaOverlay.fields.unitPlural');

  const parts = [
    criteria.statGroups.length > 0 ? `${criteria.statGroups.length} ${statGroupUnit}` : '',
    criteria.fields.length > 0 ? `${criteria.fields.length} ${fieldUnit}` : '',
    criteria.item ? t('criteriaOverlay.label.item') : '',
    criteria.status ? t('criteriaOverlay.label.status') : '',
  ].filter(Boolean);
  return parts.join(' · ');
}
