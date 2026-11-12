import { mkdirSync } from 'node:fs';
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
  // version 由 package.json 提供，不在此重複定義
  manifest: ({ browser }) => {
    const isFirefox = browser === 'firefox';
    return {
      ...(!isFirefox && !IS_STORE_BUILD ? { key: CHROMIUM_PUBLIC_KEY } : {}),
      default_locale: 'en',
      name: '__MSG_extName__',
      description: '__MSG_extDescription__',
      permissions: ['storage', 'unlimitedStorage'],
      host_permissions: [
        'https://*.pathofexile.com/trade*',
        'https://*.pathofexile.tw/trade*',
        'https://poe.game.qq.com/trade*',
        'https://poe.game.qq.com/api/trade*',
        'https://poe.ninja/*',
      ],
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
            'json/poe1/locales/*/mod-lines.json',
            'json/poe1/mercenary.json',
            'json/poe1/locales/*/mercenary.json',
            'json/poe2/mods-tiers.json',
            'json/poe2/locales/*/stats.json',
            'json/poe2/locales/*/items.json',
            'json/poe2/locales/*/trade-filters.json',
            'json/poe2/locales/*/trade-stats.json',
            'json/poe2/locales/*/trade-static.json',
            'json/poe2/locales/*/mod-lines.json',
            // 市集漢化（ADR-0012）：只有 zh-TW、zh-CN
            'json/locales/*/trade-ui.json',
          ],
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
