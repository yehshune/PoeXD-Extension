import { setLabeledValue, type SvgIconSpec } from '@/utils/safe-dom';
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
import {
  getTradePageMode,
  isLiveOrConsoleTradePage,
  type TradePageMode,
} from '@/utils/trade-page-mode';
import type { TradePageRole } from '@/utils/live-search-contract';
import { parsePoeFetchResultBatch } from '@/utils/event-contracts';
import {
  getResultsRoot,
  ResultSortController,
  resultRows,
  type SortExtraControl,
  type SortMode,
  type SortStatProvider,
} from './result-sort-controller';
import { t, getActiveUiLocale, type I18nKey } from '@/utils/i18n';

export type { SortMode } from './result-sort-controller';

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

export class ResultItemNormalizer implements SortStatProvider {
  private enabled = true;
  private pageMode: TradePageMode = typeof window !== 'undefined' ? getTradePageMode() : 'search';
  private pageRole: TradePageRole = 'normal';
  private activeSearchId?: string;
  private rawItemsMap: Record<string, RawPoeItem> = {};
  private normalizedMap: Record<string, NormalizedItemStats> = {};
  private runeConfig: RuneSubstitutionConfig = { ...DEFAULT_RUNE_CONFIG };

  constructor(
    private readonly version: PoeVersion,
    private readonly sortController?: ResultSortController,
  ) {
    this.sortController?.registerStatProvider(this);
  }

  public isLiveOrConsole(): boolean {
    return isLiveOrConsoleTradePage(this.pageMode, this.pageRole);
  }

  isActive(): boolean {
    return this.version === 'poe2' && this.enabled && !this.isLiveOrConsole();
  }

  getSortMetric(mode: SortMode, id: string): number | undefined {
    return getSortMetric(this.normalizedMap[id], mode);
  }

  getLeadingControls(): SortExtraControl[] {
    return [
      {
        type: 'weapon',
        getIcon: () => SWORD_SVG,
        getTitle: () => t('normalizer.btn.weaponTitle'),
        getHeader: () => t('normalizer.btn.weaponHeader'),
        getOptions: () =>
          getWeaponRuneOptions().map((opt) => ({
            key: opt.key,
            label: opt.label,
            onSelect: () => this.setRuneConfig({ weaponRune: opt.config }),
          })),
        getState: () => {
          const currentKey = getWeaponRuneKey(this.runeConfig.weaponRune);
          const options = getWeaponRuneOptions();
          const currentOpt = options.find((o) => o.key === currentKey);
          return {
            currentKey,
            titleText: t('normalizer.activeWeaponRune', { label: currentOpt?.label || '' }),
            headerText: t('normalizer.btn.weaponHeader'),
            isActive: currentKey !== 'none',
          };
        },
      },
      {
        type: 'armour',
        getIcon: () => SHIELD_SVG,
        getTitle: () => t('normalizer.btn.armourTitle'),
        getHeader: () => t('normalizer.btn.armourHeader'),
        getOptions: () =>
          getArmourRuneOptions().map((opt) => ({
            key: opt.key,
            label: opt.label,
            onSelect: () => this.setRuneConfig({ armourRune: opt.config }),
          })),
        getState: () => {
          const currentKey = getArmourRuneKey(this.runeConfig.armourRune);
          const options = getArmourRuneOptions();
          const currentOpt = options.find((o) => o.key === currentKey);
          return {
            currentKey,
            titleText: t('normalizer.activeArmourRune', { label: currentOpt?.label || '' }),
            headerText: t('normalizer.btn.armourHeader'),
            isActive: currentKey !== 'none',
          };
        },
      },
    ];
  }

  async handleFetchResponse(detail: string) {
    if (this.isLiveOrConsole() || this.version !== 'poe2') return;

    const batch = parsePoeFetchResultBatch(detail);
    if (!batch?.searchId) return;
    const { searchId, results } = batch;

    if (searchId !== this.activeSearchId) {
      this.activeSearchId = searchId;
      this.rawItemsMap = {};
      this.normalizedMap = {};
      removeNormalizerInjectedElements();
    }

    results.forEach((res) => {
      if (!res || typeof res !== 'object') return;
      const { id, item } = res as { id?: string; item?: RawPoeItem };
      if (typeof id === 'string' && item) {
        this.rawItemsMap[id] = item;
      }
    });

    const itemsMap = createResultNormalizedItems(results, this.runeConfig);
    Object.assign(this.normalizedMap, itemsMap);

    const root = getResultsRoot();
    if (root && this.isActive()) {
      this.renderOnContainer(root);
    }
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!this.isActive()) {
      removeNormalizerInjectedElements();
    } else {
      const root = getResultsRoot();
      if (root) this.renderOnContainer(root);
    }
  }

  setPageRole(role: TradePageRole) {
    if (role !== this.pageRole) {
      this.pageRole = role;
      if (this.isLiveOrConsole()) {
        this.resetState();
      }
    }
  }

  setPageMode(mode: TradePageMode) {
    if (mode !== this.pageMode) {
      this.pageMode = mode;
      if (this.isLiveOrConsole()) {
        this.resetState();
      }
    }
  }

  setRuneConfig(config: Partial<RuneSubstitutionConfig>) {
    if (this.version !== 'poe2') return;
    this.runeConfig = { ...this.runeConfig, ...config };
    for (const [id, raw] of Object.entries(this.rawItemsMap)) {
      const stats = normalizePoe2Item(raw, this.runeConfig);
      if (stats) this.normalizedMap[id] = stats;
    }
    const root = getResultsRoot();
    if (root && this.isActive()) {
      this.renderOnContainer(root);
    }
    this.sortController?.onMetricsChanged();
  }

  apply(container: Element) {
    if (this.isActive() && !this.sortController?.isReordering) {
      this.renderOnContainer(container);
    } else if (this.isLiveOrConsole()) {
      removeNormalizerInjectedElements();
    }
  }

  applyBatch(rows: Element[]) {
    if (rows.length === 0) return;
    if (this.isActive() && !this.sortController?.isReordering) {
      this.applyPoe2RowEnhancements(rows);
      ensureInjectedStyle();
    } else if (this.isLiveOrConsole()) {
      removeNormalizerInjectedElements();
    }
  }

  refreshLocale() {
    if (this.isActive()) {
      const root = getResultsRoot();
      if (root) {
        this.renderOnContainer(root);
      }
    }
  }

  cleanup() {
    this.enabled = false;
    this.resetState();
    document.getElementById(INJECTED_STYLE_ID)?.remove();
    document.getElementById('poexd-normalized-stats-style')?.remove();
  }

  private resetState() {
    this.activeSearchId = undefined;
    this.rawItemsMap = {};
    this.normalizedMap = {};
    removeNormalizerInjectedElements();
  }

  private renderOnContainer(container: Element) {
    this.applyPoe2RowEnhancements(resultRows(container));
    ensureInjectedStyle();
  }

  private applyPoe2RowEnhancements(rows: Element[]) {
    for (const row of rows) {
      const resultId = resolveResultId(row, this.normalizedMap);
      if (!resultId) continue;
      const stats = this.normalizedMap[resultId];
      if (!stats) continue;

      renderInlinePopupOverrides(row, stats);
      renderSocketBadge(row, stats);
    }
  }
}

