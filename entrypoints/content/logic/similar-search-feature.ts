/**
 * 在一般市集頁接上找相似（ADR-0020）：結果列的「相似」按鈕 → 工作階段 → 面板與列標記。
 * 搜尋由頁面端以使用者自己的登入送出；每一批結果經 Cross-World RPC 交給官方 store 顯示。
 */
import { requestMainWorld } from '@/utils/cross-world-rpc';
import { dispatchPoeEvent, listenPoeEvent } from '@/utils/event-contracts';
import { loadExtensionJson } from '@/utils/extension-json-cache';
import { t } from '@/utils/i18n';
import type { Preferences } from '@/utils/preferences';
import { provideSimilarSearchEntry } from '@/utils/similar-search-entry';
import type { PoeVersion } from '@/utils/trade-context';
import type { TradeResultCache } from '@/utils/trade-result-cache';
import { createPoeEventCriteriaOverlayChannel } from './criteria-overlay-manager';
import type { ResultEnhancementPipeline } from './result-enhancement-pipeline';
import {
  mountSimilarSearchPanelHost,
  type SimilarPanelAppearance,
} from './similar-search-panel-host';
import {
  SimilarSearchSession,
  type SimilarPanelAnchor,
  type SimilarSessionRpc,
} from './similar-search-session';
import { createSimilarTradeTransport } from './similar-search-transport';

export interface InstallSimilarSearchInput {
  ctx: unknown;
  version: PoeVersion;
  pipeline: Pick<ResultEnhancementPipeline, 'setSimilarSearchOpener' | 'setSimilarMarksView'>;
  cache: TradeResultCache;
  preferences: {
    read(): Readonly<Preferences>;
    subscribe(listener: (snapshot: Readonly<Preferences>) => void): () => void;
  };
  getLeague(): string | undefined;
}

const RPC_TIMEOUT_MS = 5000;

const similarRpc: SimilarSessionRpc = {
  show: (request) => requestMainWorld('similar.show-batch', request, { timeoutMs: RPC_TIMEOUT_MS }),
  activate: (localId) =>
    requestMainWorld('similar.activate', { localId }, { timeoutMs: RPC_TIMEOUT_MS }),
  restore: (request) => requestMainWorld('similar.restore', request, { timeoutMs: RPC_TIMEOUT_MS }),
};

/** 英文市集 stat 寫法（pseudo 總和與列標記用）；同一個陣列項取第一個 */
export async function loadEnglishStatText(
  version: PoeVersion,
  load: (path: string) => Promise<unknown> = loadExtensionJson,
): Promise<(statId: string) => string | undefined> {
  const json = (await load(`json/${version}/locales/en/trade-stats.json`)) as {
    stats?: Record<string, string | string[]>;
  } | null;
  const stats = json?.stats ?? {};
  return (statId) => {
    const text = stats[statId];
    return Array.isArray(text) ? text[0] : text;
  };
}

async function readPageStatus(): Promise<string | undefined> {
  const { snapshot } = await createPoeEventCriteriaOverlayChannel().read();
  const status = (snapshot as { status?: unknown }).status;
  if (typeof status === 'string' && status !== '') return status;
  if (status && typeof status === 'object') {
    const option = (status as { option?: unknown }).option;
    if (typeof option === 'string' && option !== '') return option;
  }
  return undefined;
}

const appearanceOf = (snapshot: Readonly<Preferences>): SimilarPanelAppearance => ({
  theme: snapshot.theme,
  themeCustomOverrides: snapshot.themeCustomOverrides,
  fontSizeScale: snapshot.fontSizeScale,
  densityScale: snapshot.densityScale,
});

function anchorOf(element: Element): SimilarPanelAnchor {
  const { top, left, bottom, right } = element.getBoundingClientRect();
  return { top, left, bottom, right };
}

export function installSimilarSearch(input: InstallSimilarSearchInput): () => void {
  const { version, pipeline, cache, preferences } = input;
  const session = new SimilarSearchSession({
    version,
    cache,
    getLeague: input.getLeague,
    loadEnglishStats: () => loadEnglishStatText(version),
    readStatus: readPageStatus,
    readPreferences: () => {
      const snapshot = preferences.read();
      return {
        tolerance: snapshot.similarSearchTolerance,
        scope: snapshot.similarSearchScope,
        weaponMode: snapshot.similarSearchWeaponMode,
      };
    },
    createTransport: (league) =>
      createSimilarTradeTransport({ origin: window.location.origin, version, league }),
    rpc: similarRpc,
    notify: (message, tone) => dispatchPoeEvent('poexd-toast', { message, tone }),
    translate: (key) => t(`similarSearch.${key}`),
  });
  const panel = mountSimilarSearchPanelHost({ ctx: input.ctx, version, session });
  panel.syncAppearance(appearanceOf(preferences.read()));

  const stopPreferences = preferences.subscribe((snapshot) =>
    panel.syncAppearance(appearanceOf(snapshot)),
  );
  const stopMarks = session.subscribe(() => pipeline.setSimilarMarksView(session.activeView()));
  const stopOfficialSearch = listenPoeEvent('poexd-search-triggered', () => {
    void session.handleOfficialSearch();
  });
  pipeline.setSimilarSearchOpener((resultId, row) => {
    void session.open(resultId, anchorOf(row));
  });
  // 釘選物品與結果看板的入口：面板放在側邊欄裡被點的那一列旁邊
  const stopEntry = provideSimilarSearchEntry({
    version,
    open: (item, anchor) => void session.openItem(item, anchorOf(anchor)),
  });

  return () => {
    stopEntry();
    pipeline.setSimilarSearchOpener(undefined);
    pipeline.setSimilarMarksView(undefined);
    stopOfficialSearch();
    stopMarks();
    stopPreferences();
    void session.close();
    session.dispose();
    panel.dispose();
  };
}
