/**
 * `pnpm poe ext-storage`：從擴充的 service worker 讀 `chrome.storage.local`（唯讀）。
 * 主世界的 eval 碰不到擴充儲存區，需要查看主控台連線紀錄、偏好設定等資料時使用。
 */
import type { Browser, Worker } from '@playwright/test';

function findExtensionWorker(browser: Browser): Worker | null {
  const workers = browser.contexts().flatMap((context) => context.serviceWorkers());
  return workers.find((worker) => worker.url().startsWith('chrome-extension://')) ?? null;
}

/** 不給 keys 時只列出所有 key，避免整包輸出 */
export async function readExtensionStorage(
  browser: Browser,
  keys: readonly string[],
): Promise<unknown> {
  const worker = findExtensionWorker(browser);
  if (!worker) {
    throw new Error(
      '找不到擴充的 service worker；確認 `pnpm dev` 有在跑，或先開一個官方分頁喚醒擴充',
    );
  }
  return worker.evaluate(
    async (wanted: string[]) => {
      if (wanted.length === 0) return Object.keys(await chrome.storage.local.get(null)).sort();
      return chrome.storage.local.get(wanted);
    },
    [...keys],
  );
}
