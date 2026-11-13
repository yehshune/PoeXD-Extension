import { createSvgIcon } from '@/utils/safe-dom';
import {
  HOST_TIER_TRIGGER_SPEC,
  HOST_FILTER_SELECT_BUTTON_SPEC,
  HOST_CATEGORY_BUTTON_SPEC,
} from '@/lib/tokens';
import {
  syncTierSlots,
  upsertTierSlot,
  clearTierSlots,
  type TierDropdownItemSpec,
  type TierSlotDescriptor,
} from '@/utils/tier-slot-registry';
import { type PoeVersion } from '@/utils/trade-context';
import { getTradeMapping } from '@/components/sidebar/mapping-registry';
import { dispatchPoeEvent } from '@/utils/event-contracts';
import { extensionMessaging } from '@/utils/extension-protocol';
import { stripLiveSuffix } from '@/utils/trade-search-identity';
import { decodeTradeSearchUrl, extractQueryMetadata } from '@/utils/trade-url-codec';
import { loadTradeDictionaries } from '@/utils/trade-stat-dictionary';
import { resolveSingleEnqueueToast } from '@/components/sidebar/live-search-presentation';
import { syncFormToUrl } from './form-url-sync';
import { type TierDomainService } from './tier-domain-service';
import { t } from '@/utils/i18n';

/**
 * 「類別過濾」群組標題：國際服英文、台服，以及市集漢化（ADR-0012）改寫後的繁中／簡中
 * （與 public/json/<ver>/locales/<locale>/trade-filters.json 的 type_filters 相同）
 */
const TYPE_FILTERS_TITLES = ['Type Filters', '類別過濾', '类型过滤器'] as const;

export interface InjectedControlsOptions {
  version: PoeVersion;
  tierDomainService: TierDomainService;
  isCurrentGeneration: (generation: number) => boolean;
  getCurrentGeneration?: () => number;
}

export interface InjectedControls {
  injectCustomStyles(): void;
  updatePureBackgroundClass(enable: boolean): void;
  injectFilterGroupButtons(): void;
  cleanFilterGroupButtons(): void;
  injectSendToConsoleButton(): void;
  cleanSendToConsoleButtons(): void;
  injectTierSelectorButtons(generation: number): Promise<void>;
  refreshTierSlotDomain(slotKey: string): Promise<boolean>;
  removeTierSlotArtifacts(slotEl: HTMLElement | null | undefined): void;
  cleanAllTierSlotArtifacts(): void;
  updateInjectedControlsLocale(): void;
}

