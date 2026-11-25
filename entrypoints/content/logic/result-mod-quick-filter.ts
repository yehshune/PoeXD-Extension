import { type CriteriaOverlayFormSnapshot } from '@/utils/criteria-overlay';
import { t } from '@/utils/i18n';
import { planAddStatToGroupKind, type QuickStatFilterGroupKind } from '@/utils/stat-quick-filter';
import { TRADE_RESULTS_SELECTOR } from '@/utils/trade-results-root';
import type { ResultEnhancementHostPort } from './result-enhancement-host-port';
import {
  RESULT_MOD_QUICK_FILTER_ACTIONS_CLASS,
  RESULT_MOD_QUICK_FILTER_BUTTON_CLASS,
  RESULT_MOD_QUICK_FILTER_GROUP_ATTR,
  RESULT_MOD_QUICK_FILTER_HOST_CLASS,
  ensureResultEnhancementStyle,
  removeResultEnhancementStyle,
} from './result-enhancement-styles';
import { collectResultRows, RESULT_ITEM_ROW_SELECTOR } from './result-left-actions';

export {
  RESULT_MOD_QUICK_FILTER_ACTIONS_CLASS,
  RESULT_MOD_QUICK_FILTER_BUTTON_CLASS,
  RESULT_MOD_QUICK_FILTER_HOST_CLASS,
};

const ROW_SELECTOR = `${TRADE_RESULTS_SELECTOR} .row[data-id], ${TRADE_RESULTS_SELECTOR} .row[id]`;
const MOD_FIELD_SELECTOR = '[data-field^="stat."]';
const STAT_FIELD_PREFIX = 'stat.';
const STAT_ID_ATTR = 'data-poexd-stat-id';

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

export class ResultModQuickFilterAdapter {
  private enabled = false;
  private scopeActive = true;
  private busy = false;

  constructor(private readonly port: ResultEnhancementHostPort) {}

  private isActive(): boolean {
    if (!this.enabled || !this.scopeActive) return false;
    return this.port.overlayChannel.isSearchFormUrl(this.port.getPageContext().href);
  }

  private syncActiveState(): void {
    if (!this.isActive()) {
      this.clearAllInjected();
      return;
    }
    this.applyAll();
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.syncActiveState();
  }

  onScopeActiveChange(active: boolean): void {
    if (this.scopeActive === active) return;
    this.scopeActive = active;
    this.syncActiveState();
  }

  refreshLocale(): void {
    this.syncButtonsLocale(this.port.doc);
  }

  apply(root?: Element): void {
    if (!this.isActive()) {
      this.clearAllInjected();
      return;
    }
    ensureResultEnhancementStyle('mod-quick-filter', this.port.doc);
    for (const row of this.collectTargetRows(root)) {
      this.applyToRow(row);
    }
  }

  cleanup(): void {
    this.enabled = false;
    this.clearAllInjected();
    removeResultEnhancementStyle('mod-quick-filter', this.port.doc);
  }

  private applyAll(): void {
    ensureResultEnhancementStyle('mod-quick-filter', this.port.doc);
    this.port.doc.querySelectorAll(ROW_SELECTOR).forEach((row) => this.applyToRow(row));
  }

  private clearAllInjected(): void {
    this.port.doc
      .querySelectorAll(`${TRADE_RESULTS_SELECTOR} .${RESULT_MOD_QUICK_FILTER_ACTIONS_CLASS}`)
      .forEach((el) => el.remove());
    this.port.doc
      .querySelectorAll(`${TRADE_RESULTS_SELECTOR} .${RESULT_MOD_QUICK_FILTER_HOST_CLASS}`)
      .forEach((el) => el.classList.remove(RESULT_MOD_QUICK_FILTER_HOST_CLASS));
  }

  private collectTargetRows(root?: Element): Element[] {
    if (!root) {
      return Array.from(this.port.doc.querySelectorAll(ROW_SELECTOR));
    }
    if (root.closest(TRADE_RESULTS_SELECTOR)) {
      return collectResultRows(root);
    }
    return Array.from(root.querySelectorAll(ROW_SELECTOR)).filter(
      (row) => row.matches?.(RESULT_ITEM_ROW_SELECTOR) ?? true,
    );
  }

  private applyToRow(row: Element): void {
    const fieldElements = row.querySelectorAll(MOD_FIELD_SELECTOR);
    fieldElements.forEach((fieldEl) => {
      const statId = extractStatId(fieldEl.getAttribute('data-field'));
      if (!statId) return;

      const host = fieldEl.parentElement;
      if (!host || host === row || !row.contains(host)) return;

      host.classList.add(RESULT_MOD_QUICK_FILTER_HOST_CLASS);
      const existing = host.querySelector<HTMLElement>(
        `:scope > .${RESULT_MOD_QUICK_FILTER_ACTIONS_CLASS}`,
      );
      if (existing) {
        existing.setAttribute(STAT_ID_ATTR, statId);
        this.syncButtonsLocale(existing);
        return;
      }
      host.appendChild(this.createActionsElement(host as HTMLElement, statId));
    });
  }

  private createActionsElement(host: HTMLElement, statId: string): HTMLElement {
    const container = this.port.doc.createElement('span');
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
    const button = this.port.doc.createElement('button');
    button.type = 'button';
    button.className = RESULT_MOD_QUICK_FILTER_BUTTON_CLASS;
    button.setAttribute(RESULT_MOD_QUICK_FILTER_GROUP_ATTR, kind);
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
    button.textContent = t(
      kind === 'and' ? 'resultModQuickFilter.andButton' : 'resultModQuickFilter.notButton',
    );
    const title = t(
      kind === 'and' ? 'resultModQuickFilter.andTitle' : 'resultModQuickFilter.notTitle',
    );
    button.title = title;
    button.setAttribute('aria-label', title);
  }

  private syncButtonsLocale(root: ParentNode): void {
    root
      .querySelectorAll<HTMLButtonElement>(
        `.${RESULT_MOD_QUICK_FILTER_BUTTON_CLASS}[${RESULT_MOD_QUICK_FILTER_GROUP_ATTR}]`,
      )
      .forEach((button) => {
        const kind = button.getAttribute(
          RESULT_MOD_QUICK_FILTER_GROUP_ATTR,
        ) as QuickStatFilterGroupKind | null;
        if (kind === 'and' || kind === 'not') {
          this.updateButtonLocale(button, kind);
        }
      });
  }

  private resolveDisplayText(host: HTMLElement, statId: string): string {
    const knownText = this.port.overlayChannel.resolveStatText(statId);
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
    const groupLabel = t(
      targetGroup === 'and' ? 'resultModQuickFilter.group.and' : 'resultModQuickFilter.group.not',
    );

    try {
      const { snapshot, knownStatIds } = await this.port.overlayChannel.read();
      const plan = planAddStatToGroupKind(
        snapshot as CriteriaOverlayFormSnapshot,
        targetGroup,
        statId,
        knownStatIds,
      );

      if (plan.status === 'unknown') {
        this.port.notify(
          t('resultModQuickFilter.toast.unknownStat', { text: displayText }),
          'error',
        );
        return;
      }

      if (plan.status === 'already-exists') {
        this.port.notify(
          t('resultModQuickFilter.toast.alreadyExists', {
            text: displayText,
            group: groupLabel,
          }),
          'default',
        );
        return;
      }

      await this.port.overlayChannel.commit(plan.ops);
      this.port.notify(
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
      this.port.notify(t('resultModQuickFilter.toast.failed', { message }), 'error');
    } finally {
      this.busy = false;
      if (container.isConnected) {
        this.setContainerBusy(container, false);
      }
    }
  }
}
