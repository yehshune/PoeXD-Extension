/**
 * Similar Item Search（找相似，ADR-0020）在市集頁的工作階段：面板的狀態都在這裡。
 *
 * 從結果列開啟 → 依 Source Item 建立草稿 → 使用者按開始 → 執行搜尋，每一批結果交給
 * MAIN world 變成官方 store 的合成 search → 分頁切換批次 → 回到我的搜尋或關閉面板時移除合成 search。
 * 使用者按官方「搜尋」時停止執行，並移除剩下的合成 search。草稿不寫進儲存（ADR-0008）。
 */
import type { RpcOutcome } from '@/utils/cross-world-rpc';
import {
  createSimilarSearchDraft,
  runSimilarSearch,
  type SimilarBatch,
  type SimilarSearchDraft,
  type SimilarSearchScope,
  type SimilarStopReason,
  type WeaponModePreference,
} from '@/utils/similar-item-search';
import {
  SIMILAR_SEARCH_LOCAL_ID_PREFIX,
  type SimilarRestoreRequest,
  type SimilarRestoreResponse,
  type SimilarShowBatchRequest,
  type SimilarShowBatchResponse,
} from '@/utils/similar-search-rpc';
import { markSimilarSearchId } from '@/utils/similar-search-entry';
import type { PoeVersion } from '@/utils/trade-context';
import type { TradeResultCache } from '@/utils/trade-result-cache';
import type { DisposableSimilarTransport } from './similar-search-transport';

export const HOME_BATCH_KEY = 'home';

export type SimilarSessionPhase = 'editing' | 'running' | 'done';

