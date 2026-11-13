import {
  planAddStatToGroupKind,
  type CriteriaOverlayFormSnapshot,
  type QuickStatFilterGroupKind,
} from '@/utils/criteria-overlay';
import { dispatchPoeEvent } from '@/utils/event-contracts';
import { t } from '@/utils/i18n';
import { getKnownStatsRef } from '@/utils/known-stats-store';
import type { TradePageRole } from '@/utils/live-search-contract';
import type { TradePageMode } from '@/utils/trade-page-mode';
import {
  createPoeEventCriteriaOverlayChannel,
  type CriteriaOverlayPageChannel,
} from './criteria-overlay-session';
import { isTradeSearchFormUrl } from './form-url-sync';

const STYLE_ID = 'poexd-result-mod-quick-filter-style';
const RESULTS_CONTAINER_SELECTOR = '.results';
const ITEM_ROW_SELECTOR = '.row[data-id], .row[id]';
const ROW_SELECTOR = `${RESULTS_CONTAINER_SELECTOR} .row[data-id], ${RESULTS_CONTAINER_SELECTOR} .row[id]`;
const MOD_FIELD_SELECTOR = '[data-field^="stat."]';
const STAT_FIELD_PREFIX = 'stat.';

export const RESULT_MOD_QUICK_FILTER_HOST_CLASS = 'poexd-result-mod-host';
export const RESULT_MOD_QUICK_FILTER_ACTIONS_CLASS = 'poexd-result-mod-actions';
export const RESULT_MOD_QUICK_FILTER_BUTTON_CLASS = 'poexd-result-mod-btn';
const STAT_ID_ATTR = 'data-poexd-stat-id';
const GROUP_KIND_ATTR = 'data-poexd-quick-group';

export interface ResultModQuickFilterOptions {
  channel?: CriteriaOverlayPageChannel;
  isSearchFormUrl?: (url: string) => boolean;
  resolveStatText?: (statId: string) => string | undefined;
}

function buildStyleContent(): string {
  // Use oklch() exclusively (theme contract forbids raw hex colors).
  // Hover/focus-within reveals actions on the right and shifts official .lc.l / .lc.r markers aside.
  return `
    .${RESULT_MOD_QUICK_FILTER_HOST_CLASS} {
      position: relative !important;
    }

    .${RESULT_MOD_QUICK_FILTER_ACTIONS_CLASS} {
      position: absolute !important;
      right: 6px !important;
      top: 50% !important;
      transform: translateY(-50%) !important;
      z-index: 6 !important;
      display: inline-flex !important;
      align-items: center !important;
      gap: 4px !important;
      padding: 0 !important;
      border-radius: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.12s ease;
    }

    .${RESULT_MOD_QUICK_FILTER_HOST_CLASS}:hover > .${RESULT_MOD_QUICK_FILTER_ACTIONS_CLASS},
    .${RESULT_MOD_QUICK_FILTER_HOST_CLASS}:focus-within > .${RESULT_MOD_QUICK_FILTER_ACTIONS_CLASS} {
      opacity: 1 !important;
      pointer-events: auto !important;
    }

    #trade .results.compact .${RESULT_MOD_QUICK_FILTER_HOST_CLASS}:hover > .lc.l,
    #trade .results.compact .${RESULT_MOD_QUICK_FILTER_HOST_CLASS}:focus-within > .lc.l {
      right: 112px !important;
    }

    #trade .results:not(.compact) .${RESULT_MOD_QUICK_FILTER_HOST_CLASS}:hover > .lc.r,
    #trade .results:not(.compact) .${RESULT_MOD_QUICK_FILTER_HOST_CLASS}:focus-within > .lc.r {
      right: 112px !important;
    }

    .${RESULT_MOD_QUICK_FILTER_BUTTON_CLASS} {
      appearance: none !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      height: 19px !important;
      padding: 0 6px !important;
      border-radius: 0 !important;
      border: 1px solid oklch(0.387 0 0) !important;
      background: oklch(0.252 0 0 / 0.96) !important;
      color: oklch(0.858 0.068 82.8) !important;
      box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.06) !important;
      font-family: FontinSmallcaps, Verdana, Arial, Helvetica, sans-serif !important;
      font-size: 11px !important;
      font-weight: 400 !important;
      line-height: 1 !important;
      letter-spacing: 0.03em !important;
      cursor: pointer !important;
      white-space: nowrap !important;
      transition: background-color 0.12s ease, border-color 0.12s ease, color 0.12s ease !important;
    }

    .${RESULT_MOD_QUICK_FILTER_BUTTON_CLASS}[${GROUP_KIND_ATTR}="and"] {
      background: oklch(0.285 0.055 246 / 0.96) !important;
      border-color: oklch(0.45 0.075 268) !important;
      color: oklch(0.913 0 0) !important;
    }

    .${RESULT_MOD_QUICK_FILTER_BUTTON_CLASS}[${GROUP_KIND_ATTR}="and"]:hover:not(:disabled) {
      background: oklch(0.345 0.075 246) !important;
      border-color: oklch(0.58 0.08 260) !important;
      color: oklch(0.96 0.03 83) !important;
    }

    .${RESULT_MOD_QUICK_FILTER_BUTTON_CLASS}[${GROUP_KIND_ATTR}="not"] {
      background: oklch(0.255 0.052 20 / 0.96) !important;
      border-color: oklch(0.43 0.082 22) !important;
      color: oklch(0.89 0.04 80) !important;
    }

    .${RESULT_MOD_QUICK_FILTER_BUTTON_CLASS}[${GROUP_KIND_ATTR}="not"]:hover:not(:disabled) {
      background: oklch(0.325 0.078 20) !important;
      border-color: oklch(0.56 0.105 22) !important;
      color: oklch(0.96 0.03 83) !important;
    }

    .${RESULT_MOD_QUICK_FILTER_BUTTON_CLASS}:disabled {
      opacity: 0.55 !important;
      cursor: progress !important;
    }
  `;
}

