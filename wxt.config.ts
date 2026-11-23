import { mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// See https://wxt.dev/api/config.html
/**
 * `pnpm dev` 開啟的瀏覽器設定：
 * - 固定設定檔並保留變更，手動通過一次 Cloudflare 驗證後就能沿用（不自動化繞過）。
 * - 固定遠端除錯埠，讓 `pnpm e2e` 以 CDP 連上同一個瀏覽器做 E2E。
 * 個人調整可放在 gitignore 的 `web-ext.config.ts`。
 */
const E2E_PROFILE_DIR = resolve('.wxt/chrome-e2e-profile');
mkdirSync(E2E_PROFILE_DIR, { recursive: true });

/**
 * 固定 Chromium 擴充 ID 的公鑰（公開資訊，非機密）。
 * 只用於開發與 GitHub Release 的自行安裝版；商店版必須移除，由商店指派 ID。
 */
const CHROMIUM_PUBLIC_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA38lV1t8dnLyIqWAW0nmMfS8tsCj8qvQRIjH/JGvKwEvFI7mSGmzON564dYdlnR2fROnIFvkCthkPXdAidfYaFQ6/2PsgEC9UmnFybomH/MSmS0rnS5ZbWL7gYhxzE/TN0v5oN1kx7SR78jNyuZ+3xC1cGM2goPhYNVmSYCo3oxtnRyjHSkOtgZIwuuLsIs31G1Mxlk/93yH77EfH1XywImWtxn/xyzf86GDOyAMJNuZgDySVCoOTOkjfn9Vi3hSCKHtTdHpLxvMsJQbONckLisMhByoRn0zmKbOpVeFCUQAVvxqZ1dClDugZKXADN6uEHhNbFhy3qA6pjjRzSl77sQIDAQAB';

/** `POEXD_STORE_BUILD=1` 時產生商店上架用建置（不含 key） */
const IS_STORE_BUILD = process.env.POEXD_STORE_BUILD === '1';

const GECKO_ID = 'poexd-trade-helper@yehshune';

/**
 * 清掉 dev 設定檔裡的 service worker 儲存區（註冊資料與腳本快取）。
 *
 * 固定設定檔加固定擴充 ID 時，Chrome 重啟後會直接沿用設定檔裡快取的 background service worker，
 * 不重讀磁碟；改 manifest 版本號也不會讓它重新註冊（已實測）。快取的舊版若記錄著上一次的
 * dev server 埠，就連不上這次的 dev server，content script 永遠不會被註冊（市集頁沒有任何介面）。
 * 開瀏覽器前先清掉儲存區，Chrome 只能從磁碟上的建置重新註冊。
 * Cookie（含 Cloudflare 驗證）存在別處，不受影響。
 */
async function clearCachedServiceWorkers(profileDir: string): Promise<void> {
  await rm(resolve(profileDir, 'Default', 'Service Worker'), { recursive: true, force: true });
}

const TRADE_SITE_MATCHES = [
  '*://*.pathofexile.com/*',
  '*://*.pathofexile.tw/*',
  '*://poe.game.qq.com/*',
];

export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  // Chrome / Edge / Firefox 一律使用 MV3，共用同一套權限模型
  manifestVersion: 3,
  webExt: {
    chromiumProfile: E2E_PROFILE_DIR,
    keepProfileChanges: true,
    // web-ext 以 --remote-debugging-pipe 控制瀏覽器，chromiumPort 不會開出 TCP 埠，需另外指定
    chromiumArgs: [`--remote-debugging-port=${process.env.POEXD_CDP_PORT ?? 9222}`],
    startUrls: [
      process.env.POEXD_E2E_START_URL ?? 'https://www.pathofexile.com/trade2/search/poe2',
    ],
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  hooks: {
    // dev server 啟動後、瀏覽器開啟前觸發。Firefox 每次以暫時附加元件載入，沒有快取問題
    'server:started': async (wxt) => {
      const profileDir = wxt.config.webExt.config?.chromiumProfile;
      if (wxt.config.browser === 'firefox' || !profileDir) return;
      try {
        await clearCachedServiceWorkers(profileDir);
      } catch (error) {
        // 多半是上一個 dev 瀏覽器還沒關閉、檔案被鎖住
        wxt.logger.warn(
          '無法清除 dev 設定檔的 service worker 快取，Chrome 可能執行舊版 background；' +
            '請關閉先前的 dev 瀏覽器後重啟，或在瀏覽器按 Alt+R 重新載入擴充。',
          error,
        );
      }
    },
  },
  // version 由 package.json 提供，不在此重複定義
  manifest: ({ browser }) => {
    const isFirefox = browser === 'firefox';
    return {
      ...(!isFirefox && !IS_STORE_BUILD ? { key: CHROMIUM_PUBLIC_KEY } : {}),
      default_locale: 'en',
      name: '__MSG_extName__',
      description: '__MSG_extDescription__',
      permissions: ['storage', 'unlimitedStorage', 'scripting'],
      host_permissions: [
        'https://*.pathofexile.com/*',
        'https://*.pathofexile.tw/*',
        'https://poe.game.qq.com/*',
        'https://webtw.poecdn.com/*',
        'https://poecdn.game.qq.com/*',
        'https://poe.ninja/*',
      ],
      // PoB 分享網址匯入（pobb.in、pastebin）：使用者在授權頁同意後才取用，見 utils/pob-share-url.ts
      optional_host_permissions: ['https://pobb.in/*', 'https://pastebin.com/*'],
      web_accessible_resources: [
        {
          resources: [
            'interceptor.js',
            'json/poe1/mods-tiers.json',
            'json/poe1/locales/*/stats.json',
            'json/poe1/locales/*/items.json',
            'json/poe1/locales/*/trade-filters.json',
            'json/poe1/locales/*/trade-stats.json',
            'json/poe1/locales/*/trade-static.json',
            'json/poe1/locales/*/trade-items.json',
            'json/poe1/locales/*/mod-lines.json',
            'json/poe1/locales/*/stat-text-items.json',
            'json/poe1/stat-aliases.json',
            'json/poe1/item-art.json',
            'json/poe1/locales/*/result-labels.json',
            'json/poe1/mercenary.json',
            'json/poe1/locales/*/mercenary.json',
            'json/poe2/mods-tiers.json',
            'json/poe2/locales/*/stats.json',
            'json/poe2/locales/*/items.json',
            'json/poe2/locales/*/trade-filters.json',
            'json/poe2/locales/*/trade-stats.json',
            'json/poe2/locales/*/trade-static.json',
            'json/poe2/locales/*/trade-items.json',
            'json/poe2/locales/*/mod-lines.json',
            'json/poe2/locales/*/stat-text-items.json',
            'json/poe2/stat-aliases.json',
            'json/poe2/item-art.json',
            'json/poe2/locales/*/result-labels.json',
            // 市集漢化（ADR-0012）：只有 zh-TW、zh-CN
            'json/locales/*/trade-ui.json',
          ],
          // pobb.in 翻譯腳本的資料改經 background 傳回，不列入這裡，網站便無法藉此偵測擴充
          matches: TRADE_SITE_MATCHES,
        },
      ],
      ...(isFirefox
        ? {
            browser_specific_settings: {
              gecko: {
                id: GECKO_ID,
                strict_min_version: '142.0',
                data_collection_permissions: { required: ['none'] },
              },
            },
          }
        : {}),
    };
  },
});
