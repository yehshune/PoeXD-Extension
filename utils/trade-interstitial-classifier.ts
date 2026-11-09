export type DocumentBoundaryStatus = 'trade' | 'challenge' | 'undetermined';

export function classifyTradeDocumentSync(
  docObj?: Pick<Document, 'querySelector' | 'title'>,
  locationObj?: { search?: string; href?: string },
): DocumentBoundaryStatus {
  const loc = locationObj || (typeof window !== 'undefined' ? window.location : undefined);
  const search = loc?.search || '';
  const href = loc?.href || '';

  // 1. Cloudflare challenge URL markers
  if (search.includes('__cf_chl_') || href.includes('__cf_chl_')) {
    return 'challenge';
  }

  const doc = docObj || (typeof document !== 'undefined' ? document : undefined);
  if (!doc) {
    return 'undetermined';
  }

  // 2. Cloudflare challenge DOM or Title markers
  try {
    if (
      doc.querySelector?.(
        '#challenge-running, #challenge-stage, #challenge-form, .cf-turnstile, #cf-wrapper, #cf-challenge-running, script[src*="challenges.cloudflare.com"], script[src*="challenge-platform"]',
      )
    ) {
      return 'challenge';
    }
  } catch {}

  const title = typeof doc.title === 'string' ? doc.title : '';
  if (
    title.includes('Just a moment...') ||
    title.includes('Attention Required!') ||
    title.includes('Cloudflare')
  ) {
    return 'challenge';
  }

  // 3. Genuine PoE Trade Document markers (present in early static HTML skeleton)
  try {
    if (doc.querySelector?.('#trade, #trade2, #app, .layout, .content, .search-advanced-items')) {
      return 'trade';
    }
  } catch {}

  if (title.includes('Path of Exile') || title.includes('流亡黯道') || title.includes('Trade -')) {
    return 'trade';
  }

  try {
    if (doc.querySelector?.('script[src*="trade"], link[href*="trade"], meta[name="csrf-token"]')) {
      return 'trade';
    }
  } catch {}

  return 'undetermined';
}

export function isCloudflareChallenge(
  locationObj?: { search?: string; href?: string },
  docObj?: Pick<Document, 'querySelector' | 'title'>,
): boolean {
  return classifyTradeDocumentSync(docObj, locationObj) === 'challenge';
}

export function waitForDocumentBoundary(
  doc: Document = document,
  loc: { search?: string; href?: string } = window.location,
): Promise<'trade' | 'challenge'> {
  return new Promise((resolve) => {
    const immediate = classifyTradeDocumentSync(doc, loc);
    if (immediate !== 'undetermined') {
      resolve(immediate);
      return;
    }

    // 若文檔已經進入 interactive 或 complete，不再等待 DOMContentLoaded，立即決策避免永久 pending
    if (doc?.readyState === 'interactive' || doc?.readyState === 'complete') {
      const finalStatus = classifyTradeDocumentSync(doc, loc);
      resolve(finalStatus === 'trade' ? 'trade' : 'challenge');
      return;
    }

    let observer: MutationObserver | null = null;
    let finished = false;

    const finalize = (status: 'trade' | 'challenge') => {
      if (finished) return;
      finished = true;
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      doc.removeEventListener?.('DOMContentLoaded', onDomReady);
      resolve(status);
    };

    const check = () => {
      const current = classifyTradeDocumentSync(doc, loc);
      if (current !== 'undetermined') {
        finalize(current);
      }
    };

    const onDomReady = () => {
      const finalStatus = classifyTradeDocumentSync(doc, loc);
      if (finalStatus === 'trade') {
        finalize('trade');
      } else {
        // 若 DOM 完全解析完畢仍無 trade 標記，視為 pass-through
        finalize('challenge');
      }
    };

    doc.addEventListener?.('DOMContentLoaded', onDomReady, { once: true });

    if (typeof MutationObserver !== 'undefined' && doc) {
      observer = new MutationObserver(() => {
        check();
      });

      // 關鍵：直接監聽 doc（Document 實作了 Node 介面），
      // 即使在 document_start 當下 doc.documentElement 尚不存在，
      // 只要 parser 插入 <html> 或任何子節點，subtree 監聽便能立即同步捕獲！
      try {
        observer.observe(doc, { childList: true, subtree: true });
      } catch {
        // Fallback：若環境限制不能 observe doc，則退回 observe doc.documentElement
        if (doc.documentElement) {
          try {
            observer.observe(doc.documentElement, { childList: true, subtree: true });
          } catch {}
        }
      }
    }
  });
}
