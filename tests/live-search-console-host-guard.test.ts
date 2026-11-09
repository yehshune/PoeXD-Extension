// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLiveSearchConsoleHostGuard } from '@/entrypoints/content/logic/live-search-console-host-guard';
import {
  initNetworkObserver,
  isConsoleSearchGuardActive,
  setConsoleSearchGuardActive,
} from '@/entrypoints/main-world/network-observer';
import type { MainWorldBridge } from '@/entrypoints/main-world/bridge-bootstrap';

describe('LiveSearch Console Host Guard & Network Safety Net', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    setConsoleSearchGuardActive(false);
  });

  afterEach(() => {
    setConsoleSearchGuardActive(false);
    vi.restoreAllMocks();
  });

  const buildOfficialTradeDomFixture = () => `
    <div class="container-fluid full" id="host-container-fluid">
      <div class="content" id="host-content">
        <div class="wrapper" id="host-wrapper">
          <div id="statusBar"><a id="status-bar-link" href="/account/view-profile/test">Account</a></div>
          <div class="linkBack"><a id="link-back-anchor" href="/">回到主頁</a></div>
          <div class="logo"><a id="logo-anchor" href="/trade">Logo</a></div>
          <div class="language-select"><a id="lang-anchor" href="https://www.pathofexile.com/trade">EN</a></div>
          <div id="trade">
            <div class="toast-container" id="official-toast-container"></div>
            <button id="official-top-btn" type="button" class="top-btn"></button>
            <div class="navigation" id="official-navigation">
              <ul class="nav nav-tabs main">
                <li class="menu-search active"><a id="nav-search-link" href="/trade/search">搜尋列表</a></li>
                <li class="menu-exchange"><a id="nav-exchange-link" href="/trade/exchange">批量交易</a></li>
              </ul>
              <ul class="nav nav-tabs account">
                <li class="menu-about"><a id="nav-about-link" href="/trade/about">關於</a></li>
                <li class="menu-settings"><a id="nav-settings-link" href="/trade/settings">設定</a></li>
                <li class="menu-history"><a id="nav-history-link" href="/trade/history">歷史</a></li>
              </ul>
            </div>
            <div class="top" id="official-top-panel">
              <div class="search-panel" id="official-search-panel">
                <div class="search-bar">
                  <div class="search-left">
                    <div tabindex="0" class="multiselect search-select modified">
                      <div class="multiselect__tags">
                        <input id="official-search-input" type="text" autocomplete="off" placeholder="搜尋道具..." class="multiselect__input" />
                      </div>
                    </div>
                  </div>
                </div>
                <div class="search-bar search-advanced search-advanced-hidden">
                  <div class="controls">
                    <div class="controls-left">
                      <button id="top-livesearch-btn" type="button" class="btn livesearch-btn"><span class="plus"></span> <span>啟動線上搜尋</span></button>
                    </div>
                    <div class="controls-center">
                      <button id="top-search-btn" type="button" class="btn search-btn"><span>搜尋</span></button>
                    </div>
                    <div class="controls-right">
                      <button id="top-clear-btn" type="button" class="btn clear-btn"><span>清除</span></button>
                      <button id="top-toggle-btn" type="button" class="btn toggle-search-btn"><span alt="Toggle" class="chevron collapsed"></span> <span>顯示篩選</span></button>
                    </div>
                    <div class="clear"></div>
                  </div>
                  <div class="search-advanced-items">
                    <div class="search-advanced-pane blue">
                      <div class="filter-group">
                        <div class="filter-group-body">
                          <div class="filter filter-property full-span">
                            <span class="filter-body">
                              <div class="multiselect filter-select">
                                <div class="multiselect__tags">
                                  <input id="official-filter-multiselect-input" type="text" class="multiselect__input" placeholder="Select Filter" />
                                </div>
                              </div>
                              <input id="official-filter-minmax-input" type="text" class="form-control minmax" placeholder="min" />
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div class="controls">
                  <div class="controls-left">
                    <button id="bottom-livesearch-btn" type="button" class="btn livesearch-btn"><span class="plus"></span> <span>啟動線上搜尋</span></button>
                  </div>
                  <div class="controls-center">
                    <button id="bottom-search-btn" type="button" class="btn search-btn"><span>搜尋</span></button>
                  </div>
                  <div class="controls-right">
                    <button id="bottom-clear-btn" type="button" class="btn clear-btn"><span>清除</span></button>
                    <button id="bottom-toggle-btn" type="button" class="btn toggle-search-btn"><span alt="Toggle" class="chevron collapsed"></span> <span>顯示篩選</span></button>
                  </div>
                  <div class="clear"></div>
                </div>
              </div>
            </div>
            <div id="vue3-portal">
              <div class="results compact two" id="official-results">
                <div class="row row-total" id="official-results-total"><h3>線上搜尋：顯示 1 筆</h3></div>
                <div class="resultset" id="official-resultset">
                  <div class="row" id="official-item-row-1" data-id="item-row-1">
                    <div class="left">
                      <button id="item-search-by-btn" class="searchBy" title="Filter by Item Stats"></button>
                    </div>
                    <div class="middle">
                      <div class="item-popup" id="official-item-popup">魔血 重型腰帶</div>
                      <div class="itemPopupAdditional" id="official-item-popup-additional"></div>
                    </div>
                    <div class="right">
                      <button id="item-whisper-btn" type="button" class="btn btn-default direct-btn">Direct Whisper</button>
                      <button id="item-hideout-btn" type="button" class="btn btn-default hideout-btn">Travel to Hideout</button>
                      <span class="profile-link"><a id="seller-profile-link" href="/account/view-profile/seller123" target="_blank">seller123</a></span>
                      <form id="non-search-card-form">
                        <input id="non-search-card-input" type="text" />
                        <button id="non-search-card-submit" type="submit">Apply Note</button>
                      </form>
                    </div>
                  </div>
                  <div class="row controls">
                    <button id="results-load-more-btn" class="btn load-more-btn"><span data-plugin-en="Load More">讀取更多</span></button>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div id="app"></div>
        </div>
        <div class="bottom" id="official-footer"><a id="footer-link" href="/legal">流亡黯道 © GGG</a></div>
      </div>
    </div>
    <div id="poe-popup-container"></div>
    <div class="popup-manager" id="official-popup-manager"></div>
    <div id="cboxOverlay" style="display: none;"></div>
    <div id="colorbox" role="dialog" tabindex="-1" style="display: none;"></div>
    <poexd-toast-container id="poexd-toast-host"></poexd-toast-container>
    <poexd-sidebar-container id="poexd-sidebar-host"></poexd-sidebar-container>
    <div class="pxd-sidebar-wrapper" id="poexd-sidebar-wrapper">
      <form id="poexd-form" data-sidebar-pane="live-search-primary">
        <input id="poexd-input" type="text" />
        <button id="poexd-submit" type="submit">開始</button>
        <a id="poexd-sidebar-link" href="https://www.pathofexile.com/trade">Sidebar Link</a>
      </form>
    </div>
  `;

  it('1. Result-Only Console Presentation & Teardown: 主控台隱藏非結果官方區塊，完整保留 .results 祖先鏈、Item Card、官方浮層與 PoeXD Sidebar，Normal 頁面零影響，且 dispose 完整還原', async () => {
    document.body.innerHTML = buildOfficialTradeDomFixture();

    const nonResultChromeEls = [
      document.getElementById('statusBar')!,
      document.querySelector('.linkBack') as HTMLElement,
      document.querySelector('.logo') as HTMLElement,
      document.querySelector('.language-select') as HTMLElement,
      document.getElementById('official-navigation')!,
      document.getElementById('official-top-panel')!,
      document.getElementById('official-search-panel')!,
      document.getElementById('official-footer')!,
    ];

    const preservedResultAndPortalEls = [
      document.getElementById('host-container-fluid')!,
      document.getElementById('host-content')!,
      document.getElementById('host-wrapper')!,
      document.getElementById('trade')!,
      document.getElementById('app')!,
      document.getElementById('vue3-portal')!,
      document.getElementById('official-results')!,
      document.getElementById('official-resultset')!,
      document.getElementById('official-item-row-1')!,
      document.getElementById('official-item-popup')!,
      document.getElementById('official-item-popup-additional')!,
      document.getElementById('poe-popup-container')!,
      document.getElementById('official-popup-manager')!,
      document.getElementById('official-toast-container')!,
      document.getElementById('official-top-btn')!,
      document.getElementById('poexd-toast-host')!,
      document.getElementById('poexd-sidebar-host')!,
      document.getElementById('poexd-sidebar-wrapper')!,
    ];

    // Normal Trade Page 狀態（未啟動 guard）：所有官方區塊完全不受影響
    expect(document.documentElement.getAttribute('data-poexd-console-result-only')).toBeNull();
    expect(document.getElementById('poexd-console-result-only-style')).toBeNull();
    for (const el of nonResultChromeEls) {
      expect(el.getAttribute('data-poexd-console-hidden')).toBeNull();
      expect(el.style.display).not.toBe('none');
    }

    const guardStates: boolean[] = [];
    const guard = createLiveSearchConsoleHostGuard({
      doc: document,
      dispatchGuardState: (active) => guardStates.push(active),
    });

    // 啟動主控台 Result-Only Presentation
    guard.start();
    expect(guardStates).toEqual([true]);
    expect(document.documentElement.getAttribute('data-poexd-console-result-only')).toBe('true');
    expect(document.body.getAttribute('data-poexd-console-result-only')).toBe('true');
    expect(document.getElementById('poexd-console-result-only-style')).not.toBeNull();

    // 非結果官方區塊全部被隱藏且不可互動
    for (const el of nonResultChromeEls) {
      expect(el.getAttribute('data-poexd-console-hidden')).toBe('true');
      expect(el.getAttribute('aria-hidden')).toBe('true');
      expect(el.style.getPropertyValue('display')).toBe('none');
      expect(el.style.getPropertyPriority('display')).toBe('important');
      expect(el.style.getPropertyValue('visibility')).toBe('hidden');
      expect(el.style.getPropertyValue('pointer-events')).toBe('none');
    }

    // 結果渲染祖先鏈、Item Card、官方浮層與 PoeXD Sidebar 保持可見且不被標記隱藏
    for (const preserved of preservedResultAndPortalEls) {
      expect(preserved.getAttribute('data-poexd-console-hidden')).toBeNull();
      expect(preserved.style.getPropertyValue('display')).not.toBe('none');
    }

    // Search / Live Search 按鈕仍具備防禦性禁用標記
    const topSearchBtn = document.getElementById('top-search-btn') as HTMLButtonElement;
    const bottomSearchBtn = document.getElementById('bottom-search-btn') as HTMLButtonElement;
    const topLiveBtn = document.getElementById('top-livesearch-btn') as HTMLButtonElement;
    const bottomLiveBtn = document.getElementById('bottom-livesearch-btn') as HTMLButtonElement;
    const loadMoreBtn = document.getElementById('results-load-more-btn') as HTMLButtonElement;
    const searchByBtn = document.getElementById('item-search-by-btn') as HTMLButtonElement;

    for (const btn of [topSearchBtn, bottomSearchBtn, topLiveBtn, bottomLiveBtn]) {
      expect(btn.disabled).toBe(true);
      expect(btn.getAttribute('aria-disabled')).toBe('true');
      expect(btn.getAttribute('data-poexd-console-guarded')).toBe('true');
    }

    for (const nonGuarded of [loadMoreBtn, searchByBtn]) {
      expect(nonGuarded.disabled).toBe(false);
      expect(nonGuarded.getAttribute('data-poexd-console-guarded')).toBeNull();
    }

    // 模擬官方 RootTrade.mounted 執行 $("#trade .top").fadeIn() 覆寫 style="display: block" 與 Vue rerender 按鈕
    const topPanel = document.getElementById('official-top-panel')!;
    topPanel.setAttribute('style', 'display: block;');
    const controlsLeft = document.querySelector('.search-panel > .controls > .controls-left')!;
    const rerenderedLiveBtn = document.createElement('button');
    rerenderedLiveBtn.type = 'button';
    rerenderedLiveBtn.className = 'btn livesearch-btn';
    rerenderedLiveBtn.innerHTML = '<span class="minus"></span> <span>停用線上搜尋</span>';
    controlsLeft.replaceChildren(rerenderedLiveBtn);

    await new Promise((r) => setTimeout(r, 20));
    expect(topPanel.style.getPropertyValue('display')).toBe('none');
    expect(topPanel.style.getPropertyPriority('display')).toBe('important');
    expect(rerenderedLiveBtn.disabled).toBe(true);
    expect(rerenderedLiveBtn.getAttribute('data-poexd-console-guarded')).toBe('true');

    // dispose 後完整移除 Result-Only Presentation 狀態、style 標籤與防禦屬性
    guard.dispose();
    expect(guardStates).toEqual([true, false]);
    expect(document.documentElement.getAttribute('data-poexd-console-result-only')).toBeNull();
    expect(document.body.getAttribute('data-poexd-console-result-only')).toBeNull();
    expect(document.getElementById('poexd-console-result-only-style')).toBeNull();
    for (const el of nonResultChromeEls) {
      expect(el.getAttribute('data-poexd-console-hidden')).toBeNull();
      expect(el.getAttribute('aria-hidden')).toBeNull();
      expect(el.style.getPropertyValue('display')).toBe('');
      expect(el.style.getPropertyValue('visibility')).toBe('');
      expect(el.style.getPropertyValue('pointer-events')).toBe('');
    }
    expect(topSearchBtn.disabled).toBe(false);
    expect(topSearchBtn.getAttribute('aria-disabled')).toBeNull();
    expect(topSearchBtn.getAttribute('data-poexd-console-guarded')).toBeNull();
    expect(rerenderedLiveBtn.disabled).toBe(false);
  });

  it('2. Event-Level Defense-in-Depth Guard & Result Interactivity: 攔截所有官方非結果區塊點擊、搜尋控制項與同分頁跳轉連結，完整放行 .results 結果卡互動（Whisper、Hideout、賣家檔案 _blank、Load More）與 PoeXD Sidebar', () => {
    document.body.innerHTML = buildOfficialTradeDomFixture();

    const guard = createLiveSearchConsoleHostGuard({
      doc: document,
      dispatchGuardState: () => {},
    });
    guard.start();

    const topSearchBtn = document.getElementById('top-search-btn') as HTMLButtonElement;
    const bottomLiveBtn = document.getElementById('bottom-livesearch-btn') as HTMLButtonElement;
    topSearchBtn.disabled = false;
    bottomLiveBtn.disabled = false;
    const bottomLiveInnerSpan = bottomLiveBtn.querySelector('span:last-child') as HTMLElement;

    const statusBarLink = document.getElementById('status-bar-link')!;
    const linkBackAnchor = document.getElementById('link-back-anchor')!;
    const logoAnchor = document.getElementById('logo-anchor')!;
    const navExchangeLink = document.getElementById('nav-exchange-link')!;
    const footerLink = document.getElementById('footer-link')!;
    const topClearBtn = document.getElementById('top-clear-btn')!;
    const officialFilterMinmaxInput = document.getElementById('official-filter-minmax-input')!;

    const whisperBtn = document.getElementById('item-whisper-btn')!;
    const hideoutBtn = document.getElementById('item-hideout-btn')!;
    const searchByBtn = document.getElementById('item-search-by-btn')!;
    const sellerProfileLink = document.getElementById('seller-profile-link')!;
    const loadMoreBtn = document.getElementById('results-load-more-btn')!;
    const officialTopBtn = document.getElementById('official-top-btn')!;
    const nonSearchCardForm = document.getElementById('non-search-card-form')!;
    const nonSearchCardInput = document.getElementById('non-search-card-input')!;
    const poexdInput = document.getElementById('poexd-input')!;
    const poexdForm = document.getElementById('poexd-form')!;
    const poexdSidebarLink = document.getElementById('poexd-sidebar-link')!;

    let officialSearchTriggered = false;
    let officialLiveWsCreated = false;
    let nonResultChromeClicked = false;
    let bodyEnterReached = false;
    let minmaxEnterReached = false;

    let whisperClicked = false;
    let hideoutClicked = false;
    let searchByClicked = false;
    let sellerProfileClicked = false;
    let loadMoreClicked = false;
    let topBtnClicked = false;
    let nonSearchCardSubmitted = false;
    let nonSearchCardEnterReached = false;
    let poexdEnterReachedTarget = false;
    let poexdFormSubmitted = false;
    let poexdSidebarLinkClicked = false;

    topSearchBtn.addEventListener('click', () => {
      officialSearchTriggered = true;
    });
    bottomLiveBtn.addEventListener('click', () => {
      officialLiveWsCreated = true;
    });
    for (const el of [
      statusBarLink,
      linkBackAnchor,
      logoAnchor,
      navExchangeLink,
      footerLink,
      topClearBtn,
    ]) {
      el.addEventListener('click', () => {
        nonResultChromeClicked = true;
      });
    }
    document.body.addEventListener('keydown', (e) => {
      if (e.target === document.body && e.key === 'Enter') bodyEnterReached = true;
    });
    officialFilterMinmaxInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') minmaxEnterReached = true;
    });

    whisperBtn.addEventListener('click', () => {
      whisperClicked = true;
    });
    hideoutBtn.addEventListener('click', () => {
      hideoutClicked = true;
    });
    searchByBtn.addEventListener('click', () => {
      searchByClicked = true;
    });
    sellerProfileLink.addEventListener('click', (e) => {
      e.preventDefault();
      sellerProfileClicked = true;
    });
    loadMoreBtn.addEventListener('click', () => {
      loadMoreClicked = true;
    });
    officialTopBtn.addEventListener('click', () => {
      topBtnClicked = true;
    });
    nonSearchCardForm.addEventListener('submit', (e) => {
      e.preventDefault();
      nonSearchCardSubmitted = true;
    });
    nonSearchCardInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') nonSearchCardEnterReached = true;
    });
    poexdInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') poexdEnterReachedTarget = true;
    });
    poexdForm.addEventListener('submit', (e) => {
      e.preventDefault();
      poexdFormSubmitted = true;
    });
    poexdSidebarLink.addEventListener('click', (e) => {
      e.preventDefault();
      poexdSidebarLinkClicked = true;
    });

    // 1. 點擊官方非結果區塊（Header / Navigation / Logo / Back / Footer / Search Panel）全部在 Capture 階段被攔截
    topSearchBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    bottomLiveInnerSpan.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    statusBarLink.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    linkBackAnchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    logoAnchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    navExchangeLink.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    footerLink.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    topClearBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(officialSearchTriggered).toBe(false);
    expect(officialLiveWsCreated).toBe(false);
    expect(nonResultChromeClicked).toBe(false);

    // 2. 官方觸發 doSearch() 之 Enter 路徑在 Capture 階段被攔截
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    officialFilterMinmaxInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    expect(bodyEnterReached).toBe(false);
    expect(minmaxEnterReached).toBe(false);

    // 3. .results 內結果卡互動（Whisper、Hideout、searchBy、新分頁賣家連結 target="_blank"、Load More、Back to Top）完全不受影響
    whisperBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    hideoutBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    searchByBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    sellerProfileLink.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    loadMoreBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    officialTopBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    nonSearchCardForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    nonSearchCardInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );

    expect(whisperClicked).toBe(true);
    expect(hideoutClicked).toBe(true);
    expect(searchByClicked).toBe(true);
    expect(sellerProfileClicked).toBe(true);
    expect(loadMoreClicked).toBe(true);
    expect(topBtnClicked).toBe(true);
    expect(nonSearchCardSubmitted).toBe(true);
    expect(nonSearchCardEnterReached).toBe(true);

    // 4. PoeXD Sidebar 內部按 Enter、提交表單與點擊連結完全不受影響
    poexdInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    poexdForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    poexdSidebarLink.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(poexdEnterReachedTarget).toBe(true);
    expect(poexdFormSubmitted).toBe(true);
    expect(poexdSidebarLinkClicked).toBe(true);

    // 5. guard.dispose() 後官方控制項恢復可觸發
    guard.dispose();
    topSearchBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    bottomLiveInnerSpan.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(officialSearchTriggered).toBe(true);
    expect(officialLiveWsCreated).toBe(true);
  });

  it('3. Main World Network Safety Net: 啟用守衛時阻擋 /api/trade*/search (fetch & XHR)，但不阻擋 /api/trade*/fetch，且停用後恢復', async () => {
    const listeners = new Map<string, (payload: any) => void>();
    const mockBridge: MainWorldBridge = {
      dispatchEvent: vi.fn(),
      addListener: vi.fn((eventName: string, handler: any) => {
        listeners.set(eventName, handler);
        return () => listeners.delete(eventName);
      }),
    };

    const originalFetchSpy = vi.fn(async (input: any) => {
      return new Response(JSON.stringify({ result: [], id: 'ok', url: String(input) }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const originalXhrSendSpy = vi.fn();
    class FakeXHR extends EventTarget {
      public readyState = 0;
      public status = 200;
      public responseType = 'json';
      public response = { id: 'xhr-ok' };
      public responseText = '{"id":"xhr-ok"}';
      open(_method: string, _url: string | URL) {}
      send(body?: any) {
        originalXhrSendSpy(body);
      }
    }

    const fakeWin: any = {
      fetch: originalFetchSpy,
      XMLHttpRequest: FakeXHR,
    };

    initNetworkObserver(mockBridge, fakeWin);

    // 1. 啟用 Console Guard
    const guardHandler = listeners.get('poexd-livesearch-console-guard');
    expect(guardHandler).toBeDefined();
    guardHandler!({ active: true });
    expect(isConsoleSearchGuardActive()).toBe(true);

    // 2. Fetch: /api/trade/search 與 /api/trade2/search 被阻擋，不會呼叫底層 fetch
    await expect(
      fakeWin.fetch('https://www.pathofexile.com/api/trade/search/Standard'),
    ).rejects.toThrow(/線上搜尋主控台已停用官方搜尋請求/);
    await expect(
      fakeWin.fetch('https://www.pathofexile.com/api/trade2/search/poe2/Standard'),
    ).rejects.toThrow(/線上搜尋主控台已停用官方搜尋請求/);
    expect(originalFetchSpy).not.toHaveBeenCalled();

    // 3. Fetch: /api/trade/fetch 與 /api/trade2/fetch 正常放行！
    const fetchItemRes = await fakeWin.fetch(
      'https://www.pathofexile.com/api/trade2/fetch/token123?query=q1&realm=poe2',
    );
    expect(fetchItemRes.status).toBe(200);
    expect(originalFetchSpy).toHaveBeenCalledTimes(1);

    // 4. XHR: /api/trade2/search 被阻擋，不會呼叫底層 send；/api/trade2/fetch 正常放行
    const searchXhr = new fakeWin.XMLHttpRequest();
    searchXhr.open('POST', 'https://www.pathofexile.com/api/trade2/search/poe2/Standard');
    searchXhr.send('{"query":{}}');
    expect(originalXhrSendSpy).not.toHaveBeenCalled();

    const fetchXhr = new fakeWin.XMLHttpRequest();
    fetchXhr.open('GET', 'https://www.pathofexile.com/api/trade2/fetch/token123');
    fetchXhr.send();
    expect(originalXhrSendSpy).toHaveBeenCalledTimes(1);

    // 5. 關閉 Console Guard 後，/api/trade2/search 恢復正常放行
    guardHandler!({ active: false });
    expect(isConsoleSearchGuardActive()).toBe(false);

    const searchResAfterDispose = await fakeWin.fetch(
      'https://www.pathofexile.com/api/trade2/search/poe2/Standard',
    );
    expect(searchResAfterDispose.status).toBe(200);
    expect(originalFetchSpy).toHaveBeenCalledTimes(2);
  });
});