export interface SimilarPanelAnchor {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export interface SimilarSessionState {
  open: boolean;
  anchor?: SimilarPanelAnchor;
  sourceName?: string;
  draft?: SimilarSearchDraft;
  phase: SimilarSessionPhase;
  progress?: { search: number; phase: 'strict' | 'relaxed' };
  batches: SimilarBatch[];
  /** 顯示中的批次；`home` 是使用者自己的搜尋 */
  activeKey: string;
  reason?: SimilarStopReason;
  /** 官方搜尋取代了找相似的結果 */
  replaced: boolean;
  dropped: string[];
}

export interface SimilarSessionPreferences {
  tolerance: number;
  scope: SimilarSearchScope;
  weaponMode: WeaponModePreference;
}

export interface SimilarSessionRpc {
  show(request: SimilarShowBatchRequest): Promise<RpcOutcome<SimilarShowBatchResponse>>;
  activate(localId: string): Promise<RpcOutcome<null>>;
  restore(request: SimilarRestoreRequest): Promise<RpcOutcome<SimilarRestoreResponse>>;
}

export interface SimilarSessionDeps {
  version: PoeVersion;
  cache: TradeResultCache;
  getLeague(): string | undefined;
  loadEnglishStats(): Promise<(statId: string) => string | undefined>;
  /** 頁面目前的販售狀態（`securable`、`available`…） */
  readStatus(): Promise<string | undefined>;
  readPreferences(): SimilarSessionPreferences;
  createTransport(league: string): DisposableSimilarTransport;
  rpc: SimilarSessionRpc;
  notify(message: string, tone: 'default' | 'error'): void;
  translate(key: 'notEligible' | 'renderFailed'): string;
  now?: () => number;
}

const INITIAL_STATE: SimilarSessionState = {
  open: false,
  phase: 'editing',
  batches: [],
  activeKey: HOME_BATCH_KEY,
  replaced: false,
  dropped: [],
};

const localIdOf = (key: string): string => `${SIMILAR_SEARCH_LOCAL_ID_PREFIX}${key}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function nameOf(item: unknown): string {
  if (!isRecord(item)) return '';
  return [item.name, item.typeLine]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(' ');
}

export class SimilarSearchSession {
  private state: SimilarSessionState = INITIAL_STATE;
  private readonly listeners = new Set<(state: SimilarSessionState) => void>();
  private controller?: AbortController;
  private transport?: DisposableSimilarTransport;
  private englishStatText?: (statId: string) => string | undefined;
  private homeLocalId?: string;
  /** 這次執行第一個官方 search id；依 Similarity 排序的那一批沒有自己的 id，用它換藏身處 token */
  private runSearchId?: string;
  private runToken = 0;

  constructor(private readonly deps: SimilarSessionDeps) {}

  getState(): SimilarSessionState {
    return this.state;
  }

  subscribe(listener: (state: SimilarSessionState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setState(patch: Partial<SimilarSessionState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener(this.state));
  }

  /** 正在顯示的批次與它的英文 stat 寫法（列標記用）；顯示使用者的搜尋時為 undefined */
  activeView() {
    const batch = this.state.batches.find((candidate) => candidate.key === this.state.activeKey);
    if (!batch || !this.state.draft || !this.englishStatText) return undefined;
    return { batch, draft: this.state.draft, englishStatText: this.englishStatText };
  }

  /** 從結果列開啟；物品不適用時提示並回傳 false */
  async open(resultId: string, anchor: SimilarPanelAnchor): Promise<boolean> {
    return this.openItem(this.deps.cache.get(resultId)?.item, anchor);
  }

  /** 從釘選物品或結果看板開啟：直接用物品 JSON 當 Source Item */
  async openItem(item: unknown, anchor: SimilarPanelAnchor): Promise<boolean> {
    if (!isRecord(item)) return false;
    await this.reset();
    this.englishStatText ??= await this.deps.loadEnglishStats();
    const prefs = this.deps.readPreferences();
    const status = await this.deps.readStatus().catch(() => undefined);
    const draft = createSimilarSearchDraft(item, {
      version: this.deps.version,
      englishStatText: this.englishStatText,
      tolerance: prefs.tolerance,
      scope: prefs.scope,
      weaponMode: prefs.weaponMode,
      ...(status ? { status } : {}),
    });
    if (!draft) {
      this.deps.notify(this.deps.translate('notEligible'), 'default');
      return false;
    }
    this.setState({ ...INITIAL_STATE, open: true, anchor, draft, sourceName: nameOf(item) });
    return true;
  }

  updateDraft(update: (draft: SimilarSearchDraft) => SimilarSearchDraft): void {
    if (!this.state.draft || this.state.phase === 'running') return;
    this.setState({ draft: update(this.state.draft) });
  }

  /** 新的一次執行：先移除上一次的合成 search */
  async start(): Promise<void> {
    const draft = this.state.draft;
    const league = this.deps.getLeague();
    if (!draft || !league || this.state.phase === 'running' || !this.englishStatText) return;
    await this.removeBatches();
    const token = ++this.runToken;
    const controller = new AbortController();
    this.controller = controller;
    this.transport?.dispose();
    this.transport = this.deps.createTransport(league);
    this.runSearchId = undefined;
    this.setState({ phase: 'running', batches: [], activeKey: HOME_BATCH_KEY, replaced: false });
    let queue = Promise.resolve();
    const result = await runSimilarSearch(draft, {
      transport: this.transport,
      englishStatText: this.englishStatText,
      signal: controller.signal,
      ...(this.deps.now ? { now: this.deps.now } : {}),
      remember: (results, searchId) =>
        this.deps.cache.ingestBatch(results, { sourceSearchId: searchId, league }),
      onEvent: (event) => {
        if (token !== this.runToken) return;
        if (event.type === 'searching') {
          this.setState({ progress: { search: event.search, phase: event.phase } });
        } else if (event.type === 'batch') {
          this.runSearchId ??= event.batch.searchId;
          // 每一批的官方 search id 都要讓結果看板略過（官方會用它換藏身處 token）
          if (event.batch.searchId) markSimilarSearchId(event.batch.searchId);
          queue = queue.then(() => this.showBatch(event.batch, league, token));
        }
      },
    });
    await queue;
    if (token !== this.runToken) return;
    this.setState({
      phase: 'done',
      reason: result.reason,
      dropped: result.dropped,
      progress: undefined,
    });
  }

  private async showBatch(batch: SimilarBatch, league: string, token: number): Promise<void> {
    if (token !== this.runToken) return;
    const outcome = await this.deps.rpc.show({
      localId: localIdOf(batch.key),
      realm: this.deps.version === 'poe2' ? 'poe2' : 'pc',
      league,
      searchId: batch.searchId ?? this.runSearchId ?? batch.key,
      items: batch.results.map((result) => result.entry as unknown as Record<string, unknown>),
      total: batch.total,
      inexact: batch.inexact,
    });
    if (token !== this.runToken) return;
    if (!outcome.ok) {
      this.deps.notify(this.deps.translate('renderFailed'), 'error');
      return;
    }
    const previous = outcome.data.previousLocalId;
    if (
      this.homeLocalId === undefined &&
      previous &&
      !previous.startsWith(SIMILAR_SEARCH_LOCAL_ID_PREFIX)
    ) {
      this.homeLocalId = previous;
    }
    this.setState({ batches: [...this.state.batches, batch], activeKey: batch.key });
  }

  async activate(key: string): Promise<void> {
    if (key === this.state.activeKey) return;
    if (key === HOME_BATCH_KEY) {
      if (!this.homeLocalId) return;
      const outcome = await this.deps.rpc.activate(this.homeLocalId);
      if (outcome.ok) this.setState({ activeKey: HOME_BATCH_KEY });
      return;
    }
    if (!this.state.batches.some((batch) => batch.key === key)) return;
    const outcome = await this.deps.rpc.activate(localIdOf(key));
    if (outcome.ok) this.setState({ activeKey: key });
  }

  /** 回到我的搜尋：停止執行、移除合成 search，草稿保留可以再調整 */
  async backToMySearch(): Promise<void> {
    this.stopRun();
    await this.removeBatches();
    this.setState({
      phase: 'editing',
      batches: [],
      activeKey: HOME_BATCH_KEY,
      progress: undefined,
    });
  }

  async close(): Promise<void> {
    await this.reset();
    this.setState({ ...INITIAL_STATE });
  }

  /** 使用者按了官方「搜尋」：官方已移除顯示中的合成 search，停下並移除其餘的 */
  async handleOfficialSearch(): Promise<void> {
    if (this.state.phase !== 'running' && this.state.batches.length === 0) return;
    this.stopRun();
    const localIds = this.state.batches.map((batch) => localIdOf(batch.key));
    this.homeLocalId = undefined;
    this.setState({
      phase: 'editing',
      batches: [],
      activeKey: HOME_BATCH_KEY,
      replaced: true,
      progress: undefined,
    });
    if (localIds.length > 0) await this.deps.rpc.restore({ localIds });
  }

  dispose(): void {
    this.stopRun();
    this.transport?.dispose();
    this.listeners.clear();
  }

  private stopRun(): void {
    this.runToken += 1;
    this.controller?.abort();
    this.controller = undefined;
  }

  private async reset(): Promise<void> {
    this.stopRun();
    await this.removeBatches();
  }

  private async removeBatches(): Promise<void> {
    const localIds = this.state.batches.map((batch) => localIdOf(batch.key));
    const home = this.homeLocalId;
    this.homeLocalId = undefined;
    if (localIds.length === 0) return;
    await this.deps.rpc.restore({ localIds, ...(home ? { homeLocalId: home } : {}) });
  }
}
