import { describe, expect, it, vi } from 'vitest';
import {
  parseMarketUiAsset,
  startMarketTranslationBridge,
  type MarketTranslationBridgeDeps,
} from '@/utils/market-translation-bridge';
import {
  MARKET_MESSAGE_SOURCE,
  createRequestMessage,
  type MarketTranslationMessage,
} from '@/utils/market-translation-protocol';

const uiAsset = {
  schemaVersion: 1,
  locale: 'zh-TW',
  source: 'https://webtw.poecdn.com/js/translate.zh_TW.js',
  strings: { 'Search Listed Items': '搜尋道具' },
};

const statsAsset = {
  schemaVersion: 1,
  locale: 'zh-TW',
  labels: { explicit: '隨機屬性' },
  stats: { 'explicit.stat_1': '增加#%能力值需求' },
  options: {},
};

const ASSETS: Record<string, unknown> = {
  'json/locales/zh-TW/trade-ui.json': uiAsset,
  'json/poe2/locales/zh-TW/trade-stats.json': statsAsset,
};

const loadAsset = async (path: string) => {
  if (!(path in ASSETS)) throw new Error(`404 ${path}`);
  return ASSETS[path];
};

function createDeps(overrides: Partial<MarketTranslationBridgeDeps> = {}) {
  const posted: MarketTranslationMessage[] = [];
  let handler: ((data: unknown) => void) | null = null;
  const deps: MarketTranslationBridgeDeps = {
    hostname: 'www.pathofexile.com',
    pathname: '/trade2/search/poe2/Standard',
    browserLocale: 'en-US',
    readStorage: vi.fn(async () => ({ marketTranslation: true, displayLocale: 'zh-TW' })),
    loadJson: vi.fn(loadAsset),
    post: (message) => posted.push(message),
    subscribe: (next) => {
      handler = next;
      return () => {
        handler = null;
      };
    },
    ...overrides,
  };
  return { deps, posted, receive: (data: unknown) => handler?.(data) };
}

describe('parseMarketUiAsset', () => {
  it('取出字串表', () => {
    expect(parseMarketUiAsset(uiAsset, 'zh-TW')).toEqual({ 'Search Listed Items': '搜尋道具' });
  });

  it('語系或格式不符時拒絕', () => {
    expect(() => parseMarketUiAsset({ ...uiAsset, locale: 'zh-CN' }, 'zh-TW')).toThrow();
    expect(() => parseMarketUiAsset({ ...uiAsset, schemaVersion: 2 }, 'zh-TW')).toThrow();
    expect(() => parseMarketUiAsset({ ...uiAsset, strings: { a: 1 } }, 'zh-TW')).toThrow();
    expect(() => parseMarketUiAsset(null, 'zh-TW')).toThrow();
  });
});

