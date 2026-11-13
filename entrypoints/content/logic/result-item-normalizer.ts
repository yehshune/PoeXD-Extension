import { createSvgIcon, setLabeledValue, type SvgIconSpec } from '@/utils/safe-dom';
import {
  createResultNormalizedItems,
  normalizePoe2Item,
  type NormalizedItemStats,
  type WeaponNormalizedStats,
  type ArmourNormalizedStats,
  type RuneSubstitutionConfig,
  type RawPoeItem,
  DEFAULT_RUNE_CONFIG,
  type WeaponRuneConfig,
  type ArmourRuneConfig,
} from '@/utils/poe2-item-normalizer';
import type { PoeVersion } from '@/utils/trade-context';
import { getTradePageMode, type TradePageMode } from '@/utils/trade-page-mode';
import type { TradePageRole } from '@/utils/live-search-contract';
import { parsePoeFetchResponse } from '@/utils/event-contracts';
import type { ResultPricePresenter } from './result-price-presenter';
import { t, getActiveUiLocale, type I18nKey } from '@/utils/i18n';

export type SortMode =
  | 'default'
  | 'potential_dps'
  | 'potential_pdps'
  | 'potential_edps'
  | 'potential_def'
  | 'potential_armour'
  | 'potential_evasion'
  | 'potential_es'
  | 'cp_ratio';

const ICON_SVG_ATTRS = {
  width: '15',
  height: '15',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': '2',
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
} as const;
const SWORD_SVG: SvgIconSpec = {
  attrs: ICON_SVG_ATTRS,
  paths: ['M14.5 17.5 3 6V3h3l11.5 11.5', 'm13 19 6-6', 'm16 16 4 4', 'm19 21 2-2'],
};
const SHIELD_SVG: SvgIconSpec = {
  attrs: ICON_SVG_ATTRS,
  paths: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'],
};
const SORT_SVG: SvgIconSpec = {
  attrs: ICON_SVG_ATTRS,
  paths: ['m3 16 4 4 4-4', 'M7 20V4', 'm21 8-4-4-4 4', 'M17 4v16'],
};

function getWeaponRuneOptions(): Array<{
  key: string;
  label: string;
  config: WeaponRuneConfig;
}> {
  return [
    {
      key: 'phys_20',
      label: t('normalizer.rune.phys_20'),
      config: { type: 'phys_percent', value: 20 },
    },
    {
      key: 'phys_18',
      label: t('normalizer.rune.phys_18'),
      config: { type: 'phys_percent', value: 18 },
    },
    {
      key: 'fire_17_20',
      label: t('normalizer.rune.fire_17_20'),
      config: { type: 'flat_fire', value: 18.5 },
    },
    {
      key: 'cold_16_20',
      label: t('normalizer.rune.cold_16_20'),
      config: { type: 'flat_cold', value: 18 },
    },
    {
      key: 'lightning_1_40',
      label: t('normalizer.rune.lightning_1_40'),
      config: { type: 'flat_lightning', value: 20.5 },
    },
    { key: 'none', label: t('normalizer.rune.none'), config: { type: 'none', value: 0 } },
  ];
}

function getArmourRuneOptions(): Array<{
  key: string;
  label: string;
  config: ArmourRuneConfig;
}> {
  return [
    {
      key: 'def_20',
      label: t('normalizer.rune.def_20'),
      config: { type: 'def_percent', value: 20 },
    },
    {
      key: 'def_18',
      label: t('normalizer.rune.def_18'),
      config: { type: 'def_percent', value: 18 },
    },
    { key: 'none', label: t('normalizer.rune.none'), config: { type: 'none', value: 0 } },
  ];
}

function getSortModeOptions(): Array<{
  key: SortMode;
  label: string;
}> {
  return [
    { key: 'default', label: t('normalizer.sort.default') },
    { key: 'potential_dps', label: t('normalizer.sort.potential_dps') },
    { key: 'potential_pdps', label: t('normalizer.sort.potential_pdps') },
    { key: 'potential_edps', label: t('normalizer.sort.potential_edps') },
    { key: 'potential_def', label: t('normalizer.sort.potential_def') },
    { key: 'potential_armour', label: t('normalizer.sort.potential_armour') },
    { key: 'potential_evasion', label: t('normalizer.sort.potential_evasion') },
    { key: 'potential_es', label: t('normalizer.sort.potential_es') },
    { key: 'cp_ratio', label: t('normalizer.sort.cp_ratio') },
  ];
}

function getWeaponRuneKey(config: WeaponRuneConfig): string {
  const options = getWeaponRuneOptions();
  const match = options.find(
    (opt) => opt.config.type === config.type && opt.config.value === config.value,
  );
  return match ? match.key : options[0].key;
}

function getArmourRuneKey(config: ArmourRuneConfig): string {
  const options = getArmourRuneOptions();
  const match = options.find(
    (opt) => opt.config.type === config.type && opt.config.value === config.value,
  );
  return match ? match.key : options[0].key;
}

export class ResultItemNormalizer {
  private enabled = true;
  private pageMode: TradePageMode = typeof window !== 'undefined' ? getTradePageMode() : 'search';
  private pageRole: TradePageRole = 'normal';
  private activeSearchId?: string;
  private rawItemsMap: Record<string, RawPoeItem> = {};
  private normalizedMap: Record<string, NormalizedItemStats> = {};
  private originalOrder: string[] = [];
  private runeConfig: RuneSubstitutionConfig = { ...DEFAULT_RUNE_CONFIG };
  private sortMode: SortMode = 'default';
  public isReordering = false;

  constructor(
    private readonly version: PoeVersion,
    private readonly pricePresenter?: ResultPricePresenter,
  ) {}

