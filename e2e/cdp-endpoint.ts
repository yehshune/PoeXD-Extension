/**
 * 找出 `pnpm dev` 開啟的瀏覽器 CDP 位址。
 *
 * wxt.config.ts 以 `--remote-debugging-port` 開埠，但 Chrome 在 IPv4 的同一個埠已被其他程式
 * （例如同樣開 9222 的 Electron 應用程式）佔用時只會聽在 `[::1]`，所以兩個位址都要試，
 * 並以 `/json/version` 排除不是 dev 瀏覽器的對象。
 */

const DEFAULT_CDP_PORT = '9222';

export interface CdpEnv {
  POEXD_CDP_URL?: string;
  POEXD_CDP_PORT?: string;
}

export interface CdpVersionInfo {
  Browser?: string;
  'User-Agent'?: string;
}

export function getCdpCandidateUrls(env: CdpEnv): string[] {
  if (env.POEXD_CDP_URL) return [env.POEXD_CDP_URL];
  const port = env.POEXD_CDP_PORT ?? DEFAULT_CDP_PORT;
  return [`http://127.0.0.1:${port}`, `http://[::1]:${port}`];
}

/** dev 瀏覽器是一般 Chrome / Edge；Electron 應用程式的 User-Agent 會帶 `Electron/`。 */
export function isDevBrowserVersion(info: CdpVersionInfo | null | undefined): boolean {
  const userAgent = info?.['User-Agent'];
  if (!info?.Browser || !userAgent) return false;
  return !/\bElectron\//.test(userAgent);
}

/** 依序探測候選位址，回傳第一個屬於 dev 瀏覽器的 CDP 位址；全部失敗時附上各位址的原因。 */
export async function resolveDevBrowserCdpUrl(env: CdpEnv = process.env): Promise<string> {
  const failures: string[] = [];
  for (const url of getCdpCandidateUrls(env)) {
    try {
      const response = await fetch(`${url}/json/version`, { signal: AbortSignal.timeout(3000) });
      const info = (await response.json()) as CdpVersionInfo;
      if (isDevBrowserVersion(info)) return url;
      failures.push(`${url}：不是 dev 瀏覽器（${info['User-Agent'] ?? '未知'}）`);
    } catch (error) {
      failures.push(`${url}：${String(error)}`);
    }
  }
  throw new Error(
    `找不到 dev 瀏覽器的 CDP 位址。請先執行 \`pnpm dev\` 並保持瀏覽器開啟。\n${failures.join('\n')}`,
  );
}
