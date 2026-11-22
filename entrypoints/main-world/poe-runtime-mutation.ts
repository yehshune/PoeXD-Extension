import { parsePoeMoveStatFilter } from '@/utils/event-protocol-types';
import type { MainWorldBridge } from './bridge-bootstrap';
import { isStatFilterGroup } from './dom-tagger';
import { mainWorldSearchForm as form } from './main-world-search-form';

export function initPoeRuntimeMutation(bridge: MainWorldBridge) {
  const unsubAdd = bridge.addListener('poexd-add-stat-filter', (item) => {
    if (!item) return;

    const { statId, groupIndex, min, max, category, modGroup } = item;
    const gIdx = groupIndex !== undefined ? groupIndex : 0;

    if (statId) {
      form.addStatFilter({ statId, groupIndex: gIdx, min, max, category, modGroup });
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

  // 監聽手動更新詞綴物品分類與詞綴分組的事件，在 Vuex 物件中儲存不可列舉的 metadata
  const unsubUpdate = bridge.addListener('poexd-update-stat-category', (payload) => {
    form.setFilterBinding(payload);
  });

  // 監聽詞綴拖放重新排序事件
  const unsubMove = bridge.addListener('poexd-move-stat-filter', (payloadStr) => {
    const payload = parsePoeMoveStatFilter(payloadStr);
    if (!payload) {
      console.warn('[PoeXD Inject] 收到無效的移動屬性篩選 payload:', payloadStr);
      return;
    }
    try {
      if (form.moveStatFilter(payload)) {
        console.log('[PoeXD] 成功重排/跨群組移動詞綴:', payload.fromGroup, '->', payload.toGroup);
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
