import { describe, expect, it } from 'vitest';
import { socketLayout } from '@/components/sidebar/pob-build/pob-socket-layout';

describe('socketLayout：照遊戲的順序排插槽', () => {
  it('寬 2 的物品以蛇形排列，連結只連同一組相鄰的插槽', () => {
    const layout = socketLayout('R-R-G B-B-W', 2, 3);
    expect(layout.columns).toBe(2);
    expect(layout.rows).toBe(3);
    expect(layout.sockets.map(({ color, column, row }) => `${color}${column}${row}`)).toEqual([
      'R00',
      'R10',
      'G11',
      'B01',
      'B02',
      'W12',
    ]);
    expect(layout.links).toEqual([
      [0, 1],
      [1, 2],
      [3, 4],
      [4, 5],
    ]);
  });

  it('寬 1 的物品直排；超過格數的插槽不畫', () => {
    const layout = socketLayout('B-B-B', 1, 3);
    expect(layout.columns).toBe(1);
    expect(layout.sockets.map(({ column, row }) => `${column}${row}`)).toEqual(['00', '01', '02']);
    expect(socketLayout('R-R-R-R', 1, 3).sockets).toHaveLength(3);
  });

  it('只用到的列數；沒有插槽時回傳空的版面', () => {
    expect(socketLayout('R-G', 2, 4).rows).toBe(1);
    expect(socketLayout('', 2, 4)).toEqual({ columns: 0, rows: 0, sockets: [], links: [] });
  });

  it('深淵插槽與不明顏色', () => {
    expect(socketLayout('A Z', 2, 2).sockets.map((socket) => socket.color)).toEqual(['A', '?']);
  });
});
