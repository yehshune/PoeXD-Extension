import Sortable from 'sortablejs';
import { dispatchPoeEvent, serializePoeMoveStatFilter } from '@/utils/event-contracts';

export interface FilterDragDrop {
  sync(): void;
  cleanup(): void;
}

export function createFilterDragDrop(): FilterDragDrop {
  const activeSortablesMap = new Map<HTMLElement, Sortable>();

  const cleanup = () => {
    activeSortablesMap.forEach((sortable, bodyEl) => {
      try {
        sortable.destroy();
      } catch (error) {
        console.warn('[PoeXD] 銷毀 Sortable 實例時發生錯誤:', error);
      }
      if ((bodyEl as any).__poexd_sortable__) {
        delete (bodyEl as any).__poexd_sortable__;
      }
    });
    activeSortablesMap.clear();
  };

  const sync = () => {
    const groups = document.querySelectorAll('.search-advanced-pane.brown .filter-group');

    // 1. 收集當前頁面上所有活著的 filter-group-body
    const currentBodies = new Set<HTMLElement>();
    groups.forEach((group, gIdx) => {
      group.setAttribute('data-poexd-group-idx', String(gIdx));
      const bodyEl = group.querySelector('.filter-group-body') as HTMLElement;
      if (bodyEl) {
        currentBodies.add(bodyEl);
      }
    });

    // 2. 清理已經不在頁面上的舊 Sortable 實例，防止記憶體洩漏與事件監聽器殘留
    for (const [bodyEl, sortable] of activeSortablesMap.entries()) {
      if (!currentBodies.has(bodyEl)) {
        try {
          sortable.destroy();
        } catch (e) {
          console.warn('[PoeXD] 銷毀舊 Sortable 實例時發生錯誤:', e);
        }
        activeSortablesMap.delete(bodyEl);
        if ((bodyEl as any).__poexd_sortable__) {
          delete (bodyEl as any).__poexd_sortable__;
        }
      }
    }

    // 3. 對於活著的 bodyEl，如果還沒有註冊過，則建立 Sortable 實例並註冊至 Map 中
    groups.forEach((group, gIdx) => {
      const bodyEl = group.querySelector('.filter-group-body') as HTMLElement;
      if (!bodyEl) return;

      if (!activeSortablesMap.has(bodyEl)) {
        const sortable = new Sortable(bodyEl, {
          group: {
            name: 'poexd-filters',
            pull: true,
            put: true,
          },
          handle: '.input-group-btn', // 限制僅能透過左側勾選框拖曳
          draggable: '.filter:not(.filter-padded)', // 僅對真實詞綴行排序，避開新增輸入框
          animation: 150,
          ghostClass: 'poexd-sortable-ghost',
          dragClass: 'poexd-sortable-drag',
          onEnd: (evt) => {
            // 使用 setTimeout 延遲執行，避開 SortableJS 內部的事件清理 tick，防止其內部 removeEventListener 報錯
            setTimeout(() => {
              // 1. 還原 DOM 節點位置，防止 Vue.js 響應式更新時因 DOM 脫節而報錯
              const fromParent = evt.from;
              const activeEl = evt.item;

              if (evt.oldIndex !== undefined && fromParent) {
                // 重新放回原本起點群組的原位置
                if (evt.oldIndex < fromParent.children.length) {
                  fromParent.insertBefore(activeEl, fromParent.children[evt.oldIndex]);
                } else {
                  fromParent.appendChild(activeEl);
                }
              }

              if (evt.oldIndex === undefined || evt.newIndex === undefined) return;

              // 2. 動態讀取最新的 Group Index
              const fromGroup = Number(
                evt.from.closest('.filter-group')?.getAttribute('data-poexd-group-idx') ?? gIdx,
              );
              const toGroup = Number(
                evt.to.closest('.filter-group')?.getAttribute('data-poexd-group-idx') ?? gIdx,
              );

              const fromFilter = evt.oldIndex;
              const toFilter = evt.newIndex;

              // 3. 派發自訂排序事件給 Vuex 進行資料移動
              dispatchPoeEvent(
                'poexd-move-stat-filter',
                serializePoeMoveStatFilter({ fromGroup, fromFilter, toGroup, toFilter }),
              );
            }, 0);
          },
        });
        activeSortablesMap.set(bodyEl, sortable);
        (bodyEl as any).__poexd_sortable__ = sortable;
      }

      // 4. 為了保證每次重置時 DOM data-attribute 順序精準
      const filterElements = group.querySelectorAll(
        '.filter-group-body .filter:not(.filter-padded)',
      );
      filterElements.forEach((filterEl, fIdx) => {
        (filterEl as HTMLElement).setAttribute('data-poexd-filter-idx', String(fIdx));
      });
    });
  };

  return { sync, cleanup };
}