  public isLiveOrConsole(): boolean {
    if (this.pageMode === 'live' || this.pageRole === 'live-search-primary') {
      return true;
    }
    if (typeof window !== 'undefined') {
      const pathname = (window.location?.pathname || '').toLowerCase();
      if (
        pathname
          .split('/')
          .filter(Boolean)
          .some((p) => p === 'live')
      ) {
        return true;
      }
    }
    if (typeof document !== 'undefined') {
      if (
        document.body?.getAttribute('data-poexd-page-role') === 'live-search-primary' ||
        document.body?.classList.contains('live-search-primary') ||
        document.querySelector('.live-search-primary, [data-console-host]')
      ) {
        return true;
      }
    }
    return false;
  }

  async handleFetchResponse(detail: string) {
    if (this.version !== 'poe2' || this.isLiveOrConsole()) return;
    const eventData = parsePoeFetchResponse(detail);
    if (!eventData) return;
    const data = eventData.data;
    const results =
      data && typeof data === 'object' && Array.isArray((data as { result?: unknown[] }).result)
        ? (data as { result: unknown[] }).result
        : undefined;
    const searchId = getFetchSearchId(eventData.url);
    if (!Array.isArray(results) || !searchId) return;

    if (searchId !== this.activeSearchId) {
      this.activeSearchId = searchId;
      this.rawItemsMap = {};
      this.normalizedMap = {};
      this.originalOrder = [];
      removeInjectedElements();
    }

    results.forEach((res) => {
      if (!res || typeof res !== 'object') return;
      const { id, item } = res as { id?: string; item?: RawPoeItem };
      if (typeof id === 'string' && item) {
        this.rawItemsMap[id] = item;
        if (!this.originalOrder.includes(id)) {
          this.originalOrder.push(id);
        }
      }
    });

    const itemsMap = createResultNormalizedItems(results, this.runeConfig);
    Object.assign(this.normalizedMap, itemsMap);

    const root = document.querySelector('.results');
    if (root && this.enabled) {
      this.apply(root);
    }
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled || this.isLiveOrConsole()) {
      removeInjectedElements();
      const root = document.querySelector('.results');
      if (root) this.restoreOriginalDomOrder(root);
      return;
    }
    const root = document.querySelector('.results');
    if (root) this.apply(root);
  }

  private restoreOriginalDomOrder(container?: Element | null) {
    const root =
      container || (typeof document !== 'undefined' ? document.querySelector('.results') : null);
    if (!root) return;
    this.sortMode = 'default';
    this.reorderDomRows(root);
  }

  setPageRole(role: TradePageRole) {
    if (role === this.pageRole) return;
    this.pageRole = role;
    if (this.isLiveOrConsole()) {
      this.activeSearchId = undefined;
      this.rawItemsMap = {};
      this.normalizedMap = {};
      this.originalOrder = [];
      removeInjectedElements();
      this.restoreOriginalDomOrder();
    }
  }

  setPageMode(mode: TradePageMode) {
    if (mode === this.pageMode) return;
    this.pageMode = mode;
    if (this.isLiveOrConsole()) {
      this.activeSearchId = undefined;
      this.rawItemsMap = {};
      this.normalizedMap = {};
      this.originalOrder = [];
      removeInjectedElements();
      this.restoreOriginalDomOrder();
    }
  }

  private hasRegisteredGlobalClick = false;

  setRuneConfig(config: Partial<RuneSubstitutionConfig>) {
    this.runeConfig = { ...this.runeConfig, ...config };
    this.updateControlsState();
    // 重新以新符文設定計算所有裝備 (全域統一控制全部符文石)
    for (const [id, raw] of Object.entries(this.rawItemsMap)) {
      const stats = normalizePoe2Item(raw, this.runeConfig);
      if (stats) this.normalizedMap[id] = stats;
    }
    const root = document.querySelector('.results');
    if (root && this.enabled) {
      this.apply(root);
    }
  }

  setSortMode(mode: SortMode) {
    if (mode === 'cp_ratio' && (!this.pricePresenter || !this.pricePresenter.isEnabled())) {
      return;
    }
    this.sortMode = mode;
    this.updateControlsState();
    const root = document.querySelector('.results');
    if (root && this.enabled) {
      this.reorderDomRows(root);
    }
  }

  apply(container: Element) {
    if (this.version !== 'poe2' || !this.enabled || this.isLiveOrConsole() || this.isReordering) {
      if (this.isLiveOrConsole()) {
        removeInjectedElements();
      }
      return;
    }

    // 1. 確保官方 row-total 左側注入 3 顆 30px 圖標按鈕
    this.ensureRowTotalControls();

    // 2. 在每張卡片的官方 .itemPopupAdditional 行內附註個別覆寫數值，並在圖片下方渲染打孔潛力
    const rows = resultRows(container);
    for (const row of rows) {
      const resultId = resolveResultId(row, this.normalizedMap);
      if (!resultId) continue;
      const stats = this.normalizedMap[resultId];
      if (!stats) continue;

      renderInlinePopupOverrides(row, stats);
      renderSocketBadge(row, stats);
    }

    // 3. 套用真實 DOM 物理排序 (零 flex 破壞，相容官方所有版型)
    const resultsRoot = document.querySelector('.results');
    if (resultsRoot) {
      this.reorderDomRows(resultsRoot);
    }

    ensureInjectedStyle();
  }

  private ensureRowTotalControls() {
    const rowTotal = document.querySelector('.row.row-total');
    const resultsContainer = document.querySelector('.results');
    const targetParent = rowTotal || resultsContainer;
    if (!targetParent) return;

    let controls = document.querySelector('.poexd-total-controls') as HTMLElement | null;
    if (!controls) {
      controls = this.buildRowTotalControls();
      if (rowTotal) {
        rowTotal.prepend(controls);
      } else if (resultsContainer) {
        resultsContainer.insertAdjacentElement('beforebegin', controls);
      }
    } else {
      if (rowTotal && controls.parentElement !== rowTotal) {
        rowTotal.prepend(controls);
      }
    }

    if (rowTotal) syncWithNativeLayoutButtons(controls, rowTotal);
    this.registerGlobalClick();
    this.updateControlsState();
  }

  private readonly globalClickHandler = (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target?.closest('.poexd-btn-wrapper')) {
      document.querySelectorAll('.poexd-popover.poexd-open').forEach((el) => {
        el.classList.remove('poexd-open');
      });
    }
  };

  private registerGlobalClick() {
    if (this.hasRegisteredGlobalClick) return;
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
    this.hasRegisteredGlobalClick = true;
    document.addEventListener('click', this.globalClickHandler);
  }

  private unregisterGlobalClick() {
    if (!this.hasRegisteredGlobalClick) return;
    if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
      document.removeEventListener('click', this.globalClickHandler);
    }
    this.hasRegisteredGlobalClick = false;
  }

  refreshLocale() {
    if (this.version !== 'poe2' || !this.enabled || this.isLiveOrConsole()) return;
    this.updateControlsState();
    const root = document.querySelector('.results');
    if (root) {
      this.apply(root);
    }
  }

  private buildRowTotalControls(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'poexd-total-controls';

    // 1. ⚔️ 武器覆寫按鈕
    const weaponItems = getWeaponRuneOptions().map((opt) => ({
      key: opt.key,
      label: opt.label,
      onSelect: () => this.setRuneConfig({ weaponRune: opt.config }),
    }));
    const weaponWrapper = this.createControlDropdown(
      'weapon',
      SWORD_SVG,
      t('normalizer.btn.weaponTitle'),
      t('normalizer.btn.weaponHeader'),
      weaponItems,
    );
    container.appendChild(weaponWrapper);

    // 2. 🛡️ 防具覆寫按鈕
    const armourItems = getArmourRuneOptions().map((opt) => ({
      key: opt.key,
      label: opt.label,
      onSelect: () => this.setRuneConfig({ armourRune: opt.config }),
    }));
    const armourWrapper = this.createControlDropdown(
      'armour',
      SHIELD_SVG,
      t('normalizer.btn.armourTitle'),
      t('normalizer.btn.armourHeader'),
      armourItems,
    );
    container.appendChild(armourWrapper);

    // 3. ⇅ 排序方式按鈕
    const sortItems = getSortModeOptions().map((opt) => ({
      key: opt.key,
      label: opt.label,
      onSelect: () => this.setSortMode(opt.key),
    }));
    const sortWrapper = this.createControlDropdown(
      'sort',
      SORT_SVG,
      t('normalizer.btn.sortTitle'),
      t('normalizer.btn.sortHeader'),
      sortItems,
    );
    container.appendChild(sortWrapper);

    return container;
  }

  private createControlDropdown(
    type: 'weapon' | 'armour' | 'sort',
    svgIcon: SvgIconSpec,
    title: string,
    headerText: string,
    items: Array<{ key: string; label: string; onSelect: () => void }>,
  ): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = `poexd-btn-wrapper poexd-${type}-wrapper`;
    wrapper.setAttribute('data-control', type);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `poexd-icon-btn poexd-${type}-btn`;
    btn.setAttribute('title', title);
    btn.appendChild(createSvgIcon(svgIcon));

    const popover = document.createElement('div');
    popover.className = `poexd-popover poexd-${type}-popover`;

    const header = document.createElement('div');
    header.className = 'poexd-popover-header';
    header.textContent = headerText;
    popover.appendChild(header);

    for (const item of items) {
      const itemEl = document.createElement('div');
      itemEl.className = 'poexd-popover-item';
      itemEl.setAttribute('data-value', item.key);
      const labelEl = document.createElement('span');
      labelEl.textContent = item.label;
      const checkMark = document.createElement('span');
      checkMark.className = 'poexd-check-mark';
      itemEl.append(labelEl, checkMark);
      itemEl.addEventListener('click', (e) => {
        e.stopPropagation();
        item.onSelect();
        popover.classList.remove('poexd-open');
      });
      popover.appendChild(itemEl);
    }

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = popover.classList.contains('poexd-open');
      document.querySelectorAll('.poexd-popover.poexd-open').forEach((el) => {
        el.classList.remove('poexd-open');
      });
      if (!isOpen) {
        popover.classList.add('poexd-open');
      }
    });

    wrapper.appendChild(btn);
    wrapper.appendChild(popover);
    return wrapper;
  }

  private updateControlState(
    controls: Element,
    type: 'weapon' | 'armour' | 'sort',
    currentKey: string,
    options: Array<{ key: string; label: string }>,
    titleText: string,
    headerText: string,
    isActive: boolean,
  ) {
    const btn = controls.querySelector(`.poexd-${type}-btn`) as HTMLElement | null;
    if (btn) {
      btn.setAttribute('title', titleText);
      btn.classList.toggle('poexd-active', isActive);
    }
    const header = controls.querySelector(`.poexd-${type}-popover .poexd-popover-header`);
    if (header) {
      header.textContent = headerText;
    }
    controls.querySelectorAll(`.poexd-${type}-popover .poexd-popover-item`).forEach((item) => {
      const val = item.getAttribute('data-value');
      const isSelected = val === currentKey;
      item.classList.toggle('poexd-selected', isSelected);
      const opt = options.find((o) => o.key === val);
      const textSpan = item.querySelector('span');
      if (textSpan && opt) {
        textSpan.textContent = opt.label;
      }
      const check = item.querySelector('.poexd-check-mark');
      if (check) check.textContent = isSelected ? '✓' : '';
    });
  }

  private updateControlsState() {
    const controls = document.querySelector('.poexd-total-controls');
    if (!controls) return;

    // 更新武器符文狀態
    const currentWeaponKey = getWeaponRuneKey(this.runeConfig.weaponRune);
    const weaponOptions = getWeaponRuneOptions();
    const currentWeaponOpt = weaponOptions.find((o) => o.key === currentWeaponKey);
    this.updateControlState(
      controls,
      'weapon',
      currentWeaponKey,
      weaponOptions,
      t('normalizer.activeWeaponRune', { label: currentWeaponOpt?.label || '' }),
      t('normalizer.btn.weaponHeader'),
      currentWeaponKey !== 'none',
    );

    // 更新防具符文狀態
    const currentArmourKey = getArmourRuneKey(this.runeConfig.armourRune);
    const armourOptions = getArmourRuneOptions();
    const currentArmourOpt = armourOptions.find((o) => o.key === currentArmourKey);
    this.updateControlState(
      controls,
      'armour',
      currentArmourKey,
      armourOptions,
      t('normalizer.activeArmourRune', { label: currentArmourOpt?.label || '' }),
      t('normalizer.btn.armourHeader'),
      currentArmourKey !== 'none',
    );

    // 更新排序狀態
    const sortOptions = getSortModeOptions();
    const currentSortOpt = sortOptions.find((o) => o.key === this.sortMode);
    this.updateControlState(
      controls,
      'sort',
      this.sortMode,
      sortOptions,
      t('normalizer.activeSort', { label: currentSortOpt?.label || '' }),
      t('normalizer.btn.sortHeader'),
      this.sortMode !== 'default',
    );
  }

  /**
   * 真實 DOM 物理排序
   * 絕不修改容器的 display 與 flexDirection，100% 完整相容官方 layout-immersion、compact 與 compact-two 排版。
   * 透過 isReordering 旗標暫停 MutationObserver 監聽，並將 controls / 哨兵固定在最末尾，徹底根除無限加載。
   */
  private reorderDomRows(container: Element) {
    if (this.isReordering) return;
    if (
      this.sortMode === 'cp_ratio' &&
      (!this.pricePresenter || !this.pricePresenter.isEnabled())
    ) {
      return;
    }
    const rows = resultRows(container);
    if (rows.length === 0) return;

    const rowsContainer = getRowsContainer(container);

    // 清理先前可能殘留之 display / flex / order 行內樣式，確保官方原生版型 100% 生效
    if (rowsContainer.style.display || rowsContainer.style.flexDirection) {
      rowsContainer.style.display = '';
      rowsContainer.style.flexDirection = '';
    }
    const htmlContainer = container as HTMLElement;
    if (htmlContainer.style.display || htmlContainer.style.flexDirection) {
      htmlContainer.style.display = '';
      htmlContainer.style.flexDirection = '';
    }
    rows.forEach((row) => {
      if ((row as HTMLElement).style.order) {
        (row as HTMLElement).style.order = '';
      }
    });

    let sortedRows: Element[] = [];

    if (this.sortMode === 'default') {
      const items = rows.map((row) => {
        const id = resolveRowId(row);
        const idx = this.originalOrder.indexOf(id);
        return { row, idx: idx >= 0 ? idx : 999999 };
      });
      items.sort((a, b) => a.idx - b.idx);
      sortedRows = items.map((i) => i.row);
    } else {
      const items = rows.map((row) => {
        const id = resolveRowId(row);
        const stat = this.normalizedMap[id];
        const val = getSortMetric(stat, this.sortMode, id, this.pricePresenter);
        return { row, val };
      });
      items.sort((a, b) => b.val - a.val); // 降序 (數值大者在前)
      sortedRows = items.map((i) => i.row);
    }

    // 檢查 DOM 目前卡片順序是否已完全吻合目標排序 (若已就位則 0 DOM 操作，消除卡頓)
    const currentDomRows = Array.from(rowsContainer.children).filter((c) => rows.includes(c));
    const isAlreadySorted =
      currentDomRows.length === sortedRows.length &&
      sortedRows.every((r, idx) => currentDomRows[idx] === r);
    if (isAlreadySorted) return;

    // 尋找必須永遠維持在裝備卡片後方的節點（如 controls、load-more-btn、滾動加載哨兵）
    const sentinel = Array.from(rowsContainer.children).find((child) => {
      if (rows.includes(child)) return false;
      return (
        child.matches?.('.controls') ||
        child.querySelector?.('.load-more-btn') ||
        child.className?.includes?.('controls') ||
        child.className?.includes?.('load-more')
      );
    });

    this.isReordering = true;
    try {
      sortedRows.forEach((row) => {
        if (sentinel) {
          rowsContainer.insertBefore(row, sentinel);
        } else {
          rowsContainer.appendChild(row);
        }
      });
    } finally {
      this.isReordering = false;
    }
  }

  cleanup() {
    this.restoreOriginalDomOrder();
    this.enabled = false;
    this.isReordering = false;
    this.activeSearchId = undefined;
    this.rawItemsMap = {};
    this.normalizedMap = {};
    this.originalOrder = [];
    removeInjectedElements();
    this.unregisterGlobalClick();
    document.getElementById(INJECTED_STYLE_ID)?.remove();
    document.getElementById('poexd-normalized-stats-style')?.remove();

    const root = document.querySelector('.results') as HTMLElement | null;
    if (root) {
      root.style.display = '';
      root.style.flexDirection = '';
      const rows = resultRows(root);
      const rowsContainer = getRowsContainer(root);
      if (rowsContainer) {
        rowsContainer.style.display = '';
        rowsContainer.style.flexDirection = '';
        Array.from(rowsContainer.children).forEach((child) => {
          (child as HTMLElement).style.order = '';
        });
      }
      rows.forEach((r) => {
        (r as HTMLElement).style.order = '';
      });
    }
  }
}

