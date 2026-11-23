/**
 * PoB 的插槽文字（`R-R-G B`）排成遊戲裡的位置：寬 1 的物品直排；寬 2 的物品蛇形排列
 * （第一列左→右、第二列右→左…），與遊戲物品上的插槽順序相同。`-` 表示和下一個插槽相連。
 */

/** 紅、綠、藍、白、深淵、共鳴器（D），以及 PoE2 的符文插槽（S）；其他字母一律視為不明 */
export type SocketColor = 'R' | 'G' | 'B' | 'W' | 'A' | 'D' | 'S' | '?';

export interface PlacedSocket {
  color: SocketColor;
  /** 從 0 起算 */
  column: number;
  row: number;
}

export interface SocketLayout {
  columns: number;
  rows: number;
  sockets: PlacedSocket[];
  /** 相連的兩個插槽索引 */
  links: [number, number][];
}

const KNOWN_COLORS = new Set<string>(['R', 'G', 'B', 'W', 'A', 'D', 'S']);
const EMPTY: SocketLayout = { columns: 0, rows: 0, sockets: [], links: [] };

function position(index: number, columns: number): { column: number; row: number } {
  if (columns === 1) return { column: 0, row: index };
  const row = Math.floor(index / 2);
  const offset = index % 2;
  return { column: row % 2 === 0 ? offset : 1 - offset, row };
}

export function socketLayout(sockets: string, width: number, height: number): SocketLayout {
  const columns = Math.min(Math.max(width, 1), 2);
  const capacity = columns * Math.max(height, 1);
  const placed: PlacedSocket[] = [];
  const links: [number, number][] = [];
  for (const group of sockets.trim().split(/\s+/).filter(Boolean)) {
    group.split('-').forEach((letter, index) => {
      if (!letter || placed.length >= capacity) return;
      if (index > 0 && placed.length > 0) links.push([placed.length - 1, placed.length]);
      const color = (KNOWN_COLORS.has(letter) ? letter : '?') as SocketColor;
      placed.push({ color, ...position(placed.length, columns) });
    });
  }
  if (placed.length === 0) return EMPTY;
  return {
    columns: Math.min(columns, placed.length),
    rows: Math.max(...placed.map((socket) => socket.row)) + 1,
    sockets: placed,
    links,
  };
}
