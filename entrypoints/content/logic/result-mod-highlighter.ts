type UnknownRecord = Record<string, any>;

export class ResultModHighlighter {
  private enabled = false;
  private activeStatIds = new Set<string>();

  handleSearchQuery(_searchId: string, criteria: unknown) {
    this.activeStatIds = extractEnabledStatIds(criteria);
    const root = document.querySelector('.results');
    if (root) this.apply(root);
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) {
      removeHighlights();
      return;
    }
    const root = document.querySelector('.results');
    if (root) this.apply(root);
  }

  apply(container: Element) {
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
    ensureHighlightStyle();
  }

  cleanup() {
    this.enabled = false;
    this.activeStatIds.clear();
    removeHighlights();
    document.getElementById('poexd-filter-mod-highlight-style')?.remove();
  }
}

export function extractEnabledStatIds(criteria: unknown) {
  const stats = isRecord(criteria) && Array.isArray(criteria.stats) ? criteria.stats : [];
  const ids = new Set<string>();
  stats.forEach((group) => {
    if (!isRecord(group) || group.disabled === true || !Array.isArray(group.filters)) return;
    group.filters.forEach((filter: unknown) => {
      if (isRecord(filter) && filter.disabled !== true && typeof filter.id === 'string')
        ids.add(filter.id);
    });
  });
  return ids;
}

function normalizeDataFieldId(dataField: string) {
  return dataField.startsWith('stat.') ? dataField.slice('stat.'.length) : dataField;
}

function removeHighlights() {
  document.querySelectorAll('.poexd-filter-mod-highlight').forEach((element) => {
    element.classList.remove('poexd-filter-mod-highlight');
  });
}

function ensureHighlightStyle() {
  const existing = document.getElementById('poexd-filter-mod-highlight-style');
  if (existing) return;
  const style = document.createElement('style');
  style.id = 'poexd-filter-mod-highlight-style';
  style.textContent = `
    .poexd-filter-mod-highlight {
      box-shadow: 0 0 20px oklch(0.70 0.12 265 / 0.25), 0 10px 30px oklch(0.10 0.02 265 / 0.6);
      background-color: oklch(0.25 0.05 260 / 0.53);
      border: 1px solid oklch(0.85 0.08 265 / 0.65);
      padding: 5px;
      margin: 5px 0;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
}

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
