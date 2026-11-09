import type {
  LiveSearchBatchOutcome,
  LiveSearchSourceGroup,
  LiveSearchSourceItem,
} from '@/entrypoints/content/logic/live-search-bookmark-controller';
import type { LiveSearchEnqueueResponse } from '@/utils/live-search-contract';
import type { ResumableInspectItem } from './LiveSearchResumeInspectPopover.vue';
import { formatFolderPath } from '@/utils/bookmark-collection';
import { t } from '@/utils/i18n';

/**
 * Toast 提示資訊介面
 */
export interface BatchPresentationToast {
  message: string;
  tone: 'default' | 'error';
}

/**
 * 將 Resume 可恢復 IDs 投影為 Inspect 呈現物件清單
 * 純 presentation projection：不讀取 storage、不修改 controller、不決定哪些 IDs 可恢復
 */
export function projectResumableInspectItems(
  resumableSourceIds: readonly string[] | undefined,
  groups: readonly LiveSearchSourceGroup[] | undefined,
  previousConnections?: readonly LiveSearchSourceItem[] | undefined,
): ResumableInspectItem[] {
  if (!resumableSourceIds || resumableSourceIds.length === 0) {
    return [];
  }
  if (
    (!groups || groups.length === 0) &&
    (!previousConnections || previousConnections.length === 0)
  ) {
    return [];
  }

  const itemsMap = new Map<string, { item: LiveSearchSourceItem; group?: LiveSearchSourceGroup }>();
  if (groups) {
    for (const g of groups) {
      if (g.kind !== 'bookmark') continue;
      for (const item of g.items) {
        if (item.kind === 'bookmark') {
          itemsMap.set(item.id, { item, group: g });
        }
      }
    }
  }
  if (previousConnections) {
    for (const item of previousConnections) {
      if (!itemsMap.has(item.id)) {
        itemsMap.set(item.id, { item });
      }
    }
  }

  const result: ResumableInspectItem[] = [];
  const seenCanonicalKeys = new Set<string>();
  for (const id of resumableSourceIds) {
    const entry = itemsMap.get(id);
    if (!entry) continue;
    const { item, group } = entry;
    const dedupKey = item.canonicalKey || item.url || item.id;
    if (seenCanonicalKeys.has(dedupKey)) continue;
    seenCanonicalKeys.add(dedupKey);
    const groupPath =
      group && groups ? formatFolderPath(groups, group.id) || group.name : item.groupName;
    result.push({
      id: item.id,
      name: item.name,
      groupPath: groupPath || t('liveSearch.primary.previousGroupName'),
      status: item.status ?? 'idle',
    });
  }
  return result;
}

/**
 * 批次啟用結果摘要字串格式化
 */
export function formatBatchEnableSummary(outcome: LiveSearchBatchOutcome): string {
  const parts: string[] = [t('liveSearch.presentation.enabledCount', { count: outcome.succeeded })];
  if (outcome.skipped > 0) {
    parts.push(t('liveSearch.presentation.skippedCount', { count: outcome.skipped }));
  }
  if (outcome.failed > 0) {
    parts.push(t('liveSearch.presentation.failedCount', { count: outcome.failed }));
  }
  return parts.join(' · ');
}

/**
 * 解析批次啟用結果之 Toast 呈現資訊 (訊息與 tone)
 */
export function resolveBatchEnableToast(outcome: LiveSearchBatchOutcome): BatchPresentationToast {
  if (outcome.rejectReason) {
    const fatalMsg = outcome.error || t('liveSearch.presentation.mixedLeagueRejected');
    return { message: fatalMsg, tone: 'error' };
  }
  const summary = formatBatchEnableSummary(outcome);
  return {
    message: summary,
    tone: outcome.failed > 0 ? 'error' : 'default',
  };
}

/**
 * 批次停止結果摘要字串格式化
 */
export function formatBatchStopSummary(outcome: LiveSearchBatchOutcome): string {
  const parts: string[] = [t('liveSearch.presentation.stoppedCount', { count: outcome.succeeded })];
  if (outcome.skipped > 0) {
    parts.push(t('liveSearch.presentation.skippedCount', { count: outcome.skipped }));
  }
  return parts.join(' · ');
}

/**
 * 解析批次停止結果之 Toast 呈現資訊 (訊息與 tone)
 */
export function resolveBatchStopToast(outcome: LiveSearchBatchOutcome): BatchPresentationToast {
  if (outcome.rejectReason) {
    const fatalMsg = outcome.error || t('liveSearch.presentation.stopFailed');
    return { message: fatalMsg, tone: 'error' };
  }
  const summary = formatBatchStopSummary(outcome);
  return { message: summary, tone: 'default' };
}

/**
 * 解析單筆「送入線上搜尋主控台」結果之 Toast 呈現資訊
 */
export function resolveSingleEnqueueToast(
  res: LiveSearchEnqueueResponse,
  itemName: string,
): BatchPresentationToast {
  if (!res.success) {
    return { message: res.error || t('liveSearch.presentation.enqueueFailed'), tone: 'error' };
  }
  if (res.created) {
    return {
      message: t('liveSearch.presentation.enqueuedBackground', { name: itemName }),
      tone: 'default',
    };
  }
  if ((res.addedCount ?? 0) > 0) {
    return { message: t('liveSearch.presentation.enqueued', { name: itemName }), tone: 'default' };
  }
  if ((res.skippedCount ?? 0) > 0) {
    return {
      message: t('liveSearch.presentation.alreadyEnqueued', { name: itemName }),
      tone: 'default',
    };
  }
  return { message: t('liveSearch.presentation.enqueued', { name: itemName }), tone: 'default' };
}