function getRowsContainer(container: Element): HTMLElement {
  const firstRow = container.querySelector('.row[data-id], .row[id]');
  if (firstRow && firstRow.parentElement && container.contains(firstRow.parentElement)) {
    return firstRow.parentElement as HTMLElement;
  }
  return container as HTMLElement;
}

function resultRows(container: Element): Element[] {
  const rows = Array.from(container.querySelectorAll('.row[data-id], .row[id]')).filter(
    (r) => !r.matches?.('.row-total, .controls'),
  );
  if (
    container.matches?.('.row[data-id], .row[id]') &&
    !container.matches?.('.row-total, .controls')
  ) {
    rows.unshift(container);
  }
  return rows;
}

function resolveRowId(row: Element): string {
  return row.getAttribute('data-id') || row.getAttribute('id') || '';
}

function resolveResultId(
  row: Element,
  map: Record<string, NormalizedItemStats>,
): string | undefined {
  const candidates = [row.getAttribute('data-id'), row.getAttribute('id')];
  return candidates.find((candidate) => candidate && map[candidate]) || undefined;
}

function getFetchSearchId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    return new URL(value, window.location.origin).searchParams.get('query') || undefined;
  } catch {
    return undefined;
  }
}

function removeInjectedElements() {
  if (typeof document === 'undefined') return;
  document
    .querySelectorAll(
      '.poexd-inline-override, .poexd-additional, .poexd-left-badges, .poexd-stat-badges, .poexd-results-toolbar, .poexd-total-controls, .poexd-custom-additional',
    )
    .forEach((el) => el.remove());
}

