/**
 * 搜尋結果看板的「前往藏身處」狀態機（`ResultBoardRuntime` 內部實作檔）：
 * 統一擁有 `refreshing` / `traveling` 狀態、1,200ms 防連點冷卻、過期重整輪詢與 whisper 回應配對。
 */
import type { WhisperOutcome } from '@/utils/result-board/board-events';
import type { BoardMark } from '@/utils/result-board/board-session';
import {
  ROW_SELECTOR,
  findOfficialRow,
  findTravelButton,
  isExpiredButton,
  isUsableButton,
} from './result-board-dom';

/** 按下官方「前往藏身處」後，多久內收到的 whisper 回應算是那一筆的 */
const WHISPER_MATCH_WINDOW_MS = 20_000;
/** 官方 whisper 錯誤 code 1：物品已不存在（ADR-0017） */
const WHISPER_GONE_CODE = 1;
/** 等官方重新整理一筆結果、讓「前往藏身處」恢復可用的上限 */
export const TRAVEL_REFRESH_TIMEOUT_MS = 10_000;
const TRAVEL_REFRESH_POLL_MS = 100;
/** 送出前往藏身處後短暫鎖定按鈕，避免連點 */
export const TRAVEL_COOLDOWN_MS = 1_200;

/**
 * 前往藏身處的結果：
 * - `travelled`：已按下官方按鈕
 * - `in-progress`：該筆結果正在重新整理或冷卻中，忽略重複點擊
 * - `unavailable`：找不到結果列或沒有可用的按鈕（例如需要私訊的刊登）
 * - `busy`：連結過期、但正在載入更多，重新整理的 fetch 會和載入混在一起，先不處理
 * - `refresh-failed`：重新整理後按鈕仍未恢復（逾時、結果列消失或已下架）
 */
export type TravelOutcome = 'travelled' | 'in-progress' | 'unavailable' | 'busy' | 'refresh-failed';

export type TravelPhase = 'refreshing' | 'traveling';
export type TravelStateMap = Readonly<Record<string, TravelPhase>>;

export interface ResultBoardTravelDeps {
  doc: Document;
  now: () => number;
  isEnabled: () => boolean;
  isLoaderRunning: () => boolean;
  markVisited: (id: string) => void;
  markSold: (id: string) => void;
}

export class ResultBoardTravel {
  private states: TravelStateMap = {};
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly listeners = new Set<(states: TravelStateMap) => void>();
  /** 已按下、還在等 whisper 回應的「前往藏身處」（依按下順序） */
  private pendingTravels: readonly { id: string; at: number }[] = [];

  constructor(private readonly deps: ResultBoardTravelDeps) {}

  getStates(): TravelStateMap {
    return this.states;
  }

  subscribe(listener: (states: TravelStateMap) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 按下官方結果列的「前往藏身處」。連結過期時先按官方的「重新整理」（只重新取得這一筆），
   * 等按鈕恢復可用再按；`onRefreshing` 在開始等待重新整理時呼叫一次。
   */
  async travel(id: string, onRefreshing?: () => void): Promise<TravelOutcome> {
    if (this.states[id]) return 'in-progress';
    const row = findOfficialRow(id, this.deps.doc);
    const button = findTravelButton(row);
    if (isUsableButton(button)) {
      this.startCooldown(id);
      button.click();
      return 'travelled';
    }
    if (!row || !isExpiredButton(button)) return 'unavailable';
    if (this.deps.isLoaderRunning()) return 'busy';

    // 已經在重新整理（例如連按兩次）就只等，不再送一次
    if (!row.classList.contains('refreshing')) {
      const refresh = row.querySelector<HTMLElement>('button.refresh');
      if (!isUsableButton(refresh)) return 'unavailable';
      refresh.click();
    }
    this.setState(id, 'refreshing');
    onRefreshing?.();

    const refreshed = await this.waitForTravelButton(id);
    if (!refreshed) {
      this.setState(id, undefined);
      return 'refresh-failed';
    }
    this.startCooldown(id);
    refreshed.click();
    return 'travelled';
  }

  /** 官方「前往藏身處」按鈕（直購刊登）：記下待確認請求，等 whisper 回應成功才標記已前往／已售出 */
  readonly handleDocumentClick = (event: MouseEvent): void => {
    const target = event.target as Element | null;
    const button = target?.closest?.('.direct-btn') as HTMLElement | null;
    if (!isUsableButton(button) || isExpiredButton(button)) return;
    const row = button.closest?.(ROW_SELECTOR);
    const id = row?.getAttribute('data-id');
    if (!id) return;
    this.pendingTravels = [...this.pendingTravels, { id, at: this.deps.now() }];
  };

  /** whisper 回應依序對應最早按下、且還在時限內的那一次「前往藏身處」 */
  handleWhisperOutcome(outcome: WhisperOutcome): void {
    const now = this.deps.now();
    const [pending, ...rest] = this.pendingTravels.filter(
      (entry) => now - entry.at <= WHISPER_MATCH_WINDOW_MS,
    );
    this.pendingTravels = rest;
    if (!pending) return;
    if (outcome.code === WHISPER_GONE_CODE) {
      this.deps.markSold(pending.id);
      return;
    }
    if (outcome.status >= 200 && outcome.status < 300 && outcome.success === true) {
      this.deps.markVisited(pending.id);
    }
  }

  /** 當某筆結果已標記為已前往或已售出時，立即解除其前往中／重整中狀態 */
  syncMarks(marks: Readonly<Record<string, BoardMark>>): void {
    for (const id of Object.keys(this.states)) {
      if (marks[id]) this.setState(id, undefined);
    }
  }

  /** 換搜尋或停用時清除所有待確認請求、狀態與計時器 */
  reset(): void {
    this.pendingTravels = [];
    this.timers.forEach((timer) => clearTimeout(timer));
    this.timers.clear();
    if (Object.keys(this.states).length > 0) {
      this.states = {};
      this.emit();
    }
  }

  private startCooldown(id: string): void {
    this.setState(id, 'traveling');
    this.timers.set(
      id,
      setTimeout(() => this.setState(id, undefined), TRAVEL_COOLDOWN_MS),
    );
  }

  private setState(id: string, next: TravelPhase | undefined): void {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    if (this.states[id] === next) return;
    const { [id]: _removed, ...rest } = this.states;
    this.states = next ? { ...rest, [id]: next } : rest;
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.states);
    }
  }

  /** 等官方重新整理完：同一筆結果列的按鈕不再過期且可用；結果列消失或逾時則放棄 */
  private async waitForTravelButton(id: string): Promise<HTMLElement | undefined> {
    for (let waited = 0; waited < TRAVEL_REFRESH_TIMEOUT_MS; waited += TRAVEL_REFRESH_POLL_MS) {
      await new Promise((resolve) => setTimeout(resolve, TRAVEL_REFRESH_POLL_MS));
      if (!this.deps.isEnabled()) return undefined;
      const row = findOfficialRow(id, this.deps.doc);
      if (!row) return undefined;
      const button = findTravelButton(row);
      if (
        !row.classList.contains('refreshing') &&
        !isExpiredButton(button) &&
        isUsableButton(button)
      ) {
        return button;
      }
    }
    return undefined;
  }
}
