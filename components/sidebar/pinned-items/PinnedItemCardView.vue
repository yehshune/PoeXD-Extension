<script setup lang="ts">
/**
 * 官方樣式的釘選物品卡片。卡片放在獨立的 shadow root 裡並載入官方市集 CSS：
 * 官方樣式只作用在卡片內，不會影響 Sidebar 其他介面，Sidebar 的樣式也不會蓋到卡片。
 */
import { onMounted, ref, watch } from 'vue';
import type { PinnedItemSnapshot } from '@/utils/pinned-items';
import { collectOfficialStylesheetHrefs, renderPinnedItemCard } from './pinned-item-card';

const props = defineProps<{ snapshot: PinnedItemSnapshot }>();

const host = ref<HTMLElement | null>(null);
let resultset: HTMLElement | null = null;

// 官方規則以 `#trade` / `.results` 為前綴，是為寬版結果列設計的（例如 `.item-popup` 最小寬度 400px）；
// 這裡只修正卡片放在窄欄時的版面：圖示縮小放左側，文字自動換行
const LOCAL_STYLE = `
  :host { display: block; }
  #trade { width: auto; min-width: 0; margin: 0; padding: 0; background: none; }
  #trade .results { width: auto; min-width: 0; margin: 0; }
  #trade .resultset { margin: 0; }
  #trade .row {
    display: flex; align-items: flex-start; gap: 8px;
    width: auto; margin: 0; padding: 4px 0; border: 0;
  }
  #trade .row > .left { flex: 0 0 auto; width: auto; padding: 0; }
  #trade .row > .left .newItemContainer,
  #trade .row > .left .iconContainer,
  #trade .row > .left .icon { width: auto; height: auto; }
  #trade .row > .left .icon img {
    width: auto; height: auto; max-width: 48px; max-height: 96px; margin: 0;
  }
  #trade .row > .middle { flex: 1 1 0; min-width: 0; width: auto; overflow: hidden; }
  #trade .item-popup { width: auto; min-width: 0; max-width: none; }
  #trade .item-popup__content,
  #trade .item-popup__property { width: auto; }
  #trade .item-popup__content * { white-space: normal; overflow-wrap: anywhere; }
  #trade .item-popup__header-line {
    display: block; max-width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
  }
`;

function render() {
  if (!resultset) return;
  resultset.replaceChildren(renderPinnedItemCard(props.snapshot));
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
});

watch(() => props.snapshot, render);
</script>

<template>
  <div ref="host" data-pinned-item-card></div>
</template>
