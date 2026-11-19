import { onMounted, onUnmounted, ref, type Ref } from 'vue';
import { SETTINGS_SECTION_IDS, type SettingsSectionId } from '@/utils/sidebar-modules';

const HIGHLIGHT_DURATION_MS = 1700;
/** 區塊標題與固定工具列之間保留的距離 */
const SCROLL_GAP_PX = 8;

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
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * 設定分頁的區塊跳轉與捲動追蹤：工具列上的區塊按鈕跟著捲動位置亮起，
 * 點擊或從其他分頁跳來時捲到該區塊並短暫標示。
 */
export function useSettingsNavigation(
  toolbarRef: Ref<HTMLElement | null>,
  sectionsRef: Ref<HTMLElement | null>,
) {
  const activeSection = ref<SettingsSectionId>(SETTINGS_SECTION_IDS[0]);
  const highlightedSection = ref<SettingsSectionId | null>(null);
  let scrollParent: HTMLElement | null = null;
  let highlightTimer: ReturnType<typeof setTimeout> | null = null;
  let frame: number | null = null;

  const getSectionEl = (id: SettingsSectionId) =>
    sectionsRef.value?.querySelector<HTMLElement>(`[data-settings-section="${id}"]`) ?? null;

  const toolbarBottom = () =>
    (toolbarRef.value?.getBoundingClientRect().bottom ?? 0) + SCROLL_GAP_PX;

  const updateActiveSection = () => {
    frame = null;
    if (!scrollParent) return;
    const threshold = toolbarBottom() + 1;
    const atBottom =
      scrollParent.scrollTop + scrollParent.clientHeight >= scrollParent.scrollHeight - 2;
    let current: SettingsSectionId = SETTINGS_SECTION_IDS[0];
    for (const id of SETTINGS_SECTION_IDS) {
      const el = getSectionEl(id);
      if (!el || el.offsetParent === null) continue;
      if (atBottom || el.getBoundingClientRect().top <= threshold) current = id;
    }
    activeSection.value = current;
  };

  const handleScroll = () => {
    if (frame !== null) return;
    frame = window.requestAnimationFrame(updateActiveSection);
  };

  const flash = (id: SettingsSectionId) => {
    if (highlightTimer) clearTimeout(highlightTimer);
    highlightedSection.value = null;
    // 先清掉再設定，連續點同一區塊也能重播標示
    window.requestAnimationFrame(() => {
      highlightedSection.value = id;
      highlightTimer = setTimeout(() => {
        highlightedSection.value = null;
        highlightTimer = null;
      }, HIGHLIGHT_DURATION_MS);
    });
  };

  const scrollToSection = (id: SettingsSectionId, { highlight = false } = {}) => {
    const el = getSectionEl(id);
    activeSection.value = id;
    if (!el) return;
    scrollParent ??= findScrollParent(sectionsRef.value);
    if (scrollParent) {
      const delta = el.getBoundingClientRect().top - toolbarBottom();
      scrollParent.scrollTo({
        top: scrollParent.scrollTop + delta,
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      });
    }
    if (highlight) flash(id);
  };

  onMounted(() => {
    scrollParent = findScrollParent(sectionsRef.value);
    scrollParent?.addEventListener('scroll', handleScroll, { passive: true });
  });

  onUnmounted(() => {
    scrollParent?.removeEventListener('scroll', handleScroll);
    if (frame !== null) window.cancelAnimationFrame(frame);
    if (highlightTimer) clearTimeout(highlightTimer);
  });

  return { activeSection, highlightedSection, scrollToSection };
}
