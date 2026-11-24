import { resolveSingleEnqueueToast } from '@/components/sidebar/live-search-presentation';
import { dispatchPoeEvent, type PoeEventMap } from '@/utils/event-contracts';
import { enqueueLiveSearchConnections } from '@/utils/extension-protocol';
import { t } from '@/utils/i18n';
import { type PoeVersion } from '@/utils/trade-context';
import { stripLiveSuffix } from '@/utils/trade-search-identity';
import { loadTradeDictionaries } from '@/utils/trade-stat-dictionary';
import { decodeTradeSearchUrl, extractQueryMetadata } from '@/utils/trade-url-codec';
import { syncSearchFormToUrl } from './criteria-overlay-manager';

const SEND_TO_CONSOLE_TOAST_DURATION_MS = 3000;

export interface SendToConsolePorts {
  syncSearchFormToUrl: typeof syncSearchFormToUrl;
  decodeTradeSearchUrl: typeof decodeTradeSearchUrl;
  loadTradeDictionaries: typeof loadTradeDictionaries;
  extractQueryMetadata: typeof extractQueryMetadata;
  enqueueLiveSearchConnections: typeof enqueueLiveSearchConnections;
  dispatchToast: (detail: PoeEventMap['poexd-toast']) => void;
}

const defaultSendToConsolePorts: SendToConsolePorts = {
  syncSearchFormToUrl,
  decodeTradeSearchUrl,
  loadTradeDictionaries,
  extractQueryMetadata,
  enqueueLiveSearchConnections,
  dispatchToast: (detail) => dispatchPoeEvent('poexd-toast', detail),
};

export async function sendCurrentSearchToConsole(
  version: PoeVersion,
  ports?: Partial<SendToConsolePorts>,
): Promise<void> {
  const resolvedPorts: SendToConsolePorts = {
    ...defaultSendToConsolePorts,
    ...ports,
  };

  const notify = (message: string, tone: PoeEventMap['poexd-toast']['tone']) => {
    resolvedPorts.dispatchToast({
      message,
      tone,
      durationMs: SEND_TO_CONSOLE_TOAST_DURATION_MS,
    });
  };

  try {
    let syncedUrl: string;
    try {
      syncedUrl = await resolvedPorts.syncSearchFormToUrl();
    } catch (syncErr) {
      notify(syncErr instanceof Error ? syncErr.message : String(syncErr), 'error');
      return;
    }

    const cleanUrl = stripLiveSuffix(syncedUrl).trim();
    if (!cleanUrl) {
      notify(t('injectedControls.cannotGetUrl'), 'error');
      return;
    }

    let derivedName = '';
    try {
      const decoded = await resolvedPorts.decodeTradeSearchUrl(cleanUrl);
      if (decoded) {
        await resolvedPorts.loadTradeDictionaries(decoded.gameVersion);
        const meta = resolvedPorts.extractQueryMetadata(decoded.query, decoded.gameVersion);
        derivedName = meta.suggestedName?.trim() || '';
      }
    } catch {
      // Best-effort name derivation
    }

    const displayLabel = derivedName || t('injectedControls.unnamedSearch');

    const res = await resolvedPorts.enqueueLiveSearchConnections(
      {
        gameVersion: version,
        items: [
          {
            url: cleanUrl,
            ...(derivedName ? { name: derivedName } : {}),
          },
        ],
      },
      { timeoutMessage: t('common.sendToConsoleFailed') },
    );

    const toast = resolveSingleEnqueueToast(res, displayLabel);
    notify(toast.message, toast.tone);
  } catch (err) {
    notify(err instanceof Error ? err.message : t('common.sendToConsoleFailed'), 'error');
  }
}

export function cleanSendToConsoleButtons(): void {
  document.querySelectorAll<HTMLElement>('.poexd-send-to-console-btn').forEach((btn) => {
    btn.remove();
  });
}

export function updateSendToConsoleButtonsLocale(): void {
  document.querySelectorAll<HTMLElement>('.poexd-send-to-console-btn').forEach((btn) => {
    btn.title = t('injectedControls.sendToConsoleTitle');
    btn.textContent = t('injectedControls.sendToConsole');
  });
}

export function injectSendToConsoleButton(
  version: PoeVersion,
  ports?: Partial<SendToConsolePorts>,
): void {
  if (document.body?.getAttribute('data-poexd-page-role') === 'live-search-primary') {
    cleanSendToConsoleButtons();
    return;
  }

  const controlsList = document.querySelectorAll<HTMLElement>('.search-panel .controls');
  controlsList.forEach((controlsEl) => {
    if (controlsEl.querySelector('.poexd-send-to-console-btn')) return;

    const targetContainer =
      controlsEl.querySelector<HTMLElement>('.controls-left') ||
      controlsEl.querySelector<HTMLElement>('.livesearch-btn')?.parentElement ||
      controlsEl.querySelector<HTMLElement>('.controls-center') ||
      controlsEl.querySelector<HTMLElement>('.search-btn')?.parentElement ||
      controlsEl;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn poexd-send-to-console-btn';
    btn.setAttribute('data-poexd-send-to-console', 'true');
    btn.title = t('injectedControls.sendToConsoleTitle');
    btn.textContent = t('injectedControls.sendToConsole');

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (btn.disabled) return;
      btn.disabled = true;

      try {
        await sendCurrentSearchToConsole(version, ports);
      } finally {
        btn.disabled = false;
      }
    });

    targetContainer.appendChild(btn);
  });
}
