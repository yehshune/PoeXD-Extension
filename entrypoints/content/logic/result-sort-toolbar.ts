/**
 * 結果列頂部工具列（`.poexd-total-controls`）與下拉選單 popover DOM 建構與同步輔助。
 *
 * 從 `ResultSortController` 拆離，使排序控制器專注於順序追蹤與 LIS DOM 重排。
 */
import { createSvgIcon, type SvgIconSpec } from '@/utils/safe-dom';
import type { PoeVersion } from '@/utils/trade-context';
import { TRADE_RESULTS_SELECTOR } from '@/utils/trade-results-root';

export interface ToolbarDropdownOption {
  key: string;
  label: string;
  onSelect: () => void;
}

export interface ToolbarDropdownSpec {
  readonly type: 'weapon' | 'armour' | 'sort';
  icon: SvgIconSpec;
  title: string;
  header: string;
  options: ToolbarDropdownOption[];
}

export interface ToolbarDropdownState {
  readonly type: 'weapon' | 'armour' | 'sort';
  currentKey: string;
  options: Array<{ key: string; label: string }>;
  titleText: string;
  headerText: string;
  isActive: boolean;
  hiddenKeys?: ReadonlySet<string>;
}

export function createDropdownElement(doc: Document, spec: ToolbarDropdownSpec): HTMLElement {
  const wrapper = doc.createElement('div');
  wrapper.className = `poexd-btn-wrapper poexd-${spec.type}-wrapper`;
  wrapper.setAttribute('data-control', spec.type);

  const btn = doc.createElement('button');
  btn.type = 'button';
  btn.className = `poexd-icon-btn poexd-${spec.type}-btn`;
  btn.setAttribute('title', spec.title);
  btn.appendChild(createSvgIcon(spec.icon, doc));

  const popover = doc.createElement('div');
  popover.className = `poexd-popover poexd-${spec.type}-popover`;

  const header = doc.createElement('div');
  header.className = 'poexd-popover-header';
  header.textContent = spec.header;
  popover.appendChild(header);

  for (const item of spec.options) {
    const itemEl = doc.createElement('div');
    itemEl.className = 'poexd-popover-item';
    itemEl.setAttribute('data-value', item.key);
    const labelEl = doc.createElement('span');
    labelEl.textContent = item.label;
    const checkMark = doc.createElement('span');
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
    doc.querySelectorAll('.poexd-popover.poexd-open').forEach((el) => {
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

export function mountOrUpdateSortToolbar(
  doc: Document,
  version: PoeVersion,
  includeStats: boolean,
  specs: readonly ToolbarDropdownSpec[],
): HTMLElement | null {
  const rowTotal = doc.querySelector(`${TRADE_RESULTS_SELECTOR} .row.row-total`);
  if (!rowTotal) {
    removeSortToolbar(doc);
    return null;
  }

  const expectedStatsFlag = includeStats ? '1' : '0';
  let controls = doc.querySelector('.poexd-total-controls') as HTMLElement | null;
  if (
    controls &&
    ((controls.dataset?.poexdVersion && controls.dataset.poexdVersion !== version) ||
      (controls.dataset?.poexdHasStats && controls.dataset.poexdHasStats !== expectedStatsFlag))
  ) {
    controls.remove();
    controls = null;
  }

  if (!controls) {
    controls = doc.createElement('div');
    controls.className = 'poexd-total-controls';
    if (controls.dataset) {
      controls.dataset.poexdVersion = version;
      controls.dataset.poexdHasStats = expectedStatsFlag;
    }
    for (const spec of specs) {
      controls.appendChild(createDropdownElement(doc, spec));
    }
    rowTotal.prepend(controls);
  } else if (controls.parentElement !== rowTotal) {
    rowTotal.prepend(controls);
  }

  syncWithNativeLayoutButtons(controls, rowTotal);
  return controls;
}

export function syncSortToolbarStates(
  doc: Document,
  states: readonly ToolbarDropdownState[],
): void {
  const controls = doc.querySelector('.poexd-total-controls');
  if (!controls) return;

  for (const state of states) {
    const btn = controls.querySelector(`.poexd-${state.type}-btn`) as HTMLElement | null;
    if (btn) {
      btn.setAttribute('title', state.titleText);
      btn.classList.toggle('poexd-active', state.isActive);
    }
    const header = controls.querySelector(`.poexd-${state.type}-popover .poexd-popover-header`);
    if (header) {
      header.textContent = state.headerText;
    }
    controls
      .querySelectorAll(`.poexd-${state.type}-popover .poexd-popover-item`)
      .forEach((item) => {
        const val = item.getAttribute('data-value');
        const isHidden = Boolean(state.hiddenKeys && val && state.hiddenKeys.has(val));
        const htmlItem = item as HTMLElement;
        if (htmlItem.style) {
          htmlItem.style.display = isHidden ? 'none' : '';
        }
        const isSelected = val === state.currentKey;
        item.classList.toggle('poexd-selected', isSelected);
        const opt = state.options.find((o) => o.key === val);
        const textSpan = item.querySelector('span');
        if (textSpan && opt) {
          textSpan.textContent = opt.label;
        }
        const check = item.querySelector('.poexd-check-mark');
        if (check) check.textContent = isSelected ? '✓' : '';
      });
  }
}

export function closeOpenPopovers(doc: Document): void {
  doc.querySelectorAll('.poexd-popover.poexd-open').forEach((el) => {
    el.classList.remove('poexd-open');
  });
}

export function removeSortToolbar(doc: Document): void {
  doc
    .querySelectorAll('.poexd-results-toolbar, .poexd-total-controls')
    .forEach((el) => el.remove());
}

function syncWithNativeLayoutButtons(controls: HTMLElement, rowTotal: Element): void {
  if (controls.dataset?.poexdLayoutSynced === '1') return;
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
  if (controls.dataset) {
    controls.dataset.poexdLayoutSynced = '1';
  }
}