/**
 * 取得（或建立）圖片欄（`.left`）底部的打孔潛力容器。
 */
function findOrCreateLeftBadgeStrip(row: Element): Element {
  const existing = row.querySelector('.poexd-left-badges');
  if (existing) return existing;

  const target = row.querySelector('.left') || row;
  const created = document.createElement('div');
  created.className = 'poexd-left-badges';
  target.appendChild(created);
  return created;
}

/**
 * 組合懸停詳細試算提示（供圖片下方打孔潛力標籤使用）
 */
function buildItemTooltipLines(stats: NormalizedItemStats): string[] {
  const analysis = stats.socketAnalysis;
  const tooltipLines: string[] = [
    t('normalizer.tooltip.title'),
    t('normalizer.tooltip.slot', {
      slot: slotDisplayName(analysis.slot),
      limit: analysis.defaultLimit,
    }),
    `${t('normalizer.tooltip.socketsCurrent', {
      current: stats.socketsCount,
      filled: stats.filledSocketsCount,
    })}${
      analysis.canAddSockets
        ? t('normalizer.tooltip.canAddSockets', { target: analysis.targetSockets })
        : ''
    }${analysis.isCorrupted ? t('normalizer.tooltip.corrupted') : ''}`,
  ];
  if (analysis.lockedSockets > 0) {
    tooltipLines.push(
      t('normalizer.tooltip.lockedSockets', {
        locked: analysis.lockedSockets,
        overridable: analysis.overridableSockets,
      }),
    );
  }

  if (stats.type === 'weapon') {
    const w = stats as WeaponNormalizedStats;
    tooltipLines.push(
      t('normalizer.tooltip.cleanWeapon', {
        pdps: w.clean.pdps,
        edps: w.clean.edps,
        dps: w.clean.dps,
      }),
    );
    tooltipLines.push(
      t('normalizer.tooltip.potentialWeapon', {
        pdps: w.potential.pdps,
        edps: w.potential.edps,
        dps: w.potential.dps,
        diff: w.potential.diffDps >= 0 ? `+${w.potential.diffDps}` : `${w.potential.diffDps}`,
      }),
    );
  } else {
    const a = stats as ArmourNormalizedStats;
    tooltipLines.push(
      t('normalizer.tooltip.cleanArmour', {
        total: a.clean.totalDefense,
        armour: a.clean.armour,
        evasion: a.clean.evasion,
        es: a.clean.energyShield,
      }),
    );
    tooltipLines.push(
      t('normalizer.tooltip.potentialArmour', {
        total: a.potential.totalDefense,
        diff:
          a.potential.diffTotalDefense >= 0
            ? `+${a.potential.diffTotalDefense}`
            : `${a.potential.diffTotalDefense}`,
      }),
    );
  }
  return tooltipLines;
}

