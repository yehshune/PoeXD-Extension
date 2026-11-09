import {
  clearStatGroupTemplateSlots,
  syncStatGroupTemplateSlots,
} from '@/utils/stat-group-template-slot-registry';

export const STAT_GROUP_TEMPLATE_SLOT_CLASS = 'poexd-stat-group-template-slot';

/**
 * 官方詞綴區（brown pane）底部的「新增屬性組合」控制項。
 * 以官方 class 定位而非 placeholder，因為 placeholder 會隨語系與漢化外掛改變。
 * 實際結構：`.search-advanced-pane.brown > .filter.filter-padded > span.filter-body > .filter-group-select`。
 */
export const ADD_STAT_GROUP_SELECTOR = '.search-advanced-pane.brown .filter-group-select';

/** 官方以 `margin-left: 50%` 把控制項推到右半邊，插入點佔用左半邊並靠右貼齊控制項。 */
const SLOT_STYLE = [
  'float: left',
  'width: 50%',
  'box-sizing: border-box',
  'display: flex',
  'justify-content: flex-end',
  'align-items: stretch',
  'padding-right: 4px',
].join('; ');

function isLiveSearchConsole(doc: Document): boolean {
  return doc.body?.getAttribute('data-poexd-page-role') === 'live-search-primary';
}

/** 控制項所在的整列容器（`span.filter-body`）；結構不符時退回控制項本身。 */
function anchorOf(control: HTMLElement): HTMLElement {
  return control.closest<HTMLElement>('.filter-body') ?? control;
}

function isSlotFor(slot: Element | null | undefined): boolean {
  const next = slot?.nextElementSibling;
  if (!next) return false;
  // 子樹查詢的選擇器跨越祖先時各環境行為不一，改為逐一比對完整選擇器
  return (
    next.matches(ADD_STAT_GROUP_SELECTOR) ||
    Array.from(next.querySelectorAll('.filter-group-select')).some((el) =>
      el.matches(ADD_STAT_GROUP_SELECTOR),
    )
  );
}

function createSlot(doc: Document, anchor: HTMLElement): HTMLElement {
  const slot = doc.createElement('span');
  slot.className = STAT_GROUP_TEMPLATE_SLOT_CLASS;
  // 內容腳本的 CSS 只注入 shadow root，官方頁面上的元素必須用 inline style
  slot.setAttribute('style', SLOT_STYLE);
  anchor.insertAdjacentElement('beforebegin', slot);
  return slot;
}

/** 插入點是浮動元素，不會被整列撐高；同步成官方控制項的高度，讓按鈕上下對齊。 */
function matchControlHeight(slot: HTMLElement, control: HTMLElement): void {
  const height = control.getBoundingClientRect().height;
  const next = height > 0 ? `${Math.round(height)}px` : '';
  if (slot.style.height !== next) slot.style.height = next;
}

/**
 * 在每個官方「新增屬性組合」控制項左側建立常用詞綴群組選單的插入點並同步到 registry。
 * 線上搜尋主控台不插入。
 */
export function injectStatGroupTemplateSlots(doc: Document = document): void {
  if (isLiveSearchConsole(doc)) {
    cleanStatGroupTemplateSlots(doc);
    return;
  }
  doc.querySelectorAll<HTMLElement>(ADD_STAT_GROUP_SELECTOR).forEach((control) => {
    const anchor = anchorOf(control);
    const existing = anchor.previousElementSibling;
    const slot = existing?.classList.contains(STAT_GROUP_TEMPLATE_SLOT_CLASS)
      ? (existing as HTMLElement)
      : createSlot(doc, anchor);
    matchControlHeight(slot, control);
  });
  syncStatGroupTemplateSlots(
    Array.from(doc.querySelectorAll<HTMLElement>(`.${STAT_GROUP_TEMPLATE_SLOT_CLASS}`)).filter(
      isSlotFor,
    ),
  );
}

export function cleanStatGroupTemplateSlots(doc: Document = document): void {
  clearStatGroupTemplateSlots();
  doc.querySelectorAll(`.${STAT_GROUP_TEMPLATE_SLOT_CLASS}`).forEach((el) => el.remove());
}
