/**
 * 請市集漢化（ADR-0012）翻譯我們自己畫的官方樣式結果卡片，例如 Sidebar 的釘選物品。
 *
 * 結果列翻譯器在 `market-translation` content script 裡，只監看 `document`，
 * 看不到 shadow root 內的節點。卡片以 document 上的事件把根元素交給翻譯器監看；
 * 兩支 content script 在同一個 isolated world，事件的 `detail` 就是同一個元素。
 *
 * 頁面本身也能送出同名事件，但翻譯器只會以官方譯文替換符合結果列選擇器的文字，
 * 不涉及擴充權限或使用者資料。
 */

export const RESULT_TRANSLATION_REQUEST_EVENT = 'poexd-market-translate-results';

/** 翻譯器還沒準備好（或市集漢化未啟用）時最多記住幾個根元素 */
const MAX_PENDING_ROOTS = 200;

/** 請翻譯器翻譯並持續監看 root；市集漢化未啟用時不會有任何效果 */
export function requestResultTranslation(root: Element): void {
  root.ownerDocument.dispatchEvent(
    new CustomEvent(RESULT_TRANSLATION_REQUEST_EVENT, { detail: root }),
  );
}

export interface ResultTranslationRequestReceiver {
  /** 翻譯器準備好後呼叫：先處理已記住的根元素，之後的請求直接交給 observe */
  attach(observe: (root: Element) => void): void;
  dispose(): void;
}

/**
 * 在翻譯器建立前就開始接收請求（卡片可能比翻譯資料先載入）。
 * 以 WeakRef 記住根元素，已移除的卡片不會被留住。
 */
export function receiveResultTranslationRequests(doc: Document): ResultTranslationRequestReceiver {
  let pending: WeakRef<Element>[] = [];
  let observe: ((root: Element) => void) | undefined;
  const observed = new WeakSet<Element>();

  const handle = (root: Element) => {
    if (observed.has(root)) return;
    observed.add(root);
    observe!(root);
  };

  const listener = (event: Event) => {
    const root = (event as CustomEvent<unknown>).detail;
    if (!(root instanceof Element)) return;
    if (observe) {
      handle(root);
      return;
    }
    pending = [...pending.filter((ref) => ref.deref()?.isConnected), new WeakRef(root)].slice(
      -MAX_PENDING_ROOTS,
    );
  };
  doc.addEventListener(RESULT_TRANSLATION_REQUEST_EVENT, listener);

  return {
    attach(next) {
      observe = next;
      const roots = pending.map((ref) => ref.deref()).filter((root) => root?.isConnected);
      pending = [];
      roots.forEach((root) => handle(root!));
    },
    dispose() {
      doc.removeEventListener(RESULT_TRANSLATION_REQUEST_EVENT, listener);
      pending = [];
      observe = undefined;
    },
  };
}