/**
 * 渲染打孔潛力標籤至圖片下方（`.left > .poexd-left-badges`）；已打滿或不可打孔時移除
 */
function renderSocketBadge(row: Element, stats: NormalizedItemStats) {
  const analysis = stats.socketAnalysis;
  row.querySelector('.poexd-stat-badges')?.remove();

  if (!analysis.canAddSockets) {
    row.querySelector('.poexd-left-badges')?.remove();
    return;
  }

  const container = findOrCreateLeftBadgeStrip(row);
  const existing = container.querySelector('[data-field="poexd-sockets"]') as HTMLElement | null;
  const activeLocale = getActiveUiLocale();
  const potVal =
    stats.type === 'weapon'
      ? stats.potential.dps
      : (stats as ArmourNormalizedStats).potential.totalDefense;
  const stateKey = `${stats.socketsCount}-${analysis.targetSockets}-${potVal}`;

  if (
    existing &&
    existing.dataset?.poexdVal === stateKey &&
    existing.dataset?.poexdLocale === activeLocale
  ) {
    return;
  }

  container.querySelectorAll('.poexd-additional').forEach((el) => el.remove());

  const socketSpan = document.createElement('span');
  socketSpan.className = 's lc s poexd-additional poexd-socket-warn';
  socketSpan.setAttribute('data-field', 'poexd-sockets');
  socketSpan.dataset.poexdVal = stateKey;
  socketSpan.dataset.poexdLocale = activeLocale;
  socketSpan.setAttribute('title', buildItemTooltipLines(stats).join('\n'));
  setLabeledValue(
    socketSpan,
    t('normalizer.stat.socketPotential'),
    `${stats.socketsCount}➔${analysis.targetSockets}${t('normalizer.stat.socketsUnit')}`,
    'colourDefault',
  );
  container.appendChild(socketSpan);
}