export function injectCustomStyles(): void {
  let styleEl = document.getElementById('poexd-custom-style') as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'poexd-custom-style';
    (document.head || document.documentElement).appendChild(styleEl);
  }
  styleEl.textContent = `
    .logo a { max-width: 100px !important; height: auto !important; }
    body.poexd-pure-bg { background-image: none !important; background-color: #060607 !important; }
    .filter .input-group-btn { cursor: grab !important; }
    .filter .input-group-btn:active { cursor: grabbing !important; }

    .poexd-inline-btn {
      background-color: transparent !important;
      border: 1px solid transparent !important;
      color: var(--muted-foreground) !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      cursor: pointer !important;
      transition: color 0.15s, background-color 0.15s, border-color 0.15s !important;
      border-radius: 0 !important;
      box-sizing: border-box !important;
      vertical-align: middle !important;
    }
    .poexd-inline-btn:hover {
      color: var(--accent-foreground) !important;
      background-color: var(--accent) !important;
    }
    .poexd-inline-btn:focus,
    .poexd-inline-btn:focus-visible {
      outline: none !important;
      box-shadow: 0 0 0 2px var(--ring) !important;
    }

    .poexd-filter-select-btn {
      width: ${HOST_FILTER_SELECT_BUTTON_SPEC.sizePx}px !important;
      height: ${HOST_FILTER_SELECT_BUTTON_SPEC.sizePx}px !important;
      padding: 0 !important;
      margin: 0 !important;
    }
    .poexd-filter-select-btn svg {
      width: ${HOST_FILTER_SELECT_BUTTON_SPEC.iconSizePx}px !important;
      height: ${HOST_FILTER_SELECT_BUTTON_SPEC.iconSizePx}px !important;
    }

    .poexd-tier-trigger-slot {
      display: table-cell !important;
      position: relative !important;
      vertical-align: middle !important;
      white-space: nowrap !important;
      width: ${HOST_TIER_TRIGGER_SPEC.widthPx}px !important;
    }

    .poexd-tier-trigger {
      position: absolute !important;
      inset: 0 !important;
      width: auto !important;
      height: auto !important;
      background-color: var(--secondary) !important;
      border: 1px solid var(--border) !important;
      color: var(--secondary-foreground) !important;
      padding: 0 ${HOST_TIER_TRIGGER_SPEC.paddingXPx}px !important;
      cursor: pointer !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      font-size: ${HOST_TIER_TRIGGER_SPEC.fontPx}px !important;
      line-height: ${HOST_TIER_TRIGGER_SPEC.lineHeightPx}px !important;
      font-weight: ${HOST_TIER_TRIGGER_SPEC.fontWeight} !important;
      box-sizing: border-box !important;
      flex-shrink: 0 !important;
      border-radius: 0 !important;
      box-shadow: var(--shadow-sm) !important;
      transition: color 0.15s, background-color 0.15s, border-color 0.15s, box-shadow 0.15s !important;
    }
    .poexd-tier-trigger:hover {
      border-color: var(--border) !important;
      color: var(--accent-foreground) !important;
      background-color: var(--accent) !important;
    }
    .poexd-tier-trigger:focus,
    .poexd-tier-trigger:focus-visible {
      outline: none !important;
      box-shadow: 0 0 0 2px var(--ring) !important;
    }

    .poexd-category-select-btn {
      background-color: var(--secondary) !important;
      color: var(--secondary-foreground) !important;
      border: 1px solid var(--border) !important;
      box-shadow: var(--shadow-sm) !important;
      padding: ${HOST_CATEGORY_BUTTON_SPEC.paddingYPx}px ${HOST_CATEGORY_BUTTON_SPEC.paddingXPx}px !important;
      margin-left: ${HOST_CATEGORY_BUTTON_SPEC.marginLeftPx}px !important;
      font-size: ${HOST_CATEGORY_BUTTON_SPEC.fontPx}px !important;
      height: ${HOST_CATEGORY_BUTTON_SPEC.heightPx}px !important;
      line-height: ${HOST_CATEGORY_BUTTON_SPEC.lineHeightPx}px !important;
      display: inline-flex !important;
      align-items: center !important;
      vertical-align: middle !important;
      cursor: pointer !important;
      transition: color 0.15s, background-color 0.15s, border-color 0.15s !important;
    }
    .poexd-category-select-btn:hover {
      background-color: var(--accent) !important;
      color: var(--accent-foreground) !important;
      border-color: var(--border) !important;
    }
    .poexd-category-select-btn:focus,
    .poexd-category-select-btn:focus-visible {
      outline: none !important;
      box-shadow: 0 0 0 2px var(--ring) !important;
    }

    .poexd-send-to-console-btn {
      background-color: var(--secondary) !important;
      color: var(--secondary-foreground) !important;
      border: 1px solid var(--border) !important;
      box-shadow: var(--shadow-sm) !important;
      padding: ${HOST_CATEGORY_BUTTON_SPEC.paddingYPx}px ${HOST_CATEGORY_BUTTON_SPEC.paddingXPx}px !important;
      margin-left: ${HOST_CATEGORY_BUTTON_SPEC.marginLeftPx}px !important;
      font-size: ${HOST_CATEGORY_BUTTON_SPEC.fontPx}px !important;
      height: ${HOST_CATEGORY_BUTTON_SPEC.heightPx}px !important;
      line-height: ${HOST_CATEGORY_BUTTON_SPEC.lineHeightPx}px !important;
      display: inline-flex !important;
      align-items: center !important;
      vertical-align: middle !important;
      cursor: pointer !important;
      transition: color 0.15s, background-color 0.15s, border-color 0.15s !important;
    }
    .poexd-send-to-console-btn:hover:not(:disabled) {
      background-color: var(--accent) !important;
      color: var(--accent-foreground) !important;
      border-color: var(--border) !important;
    }
    .poexd-send-to-console-btn:disabled {
      opacity: 0.6 !important;
      cursor: wait !important;
    }

    .poexd-sortable-ghost {
      opacity: 0.35 !important;
      border: 1px dashed var(--primary) !important;
      background-color: var(--accent) !important;
    }
    .poexd-sortable-drag {
      background-color: var(--popover) !important;
      color: var(--popover-foreground) !important;
      box-shadow: var(--shadow-md) !important;
      border: 1px solid var(--border) !important;
      border-radius: var(--radius) !important;
    }
  `;
}

