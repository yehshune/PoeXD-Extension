<script setup lang="ts">
/**
 * 官方樣式的釘選物品卡片。卡片放在獨立的 shadow root 裡並載入官方市集 CSS：
 * 官方樣式只作用在卡片內，不會影響 Sidebar 其他介面，Sidebar 的樣式也不會蓋到卡片。
 *
 * 支援 `part` 切換：
 * - `'all'`（預設）：完整顯示圖示與物品框。
 * - `'popup'`：僅顯示上方 `.item-popup` 詞綴卡。
 * - `'icon'`：僅顯示正規化縮放後的官方 `.newItemContainer` 圖示（含插槽），放進左側圖片框。
 */
import { onMounted, ref, watch } from 'vue';
import { requestResultTranslation } from '@/utils/market-result-translation-request';
import { buildPinnedCardNode } from '@/utils/pinned-card-dom';
import type { PinnedItemSnapshot } from '@/utils/pinned-items';
import {
  collectOfficialStylesheetHrefs,
  renderPinnedItemCard,
  renderPinnedItemIcon,
} from './pinned-item-card';

const props = withDefaults(
  defineProps<{
    snapshot: PinnedItemSnapshot;
    collapsed: boolean;
    part?: 'all' | 'popup' | 'icon';
  }>(),
  { part: 'all' },
);

const host = ref<HTMLElement | null>(null);
let resultset: HTMLElement | null = null;

// 官方規則以 `#trade` / `.results` 為前綴，是為寬版結果列設計的（例如 `.item-popup` 最小寬度 400px）；
// 展開在窄側邊欄時改為滿寬物品卡 + 下方正規化圖片框：`.item-popup` 撐滿展開區寬度並開放文字選取，
// 圖片區域依格子尺寸（1×1 至 2×4）等比縮放並清除官網倉庫格的藍色高亮底色。
const LOCAL_STYLE = `
  :host { display: block; }
  :host([data-part='icon']) {
    width: 100%;
    height: 100%;
  }
  /* 展開後的物品細節文字允許選取複製；圖片保留不可拖曳 */
  #trade { user-select: text; cursor: auto; }
  #trade img { user-select: none; -webkit-user-drag: none; }
  #trade .item-popup__content,
  #trade .item-popup__header,
  #trade .itemPopupAdditional { user-select: text; cursor: text; }

  /* 官方頁面 body 為 13px（.item-popup 設 110% → 14.3px），不能繼承側邊欄的 --pxd-font-secondary（12px） */
  #trade {
    container-type: inline-size;
    width: 100%; min-width: 0; min-height: 0; margin: 0; padding: 0; background: none;
    font-family: Verdana, Arial, Helvetica, sans-serif;
    font-size: 13px;
    line-height: 1.3;
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
  #trade .row[data-part='icon'] {
    height: 100%;
    background: transparent;
  }
  #trade .row[data-part='icon'] > .left {
    height: 100%;
    padding: 0;
    overflow: hidden;
  }
  :host([data-part='icon']) #trade,
  :host([data-part='icon']) #trade .results,
  :host([data-part='icon']) #trade .resultset {
    width: 100%;
    height: 100%;
  }
  /* 清除官網倉庫格的藍色高亮底色，改為透明吃卡片深黑底 */
  #trade .newItemContainer,
  #trade .newItemContainer.itemPlaced {
    background: transparent !important;
    margin: 0 auto;
  }
  /* 正規化所有官方物品格子尺寸（1x1 ~ 2x4），確保在 88px 圖片框內皆完整置中不裁切插槽 */
  #trade .row[data-part='icon'] .newItemContainer.iW1.iH1 { zoom: 1.0; }
  #trade .row[data-part='icon'] .newItemContainer.iW2:not(.iH2):not(.iH3):not(.iH4) { zoom: 0.68; }
  #trade .row[data-part='icon'] .newItemContainer.iH2 { zoom: 0.68; }
  #trade .row[data-part='icon'] .newItemContainer.iH3 { zoom: 0.46; }
  #trade .row[data-part='icon'] .newItemContainer.iH4 { zoom: 0.34; }
  #trade .row:not([data-part='icon']) .newItemContainer.iH2 { zoom: 0.78; }
  #trade .row:not([data-part='icon']) .newItemContainer.iH3 { zoom: 0.56; }
  #trade .row:not([data-part='icon']) .newItemContainer.iH4 { zoom: 0.46; }

  #trade .row > .middle {
    flex: 1 1 auto; min-width: 0; width: 100%; margin: 0; padding: 0; overflow: hidden;
  }
  #trade .item-popup { width: 100%; min-width: 0; max-width: none; margin: 0; pointer-events: auto; }
  /* 適度收斂左右飾條留白，讓雙語／長物品名稱更完整 */
  #trade .item-popup__header--item { padding-left: 24px; padding-right: 24px; }
  #trade .item-popup__header--double { padding-left: 34px; padding-right: 34px; }
  #trade .item-popup__content,
  #trade .item-popup__property { width: auto; }
  #trade .item-popup__content * { white-space: normal; overflow-wrap: anywhere; }
  #trade .item-popup__header-line {
    display: block; max-width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
  }
  /* 左側 P/S 階級與數值區間與官方同字級；寬度足夠時顯示階級，窄欄預設隱藏，hover 詞綴時疊加在左側不擠壓正文 */
  #trade .item-popup .item-mod {
    position: relative;
    padding: 0 8px;
  }
  #trade .item-popup .item-mod > .lc {
    width: auto;
    max-width: 100%;
    padding: 0;
  }
  #trade .item-popup .item-mod > .lc:not(.l):not(.r) {
    display: block;
    text-align: center;
    padding: 0 36px;
  }
  #trade .item-popup .item-mod > .lc.l {
    position: absolute;
    left: 8px;
    top: 0;
    right: auto;
    /* 卡片在側欄 shadow root 內的巢狀 shadow root，繼承側欄的疊層 token */
    z-index: var(--pxd-z-raised, 1);
    text-align: left;
    font-size: 1em;
    opacity: 0.82;
  }
  #trade .item-popup .item-mod > .lc.l .d {
    display: none;
    background: rgba(0, 0, 0, 0.95);
    padding: 0 4px 0 0;
  }
  #trade .item-popup .item-mod:hover > .lc.l {
    opacity: 1;
    background: rgba(0, 0, 0, 0.95);
    padding-right: 4px;
  }
  #trade .item-popup .item-mod:hover > .lc.l .d {
    display: inline;
  }
  @container (max-width: 460px) {
    #trade .item-popup .item-mod > .lc:not(.l):not(.r) {
      padding: 0;
    }
    #trade .item-popup .item-mod > .lc.l {
      opacity: 0;
      pointer-events: none;
    }
    #trade .item-popup .item-mod:hover > .lc.l {
      opacity: 1;
    }
  }
  #trade .item-popup .item-mod > .lc.r {
    display: none;
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
  #trade .row[data-part='icon'][data-fallback] > .left .icon img {
    max-width: 68px; max-height: 68px; object-fit: contain;
  }

  #trade .row[data-collapsed] .item-popup__content,
  #trade .row[data-collapsed] .itemPopupAdditional,
  #trade .row[data-collapsed] .sockets { display: none; }
  #trade .row[data-collapsed] .newItemContainer.iH2 { zoom: 0.5; }
  #trade .row[data-collapsed] .newItemContainer.iH3 { zoom: 0.34; }
  #trade .row[data-collapsed] .newItemContainer.iH4 { zoom: 0.25; }
  #trade .row[data-collapsed][data-fallback] > .left .icon img { max-height: 48px; }
`;

