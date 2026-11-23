/**
 * 「官方頁面已完成首次載入」的共用訊號。
 *
 * content runtime 以 InitialPageLoadGate 判斷官方元件已掛載、首批結果已處理完後標記；
 * 側邊欄裡的重量級背景工作（例如 PoB 對照資料，解析要佔住主執行緒數百毫秒）等這個訊號再開始，
 * 才不會在官方腳本載入、掛載期間與它爭搶主執行緒，拖慢官方首屏。
 */
export interface InitialPageLoadSignal {
  /** 標記後 resolve；標記前呼叫的也會在標記時一起 resolve */
  wait(): Promise<void>;
  isLoaded(): boolean;
  /** 冪等：只有第一次有作用 */
  markLoaded(): void;
}

export function createInitialPageLoadSignal(): InitialPageLoadSignal {
  let loaded = false;
  let resolveLoaded!: () => void;
  const promise = new Promise<void>((resolve) => {
    resolveLoaded = resolve;
  });
  return {
    wait: () => promise,
    isLoaded: () => loaded,
    markLoaded: () => {
      if (loaded) return;
      loaded = true;
      resolveLoaded();
    },
  };
}

/** content script 內共用的單一實例（側邊欄與 runtime 在同一個 isolated world） */
export const initialPageLoadSignal = createInitialPageLoadSignal();
