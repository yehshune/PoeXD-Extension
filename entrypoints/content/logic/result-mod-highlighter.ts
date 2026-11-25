import { TRADE_RESULTS_SELECTOR } from '@/utils/trade-results-root';
import {
  ensureResultEnhancementStyle,
  removeResultEnhancementStyle,
} from './result-enhancement-styles';

type UnknownRecord = Record<string, unknown>;

export class ResultModHighlighterAdapter {
  private enabled = false;
  private activeStatIds = new Set<string>();

  constructor(private readonly doc: Document) {}

  handleSearchQuery(_searchId: string, criteria: unknown): void {
    this.activeStatIds = extractEnabledStatIds(criteria);
    const root = this.doc.querySelector(TRADE_RESULTS_SELECTOR);
    if (root) this.apply(root);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.removeHighlights();
      return;
    }
    const root = this.doc.querySelector(TRADE_RESULTS_SELECTOR);
    if (root) this.apply(root);
  }

  apply(container: Element): void {
    if (!this.enabled) return;

    const targets = new Map<Element, boolean>();
    container
      .querySelectorAll('.poexd-filter-mod-highlight')
      .forEach((element) => targets.set(element, false));
    container.querySelectorAll('[data-field]').forEach((element) => {
      const target = element.parentElement;
      if (!target || target.tagName !== 'DIV') return;
      const dataField = element.getAttribute('data-field');
      const shouldHighlight =
        !!dataField && this.activeStatIds.has(normalizeDataFieldId(dataField));
      targets.set(target, (targets.get(target) ?? false) || shouldHighlight);
    });
    targets.forEach((shouldHighlight, target) => {
      target.classList.toggle('poexd-filter-mod-highlight', shouldHighlight);
    });
    ensureResultEnhancementStyle('mod-highlight', this.doc);
  }

  cleanup(): void {
    this.enabled = false;
    this.activeStatIds.clear();
    this.removeHighlights();
    removeResultEnhancementStyle('mod-highlight', this.doc);
  }

  private removeHighlights(): void {
    this.doc
      .querySelector(TRADE_RESULTS_SELECTOR)
      ?.querySelectorAll('.poexd-filter-mod-highlight')
      .forEach((element) => {
        element.classList.remove('poexd-filter-mod-highlight');
      });
  }
}

export function extractEnabledStatIds(criteria: unknown): Set<string> {
  const stats = isRecord(criteria) && Array.isArray(criteria.stats) ? criteria.stats : [];
  const ids = new Set<string>();
  stats.forEach((group) => {
    if (!isRecord(group) || group.disabled === true || !Array.isArray(group.filters)) return;
    group.filters.forEach((filter: unknown) => {
      if (isRecord(filter) && filter.disabled !== true && typeof filter.id === 'string') {
        ids.add(filter.id);
      }
    });
  });
  return ids;
}

function normalizeDataFieldId(dataField: string): string {
  return dataField.startsWith('stat.') ? dataField.slice('stat.'.length) : dataField;
}

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