function resolveResultId(
  row: Element,
  map: Record<string, NormalizedItemStats>,
): string | undefined {
  const candidates = [row.getAttribute('data-id'), row.getAttribute('id')];
  return candidates.find((candidate) => candidate && map[candidate]) || undefined;
}

function removeNormalizerInjectedElements() {
  if (typeof document === 'undefined') return;
  document
    .querySelectorAll(
      '.poexd-inline-override, .poexd-additional, .poexd-left-badges, .poexd-stat-badges, .poexd-custom-additional',
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

function isCachedBadgeState(
  existing: HTMLElement | null,
  expectedVal: string,
  locale: string,
): boolean {
  return Boolean(
    existing &&
    existing.dataset?.poexdVal === expectedVal &&
    existing.dataset?.poexdLocale === locale,
  );
}

/**
 * 讀取官方 `.itemPopupAdditional [data-field]` 目前顯示的數值（排除 PoeXD 插入節點）
 */
function readDisplayedPopupNumber(fieldSpan: Element): number | null {
  const valueNode = fieldSpan.querySelector('.colourAugmented, .colourDefault');
  const rawText = valueNode?.textContent?.trim();
  if (!rawText) return null;
  const parsed = Number.parseFloat(rawText);
  return Number.isFinite(parsed) ? parsed : null;
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

  if (isCachedBadgeState(existing, stateKey, activeLocale)) {
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
 * 不新增垂直列數以免遮蓋詞綴；排序由 `ResultSortController` 控制，打孔潛力則獨立顯示於圖片下方。
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
    const displayedVal = readDisplayedPopupNumber(fieldSpan);
    const baseline = displayedVal ?? spec.current;
    const diff = isWeapon
      ? Math.round((spec.potential - baseline) * 100) / 100
      : spec.potential - baseline;

    if (isHidden || spec.potential <= 0 || Math.abs(diff) < 0.01) {
      if (existing) existing.remove();
      continue;
    }

    const targetText = String(spec.potential);
    if (isCachedBadgeState(existing, targetText, activeLocale)) {
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

function getSortMetric(stats: NormalizedItemStats | undefined, mode: SortMode): number | undefined {
  if (!stats) return undefined;
  if (stats.type === 'weapon') {
    switch (mode) {
      case 'potential_dps':
      case 'cp_ratio':
        return stats.potential.dps;
      case 'potential_pdps':
        return stats.potential.pdps;
      case 'potential_edps':
        return stats.potential.edps;
      default:
        return 0;
    }
  }
  switch (mode) {
    case 'potential_def':
    case 'cp_ratio':
      return stats.potential.totalDefense;
    case 'potential_armour':
      return stats.potential.armour;
    case 'potential_evasion':
      return stats.potential.evasion;
    case 'potential_es':
      return stats.potential.energyShield;
    default:
      return 0;
  }
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

function ensureInjectedStyle() {
  if (typeof document === 'undefined' || document.getElementById(INJECTED_STYLE_ID)) return;
  document.getElementById('poexd-normalized-stats-style')?.remove();
  const style = document.createElement('style');
  style.id = INJECTED_STYLE_ID;
  style.textContent = `
    .poexd-left-badges .poexd-additional {
      --poexd-fx-surface: oklch(0.235 0.005 250 / 0.96);
      --poexd-fx-border: oklch(0.387 0 0);
      --poexd-fx-fg: oklch(0.913 0 0);
      --poexd-fx-label: oklch(0.76 0.028 78);
      --poexd-fx-warn: oklch(0.52 0.075 72);
      --poexd-fx-warn-bg: oklch(0.28 0.045 72 / 0.65);
      --poexd-fx-warn-fg: oklch(0.858 0.068 82.8);
      --poexd-fx-radius: 0px;
      --poexd-fx-font: Verdana, Arial, Helvetica, sans-serif;
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
