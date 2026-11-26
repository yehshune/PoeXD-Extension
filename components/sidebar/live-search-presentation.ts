import type { LiveSearchBatchOutcome } from '@/entrypoints/content/logic/live-search-sources';
import type { LiveSearchEnqueueResponse } from '@/utils/live-search-contract';
import { formatMessage, t } from '@/utils/i18n';

/**
 * Toast 提示資訊介面
 */
export interface BatchPresentationToast {
  message: string;
  tone: 'default' | 'error';
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
    return {
      message: formatMessage(res.error, 'common.sendToConsoleFailed'),
      tone: 'error',
    };
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
