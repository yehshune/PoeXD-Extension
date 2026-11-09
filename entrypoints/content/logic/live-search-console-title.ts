import { t, bindDocumentLocaleMeta } from '@/utils/i18n';

export const LIVE_SEARCH_CONSOLE_TITLE = '線上搜尋主控台';

export interface LiveSearchConsoleTitleGuard {
  start(): void;
  dispose(): void;
}

export function createLiveSearchConsoleTitleGuard(
  doc: Document = document,
  version?: 'poe1' | 'poe2',
): LiveSearchConsoleTitleGuard {
  let observer: MutationObserver | null = null;
  let unsubLocale: (() => void) | null = null;
  let disposed = false;

  function expectedTitle(): string {
    return t('liveSearch.console.title');
  }

  function enforceTitle(): void {
    if (disposed) return;
    const title = expectedTitle();
    if (doc.title !== title) {
      doc.title = title;
    }
  }

  function start(): void {
    disposed = false;
    enforceTitle();

    unsubLocale?.();
    unsubLocale = bindDocumentLocaleMeta(() => expectedTitle(), doc);

    if (observer || typeof MutationObserver === 'undefined') {
      return;
    }

    const target = doc.head || doc.documentElement;
    if (!target) return;

    observer = new MutationObserver(() => {
      enforceTitle();
    });

    observer.observe(target, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  function dispose(): void {
    disposed = true;
    unsubLocale?.();
    unsubLocale = null;
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  return {
    start,
    dispose,
  };
}
