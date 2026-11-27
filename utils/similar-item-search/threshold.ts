/**
 * 容忍度 → 門檻：取數值的容忍度百分比、往零的方向捨去。
 * 小於 10 的小數保留一位（暴擊率 4.66 → 3.7），其餘取整數；負數（越低越好）保留負號當上限。
 */
const EPSILON = 1e-9;
const DECIMAL_LIMIT = 10;

export function thresholdFor(value: number, tolerance: number): number {
  const magnitude = Math.abs(value);
  const scaled = (magnitude * tolerance) / 100;
  const keepDecimal = !Number.isInteger(magnitude) && magnitude < DECIMAL_LIMIT;
  const rounded = keepDecimal
    ? Math.floor(scaled * 10 + EPSILON) / 10
    : Math.floor(scaled + EPSILON);
  return value < 0 ? -rounded : rounded;
}
