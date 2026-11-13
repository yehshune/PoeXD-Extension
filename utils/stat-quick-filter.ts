/**
 * Result 詞綴快速篩選（`+AND` / `+NOT`）純邏輯模組。
 *
 * 與 Criteria Overlay（整組 stat group 疊加套用，見 CONTEXT.md）職責分離：
 * 此模組僅負責將單一詞綴 ID（不含數值）加入目前搜尋表單的指定群組類型，
 * 並產生經官方 mutation 白名單驗證的 op 序列。
 */
import {
  normalizeStatFilter,
  type CriteriaOverlayFormSnapshot,
  type CriteriaOverlayOp,
} from './criteria-overlay';

export type QuickStatFilterGroupKind = 'and' | 'not';

export interface QuickStatFilterPlan {
  status: 'added' | 'enabled' | 'already-exists' | 'unknown';
  ops: CriteriaOverlayOp[];
  groupIndex?: number;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 規劃將單一詞綴 ID（不含數值）加入目前搜尋表單的指定類型群組（`and` / `not`）。
 * 會尋找第一個未停用的目標群組；若不存在則新建群組；若群組內已有停用同 ID 則原地啟用。
 */
export function planAddStatToGroupKind(
  snapshot: CriteriaOverlayFormSnapshot,
  targetType: QuickStatFilterGroupKind,
  statId: string,
  knownStatIds?: ReadonlySet<string> | null,
): QuickStatFilterPlan {
  const normalizedId = statId.trim();
  if (!normalizedId || (knownStatIds && !knownStatIds.has(normalizedId))) {
    return { status: 'unknown', ops: [] };
  }

  const stats = Array.isArray(snapshot.stats) ? snapshot.stats : [];
  const groupIndex = stats.findIndex(
    (raw) => isPlainRecord(raw) && raw.type === targetType && raw.disabled !== true,
  );

  if (groupIndex === -1) {
    return {
      status: 'added',
      groupIndex: stats.length,
      ops: [
        {
          kind: 'pushStatGroup',
          type: targetType,
          filters: [{ id: normalizedId, disabled: false }],
        },
      ],
    };
  }

  const rawGroup = stats[groupIndex] as Record<string, unknown>;
  const filters = Array.isArray(rawGroup.filters) ? rawGroup.filters : [];
  const filterIndex = filters.findIndex((raw) => isPlainRecord(raw) && raw.id === normalizedId);

  if (filterIndex !== -1) {
    const existing = normalizeStatFilter(filters[filterIndex]);
    if (!existing || existing.disabled !== true) {
      return { status: 'already-exists', groupIndex, ops: [] };
    }
    return {
      status: 'enabled',
      groupIndex,
      ops: [
        {
          kind: 'setStatFilter',
          group: groupIndex,
          index: filterIndex,
          filter: {
            id: normalizedId,
            ...(existing.value ? { value: existing.value } : {}),
            disabled: false,
          },
        },
      ],
    };
  }

  return {
    status: 'added',
    groupIndex,
    ops: [
      {
        kind: 'setStatFilter',
        group: groupIndex,
        filter: { id: normalizedId, disabled: false },
      },
    ],
  };
}
