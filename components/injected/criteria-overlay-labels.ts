import {
  fieldPartKey,
  statGroupPartKey,
  type OverlayCriteria,
  type OverlayTarget,
  type CriteriaOverlayStatGroup,
} from '@/utils/criteria-overlay';
import type { PoeVersion } from '@/utils/trade-context';
import type { StatGroupType } from '@/utils/trade-query-tuning';
import {
  formatFilterValue,
  translateItemName,
  translateStatLines,
} from '@/utils/trade-stat-dictionary';
import { translateFilterGroup, translateFilterKey } from '@/utils/trade-label-resolver';
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

const STAT_GROUP_TYPE_LABELS_BY_LOCALE: Record<SupportedUiLocale, Record<StatGroupType, string>> = {
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
    online: '面對面交易(在線)',
    onlineleague: '面對面交易(聯盟在線)',
    securable: '即刻購買',
    available: '即刻購買以及面對面交易',
    any: '任何',
  },
  'zh-CN': {
    online: '当面交易(在线)',
    onlineleague: '当面交易(联盟在线)',
    securable: '立即购买',
    available: '立即购买及当面交易',
    any: '任何',
  },
  en: {
    online: 'In Person (Online)',
    onlineleague: 'In Person (Online in League)',
    securable: 'Instant Buyout',
    available: 'Instant Buyout and In Person',
    any: 'Any',
  },
};

const STAT_GROUP_TYPE_SHORT_LABELS_BY_LOCALE: Record<
  SupportedUiLocale,
  Record<StatGroupType, string>
> = {
  'zh-TW': {
    and: '且',
    not: '非',
    if: '若',
    count: '計數',
    weight: '加權',
    weight2: '加權v2',
  },
  'zh-CN': {
    and: '且',
    not: '非',
    if: '若',
    count: '计数',
    weight: '加权',
    weight2: '加权v2',
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

export const STAT_GROUP_TYPE_LABELS: Record<string, string> = createActiveUiLocaleProxy<
  Record<string, string>
>(STAT_GROUP_TYPE_LABELS_BY_LOCALE);
export const STAT_GROUP_TYPE_SHORT_LABELS: Record<string, string> = createActiveUiLocaleProxy<
  Record<string, string>
>(STAT_GROUP_TYPE_SHORT_LABELS_BY_LOCALE);
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

/** 格式化單一詞綴群組的精簡標籤，例如「且(3)」、「計數≥2(4)」。 */
export function formatCompactStatGroupChip(group: CriteriaOverlayStatGroup): string {
  const shortType = STAT_GROUP_TYPE_SHORT_LABELS[group.type] ?? group.type.toUpperCase();
  const range = rangeText(group.value).replace(/\s+/g, '');
  const count = group.filters?.length ?? 0;
  return `${shortType}${range}(${count})`;
}

/** 產生常用詞綴群組的懸停完整預覽文字（群組標題 + 各條詞綴文字）。 */
export function describeStatGroupsTooltip(
  statGroups: readonly CriteriaOverlayStatGroup[],
  version: PoeVersion,
): string {
  return statGroups
    .map((group) => {
      const typeLabel = STAT_GROUP_TYPE_LABELS[group.type] ?? group.type;
      const range = rangeText(group.value);
      const header = `[${typeLabel}${range ? ` ${range}` : ''}]`;
      const detail = describeStatGroup(group, version);
      return detail ? `${header}\n${detail}` : header;
    })
    .join('\n\n');
}
