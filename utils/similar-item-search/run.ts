/**
 * Similar Item Search 執行流程（ADR-0020 Decision 5）：只在使用者按下開始時執行，次數有上限。
 *
 * 1. 嚴格搜尋：每個參考 stat 都要達到門檻。找到 10 筆以上就結束；被截在 10000 筆時先提高加權下限。
 * 2. 放寬搜尋：保留必要 stat 與屬性下限、拿掉參考 stat 的門檻，調整加權總和下限
 *    （從參考數 × 容忍度開始），直到 10 ≤ 總數 < 10000；被截斷時一定提高。
 * 3. 一次最多 4 次搜尋、取 20 筆物品，同一個 id 只取一次。429、錯誤或中止都會停下並保留已找到的結果。
 */
import { buildSimilarSearchQuery } from './query';
import type {
  FetchedResult,
  SimilarBatch,
  SimilarBatchKind,
  SimilarRunDeps,
  SimilarRunEvent,
  SimilarRunResult,
  SimilarSearchResponse,
  SimilarStopReason,
} from './run-types';
import { orderBySimilarity } from './similarity';
import type { SimilarSearchDraft, SimilarSearchPhase } from './types';

export const SIMILAR_RUN_LIMITS = {
  searches: 4,
  fetched: 20,
  enough: 10,
  clipped: 10000,
  page: 10,
} as const;
/** 嚴格搜尋被截斷時，下限從「每個參考 stat 剛好達到原物品數值」附近開始 */
const STRICT_RAISE = 1.25;
/** 放寬搜尋被截斷且還沒有上界時，下限乘上這個倍數 */
const RELAXED_RAISE = 1.5;

class RunStop extends Error {
  constructor(
    readonly reason: SimilarStopReason,
    message: string = reason,
  ) {
    super(message);
  }
}

const roundMin = (value: number): number => Math.round(value * 100) / 100;

/** 二分法：有上界時取中點，否則往上放大 */
function nextWeightMin(lo: number, hi: number, raise: number): number {
  return roundMin(Number.isFinite(hi) ? (lo + hi) / 2 : lo * raise);
}

class SimilarRun {
  private searches = 0;
  private readonly fetched = new Map<string, FetchedResult>();
  private readonly batches: SimilarBatch[] = [];
  private relaxedCount = 0;
  private readonly now: () => number;
  private dropped: string[] = [];

  constructor(
    private readonly draft: SimilarSearchDraft,
    private readonly deps: SimilarRunDeps,
  ) {
    this.now = deps.now ?? Date.now;
  }

  private emit(event: SimilarRunEvent): void {
    this.deps.onEvent?.(event);
  }

  private checkAborted(): void {
    if (this.deps.signal?.aborted) throw new RunStop('aborted');
  }

  private get referenceCount(): number {
    return (
      this.draft.stats.filter((stat) => stat.role === 'reference').length - this.dropped.length
    );
  }

  private async search(
    phase: SimilarSearchPhase,
    weightMin?: number,
  ): Promise<SimilarSearchResponse> {
    if (this.searches >= SIMILAR_RUN_LIMITS.searches) throw new RunStop('search-limit');
    this.checkAborted();
    const query = buildSimilarSearchQuery(this.draft, {
      phase,
      ...(weightMin !== undefined ? { weightMin } : {}),
    });
    this.dropped = query.dropped;
    this.searches += 1;
    this.emit({
      type: 'searching',
      at: this.now(),
      phase,
      search: this.searches,
      ...(weightMin !== undefined ? { weightMin } : {}),
    });
    const outcome = await this.deps.transport.search(query.body, this.deps.signal);
    this.checkAborted();
    if (!outcome.ok)
      throw new RunStop(outcome.rateLimited ? 'rate-limited' : 'error', outcome.error);
    return outcome.data;
  }

  /** 取這次搜尋前面還沒取過的物品（單次 fetch 最多 10 筆），並排成一批 */
  private async addBatch(
    kind: SimilarBatchKind,
    response: SimilarSearchResponse,
    weightMin?: number,
  ) {
    const budget = SIMILAR_RUN_LIMITS.fetched - this.fetched.size;
    const wanted = response.result
      .filter((id) => !this.fetched.has(id))
      .slice(0, Math.min(SIMILAR_RUN_LIMITS.page, budget));
    if (wanted.length > 0) {
      this.checkAborted();
      const outcome = await this.deps.transport.fetch(wanted, response.id, this.deps.signal);
      this.checkAborted();
      if (!outcome.ok)
        throw new RunStop(outcome.rateLimited ? 'rate-limited' : 'error', outcome.error);
      const results = outcome.data.filter((entry) => wanted.includes(entry.id));
      results.forEach((entry) => this.fetched.set(entry.id, entry));
      this.deps.remember?.(results, response.id);
    }
    const shown = response.result.flatMap((id) => {
      const entry = this.fetched.get(id);
      return entry ? [entry] : [];
    });
    if (shown.length === 0) return;
    const key = kind === 'relaxed' ? `relaxed-${++this.relaxedCount}` : kind;
    this.pushBatch({
      key,
      kind,
      searchId: response.id,
      total: response.total,
      inexact: Boolean(response.inexact),
      ...(weightMin !== undefined ? { weightMin } : {}),
      results: shown.map((entry) => this.score(entry)),
    });
  }

