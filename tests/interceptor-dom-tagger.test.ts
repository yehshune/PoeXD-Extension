// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runInterceptorBootstrap } from '@/entrypoints/interceptor';
import {
  ACTIVE_SESSION_STORAGE_KEY,
  resetActiveBindingSessionForTest,
} from '@/entrypoints/main-world/category-binding-manager';

const originalPushState = window.history.pushState;
const originalReplaceState = window.history.replaceState;
const originalAddEventListener = window.addEventListener.bind(window);
const addedListeners: Array<{
  type: string;
  listener: EventListenerOrEventListenerObject;
  options?: boolean | AddEventListenerOptions;
}> = [];

window.addEventListener = (
  type: string,
  listener: EventListenerOrEventListenerObject,
  options?: boolean | AddEventListenerOptions,
) => {
  addedListeners.push({ type, listener, options });
  return originalAddEventListener(type, listener, options);
};

class FakeMutationObserver {
  static instances: FakeMutationObserver[] = [];
  target: Node | null = null;
  options: MutationObserverInit | null = null;
  callback: MutationCallback;
  disconnected = false;

  constructor(callback: MutationCallback) {
    this.callback = callback;
    FakeMutationObserver.instances.push(this);
  }

  observe(target: Node, options?: MutationObserverInit) {
    this.target = target;
    this.options = options || null;
    this.disconnected = false;
  }

  disconnect() {
    this.disconnected = true;
    this.target = null;
  }

  trigger(mutations: Partial<MutationRecord>[] = []) {
    if (!this.disconnected) {
      this.callback(mutations as MutationRecord[], this as unknown as MutationObserver);
    }
  }
}

function setupDomEnvironment(initialPathname: string) {
  resetActiveBindingSessionForTest();
  sessionStorage.clear();
  document.head.innerHTML = '';
  document.body.innerHTML = '';

  // 設置當前路徑
  window.history.replaceState(null, '', initialPathname);

  // 清除 interceptor 全域標記
  delete (window as any).__poexdInterceptorInstalled;
  delete (window as any).__poexdUpdateNonce;
  delete (window.history as any).__poexdHistoryPatched;

  FakeMutationObserver.instances = [];
  (window as any).MutationObserver = FakeMutationObserver;

  // 設置 Mock Vuex Store
  const mockStore = {
    state: {
      persistent: {
        stats: [
          {
            filters: [{ id: 'explicit.stat_test', disabled: false }],
          },
        ],
      },
    },
    _withCommit: (fn: () => void) => fn(),
    commit: vi.fn(),
  };

  const tradeEl = document.createElement('div');
  tradeEl.id = 'trade';
  (tradeEl as any).__vue__ = { $store: mockStore };
  document.body.appendChild(tradeEl);

  // 設置 currentScript 與 nonce
  const script = document.createElement('script');
  script.setAttribute('data-nonce', 'test-nonce');
  document.head.appendChild(script);
  Object.defineProperty(document, 'currentScript', {
    value: script,
    configurable: true,
  });

  return { mockStore };
}

function loadInterceptor() {
  runInterceptorBootstrap();
}

function buildSearchAdvancedDom() {
  const container = document.createElement('div');
  container.className = 'search-advanced-items';

  const pane = document.createElement('div');
  pane.className = 'search-advanced-pane brown';

  const group = document.createElement('div');
  group.className = 'filter-group';

  const groupHeader = document.createElement('div');
  groupHeader.className = 'filter-group-header';
  const filterSelect = document.createElement('div');
  filterSelect.className = 'filter-select';
  groupHeader.appendChild(filterSelect);

  const groupBody = document.createElement('div');
  groupBody.className = 'filter-group-body';

  const filterItem = document.createElement('div');
  filterItem.className = 'filter';
  groupBody.appendChild(filterItem);

  group.appendChild(groupHeader);
  group.appendChild(groupBody);
  pane.appendChild(group);
  container.appendChild(pane);

  return { container, filterItem };
}