describe('startMarketTranslationBridge', () => {
  it('開啟且語系為繁中時載入介面字典與對應版本的 data 字典並送出 payload', async () => {
    const { deps, posted } = createDeps();
    await startMarketTranslationBridge(deps);
    expect(deps.loadJson).toHaveBeenCalledWith('json/locales/zh-TW/trade-ui.json');
    expect(deps.loadJson).toHaveBeenCalledWith('json/poe2/locales/zh-TW/trade-stats.json');
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      source: MARKET_MESSAGE_SOURCE,
      type: 'payload',
      payload: {
        locale: 'zh-TW',
        ui: { 'Search Listed Items': '搜尋道具' },
        bilingual: true,
        data: { stats: { stats: { 'explicit.stat_1': '增加#%能力值需求' } } },
      },
    });
  });

  it('依偏好關閉中英並列；PoE1 頁面載入 poe1 分片', async () => {
    const { deps, posted } = createDeps({
      pathname: '/trade/search/Standard',
      readStorage: vi.fn(async () => ({
        marketTranslation: true,
        marketTranslationBilingual: false,
        displayLocale: 'zh-TW',
      })),
    });
    await startMarketTranslationBridge(deps);
    expect(deps.loadJson).toHaveBeenCalledWith('json/poe1/locales/zh-TW/trade-stats.json');
    expect(posted[0]).toMatchObject({ type: 'payload', payload: { bilingual: false } });
  });

  it('data 分片全部缺少時仍送出介面字典', async () => {
    const { deps, posted } = createDeps({ pathname: '/trade' });
    await startMarketTranslationBridge(deps);
    expect(posted[0]).toMatchObject({ type: 'payload', payload: { locale: 'zh-TW' } });
  });

  it('關閉時送出 disabled，不載入任何分片', async () => {
    const { deps, posted } = createDeps({
      readStorage: vi.fn(async () => ({ marketTranslation: false, displayLocale: 'zh-TW' })),
    });
    await startMarketTranslationBridge(deps);
    expect(deps.loadJson).not.toHaveBeenCalled();
    expect(posted).toEqual([{ source: MARKET_MESSAGE_SOURCE, type: 'disabled' }]);
  });

  it('沒有儲存過偏好時視為關閉', async () => {
    const { deps, posted } = createDeps({ readStorage: vi.fn(async () => ({})) });
    await startMarketTranslationBridge(deps);
    expect(posted).toEqual([{ source: MARKET_MESSAGE_SOURCE, type: 'disabled' }]);
  });

  it('語言為自動時依瀏覽器語系，並沿用舊版 displayLocale 遷移規則', async () => {
    const { deps, posted } = createDeps({
      browserLocale: 'zh-CN',
      readStorage: vi.fn(async () => ({ marketTranslation: true })),
      loadJson: vi.fn(async () => ({ ...uiAsset, locale: 'zh-CN' })),
    });
    await startMarketTranslationBridge(deps);
    expect(deps.loadJson).toHaveBeenCalledWith('json/locales/zh-CN/trade-ui.json');
    expect(posted[0]).toMatchObject({ type: 'payload', payload: { locale: 'zh-CN' } });
  });

  it('介面字典載入失敗時送出 disabled，讓頁面不必等到逾時', async () => {
    const { deps, posted } = createDeps({
      loadJson: vi.fn(async () => {
        throw new Error('404');
      }),
    });
    await startMarketTranslationBridge(deps);
    expect(posted).toEqual([{ source: MARKET_MESSAGE_SOURCE, type: 'disabled' }]);
  });

  it('讀取偏好失敗時送出 disabled', async () => {
    const { deps, posted } = createDeps({
      readStorage: vi.fn(async () => {
        throw new Error('context invalidated');
      }),
    });
    await startMarketTranslationBridge(deps);
    expect(posted).toEqual([{ source: MARKET_MESSAGE_SOURCE, type: 'disabled' }]);
  });

  it('收到 request 時重送最新結果；準備好之前收到的 request 不重複送', async () => {
    let releaseStorage: (value: Record<string, unknown>) => void = () => {};
    const { deps, posted, receive } = createDeps({
      readStorage: vi.fn(
        () =>
          new Promise<Record<string, unknown>>((resolve) => {
            releaseStorage = resolve;
          }),
      ),
    });
    const started = startMarketTranslationBridge(deps);
    receive(createRequestMessage());
    expect(posted).toEqual([]);

    releaseStorage({ marketTranslation: false });
    await started;
    expect(posted).toHaveLength(1);

    receive(createRequestMessage());
    expect(posted).toHaveLength(2);
    expect(posted[1]).toEqual({ source: MARKET_MESSAGE_SOURCE, type: 'disabled' });

    receive({ source: MARKET_MESSAGE_SOURCE, type: 'disabled' });
    receive({ type: 'request' });
    expect(posted).toHaveLength(2);
  });

  it('不是國際服英文市集時不載入分片', async () => {
    const { deps, posted } = createDeps({ hostname: 'pathofexile.tw' });
    await startMarketTranslationBridge(deps);
    expect(deps.loadJson).not.toHaveBeenCalled();
    expect(posted).toEqual([{ source: MARKET_MESSAGE_SOURCE, type: 'disabled' }]);
  });
});
