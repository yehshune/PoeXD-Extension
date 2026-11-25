/**
 * PoE 2 符文標準化與打孔潛力內部 adapter。
 *
 * 物品原始資料直接讀取共用 `TradeResultCache`，不再維護私密 `rawItemsMap` 或雙向註冊排序控制器。
 */
import { getActiveUiLocale, t, type I18nKey } from '@/utils/i18n';
import {
  DEFAULT_RUNE_CONFIG,
  createResultNormalizedItems,
  normalizePoe2Item,
  type ArmourNormalizedStats,
  type ArmourRuneConfig,
  type NormalizedItemStats,
  type RawPoeItem,
  type RuneSubstitutionConfig,
  type WeaponNormalizedStats,
  type WeaponRuneConfig,
} from '@/utils/poe2-item-normalizer';
import { setLabeledValue, type SvgIconSpec } from '@/utils/safe-dom';
import type { PoeVersion } from '@/utils/trade-context';
import type { TradeResultCache } from '@/utils/trade-result-cache';
import { TRADE_RESULTS_SELECTOR } from '@/utils/trade-results-root';
import type { ResultFetchBatch } from './result-enhancement-host-port';
import {
  ensureResultEnhancementStyle,
  removeResultEnhancementStyle,
} from './result-enhancement-styles';
import { collectResultRows, resolveMappedRowId } from './result-left-actions';
import type { SortExtraControl, SortMode } from './result-sort-controller';

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

export class ResultItemNormalizerAdapter {
  private enabled = true;
  private scopeActive = true;
  private activeSearchId?: string;
  private normalizedMap: Record<string, NormalizedItemStats> = {};
  private runeConfig: RuneSubstitutionConfig = { ...DEFAULT_RUNE_CONFIG };

  constructor(
    private readonly version: PoeVersion,
    private readonly doc: Document,
    private readonly cache: TradeResultCache,
    private readonly onMetricsChanged: () => void,
    private readonly isReordering: () => boolean,
  ) {}

  isActive(): boolean {
    return this.version === 'poe2' && this.enabled && this.scopeActive;
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

  onFetchBatch(batch: ResultFetchBatch): void {
    if (!this.scopeActive || this.version !== 'poe2') return;

    if (batch.isNewSearch || batch.searchId !== this.activeSearchId) {
      this.activeSearchId = batch.searchId;
      this.normalizedMap = {};
      this.removeInjectedElements();
    }

    const itemsMap = createResultNormalizedItems([...batch.results], this.runeConfig);
    Object.assign(this.normalizedMap, itemsMap);

    const root = this.doc.querySelector(TRADE_RESULTS_SELECTOR);
    if (root && this.isActive()) {
      this.renderOnContainer(root);
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!this.isActive()) {
      this.removeInjectedElements();
    } else {
      const root = this.doc.querySelector(TRADE_RESULTS_SELECTOR);
      if (root) this.renderOnContainer(root);
    }
  }

  onScopeActiveChange(active: boolean): void {
    if (active === this.scopeActive) return;
    this.scopeActive = active;
    if (!active) {
      this.resetState();
    }
  }

  setRuneConfig(config: Partial<RuneSubstitutionConfig>): void {
    if (this.version !== 'poe2') return;
    this.runeConfig = { ...this.runeConfig, ...config };
    this.normalizedMap = {};
    const entries = this.activeSearchId ? this.cache.entriesForSearch(this.activeSearchId) : [];
    for (const entry of entries) {
      const stats = normalizePoe2Item(entry.item as RawPoeItem, this.runeConfig);
      if (stats) this.normalizedMap[entry.id] = stats;
    }
    const root = this.doc.querySelector(TRADE_RESULTS_SELECTOR);
    if (root && this.isActive()) {
      this.renderOnContainer(root);
    }
    this.onMetricsChanged();
  }

  apply(container: Element): void {
    if (this.isActive() && !this.isReordering()) {
      this.renderOnContainer(container);
    } else if (!this.scopeActive) {
      this.removeInjectedElements();
    }
  }

  applyBatch(rows: Element[]): void {
    if (rows.length === 0) return;
    if (this.isActive() && !this.isReordering()) {
      this.applyPoe2RowEnhancements(rows);
      ensureResultEnhancementStyle('item-normalizer', this.doc);
    } else if (!this.scopeActive) {
      this.removeInjectedElements();
    }
  }

  refreshLocale(): void {
    if (this.isActive()) {
      const root = this.doc.querySelector(TRADE_RESULTS_SELECTOR);
      if (root) this.renderOnContainer(root);
    }
  }

  cleanup(): void {
    this.enabled = false;
    this.resetState();
    removeResultEnhancementStyle('item-normalizer', this.doc);
  }

  private resetState(): void {
    this.activeSearchId = undefined;
    this.normalizedMap = {};
    this.removeInjectedElements();
  }

  private removeInjectedElements(): void {
    this.doc
      .querySelectorAll(
        '.poexd-inline-override, .poexd-additional, .poexd-left-badges, .poexd-stat-badges, .poexd-custom-additional',
      )
      .forEach((el) => el.remove());
  }

  private renderOnContainer(container: Element): void {
    this.applyPoe2RowEnhancements(collectResultRows(container));
    ensureResultEnhancementStyle('item-normalizer', this.doc);
  }

  private applyPoe2RowEnhancements(rows: Element[]): void {
    for (const row of rows) {
      const resultId = resolveMappedRowId(row, this.normalizedMap);
      if (!resultId) continue;
      const stats = this.normalizedMap[resultId];
      if (!stats) continue;

      renderInlinePopupOverrides(this.doc, row, stats);
      renderSocketBadge(this.doc, row, stats);
    }
  }
}

function findOrCreateLeftBadgeStrip(doc: Document, row: Element): Element {
  const existing = row.querySelector('.poexd-left-badges');
  if (existing) return existing;

  const target = row.querySelector('.left') || row;
  const created = doc.createElement('div');
  created.className = 'poexd-left-badges';
  target.appendChild(created);
  return created;
}

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

function readDisplayedPopupNumber(fieldSpan: Element): number | null {
  const valueNode = fieldSpan.querySelector('.colourAugmented, .colourDefault');
  const rawText = valueNode?.textContent?.trim();
  if (!rawText) return null;
  const parsed = Number.parseFloat(rawText);
  return Number.isFinite(parsed) ? parsed : null;
}

function renderSocketBadge(doc: Document, row: Element, stats: NormalizedItemStats): void {
  const analysis = stats.socketAnalysis;
  row.querySelector('.poexd-stat-badges')?.remove();

  if (!analysis.canAddSockets) {
    row.querySelector('.poexd-left-badges')?.remove();
    return;
  }

  const container = findOrCreateLeftBadgeStrip(doc, row);
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

  const socketSpan = doc.createElement('span');
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
    doc,
  );
  container.appendChild(socketSpan);
}

interface InlineOverrideSpec {
  field: string;
  current: number;
  potential: number;
}

function renderInlinePopupOverrides(doc: Document, row: Element, stats: NormalizedItemStats): void {
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
    const inline = doc.createElement('span');
    inline.className = 'poexd-inline-override';
    inline.setAttribute('data-poexd-field', spec.field);
    inline.dataset.poexdVal = targetText;
    inline.dataset.poexdLocale = activeLocale;
    inline.setAttribute('title', `${titlePrefix}\n${labelText}: ${targetText} (${diffText})`);

    const arrow = doc.createElement('span');
    arrow.className = 'poexd-inline-arrow';
    arrow.textContent = '➔';

    const value = doc.createElement('span');
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
