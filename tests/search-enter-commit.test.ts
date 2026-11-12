// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { installSearchEnterCommit } from '@/entrypoints/content/logic/search-enter-commit';

// 結構取自 2026-11-12 國際服搜尋區塊：數值輸入框只在 change 寫入狀態，搜尋由 document 上的 keydown 觸發
function setup() {
  document.body.innerHTML = `
    <div class="search-advanced">
      <input id="min" type="number" class="form-control minmax">
      <input id="other" type="text" class="multiselect__input">
    </div>
    <input id="outside" type="number" class="form-control minmax">`;
  const events: string[] = [];
  const state: { min: string | null } = { min: null };
  for (const id of ['min', 'other', 'outside']) {
    document.getElementById(id)!.addEventListener('change', (event) => {
      state.min = (event.target as HTMLInputElement).value;
      events.push(`change:${id}`);
    });
  }
  // 官網：document 冒泡階段的 keydown 讀取當下狀態送出搜尋
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') events.push(`search:${state.min}`);
  });
  return { events };
}

const pressEnter = (id: string, init: KeyboardEventInit = {}) =>
  document
    .getElementById(id)!
    .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, ...init }));

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

describe('installSearchEnterCommit', () => {
  it('Enter 時先派送 change，官網搜尋讀得到剛輸入的值', () => {
    const { events } = setup();
    cleanup = installSearchEnterCommit(window);
    (document.getElementById('min') as HTMLInputElement).value = '1';
    pressEnter('min');
    expect(events).toEqual(['change:min', 'search:1']);
  });

  it('沒有修補時重現官網問題（第一次搜尋用舊值）', () => {
    const { events } = setup();
    (document.getElementById('min') as HTMLInputElement).value = '1';
    pressEnter('min');
    expect(events).toEqual(['search:null']);
  });

  it('其他按鍵、輸入法組字中、非篩選輸入框與搜尋區塊外的輸入框不處理', () => {
    const { events } = setup();
    cleanup = installSearchEnterCommit(window);
    document
      .getElementById('min')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    pressEnter('min', { isComposing: true });
    pressEnter('other');
    pressEnter('outside');
    expect(events.filter((event) => event.startsWith('change'))).toEqual([]);
  });

  it('停止後不再處理', () => {
    const { events } = setup();
    installSearchEnterCommit(window)();
    pressEnter('min');
    expect(events).toEqual(['search:null']);
  });
});
