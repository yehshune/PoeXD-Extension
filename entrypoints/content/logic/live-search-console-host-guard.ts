import { dispatchPoeEvent } from '@/utils/event-contracts';

export const OFFICIAL_SEARCH_CONTROL_SELECTORS = [
  '.search-panel .controls button.search-btn',
  '.search-panel .controls .search-btn',
  '.search-panel .controls button.livesearch-btn',
  '.search-panel .controls .livesearch-btn',
].join(', ');

export const OFFICIAL_SEARCH_CONTAINER_SELECTORS = [
  '.search-panel .search-bar',
  '.search-panel .search-advanced',
  '.search-panel .controls',
  '.search-panel',
].join(', ');

export const OFFICIAL_ENTER_SEARCH_INPUT_SELECTOR =
  '.search-panel .search-advanced input.form-control';

export const OFFICIAL_NON_RESULT_CHROME_SELECTORS = [
  '#statusBar',
  '.wrapper > .linkBack',
  '.linkBack',
  '.wrapper > .logo',
  '.logo',
  '.wrapper > .language-select',
  '.language-select',
  '#trade > .navigation',
  '#trade > .top',
  '#trade .search-panel',
  '.search-panel',
  '.content > .bottom',
].join(', ');

export const PRESERVED_CONSOLE_RESULT_SELECTORS = [
  '#vue3-portal',
  '.results',
  '#poe-popup-container',
  '.popup-manager',
  '#cboxOverlay',
  '#colorbox',
  '.toast-container',
  'button.top-btn',
  'poexd-sidebar-container',
  'poexd-toast-container',
  '.pxd-sidebar-wrapper',
  '[data-sidebar-pane]',
].join(', ');

export const REQUIRED_CONSOLE_ANCESTOR_SELECTORS = [
  'html',
  'body',
  '.container-fluid',
  '.content',
  '.wrapper',
  '#trade',
  '#app',
].join(', ');

const POEXD_SIDEBAR_SELECTORS =
  'poexd-sidebar-container, poexd-toast-container, .pxd-sidebar-wrapper, [data-sidebar-pane]';
const GUARDED_ATTR = 'data-poexd-console-guarded';
const HIDDEN_ATTR = 'data-poexd-console-hidden';
export const CONSOLE_RESULT_ONLY_ATTR = 'data-poexd-console-result-only';
export const CONSOLE_RESULT_ONLY_STYLE_ID = 'poexd-console-result-only-style';
const GUARDED_TITLE = '線上搜尋主控台已停用官方搜尋操作';

const CONSOLE_RESULT_ONLY_CSS = `
html[${CONSOLE_RESULT_ONLY_ATTR}="true"] #statusBar,
html[${CONSOLE_RESULT_ONLY_ATTR}="true"] .wrapper > .linkBack,
html[${CONSOLE_RESULT_ONLY_ATTR}="true"] .wrapper > .logo,
html[${CONSOLE_RESULT_ONLY_ATTR}="true"] .wrapper > .language-select,
html[${CONSOLE_RESULT_ONLY_ATTR}="true"] #trade > .navigation,
html[${CONSOLE_RESULT_ONLY_ATTR}="true"] #trade > .top,
html[${CONSOLE_RESULT_ONLY_ATTR}="true"] #trade .search-panel,
html[${CONSOLE_RESULT_ONLY_ATTR}="true"] .content > .bottom,
html[${CONSOLE_RESULT_ONLY_ATTR}="true"] [${HIDDEN_ATTR}="true"] {
  display: none !important;
  visibility: hidden !important;
  pointer-events: none !important;
}
`.trim();

interface OriginalElementState {
  disabled?: boolean;
  ariaDisabled: string | null;
  title: string | null;
  opacity: string;
  cursor: string;
}

interface OriginalHiddenElementState {
  ariaHidden: string | null;
  displayValue: string;
  displayPriority: string;
  visibilityValue: string;
  visibilityPriority: string;
  pointerEventsValue: string;
  pointerEventsPriority: string;
}

export interface LiveSearchConsoleHostGuardOptions {
  doc?: Document;
  dispatchGuardState?: (active: boolean) => void;
}

export interface LiveSearchConsoleHostGuard {
  start(): void;
  dispose(): void;
}