  private score(entry: FetchedResult) {
    const [scored] = orderBySimilarity(this.draft, [entry], {
      englishStatText: this.deps.englishStatText,
    });
    return scored;
  }

  private pushBatch(batch: SimilarBatch): void {
    this.batches.push(batch);
    this.emit({ type: 'batch', at: this.now(), batch });
  }

  /** 回傳 true 表示嚴格搜尋已經足夠 */
  private async runStrict(): Promise<boolean> {
    let lo = this.referenceCount;
    let hi = Infinity;
    let weightMin: number | undefined;
    let clipped: { response: SimilarSearchResponse; weightMin?: number } | undefined;
    for (;;) {
      const response = await this.search('strict', weightMin).catch((error: unknown) => {
        if (clipped && error instanceof RunStop && error.reason === 'search-limit')
          return undefined;
        throw error;
      });
      if (!response) break;
      const isClipped = response.total >= SIMILAR_RUN_LIMITS.clipped;
      if (response.total >= SIMILAR_RUN_LIMITS.enough && !isClipped) {
        await this.addBatch('strict', response, weightMin);
        return true;
      }
      if (isClipped && this.referenceCount > 0) {
        clipped = { response, ...(weightMin !== undefined ? { weightMin } : {}) };
        lo = weightMin ?? lo;
        weightMin = nextWeightMin(lo, hi, STRICT_RAISE);
        continue;
      }
      if (clipped && weightMin !== undefined) {
        hi = weightMin;
        weightMin = nextWeightMin(lo, hi, STRICT_RAISE);
        continue;
      }
      await this.addBatch('strict', response, weightMin);
      return isClipped;
    }
    if (!clipped) return false;
    await this.addBatch('strict', clipped.response, clipped.weightMin);
    return true;
  }

  private async runRelaxed(): Promise<SimilarStopReason> {
    if (this.referenceCount === 0) return 'exhausted';
    let lo = 0;
    let hi = Infinity;
    let weightMin = roundMin((this.referenceCount * this.draft.tolerance) / 100);
    for (;;) {
      const response = await this.search('relaxed', weightMin);
      await this.addBatch('relaxed', response, weightMin);
      if (response.total >= SIMILAR_RUN_LIMITS.clipped) {
        lo = weightMin;
        weightMin = nextWeightMin(lo, hi, RELAXED_RAISE);
      } else if (response.total >= SIMILAR_RUN_LIMITS.enough) {
        return 'enough';
      } else {
        hi = weightMin;
        weightMin = nextWeightMin(lo, hi, RELAXED_RAISE);
      }
    }
  }

  async run(): Promise<SimilarRunResult> {
    let reason: SimilarStopReason;
    let error: string | undefined;
    try {
      reason = (await this.runStrict()) ? 'enough' : await this.runRelaxed();
    } catch (caught) {
      if (!(caught instanceof RunStop)) throw caught;
      reason = caught.reason;
      if (caught.message !== caught.reason) error = caught.message;
    }
    this.addSimilarityBatch();
    this.emit({ type: 'stopped', at: this.now(), reason, ...(error ? { error } : {}) });
    return {
      batches: this.batches,
      reason,
      ...(error ? { error } : {}),
      searches: this.searches,
      fetched: this.fetched.size,
      dropped: this.dropped,
    };
  }

  private addSimilarityBatch(): void {
    if (this.fetched.size === 0) return;
    const results = orderBySimilarity(this.draft, [...this.fetched.values()], {
      englishStatText: this.deps.englishStatText,
      ...(this.deps.priceInDivine ? { priceInDivine: this.deps.priceInDivine } : {}),
    });
    this.pushBatch({
      key: 'similarity',
      kind: 'similarity',
      total: results.length,
      inexact: false,
      results,
    });
  }
}

export function runSimilarSearch(
  draft: SimilarSearchDraft,
  deps: SimilarRunDeps,
): Promise<SimilarRunResult> {
  return new SimilarRun(draft, deps).run();
}
