export interface FilterObserverOptions {
  onRefresh: (generation: number) => void;
  isCurrentGeneration: (generation: number) => boolean;
}

export interface FilterObserver {
  start(generation: number): void;
  stop(): void;
}

function isAuthoritativeAttributeMutation(record: MutationRecord): boolean {
  if (record.type !== 'attributes') return false;
  if (record.attributeName === 'data-poexd-stat-id') {
    const el = record.target as Element;
    return typeof el.getAttribute === 'function' && Boolean(el.getAttribute('data-poexd-stat-id'));
  }
  if (record.attributeName === 'data-poexd-category') {
    return true;
  }
  return false;
}

export function createFilterObserver(options: FilterObserverOptions): FilterObserver {
  let observer: MutationObserver | null = null;
  let initObserverTimer: ReturnType<typeof setTimeout> | undefined;
  let observerDebounceTimer: ReturnType<typeof setTimeout> | undefined;

  const stop = (): void => {
    if (initObserverTimer) {
      clearTimeout(initObserverTimer);
      initObserverTimer = undefined;
    }
    if (observerDebounceTimer) {
      clearTimeout(observerDebounceTimer);
      observerDebounceTimer = undefined;
    }
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  };

  const start = (generation: number): void => {
    stop();

    const searchAdvanced = document.querySelector('.search-advanced-items');
    if (!searchAdvanced) {
      initObserverTimer = setTimeout(() => {
        if (options.isCurrentGeneration(generation)) {
          start(generation);
        }
      }, 100);
      return;
    }

    options.onRefresh(generation);

    observer = new MutationObserver((mutations) => {
      const hasAuthoritativeChange = mutations.some(isAuthoritativeAttributeMutation);

      if (hasAuthoritativeChange) {
        // Authoritative attribute mutation stamped by Main World (e.g. data-poexd-stat-id or category).
        // The filter is immediately ready for Tier controls; cancel any noisy-DOM debounce and refresh immediately.
        if (observerDebounceTimer) {
          clearTimeout(observerDebounceTimer);
          observerDebounceTimer = undefined;
        }
        if (options.isCurrentGeneration(generation)) {
          options.onRefresh(generation);
        }
        return;
      }

      // General noisy DOM / childList mutations remain debounced (50ms) to avoid redundant scans.
      if (observerDebounceTimer) {
        clearTimeout(observerDebounceTimer);
      }
      observerDebounceTimer = setTimeout(() => {
        observerDebounceTimer = undefined;
        if (options.isCurrentGeneration(generation)) {
          options.onRefresh(generation);
        }
      }, 50);
    });

    observer.observe(searchAdvanced, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        'data-poexd-category',
        'data-poexd-stat-id',
        'data-poexd-group-type',
        'data-poexd-mercenary-search',
      ],
    });
  };

  return { start, stop };
}
