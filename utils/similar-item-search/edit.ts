/**
 * 面板對 Similar Search Draft 的調整；一律回傳新的草稿，不改動傳入的物件。
 */
import { thresholdFor } from './threshold';
import {
  SIMILAR_TOLERANCE_BOUNDS,
  WEAPON_MODES,
  type DraftProperty,
  type DraftStat,
  type PropertyId,
  type SimilarSearchDraft,
  type SimilarSearchScope,
  type StatDomainChoice,
  type StatRole,
  type WeaponMode,
} from './types';

const statNumberOf = (key: string): string => key.slice(key.indexOf('.') + 1);

function updateStat(
  draft: SimilarSearchDraft,
  key: string,
  update: (stat: DraftStat) => DraftStat,
): SimilarSearchDraft {
  if (!draft.stats.some((stat) => stat.key === key)) return draft;
  return { ...draft, stats: draft.stats.map((stat) => (stat.key === key ? update(stat) : stat)) };
}

const clampTolerance = (tolerance: number): number =>
  Math.round(
    Math.min(SIMILAR_TOLERANCE_BOUNDS.max, Math.max(SIMILAR_TOLERANCE_BOUNDS.min, tolerance)),
  );

/** 重算沒被使用者改過的門檻 */
export function setTolerance(draft: SimilarSearchDraft, tolerance: number): SimilarSearchDraft {
  if (!Number.isFinite(tolerance)) return draft;
  const next = clampTolerance(tolerance);
  return {
    ...draft,
    tolerance: next,
    stats: draft.stats.map((stat) =>
      stat.customized ? stat : { ...stat, threshold: thresholdFor(stat.value, next) },
    ),
    properties: draft.properties.map((property) =>
      property.customized
        ? property
        : { ...property, threshold: thresholdFor(property.value, next) },
    ),
  };
}

/** 使用者自訂門檻；undefined 表示不設門檻 */
export function setStatThreshold(
  draft: SimilarSearchDraft,
  key: string,
  threshold: number | undefined,
): SimilarSearchDraft {
  if (threshold !== undefined && !Number.isFinite(threshold)) return draft;
  return updateStat(draft, key, ({ threshold: _previous, ...stat }) => ({
    ...stat,
    ...(threshold !== undefined ? { threshold } : {}),
    customized: true,
  }));
}

export function setStatRole(
  draft: SimilarSearchDraft,
  key: string,
  role: StatRole,
): SimilarSearchDraft {
  return updateStat(draft, key, (stat) => ({ ...stat, role }));
}

/** 縮小到單一詞綴型態；只接受這行在物品上出現過的型態 */
export function setStatDomain(
  draft: SimilarSearchDraft,
  key: string,
  domain: StatDomainChoice,
): SimilarSearchDraft {
  const stat = draft.stats.find((candidate) => candidate.key === key);
  if (!stat?.domains?.includes(domain)) return draft;
  const id = domain === 'any' ? stat.key : `${domain}.${statNumberOf(stat.key)}`;
  return updateStat(draft, key, (current) => ({ ...current, domain, id }));
}

export function setScope(draft: SimilarSearchDraft, scope: SimilarSearchScope): SimilarSearchDraft {
  return { ...draft, scope };
}

function updateProperty(
  draft: SimilarSearchDraft,
  id: PropertyId,
  update: (property: DraftProperty) => DraftProperty,
): SimilarSearchDraft {
  if (!draft.properties.some((property) => property.id === id)) return draft;
  return {
    ...draft,
    properties: draft.properties.map((property) =>
      property.id === id ? update(property) : property,
    ),
  };
}

/** 換武器比較方式：只開啟該方式的屬性；這把武器沒有該數值時不變 */
export function setWeaponMode(draft: SimilarSearchDraft, mode: WeaponMode): SimilarSearchDraft {
  if (!draft.weaponMode || !draft.properties.some((property) => property.id === mode)) return draft;
  const modes: readonly PropertyId[] = WEAPON_MODES;
  return {
    ...draft,
    weaponMode: mode,
    properties: draft.properties.map((property) =>
      modes.includes(property.id) ? { ...property, enabled: property.id === mode } : property,
    ),
  };
}

export function setPropertyEnabled(
  draft: SimilarSearchDraft,
  id: PropertyId,
  enabled: boolean,
): SimilarSearchDraft {
  return updateProperty(draft, id, (property) => ({ ...property, enabled }));
}

export function setPropertyThreshold(
  draft: SimilarSearchDraft,
  id: PropertyId,
  threshold: number | undefined,
): SimilarSearchDraft {
  if (threshold !== undefined && !Number.isFinite(threshold)) return draft;
  return updateProperty(draft, id, ({ threshold: _previous, ...property }) => ({
    ...property,
    ...(threshold !== undefined ? { threshold } : {}),
    customized: true,
  }));
}
