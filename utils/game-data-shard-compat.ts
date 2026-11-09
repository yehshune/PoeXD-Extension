/**
 * 遊戲資料分片相容性檢查。
 *
 * `items.json` 各語系之間、`stats.json` 與 `mods-tiers.json` 之間都以索引對齊；
 * 任一份來自不同次建置都會讓翻譯悄悄錯位。poexd-data 在每個檔案寫入 `patch`，
 * 載入端以「長度相同且 patch 一致」判斷可否併用；缺少 `patch`（舊資料或測試資料）時只比長度。
 */
export interface ShardFingerprint {
  readonly patch?: string;
  readonly length: number;
}

export function isShardCompatible(
  reference: ShardFingerprint,
  candidate: ShardFingerprint,
): boolean {
  if (reference.length !== candidate.length) return false;
  if (reference.patch && candidate.patch && reference.patch !== candidate.patch) return false;
  return true;
}

export function describeShardMismatch(
  label: string,
  reference: ShardFingerprint,
  candidate: ShardFingerprint,
): string {
  return (
    `[PoeXD] 略過不相容的遊戲資料分片 ${label}：` +
    `預期 patch=${reference.patch ?? '?'} 長度=${reference.length}，` +
    `實際 patch=${candidate.patch ?? '?'} 長度=${candidate.length}`
  );
}
