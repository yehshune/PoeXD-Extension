import type { BookmarkClient } from '@/utils/bookmark-messaging';
import { createChromeBookmarkClient } from '@/utils/bookmark-messaging';
import type { BookmarkViewItem } from '@/utils/bookmark-coordinator';
import { dispatchPoeEvent, listenPoeEvent, parsePoeFetchResponse } from '@/utils/event-contracts';
import type { PreferencesModule } from '@/utils/preferences';
import type { SearchRecordOutcome } from '@/utils/search-records';
import {
  createChromeSearchRecordClient,
  type SearchRecordClient,
} from '@/utils/search-record-messaging';
import { getTradeVersionProfile, type PoeVersion } from '@/utils/trade-context';
import type { TradePageMode } from '@/utils/trade-page-mode';
import { watchTradePageMode } from '@/utils/trade-page-mode';
import {
  parseTradeSearchUrl,
  stripLiveSuffix,
  withTradeSearchId,
} from '@/utils/trade-search-identity';
import {
  resolveSearchQueryObservation,
  type SearchQueryObservationSource,
} from './search-query-observation';
import { createSearchRecordCaptureAdapter } from './search-record-capture';
import { isValidPoeCdnImageUrl } from '@/utils/poe-cdn-url';

export interface SearchObservationSessionDependencies {
  version: PoeVersion;
  preferences: PreferencesModule;
  consumeCriteria: (searchId: string, criteria: unknown) => void;
  searchRecords?: SearchRecordClient;
  bookmarks?: BookmarkClient;
}

export async function connectSearchObservationSession(
  dependencies: SearchObservationSessionDependencies,
) {
  const session = new SearchObservationSession(dependencies);
  return session.connect();
}

class SearchObservationSession {
  private activeSearchIdentity?: string;
  private initialSearchIdentity?: string;
  private initialBootstrapPending = false;
  private hydratedCriteria?: unknown;
  private autoTitleEnabled = true;
  private bookmarks: BookmarkViewItem[] = [];
  private bookmarkRefreshGeneration = 0;
  private captureQueue = Promise.resolve();
  private cleanups: Array<() => void> = [];
  private detectionTimer?: ReturnType<typeof setInterval>;
  private disposed = false;
  private lastFetchedIcon?: string;
  private lastFetchedImages: string[] = [];
  private lastFetchedResultsUrl = '';
  private pageMode: TradePageMode = 'search';
  private pageModeGeneration = 0;
  private readonly recordedLiveIdentities = new Set<string>();
  private readonly bookmarkClient: BookmarkClient;
  private readonly capture;

  constructor(private readonly dependencies: SearchObservationSessionDependencies) {
    this.bookmarkClient =
      dependencies.bookmarks ?? createChromeBookmarkClient(dependencies.version);
    this.capture = createSearchRecordCaptureAdapter(
      dependencies.searchRecords ?? createChromeSearchRecordClient(),
    );
  }

  connect() {
    try {
      const currentIdentity = parseTradeSearchUrl(window.location.href);
      if (currentIdentity) {
        this.initialSearchIdentity = getObservationIdentity(window.location.href);
        this.activeSearchIdentity = this.initialSearchIdentity;
        this.initialBootstrapPending = true;
      }
      this.cleanups.push(
        listenPoeEvent('poexd-fetch-response', (detail) => {
          void this.handleFetchResponse(detail)
            .then((outcome) => this.reportCaptureFailure(outcome))
            .catch((error) => console.error('[PoeXD] 擷取 Search Record 失敗:', error));
        }),
      );
      this.cleanups.push(
        listenPoeEvent('poexd-search-query-observed', (detail) => {
          void this.handleSearchQueryDetail(detail).catch((error) =>
            console.error('[PoeXD] 擷取 Search Record 失敗:', error),
          );
        }),
      );
      this.cleanups.push(watchTradePageMode((mode) => this.setPageMode(mode)));
    } catch (error) {
      this.dispose();
      throw error;
    }

    const updateTitle = () =>
      this.runOptional('更新 Trade page 標題', () => this.triggerTitleUpdateWithDetection());
    this.connectOptional('訂閱 result images request', () =>
      listenPoeEvent('poexd-request-result-images', () => this.publishResultImages()),
    );
    this.connectOptional('訂閱 search title event', () =>
      listenPoeEvent('poexd-search-triggered', updateTitle),
    );
    this.connectOptional('訂閱 history title event', () =>
      listenPoeEvent('poexd-history-changed', updateTitle),
    );
    this.connectOptional('訂閱 Bookmark', () =>
      this.bookmarkClient.subscribe(() => {
        this.requestBookmarkRefresh();
      }),
    );
    this.connectOptional('訂閱自動標題 Preference', () =>
      this.dependencies.preferences.subscribe((snapshot) => {
        this.runOptional('套用自動標題 Preference', () =>
          this.applyAutoTitlePreference(snapshot.enableAutoTitle),
        );
      }),
    );
    this.connectOptional('訂閱 popstate title event', () => {
      window.addEventListener('popstate', updateTitle);
      return () => window.removeEventListener('popstate', updateTitle);
    });
    this.connectOptional('訂閱 focus title event', () => {
      window.addEventListener('focus', updateTitle);
      return () => window.removeEventListener('focus', updateTitle);
    });

    this.runOptional('讀取自動標題 Preference', () =>
      this.applyAutoTitlePreference(this.dependencies.preferences.read().enableAutoTitle),
    );
    this.requestBookmarkRefresh();
    updateTitle();

    return () => this.dispose();
  }

