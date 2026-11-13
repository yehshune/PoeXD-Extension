// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createApp, nextTick } from 'vue';
import ToolsPane, {
  formatRelativeTime,
  formatAbsoluteTime,
  formatFutureRelativeTime,
  formatTimeWithOptionalDate,
  shouldApplyEconomyMetadata,
} from '@/components/sidebar/ToolsPane.vue';
import { extensionMessaging } from '@/utils/extension-protocol';
import { listenPoeEvent } from '@/utils/event-contracts';
import { resetI18nStateForTests, setActiveDisplayLocalePreference } from '@/utils/i18n';

// Mock dependencies
vi.mock('@/utils/trade-context', () => ({
  getPoeVersion: vi.fn(() => 'poe1'),
  getTradeLeague: vi.fn((path: string) => {
    if (path.includes('Settlers')) return 'Settlers';
    return undefined;
  }),
}));

const mockMessageHandlers = new Map<string, Set<Function>>();

function emitExtensionMessage(type: string, data: any) {
  const fns = mockMessageHandlers.get(type);
  if (fns) {
    for (const fn of fns) {
      fn({ data });
    }
  }
}

vi.mock('@/utils/extension-protocol', () => {
  return {
    extensionMessaging: {
      sendMessage: vi.fn(),
      onMessage: vi.fn((type: string, fn: Function) => {
        if (!mockMessageHandlers.has(type)) {
          mockMessageHandlers.set(type, new Set());
        }
        mockMessageHandlers.get(type)!.add(fn);
        return () => {
          mockMessageHandlers.get(type)?.delete(fn);
        };
      }),
    },
  };
});

