import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import type { AddressInfo, Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * 官方即時搜尋 WebSocket 的本機替身。
 *
 * 擴充功能在 content script（隔離世界）建立 WebSocket，Playwright 的 `routeWebSocket` 只改寫頁面主世界的
 * `WebSocket`，攔不到。所以改用真的 WSS 伺服器：瀏覽器以 `--host-resolver-rules` 把官方網域解析到這裡，
 * 一般 HTTP 請求仍在 DNS 之前就被 `context.route` 回放，真的連進來的只有 WebSocket，
 * 以及 `context.route` 攔不到的分頁導覽（由呼叫端提供替身頁）。
 * 憑證是測試當下產生的自簽憑證，瀏覽器以 `--ignore-certificate-errors` 接受。
 */

/** 一條連進來的官方即時搜尋連線 */
export interface LiveSocket {
  readonly searchId: string;
  /** 模擬官方推送新上架物品；token 直接用 fetch 回放裡的物品 id */
  push(token: string): void;
  /** 模擬連線中斷（伺服器端直接切斷，不送 close 訊框） */
  drop(): void;
  /** 連線關閉時完成（不論是哪一端關的） */
  readonly closed: Promise<void>;
}

export interface LiveSocketServer {
  readonly port: number;
  /** 等第 nth 條（從 1 起算）連上指定搜尋的即時連線 */
  waitFor(searchId: string, nth?: number): Promise<LiveSocket>;
  /** 之後這個搜尋的連線一律以 HTTP 403 拒絕握手（模擬 search id 失效或被官方拒絕） */
  reject(searchId: string): void;
  /** 等到這個搜尋第 nth 次（從 1 起算）被拒絕的連線嘗試 */
  waitForRejection(searchId: string, nth?: number): Promise<void>;
  close(): Promise<void>;
}

const LIVE_SOCKET_PATH = /^\/api\/trade2?\/live\//;
const WAIT_TIMEOUT_MS = 15_000;
const WAIT_POLL_MS = 50;
const WEBSOCKET_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

let certificate: { key: Buffer; cert: Buffer } | null = null;

/** 每個 worker 產生一次自簽憑證；只給這個測試瀏覽器用，不提交到版本庫 */
function testCertificate(): { key: Buffer; cert: Buffer } {
  if (certificate) return certificate;
  const dir = mkdtempSync(join(tmpdir(), 'poexd-e2e-tls-'));
  const keyPath = join(dir, 'key.pem');
  const certPath = join(dir, 'cert.pem');
  try {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '1',
        '-keyout',
        keyPath,
        '-out',
        certPath,
        '-subj',
        '/CN=www.pathofexile.com',
      ],
      { stdio: 'pipe' },
    );
  } catch (error) {
    throw new Error(`離線 E2E 需要 openssl 產生測試憑證：${(error as Error).message}`);
  }
  certificate = { key: readFileSync(keyPath), cert: readFileSync(certPath) };
  return certificate;
}

/** 伺服器送給瀏覽器的文字訊框（不需遮罩） */
function textFrame(text: string): Buffer {
  const payload = Buffer.from(text, 'utf8');
  const length = payload.length;
  if (length < 126) return Buffer.concat([Buffer.from([0x81, length]), payload]);
  if (length < 0x10000) {
    const header = Buffer.from([0x81, 126, 0, 0]);
    header.writeUInt16BE(length, 2);
    return Buffer.concat([header, payload]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(length), 2);
  return Buffer.concat([header, payload]);
}

export interface LiveSocketServerOptions {
  /** 不是即時搜尋的 WebSocket 記錄在這裡 */
  readonly blocked: string[];
  /** context.route 攔不到的導覽改由這裡回應替身頁；回傳 null 代表擋下 */
  readonly documentFor: (url: URL) => string | null;
}

export async function startLiveSocketServer({
  blocked,
  documentFor,
}: LiveSocketServerOptions): Promise<LiveSocketServer> {
  const accepted = new Map<string, LiveSocket[]>();
  const rejectedCounts = new Map<string, number>();
  const rejectedIds = new Set<string>();
  const connections = new Set<Socket>();

  /** 輪詢到條件成立；連線事件很少，輪詢比維護 waiter 清單簡單 */
  async function waitUntil<T>(read: () => T | undefined, label: string): Promise<T> {
    for (let elapsed = 0; elapsed < WAIT_TIMEOUT_MS; elapsed += WAIT_POLL_MS) {
      const value = read();
      if (value !== undefined) return value;
      await new Promise((resolve) => setTimeout(resolve, WAIT_POLL_MS));
    }
    throw new Error(`等不到${label}`);
  }

  const server: Server = createServer(testCertificate(), (request, response) => {
    // 只有 context.route 攔不到的導覽會走到這裡（擴充功能以 chrome.tabs.create 開分頁的第一次導覽）
    const url = new URL(request.url ?? '/', 'https://www.pathofexile.com');
    const html = request.method === 'GET' ? documentFor(url) : null;
    if (html === null) {
      blocked.push(`${request.method} ${url.href}`);
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
  });

  server.on('upgrade', (request, socket: Socket) => {
    const url = new URL(request.url ?? '/', 'https://www.pathofexile.com');
    const key = request.headers['sec-websocket-key'];
    if (!LIVE_SOCKET_PATH.test(url.pathname) || typeof key !== 'string') {
      blocked.push(`WS ${url.href}`);
      socket.destroy();
      return;
    }
    const searchId = decodeURIComponent(url.pathname.split('/').at(-1) ?? '');
    if (rejectedIds.has(searchId)) {
      rejectedCounts.set(searchId, (rejectedCounts.get(searchId) ?? 0) + 1);
      socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
      return;
    }
    const accept = createHash('sha1')
      .update(key + WEBSOCKET_GUID)
      .digest('base64');
    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`,
        '',
        '',
      ].join('\r\n'),
    );
    connections.add(socket);
    const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
    socket.on('close', () => connections.delete(socket));
    // 用戶端關閉連線時會送 close 訊框（opcode 8）並等伺服器回覆才結束 TCP；其他訊框不需要處理。
    // 連線錯誤在測試結束關閉時是預期的
    socket.on('data', (chunk: Buffer) => {
      if ((chunk[0] & 0x0f) !== 0x8) return;
      socket.end(Buffer.from([0x88, 0x00]));
    });
    socket.on('error', () => {});

    const live: LiveSocket = {
      searchId,
      push: (token) => socket.write(textFrame(JSON.stringify({ result: token }))),
      drop: () => socket.destroy(),
      closed,
    };
    // 官方連線成功後會先廣播 {"auth": true}
    socket.write(textFrame(JSON.stringify({ auth: true })));
    accepted.set(searchId, [...(accepted.get(searchId) ?? []), live]);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  return {
    port: (server.address() as AddressInfo).port,
    waitFor(searchId, nth = 1) {
      return waitUntil(
        () => accepted.get(searchId)?.[nth - 1],
        `第 ${nth} 條即時搜尋連線：${searchId}`,
      );
    },
    reject(searchId) {
      rejectedIds.add(searchId);
    },
    async waitForRejection(searchId, nth = 1) {
      await waitUntil(
        () => ((rejectedCounts.get(searchId) ?? 0) >= nth ? true : undefined),
        `第 ${nth} 次被拒絕的即時搜尋連線：${searchId}`,
      );
    },
    close() {
      connections.forEach((socket) => socket.destroy());
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
