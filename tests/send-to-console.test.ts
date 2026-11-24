// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanSendToConsoleButtons,
  injectSendToConsoleButton,
  sendCurrentSearchToConsole,
  type SendToConsolePorts,
} from '@/entrypoints/content/logic/send-to-console';
import { resetI18nStateForTests, t } from '@/utils/i18n';

function createMockPorts(overrides: Partial<SendToConsolePorts> = {}): SendToConsolePorts {
  return {
    syncSearchFormToUrl: vi.fn(
      async () => 'https://www.pathofexile.com/trade/search/Keepers/abc123/live',
    ),
    decodeTradeSearchUrl: vi.fn(async () => ({
      gameVersion: 'poe1' as const,
      league: 'Keepers',
      searchId: 'abc123',
      query: { status: { option: 'online' } },
      source: 'api' as const,
    })),
    loadTradeDictionaries: vi.fn(async () => {}),
    extractQueryMetadata: vi.fn(() => ({
      suggestedName: 'Life Ring',
      chips: [],
    })) as unknown as SendToConsolePorts['extractQueryMetadata'],
    enqueueLiveSearchConnections: vi.fn(async () => ({
      success: true,
      addedCount: 1,
      skippedCount: 0,
    })),
    dispatchToast: vi.fn(),
    ...overrides,
  };
}