function extractStatId(fieldValue: string | null): string | null {
  if (!fieldValue || !fieldValue.startsWith(STAT_FIELD_PREFIX)) return null;
  const statId = fieldValue.slice(STAT_FIELD_PREFIX.length).trim();
  return statId || null;
}

function formatModDisplayText(rawText: string): string {
  const collapsed = rawText.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= 48) return collapsed;
  return `${collapsed.slice(0, 45)}...`;
}

function stopEvent(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
}

function showQuickFilterToast(
  message: string,
  tone: 'default' | 'success' | 'error' = 'default',
): void {
  dispatchPoeEvent('poexd-toast', { message, tone });
}

export class ResultModQuickFilter {
  private enabled = true;
  private pageMode: TradePageMode = 'search';
  private pageRole: TradePageRole = 'normal';
  private busy = false;
  private styleEl: HTMLStyleElement | null = null;
  private readonly channel: CriteriaOverlayPageChannel;
  private readonly isSearchFormUrl: (url: string) => boolean;
  private readonly resolveStatText: (statId: string) => string | undefined;

  constructor(options: ResultModQuickFilterOptions = {}) {
    this.channel = options.channel ?? createPoeEventCriteriaOverlayChannel();
    this.isSearchFormUrl = options.isSearchFormUrl ?? isTradeSearchFormUrl;
    this.resolveStatText =
      options.resolveStatText ?? ((statId) => getKnownStatsRef().value[statId]?.text);
  }

  private isActive(): boolean {
    if (!this.enabled) return false;
    if (this.pageMode !== 'search') return false;
    if (this.pageRole === 'live-search-primary') return false;
    if (typeof window !== 'undefined' && !this.isSearchFormUrl(window.location.href)) return false;
    return true;
  }

  private ensureStyles(): void {
    if (typeof document === 'undefined' || !document.head) return;
    if (!this.styleEl) {
      const existing = document.getElementById(STYLE_ID);
      this.styleEl =
        existing instanceof HTMLStyleElement ? existing : document.createElement('style');
      this.styleEl.id = STYLE_ID;
      this.styleEl.textContent = buildStyleContent();
    }
    if (!this.styleEl.isConnected) {
      document.head.appendChild(this.styleEl);
    }
  }

