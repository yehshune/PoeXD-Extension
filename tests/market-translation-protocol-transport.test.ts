import { describe, expect, it, vi } from 'vitest';
import {
  MARKET_MESSAGE_SOURCE,
  createDisabledMessage,
  createPayloadMessage,
  isMarketTranslationPortMessage,
  postMarketTranslationMessage,
} from '@/utils/market-translation-protocol';

function createWin() {
  return { postMessage: vi.fn(), location: { origin: 'https://www.pathofexile.com' } };
}

describe('postMarketTranslationMessage', () => {
  it('payload 只經 MessageChannel 送出，window 上只有附帶 port 的小訊息', () => {
    const win = createWin();
    const port1 = { postMessage: vi.fn() };
    const port2 = {};
    const message = createPayloadMessage({ locale: 'zh-TW', ui: { Any: '任何' }, bilingual: true });

    postMarketTranslationMessage(
      win,
      message,
      () => ({ port1, port2 }) as unknown as MessageChannel,
    );

    expect(win.postMessage).toHaveBeenCalledTimes(1);
    const [notice, origin, transfer] = win.postMessage.mock.calls[0];
    expect(notice).toEqual({ source: MARKET_MESSAGE_SOURCE, type: 'payload-port' });
    expect(isMarketTranslationPortMessage(notice)).toBe(true);
    expect(origin).toBe('https://www.pathofexile.com');
    expect(transfer).toEqual([port2]);
    expect(port1.postMessage).toHaveBeenCalledWith(message);
  });

  it('其他訊息直接以 window.postMessage 送出', () => {
    const win = createWin();
    const createChannel = vi.fn();

    postMarketTranslationMessage(win, createDisabledMessage(), createChannel);

    expect(createChannel).not.toHaveBeenCalled();
    expect(win.postMessage).toHaveBeenCalledWith(
      { source: MARKET_MESSAGE_SOURCE, type: 'disabled' },
      'https://www.pathofexile.com',
    );
  });
});
