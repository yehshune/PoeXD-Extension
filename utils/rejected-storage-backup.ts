/**
 * 儲存狀態未通過驗證時的備份規劃。
 *
 * 書籤與搜尋紀錄在載入時採整份驗證；驗證失敗會以預設或遷移後的狀態覆寫原 key。
 * 覆寫前先把原始值另存到 `<key>__rejectedBackup__<timestamp>`，避免使用者資料無聲消失，
 * 之後可由備份手動救回。相同內容已備份過時不重複寫入。
 */

export const REJECTED_BACKUP_SEPARATOR = '__rejectedBackup__';

export interface RejectedStorageBackup {
  savedAt: number;
  value: unknown;
}

function serialize(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function isBackupRecord(value: unknown): value is RejectedStorageBackup {
  return typeof value === 'object' && value !== null && 'value' in value && 'savedAt' in value;
}

export function getRejectedBackupKeyPrefix(key: string): string {
  return `${key}${REJECTED_BACKUP_SEPARATOR}`;
}

/**
 * 依目前儲存內容規劃需寫入的備份項目；`keys` 中不存在的 key 會被略過。
 * 回傳空物件代表不需要寫入。
 */
export function planRejectedStorageBackups(
  values: Readonly<Record<string, unknown>>,
  keys: readonly string[],
  now: number,
): Record<string, RejectedStorageBackup> {
  const planned: Record<string, RejectedStorageBackup> = {};
  for (const key of keys) {
    const raw = values[key];
    if (raw === undefined) continue;
    const prefix = getRejectedBackupKeyPrefix(key);
    const serialized = serialize(raw);
    const alreadyBackedUp =
      serialized !== undefined &&
      Object.entries(values).some(
        ([existingKey, existing]) =>
          existingKey.startsWith(prefix) &&
          isBackupRecord(existing) &&
          serialize(existing.value) === serialized,
      );
    if (alreadyBackedUp) continue;
    planned[`${prefix}${now}`] = { savedAt: now, value: structuredClone(raw) };
  }
  return planned;
}