export function updatePureBackgroundClass(enable: boolean): void {
  const body = document.body;
  if (!body) {
    setTimeout(() => updatePureBackgroundClass(enable), 50);
    return;
  }
  if (enable) {
    body.classList.add('poexd-pure-bg');
  } else {
    body.classList.remove('poexd-pure-bg');
  }
}

export function removeTierSlotArtifacts(slotEl: HTMLElement | null | undefined): void {
  if (!slotEl) return;
  const slotKey = slotEl.getAttribute('data-poexd-slot-key');
  const parent = slotEl.parentElement || slotEl.parentNode;
  if (parent && slotKey) {
    const boundSeps = parent.querySelectorAll(`[data-poexd-tier-sep="${slotKey}"]`);
    boundSeps.forEach((sep) => sep.remove());
  }
  slotEl.remove();
}

export function cleanAllTierSlotArtifacts(): void {
  document.querySelectorAll<HTMLElement>('.poexd-tier-trigger-slot').forEach((slotEl) => {
    removeTierSlotArtifacts(slotEl);
  });
  document.querySelectorAll<HTMLElement>('[data-poexd-tier-sep]').forEach((sepEl) => {
    sepEl.remove();
  });
  clearTierSlots();
}

type FilterGroupButtonMode = 'affix' | 'mercenary' | 'mercenary-condition';

const MERCENARY_GROUP_TYPE = 'mercenary';
/** 可以放傭兵技能的一般條件群組（weight 需逐條填權重，不提供）。 */
const MERCENARY_CONDITION_GROUP_TYPES: ReadonlySet<string> = new Set(['and', 'not', 'count', 'if']);
const FILTER_ICON_PATH =
  'M4.25 5.61C6.27 8.2 10 13 10 13v6c0 .55.45 1 1 1h2c.55 0 1-.45 1-1v-6s3.72-4.8 5.74-7.39A.998.998 0 0 0 19 4H5c-.78 0-1.23.89-.75 1.61z';
const MERCENARY_ICON_PATH =
  'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z';

/**
 * 官方「傭兵技能群組」只能加入傭兵技能，一般詞綴選擇器對它沒有用。
 * 優先使用 Main World 依 Vuex 標記的群組類型；尚未標記時，以群組內只出現傭兵選項判斷。
 */
export function isMercenaryFilterGroup(group: Element): boolean {
  const tagged = group.getAttribute('data-poexd-group-type');
  if (tagged) return tagged === MERCENARY_GROUP_TYPE;
  const body = group.querySelector('.filter-group-body');
  if (!body) return false;
  const typed = body.querySelectorAll('.mutate-type');
  return (
    typed.length > 0 &&
    Array.from(typed).every((el) => el.classList.contains('mutate-type-mercenary'))
  );
}

/**
 * 傭兵搜尋中的一般條件群組（and / not / count / if）也能放傭兵技能，額外提供傭兵按鈕。
 * 依 Main World 標記的群組類型與傭兵搜尋旗標判斷。
 */
export function isMercenaryConditionGroup(group: Element): boolean {
  if (group.getAttribute('data-poexd-mercenary-search') !== '1') return false;
  return MERCENARY_CONDITION_GROUP_TYPES.has(group.getAttribute('data-poexd-group-type') ?? '');
}

function filterGroupButtonTitle(mode: FilterGroupButtonMode): string {
  if (mode === 'mercenary') return t('injectedControls.selectMercenaryGroupTitle');
  if (mode === 'mercenary-condition') return t('injectedControls.addMercenaryToGroupTitle');
  return t('injectedControls.selectAffixGroupTitle');
}

