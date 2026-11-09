import { ref, watch, type Ref, type ComputedRef } from 'vue';

export interface FilterNavigationCategoryGroup {
  label: string;
}

export interface UseFilterNavigationOptions<
  T extends FilterNavigationCategoryGroup = FilterNavigationCategoryGroup,
> {
  groupedAffixes: ComputedRef<T[]> | Ref<T[]>;
  expandedCategories: Ref<Set<string>>;
  expandedKeys: Ref<Set<string>>;
  getCategoryLabel: (affinity: string) => string;
}

export function useFilterNavigation<
  T extends FilterNavigationCategoryGroup = FilterNavigationCategoryGroup,
>({
  groupedAffixes,
  expandedCategories,
  expandedKeys,
  getCategoryLabel,
}: UseFilterNavigationOptions<T>) {
  const currentActiveCategory = ref('');
  const navAnchorsRef = ref<HTMLElement | null>(null);
  const scrollContainerRef = ref<HTMLElement | null>(null);

  const scrollToCategory = (label: string) => {
    const container = scrollContainerRef.value;
    if (!container) return;

    const target = container.querySelector(`[id="category_${label}"]`) as HTMLElement | null;
    if (target) {
      const containerRect = container.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const relativeTop = targetRect.top - containerRect.top + container.scrollTop;

      container.scrollTop = relativeTop;
    }
  };

  const handleScroll = () => {
    const container = scrollContainerRef.value;
    if (!container) return;

    const isAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 10;
    if (isAtBottom && groupedAffixes.value.length > 0) {
      currentActiveCategory.value = groupedAffixes.value[groupedAffixes.value.length - 1].label;
      return;
    }

    const headers = container.querySelectorAll<HTMLElement>('.group-header');
    let activeLabel = '';

    headers.forEach((header) => {
      const id = header.id;
      if (!id || !id.startsWith('category_')) return;
      const label = id.replace('category_', '');

      const rect = header.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const relativeTop = rect.top - containerRect.top;

      if (relativeTop <= 50) {
        activeLabel = label;
      }
    });

    if (!activeLabel && groupedAffixes.value.length > 0) {
      activeLabel = groupedAffixes.value[0].label;
    }

    currentActiveCategory.value = activeLabel;
  };

  watch(currentActiveCategory, (newCat) => {
    if (!newCat) return;
    setTimeout(() => {
      const container = navAnchorsRef.value;
      if (container) {
        const activeAnchor = container.querySelector(
          '.anchor-btn-inline.active',
        ) as HTMLElement | null;
        if (activeAnchor) {
          activeAnchor.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }
    }, 50);
  });

  const scrollToMod = (modId: string, affinity: string) => {
    const label = getCategoryLabel(affinity);
    if (!expandedCategories.value.has(label)) {
      expandedCategories.value.add(label);
    }
    if (!expandedKeys.value.has(modId)) {
      expandedKeys.value.add(modId);
    }
    setTimeout(() => {
      const container = scrollContainerRef.value;
      if (!container) return;
      const target = container.querySelector(`[id="mod_container_${modId}"]`) as HTMLElement | null;
      if (target) {
        const containerRect = container.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const relativeTop = targetRect.top - containerRect.top + container.scrollTop;
        container.scrollTop = relativeTop;
      }
    }, 50);
  };

  return {
    navAnchorsRef,
    scrollContainerRef,
    currentActiveCategory,
    scrollToCategory,
    scrollToMod,
    handleScroll,
  };
}
