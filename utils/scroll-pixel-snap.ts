/**
 * 計算讓座標／高度對齊實體像素格線所需的正向補償量（CSS px）。
 *
 * 在非 100% UI Scale（例如 110%＋緊湊模式）下，固定工具列或長捲動內容常落在
 * 非整數像素座標（例如 `104.359375px`、`2710.15625px`），易使 Chromium GPU
 * 分塊合成於滑到底時出現 1px 垂直割裂；補齊至下一個實體像素格線可消除此誤差。
 */
export function calcPixelSnapMargin(px: number, dpr = 1): number {
  if (!Number.isFinite(px) || px <= 0 || !Number.isFinite(dpr) || dpr <= 0) return 0;
  const scaled = px * dpr;
  const frac = scaled - Math.floor(scaled);
  if (frac <= 0.01 || frac >= 0.99) return 0;
  return (1 - frac) / dpr;
}
