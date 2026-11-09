import { parseCriteriaOverlayStatGroups, type CriteriaOverlayStatGroup } from './criteria-overlay';
import {
  normalizeStatGroupTemplateName,
  type StatGroupTemplate,
} from './stat-group-template-store';
import type { PoeVersion } from './trade-context';

export const STAT_GROUP_TEMPLATE_TRANSFER_FORMAT = 'poexd-stat-group-templates';
const TRANSFER_VERSION = 1;

/** 匯入時要新增的一筆常用詞綴群組（id 與時間由儲存庫重新產生）。 */
export interface StatGroupTemplateEntry {
  name: string;
  statGroups: CriteriaOverlayStatGroup[];
}

export interface StatGroupTemplateTransfer {
  entries: StatGroupTemplateEntry[];
  /** 無法解析而略過的項目數。 */
  skipped: number;
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

function parseEntry(value: unknown): StatGroupTemplateEntry | undefined {
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
    throw new Error('匯入內容格式不正確，請貼上從常用詞綴群組匯出的內容');
  }
  const raw = payload as Record<string, unknown> | null;
  if (
    !raw ||
    typeof raw !== 'object' ||
    raw.format !== STAT_GROUP_TEMPLATE_TRANSFER_FORMAT ||
    !Array.isArray(raw.templates)
  ) {
    throw new Error('匯入內容格式不正確，請貼上從常用詞綴群組匯出的內容');
  }
  if (raw.gameVersion !== gameVersion) {
    throw new Error(
      `這份內容屬於 ${String(raw.gameVersion).toUpperCase()}，無法匯入 ${gameVersion.toUpperCase()} 的常用詞綴群組`,
    );
  }
  const entries = raw.templates
    .map(parseEntry)
    .filter((entry): entry is StatGroupTemplateEntry => entry !== undefined);
  if (entries.length === 0) throw new Error('匯入內容沒有可用的常用詞綴群組');
  return { entries, skipped: raw.templates.length - entries.length };
}
