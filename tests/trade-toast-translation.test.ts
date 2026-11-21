// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import {
  observeOfficialTradeToasts,
  setTradeToastUiDictionary,
  translateTradeApiMessage,
} from '@/utils/trade-toast-translation';

describe('trade-toast-translation', () => {
  afterEach(() => {
    setTradeToastUiDictionary(undefined);
    document.body.innerHTML = '';
  });

  it('prefers official trade-ui.json dictionary entries over built-in fallbacks', () => {
    const ui = { 'Item no longer available': '官方譯文：物品不存在' };
    expect(translateTradeApiMessage('Item no longer available', 'zh-TW', { ui })).toBe(
      '官方譯文：物品不存在',
    );
  });

  it('falls back to shared UI dictionary when options.ui is omitted', () => {
    setTradeToastUiDictionary({ 'Whisper sent!': '官方已發送密語！' });
    expect(translateTradeApiMessage('Whisper sent!', 'zh-TW')).toBe('官方已發送密語！');
  });

  it('translates common backend Trade API errors in zh-TW and zh-CN', () => {
    expect(
      translateTradeApiMessage('Your account must be in-game to use this feature.', 'zh-TW'),
    ).toBe('您的帳號必須在遊戲中才能使用此功能。');
    expect(
      translateTradeApiMessage('Your account must be in-game to use this feature.', 'zh-CN'),
    ).toBe('您的账号必须在游戏中才能使用此功能。');
    expect(translateTradeApiMessage('Query is too complex.', 'zh-TW')).toBe('搜尋條件過於複雜。');
  });

  it('translates parameterized rate limit, compound, and Error-prefixed messages', () => {
    expect(
      translateTradeApiMessage('Rate limit exceeded; please try again in 15 seconds', 'zh-TW'),
    ).toBe('請求過於頻繁，請在 15 秒後再試。');
    expect(
      translateTradeApiMessage('Rate limit exceeded, please try again in 1 second.', 'zh-CN'),
    ).toBe('请求过于频繁，请在 1 秒后再试。');
    expect(translateTradeApiMessage('Resource not found; Item no longer available', 'zh-TW')).toBe(
      '找不到資源；物品不存在',
    );
    expect(
      translateTradeApiMessage('Error: Your account must be in-game to use this feature.', 'zh-TW'),
    ).toBe('錯誤：您的帳號必須在遊戲中才能使用此功能。');
  });

  it('supports bilingual formatting and leaves unknown messages unchanged', () => {
    expect(
      translateTradeApiMessage('Your account must be in-game to use this feature.', 'zh-TW', {
        bilingual: true,
      }),
    ).toBe(
      '您的帳號必須在遊戲中才能使用此功能。 (Your account must be in-game to use this feature.)',
    );
    expect(translateTradeApiMessage('Some brand new server message', 'zh-TW')).toBe(
      'Some brand new server message',
    );
  });

  it('observes official .toast-container including late mount and translates new toast nodes', async () => {
    const stop = observeOfficialTradeToasts(document, {
      locale: 'zh-TW',
      ui: { 'Item no longer available': '物品不存在' },
    });

    // Late-mounted .toast-container
    const container = document.createElement('div');
    container.className = 'toast-container toast-top-center';
    document.body.appendChild(container);
    await new Promise((r) => setTimeout(r, 0));

    const toast = document.createElement('div');
    toast.className = 'toast toast-error';
    const msg = document.createElement('div');
    msg.className = 'toast-message';
    msg.textContent = 'Rate limit exceeded; please try again in 12 seconds';
    toast.appendChild(msg);
    container.appendChild(toast);
    await new Promise((r) => setTimeout(r, 0));

    expect(msg.textContent).toBe('請求過於頻繁，請在 12 秒後再試。');

    // Second .toast-container (toast-bottom-center) mounted after the first
    const bottomContainer = document.createElement('div');
    bottomContainer.className = 'toast-container toast-bottom-center';
    document.body.appendChild(bottomContainer);
    await new Promise((r) => setTimeout(r, 0));

    const bottomMsg = document.createElement('div');
    bottomMsg.className = 'toast-message';
    bottomMsg.textContent = 'Your account must be in-game to use this feature.';
    bottomContainer.appendChild(bottomMsg);
    await new Promise((r) => setTimeout(r, 0));

    expect(bottomMsg.textContent).toBe('您的帳號必須在遊戲中才能使用此功能。');

    // Official Vue 3 .poe-toast-container (actual container used by PoE trade error toasts)
    const poeToastContainer = document.createElement('div');
    poeToastContainer.className = 'poe-toast-container poe-toast-container--position-bottom-center';
    const poeToastTitle = document.createElement('div');
    poeToastTitle.className = 'poe-toast-trade__title';
    poeToastTitle.textContent = 'Invalid query; Your account must be in-game to use this feature';
    poeToastContainer.appendChild(poeToastTitle);
    document.body.appendChild(poeToastContainer);
    await new Promise((r) => setTimeout(r, 0));

    expect(poeToastTitle.textContent).toBe('無效請求；您的帳號必須在遊戲中才能使用此功能。');

    // Removing .poe-toast-container disconnects its observer; re-mounting a new one works again
    poeToastContainer.remove();
    await new Promise((r) => setTimeout(r, 0));

    const detachedMsg = document.createElement('div');
    detachedMsg.textContent = 'Item no longer available';
    poeToastContainer.appendChild(detachedMsg);
    await new Promise((r) => setTimeout(r, 0));
    expect(detachedMsg.textContent).toBe('Item no longer available');

    const secondPoeToast = document.createElement('div');
    secondPoeToast.className = 'poe-toast-container poe-toast-container--position-bottom-center';
    const secondTitle = document.createElement('div');
    secondTitle.className = 'poe-toast-trade__title';
    secondTitle.textContent = 'Invalid query; Your account must be in-game to use this feature';
    secondPoeToast.appendChild(secondTitle);
    document.body.appendChild(secondPoeToast);
    await new Promise((r) => setTimeout(r, 0));
    expect(secondTitle.textContent).toBe('無效請求；您的帳號必須在遊戲中才能使用此功能。');

    stop();

    const afterStop = document.createElement('div');
    afterStop.textContent = 'Item no longer available';
    container.appendChild(afterStop);
    await new Promise((r) => setTimeout(r, 0));
    expect(afterStop.textContent).toBe('Item no longer available');
  });
});
