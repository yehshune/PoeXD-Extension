function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
    node = node.parentElement;
  }
  return null;
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

/** 把設定區塊捲到捲動區頂端（保留捲動區上方內距）；區塊隱藏時不動作。 */
export function scrollToSettingsSection(root: HTMLElement | null, sectionId: string): void {
  const el = root?.querySelector<HTMLElement>(`[data-settings-section="${sectionId}"]`);
  if (!el || el.offsetParent === null) return;
  const scrollParent = findScrollParent(el);
  if (!scrollParent) return;
  const paddingTop = parseFloat(getComputedStyle(scrollParent).paddingTop) || 0;
  const offset =
    el.getBoundingClientRect().top - scrollParent.getBoundingClientRect().top - paddingTop;
  scrollParent.scrollTo({
    top: Math.max(0, scrollParent.scrollTop + offset),
    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
  });
}