  private dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.pageModeGeneration += 1;
    if (this.detectionTimer) clearInterval(this.detectionTimer);
    this.detectionTimer = undefined;
    this.cleanups
      .splice(0)
      .reverse()
      .forEach((cleanup) => {
        try {
          cleanup();
        } catch (error) {
          this.reportOptionalFailure('清理 Search Observation Session', error);
        }
      });
  }

  private async handleFetchResponse(detail: string): Promise<SearchRecordOutcome | undefined> {
    if (this.disposed || this.pageMode === 'live') return;
    const eventData = parsePoeFetchResponse(detail);
    if (!eventData) return;
    const results =
      isRecord(eventData.data) && Array.isArray(eventData.data.result)
        ? eventData.data.result
        : undefined;
    if (!results) return;
    const generation = this.pageModeGeneration;

    return this.enqueueCapture(async () => {
      if (this.disposed || this.pageMode !== 'search' || generation !== this.pageModeGeneration)
        return;
      const firstIcon = results?.[0]?.item?.icon;
      this.lastFetchedIcon = isValidPoeCdnImageUrl(firstIcon) ? firstIcon : undefined;
      const fetchedImages = [
        ...new Set(
          (results ?? [])
            .map((result) => result?.item?.icon)
            .filter((icon): icon is string => isValidPoeCdnImageUrl(icon)),
        ),
      ];
      const searchId = getFetchSearchId(eventData.url) ?? this.getCurrentSearchId();
      if (!searchId) return;
      const url = this.buildSearchUrl(searchId);
      const identity = getObservationIdentity(url);
      const sameSearch =
        this.lastFetchedResultsUrl !== '' &&
        getObservationIdentity(this.lastFetchedResultsUrl) === identity;
      this.lastFetchedImages = sameSearch
        ? [...new Set([...this.lastFetchedImages, ...fetchedImages])]
        : fetchedImages;
      this.lastFetchedResultsUrl = url;
      this.publishResultImages();

      return this.captureObservation(url, this.lastFetchedIcon, 'search', generation);
    });
  }

  private async handleSearchQueryDetail(detail: string) {
    const observation = resolveSearchQueryObservation(detail, window.location.href);
    if (!observation || this.disposed) return;
    try {
      this.dependencies.consumeCriteria(observation.searchId, observation.criteria);
    } catch (error) {
      console.error('[PoeXD] 套用即時搜尋條件失敗:', error);
    }
    const outcome = await this.handleSearchQuery(
      observation.searchId,
      observation.source,
      observation.criteria,
    );
    this.reportCaptureFailure(outcome);
  }

  private handleSearchQuery(
    searchId: string,
    source?: SearchQueryObservationSource,
    criteria?: unknown,
  ): Promise<SearchRecordOutcome | undefined> {
    const mode = this.pageMode;
    const generation = this.pageModeGeneration;
    return this.enqueueCapture(async () => {
      if (this.disposed || mode !== this.pageMode || generation !== this.pageModeGeneration) return;
      const url = this.buildSearchUrl(searchId);
      const identity = getObservationIdentity(url);
      const sameResults =
        this.lastFetchedResultsUrl !== '' &&
        getObservationIdentity(this.lastFetchedResultsUrl) === identity;
      if (!sameResults && mode === 'search') this.resetResultImages(url);
      const icon = sameResults ? this.lastFetchedIcon : undefined;
      return this.captureObservation(url, icon, mode, generation, source, criteria);
    });
  }

  private async captureObservation(
    urlValue: string,
    icon: string | undefined,
    mode: TradePageMode,
    generation: number,
    source?: SearchQueryObservationSource,
    criteria?: unknown,
  ): Promise<SearchRecordOutcome | undefined> {
    if (this.disposed || mode !== this.pageMode || generation !== this.pageModeGeneration) return;
    const url = stripLiveSuffix(urlValue);
    const identity = getObservationIdentity(url);
    if (mode === 'live' && this.recordedLiveIdentities.has(identity)) {
      return { ok: true, changed: false };
    }
    const observation = {
      gameVersion: this.dependencies.version,
      url,
      name: this.getSearchName() || '未命名搜尋',
      icon,
    };

    let recordsUse = false;

    if (source === 'current-query') {
      this.hydratedCriteria = criteria;
      recordsUse = false;
    } else if (identity === this.activeSearchIdentity) {
      this.initialBootstrapPending = false;
      this.hydratedCriteria = undefined;
      recordsUse = false;
    } else if (
      this.initialBootstrapPending &&
      this.initialSearchIdentity !== undefined &&
      this.hydratedCriteria !== undefined &&
      areCriteriaEquivalent(this.hydratedCriteria, criteria)
    ) {
      this.initialBootstrapPending = false;
      this.activeSearchIdentity = identity;
      this.hydratedCriteria = undefined;
      recordsUse = false;
    } else {
      this.initialBootstrapPending = false;
      this.hydratedCriteria = undefined;
      recordsUse = this.activeSearchIdentity !== identity;
    }

    const outcome = recordsUse
      ? await this.capture.captureSearchUse(observation)
      : await this.capture.captureEnrichment(observation);
    if (
      outcome.ok &&
      !this.disposed &&
      mode === this.pageMode &&
      generation === this.pageModeGeneration
    ) {
      this.activeSearchIdentity = identity;
      if (mode === 'live') this.recordedLiveIdentities.add(identity);
    }
    return outcome;
  }

  private setPageMode(mode: TradePageMode) {
    if (mode === this.pageMode) return;
    this.pageMode = mode;
    this.pageModeGeneration += 1;
    this.activeSearchIdentity = undefined;
    this.initialSearchIdentity = undefined;
    this.initialBootstrapPending = false;
    this.hydratedCriteria = undefined;
    this.recordedLiveIdentities.clear();
    if (mode !== 'live') return;
    const previousResultsUrl = this.lastFetchedResultsUrl;
    this.lastFetchedImages = [];
    this.publishResultImages(previousResultsUrl);
    this.lastFetchedResultsUrl = '';
  }

  private enqueueCapture<T>(operation: () => Promise<T>) {
    const result = this.captureQueue.then(operation, operation);
    this.captureQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private applyAutoTitlePreference(enabled: boolean) {
    if (this.disposed) return;
    this.autoTitleEnabled = enabled;
    const title = document.querySelector('title');
    if (!enabled) {
      if (title) title.innerText = getTradeVersionProfile(this.dependencies.version).defaultTitle;
      return;
    }
    this.updateTitle();
  }

  private triggerTitleUpdateWithDetection() {
    if (this.disposed || !this.autoTitleEnabled) return;
    if (this.detectionTimer) clearInterval(this.detectionTimer);
    let attempts = 0;
    this.detectionTimer = setInterval(() => {
      if (this.disposed) return;
      const name = this.getSearchName();
      attempts += 1;
      if (!name && attempts < 20) return;
      clearInterval(this.detectionTimer);
      this.detectionTimer = undefined;
      this.updateTitle();
    }, 100);
  }

  private updateTitle() {
    if (this.disposed || !this.autoTitleEnabled) return;
    const title = document.querySelector('title');
    if (!title) return;
    const bookmark = this.bookmarks.find((item) => item.url === window.location.href);
    title.innerText = bookmark?.name || this.getSearchName() || ' ';
  }

  private requestBookmarkRefresh() {
    const generation = ++this.bookmarkRefreshGeneration;
    void this.refreshBookmarks(generation);
  }

  private async refreshBookmarks(generation: number) {
    try {
      const result = await this.bookmarkClient.readCollection();
      if (!result.ok || this.disposed || generation !== this.bookmarkRefreshGeneration) return;
      this.bookmarks = result.value.bookmarks;
      this.updateTitle();
    } catch (error) {
      console.error('[PoeXD] 讀取 Bookmark 失敗:', error);
    }
  }

  /**
   * 新的搜尋 identity 出現時（含「查無結果」不會觸發 fetch 的情況），
   * 先清空前一次搜尋的結果圖片，避免書籤封面沿用舊搜尋的圖片。
   */
  private resetResultImages(url: string) {
    this.lastFetchedIcon = undefined;
    this.lastFetchedImages = [];
    this.lastFetchedResultsUrl = url;
    this.publishResultImages();
  }

  private publishResultImages(url = this.lastFetchedResultsUrl) {
    if (this.disposed || !url) return;
    this.runOptional('發布 result images', () => {
      dispatchPoeEvent('poexd-result-images', { url, images: this.lastFetchedImages });
    });
  }

  private connectOptional(label: string, connect: () => void | (() => void)) {
    try {
      const cleanup = connect();
      if (cleanup) this.cleanups.push(cleanup);
    } catch (error) {
      this.reportOptionalFailure(label, error);
    }
  }

  private runOptional(label: string, operation: () => void) {
    try {
      operation();
    } catch (error) {
      this.reportOptionalFailure(label, error);
    }
  }

  private reportOptionalFailure(label: string, error: unknown) {
    console.error(`[PoeXD] ${label}失敗:`, error);
  }

  private reportCaptureFailure(outcome: SearchRecordOutcome | undefined) {
    if (outcome && !outcome.ok)
      console.error('[PoeXD] Search Record capture failed:', outcome.error);
  }

  private buildSearchUrl(searchId: string) {
    const raw = withTradeSearchId(window.location.href, searchId) || window.location.href;
    return stripLiveSuffix(raw);
  }

  private getCurrentSearchId() {
    return parseTradeSearchUrl(window.location.href)?.searchId;
  }

  private getSearchName(): string | null {
    const searchInput = document.querySelector(
      '.search-panel .search-bar .search-left input',
    ) as HTMLInputElement | null;
    if (searchInput?.value.trim()) return searchInput.value.trim();
    const category = document.querySelector(
      '.search-advanced-items .filter-group:nth-of-type(1) .filter-property:nth-of-type(1) input',
    ) as HTMLInputElement | null;
    const subcategory = document.querySelector(
      '.search-advanced-items .filter-group:nth-of-type(1) .filter-property:nth-of-type(2) input',
    ) as HTMLInputElement | null;
    const ignored = [
      'Any',
      'Qualquer',
      'Все',
      'อะไรก็ได้',
      'Beliebig',
      'Tous',
      'Cualquiera',
      '모두',
      '任何',
    ];
    const validValue = (input: HTMLInputElement | null) => {
      const value = input?.value.trim();
      return value && !ignored.includes(value) ? value : null;
    };
    const categoryValue = validValue(category);
    const subcategoryValue = validValue(subcategory);
    if (categoryValue && subcategoryValue) return `${categoryValue} (${subcategoryValue})`;
    return categoryValue || subcategoryValue;
  }
}

function getFetchSearchId(fetchUrl: unknown) {
  if (typeof fetchUrl !== 'string') return;
  try {
    return new URL(fetchUrl, window.location.origin).searchParams.get('query') || undefined;
  } catch {
    return undefined;
  }
}

function getObservationIdentity(url: string) {
  const identity = parseTradeSearchUrl(url);
  return identity ? `${identity.gameVersion}:${identity.league}:${identity.searchId}` : url;
}

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function areCriteriaEquivalent(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((val, idx) => areCriteriaEquivalent(val, right[idx]));
  }
  const leftObj = left as Record<string, unknown>;
  const rightObj = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftObj).sort();
  const rightKeys = Object.keys(rightObj).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  for (let i = 0; i < leftKeys.length; i++) {
    const key = leftKeys[i];
    if (key !== rightKeys[i] || !areCriteriaEquivalent(leftObj[key], rightObj[key])) {
      return false;
    }
  }
  return true;
}