interface InlineOverrideSpec {
  field: string;
  current: number;
  potential: number;
}

/**
 * 將個別屬性（護甲 / 閃避 / ES / DPS）的符文覆寫預估值直接行內附註於官方 `.itemPopupAdditional` 對應欄位右側，
 * 不新增垂直列數以免遮蓋詞綴；總和與點擊排序按鈕仍集中於底部 `.poexd-stat-badges`。
 */
function renderInlinePopupOverrides(row: Element, stats: NormalizedItemStats) {
  const popupAdditional = row.querySelector('.itemPopupAdditional');
  if (!popupAdditional) return;

  const isWeapon = stats.type === 'weapon';
  const specs: InlineOverrideSpec[] = isWeapon
    ? [
        { field: 'dps', current: stats.current.dps, potential: stats.potential.dps },
        { field: 'pdps', current: stats.current.pdps, potential: stats.potential.pdps },
        { field: 'edps', current: stats.current.edps, potential: stats.potential.edps },
      ]
    : [
        { field: 'ar', current: stats.current.armour, potential: stats.potential.armour },
        { field: 'ev', current: stats.current.evasion, potential: stats.potential.evasion },
        {
          field: 'es',
          current: stats.current.energyShield,
          potential: stats.potential.energyShield,
        },
      ];

  const activeLocale = getActiveUiLocale();
  const titlePrefix = t('normalizer.tooltip.title');
  const labelText = isWeapon ? t('normalizer.stat.overrideDps') : t('normalizer.stat.overrideDef');

  for (const spec of specs) {
    const fieldSpan = popupAdditional.querySelector(`[data-field="${spec.field}"]`);
    if (!fieldSpan) continue;

    const existing = fieldSpan.querySelector('.poexd-inline-override') as HTMLElement | null;
    const isHidden = fieldSpan.classList?.contains('invisible');
    const diff = isWeapon
      ? Math.round((spec.potential - spec.current) * 100) / 100
      : spec.potential - spec.current;

    if (isHidden || spec.potential <= 0 || Math.abs(diff) < 0.01) {
      if (existing) existing.remove();
      continue;
    }

    const targetText = String(spec.potential);
    if (
      existing &&
      existing.dataset?.poexdVal === targetText &&
      existing.dataset?.poexdLocale === activeLocale
    ) {
      continue;
    }

    fieldSpan.querySelectorAll('.poexd-inline-override').forEach((el) => el.remove());

    const diffText = diff >= 0 ? `+${diff}` : `${diff}`;
    const inline = document.createElement('span');
    inline.className = 'poexd-inline-override';
    inline.setAttribute('data-poexd-field', spec.field);
    inline.dataset.poexdVal = targetText;
    inline.dataset.poexdLocale = activeLocale;
    inline.setAttribute('title', `${titlePrefix}\n${labelText}: ${targetText} (${diffText})`);

    const arrow = document.createElement('span');
    arrow.className = 'poexd-inline-arrow';
    arrow.textContent = '➔';

    const value = document.createElement('span');
    value.className = 'poexd-inline-val';
    value.textContent = targetText;

    inline.append(arrow, value);
    fieldSpan.appendChild(inline);
  }
}

function getSortMetric(
  stats: NormalizedItemStats | undefined,
  mode: SortMode,
  id: string,
  pricePresenter?: ResultPricePresenter,
): number {
  if (!stats) return -1;
  let val = 0;
  if (stats.type === 'weapon') {
    switch (mode) {
      case 'potential_dps':
      case 'cp_ratio':
        val = stats.potential.dps;
        break;
      case 'potential_pdps':
        val = stats.potential.pdps;
        break;
      case 'potential_edps':
        val = stats.potential.edps;
        break;
      default:
        val = 0;
        break;
    }
  } else {
    switch (mode) {
      case 'potential_def':
      case 'cp_ratio':
        val = stats.potential.totalDefense;
        break;
      case 'potential_armour':
        val = stats.potential.armour;
        break;
      case 'potential_evasion':
        val = stats.potential.evasion;
        break;
      case 'potential_es':
        val = stats.potential.energyShield;
        break;
      default:
        val = 0;
        break;
    }
  }

  if (mode === 'cp_ratio') {
    const price = pricePresenter?.getPrimaryPrice(id);
    if (typeof price === 'number' && price > 0) {
      return val / price;
    }
    return 0;
  }

  return val;
}

const SLOT_I18N_KEYS: Record<string, I18nKey> = {
  two_hand_weapon: 'normalizer.slot.two_hand_weapon',
  one_hand_weapon: 'normalizer.slot.one_hand_weapon',
  offhand: 'normalizer.slot.offhand',
  body_armour: 'normalizer.slot.body_armour',
  helmet: 'normalizer.slot.helmet',
  gloves: 'normalizer.slot.gloves',
  boots: 'normalizer.slot.boots',
  accessory: 'normalizer.slot.accessory',
};

function slotDisplayName(slot: string): string {
  return t(SLOT_I18N_KEYS[slot] ?? 'normalizer.slot.other');
}