describe('ToolsPane & time formatters', () => {
  let container: HTMLElement;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetI18nStateForTests('zh-TW');
    container = document.createElement('div');
    document.body.appendChild(container);
    vi.clearAllMocks();
    mockMessageHandlers.clear();
  });

  afterEach(() => {
    resetI18nStateForTests('zh-TW');
    app?.unmount();
    container.remove();
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  describe('time formatters', () => {
    it('formatRelativeTime formats correctly across boundaries', () => {
      const now = 1_000_000_000;
      expect(formatRelativeTime(now - 30 * 1000, now)).toBe('剛剛');
      expect(formatRelativeTime(now - 5 * 60 * 1000, now)).toBe('5 分鐘前');
      expect(formatRelativeTime(now - 3 * 3600 * 1000, now)).toBe('3 小時前');
      expect(formatRelativeTime(now - 2 * 86400 * 1000, now)).toBe('2 天前');
    });

    it('formatFutureRelativeTime formats future expiration across boundaries', () => {
      const now = 1_000_000_000;
      expect(formatFutureRelativeTime(now - 1000, now)).toBe('已到期，下一次使用時重新取得');
      expect(formatFutureRelativeTime(now + 30 * 1000, now)).toBe('不到 1 分鐘後');
      expect(formatFutureRelativeTime(now + 7 * 60 * 1000, now)).toBe('7 分鐘後');
      expect(formatFutureRelativeTime(now + 2 * 3600 * 1000, now)).toBe('2 小時後');
      expect(formatFutureRelativeTime(now + 3 * 86400 * 1000, now)).toBe('3 天後');
    });

    it('formatAbsoluteTime formats timestamp into YYYY/MM/DD HH:MM:SS', () => {
      const d = new Date(2026, 8, 27, 10, 5, 3);
      const str = formatAbsoluteTime(d.getTime());
      expect(str).toBe('2026/09/27 10:05:03');
    });

    it('formatTimeWithOptionalDate formats time-only for same day and date+time for different day', () => {
      const now = new Date(2026, 8, 27, 14, 30, 0).getTime();
      const sameDayTime = new Date(2026, 8, 27, 10, 5, 0).getTime();
      expect(formatTimeWithOptionalDate(sameDayTime, now)).toBe('10:05');

      const differentDayTime = new Date(2026, 8, 26, 9, 15, 0).getTime();
      expect(formatTimeWithOptionalDate(differentDayTime, now)).toBe('2026/09/26 09:15');
    });
  });

  describe('ToolsPane rendering & behavior', () => {
    it('renders only the price conversion section', async () => {
      (extensionMessaging.sendMessage as any).mockImplementation(async (type: string) => {
        if (type === 'economy:getRateMetadata') {
          return { updatedAt: null, source: 'none', ttl: 900000, hasData: false, isExpired: true };
        }
        return {};
      });

      app = createApp(ToolsPane);
      app.mount(container);
      await nextTick();

      const text = container.textContent || '';
      expect(text).toContain('價格換算資料');
    });

    it('links to the shared support page in a new tab', async () => {
      (extensionMessaging.sendMessage as any).mockImplementation(async () => ({}));

      app = createApp(ToolsPane);
      app.mount(container);
      await nextTick();

      expect(container.textContent).toContain('支持開發');
      const links = container.querySelectorAll<HTMLAnchorElement>('a[data-support-link]');
      expect(links).toHaveLength(1);
      const link = links[0];
      expect(link.href).toBe('https://yehshune.github.io/support/');
      expect(link.target).toBe('_blank');
      expect(link.rel).toBe('noopener noreferrer');
      expect(link.textContent).toContain('前往贊助頁');
    });

    it('shows non-trade state when currentLeague is undefined and disables update button', async () => {
      (extensionMessaging.sendMessage as any).mockImplementation(async (type: string) => {
        return {};
      });

      // Window pathname without league
      delete (window as any).location;
      (window as any).location = {
        hostname: 'www.pathofexile.com',
        pathname: '/about',
        href: 'https://www.pathofexile.com/about',
      };

      app = createApp(ToolsPane);
      app.mount(container);
      await nextTick();
      await nextTick();

      const text = container.textContent || '';
      expect(text).toContain('資料範圍');
      expect(text).toContain('PoE 1 · 未處於聯盟交易頁面');
      expect(text).toContain('快取狀態');
      expect(text).toContain('尚無資料 · 首次使用時取得');
      expect(text).toContain('最後更新');
      expect(text).toContain('尚無資料');
      expect(text).toContain('poe.ninja Currency Exchange');
      expect(text).toContain('到期後，下一次需要價格資料時自動重新取得。');
      expect(text).not.toContain('每 15 分鐘自動更新');

      // Update button is disabled
      const updateBtn = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('立即更新'),
      ) as HTMLButtonElement;
      expect(updateBtn).not.toBeNull();
      expect(updateBtn.disabled).toBe(true);
    });

    it.each([
      ['pathofexile.tw', '台服'],
      ['poe.game.qq.com', 'QQ'],
    ])(
      'skips price conversion data on %s (poe.ninja is international only)',
      async (host, label) => {
        delete (window as any).location;
        (window as any).location = {
          hostname: host,
          pathname: '/trade/search/Settlers',
          href: `https://${host}/trade/search/Settlers`,
        };
        app = createApp(ToolsPane);
        app.mount(container);
        await nextTick();
        await nextTick();

        const note = container.querySelector('.price-conversion-unsupported');
        expect(note?.textContent).toContain('僅提供國際服');
        expect(note?.textContent).toContain(`（${label}）`);
        expect(container.textContent).not.toContain('立即更新');
        const economyCalls = (extensionMessaging.sendMessage as any).mock.calls.filter(
          ([type]: [string]) => type.startsWith('economy:'),
        );
        expect(economyCalls).toEqual([]);
      },
    );

    it('loads economy metadata when on a trade URL and triggers manual force refresh', async () => {
      delete (window as any).location;
      (window as any).location = {
        hostname: 'www.pathofexile.com',
        pathname: '/trade/search/Settlers',
        href: 'https://www.pathofexile.com/trade/search/Settlers',
      };

      const now = Date.now();
      const metaResponse = {
        updatedAt: now - 8 * 60 * 1000, // 8 minutes ago
        source: 'cache' as const,
        ttl: 60 * 60 * 1000,
        hasData: true,
        isExpired: false,
      };

      (extensionMessaging.sendMessage as any).mockImplementation(
        async (type: string, data: any) => {
          if (type === 'economy:getRateMetadata') {
            return metaResponse;
          }
          if (type === 'economy:fetchCurrencyRates') {
            expect(data.force).toBe(true);
            return {
              success: true,
              data: { timestamp: now, rates: { divine: 200 } },
              metadata: {
                updatedAt: now,
                source: 'network' as const,
                ttl: 60 * 60 * 1000,
                hasData: true,
                isExpired: false,
              },
            };
          }
          return {};
        },
      );

      const toastListener = vi.fn();
      const stopToastListener = listenPoeEvent('poexd-toast', toastListener);

      app = createApp(ToolsPane);
      app.mount(container);
      await nextTick();
      await nextTick();

      // Verify consolidated 3-row layout and single-ownership TTL
      const text = container.textContent || '';
      expect(text).toContain('資料範圍');
      expect(text).toContain('PoE 1 · Settlers');
      expect(text).toContain('快取狀態');
      expect(text).toContain('有效至');
      expect(text).toContain('52 分鐘後');
      expect(text).toContain('最後更新');
      expect(text).toContain('8 分鐘前');
      expect(text).toContain('poe.ninja Currency Exchange · 快取有效 60 分鐘');
      expect(text).toContain('到期後，下一次需要價格資料時自動重新取得。');
      expect(text).not.toContain('每 15 分鐘自動更新');

      // Trigger force refresh
      const updateBtn = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('立即更新'),
      ) as HTMLButtonElement;
      expect(updateBtn.disabled).toBe(false);

      updateBtn.click();
      await new Promise((r) => setTimeout(r, 10));
      await nextTick();

      expect(extensionMessaging.sendMessage).toHaveBeenCalledWith('economy:fetchCurrencyRates', {
        version: 'poe1',
        league: 'Settlers',
        force: true,
      });

      expect(toastListener).toHaveBeenCalled();
      expect(toastListener.mock.calls[0][0].message).toContain('價格換算資料已成功更新');

      stopToastListener();
    });

    it('shows expired status and guidance when cache has expired', async () => {
      delete (window as any).location;
      (window as any).location = {
        hostname: 'www.pathofexile.com',
        pathname: '/trade/search/Settlers',
        href: 'https://www.pathofexile.com/trade/search/Settlers',
      };

      const now = Date.now();
      const metaResponse = {
        updatedAt: now - 70 * 60 * 1000, // 70 minutes ago (expired for 60min TTL)
        source: 'cache' as const,
        ttl: 60 * 60 * 1000,
        hasData: true,
        isExpired: true,
      };

      (extensionMessaging.sendMessage as any).mockImplementation(async (type: string) => {
        if (type === 'economy:getRateMetadata') return metaResponse;
        return {};
      });

      app = createApp(ToolsPane);
      app.mount(container);
      await nextTick();
      await nextTick();

      const text = container.textContent || '';
      expect(text).toContain('快取狀態');
      expect(text).toContain('已過期 · 下次使用時重新取得');
      expect(text).toContain('到期後，下一次需要價格資料時自動重新取得。');
    });

    it('synchronizes mounted ToolsPane metadata upon receiving economy:change notification', async () => {
      delete (window as any).location;
      (window as any).location = {
        hostname: 'www.pathofexile.com',
        pathname: '/trade/search/Settlers',
        href: 'https://www.pathofexile.com/trade/search/Settlers',
      };

      const initialTime = 1_000_000;
      // 初始時處於已過期狀態
      const metaResponse = {
        updatedAt: initialTime - 70 * 60 * 1000,
        source: 'cache' as const,
        ttl: 60 * 60 * 1000,
        hasData: true,
        isExpired: true,
      };

      (extensionMessaging.sendMessage as any).mockImplementation(async (type: string) => {
        if (type === 'economy:getRateMetadata') return metaResponse;
        return {};
      });

      app = createApp(ToolsPane);
      app.mount(container);
      await nextTick();
      await nextTick();

      expect(container.textContent).toContain('已過期 · 下次使用時重新取得');

      // 模擬背景 auto network refresh 觸發 economy:change
      const refreshedTime = Date.now();
      emitExtensionMessage('economy:change', {
        version: 'poe1',
        league: 'Settlers',
        metadata: {
          updatedAt: refreshedTime,
          source: 'cache' as const,
          ttl: 60 * 60 * 1000,
          hasData: true,
          isExpired: false,
        },
      });

      await nextTick();

      // 面板不需 reload，自動同步為有效狀態
      expect(container.textContent).toContain('有效至');
      expect(container.textContent).not.toContain('已過期 · 下次使用時重新取得');
    });

    it('ignores economy:change notifications from unrelated game version or league', async () => {
      delete (window as any).location;
      (window as any).location = {
        hostname: 'www.pathofexile.com',
        pathname: '/trade/search/Settlers',
        href: 'https://www.pathofexile.com/trade/search/Settlers',
      };

      const now = Date.now();
      const metaResponse = {
        updatedAt: now - 10 * 60 * 1000,
        source: 'cache' as const,
        ttl: 60 * 60 * 1000,
        hasData: true,
        isExpired: false,
      };

      (extensionMessaging.sendMessage as any).mockImplementation(async (type: string) => {
        if (type === 'economy:getRateMetadata') return metaResponse;
        return {};
      });

      app = createApp(ToolsPane);
      app.mount(container);
      await nextTick();
      await nextTick();

      expect(container.textContent).toContain('50 分鐘後');

      // 1. 相同聯盟但不同遊戲版本 (poe2) -> 應忽略
      emitExtensionMessage('economy:change', {
        version: 'poe2',
        league: 'Settlers',
        metadata: {
          updatedAt: now,
          source: 'cache' as const,
          ttl: 60 * 60 * 1000,
          hasData: true,
          isExpired: false,
        },
      });
      await nextTick();
      expect(container.textContent).toContain('50 分鐘後');

      // 2. 相同遊戲版本但不同聯盟 (Standard) -> 應忽略
      emitExtensionMessage('economy:change', {
        version: 'poe1',
        league: 'Standard',
        metadata: {
          updatedAt: now,
          source: 'cache' as const,
          ttl: 60 * 60 * 1000,
          hasData: true,
          isExpired: false,
        },
      });
      await nextTick();
      expect(container.textContent).toContain('50 分鐘後');
    });

    it('unsubscribes economy:change listener when unmounted', async () => {
      delete (window as any).location;
      (window as any).location = {
        hostname: 'www.pathofexile.com',
        pathname: '/trade/search/Settlers',
        href: 'https://www.pathofexile.com/trade/search/Settlers',
      };

      (extensionMessaging.sendMessage as any).mockImplementation(async (type: string) => {
        if (type === 'economy:getRateMetadata') {
          return {
            updatedAt: null,
            source: 'none',
            ttl: 60 * 60 * 1000,
            hasData: false,
            isExpired: true,
          };
        }
        return {};
      });

      app = createApp(ToolsPane);
      app.mount(container);
      await nextTick();

      const listeners = mockMessageHandlers.get('economy:change');
      expect(listeners?.size).toBe(1);

      app.unmount();
      expect(listeners?.size).toBe(0);
    });

    it('prevents stale initial getRateMetadata response from overwriting newer economy:change notification', async () => {
      delete (window as any).location;
      (window as any).location = {
        hostname: 'www.pathofexile.com',
        pathname: '/trade/search/Settlers',
        href: 'https://www.pathofexile.com/trade/search/Settlers',
      };

      let resolveInitialMetadata!: (val: any) => void;
      const initialMetadataPromise = new Promise((resolve) => {
        resolveInitialMetadata = resolve;
      });

      (extensionMessaging.sendMessage as any).mockImplementation(async (type: string) => {
        if (type === 'economy:getRateMetadata') {
          return initialMetadataPromise;
        }
        return {};
      });

      // 1. mount ToolsPane
      app = createApp(ToolsPane);
      app.mount(container);
      await nextTick();

      // 2. 初始 getRateMetadata 保持 pending
      const now = Date.now();
      const oldTimestamp = now - 70 * 60 * 1000;
      const newTimestamp = now - 5 * 60 * 1000;

      // 3. 發送較新的 economy:change
      emitExtensionMessage('economy:change', {
        version: 'poe1',
        league: 'Settlers',
        metadata: {
          updatedAt: newTimestamp,
          source: 'cache' as const,
          ttl: 60 * 60 * 1000,
          hasData: true,
          isExpired: false,
        },
      });

      await nextTick();

      // 4. 確認 UI 已顯示新 metadata
      expect(container.textContent).toContain('有效至');
      expect(container.textContent).not.toContain('已過期');

      // 5. 再 resolve 先前 pending 的舊 metadata (已過期狀態)
      resolveInitialMetadata({
        updatedAt: oldTimestamp,
        source: 'cache' as const,
        ttl: 60 * 60 * 1000,
        hasData: true,
        isExpired: true,
      });

      await new Promise((r) => setTimeout(r, 0));
      await nextTick();

      // 6. 確認 UI 仍維持較新的狀態，不被舊 response 覆蓋
      expect(container.textContent).toContain('有效至');
      expect(container.textContent).not.toContain('已過期');
    });

    it('prevents stale force refresh response from overwriting newer economy:change notification', async () => {
      delete (window as any).location;
      (window as any).location = {
        hostname: 'www.pathofexile.com',
        pathname: '/trade/search/Settlers',
        href: 'https://www.pathofexile.com/trade/search/Settlers',
      };

      const baseTime = 1_000_000;
      let resolveForceRefresh!: (val: any) => void;
      const forceRefreshPromise = new Promise((resolve) => {
        resolveForceRefresh = resolve;
      });

      (extensionMessaging.sendMessage as any).mockImplementation(async (type: string) => {
        if (type === 'economy:getRateMetadata') {
          return {
            updatedAt: baseTime,
            source: 'cache' as const,
            ttl: 60 * 60 * 1000,
            hasData: true,
            isExpired: false,
          };
        }
        if (type === 'economy:fetchCurrencyRates') {
          return forceRefreshPromise;
        }
        return {};
      });

      app = createApp(ToolsPane);
      app.mount(container);
      await nextTick();
      await nextTick();

      // 觸發手動立即更新
      const updateBtn = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('立即更新'),
      ) as HTMLButtonElement;
      updateBtn.click();
      await nextTick();

      // 在 force refresh 尚未完成前，收到較新的 economy:change (updatedAt: 3_000_000)
      const newerChangeTime = 3_000_000;
      emitExtensionMessage('economy:change', {
        version: 'poe1',
        league: 'Settlers',
        metadata: {
          updatedAt: newerChangeTime,
          source: 'cache' as const,
          ttl: 60 * 60 * 1000,
          hasData: true,
          isExpired: false,
        },
      });
      await nextTick();

      // force refresh 返回了一個較舊的 response (updatedAt: 2_000_000)
      resolveForceRefresh({
        success: true,
        data: { timestamp: 2_000_000, rates: { divine: 200 } },
        metadata: {
          updatedAt: 2_000_000,
          source: 'network' as const,
          ttl: 60 * 60 * 1000,
          hasData: true,
          isExpired: false,
        },
      });

      await new Promise((r) => setTimeout(r, 0));
      await nextTick();

      // 確認 UI 最後更新仍為 newerChangeTime 衍生內容，不被較舊的 2_000_000 覆蓋
      const expectedTimeStr = formatTimeWithOptionalDate(newerChangeTime);
      expect(container.textContent).toContain(expectedTimeStr);
    });

    describe('shouldApplyEconomyMetadata reconciliation rules', () => {
      it('allows any incoming metadata when current has no data', () => {
        const emptyCurrent = {
          updatedAt: null,
          source: 'none' as const,
          ttl: 3600000,
          hasData: false,
          isExpired: true,
        };
        const incomingWithData = {
          updatedAt: 1000,
          source: 'cache' as const,
          ttl: 3600000,
          hasData: true,
          isExpired: false,
        };
        expect(shouldApplyEconomyMetadata(emptyCurrent, incomingWithData)).toBe(true);
      });

      it('rejects empty or no-data incoming metadata when current already has data', () => {
        const currentWithData = {
          updatedAt: 1000,
          source: 'cache' as const,
          ttl: 3600000,
          hasData: true,
          isExpired: false,
        };
        const emptyIncoming = {
          updatedAt: null,
          source: 'none' as const,
          ttl: 3600000,
          hasData: false,
          isExpired: true,
        };
        expect(shouldApplyEconomyMetadata(currentWithData, emptyIncoming)).toBe(false);
      });

      it('rejects incoming metadata with older updatedAt timestamp', () => {
        const current = {
          updatedAt: 2000,
          source: 'cache' as const,
          ttl: 3600000,
          hasData: true,
          isExpired: false,
        };
        const olderIncoming = {
          updatedAt: 1000,
          source: 'network' as const,
          ttl: 3600000,
          hasData: true,
          isExpired: false,
        };
        expect(shouldApplyEconomyMetadata(current, olderIncoming)).toBe(false);
      });

      it('accepts incoming metadata with equal or newer updatedAt timestamp', () => {
        const current = {
          updatedAt: 2000,
          source: 'cache' as const,
          ttl: 3600000,
          hasData: true,
          isExpired: false,
        };
        const equalIncoming = {
          updatedAt: 2000,
          source: 'network' as const,
          ttl: 3600000,
          hasData: true,
          isExpired: false,
        };
        const newerIncoming = {
          updatedAt: 3000,
          source: 'network' as const,
          ttl: 3600000,
          hasData: true,
          isExpired: false,
        };
        expect(shouldApplyEconomyMetadata(current, equalIncoming)).toBe(true);
        expect(shouldApplyEconomyMetadata(current, newerIncoming)).toBe(true);
      });
    });

    it('reactively updates ToolsPane labels and relative time strings across zh-TW, zh-CN, and en', async () => {
      delete (window as any).location;
      (window as any).location = {
        hostname: 'www.pathofexile.com',
        pathname: '/trade/search/Settlers',
        href: 'https://www.pathofexile.com/trade/search/Settlers',
      };

      const now = Date.now();
      (extensionMessaging.sendMessage as any).mockImplementation(async (type: string) => {
        if (type === 'economy:getRateMetadata') {
          return {
            updatedAt: now - 5 * 60 * 1000,
            source: 'cache' as const,
            ttl: 60 * 60 * 1000,
            hasData: true,
            isExpired: false,
          };
        }
        return {};
      });

      app = createApp(ToolsPane);
      app.mount(container);
      await nextTick();
      await nextTick();

      expect(container.textContent).toContain('價格換算資料');
      expect(container.textContent).toContain('5 分鐘前');

      setActiveDisplayLocalePreference('zh-CN');
      await nextTick();

      expect(container.textContent).toContain('价格换算数据');
      expect(container.textContent).toContain('5 分钟前');

      setActiveDisplayLocalePreference('en');
      await nextTick();

      expect(container.textContent).toContain('Price Conversion Data');
      expect(container.textContent).toContain('5m ago');
    });
  });
});
