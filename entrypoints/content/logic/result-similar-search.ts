/**
 * 找相似（ADR-0020）在官方結果列上的兩件事：
 * - 「相似」按鈕：只出現在可以找相似的稀有裝備上，按下時交給工作階段開啟面板。
 * - 顯示找相似的批次時，每列加上 Similarity 標章，詞綴行標記達到原數值／在容忍度內／缺少。
 */
import { t } from '@/utils/i18n';
import {
  draftKeysOfStatId,
  isSimilarSearchEligible,
  type SimilarBatch,
  type SimilarSearchDraft,
  type SimilarityMark,
} from '@/utils/similar-item-search';
import type { PoeVersion } from '@/utils/trade-context';
import type { TradeResultCache } from '@/utils/trade-result-cache';
import { TRADE_RESULTS_SELECTOR } from '@/utils/trade-results-root';
import {
  RESULT_LEFT_ACTION_BUTTON_CLASS,
  ensureResultEnhancementStyle,
  removeResultEnhancementStyle,
} from './result-enhancement-styles';
import {
  collectResultRows,
  mountLeftAction,
  removeLeftActionsByClass,
  resolveRowId,
} from './result-left-actions';
import {
  RESULT_SIMILAR_BADGE_CLASS,
  RESULT_SIMILAR_BUTTON_CLASS,
  RESULT_SIMILAR_MARK_ATTR,
} from './similar-search-styles';

export type SimilarSearchOpener = (resultId: string, row: Element) => void;

const STAT_FIELD_SELECTOR = '[data-field^="stat."]';
const HIGH_SIMILARITY = 0.95;
const MID_SIMILARITY = 0.75;

export class ResultSimilarButtonAdapter {
  private opener?: SimilarSearchOpener;

  constructor(
    private readonly version: PoeVersion,
    private readonly doc: Document,
    private readonly cache: TradeResultCache,
  ) {}

  /** 設定按下按鈕時的動作；未設定時不顯示按鈕 */
  setOpener(opener: SimilarSearchOpener | undefined): void {
    this.opener = opener;
    if (!opener) {
      this.removeInjected();
      return;
    }
    this.refresh();
  }

  refresh(): void {
    const root = this.doc.querySelector(TRADE_RESULTS_SELECTOR);
    if (root) this.apply(root);
  }

  apply(container: Element): void {
    if (!this.opener) return;
    let injected = false;
    for (const row of collectResultRows(container)) {
      const id = resolveRowId(row);
      if (!id || row.querySelector(`.${RESULT_SIMILAR_BUTTON_CLASS}`)) continue;
      if (!isSimilarSearchEligible(this.cache.get(id)?.item, this.version)) continue;
      mountLeftAction(row, this.createButton(id, row), this.doc);
      injected = true;
    }
    if (injected) ensureResultEnhancementStyle('similar-search', this.doc);
  }

  refreshLocale(): void {
    this.doc.querySelectorAll(`.${RESULT_SIMILAR_BUTTON_CLASS}`).forEach((button) => {
      button.textContent = t('similarSearch.button');
      button.setAttribute('title', t('similarSearch.buttonTitle'));
    });
  }

  cleanup(): void {
    this.opener = undefined;
    this.removeInjected();
  }

  private createButton(resultId: string, row: Element): HTMLButtonElement {
    const button = this.doc.createElement('button');
    button.type = 'button';
    button.className = `${RESULT_LEFT_ACTION_BUTTON_CLASS} ${RESULT_SIMILAR_BUTTON_CLASS}`;
    button.textContent = t('similarSearch.button');
    button.setAttribute('title', t('similarSearch.buttonTitle'));
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.opener?.(resultId, row);
    });
    return button;
  }

  private removeInjected(): void {
    removeLeftActionsByClass(RESULT_SIMILAR_BUTTON_CLASS, this.doc);
  }
}

export interface SimilarMarksView {
  batch: SimilarBatch;
  draft: SimilarSearchDraft;
  englishStatText: (statId: string) => string | undefined;
}

interface RowScore {
  similarity: number;
  marks: Record<string, SimilarityMark>;
}

const levelOf = (similarity: number): string =>
  similarity >= HIGH_SIMILARITY ? 'high' : similarity >= MID_SIMILARITY ? 'mid' : 'low';

export class ResultSimilarMarksAdapter {
  private view?: SimilarMarksView;
  private scores = new Map<string, RowScore>();

  constructor(private readonly doc: Document) {}

  /** 顯示中的找相似批次；undefined 表示正在看使用者自己的搜尋 */
  setView(view: SimilarMarksView | undefined): void {
    this.view = view;
    this.scores = new Map(
      (view?.batch.results ?? []).map((result) => [
        result.id,
        { similarity: result.similarity, marks: result.marks },
      ]),
    );
    const root = this.doc.querySelector(TRADE_RESULTS_SELECTOR);
    if (root) this.apply(root);
    if (!view) removeResultEnhancementStyle('similar-search', this.doc);
  }

  apply(container: Element): void {
    for (const row of collectResultRows(container)) {
      const score = this.scores.get(resolveRowId(row));
      if (score && this.view) this.markRow(row, score, this.view);
      else this.clearRow(row);
    }
    if (this.view) ensureResultEnhancementStyle('similar-search', this.doc);
  }

  refreshLocale(): void {
    const root = this.doc.querySelector(TRADE_RESULTS_SELECTOR);
    if (root && this.view) this.apply(root);
  }

  cleanup(): void {
    this.setView(undefined);
  }

  private markRow(row: Element, score: RowScore, view: SimilarMarksView): void {
    const host = row.querySelector('.left') ?? row;
    let badge = host.querySelector<HTMLElement>(`.${RESULT_SIMILAR_BADGE_CLASS}`);
    if (!badge) {
      badge = this.doc.createElement('div');
      badge.className = RESULT_SIMILAR_BADGE_CLASS;
      host.appendChild(badge);
    }
    const percent = Math.round(score.similarity * 100);
    badge.textContent = t('similarSearch.badge', { percent: String(percent) });
    badge.setAttribute('data-level', levelOf(score.similarity));
    row.querySelectorAll(STAT_FIELD_SELECTOR).forEach((field) => {
      const statId = (field.getAttribute('data-field') ?? '').replace(/^stat\./, '');
      const key = draftKeysOfStatId(statId, view.englishStatText).find(
        (candidate) => score.marks[candidate],
      );
      const target = field.parentElement ?? field;
      if (key) target.setAttribute(RESULT_SIMILAR_MARK_ATTR, score.marks[key]);
      else target.removeAttribute(RESULT_SIMILAR_MARK_ATTR);
    });
  }

  private clearRow(row: Element): void {
    row.querySelector(`.${RESULT_SIMILAR_BADGE_CLASS}`)?.remove();
    row.querySelectorAll(`[${RESULT_SIMILAR_MARK_ATTR}]`).forEach((element) => {
      element.removeAttribute(RESULT_SIMILAR_MARK_ATTR);
    });
  }
}