function buildIconNode(cardIcon: NonNullable<PinnedItemSnapshot['card']>['icon']): HTMLElement {
  const left = document.createElement('div');
  left.className = 'left';
  if (cardIcon) left.appendChild(buildPinnedCardNode(cardIcon, document));
  return left;
}

function buildRow(): HTMLElement {
  const card = props.snapshot.card;
  if (props.part === 'icon') {
    const row = document.createElement('div');
    row.className = 'row';
    row.setAttribute('data-part', 'icon');
    if (card?.icon) {
      row.appendChild(buildIconNode(card.icon));
    } else {
      row.setAttribute('data-fallback', '');
      row.appendChild(renderPinnedItemIcon(props.snapshot));
    }
    return row;
  }

  if (!card) {
    const fallback = renderPinnedItemCard(props.snapshot);
    fallback.setAttribute('data-fallback', '');
    fallback.setAttribute('data-part', props.part);
    if (props.part === 'popup') {
      fallback.querySelector(':scope > .left')?.remove();
    }
    return fallback;
  }

  const row = document.createElement('div');
  row.className = 'row';
  row.setAttribute('data-part', props.part);
  if (props.part === 'all') {
    row.appendChild(buildIconNode(card.icon));
  }
  const middle = document.createElement('div');
  middle.className = 'middle';
  card.popup.forEach((node) => middle.appendChild(buildPinnedCardNode(node, document)));
  row.appendChild(middle);
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

watch(() => [props.snapshot, props.part] as const, render);
watch(() => props.collapsed, applyCollapsed);
</script>

<template>
  <div ref="host" :data-part="props.part" data-pinned-item-card></div>
</template>
