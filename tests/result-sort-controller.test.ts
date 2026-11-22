import { afterEach, describe, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';
import { ResultPricePresenter } from '@/entrypoints/content/logic/result-price-presenter';
import {
  ResultSortController,
  type SortStatProvider,
} from '@/entrypoints/content/logic/result-sort-controller';

afterEach(() => vi.unstubAllGlobals());

function createHappyTradeDom(url: string) {
  const happyWin = new Window({ url });
  vi.stubGlobal('window', happyWin as any);
  vi.stubGlobal('document', happyWin.document as any);

  const results = happyWin.document.createElement('div');
  results.className = 'results';
  const rowTotal = happyWin.document.createElement('div');
  rowTotal.className = 'row row-total';
  const resultSet = happyWin.document.createElement('div');
  resultSet.className = 'resultset';
  results.append(rowTotal, resultSet);
  happyWin.document.body.appendChild(results);

  const addRow = (id: string) => {
    const row = happyWin.document.createElement('div');
    row.className = 'row';
    row.setAttribute('data-id', id);
    resultSet.appendChild(row);
    return row;
  };

  return { happyWin, results, rowTotal, resultSet, addRow };
}

function getVisibleSortValues(
  toolbar: { querySelectorAll(selector: string): Iterable<any> } | null,
): string[] {
  if (!toolbar) return [];
  return Array.from(toolbar.querySelectorAll('.poexd-sort-popover .poexd-popover-item'))
    .filter((item) => item?.style?.display !== 'none')
    .map((item) => item?.getAttribute('data-value') || '')
    .filter(Boolean);
}

describe('ResultSortController', () => {
  it('PoE 1 獨立使用時支援價格升/降冪（無價格排末尾）、還原預設、非國際服停用與線上搜尋/主控台停用', async () => {
    const { results, rowTotal, resultSet, addRow } = createHappyTradeDom(
      'https://www.pathofexile.com/trade/search/Standard/ctrl-poe1',
    );
    const rExp = addRow('exp');
    const rFree = addRow('unpriced');
    const rCheap = addRow('cheap');

    const pricePresenter = new ResultPricePresenter(
      'poe1',
      async () => ({ primary: 'chaos', rates: { chaos: 1, divine: 150 } }),
      true,
    );
    const controller = new ResultSortController('poe1', pricePresenter);
    const detail = JSON.stringify({
      url: '/api/trade/fetch/exp,unpriced,cheap?query=ctrl-poe1',
      data: {
        result: [
          { id: 'exp', listing: { price: { amount: 2, currency: 'divine' } }, item: {} },
          { id: 'unpriced', listing: {}, item: {} },
          { id: 'cheap', listing: { price: { amount: 50, currency: 'chaos' } }, item: {} },
        ],
      },
    });

    await pricePresenter.handleFetchResponse(detail, 'Standard');
    controller.handleFetchResponse(detail);

    const toolbar = rowTotal.querySelector('.poexd-total-controls');
    expect(toolbar).not.toBeNull();
    expect(getVisibleSortValues(toolbar)).toEqual(['default', 'price_asc', 'price_desc']);

    controller.setSortMode('price_asc');
    expect(Array.from(resultSet.children)).toEqual([rCheap, rExp, rFree] as any);

    controller.setSortMode('price_desc');
    expect(Array.from(resultSet.children)).toEqual([rExp, rCheap, rFree] as any);

    controller.setSortMode('default');
    expect(Array.from(resultSet.children)).toEqual([rExp, rFree, rCheap] as any);

    // 切換為 live mode 時還原並移除工具列
    controller.setSortMode('price_asc');
    expect(Array.from(resultSet.children)).toEqual([rCheap, rExp, rFree] as any);
    controller.setPageMode('live');
    expect(Array.from(resultSet.children)).toEqual([rExp, rFree, rCheap] as any);
    expect(rowTotal.querySelector('.poexd-total-controls')).toBeNull();

    controller.setPageMode('search');
    controller.apply(results as unknown as Element);
    expect(rowTotal.querySelector('.poexd-total-controls')).not.toBeNull();

    // 切換為 live-search-primary 角色時不可排序也不重建工具列
    controller.setSortMode('price_desc');
    expect(Array.from(resultSet.children)).toEqual([rExp, rCheap, rFree] as any);
    controller.setPageRole('live-search-primary');
    expect(Array.from(resultSet.children)).toEqual([rExp, rFree, rCheap] as any);
    controller.setSortMode('price_asc');
    expect(Array.from(resultSet.children)).toEqual([rExp, rFree, rCheap] as any);
    expect(rowTotal.querySelector('.poexd-total-controls')).toBeNull();

    // 非國際服不建立工具列也不排序
    const garena = createHappyTradeDom('https://pathofexile.tw/trade/search/Standard/tw1');
    garena.addRow('tw-a');
    garena.addRow('tw-b');
    const twPresenter = new ResultPricePresenter('poe1', async () => ({
      primary: 'chaos',
      rates: { chaos: 1 },
    }));
    const twController = new ResultSortController('poe1', twPresenter);
    twController.apply(garena.results as unknown as Element);
    expect(garena.rowTotal.querySelector('.poexd-total-controls')).toBeNull();

    controller.cleanup();
    twController.cleanup();
  });

  it('PoE 2 動態切換 statProvider 時重建 .poexd-total-controls，並在關閉屬性提供者時將屬性排序重置為 default', () => {
    const { results, rowTotal, resultSet, addRow } = createHappyTradeDom(
      'https://www.pathofexile.com/trade2/search/poe2/Standard/ctrl-poe2',
    );
    const rLowDpsHighPrice = addRow('low-dps');
    const rHighDpsLowPrice = addRow('high-dps');

    const mockPricePresenter = {
      isEnabled: () => true,
      getPrimaryPrice: (id: string) =>
        id === 'low-dps' ? 500 : id === 'high-dps' ? 100 : undefined,
    };

    let statActive = false;
    const provider: SortStatProvider = {
      isActive: () => statActive,
      getSortMetric: (mode, id) => {
        if (mode !== 'potential_dps' && mode !== 'potential_pdps' && mode !== 'cp_ratio') {
          return undefined;
        }
        return id === 'low-dps' ? 200 : id === 'high-dps' ? 900 : undefined;
      },
      getLeadingControls: () => [
        {
          type: 'weapon',
          getIcon: () => ({ attrs: { viewBox: '0 0 16 16' }, paths: ['M0 0h16v16H0z'] }),
          getTitle: () => 'Weapon Rune',
          getHeader: () => 'Weapon Rune',
          getOptions: () => [{ key: 'physical', label: 'Physical', onSelect: () => {} }],
          getState: () => ({
            currentKey: 'physical',
            titleText: 'Weapon Rune',
            headerText: 'Weapon Rune',
            isActive: true,
          }),
        },
      ],
    };

    const controller = new ResultSortController('poe2', mockPricePresenter as any);
    controller.registerStatProvider(provider);
    controller.apply(results as unknown as Element);

    // 關閉 statProvider 時只顯示排序按鈕且僅含價格與預設選項
    const controlsOff = rowTotal.querySelector('.poexd-total-controls');
    expect(controlsOff?.querySelector('.poexd-weapon-btn')).toBeNull();
    expect(getVisibleSortValues(controlsOff)).toEqual(['default', 'price_asc', 'price_desc']);

    // 開啟 statProvider 並呼叫 syncSupport -> 重建工具列加入前導控制項與屬性排序選項
    statActive = true;
    controller.syncSupport();
    const controlsOn = rowTotal.querySelector('.poexd-total-controls');
    expect(controlsOn?.querySelector('.poexd-weapon-btn')).not.toBeNull();
    expect(getVisibleSortValues(controlsOn)).toEqual([
      'default',
      'price_asc',
      'price_desc',
      'potential_dps',
      'potential_pdps',
      'potential_edps',
      'potential_def',
      'potential_armour',
      'potential_evasion',
      'potential_es',
      'cp_ratio',
    ]);

    controller.setSortMode('potential_dps');
    expect(Array.from(resultSet.children)).toEqual([rHighDpsLowPrice, rLowDpsHighPrice] as any);

    // 關閉 statProvider -> 移除前導控制項並重置屬性排序為 default
    statActive = false;
    controller.syncSupport();
    expect(Array.from(resultSet.children)).toEqual([rLowDpsHighPrice, rHighDpsLowPrice] as any);
    const controlsRebuilt = rowTotal.querySelector('.poexd-total-controls');
    expect(controlsRebuilt?.querySelector('.poexd-weapon-btn')).toBeNull();
    expect(getVisibleSortValues(controlsRebuilt)).toEqual(['default', 'price_asc', 'price_desc']);

    // 仍支援純換算價格排序
    controller.setSortMode('price_asc');
    expect(Array.from(resultSet.children)).toEqual([rHighDpsLowPrice, rLowDpsHighPrice] as any);

    // 未傳入 pricePresenter 時，選單應隱藏 price_asc / price_desc / cp_ratio
    statActive = true;
    const noPriceDom = createHappyTradeDom(
      'https://www.pathofexile.com/trade2/search/poe2/Standard/ctrl-no-price',
    );
    noPriceDom.addRow('n-1');
    const noPriceCtrl = new ResultSortController('poe2', undefined, provider);
    noPriceCtrl.apply(noPriceDom.results as unknown as Element);
    const noPriceControls = noPriceDom.rowTotal.querySelector('.poexd-total-controls');
    expect(getVisibleSortValues(noPriceControls)).toEqual([
      'default',
      'potential_dps',
      'potential_pdps',
      'potential_edps',
      'potential_def',
      'potential_armour',
      'potential_evasion',
      'potential_es',
    ]);
    noPriceCtrl.setSortMode('price_asc');
    expect(
      Array.from(noPriceDom.resultSet.children).map((el) => el.getAttribute('data-id')),
    ).toEqual(['n-1']);

    controller.cleanup();
    noPriceCtrl.cleanup();
  });

  it('onMetricsChanged 與 applyBatch 增量重排會保留 Vue 註解錨點並於 microtask 清除 recentlyMovedRows', async () => {
    const { happyWin, results, rowTotal, resultSet, addRow } = createHappyTradeDom(
      'https://www.pathofexile.com/trade/search/Standard/batch',
    );
    const rA = addRow('a');
    const rB = addRow('b');
    const rC = addRow('c');
    const anchor = happyWin.document.createComment('v-for-anchor');
    resultSet.appendChild(anchor as any);

    const prices: Record<string, number> = { a: 100, b: 200, c: 300 };
    const mockPricePresenter = {
      isEnabled: () => true,
      getPrimaryPrice: (id: string) => prices[id],
    };

    const controller = new ResultSortController('poe1', mockPricePresenter as any);
    controller.apply(results as unknown as Element);
    controller.setSortMode('price_asc');
    expect(rowTotal.querySelector('.poexd-total-controls')).not.toBeNull();

    // 模擬後續分批載入更便宜的列 rD 與更新價格後的 onMetricsChanged
    const rD = happyWin.document.createElement('div');
    rD.className = 'row';
    rD.setAttribute('data-id', 'd');
    resultSet.insertBefore(rD as any, anchor as any);
    prices.d = 25;

    const insertSpy = vi.spyOn(resultSet, 'insertBefore');
    controller.applyBatch([rD as unknown as Element]);
    expect(insertSpy).toHaveBeenCalledTimes(1);
    expect(Array.from(resultSet.children)).toEqual([rD, rA, rB, rC] as any);
    const childNodes = Array.from(resultSet.childNodes);
    expect(childNodes.indexOf(rC as any)).toBeLessThan(childNodes.indexOf(anchor as any));
    expect(controller.isRecentlyMovedRow(rD as unknown as Node)).toBe(true);
    expect(controller.isRecentlyMovedRow(rA as unknown as Node)).toBe(false);

    await Promise.resolve();
    expect(controller.isRecentlyMovedRow(rD as unknown as Node)).toBe(false);

    // 模擬匯率或指標變動
    prices.c = 10;
    controller.onMetricsChanged();
    expect(Array.from(resultSet.children)).toEqual([rC, rD, rA, rB] as any);

    controller.cleanup();
  });

  it('點官方結果列上的可排序欄位（詞綴/報價）時，擴充排序退回 default，讓官方重新查詢的順序生效', () => {
    const { happyWin, rowTotal, resultSet, addRow } = createHappyTradeDom(
      'https://www.pathofexile.com/trade/search/Standard/official-sort',
    );
    const prices: Record<string, number> = { a: 300, b: 100, c: 200 };
    const mockPricePresenter = {
      isEnabled: () => true,
      getPrimaryPrice: (id: string) => prices[id],
    };
    const controller = new ResultSortController('poe1', mockPricePresenter as any);
    const fetchDetail = (ids: string[], searchId: string) =>
      JSON.stringify({
        url: `/api/trade/fetch/${ids.join(',')}?query=${searchId}`,
        data: { result: ids.map((id) => ({ id, listing: {}, item: {} })) },
      });

    const rA = addRow('a');
    const rB = addRow('b');
    const rC = addRow('c');
    const mod = happyWin.document.createElement('span');
    mod.className = 's lc';
    mod.setAttribute('data-field', 'stat.explicit.stat_1');
    rA.appendChild(mod);

    controller.handleFetchResponse(fetchDetail(['a', 'b', 'c'], 'q1'));
    controller.setSortMode('price_asc');
    expect(Array.from(resultSet.children)).toEqual([rB, rC, rA] as any);

    mod.dispatchEvent(new happyWin.MouseEvent('click', { bubbles: true }) as any);
    const selected = rowTotal.querySelector('.poexd-sort-popover .poexd-selected');
    expect(selected?.getAttribute('data-value')).toBe('default');

    // 官方以詞綴排序重新查詢：同一批物品、官方新順序 c, a, b（searchId 可能不變）
    resultSet.replaceChildren(rC as any, rA as any, rB as any);
    controller.handleFetchResponse(fetchDetail(['c', 'a', 'b'], 'q1'));
    expect(Array.from(resultSet.children)).toEqual([rC, rA, rB] as any);

    controller.cleanup();
  });

  it('線上搜尋與主控台模式下，切換設定或呼叫 syncSupport 絕不將各批次 .resultset 的 .row 合併進第一個 .resultset', () => {
    const { happyWin, results, resultSet } = createHappyTradeDom(
      'https://www.pathofexile.com/trade/search/Standard/live-console',
    );
    const makeRow = (id: string) => {
      const row = happyWin.document.createElement('div');
      row.className = 'row';
      row.setAttribute('data-id', id);
      return row;
    };
    const r1 = makeRow('live-1');
    const r2 = makeRow('live-2');
    const r3 = makeRow('live-3');
    resultSet.appendChild(r1);
    const resultSet2 = happyWin.document.createElement('div');
    resultSet2.className = 'resultset';
    resultSet2.appendChild(r2);
    const resultSet3 = happyWin.document.createElement('div');
    resultSet3.className = 'resultset';
    resultSet3.appendChild(r3);
    results.appendChild(resultSet2);
    results.appendChild(resultSet3);

    const mockPricePresenter = {
      isEnabled: () => true,
      getPrimaryPrice: () => 10,
    };
    const controller = new ResultSortController('poe1', mockPricePresenter as any);
    controller.setPageRole('live-search-primary');
    controller.setEnabled(false);
    controller.setEnabled(true);
    controller.syncSupport();
    controller.apply(results as unknown as Element);

    expect(Array.from(resultSet.children)).toEqual([r1] as any);
    expect(Array.from(resultSet2.children)).toEqual([r2] as any);
    expect(Array.from(resultSet3.children)).toEqual([r3] as any);

    controller.cleanup();
  });
});
