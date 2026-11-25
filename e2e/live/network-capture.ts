/**
 * `pnpm poe net`：在選取的分頁上監聽網路回應（含擴充 content script 發出的請求），
 * 可選擇在監聽期間執行一段主世界腳本觸發請求，結束後列出符合的回應與內容摘要。
 */
import type { Page, Response } from '@playwright/test';

export interface CapturedResponse {
  readonly url: string;
  readonly method: string;
  readonly status: number;
  readonly elapsedMs: number;
  readonly body: string;
}

export interface CaptureOptions {
  readonly filter: string;
  readonly seconds: number;
  readonly maxBody: number;
  /** 保留完整網址（預設把 /fetch/ 後的長 token 截短） */
  readonly fullUrl?: boolean;
  /** 開始監聽後在主世界執行的程式（async 函式本體） */
  readonly script?: string;
}

/** 長 token 只留頭尾，避免輸出整串 */
function shortenUrl(url: string): string {
  return url.replace(/\/fetch\/([^?/]{12})[^?/]*/, '/fetch/$1…');
}

async function readBody(response: Response, maxBody: number): Promise<string> {
  try {
    const text = await response.text();
    return text.length > maxBody ? `${text.slice(0, maxBody)}…（共 ${text.length} 字）` : text;
  } catch (error) {
    return `（無法讀取內容：${error instanceof Error ? error.message : String(error)}）`;
  }
}

export async function captureResponses(
  page: Page,
  options: CaptureOptions,
): Promise<{ scriptResult: unknown; responses: CapturedResponse[] }> {
  const startedAt = Date.now();
  const pending: Promise<CapturedResponse>[] = [];
  const onResponse = (response: Response) => {
    if (!response.url().includes(options.filter)) return;
    const elapsedMs = Date.now() - startedAt;
    pending.push(
      readBody(response, options.maxBody).then((body) => ({
        url: options.fullUrl ? response.url() : shortenUrl(response.url()),
        method: response.request().method(),
        status: response.status(),
        elapsedMs,
        body,
      })),
    );
  };

  page.on('response', onResponse);
  try {
    const scriptResult = options.script
      ? await page.evaluate(`(async () => {\n${options.script}\n})()`)
      : undefined;
    const remaining = options.seconds * 1000 - (Date.now() - startedAt);
    if (remaining > 0) await page.waitForTimeout(remaining);
    return { scriptResult: scriptResult ?? null, responses: await Promise.all(pending) };
  } finally {
    page.off('response', onResponse);
  }
}