const INJECTED_STYLE_ID = 'poexd-normalized-stats-style-v2';

/**
 * 讀取同一列官方原生 .layout-btn 的實際尺寸與頂端位置，讓 PoeXD 控制組與其同高、同列對齊。
 * 官方未來若調整按鈕幾何，這裡會自動跟上；找不到原生按鈕時沿用 CSS 預設值 (30px / top 0)。
 */
function syncWithNativeLayoutButtons(controls: HTMLElement, rowTotal: Element) {
  const nativeBtn = rowTotal.querySelector<HTMLElement>('.layout-btn');
  if (!nativeBtn) return;
  const size = nativeBtn.offsetHeight;
  if (!Number.isFinite(size) || size < 16 || size > 64) return;
  const top = Number.isFinite(nativeBtn.offsetTop) ? nativeBtn.offsetTop : 0;
  const sizeValue = `${size}px`;
  const topValue = `${top}px`;
  if (controls.style.getPropertyValue('--poexd-native-btn-size') !== sizeValue) {
    controls.style.setProperty('--poexd-native-btn-size', sizeValue);
  }
  if (controls.style.getPropertyValue('--poexd-native-btn-top') !== topValue) {
    controls.style.setProperty('--poexd-native-btn-top', topValue);
  }
}

function ensureInjectedStyle() {
  if (document.getElementById(INJECTED_STYLE_ID)) return;
  // 移除舊版樣式，避免擴充更新後殘留的舊規則干擾
  document.getElementById('poexd-normalized-stats-style')?.remove();
  const style = document.createElement('style');
  style.id = INJECTED_STYLE_ID;
  style.textContent = `
    /*
     * 參照 PoE 官方交易網介面語彙（直角邊框、#141414/#222 暗底、#a38d6d/#e9cf9f 青銅金、
     * #0f304d/#4c4c7d 搜尋按鈕藍與 #8888ff colourAugmented 強化數值色），以 oklch() 撰寫。
     */
    .poexd-total-controls,
    .poexd-left-badges .poexd-additional {
      --poexd-fx-bg: oklch(0.19 0.005 250 / 0.92);
      --poexd-fx-surface: oklch(0.235 0.005 250 / 0.96);
      --poexd-fx-surface-hover: oklch(0.295 0.006 250);
      --poexd-fx-border: oklch(0.387 0 0);
      --poexd-fx-border-strong: oklch(0.52 0.04 76);
      --poexd-fx-fg: oklch(0.913 0 0);
      --poexd-fx-gold: oklch(0.858 0.068 82.8);
      --poexd-fx-muted: oklch(0.67 0.048 76);
      --poexd-fx-label: oklch(0.76 0.028 78);
      --poexd-fx-primary: oklch(0.45 0.075 268);
      --poexd-fx-primary-bg: oklch(0.295 0.062 246 / 0.96);
      --poexd-fx-primary-bg-hover: oklch(0.345 0.075 246);
      --poexd-fx-primary-fg: oklch(0.71 0.145 274);
      --poexd-fx-accent-fg: oklch(0.95 0.025 82);
      --poexd-fx-warn: oklch(0.52 0.075 72);
      --poexd-fx-warn-bg: oklch(0.28 0.045 72 / 0.65);
      --poexd-fx-warn-fg: oklch(0.858 0.068 82.8);
      --poexd-fx-radius: 0px;
      --poexd-fx-font: Verdana, Arial, Helvetica, sans-serif;
      --poexd-fx-font-display: FontinSmallcaps, Verdana, Arial, Helvetica, sans-serif;
    }

    /* PoeXD 官方 row-total 左側控制組：鏡像原生 .layout-btn 的尺寸、8px 間距與頂端定位 */
    .poexd-total-controls {
      --poexd-native-btn-size: 30px;
      --poexd-native-btn-top: 0px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      z-index: 50;
      margin: 0 12px 0 0;
      flex-shrink: 0;
      font-family: var(--poexd-fx-font);
      line-height: 1;
    }
    .row.row-total > .poexd-total-controls {
      position: absolute;
      top: var(--poexd-native-btn-top);
      left: 8px;
      height: var(--poexd-native-btn-size);
      margin: 0;
    }
    .poexd-total-controls .poexd-btn-wrapper {
      position: relative;
      display: inline-flex;
      align-items: center;
      height: 100%;
    }
    .poexd-total-controls .poexd-icon-btn {
      all: unset;
      box-sizing: border-box;
      width: var(--poexd-native-btn-size);
      height: var(--poexd-native-btn-size);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: var(--poexd-fx-bg);
      border: 1px solid oklch(0.35 0.018 76 / 0.85);
      border-radius: var(--poexd-fx-radius);
      color: var(--poexd-fx-muted);
      cursor: pointer;
      box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.05);
      transition:
        background-color 0.12s ease,
        border-color 0.12s ease,
        color 0.12s ease;
    }
    .poexd-total-controls .poexd-icon-btn:hover {
      background: var(--poexd-fx-surface-hover);
      border-color: var(--poexd-fx-border-strong);
      color: var(--poexd-fx-gold);
    }
    .poexd-total-controls .poexd-icon-btn:focus-visible {
      outline: 1px solid var(--poexd-fx-gold);
      outline-offset: 1px;
    }
    .poexd-total-controls .poexd-icon-btn.poexd-active {
      background: var(--poexd-fx-primary-bg);
      border-color: var(--poexd-fx-primary);
      color: var(--poexd-fx-gold);
    }
    .poexd-total-controls .poexd-icon-btn.poexd-active:hover {
      background: var(--poexd-fx-primary-bg-hover);
      border-color: oklch(0.58 0.085 268);
      color: var(--poexd-fx-accent-fg);
    }
    .poexd-total-controls .poexd-icon-btn svg {
      width: 15px;
      height: 15px;
      pointer-events: none;
    }
    .poexd-total-controls .poexd-popover {
      display: none;
      position: absolute;
      top: calc(100% + 4px);
      left: 0;
      min-width: 220px;
      box-sizing: border-box;
      background: oklch(0.175 0.005 250 / 0.98);
      border: 1px solid var(--poexd-fx-border);
      border-radius: var(--poexd-fx-radius);
      padding: 3px;
      box-shadow: 0 8px 22px oklch(0 0 0 / 0.72);
      z-index: 99999;
      font-family: var(--poexd-fx-font);
      text-align: left;
    }
    .poexd-total-controls .poexd-popover.poexd-open {
      display: block;
    }
    .poexd-total-controls .poexd-popover-header {
      margin: 0 -3px 3px;
      padding: 5px 10px;
      font-family: var(--poexd-fx-font-display);
      font-size: 11px;
      font-weight: 400;
      line-height: 1.3;
      color: var(--poexd-fx-muted);
      border-bottom: 1px solid oklch(0.32 0.012 76 / 0.7);
      letter-spacing: 0.04em;
    }
    .poexd-total-controls .poexd-popover-item {
      padding: 5px 8px;
      border-radius: var(--poexd-fx-radius);
      font-size: 12px;
      line-height: 1.4;
      color: var(--poexd-fx-fg);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      transition:
        background-color 0.12s ease,
        color 0.12s ease;
      user-select: none;
      white-space: nowrap;
    }
    .poexd-total-controls .poexd-popover-item:hover {
      background: var(--poexd-fx-primary-bg);
      color: var(--poexd-fx-accent-fg);
    }
    .poexd-total-controls .poexd-popover-item.poexd-selected {
      color: var(--poexd-fx-gold);
      font-weight: 600;
    }
    .poexd-total-controls .poexd-check-mark {
      font-size: 12px;
      color: var(--poexd-fx-gold);
      font-weight: 700;
      margin-left: 12px;
    }

    /* 圖片下方（.left）的打孔潛力標籤列：置中排版於物品圖示下方 */
    .poexd-left-badges {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      align-items: center;
      gap: 4px;
      margin-top: 4px;
      width: 100%;
    }
    .poexd-left-badges:empty {
      display: none;
    }

    /* PoeXD 打孔標籤：比照官方 .btn-xs / 詞綴面板風格 */
    .poexd-left-badges .poexd-additional {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      box-sizing: border-box;
      height: 20px;
      margin: 0;
      padding: 0 7px;
      background: var(--poexd-fx-surface);
      border: 1px solid var(--poexd-fx-border);
      border-radius: var(--poexd-fx-radius);
      color: var(--poexd-fx-label);
      font-family: var(--poexd-fx-font);
      font-size: 11.5px;
      font-style: normal;
      font-weight: 400;
      line-height: 18px;
      letter-spacing: 0;
      text-transform: none;
      text-decoration: none !important;
      vertical-align: middle;
      white-space: nowrap;
      cursor: default;
      box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.05);
      transition:
        background-color 0.12s ease,
        border-color 0.12s ease,
        color 0.12s ease;
    }
    .poexd-left-badges .poexd-additional.poexd-socket-warn {
      border-color: oklch(0.47 0.068 72);
    }
    .poexd-left-badges .poexd-additional.poexd-socket-warn:hover {
      background: var(--poexd-fx-warn-bg);
      border-color: var(--poexd-fx-warn);
      color: var(--poexd-fx-fg);
    }
    .poexd-left-badges .poexd-additional.poexd-socket-warn .colourDefault {
      color: var(--poexd-fx-warn-fg) !important;
      font-weight: 700;
      margin-left: 2px;
    }

    /* 官方 .itemPopupAdditional 行內符文覆寫附註：移除官方 span::before 冒號，並依版型區分浮層與橫列排版 */
    .results .row .middle .itemPopupAdditional .s .poexd-inline-override::before,
    .results .row .middle .itemPopupAdditional .s .poexd-inline-override *::before {
      content: none !important;
    }
    .results .row .middle .itemPopupAdditional .poexd-inline-override {
      display: inline-flex;
      align-items: baseline;
      gap: 2px;
      margin-left: 4px;
      font-size: 0.92em;
      font-weight: 700;
      color: oklch(0.71 0.145 274);
      white-space: nowrap;
    }
    .results .row .middle .itemPopupAdditional .poexd-inline-arrow {
      font-size: 0.85em;
      opacity: 0.85;
    }

    /* Compact / Compact Two 版型（右上角浮層）：維持原有垂直行數，依內容向右對齊展開 */
    .results.compact .row .middle .itemPopupAdditional:has(.poexd-inline-override) {
      width: max-content;
      max-width: min(260px, 68%);
      align-items: flex-end;
    }
    .results.compact .row .middle .itemPopupAdditional > .s:has(.poexd-inline-override) {
      display: inline-flex;
      align-items: baseline;
      justify-content: flex-end;
      flex-wrap: nowrap;
      width: auto;
      white-space: nowrap;
    }

    /* Default 版型（下方橫列）：保留全寬橫列，讓含覆寫的欄位依內容擴展寬度避免相鄰重疊 */
    .results:not(.compact) .row .middle .itemPopupAdditional:has(.poexd-inline-override) {
      flex-wrap: wrap;
      gap: 4px 6px;
    }
    .results:not(.compact) .row .middle .itemPopupAdditional > .s:has(.poexd-inline-override) {
      flex: 0 1 auto;
      min-width: 20%;
      width: auto;
      padding: 0 6px;
      white-space: nowrap;
    }
  `;
  document.head.appendChild(style);
}