describe('Send-to-Console workflow & button adapter', () => {
  beforeEach(() => {
    resetI18nStateForTests('en');
    document.body.innerHTML = '';
    document.body.removeAttribute('data-poexd-page-role');
  });

  afterEach(() => {
    cleanSendToConsoleButtons();
    document.body.innerHTML = '';
    document.body.removeAttribute('data-poexd-page-role');
    vi.restoreAllMocks();
  });

  it('dispatches an error toast and does not enqueue when write-through fails', async () => {
    const ports = createMockPorts({
      syncSearchFormToUrl: vi.fn(async () => {
        throw new Error('Write-through failed');
      }),
    });

    await sendCurrentSearchToConsole('poe1', ports);

    expect(ports.enqueueLiveSearchConnections).not.toHaveBeenCalled();
    expect(ports.dispatchToast).toHaveBeenCalledWith({
      message: 'Write-through failed',
      tone: 'error',
      durationMs: 3000,
    });
  });

  it('dispatches the localized cannot-get-URL error toast and does not enqueue when stripped URL is empty', async () => {
    const ports = createMockPorts({
      syncSearchFormToUrl: vi.fn(async () => '   '),
    });

    await sendCurrentSearchToConsole('poe1', ports);

    expect(ports.enqueueLiveSearchConnections).not.toHaveBeenCalled();
    expect(ports.dispatchToast).toHaveBeenCalledWith({
      message: t('injectedControls.cannotGetUrl'),
      tone: 'error',
      durationMs: 3000,
    });
  });

  it('strips /live, derives suggested name, enqueues, and dispatches the resolved toast', async () => {
    const ports = createMockPorts();

    await sendCurrentSearchToConsole('poe1', ports);

    expect(ports.decodeTradeSearchUrl).toHaveBeenCalledWith(
      'https://www.pathofexile.com/trade/search/Keepers/abc123',
    );
    expect(ports.loadTradeDictionaries).toHaveBeenCalledWith('poe1');
    expect(ports.enqueueLiveSearchConnections).toHaveBeenCalledWith(
      {
        gameVersion: 'poe1',
        items: [
          {
            url: 'https://www.pathofexile.com/trade/search/Keepers/abc123',
            name: 'Life Ring',
          },
        ],
      },
      { timeoutMessage: t('common.sendToConsoleFailed') },
    );
    expect(ports.dispatchToast).toHaveBeenCalledWith(
      expect.objectContaining({
        tone: 'default',
        durationMs: 3000,
      }),
    );
    const toastArg = (ports.dispatchToast as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(toastArg.message).toContain('Life Ring');
  });

  it('falls back to the localized unnamed-search label when decode fails', async () => {
    const ports = createMockPorts({
      decodeTradeSearchUrl: vi.fn(async () => {
        throw new Error('decode failed');
      }),
    });

    await sendCurrentSearchToConsole('poe2', ports);

    expect(ports.enqueueLiveSearchConnections).toHaveBeenCalledWith(
      {
        gameVersion: 'poe2',
        items: [
          {
            url: 'https://www.pathofexile.com/trade/search/Keepers/abc123',
          },
        ],
      },
      { timeoutMessage: t('common.sendToConsoleFailed') },
    );
    const toastArg = (ports.dispatchToast as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(toastArg.tone).toBe('default');
    expect(toastArg.message).toContain(t('injectedControls.unnamedSearch'));
  });

  it('falls back to the localized unnamed-search label when dictionary loading fails', async () => {
    const ports = createMockPorts({
      loadTradeDictionaries: vi.fn(async () => {
        throw new Error('dictionary load failed');
      }),
    });

    await sendCurrentSearchToConsole('poe1', ports);

    expect(ports.enqueueLiveSearchConnections).toHaveBeenCalledWith(
      {
        gameVersion: 'poe1',
        items: [
          {
            url: 'https://www.pathofexile.com/trade/search/Keepers/abc123',
          },
        ],
      },
      { timeoutMessage: t('common.sendToConsoleFailed') },
    );
    const toastArg = (ports.dispatchToast as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(toastArg.tone).toBe('default');
    expect(toastArg.message).toContain(t('injectedControls.unnamedSearch'));
  });

  it('dispatches a fallback error toast when enqueue rejects', async () => {
    const ports = createMockPorts({
      enqueueLiveSearchConnections: vi.fn(async () => {
        throw new Error('IPC channel closed');
      }),
    });

    await sendCurrentSearchToConsole('poe1', ports);

    expect(ports.dispatchToast).toHaveBeenCalledWith({
      message: 'IPC channel closed',
      tone: 'error',
      durationMs: 3000,
    });
  });

  it('guards against concurrent clicks while in flight and re-enables the button afterward', async () => {
    let resolveSync!: (url: string) => void;
    const syncPromise = new Promise<string>((resolve) => {
      resolveSync = resolve;
    });
    const ports = createMockPorts({
      syncSearchFormToUrl: vi.fn(() => syncPromise),
    });

    const searchPanel = document.createElement('div');
    searchPanel.className = 'search-panel';
    const controls = document.createElement('div');
    controls.className = 'controls';
    const left = document.createElement('div');
    left.className = 'controls-left';
    controls.appendChild(left);
    searchPanel.appendChild(controls);
    document.body.appendChild(searchPanel);

    injectSendToConsoleButton('poe1', ports);
    const btn = left.querySelector<HTMLButtonElement>('.poexd-send-to-console-btn')!;
    expect(btn).toBeTruthy();

    btn.click();
    btn.click();
    await Promise.resolve();

    expect(btn.disabled).toBe(true);
    expect(ports.syncSearchFormToUrl).toHaveBeenCalledTimes(1);

    resolveSync('https://www.pathofexile.com/trade/search/Keepers/xyz789');
    await vi.waitFor(() => {
      expect(btn.disabled).toBe(false);
    });
    expect(ports.enqueueLiveSearchConnections).toHaveBeenCalledTimes(1);
  });

  it('does not inject button on the LiveSearch Primary Page and cleans existing buttons', () => {
    const searchPanel = document.createElement('div');
    searchPanel.className = 'search-panel';
    const controls = document.createElement('div');
    controls.className = 'controls';
    searchPanel.appendChild(controls);
    document.body.appendChild(searchPanel);

    injectSendToConsoleButton('poe1', createMockPorts());
    expect(document.querySelector('.poexd-send-to-console-btn')).toBeTruthy();

    document.body.setAttribute('data-poexd-page-role', 'live-search-primary');
    injectSendToConsoleButton('poe1', createMockPorts());
    expect(document.querySelector('.poexd-send-to-console-btn')).toBeNull();
  });
});
