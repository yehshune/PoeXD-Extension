/**
 * LiveSearch Primary Exit Guard
 *
 * 核心職責：
 * 專門負責在 Primary Page 仍有 LiveSearch subscription 運行時，
 * 於使用者關閉分頁、重新整理或進行 full-page navigation 之前提供原生 beforeunload 警告保護。
 *
 * Deep Module 原則：
 * - 保持最小 public interface：僅有 dispose()
 * - 不得依賴外部 Domain Runtime、資料源、WebSocket、Background 協調器或 Vue
 * - 唯一依賴：由調用方傳入的 shouldWarn 判斷函式
 */

export interface LiveSearchPrimaryExitGuard {
  dispose(): void;
}

export interface CreateLiveSearchPrimaryExitGuardOptions {
  /**
   * 判斷當前離開頁面是否具有資料遺失或 session 終止風險
   */
  shouldWarn: () => boolean;
  /**
   * 綁定 beforeunload 的目標 Window，預設為全域 window（便於單元測試注入）
   */
  targetWindow?: Window;
}

export function createLiveSearchPrimaryExitGuard(
  options: CreateLiveSearchPrimaryExitGuardOptions,
): LiveSearchPrimaryExitGuard {
  const win = options.targetWindow || (typeof window !== 'undefined' ? window : null);
  let disposed = false;

  function handleBeforeUnload(event: BeforeUnloadEvent): void {
    if (disposed) return;

    try {
      if (options.shouldWarn()) {
        // 標準 Chromium / W3C beforeunload 觸發方式
        event.preventDefault();
        event.returnValue = '';
      }
    } catch (err) {
      // 防禦性捕獲，避免 shouldWarn 拋錯中斷流程
      console.error('[PoeXD LiveSearch] Error evaluating exit guard shouldWarn:', err);
    }
  }

  if (win && typeof win.addEventListener === 'function') {
    win.addEventListener('beforeunload', handleBeforeUnload);
  }

  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (win && typeof win.removeEventListener === 'function') {
        win.removeEventListener('beforeunload', handleBeforeUnload);
      }
    },
  };
}
