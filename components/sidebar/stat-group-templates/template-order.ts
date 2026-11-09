/**
 * 依拖曳結果把 id 從 from 位置移到 to 位置，回傳新陣列（不修改輸入）。
 * 索引超出範圍或位置不變時回傳原順序的複本。
 */
export function moveTemplateId(ids: readonly string[], from: number, to: number): string[] {
  const inRange = (i: number) => Number.isInteger(i) && i >= 0 && i < ids.length;
  if (!inRange(from) || !inRange(to) || from === to) return [...ids];
  const without = ids.filter((_, i) => i !== from);
  return [...without.slice(0, to), ids[from], ...without.slice(to)];
}