function createFilterGroupButton(
  mode: FilterGroupButtonMode,
  groupIndex: number,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className =
    mode === 'mercenary-condition'
      ? 'btn poexd-inline-btn poexd-filter-select-btn poexd-mercenary-condition-btn'
      : 'btn poexd-inline-btn poexd-filter-select-btn';
  button.dataset.poexdMode = mode;
  button.title = filterGroupButtonTitle(mode);
  button.replaceChildren(
    createSvgIcon({
      attrs: { viewBox: '0 0 24 24', style: 'fill: currentColor; pointer-events: none;' },
      paths: [mode === 'affix' ? FILTER_ICON_PATH : MERCENARY_ICON_PATH],
    }),
  );
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    if (mode === 'mercenary') {
      dispatchPoeEvent('poexd-open-mercenary-picker', { groupIndex });
    } else if (mode === 'mercenary-condition') {
      dispatchPoeEvent('poexd-open-mercenary-picker', { groupIndex, condition: true });
    } else {
      dispatchPoeEvent('poexd-open-affix-modal', { groupIndex });
    }
  });
  return button;
}

export function cleanFilterGroupButtons(): void {
  document
    .querySelectorAll<HTMLElement>('.poexd-filter-select-btn, .poexd-category-select-btn')
    .forEach((btn) => {
      btn.remove();
    });
}

export function cleanSendToConsoleButtons(): void {
  document.querySelectorAll<HTMLElement>('.poexd-send-to-console-btn').forEach((btn) => {
    btn.remove();
  });
}

export function isStatFilterGroup(group: Element): boolean {
  const header = group.querySelector('.filter-group-header');
  if (header) {
    if (header.querySelector('.filter-select') !== null) return true;
    if (header.querySelector('.multiselect') !== null) return true;
    if (header.querySelector('.filter-group-select') !== null) return true;
  }
  const inputs = Array.from(group.querySelectorAll('input'));
  return inputs.some(
    (i) =>
      i.placeholder &&
      (i.placeholder.includes('+') ||
        i.placeholder.toLowerCase().includes('filter') ||
        i.placeholder.includes('屬性') ||
        i.placeholder.includes('過濾')),
  );
}

let nextTierSlotSeq = 0;

