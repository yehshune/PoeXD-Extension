<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { t } from '@/utils/i18n';
import { PAGE_GUIDE_REVEAL_ATTR } from '@/utils/page-guide-reveal';
import { PAGE_GUIDE_MOCK_ATTR, PAGE_GUIDE_MOCK_Z_INDEX } from '@/utils/trade-results-root';
import { ensureResultEnhancementStyles } from '@/entrypoints/content/logic/result-enhancement-styles';
import { RESULT_FEATURE_KEYS, type ResultFeatureFlags } from './page-guide-setup';

/**
 * 導覽用的示意結果列：沿用官方結果列的 DOM 結構與 class，放進官方 `#trade` 底下讓官方樣式直接套用，
 * 外觀與真的結果一致。標上 `data-poexd-guide-mock`，結果強化功能與官方搜尋都不會處理它；
 * 按鈕都不能點。哪些按鈕出現跟著目前的功能開關走。
 */
const props = defineProps<{
  features: ResultFeatureFlags;
  /** 是否在譯文下方附上英文原文副標（對應導覽步驟二的結果中英並列選項） */
  resultBilingual?: boolean;
}>();

/** 一筆結果的寬度，與官方雙欄版面的一欄差不多 */
const MOCK_WIDTH = 620;
const ITEM_ICON =
  'https://web.poecdn.com/gen/image/WzI1LDE0LHsiZiI6IjJESXRlbXMvV2VhcG9ucy9Ud29IYW5kV2VhcG9ucy9Ud29IYW5kTWFjZXMvQmFzZXR5cGVzLzJITWFjZTA5IiwidyI6MiwiaCI6NCwic2NhbGUiOjEsInJlYWxtIjoicG9lMiJ9XQ/74817e8b14/2HMace09.png';
const EXALTED_ICON =
  'https://web.poecdn.com/gen/image/WzI1LDE0LHsiZiI6IjJESXRlbXMvQ3VycmVuY3kvQ3VycmVuY3lBZGRNb2RUb1JhcmUiLCJzY2FsZSI6MSwicmVhbG0iOiJwb2UyIn1d/ad7c366789/CurrencyAddModToRare.png';
const DIVINE_ICON =
  'https://webtw.poecdn.com/gen/image/WzI1LDE0LHsiZiI6IjJESXRlbXMvQ3VycmVuY3kvQ3VycmVuY3lNb2RWYWx1ZXMiLCJzY2FsZSI6MX1d/ec48896769/CurrencyModValues.png';
const PIN_PATHS = [
  'M12 17v5',
  'M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z',
];

const mods = [
  {
    key: 'pageGuide.mock.mod1',
    enKey: 'pageGuide.mock.mod1En',
    tier: 'P7',
    range: '[16—23 to 25—35]',
    kind: 'pr',
    highlight: true,
  },
  {
    key: 'pageGuide.mock.mod2',
    enKey: 'pageGuide.mock.mod2En',
    tier: 'P6',
    range: '[34—47]',
    kind: 'pr',
    highlight: false,
  },
  {
    key: 'pageGuide.mock.mod3',
    enKey: 'pageGuide.mock.mod3En',
    tier: 'S3',
    range: '[17—19]',
    kind: 'su',
    highlight: false,
  },
] as const;

const teleportTarget = ref<HTMLElement | null>(null);
const position = ref({ left: 0, top: 0, width: MOCK_WIDTH });
/** 官方結果區目前是否為精簡模式；沒有結果區時用精簡模式（官方預設） */
const compact = ref(true);

const resultsEl = ref<HTMLElement | null>(null);
const rowEl = ref<HTMLElement | null>(null);
/** 官方雙欄版面可能把唯一一列排在右欄；量出位移後把內層往左推，讓這列貼齊外框 */
const rowShift = ref(0);

async function alignRow() {
  await nextTick();
  const results = resultsEl.value;
  const row = rowEl.value;
  if (!results || !row) return;
  const shift = Math.round(row.getBoundingClientRect().left - results.getBoundingClientRect().left);
  if (shift !== rowShift.value) rowShift.value = shift;
}