describe('interceptor DOM tagger lifecycle hardening', () => {
  afterEach(() => {
    resetActiveBindingSessionForTest();
    sessionStorage.clear();
    vi.restoreAllMocks();
    addedListeners.forEach(({ type, listener, options }) => {
      window.removeEventListener(type, listener, options);
    });
    addedListeners.length = 0;
    window.history.pushState = originalPushState;
    window.history.replaceState = originalReplaceState;
    delete (window as any).__poexdInterceptorInstalled;
    delete (window as any).__poexdUpdateNonce;
    delete (window.history as any).__poexdHistoryPatched;
    FakeMutationObserver.instances = [];
  });

  it('1. does not start tagger or polling on non-applicable routes (/trade or exchange)', () => {
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
    setupDomEnvironment('/trade/exchange/Standard');

    loadInterceptor();

    // 斷言：未建立任何 MutationObserver，亦未調用任何 polling 計時器
    const taggerObservers = FakeMutationObserver.instances.filter((obs) => !obs.disconnected);
    expect(taggerObservers).toHaveLength(0);

    // 確認沒有以 200ms 不斷輪詢
    expect(setTimeoutSpy).not.toHaveBeenCalledWith(expect.any(Function), 200);
  });

  it('2. starts MutationObserver on .search-advanced-items when navigating to /search/', () => {
    setupDomEnvironment('/trade/search/Standard');
    const { container } = buildSearchAdvancedDom();
    document.body.appendChild(container);

    loadInterceptor();

    const taggerObservers = FakeMutationObserver.instances.filter(
      (obs) => !obs.disconnected && obs.target === container,
    );
    expect(taggerObservers.length).toBeGreaterThan(0);
    expect(taggerObservers[0].options).toEqual({ childList: true, subtree: true });
  });

  it('3. uses DOM readiness observer if .search-advanced-items is not immediately available', () => {
    setupDomEnvironment('/trade/search/Standard');

    loadInterceptor();

    // 尚未有 .search-advanced-items 時應有 readiness observer 掛在 body/documentElement 上
    const readinessObservers = FakeMutationObserver.instances.filter(
      (obs) =>
        !obs.disconnected &&
        (obs.target === document.body || obs.target === document.documentElement),
    );
    expect(readinessObservers.length).toBeGreaterThan(0);

    // 當 DOM 稍後出現 .search-advanced-items
    const { container } = buildSearchAdvancedDom();
    document.body.appendChild(container);

    // 模擬 readiness observer 偵測到變更觸發
    readinessObservers[0].trigger();

    // 斷言：此時應已對 container 建立 taggerObserver，且 readinessObserver 已 disconnect
    const taggerObservers = FakeMutationObserver.instances.filter(
      (obs) => !obs.disconnected && obs.target === container,
    );
    expect(taggerObservers.length).toBeGreaterThan(0);
    expect(readinessObservers[0].disconnected).toBe(true);
  });

  it('4. cleans up and disconnects observers when navigating away from /search/ route', () => {
    setupDomEnvironment('/trade/search/Standard');
    const { container } = buildSearchAdvancedDom();
    document.body.appendChild(container);

    loadInterceptor();

    const activeObserversBefore = FakeMutationObserver.instances.filter((obs) => !obs.disconnected);
    expect(activeObserversBefore.length).toBeGreaterThan(0);

    // 模擬透過 History API 切換到首頁或 exchange
    window.history.pushState(null, '', '/trade/exchange/Standard');

    // 斷言：導航離開後，所有 tagger / readiness observer 皆已中斷監聽
    const activeObserversAfter = FakeMutationObserver.instances.filter((obs) => !obs.disconnected);
    expect(activeObserversAfter).toHaveLength(0);
  });

  it('5. prevents redundant MutationObserver creation when route syncs to the same observed container', () => {
    setupDomEnvironment('/trade/search/Standard/test-id');
    const { container } = buildSearchAdvancedDom();
    document.body.appendChild(container);

    loadInterceptor();

    const activeObserversBefore = FakeMutationObserver.instances.filter(
      (obs) => !obs.disconnected && obs.target === container,
    );
    expect(activeObserversBefore).toHaveLength(1);

    // 模擬同一頁面內的 replaceState（例如搜尋條件改變更新 query ID）
    window.history.replaceState(null, '', '/trade/search/Standard/new-query-id');

    // 斷言：同一容器不會重複 new MutationObserver，原 observer 保持運作
    const activeObserversAfter = FakeMutationObserver.instances.filter(
      (obs) => !obs.disconnected && obs.target === container,
    );
    expect(activeObserversAfter).toHaveLength(1);
    expect(activeObserversAfter[0]).toBe(activeObserversBefore[0]);
  });

  it('6. prevents category mis-assignment on index drift (filter removal / replacement)', () => {
    setupDomEnvironment('/trade/search/Standard/test-search-id');
    const { container, filterItem } = buildSearchAdvancedDom();
    document.body.appendChild(container);

    // 1. 模擬 sessionStorage 存有 filter 記憶 (原為 stat_bow 具有 bow 分類)
    const oldMemory = {
      version: 1,
      sessionId: 'test_session_id',
      league: 'Standard',
      mode: 'search',
      bindings: [{ bindingId: 'bind_bow', statId: 'explicit.stat_bow', category: 'bow' }],
    };
    sessionStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, JSON.stringify(oldMemory));

    // 2. 當前 Vuex 中的 filter 已經變成另一個 filter (explicit.stat_boots，原本無 category)
    const tradeEl = document.querySelector('#trade') as any;
    const currentFilter: any = { id: 'explicit.stat_boots', disabled: false };
    tradeEl.__vue__.$store.state.persistent.stats = [{ filters: [currentFilter] }];

    // 3. 執行 tagger (呼叫 reconcileFilterBindings)
    loadInterceptor();

    // 斷言：由於 id 不相符 (stat_boots !== stat_bow)，發生 index drift，
    // reconcileFilterBindings 絕不應將 bow 錯誤還原到 stat_boots 上
    expect(currentFilter.poexdCategory).toBeUndefined();
    expect(filterItem.hasAttribute('data-poexd-category')).toBe(false);

    // 4. 若當前 filter 的 id 與 memory 相符
    sessionStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, JSON.stringify(oldMemory));
    resetActiveBindingSessionForTest(true);
    const matchingFilter: any = { id: 'explicit.stat_bow', disabled: false };
    tradeEl.__vue__.$store.state.persistent.stats = [{ filters: [matchingFilter] }];

    // 觸發 tagger observer 回呼重新標記
    const activeObserver = FakeMutationObserver.instances.find(
      (obs) => !obs.disconnected && obs.target === container,
    );
    activeObserver?.trigger();

    // 斷言：id 相符時正確還原
    expect(matchingFilter.poexdCategory).toBe('bow');
    expect(filterItem.getAttribute('data-poexd-category')).toBe('bow');
  });

  it('7. rejects legacy string/index-only category entries and restores only canonical matching id', () => {
    setupDomEnvironment('/trade/search/Standard/test-search-id-legacy');
    const { container, filterItem } = buildSearchAdvancedDom();
    document.body.appendChild(container);

    // 1. sessionStorage 放入舊格式或 id 不符的條目
    sessionStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, JSON.stringify([['bow']]));

    const tradeEl = document.querySelector('#trade') as any;
    const filter0: any = { id: 'explicit.stat_boots', disabled: false };
    const filter1: any = { id: 'explicit.stat_gloves', disabled: false };
    tradeEl.__vue__.$store.state.persistent.stats = [{ filters: [filter0, filter1] }];

    loadInterceptor();

    // 斷言：舊格式不予還原 category
    expect(filter0.poexdCategory).toBeUndefined();
    expect(filter1.poexdCategory).toBeUndefined();
    expect(filterItem.hasAttribute('data-poexd-category')).toBe(false);

    // 2. 當 sessionStorage 為 canonical { version: 1, bindings } 且 id 相符時，正常還原
    const canonicalMemory = {
      version: 1,
      sessionId: 'test_session_id_legacy',
      league: 'Standard',
      mode: 'search',
      bindings: [{ bindingId: 'bind_boots', statId: 'explicit.stat_boots', category: 'boots' }],
    };
    sessionStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, JSON.stringify(canonicalMemory));
    resetActiveBindingSessionForTest(true);

    const activeObserver = FakeMutationObserver.instances.find(
      (obs) => !obs.disconnected && obs.target === container,
    );
    activeObserver?.trigger();

    expect(filter0.poexdCategory).toBe('boots');
    expect(filterItem.getAttribute('data-poexd-category')).toBe('boots');
  });
});