export function createLiveSearchConsoleHostGuard(
  options?: LiveSearchConsoleHostGuardOptions,
): LiveSearchConsoleHostGuard {
  const doc = options?.doc ?? document;
  const dispatchGuardState =
    options?.dispatchGuardState ??
    ((active: boolean) => {
      dispatchPoeEvent('poexd-livesearch-console-guard', { active });
    });

  const originalStates = new WeakMap<HTMLElement, OriginalElementState>();
  const guardedElements = new Set<HTMLElement>();
  const originalHiddenStates = new WeakMap<HTMLElement, OriginalHiddenElementState>();
  const hiddenElements = new Set<HTMLElement>();
  let styleElement: HTMLStyleElement | null = null;
  let observer: MutationObserver | null = null;
  let started = false;
  let disposed = false;
  let isApplyingDomGuard = false;

  const isInsidePoeXdSidebar = (node: EventTarget | null): boolean => {
    if (!node || !(node instanceof Element)) return false;
    return Boolean(node.closest(POEXD_SIDEBAR_SELECTORS));
  };

  const isInsidePreservedSurface = (node: EventTarget | null): boolean => {
    if (!node || !(node instanceof Element)) return false;
    return Boolean(node.closest(PRESERVED_CONSOLE_RESULT_SELECTORS));
  };

  const shouldHideConsoleChromeElement = (el: HTMLElement): boolean => {
    if (isInsidePoeXdSidebar(el)) return false;
    if (isInsidePreservedSurface(el)) return false;
    if (el.matches(REQUIRED_CONSOLE_ANCESTOR_SELECTORS)) return false;
    if (el.querySelector(PRESERVED_CONSOLE_RESULT_SELECTORS)) return false;
    return true;
  };

  const isOfficialSearchControl = (node: EventTarget | null): HTMLElement | null => {
    if (!node || !(node instanceof Element)) return null;
    if (isInsidePoeXdSidebar(node) || isInsidePreservedSurface(node)) return null;
    return node.closest<HTMLElement>(OFFICIAL_SEARCH_CONTROL_SELECTORS);
  };

  const isInsideHiddenConsoleChrome = (node: EventTarget | null): boolean => {
    if (!node || !(node instanceof Element)) return false;
    if (isInsidePoeXdSidebar(node) || isInsidePreservedSurface(node)) return false;
    const matched = node.closest<HTMLElement>(
      `[${HIDDEN_ATTR}="true"], ${OFFICIAL_NON_RESULT_CHROME_SELECTORS}`,
    );
    if (!matched) return false;
    return shouldHideConsoleChromeElement(matched);
  };

  const isBlockedHostNavigationLink = (node: EventTarget | null): boolean => {
    if (!node || !(node instanceof Element)) return false;
    if (isInsidePoeXdSidebar(node)) return false;
    const anchor = node.closest<HTMLAnchorElement>('a[href]');
    if (!anchor) return false;
    const rawHref = (anchor.getAttribute('href') || '').trim();
    if (!rawHref || rawHref.startsWith('#') || rawHref.toLowerCase().startsWith('javascript:')) {
      return false;
    }
    const target = (anchor.getAttribute('target') || '').trim().toLowerCase();
    if (target === '_blank' && isInsidePreservedSurface(anchor)) {
      return false;
    }
    return true;
  };

  const isInsideOfficialSearchContainer = (node: EventTarget | null): boolean => {
    if (!node || !(node instanceof Element)) return false;
    if (isInsidePoeXdSidebar(node) || isInsidePreservedSurface(node)) return false;
    return Boolean(
      node.closest(OFFICIAL_SEARCH_CONTAINER_SELECTORS) ||
      node.closest(OFFICIAL_SEARCH_CONTROL_SELECTORS) ||
      isInsideHiddenConsoleChrome(node),
    );
  };

  const isOfficialEnterSearchTarget = (node: EventTarget | null): boolean => {
    if (!node || !(node instanceof Element)) return false;
    if (isInsidePoeXdSidebar(node)) return false;
    if (node === doc.body || node.tagName.toLowerCase() === 'body') {
      return true;
    }
    if (isInsidePreservedSurface(node)) return false;
    return node.matches(OFFICIAL_ENTER_SEARCH_INPUT_SELECTOR) || isInsideHiddenConsoleChrome(node);
  };

  const ensureResultOnlyStyleAndRootAttrs = () => {
    if (
      doc.documentElement &&
      doc.documentElement.getAttribute(CONSOLE_RESULT_ONLY_ATTR) !== 'true'
    ) {
      doc.documentElement.setAttribute(CONSOLE_RESULT_ONLY_ATTR, 'true');
    }
    if (doc.body && doc.body.getAttribute(CONSOLE_RESULT_ONLY_ATTR) !== 'true') {
      doc.body.setAttribute(CONSOLE_RESULT_ONLY_ATTR, 'true');
    }
    if (!styleElement || !styleElement.isConnected) {
      const existing = doc.getElementById(CONSOLE_RESULT_ONLY_STYLE_ID) as HTMLStyleElement | null;
      if (existing) {
        styleElement = existing;
      } else {
        styleElement = doc.createElement('style');
        styleElement.id = CONSOLE_RESULT_ONLY_STYLE_ID;
        styleElement.textContent = CONSOLE_RESULT_ONLY_CSS;
        const mountTarget = doc.head || doc.documentElement || doc.body;
        mountTarget?.appendChild(styleElement);
      }
    }
  };

  const applyHiddenToChromeElement = (el: HTMLElement) => {
    if (!shouldHideConsoleChromeElement(el)) return;

    if (!originalHiddenStates.has(el)) {
      originalHiddenStates.set(el, {
        ariaHidden: el.getAttribute('aria-hidden'),
        displayValue: el.style.getPropertyValue('display'),
        displayPriority: el.style.getPropertyPriority('display'),
        visibilityValue: el.style.getPropertyValue('visibility'),
        visibilityPriority: el.style.getPropertyPriority('visibility'),
        pointerEventsValue: el.style.getPropertyValue('pointer-events'),
        pointerEventsPriority: el.style.getPropertyPriority('pointer-events'),
      });
    }

    hiddenElements.add(el);

    if (el.getAttribute(HIDDEN_ATTR) !== 'true') {
      el.setAttribute(HIDDEN_ATTR, 'true');
    }
    if (el.getAttribute('aria-hidden') !== 'true') {
      el.setAttribute('aria-hidden', 'true');
    }
    if (
      el.style.getPropertyValue('display') !== 'none' ||
      el.style.getPropertyPriority('display') !== 'important'
    ) {
      el.style.setProperty('display', 'none', 'important');
    }
    if (
      el.style.getPropertyValue('visibility') !== 'hidden' ||
      el.style.getPropertyPriority('visibility') !== 'important'
    ) {
      el.style.setProperty('visibility', 'hidden', 'important');
    }
    if (
      el.style.getPropertyValue('pointer-events') !== 'none' ||
      el.style.getPropertyPriority('pointer-events') !== 'important'
    ) {
      el.style.setProperty('pointer-events', 'none', 'important');
    }
  };

  const applyGuardToElement = (el: HTMLElement) => {
    if (isInsidePoeXdSidebar(el) || isInsidePreservedSurface(el)) return;

    if (!originalStates.has(el)) {
      originalStates.set(el, {
        disabled: el instanceof HTMLButtonElement ? el.disabled : undefined,
        ariaDisabled: el.getAttribute('aria-disabled'),
        title: el.getAttribute('title'),
        opacity: el.style.opacity,
        cursor: el.style.cursor,
      });
    }

    guardedElements.add(el);

    if (el.getAttribute(GUARDED_ATTR) !== 'true') {
      el.setAttribute(GUARDED_ATTR, 'true');
    }
    if (el.getAttribute('aria-disabled') !== 'true') {
      el.setAttribute('aria-disabled', 'true');
    }
    if (el.getAttribute('title') !== GUARDED_TITLE) {
      el.setAttribute('title', GUARDED_TITLE);
    }
    if (el instanceof HTMLButtonElement && !el.disabled) {
      el.disabled = true;
    }
    if (el.style.opacity !== '0.45') {
      el.style.opacity = '0.45';
    }
    if (el.style.cursor !== 'not-allowed') {
      el.style.cursor = 'not-allowed';
    }
  };

  const scanAndGuardControls = () => {
    if (disposed || isApplyingDomGuard) return;
    isApplyingDomGuard = true;
    try {
      ensureResultOnlyStyleAndRootAttrs();
      const chromeElements = doc.querySelectorAll<HTMLElement>(
        OFFICIAL_NON_RESULT_CHROME_SELECTORS,
      );
      chromeElements.forEach((el) => applyHiddenToChromeElement(el));

      const controlElements = doc.querySelectorAll<HTMLElement>(OFFICIAL_SEARCH_CONTROL_SELECTORS);
      controlElements.forEach((el) => applyGuardToElement(el));
    } finally {
      isApplyingDomGuard = false;
    }
  };

  const restoreHiddenElements = () => {
    for (const el of hiddenElements) {
      const orig = originalHiddenStates.get(el);
      el.removeAttribute(HIDDEN_ATTR);
      if (orig) {
        if (orig.ariaHidden === null) {
          el.removeAttribute('aria-hidden');
        } else {
          el.setAttribute('aria-hidden', orig.ariaHidden);
        }
        if (orig.displayValue) {
          el.style.setProperty('display', orig.displayValue, orig.displayPriority);
        } else {
          el.style.removeProperty('display');
        }
        if (orig.visibilityValue) {
          el.style.setProperty('visibility', orig.visibilityValue, orig.visibilityPriority);
        } else {
          el.style.removeProperty('visibility');
        }
        if (orig.pointerEventsValue) {
          el.style.setProperty(
            'pointer-events',
            orig.pointerEventsValue,
            orig.pointerEventsPriority,
          );
        } else {
          el.style.removeProperty('pointer-events');
        }
        originalHiddenStates.delete(el);
      }
    }
    hiddenElements.clear();

    doc.documentElement?.removeAttribute(CONSOLE_RESULT_ONLY_ATTR);
    doc.body?.removeAttribute(CONSOLE_RESULT_ONLY_ATTR);
    if (styleElement) {
      styleElement.remove();
      styleElement = null;
    }
    const leftoverStyle = doc.getElementById(CONSOLE_RESULT_ONLY_STYLE_ID);
    leftoverStyle?.remove();
  };

  const restoreGuardedElements = () => {
    for (const el of guardedElements) {
      const orig = originalStates.get(el);
      el.removeAttribute(GUARDED_ATTR);
      if (orig) {
        if (orig.ariaDisabled === null) {
          el.removeAttribute('aria-disabled');
        } else {
          el.setAttribute('aria-disabled', orig.ariaDisabled);
        }
        if (orig.title === null) {
          el.removeAttribute('title');
        } else {
          el.setAttribute('title', orig.title);
        }
        if (el instanceof HTMLButtonElement && orig.disabled !== undefined) {
          el.disabled = orig.disabled;
        }
        el.style.opacity = orig.opacity;
        el.style.cursor = orig.cursor;
        originalStates.delete(el);
      }
    }
    guardedElements.clear();
  };

  const handleCaptureClick = (e: MouseEvent) => {
    if (disposed) return;
    if (isInsidePoeXdSidebar(e.target)) return;
    if (
      isOfficialSearchControl(e.target) ||
      isInsideHiddenConsoleChrome(e.target) ||
      isBlockedHostNavigationLink(e.target)
    ) {
      e.preventDefault();
      e.stopImmediatePropagation();
      e.stopPropagation();
    }
  };

  const handleCaptureSubmit = (e: Event) => {
    if (disposed) return;
    if (isInsidePoeXdSidebar(e.target)) return;
    if (isInsideOfficialSearchContainer(e.target)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      e.stopPropagation();
    }
  };

  const handleCaptureKeydown = (e: KeyboardEvent) => {
    if (disposed || e.key !== 'Enter') return;
    if (isOfficialEnterSearchTarget(e.target)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      e.stopPropagation();
    }
  };

  const start = () => {
    if (started || disposed) return;
    started = true;

    dispatchGuardState(true);
    scanAndGuardControls();

    doc.addEventListener('click', handleCaptureClick, true);
    doc.addEventListener('submit', handleCaptureSubmit, true);
    doc.addEventListener('keydown', handleCaptureKeydown, true);

    const root = doc.documentElement || doc.body;
    if (root && typeof MutationObserver !== 'undefined') {
      observer = new MutationObserver(() => {
        scanAndGuardControls();
      });
      observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['disabled', 'class', 'aria-disabled', 'style'],
      });
    }
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;

    if (observer) {
      observer.disconnect();
      observer = null;
    }

    doc.removeEventListener('click', handleCaptureClick, true);
    doc.removeEventListener('submit', handleCaptureSubmit, true);
    doc.removeEventListener('keydown', handleCaptureKeydown, true);

    restoreGuardedElements();
    restoreHiddenElements();

    if (started) {
      dispatchGuardState(false);
    }
  };

  return {
    start,
    dispose,
  };
}
