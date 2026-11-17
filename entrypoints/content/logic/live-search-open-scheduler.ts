export interface ILiveSearchOpenScheduler {
  enqueue(task: () => Promise<void> | void): void;
  dispose(): void;
}

export interface LiveSearchOpenSchedulerOptions {
  cooldownMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * 先經過一次 MessageChannel 再排計時器，讓每次冷卻都從新的 task 開始計時。
 *
 * Chrome 會沿著「計時器回呼 → microtask → 下一個 setTimeout」累計巢狀層數；分頁隱藏超過 5 分鐘後，
 * 巢狀達到門檻的計時器會被強力節流到每分鐘才執行一次。排程器的「開連線 → 冷卻 → 開下一條」
 * 中間沒有網路事件打斷，實測（Chrome 157，背景 7 分鐘）第 7 次起冷卻變成 8–60 秒；
 * 從 MessageChannel 訊息排出的計時器巢狀層數歸零，只會被對齊到 1 秒。
 */
export function sleepFromFreshTask(ms: number): Promise<void> {
  return new Promise((resolve) => {
    if (typeof MessageChannel === 'undefined') {
      setTimeout(resolve, ms);
      return;
    }
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      setTimeout(resolve, ms);
    };
    channel.port2.postMessage(null);
  });
}

/**
 * Primary-wide WebSocket Open Scheduler
 *
 * 職責：
 * 1. 跨 Subscriptions 序列化所有 WebSocket open 行為 (Initial connect, Auto reconnect, Manual retry)
 * 2. 依據 PoeXD Desktop production 規範，每次連線建立後冷卻 1500ms，防止大量書籤加入時突發爆量連線
 * 3. 極窄介面，僅暴露 enqueue 與 dispose
 * 4. 支援 dispose 取消防護，Runtime teardown 時所有未執行之 open 排程立即作廢
 */
export class LiveSearchOpenScheduler implements ILiveSearchOpenScheduler {
  private readonly cooldownMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private queue: Array<() => Promise<void> | void> = [];
  private isProcessing = false;
  private disposed = false;

  constructor(options?: LiveSearchOpenSchedulerOptions) {
    this.cooldownMs = options?.cooldownMs ?? 1500;
    this.sleep = options?.sleep ?? sleepFromFreshTask;
  }

  public enqueue(task: () => Promise<void> | void): void {
    if (this.disposed) return;
    this.queue.push(task);
    void this.processQueue();
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.queue = [];
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.disposed) return;
    this.isProcessing = true;

    try {
      while (this.queue.length > 0 && !this.disposed) {
        const nextTask = this.queue.shift();
        if (!nextTask) break;

        try {
          await nextTask();
        } catch (err) {
          console.error('[PoeXD LiveSearch] Error executing queued connection open task:', err);
        }

        if (this.disposed) break;

        // 僅在冷卻時間大於 0 時等待冷卻
        if (this.cooldownMs > 0) {
          await this.sleep(this.cooldownMs);
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }
}
