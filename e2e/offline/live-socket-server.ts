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
}

export interface LiveSocketServer {
  readonly port: number;
  /** 等擴充功能連上指定搜尋的即時連線 */
  waitFor(searchId: string): Promise<LiveSocket>;
  close(): Promise<void>;
}

const LIVE_SOCKET_PATH = /^\/api\/trade2?\/live\//;
const WAIT_TIMEOUT_MS = 15_000;
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
  const sockets = new Map<string, LiveSocket>();
  const waiters = new Map<string, ((socket: LiveSocket) => void)[]>();
  const connections = new Set<Socket>();

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
    socket.on('close', () => connections.delete(socket));
    // 用戶端的訊框（ping / close）不需要處理；連線錯誤在測試結束關閉時是預期的
    socket.on('data', () => {});
    socket.on('error', () => {});

    const searchId = decodeURIComponent(url.pathname.split('/').at(-1) ?? '');
    const live: LiveSocket = {
      searchId,
      push: (token) => socket.write(textFrame(JSON.stringify({ result: token }))),
    };
    // 官方連線成功後會先廣播 {"auth": true}
    socket.write(textFrame(JSON.stringify({ auth: true })));
    sockets.set(searchId, live);
    (waiters.get(searchId) ?? []).forEach((resolve) => resolve(live));
    waiters.delete(searchId);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  return {
    port: (server.address() as AddressInfo).port,
    waitFor(searchId) {
      const existing = sockets.get(searchId);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`等不到即時搜尋連線：${searchId}`)),
          WAIT_TIMEOUT_MS,
        );
        waiters.set(searchId, [
          ...(waiters.get(searchId) ?? []),
          (socket) => {
            clearTimeout(timer);
            resolve(socket);
          },
        ]);
      });
    },
    close() {
      connections.forEach((socket) => socket.destroy());
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