export function createTierSlotDomainData(
  tiers: any[] | null | undefined,
  filterEl: Element,
  slotEl: HTMLElement,
  options: Pick<InjectedControlsOptions, 'version' | 'tierDomainService'>,
  statId?: string | null,
): {
  items: TierDropdownItemSpec[];
  onSelect: (item: TierDropdownItemSpec, mode?: 'min' | 'both' | 'max') => void;
} {
  const effectiveStatId = statId ?? filterEl.getAttribute('data-poexd-stat-id');
  const eligibility = options.tierDomainService.resolveTierModEligibility(tiers, effectiveStatId);
  if (!eligibility.isEligible) {
    return { items: [], onSelect: () => {} };
  }

  const { normalTiers, availableTypes: typeList } = eligibility;
  const gIdxAttr = filterEl.closest('.filter-group')?.getAttribute('data-poexd-group-idx');
  const fIdxAttr = filterEl.getAttribute('data-poexd-filter-idx');
  const gIdx = gIdxAttr !== null ? Number(gIdxAttr) : null;
  const fIdx = fIdxAttr !== null ? Number(fIdxAttr) : null;

  const applyValues = (minVal: string, maxVal: string) => {
    let minInput: HTMLInputElement | null = null;
    let maxInput: HTMLInputElement | null = null;

    const minContainer = filterEl.querySelector('.min');
    const maxContainer = filterEl.querySelector('.max');
    if (minContainer && maxContainer) {
      minInput = minContainer.querySelector('input');
      maxInput = maxContainer.querySelector('input');
    } else {
      const inputs = Array.from(filterEl.querySelectorAll('input'));
      minInput =
        inputs.find((i) => {
          const ph = (i.placeholder || '').toLowerCase();
          return ph.includes('最小') || ph.includes('min');
        }) || null;
      maxInput =
        inputs.find((i) => {
          const ph = (i.placeholder || '').toLowerCase();
          return ph.includes('最大') || ph.includes('max');
        }) || null;
      if (!minInput && inputs.length >= 2) {
        minInput = inputs[0];
        maxInput = inputs[1];
      }
    }

    if (minInput) {
      minInput.value = minVal;
      minInput.dispatchEvent(new Event('input', { bubbles: true }));
      minInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (maxInput) {
      maxInput.value = maxVal;
      maxInput.dispatchEvent(new Event('input', { bubbles: true }));
      maxInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
  };

  // 使用這行詞綴 DOM 上被標記的 category (即 Vuex 物件中的 poexdCategory)
  let detectedType = filterEl.getAttribute('data-poexd-category') || null;
  const bindingId = filterEl.getAttribute('data-poexd-binding-id') || '';

  const items: TierDropdownItemSpec[] = [];

  let activeType = detectedType;
  if (!activeType && typeList.length === 1) {
    activeType = typeList[0];
    detectedType = activeType;
  }

  if (activeType) {
    const typeNames = getTradeMapping(options.version).typeNames;
    const categoryLabel = typeNames[activeType] || activeType.toUpperCase();

    items.push({
      id: 'switch_category',
      type: 'switch_category',
      label: t('tierDropdown.switchCategory', { category: categoryLabel }),
    });

    const filtered = options.tierDomainService.filterTiersByCategory(normalTiers, activeType);
    if (filtered.length === 0) {
      items.push({
        id: 'no-category-tiers',
        type: 'header',
        label: t('tierDropdown.noCategoryTiers'),
      });
    } else {
      const modGroups = options.tierDomainService.groupTiersByMod(filtered);
      let tierSource = filtered;
      let activeGroupId: string | null = null;

      if (modGroups.length > 1) {
        const detectedGroupId = filterEl.getAttribute('data-poexd-mod-group');
        let activeGroup = modGroups.find((g) => g.id === detectedGroupId);
        if (!activeGroup) {
          activeGroup = modGroups.find((g) => g.isPure) || modGroups[0];
          filterEl.setAttribute('data-poexd-mod-group', activeGroup.id);
        }

        modGroups.forEach((g, gIdx) => {
          items.push({
            id: `group-${g.id}`,
            type: 'mod_group_option',
            label: g.label,
            groupId: g.id,
            groupIndex: gIdx,
            isActive: g.id === activeGroup!.id,
          });
        });

        tierSource = activeGroup.tiers;
        activeGroupId = activeGroup.id;
      }

      const mapped = tierSource
        .map((tier, idx) => {
          const tierName = `T${tierSource.length - idx}`;
          return { tier, tierName };
        })
        .reverse();

      mapped.forEach(({ tier, tierName }) => {
        const { rangeText, valMin, valMax, isRange } = options.tierDomainService.parseTierValues(
          tier,
          effectiveStatId,
        );
        items.push({
          id: activeGroupId ? `tier-${activeGroupId}-${tierName}` : `tier-${tierName}`,
          type: 'tier',
          label: `${tierName}${tier.level != null ? ` (Lv.${tier.level})` : ''}${rangeText}`,
          tierName,
          tierLevel: tier.level,
          rangeText: rangeText.trim(),
          valMin,
          valMax,
          isRange,
        });
      });
    }
  } else {
    items.push({
      id: 'trigger_modal',
      type: 'trigger_modal',
      label: t('tierDropdown.selectCategory'),
    });
  }

  const onSelect = (item: TierDropdownItemSpec, mode?: 'min' | 'both' | 'max') => {
    const slotKey = slotEl.getAttribute('data-poexd-slot-key') || '';
    if (item.type === 'switch_category' || item.type === 'trigger_modal') {
      if (gIdx !== null && fIdx !== null) {
        (window as any).__poexd_selecting_target__ = {
          slotKey,
          groupIndex: gIdx,
          filterIndex: fIdx,
          bindingId,
          availableTypes: typeList,
          currentCategory: detectedType || '',
        };
        dispatchPoeEvent('poexd-trigger-select-type-modal');
      }
    } else if (item.type === 'mod_group_option') {
      if (item.groupId) {
        filterEl.setAttribute('data-poexd-mod-group', item.groupId);
      }
      const nextData = createTierSlotDomainData(tiers, filterEl, slotEl, options, statId);
      upsertTierSlot({
        key: slotKey,
        targetEl: slotEl,
        items: nextData.items,
        onSelect: nextData.onSelect,
      });
    } else if (item.type === 'tier') {
      if (mode === 'both') {
        applyValues(item.valMin || '', item.valMax || '');
      } else if (mode === 'max') {
        applyValues('', item.valMax || '');
      } else {
        applyValues(item.valMin || '', '');
      }
    }
  };

  return { items, onSelect };
}

export function createInjectedControls(options: InjectedControlsOptions): InjectedControls {
  const createTierSlotDomainDataBound = (
    tiers: any[] | null | undefined,
    filterEl: Element,
    slotEl: HTMLElement,
    statId?: string | null,
  ) => createTierSlotDomainData(tiers, filterEl, slotEl, options, statId);

  const injectSendToConsoleButton = (): void => {
    if (document.body?.getAttribute('data-poexd-page-role') === 'live-search-primary') {
      cleanSendToConsoleButtons();
      return;
    }

    const controlsList = document.querySelectorAll<HTMLElement>('.search-panel .controls');
    controlsList.forEach((controlsEl) => {
      if (controlsEl.querySelector('.poexd-send-to-console-btn')) return;

      const targetContainer =
        controlsEl.querySelector<HTMLElement>('.controls-left') ||
        controlsEl.querySelector<HTMLElement>('.livesearch-btn')?.parentElement ||
        controlsEl.querySelector<HTMLElement>('.controls-center') ||
        controlsEl.querySelector<HTMLElement>('.search-btn')?.parentElement ||
        controlsEl;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn poexd-inline-btn poexd-send-to-console-btn';
      btn.setAttribute('data-poexd-send-to-console', 'true');
      btn.title = t('injectedControls.sendToConsoleTitle');
      btn.textContent = t('injectedControls.sendToConsole');

      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (btn.disabled) return;
        btn.disabled = true;

        try {
          let syncedUrl: string;
          try {
            syncedUrl = await syncFormToUrl();
          } catch (syncErr) {
            dispatchPoeEvent('poexd-toast', {
              message: syncErr instanceof Error ? syncErr.message : String(syncErr),
              tone: 'error',
              durationMs: 3000,
            });
            return;
          }

          const cleanUrl = stripLiveSuffix(syncedUrl);
          if (!cleanUrl) {
            dispatchPoeEvent('poexd-toast', {
              message: t('injectedControls.cannotGetUrl'),
              tone: 'error',
              durationMs: 3000,
            });
            return;
          }

          let derivedName = '';
          try {
            const decoded = await decodeTradeSearchUrl(cleanUrl);
            if (decoded) {
              await loadTradeDictionaries(decoded.gameVersion);
              const meta = extractQueryMetadata(decoded.query, decoded.gameVersion);
              derivedName = meta.suggestedName?.trim() || '';
            }
          } catch {
            // Best-effort name derivation
          }

          const displayLabel = derivedName || t('injectedControls.unnamedSearch');

          const res = await extensionMessaging.sendMessage('liveSearch:enqueueConnections', {
            gameVersion: options.version,
            items: [
              {
                url: cleanUrl,
                ...(derivedName ? { name: derivedName } : {}),
              },
            ],
          });

          const toast = resolveSingleEnqueueToast(res, displayLabel);
          dispatchPoeEvent('poexd-toast', {
            message: toast.message,
            tone: toast.tone,
            durationMs: 3000,
          });
        } catch (err) {
          dispatchPoeEvent('poexd-toast', {
            message: err instanceof Error ? err.message : t('injectedControls.sendToConsoleFailed'),
            tone: 'error',
            durationMs: 3000,
          });
        } finally {
          btn.disabled = false;
        }
      });

      targetContainer.appendChild(btn);
    });
  };

  const injectFilterGroupButtons = (): void => {
    try {
      chrome.runtime.getURL('');
    } catch (e) {
      return;
    }

    const misplacedFilterBtn = document.querySelector('.poexd-filter-select-btn');
    if (
      misplacedFilterBtn &&
      misplacedFilterBtn.closest('.filter-body') &&
      !misplacedFilterBtn.closest('.filter-group-header')
    ) {
      misplacedFilterBtn.remove();
    }

    const groups = document.querySelectorAll('.search-advanced-pane.brown .filter-group');
    groups.forEach((group, index) => {
      const header = group.querySelector('.filter-group-header .filter');
      if (!header) return;
      const mode: FilterGroupButtonMode =
        options.version === 'poe1' && isMercenaryFilterGroup(group) ? 'mercenary' : 'affix';
      const removeBtn = header.querySelector('.remove-btn');
      const container = removeBtn?.closest('.input-group-btn');

      const wantsCondition =
        options.version === 'poe1' && mode === 'affix' && isMercenaryConditionGroup(group);
      const conditionBtn = header.querySelector<HTMLElement>('.poexd-mercenary-condition-btn');
      if (conditionBtn && !wantsCondition) conditionBtn.remove();

      const existing = header.querySelector<HTMLElement>(
        '.poexd-filter-select-btn:not(.poexd-mercenary-condition-btn)',
      );
      if (existing && existing.dataset.poexdMode !== mode) existing.remove();
      if (!container || !removeBtn) return;
      if (!existing || existing.dataset.poexdMode !== mode) {
        container.insertBefore(createFilterGroupButton(mode, index), removeBtn);
      }
      if (wantsCondition && !conditionBtn) {
        container.insertBefore(createFilterGroupButton('mercenary-condition', index), removeBtn);
      }
    });

    let categoryGroup: Element | null = null;
    for (const group of Array.from(groups)) {
      const headerTitleEl = group.querySelector('.filter-group-header .filter-title');
      if (headerTitleEl) {
        const text = headerTitleEl.textContent?.trim() || '';
        if (TYPE_FILTERS_TITLES.some((title) => text.includes(title))) {
          categoryGroup = group;
          break;
        }
      }
    }

    if (categoryGroup) {
      const header =
        categoryGroup.querySelector('.filter-group-header .filter') ||
        categoryGroup.querySelector('.filter-group-header');
      if (header && !header.querySelector('.poexd-category-select-btn')) {
        const selectBtn = document.createElement('button');
        selectBtn.type = 'button';
        selectBtn.className = 'btn poexd-inline-btn poexd-category-select-btn';
        selectBtn.title = t('injectedControls.selectAffixTitle');
        selectBtn.textContent = t('injectedControls.selectAffix');

        selectBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const currentGroupsCount = document.querySelectorAll(
            '.search-advanced-pane.brown .filter-group',
          ).length;
          const targetIdx = currentGroupsCount > 0 ? currentGroupsCount - 1 : 0;
          dispatchPoeEvent('poexd-open-affix-modal', { groupIndex: targetIdx });
        });
        header.appendChild(selectBtn);
      }
    }
  };

  const injectTierSelectorButtons = async (generation: number): Promise<void> => {
    const rawMods = await options.tierDomainService.loadModsData(
      generation,
      options.isCurrentGeneration,
    );
    if (!rawMods || !options.isCurrentGeneration(generation)) return;

    const allGroups = document.querySelectorAll('.search-advanced-pane.brown .filter-group');
    const statGroups = Array.from(allGroups).filter(isStatFilterGroup);

    const filterElements: Element[] = [];
    statGroups.forEach((group) => {
      const filters = group.querySelectorAll('.filter-group-body .filter:not(.filter-padded)');
      filters.forEach((f) => filterElements.push(f));
    });

    const discoveredSlots: TierSlotDescriptor[] = [];

    filterElements.forEach((filterEl) => {
      const statId = filterEl.getAttribute('data-poexd-stat-id');
      const existingSlot = filterEl.querySelector<HTMLElement>('.poexd-tier-trigger-slot');
      if (!statId) {
        removeTierSlotArtifacts(existingSlot);
        return;
      }

      const tiers = options.tierDomainService.findModTiersByStatId(statId, rawMods);
      const eligibility = options.tierDomainService.resolveTierModEligibility(tiers, statId);
      if (!eligibility.isEligible) {
        removeTierSlotArtifacts(existingSlot);
        return;
      }

      let minInput: HTMLInputElement | null = null;
      const minContainer = filterEl.querySelector('.min');
      if (minContainer) {
        minInput = minContainer.querySelector('input');
      } else {
        const inputs = Array.from(filterEl.querySelectorAll('input'));
        minInput =
          inputs.find((i) => {
            const ph = (i.placeholder || '').toLowerCase();
            return ph.includes('最小') || ph.includes('min');
          }) || null;
        if (!minInput && inputs.length >= 2) {
          minInput = inputs[0];
        }
      }

      if (!minInput) {
        removeTierSlotArtifacts(existingSlot);
        return;
      }

      // 尋找或建立 Light DOM Teleport slot
      let slotEl = existingSlot;
      if (!slotEl) {
        const slotKey = `tier-slot-${++nextTierSlotSeq}-${statId}`;
        slotEl = document.createElement('span');
        slotEl.className = 'poexd-tier-trigger-slot';
        slotEl.setAttribute('data-poexd-slot-key', slotKey);

        const prevSep = minInput.previousElementSibling;
        if (prevSep && prevSep.classList.contains('sep')) {
          const sepSpan = document.createElement('span');
          sepSpan.className = 'sep';
          sepSpan.setAttribute('data-poexd-tier-sep', slotKey);
          minInput.parentNode?.insertBefore(sepSpan, minInput);
          minInput.parentNode?.insertBefore(slotEl, sepSpan);
        } else {
          const sepLeft = document.createElement('span');
          sepLeft.className = 'sep';
          sepLeft.setAttribute('data-poexd-tier-sep', slotKey);
          const sepRight = document.createElement('span');
          sepRight.className = 'sep';
          sepRight.setAttribute('data-poexd-tier-sep', slotKey);

          minInput.parentNode?.insertBefore(sepRight, minInput);
          minInput.parentNode?.insertBefore(slotEl, sepRight);
          minInput.parentNode?.insertBefore(sepLeft, slotEl);
        }
      }

      const slotKey = slotEl.getAttribute('data-poexd-slot-key') || `tier-slot-${statId}`;
      const { items, onSelect } = createTierSlotDomainDataBound(tiers, filterEl, slotEl, statId);

      discoveredSlots.push({
        key: slotKey,
        targetEl: slotEl,
        items,
        onSelect,
      });
    });

    // 清除不在 discoveredSlots 中的任何孤立 slot 與 bound separators
    const discoveredSlotKeys = new Set(discoveredSlots.map((s) => s.key));
    statGroups.forEach((group) => {
      group.querySelectorAll<HTMLElement>('.poexd-tier-trigger-slot').forEach((slotEl) => {
        const key = slotEl.getAttribute('data-poexd-slot-key');
        if (!key || !discoveredSlotKeys.has(key)) {
          removeTierSlotArtifacts(slotEl);
        }
      });
    });

    syncTierSlots(discoveredSlots);
  };

  const refreshTierSlotDomain = async (slotKey: string): Promise<boolean> => {
    const slotEl = document.querySelector<HTMLElement>(`[data-poexd-slot-key="${slotKey}"]`);
    if (!slotEl) return false;
    const filterEl = slotEl.closest('[data-poexd-stat-id]') || slotEl.closest('.filter');
    if (!filterEl) return false;
    const statId = filterEl.getAttribute('data-poexd-stat-id');
    if (!statId) return false;

    const gen = options.getCurrentGeneration ? options.getCurrentGeneration() : 0;
    const rawMods =
      options.tierDomainService.getRawModsData() ??
      (await options.tierDomainService.loadModsData(gen, options.isCurrentGeneration));
    if (!rawMods) return false;
    const tiers = options.tierDomainService.findModTiersByStatId(statId, rawMods);
    const eligibility = options.tierDomainService.resolveTierModEligibility(tiers, statId);
    if (!eligibility.isEligible) {
      removeTierSlotArtifacts(slotEl);
      return false;
    }

    const { items, onSelect } = createTierSlotDomainDataBound(tiers, filterEl, slotEl, statId);

    upsertTierSlot({
      key: slotKey,
      targetEl: slotEl,
      items,
      onSelect,
    });
    return true;
  };

  const updateInjectedControlsLocale = (): void => {
    document.querySelectorAll<HTMLElement>('.poexd-send-to-console-btn').forEach((btn) => {
      btn.title = t('injectedControls.sendToConsoleTitle');
      btn.textContent = t('injectedControls.sendToConsole');
    });

    document.querySelectorAll<HTMLElement>('.poexd-filter-select-btn').forEach((btn) => {
      const mode = btn.dataset.poexdMode;
      btn.title = filterGroupButtonTitle(
        mode === 'mercenary' || mode === 'mercenary-condition' ? mode : 'affix',
      );
    });

    document.querySelectorAll<HTMLElement>('.poexd-category-select-btn').forEach((btn) => {
      btn.title = t('injectedControls.selectAffixTitle');
      btn.textContent = t('injectedControls.selectAffix');
    });
  };

  return {
    injectCustomStyles,
    updatePureBackgroundClass,
    injectFilterGroupButtons,
    cleanFilterGroupButtons,
    injectSendToConsoleButton,
    cleanSendToConsoleButtons,
    injectTierSelectorButtons,
    refreshTierSlotDomain,
    removeTierSlotArtifacts,
    cleanAllTierSlotArtifacts,
    updateInjectedControlsLocale,
  };
}