  private removeStyles(): void {
    this.styleEl?.remove();
    this.styleEl = null;
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!this.isActive()) {
      this.clearAllInjected();
      return;
    }
    this.applyAll();
  }

  setPageMode(mode: TradePageMode): void {
    if (this.pageMode === mode) return;
    this.pageMode = mode;
    if (!this.isActive()) {
      this.clearAllInjected();
      return;
    }
    this.applyAll();
  }

  setPageRole(role: TradePageRole): void {
    if (this.pageRole === role) return;
    this.pageRole = role;
    if (!this.isActive()) {
      this.clearAllInjected();
      return;
    }
    this.applyAll();
  }

  refreshLocale(): void {
    if (typeof document === 'undefined') return;
    document
      .querySelectorAll<HTMLButtonElement>(
        `.${RESULT_MOD_QUICK_FILTER_BUTTON_CLASS}[${GROUP_KIND_ATTR}]`,
      )
      .forEach((button) => {
        const kind = button.getAttribute(GROUP_KIND_ATTR) as QuickStatFilterGroupKind | null;
        if (kind === 'and' || kind === 'not') {
          this.updateButtonLocale(button, kind);
        }
      });
  }

  apply(root?: Element): void {
    if (typeof document === 'undefined') return;
    if (!this.isActive()) {
      this.clearAllInjected();
      return;
    }
    this.ensureStyles();
    for (const row of this.collectTargetRows(root)) {
      this.applyToRow(row);
    }
  }

  cleanup(): void {
    this.clearAllInjected();
    this.removeStyles();
  }

  private applyAll(): void {
    if (typeof document === 'undefined') return;
    this.ensureStyles();
    document.querySelectorAll(ROW_SELECTOR).forEach((row) => this.applyToRow(row));
  }

  private clearAllInjected(): void {
    if (typeof document === 'undefined') return;
    document
      .querySelectorAll(`.${RESULT_MOD_QUICK_FILTER_ACTIONS_CLASS}`)
      .forEach((el) => el.remove());
    document
      .querySelectorAll(`.${RESULT_MOD_QUICK_FILTER_HOST_CLASS}`)
      .forEach((el) => el.classList.remove(RESULT_MOD_QUICK_FILTER_HOST_CLASS));
  }

  private collectTargetRows(root?: Element): Element[] {
    if (!root) {
      return Array.from(document.querySelectorAll(ROW_SELECTOR));
    }
    if (root.closest(RESULTS_CONTAINER_SELECTOR)) {
      const rows: Element[] = [];
      if (root.matches(ITEM_ROW_SELECTOR)) {
        rows.push(root);
      }
      rows.push(...root.querySelectorAll(ITEM_ROW_SELECTOR));
      return rows;
    }
    return Array.from(root.querySelectorAll(ROW_SELECTOR));
  }

  private applyToRow(row: Element): void {
    const fieldElements = row.querySelectorAll(MOD_FIELD_SELECTOR);
    fieldElements.forEach((fieldEl) => {
      const statId = extractStatId(fieldEl.getAttribute('data-field'));
      if (!statId) return;

      const host = fieldEl.parentElement;
      if (!(host instanceof HTMLElement) || host === row || !row.contains(host)) return;

      host.classList.add(RESULT_MOD_QUICK_FILTER_HOST_CLASS);
      const existing = host.querySelector<HTMLElement>(
        `:scope > .${RESULT_MOD_QUICK_FILTER_ACTIONS_CLASS}`,
      );
      if (existing) {
        existing.setAttribute(STAT_ID_ATTR, statId);
        this.syncActionsLocale(existing);
        return;
      }
      host.appendChild(this.createActionsElement(host, statId));
    });
  }

  private createActionsElement(host: HTMLElement, statId: string): HTMLElement {
    const container = document.createElement('span');
    container.className = RESULT_MOD_QUICK_FILTER_ACTIONS_CLASS;
    container.setAttribute(STAT_ID_ATTR, statId);
    container.addEventListener('pointerdown', stopEvent);
    container.addEventListener('mousedown', stopEvent);
    container.addEventListener('click', stopEvent);

    container.appendChild(this.createActionButton(host, container, 'and'));
    container.appendChild(this.createActionButton(host, container, 'not'));
    return container;
  }

  private createActionButton(
    host: HTMLElement,
    container: HTMLElement,
    kind: QuickStatFilterGroupKind,
  ): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = RESULT_MOD_QUICK_FILTER_BUTTON_CLASS;
    button.setAttribute(GROUP_KIND_ATTR, kind);
    button.textContent = kind === 'and' ? '+AND' : '+NOT';
    this.updateButtonLocale(button, kind);

    button.addEventListener('pointerdown', stopEvent);
    button.addEventListener('mousedown', stopEvent);
    button.addEventListener('click', (event) => {
      stopEvent(event);
      const currentStatId = container.getAttribute(STAT_ID_ATTR);
      if (!currentStatId) return;
      void this.handleAddStat(host, container, currentStatId, kind);
    });
    return button;
  }

  private updateButtonLocale(button: HTMLButtonElement, kind: QuickStatFilterGroupKind): void {
    const title = t(
      kind === 'and' ? 'resultModQuickFilter.andTitle' : 'resultModQuickFilter.notTitle',
    );
    button.title = title;
    button.setAttribute('aria-label', title);
  }

  private syncActionsLocale(container: HTMLElement): void {
    container
      .querySelectorAll<HTMLButtonElement>(
        `.${RESULT_MOD_QUICK_FILTER_BUTTON_CLASS}[${GROUP_KIND_ATTR}]`,
      )
      .forEach((button) => {
        const kind = button.getAttribute(GROUP_KIND_ATTR) as QuickStatFilterGroupKind | null;
        if (kind === 'and' || kind === 'not') {
          this.updateButtonLocale(button, kind);
        }
      });
  }

  private resolveDisplayText(host: HTMLElement, statId: string): string {
    const knownText = this.resolveStatText(statId);
    if (knownText) return formatModDisplayText(knownText);
    const expectedField = `${STAT_FIELD_PREFIX}${statId}`;
    const fieldEl = Array.from(host.querySelectorAll(MOD_FIELD_SELECTOR)).find(
      (el) => el.getAttribute('data-field') === expectedField,
    );
    const fallbackText = fieldEl?.textContent ?? host.textContent ?? statId;
    return formatModDisplayText(fallbackText || statId);
  }

  private setContainerBusy(container: HTMLElement, disabled: boolean): void {
    container
      .querySelectorAll<HTMLButtonElement>(`.${RESULT_MOD_QUICK_FILTER_BUTTON_CLASS}`)
      .forEach((button) => {
        button.disabled = disabled;
      });
  }

  private async handleAddStat(
    host: HTMLElement,
    container: HTMLElement,
    statId: string,
    targetGroup: QuickStatFilterGroupKind,
  ): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.setContainerBusy(container, true);

    const displayText = this.resolveDisplayText(host, statId);
    const groupLabel = targetGroup.toUpperCase();

    try {
      const { snapshot, knownStatIds } = await this.channel.read();
      const plan = planAddStatToGroupKind(
        snapshot as CriteriaOverlayFormSnapshot,
        targetGroup,
        statId,
        knownStatIds,
      );

      if (plan.status === 'unknown') {
        showQuickFilterToast(
          t('resultModQuickFilter.toast.unknownStat', { text: displayText }),
          'error',
        );
        return;
      }

      if (plan.status === 'already-exists') {
        showQuickFilterToast(
          t('resultModQuickFilter.toast.alreadyExists', {
            text: displayText,
            group: groupLabel,
          }),
        );
        return;
      }

      await this.channel.commit(plan.ops);
      showQuickFilterToast(
        t(
          plan.status === 'enabled'
            ? 'resultModQuickFilter.toast.enabled'
            : 'resultModQuickFilter.toast.added',
          { text: displayText, group: groupLabel },
        ),
        'success',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showQuickFilterToast(t('resultModQuickFilter.toast.failed', { message }), 'error');
    } finally {
      this.busy = false;
      if (container.isConnected) {
        this.setContainerBusy(container, false);
      }
    }
  }
}
