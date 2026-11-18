<script setup lang="ts">
/**
 * 官方樣式的釘選物品卡片。卡片放在獨立的 shadow root 裡並載入官方市集 CSS：
 * 官方樣式只作用在卡片內，不會影響 Sidebar 其他介面，Sidebar 的樣式也不會蓋到卡片。
 *
 * 有官方卡片快照（釘選時擷取、清理過的節點樹）時照原樣重建；舊的釘選沒有快照，改以物品 JSON 自繪。
 * 收合以 CSS 切換：只留圖示與物品名稱，不重新渲染。
 */
import { onMounted, ref, watch } from 'vue';
import { requestResultTranslation } from '@/utils/market-result-translation-request';
import { buildPinnedCardNode } from '@/utils/pinned-card-dom';
import type { PinnedItemSnapshot } from '@/utils/pinned-items';
import { collectOfficialStylesheetHrefs, renderPinnedItemCard } from './pinned-item-card';

const props = defineProps<{ snapshot: PinnedItemSnapshot; collapsed: boolean }>();

const host = ref<HTMLElement | null>(null);
let resultset: HTMLElement | null = null;

// 官方規則以 `#trade` / `.results` 為前綴，是為寬版結果列設計的（例如 `.item-popup` 最小寬度 400px）；
// 展開在窄側邊欄時改為縱向滿寬排版：圖示置頂（1×1 無插槽小物品直接沿用上方標題列小圖示，不重複佔高），
// `.item-popup` 撐滿展開區寬度並開放文字選取，並清除官網倉庫格的藍色高亮底色。
const LOCAL_STYLE = `
  :host { display: block; }
  /* 展開後的物品細節文字允許選取複製；圖片保留不可拖曳 */
  #trade { user-select: text; cursor: auto; }
  #trade img { user-select: none; -webkit-user-drag: none; }
  #trade .item-popup__content,
  #trade .item-popup__header,
  #trade .itemPopupAdditional { user-select: text; cursor: text; }

  #trade {
    width: auto; min-width: 0; min-height: 0; margin: 0; padding: 0; background: none;
  }
  #trade .results { width: auto; min-width: 0; margin: 0; padding: 0; border: 0; }
  #trade .resultset { margin: 0; padding: 0; }
  #trade .row {
    display: flex; flex-direction: column; align-items: stretch; gap: 0;
    width: 100%; min-height: 0; margin: 0; padding: 0; border: 0;
    background: rgba(0, 0, 0, 0.95);
  }
  #trade .row > .left {
    display: flex; justify-content: center; align-items: center;
    flex: 0 0 auto; width: 100%; min-height: 0; margin: 0; padding: 4px 0;
  }
  #trade .row[data-single-cell] > .left { display: none; }
  /* 清除官網倉庫格的藍色高亮底色，改為透明吃卡片深黑底 */
  #trade .newItemContainer,
  #trade .newItemContainer.itemPlaced {
    background: transparent !important;
    margin: 0 auto;
  }
  #trade .newItemContainer.iH2 { zoom: 0.78; }
  #trade .newItemContainer.iH3 { zoom: 0.56; }
  #trade .newItemContainer.iH4 { zoom: 0.46; }

  #trade .row > .middle {
    flex: 1 1 auto; min-width: 0; width: 100%; margin: 0; padding: 0; overflow: hidden;
  }
  #trade .item-popup { width: 100%; min-width: 0; max-width: none; margin: 0; }
  /* 適度收斂左右飾條留白，讓雙語／長物品名稱更完整 */
  #trade .item-popup__header--item { padding-left: 24px; padding-right: 24px; }
  #trade .item-popup__header--double { padding-left: 34px; padding-right: 34px; }
  #trade .item-popup__content,
  #trade .item-popup__property { width: auto; }
  #trade .item-popup__content * { white-space: normal; overflow-wrap: anywhere; }
  #trade .item-popup__header-line {
    display: block; max-width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
  }
  #trade .itemPopupAdditional {
    width: auto; margin: 0; padding: 4px 8px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }

  #trade .row[data-fallback] > .left .newItemContainer,
  #trade .row[data-fallback] > .left .iconContainer,
  #trade .row[data-fallback] > .left .icon { width: auto; height: auto; }
  #trade .row[data-fallback] > .left .icon img {
    display: block; width: auto; height: auto; max-width: 140px; max-height: 88px; margin: 0;
  }

  #trade .row[data-collapsed] .item-popup__content,
  #trade .row[data-collapsed] .itemPopupAdditional,
  #trade .row[data-collapsed] .sockets { display: none; }
  #trade .row[data-collapsed] .newItemContainer.iH2 { zoom: 0.5; }
  #trade .row[data-collapsed] .newItemContainer.iH3 { zoom: 0.34; }
  #trade .row[data-collapsed] .newItemContainer.iH4 { zoom: 0.25; }
  #trade .row[data-collapsed][data-fallback] > .left .icon img { max-height: 48px; }
`;

function markSingleCellWithoutSockets(row: HTMLElement): void {
  const container = row.querySelector(':scope > .left .newItemContainer');
  if (!container) return;
  const hasSockets = Boolean(container.querySelector('.socket'));
  const isSingleCell = container.classList.contains('iW1') && container.classList.contains('iH1');
  if (isSingleCell && !hasSockets) {
    row.setAttribute('data-single-cell', '');
  }
}

function buildRow(): HTMLElement {
  const card = props.snapshot.card;
  if (!card) {
    const fallback = renderPinnedItemCard(props.snapshot);
    fallback.setAttribute('data-fallback', '');
    markSingleCellWithoutSockets(fallback);
    return fallback;
  }
  const row = document.createElement('div');
  row.className = 'row';
  const left = document.createElement('div');
  left.className = 'left';
  if (card.icon) left.appendChild(buildPinnedCardNode(card.icon, document));
  const middle = document.createElement('div');
  middle.className = 'middle';
  card.popup.forEach((node) => middle.appendChild(buildPinnedCardNode(node, document)));
  row.append(left, middle);
  markSingleCellWithoutSockets(row);
  return row;
}

function applyCollapsed() {
  resultset?.firstElementChild?.toggleAttribute('data-collapsed', props.collapsed);
}

function render() {
  if (!resultset) return;
  resultset.replaceChildren(buildRow());
  applyCollapsed();
}

onMounted(() => {
  if (!host.value) return;
  const root = host.value.attachShadow({ mode: 'open' });
  for (const href of collectOfficialStylesheetHrefs()) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    root.appendChild(link);
  }
  const style = document.createElement('style');
  style.textContent = LOCAL_STYLE;
  root.appendChild(style);

  const trade = document.createElement('div');
  trade.id = 'trade';
  const results = document.createElement('div');
  // 官方的預設版面（Default）：不加 `compact` / `compact two`
  results.className = 'results';
  resultset = document.createElement('div');
  resultset.className = 'resultset';
  results.appendChild(resultset);
  trade.appendChild(results);
  root.appendChild(trade);
  render();
  // 市集漢化啟用時，翻譯器會翻譯並持續監看這張卡片（英文快照與自繪卡片都會被翻譯）
  requestResultTranslation(resultset);
});

watch(() => props.snapshot, render);
watch(() => props.collapsed, applyCollapsed);
</script>

<template>
  <div ref="host" data-pinned-item-card></div>
</template>
