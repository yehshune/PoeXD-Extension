import { readFileSync } from 'node:fs';
import { nextTick } from 'vue';

/** 書籤資料夾節點的模板契約橫跨資料夾節點與書籤列兩個 SFC，靜態契約測試以合併後的原始碼斷言。 */
export function readBookmarkNodeSource(): string {
  return [
    readFileSync('components/sidebar/BookmarkFolderNode.vue', 'utf8'),
    readFileSync('components/sidebar/BookmarkRow.vue', 'utf8'),
  ].join('\n');
}

/** 書籤列的操作列採延遲掛載，模擬使用者首次 hover 以掛載所有列的操作列。 */
export async function activateBookmarkRows(root: ParentNode): Promise<void> {
  root.querySelectorAll<HTMLElement>('.bookmark-row-item').forEach((row) => {
    row.dispatchEvent(new Event('pointerenter'));
  });
  await nextTick();
}