function measure() {
  const trade = document.getElementById('trade');
  const rect = trade?.getBoundingClientRect();
  const areaLeft = rect ? rect.left : 0;
  const areaWidth = rect ? rect.width : window.innerWidth;
  const width = Math.min(MOCK_WIDTH, Math.max(320, areaWidth - 32));
  position.value = {
    left: Math.round(areaLeft + (areaWidth - width) / 2),
    top: Math.round(Math.min(160, window.innerHeight * 0.18)),
    width,
  };
  void alignRow();
}

let tradeObserver: ResizeObserver | null = null;

onMounted(() => {
  ensureResultEnhancementStyles();
  const trade = document.getElementById('trade');
  teleportTarget.value = trade ?? document.body;
  const realResults = document.querySelector(`.results:not([${PAGE_GUIDE_MOCK_ATTR}])`);
  if (realResults) compact.value = realResults.classList.contains('compact');
  measure();
  window.addEventListener('resize', measure);
  if (trade && typeof ResizeObserver !== 'undefined') {
    tradeObserver = new ResizeObserver(measure);
    tradeObserver.observe(trade);
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', measure);
  tradeObserver?.disconnect();
  tradeObserver = null;
});

/** 功能開關變動時確保樣式存在並重建示意列，避免外部狀態殘留影響預覽 */
const featureKey = computed(() =>
  RESULT_FEATURE_KEYS.map((key) => (props.features[key] ? '1' : '0')).join(''),
);
watch(featureKey, () => {
  ensureResultEnhancementStyles();
  void alignRow();
});

const mockAttrs = { [PAGE_GUIDE_MOCK_ATTR]: '' };
const revealAttrs = { [PAGE_GUIDE_REVEAL_ATTR]: '' };
</script>

<template>
  <Teleport v-if="teleportTarget" :to="teleportTarget">
    <!-- 外層只負責定位；官方樣式依 .results 排版，直接把 .results 設成 fixed 會跑版 -->
    <div
      data-page-guide-mock-frame
      aria-hidden="true"
      :style="{
        position: 'fixed',
        left: `${position.left}px`,
        top: `${position.top}px`,
        width: `${position.width}px`,
        zIndex: PAGE_GUIDE_MOCK_Z_INDEX,
        pointerEvents: 'none',
        background: 'oklch(0.13 0 0)',
        border: '1px solid oklch(0.32 0 0)',
        boxShadow: '0 12px 40px oklch(0 0 0 / 0.6)',
        overflow: 'hidden',
      }"
    >
      <!-- 官方雙欄版面每列佔 .results 一半寬，內層放兩倍寬讓唯一一列剛好是一欄的寬度 -->
      <div
        v-bind="mockAttrs"
        class="results two"
        :class="{ compact }"
        :style="{
          width: `${position.width * 2}px`,
          margin: '0',
          marginLeft: `${-rowShift}px`,
        }"
        ref="resultsEl"
      >
        <div :key="featureKey" class="resultset">
          <div ref="rowEl" class="row" v-bind="revealAttrs">
            <div class="left">
              <button class="refresh" type="button" tabindex="-1"></button>
              <button class="searchBy" type="button" tabindex="-1"></button>
              <div
                class="newItemContainer itemPlaced iW2 iH4 ipW2 ipH4 poe2"
                style="background: none"
              >
                <div class="iconContainer">
                  <div class="icon"><img :src="ITEM_ICON" alt="" /></div>
                </div>
              </div>
              <div class="poexd-left-actions">
                <button
                  v-if="features.enableResultPobCopy"
                  type="button"
                  tabindex="-1"
                  class="poexd-left-actions-btn poexd-pob-copy-btn"
                >
                  PoB
                </button>
                <div v-if="features.enableResultExternalLinks" class="poexd-result-links">
                  <button
                    type="button"
                    tabindex="-1"
                    class="poexd-left-actions-btn poexd-result-link-btn"
                  >
                    {{ t('resultLinks.poedb.button') }}
                  </button>
                </div>
                <button
                  v-if="features.sidebarModulePinnedItems"
                  type="button"
                  tabindex="-1"
                  class="poexd-left-actions-btn poexd-pin-btn"
                  aria-pressed="false"
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="12"
                    height="12"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path v-for="d in PIN_PATHS" :key="d" :d="d" />
                  </svg>
                </button>
              </div>
            </div>

            <div class="middle">
              <div class="item-popup item-popup--rare item-popup--poe2">
                <div
                  class="item-popup__header item-popup__header--item item-popup__header--double item-popup__header--rare"
                >
                  <span></span>
                  <div class="item-popup__header-line">{{ t('pageGuide.mock.itemName') }}</div>
                  <div class="item-popup__header-line">{{ t('pageGuide.mock.itemBase') }}</div>
                  <span></span>
                </div>
                <div class="item-popup__content">
                  <div class="item-property item-popup__property">
                    <span class="lc"><span>{{ t('pageGuide.mock.typeLine') }}</span></span>
                  </div>
                  <div class="item-property item-popup__property">
                    <span class="s lc"
                      ><span>{{ t('pageGuide.mock.physical') }}</span>:
                      <span style="color: var(--colour-value-default)">68-102</span></span
                    >
                  </div>
                  <div class="item-property item-popup__property">
                    <span class="s lc"
                      ><span>{{ t('pageGuide.mock.crit') }}</span>:
                      <span style="color: var(--colour-value-default)">6.50%</span></span
                    >
                  </div>
                  <div class="item-property item-popup__property">
                    <span class="s lc"
                      ><span>{{ t('pageGuide.mock.aps') }}</span>:
                      <span style="color: var(--colour-value-default)">1.10</span></span
                    >
                  </div>
                  <hr class="item-popup__separator" />
                  <div class="item-property item-popup__property">
                    <span class="s lc"
                      ><span>{{ t('pageGuide.mock.ilvl') }}</span
                      ><span style="color: var(--colour-value-default)">46</span></span
                    >
                  </div>
                  <hr class="item-popup__separator" />
                  <div
                    v-for="mod in mods"
                    :key="mod.key"
                    class="item-mod item-mod--explicit poexd-result-mod-host"
                    :class="{
                      'poexd-filter-mod-highlight':
                        mod.highlight && features.enableResultModHighlight,
                    }"
                    v-bind="mod.highlight ? revealAttrs : {}"
                    :data-mock-mod="mod.highlight ? 'highlight' : undefined"
                  >
                    <span class="s lc"
                      ><span>{{ t(mod.key) }}</span
                      ><span
                        v-if="resultBilingual && t(mod.key) !== t(mod.enKey)"
                        class="poexd-result-mod-en"
                        >{{ t(mod.enKey) }}</span
                      ></span
                    ><span class="lc l" :class="mod.kind"
                      >{{ mod.tier }}<span class="d">&nbsp;{{ mod.range }}</span></span
                    ><span
                      v-if="features.enableResultModQuickFilter"
                      class="poexd-result-mod-actions"
                      ><button
                        type="button"
                        tabindex="-1"
                        class="poexd-result-mod-btn"
                        data-poexd-quick-group="and"
                      >
                        {{ t('resultModQuickFilter.andButton') }}</button
                      ><button
                        type="button"
                        tabindex="-1"
                        class="poexd-result-mod-btn"
                        data-poexd-quick-group="not"
                      >
                        {{ t('resultModQuickFilter.notButton') }}
                      </button></span
                    >
                  </div>
                  <hr class="item-popup__separator" />
                  <div style="color: var(--colour-currency)">~b/o 1 exalted</div>
                </div>
              </div>
            </div>

            <div class="right">
              <div class="details">
                <div class="price">
                  <span class="s"
                    ><span class="price-label buyout-price">{{
                      t('pageGuide.mock.priceLabel')
                    }}</span
                    >&nbsp;<br /><span>1</span><span>×</span
                    ><span class="currency-text currency-image"
                      ><img :src="EXALTED_ICON" alt="" /><span>{{
                        t('pageGuide.mock.currency')
                      }}</span></span
                    ></span
                  >
                  <span v-if="features.enablePriceComparison" class="poexd-price-comparison"
                    >≈ 0.05<img class="poexd-price-comparison-icon" :src="DIVINE_ICON" alt=""
                  /></span>
                </div>
                <div class="btns">
                  <span class="character-name"
                    >Acc:&nbsp;<span class="profile-link"><a>PoeXD#0000</a></span></span
                  >
                  <div>
                    <button type="button" tabindex="-1" class="btn btn-xs btn-default direct-btn">
                      {{ t('pageGuide.mock.direct') }}
                    </button>
                  </div>
                  <span
                    ><button type="button" tabindex="-1" class="btn btn-default ignore-btn">
                      {{ t('pageGuide.mock.ignore') }}
                    </button></span
                  >
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
