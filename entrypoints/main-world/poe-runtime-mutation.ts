import { parsePoeMoveStatFilter } from '@/utils/event-protocol-types';
import type { MainWorldBridge } from './bridge-bootstrap';
import { setFilterCategory, updateSingleFilterCategory } from './category-binding-manager';
import {
  isStatFilterGroup,
  saveAllCategoriesToSessionStorage,
  tagFilterDomElements,
} from './dom-tagger';
import type { HostFilterItem } from './host-types';
import { getVueStore } from './poe-runtime-reader';

export function initPoeRuntimeMutation(bridge: MainWorldBridge) {
  const unsubAdd = bridge.addListener('poexd-add-stat-filter', (item) => {
    const store = getVueStore();
    if (!store) {
      console.warn('[PoeXD] 找不到 Vuex store');
      return;
    }

    if (!item) return;

    const { statId, groupIndex, min, max, category } = item;
    const gIdx = groupIndex !== undefined ? groupIndex : 0;

    if (statId) {
      // 在 Vuex 的 _withCommit 內部執行狀態修改，確保同步且不觸發 strict 警告
      store._withCommit(() => {
        const stats = store.state?.persistent?.stats || store.state?.query?.stats;
        if (!stats || !stats[gIdx]) {
          console.warn('[PoeXD] 找不到對應的 stats 群組');
          return;
        }

        const filters = stats[gIdx].filters || [];
        const targetIndex = filters.length;

        const valueObj: HostFilterItem = {
          id: statId,
          disabled: false,
        };

        if (category) {
          setFilterCategory(valueObj, category);
        }

        if (min !== undefined || max !== undefined) {
          valueObj.value = {};
          if (min !== undefined && min !== '') valueObj.value.min = Number(min);
          if (max !== undefined && max !== '') valueObj.value.max = Number(max);
        }

        store.commit('setStatFilter', {
          group: gIdx,
          index: targetIndex,
          value: valueObj,
        });

        // 確保 commit 後存入 store 的真實物件亦擁有 non-enumerable metadata（防範 Vuex mutation clone payload）
        const storedFilter = stats[gIdx]?.filters?.[targetIndex];
        if (storedFilter && storedFilter !== valueObj) {
          if (valueObj.poexdBindingId && !storedFilter.poexdBindingId) {
            Object.defineProperty(storedFilter, 'poexdBindingId', {
              value: valueObj.poexdBindingId,
              writable: true,
              enumerable: false,
              configurable: true,
            });
          }
          if (valueObj.poexdCategory && !storedFilter.poexdCategory) {
            setFilterCategory(storedFilter, valueObj.poexdCategory);
          }
        }
      });
      saveAllCategoriesToSessionStorage();
      // 立即對新渲染的 DOM 元素進行標記
      setTimeout(tagFilterDomElements, 20);
    } else if (item.fallbackQuery) {
      // 處理配對失敗的落後處置
      const { fallbackQuery } = item;
      const allGroups = document.querySelectorAll('.search-advanced-pane.brown .filter-group');
      const groups = Array.from(allGroups).filter(isStatFilterGroup);
      const groupEl = groups[gIdx];
      if (groupEl) {
        const input =
          groupEl.querySelector<HTMLInputElement>('.filter-group-select input') ||
          groupEl.querySelector<HTMLInputElement>('.multiselect__input') ||
          groupEl.querySelector<HTMLInputElement>('.multiselect input') ||
          Array.from(groupEl.querySelectorAll<HTMLInputElement>('input')).find(
            (i) =>
              i.placeholder &&
              (i.placeholder.includes('+') ||
                i.placeholder.toLowerCase().includes('filter') ||
                i.placeholder.includes('屬性') ||
                i.placeholder.includes('過濾') ||
                i.placeholder.includes('數值')),
          );

        if (input) {
          input.focus({ preventScroll: true });
          input.dispatchEvent(new Event('focus', { bubbles: true }));

          setTimeout(() => {
            input.value = fallbackQuery;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            console.log('[PoeXD] 全等配對失敗，已將英文詞綴填入過濾輸入框並聚焦:', fallbackQuery);
          }, 50);
        } else {
          console.warn('[PoeXD] 找不到新增屬性過濾的輸入框');
        }
      } else {
        console.warn('[PoeXD] 找不到對應的 filter-group DOM 元素');
      }
    }
  });

  // 監聽手動更新詞綴物品分類的事件，在 Vuex 物件中儲存不可列舉的分類屬性
  const unsubUpdate = bridge.addListener('poexd-update-stat-category', (payload) => {
    const { groupIndex, filterIndex, bindingId, category } = payload;
    const store = getVueStore();
    if (!store) {
      console.warn('[PoeXD] 找不到 Vuex store');
      return;
    }
    const stats = store.state?.persistent?.stats || store.state?.query?.stats;
    if (stats) {
      store._withCommit(() => {
        updateSingleFilterCategory(stats, { bindingId, groupIndex, filterIndex }, category);
      });
      tagFilterDomElements();
    }
  });

  // 監聽詞綴拖放重新排序事件
  const unsubMove = bridge.addListener('poexd-move-stat-filter', (payloadStr) => {
    const store = getVueStore();
    if (!store) {
      console.warn('[PoeXD] 找不到 Vuex store，無法移動詞綴');
      return;
    }

    const stats = store.state?.persistent?.stats || store.state?.query?.stats;
    if (!stats) {
      console.warn('[PoeXD] 找不到 stats 陣列，無法移動詞綴');
      return;
    }

    const payload = parsePoeMoveStatFilter(payloadStr);
    if (!payload) {
      console.warn('[PoeXD Inject] 收到無效的移動屬性篩選 payload:', payloadStr);
      return;
    }

    try {
      const { fromGroup, fromFilter, toGroup, toFilter } = payload;

      if (stats[fromGroup] && stats[toGroup]) {
        const fromFilters = stats[fromGroup].filters;
        const toFilters = stats[toGroup].filters;

        if (fromFilters && toFilters && fromFilters[fromFilter]) {
          // 利用 Vuex _withCommit 繞過 strict 模式的 state 突變檢查，安全進行修改
          store._withCommit(() => {
            // 1. 取出並移除被拖曳的詞綴
            const [movedFilter] = fromFilters.splice(fromFilter, 1);

            // 2. 計算目標 index (在 JS 陣列先移出再插入的行為中，targetIndex 直接等於 toFilter 即可)
            const targetIndex = toFilter;

            // 3. 插入目標群組
            if (targetIndex >= toFilters.length) {
              toFilters.push(movedFilter);
            } else {
              toFilters.splice(targetIndex, 0, movedFilter);
            }
          });
          console.log('[PoeXD] 成功重排/跨群組移動詞綴:', fromGroup, '->', toGroup);

          // 立即重新標記 DOM 屬性以同步新位置
          saveAllCategoriesToSessionStorage();
          setTimeout(tagFilterDomElements, 20);
        }
      }
    } catch (err) {
      console.error('[PoeXD Inject] 移動屬性篩選失敗:', err);
    }
  });

  return () => {
    unsubAdd();
    unsubUpdate();
    unsubMove();
  };
}
