import { nextTick, ref, type Ref } from 'vue';
import { SETTINGS_SECTION_IDS, type SettingsSectionId } from '@/utils/sidebar-modules';

function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
    node = node.parentElement;
  }
  return null;
}

/** 依方向鍵／Home／End 算出下一個分頁；不是導覽鍵時回傳 null。 */
export function resolveTabKeyTarget(
  key: string,
  current: SettingsSectionId,
): SettingsSectionId | null {
  const index = SETTINGS_SECTION_IDS.indexOf(current);
  const last = SETTINGS_SECTION_IDS.length - 1;
  if (key === 'ArrowRight') return SETTINGS_SECTION_IDS[index === last ? 0 : index + 1];
  if (key === 'ArrowLeft') return SETTINGS_SECTION_IDS[index === 0 ? last : index - 1];
  if (key === 'Home') return SETTINGS_SECTION_IDS[0];
  if (key === 'End') return SETTINGS_SECTION_IDS[last];
  return null;
}

/**
 * 分頁式設定頁：一次只顯示一個區塊。切換時捲回頂端，
 * 鍵盤依 WAI-ARIA Tabs 慣例以方向鍵在分頁間移動。
 */
export function useSettingsTabs(rootRef: Ref<HTMLElement | null>) {
  const activeSection = ref<SettingsSectionId>(SETTINGS_SECTION_IDS[0]);

  const selectSection = (id: SettingsSectionId) => {
    activeSection.value = id;
    void nextTick(() => {
      const scrollParent = findScrollParent(rootRef.value);
      if (scrollParent) scrollParent.scrollTop = 0;
    });
  };

  const handleTabKeydown = (event: KeyboardEvent) => {
    const target = resolveTabKeyTarget(event.key, activeSection.value);
    if (!target) return;
    event.preventDefault();
    selectSection(target);
    void nextTick(() => {
      rootRef.value?.querySelector<HTMLElement>(`[data-settings-tab="${target}"]`)?.focus();
    });
  };

  return { activeSection, selectSection, handleTabKeydown };
}
