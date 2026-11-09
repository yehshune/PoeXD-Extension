import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResultItemNormalizer } from '@/entrypoints/content/logic/result-item-normalizer';

afterEach(() => vi.unstubAllGlobals());

/** 假 DOM 節點的可見文字：有子節點時串接子節點文字，否則取 textContent */
function textOf(node: any): string {
  if (Array.isArray(node?.children) && node.children.length > 0) {
    return node.children.map(textOf).join('');
  }
  return node?.textContent ?? '';
}

describe('Result item normalizer', () => {
  it('在 PoE 2 模式下成功攔截 fetch，將數值注入 PoeXD 標籤列，並在官方 row-total 左側注入控制按鈕組', async () => {
    let injectedControls: any = null;
    const additionalChildren: any[] = [];

    const rowTotal = {
      className: 'row row-total',
      parentElement: null,
      querySelector: vi.fn(() => null),
      prepend: vi.fn((el: any) => {
        injectedControls = el;
      }),
    };

    const badgeStrip = {
      className: 'poexd-stat-badges',
      querySelectorAll: vi.fn(() => []),
      querySelector: vi.fn(() => null),
      appendChild: vi.fn((el: any) => {
        additionalChildren.push(el);
      }),
    };

    const row = {
      getAttribute: vi.fn((name: string) => (name === 'data-id' ? 'res-1' : null)),
      querySelectorAll: vi.fn(() => []),
      querySelector: vi.fn((selector: string) => {
        if (selector === '.poexd-stat-badges') return badgeStrip;
        return null;
      }),
      style: { order: '' },
    };

    const root = {
      querySelectorAll: vi.fn((selector: string) => {
        if (selector.includes('.row')) return [row];
        return [];
      }),
      querySelector: vi.fn((selector: string) => {
        if (selector === '.poexd-total-controls') return injectedControls;
        return null;
      }),
      insertAdjacentElement: vi.fn(),
      matches: vi.fn(() => false),
      contains: vi.fn(() => false),
      children: [row],
      style: { display: '', flexDirection: '' },
    };

    const createdElements: any[] = [];
    vi.stubGlobal('window', {
      location: { origin: 'https://www.pathofexile.com' },
    });
    vi.stubGlobal('document', {
      createTextNode: vi.fn((text: string) => ({ nodeType: 3, textContent: text })),
      createElementNS: vi.fn((_ns: string, tag: string) =>
        (globalThis as any).document.createElement(tag),
      ),
      querySelector: vi.fn((selector: string) => {
        if (selector === '.row.row-total') return rowTotal;
        if (selector === '.results') return root;
        if (selector === '.poexd-total-controls') return injectedControls;
        return null;
      }),
      querySelectorAll: vi.fn(() => []),
      getElementById: vi.fn(() => null),
      addEventListener: vi.fn(),
      createElement: vi.fn((_tag: string) => {
        const el: any = {
          className: '',
          setAttribute: vi.fn(),
          getAttribute: vi.fn(() => null),
          addEventListener: vi.fn(),
          replaceChildren: vi.fn((...nodes: any[]) => {
            el.children = [...nodes];
          }),
          append: vi.fn((...nodes: any[]) => {
            el.children = [...(el.children || []), ...nodes];
          }),
          appendChild: vi.fn((child: any) => {
            el.children = el.children || [];
            el.children.push(child);
          }),
          prepend: vi.fn(),
          querySelector: vi.fn(() => ({
            addEventListener: vi.fn(),
            setAttribute: vi.fn(),
            classList: { toggle: vi.fn() },
          })),
          querySelectorAll: vi.fn(() => []),
          dataset: {},
          style: {},
          innerHTML: '',
          textContent: '',
        };
        createdElements.push(el);
        return el;
      }),
      head: { appendChild: vi.fn() },
    });

    const presenter = new ResultItemNormalizer('poe2');

    await presenter.handleFetchResponse(
      JSON.stringify({
        url: '/api/trade2/fetch/res-1?query=search-1',
        data: {
          result: [
            {
              id: 'res-1',
              item: {
                realm: 'poe2',
                baseType: 'Dreaming Quarterstaff',
                sockets: [
                  { group: 0, type: 'rune' },
                  { group: 1, type: 'rune' },
                ],
                socketedItems: [{}, {}],
                properties: [
                  {
                    name: 'Attacks per Second',
                    values: [['1.50', 0]],
                    type: 13,
                  },
                ],
                runeMods: [{ description: '36% increased [Physical] Damage' }],
                explicitMods: [{ description: '208% increased [Physical] Damage' }],
                extended: {
                  dps: 1071,
                  pdps: 1071,
                  edps: 0,
                },
              },
            },
          ],
        },
      }),
    );

    // 驗證 1：控制按鈕組以 prepend 注入官方 row-total 最左側
    expect(injectedControls).not.toBeNull();
    expect(rowTotal.prepend).toHaveBeenCalledWith(injectedControls);
    expect(injectedControls.className).toBe('poexd-total-controls');

    // 驗證 2：預設排序下絕對不添加 flex 樣式，守護官方原生滾動
    expect(root.style.display).toBe('');

    // 驗證 3：數值追加進 PoeXD 標籤列
    expect(badgeStrip.appendChild).toHaveBeenCalled();
    const cleanEntry = additionalChildren.find((el) => textOf(el).includes('淨底DPS'));
    const overrideEntry = additionalChildren.find((el) => textOf(el).includes('覆寫DPS'));
    // 依使用者需求：不要顯示淨底子
    expect(cleanEntry).toBeUndefined();
    // 覆寫 DPS 呈現且帶有專屬區隔樣式類別
    expect(overrideEntry).toBeDefined();
    expect(overrideEntry.className).toContain('poexd-override-stat');

    // 驗證 4：滿孔且未超限時，不顯示任何超限瓦孔或打孔標籤
    const overcapEntry = additionalChildren.find(
      (el) => textOf(el).includes('超限') || textOf(el).includes('瓦孔'),
    );
    expect(overcapEntry).toBeUndefined();
  });

  it('支援真實 DOM 物理排序，100% 保持官方 layout 版型與雙欄結構，杜絕滾動無限加載', async () => {
    const row1 = {
      id: 'res-low',
      getAttribute: vi.fn((name: string) => (name === 'data-id' ? 'res-low' : null)),
      querySelectorAll: vi.fn(() => []),
      querySelector: vi.fn(() => null),
      matches: vi.fn((sel: string) => sel.includes('.row') && !sel.includes('.controls')),
      prepend: vi.fn(),
      appendChild: vi.fn(),
      style: { order: '' },
    };

    const row2 = {
      id: 'res-high',
      getAttribute: vi.fn((name: string) => (name === 'data-id' ? 'res-high' : null)),
      querySelectorAll: vi.fn(() => []),
      querySelector: vi.fn(() => null),
      matches: vi.fn((sel: string) => sel.includes('.row') && !sel.includes('.controls')),
      prepend: vi.fn(),
      appendChild: vi.fn(),
      style: { order: '' },
    };

    const sentinelControl = {
      className: 'row controls',
      matches: vi.fn((sel: string) => sel.includes('.controls')),
      style: { order: '' },
    };

    const root: any = {
      querySelectorAll: vi.fn((selector: string) => {
        if (selector.includes('.row')) return [row1, row2];
        return [];
      }),
      querySelector: vi.fn((sel: string) => {
        if (sel.includes('.row')) return row1;
        return null;
      }),
      insertAdjacentElement: vi.fn(),
      insertBefore: vi.fn((node: any, ref: any) => {
        const idx = root.children.indexOf(node);
        if (idx !== -1) root.children.splice(idx, 1);
        const refIdx = ref ? root.children.indexOf(ref) : -1;
        if (refIdx !== -1) {
          root.children.splice(refIdx, 0, node);
        } else {
          root.children.push(node);
        }
      }),
      appendChild: vi.fn((node: any) => {
        const idx = root.children.indexOf(node);
        if (idx !== -1) root.children.splice(idx, 1);
        root.children.push(node);
      }),
      matches: vi.fn(() => false),
      contains: vi.fn(() => false),
      children: [row1, row2, sentinelControl],
      style: { display: '', flexDirection: '' },
    };

    vi.stubGlobal('window', {
      location: { origin: 'https://www.pathofexile.com' },
    });
    vi.stubGlobal('document', {
      createTextNode: vi.fn((text: string) => ({ nodeType: 3, textContent: text })),
      createElementNS: vi.fn((_ns: string, tag: string) =>
        (globalThis as any).document.createElement(tag),
      ),
      querySelector: vi.fn((sel: string) => (sel === '.results' ? root : null)),
      querySelectorAll: vi.fn(() => []),
      getElementById: vi.fn(() => null),
      addEventListener: vi.fn(),
      createElement: vi.fn(() => ({
        className: '',
        setAttribute: vi.fn(),
        getAttribute: vi.fn(() => null),
        addEventListener: vi.fn(),
        replaceChildren: vi.fn(),
        append: vi.fn(),
        appendChild: vi.fn(),
        prepend: vi.fn(),
        querySelector: vi.fn(() => ({ addEventListener: vi.fn() })),
        querySelectorAll: vi.fn(() => []),
        dataset: {},
        style: {},
      })),
      head: { appendChild: vi.fn() },
    });

    const presenter = new ResultItemNormalizer('poe2');

    // 載入兩筆物品：res-low (400 DPS) 與 res-high (1000 DPS)
    await presenter.handleFetchResponse(
      JSON.stringify({
        url: '/api/trade2/fetch/res-low,res-high?query=search-sort',
        data: {
          result: [
            {
              id: 'res-low',
              item: {
                realm: 'poe2',
                baseType: 'Expert Dual Bow',
                sockets: [],
                properties: [
                  {
                    name: 'Attacks per Second',
                    values: [['1.40', 0]],
                    type: 13,
                  },
                ],
                extended: { dps: 400, pdps: 400, edps: 0 },
              },
            },
            {
              id: 'res-high',
              item: {
                realm: 'poe2',
                baseType: 'Expert Dual Bow',
                sockets: [],
                properties: [
                  {
                    name: 'Attacks per Second',
                    values: [['1.40', 0]],
                    type: 13,
                  },
                ],
                extended: { dps: 1000, pdps: 1000, edps: 0 },
              },
            },
          ],
        },
      }),
    );

    // 驗證 1：預設排序下 display 完全不設為 flex，避免官方雙欄或網格被破壞
    expect(root.style.display).toBe('');
    expect(root.children).toEqual([row1, row2, sentinelControl]);

    // 觸發潛力 DPS 排序
    presenter.setSortMode('potential_dps');

    // 驗證 2：依然不修改容器 display，保持官方原生排版相容
    expect(root.style.display).toBe('');

    // 驗證 3：透過 DOM 物理重排，高 DPS (res-high) 排名優先，低 DPS 其次
    expect(root.children).toEqual([row2, row1, sentinelControl]);

    // 驗證 4：非物品之 controls / 哨兵節點永遠留在最後，不被拉入視口
    expect(root.children[2]).toBe(sentinelControl);

    // 驗證 5：切回預設排序時，DOM 節點物理順序還原為官方原始順序
    presenter.setSortMode('default');
    expect(root.style.display).toBe('');
    expect(root.children).toEqual([row1, row2, sentinelControl]);
  });

  it('覆寫元素 DPS 排序：正確依 potential_edps 降序排列，與物理 DPS 及總 DPS 獨立', async () => {
    const rowPhys: any = {
      getAttribute: vi.fn((attr: string) => (attr === 'data-id' ? 'res-phys' : null)),
      querySelectorAll: vi.fn(() => []),
      querySelector: vi.fn(() => null),
      prepend: vi.fn(),
      appendChild: vi.fn(),
      style: { order: '' },
    };
    const rowEle: any = {
      getAttribute: vi.fn((attr: string) => (attr === 'data-id' ? 'res-ele' : null)),
      querySelectorAll: vi.fn(() => []),
      querySelector: vi.fn(() => null),
      prepend: vi.fn(),
      appendChild: vi.fn(),
      style: { order: '' },
    };

    const root: any = {
      querySelectorAll: vi.fn((selector: string) => {
        if (selector.includes('.row')) return [rowPhys, rowEle];
        return [];
      }),
      querySelector: vi.fn((sel: string) => {
        if (sel.includes('.row')) return rowPhys;
        return null;
      }),
      insertBefore: vi.fn((node: any, ref: any) => {
        const idx = root.children.indexOf(node);
        if (idx !== -1) root.children.splice(idx, 1);
        const refIdx = ref ? root.children.indexOf(ref) : -1;
        if (refIdx !== -1) {
          root.children.splice(refIdx, 0, node);
        } else {
          root.children.push(node);
        }
      }),
      appendChild: vi.fn((node: any) => {
        const idx = root.children.indexOf(node);
        if (idx !== -1) root.children.splice(idx, 1);
        root.children.push(node);
      }),
      insertAdjacentElement: vi.fn(),
      matches: vi.fn(() => false),
      contains: vi.fn(() => false),
      children: [rowPhys, rowEle],
      style: { display: '', flexDirection: '' },
    };

    vi.stubGlobal('window', {
      location: {
        origin: 'https://www.pathofexile.com',
        pathname: '/trade2/search/poe2/Standard/test',
      },
    });
    vi.stubGlobal('document', {
      createTextNode: vi.fn((text: string) => ({ nodeType: 3, textContent: text })),
      createElementNS: vi.fn((_ns: string, tag: string) =>
        (globalThis as any).document.createElement(tag),
      ),
      querySelector: vi.fn((sel: string) => (sel === '.results' ? root : null)),
      querySelectorAll: vi.fn(() => []),
      getElementById: vi.fn(() => null),
      addEventListener: vi.fn(),
      createElement: vi.fn(() => ({
        className: '',
        setAttribute: vi.fn(),
        getAttribute: vi.fn(() => null),
        addEventListener: vi.fn(),
        replaceChildren: vi.fn(),
        append: vi.fn(),
        appendChild: vi.fn(),
        prepend: vi.fn(),
        querySelector: vi.fn(() => ({ addEventListener: vi.fn() })),
        querySelectorAll: vi.fn(() => []),
        dataset: {},
        style: {},
      })),
      head: { appendChild: vi.fn() },
    });

    const presenter = new ResultItemNormalizer('poe2');

    // res-phys: 總 DPS 1100 (pDPS 1000, eDPS 100)
    // res-ele:  總 DPS 1000 (pDPS 200, eDPS 800)
    await presenter.handleFetchResponse(
      JSON.stringify({
        url: '/api/trade2/fetch/res-phys,res-ele?query=search-ele-sort',
        data: {
          result: [
            {
              id: 'res-phys',
              item: {
                realm: 'poe2',
                baseType: 'Expert Dual Bow',
                sockets: [],
                properties: [
                  {
                    name: 'Attacks per Second',
                    values: [['1.40', 0]],
                    type: 13,
                  },
                ],
                extended: { dps: 1100, pdps: 1000, edps: 100 },
              },
            },
            {
              id: 'res-ele',
              item: {
                realm: 'poe2',
                baseType: 'Expert Dual Bow',
                sockets: [],
                properties: [
                  {
                    name: 'Attacks per Second',
                    values: [['1.40', 0]],
                    type: 13,
                  },
                ],
                extended: { dps: 1000, pdps: 200, edps: 800 },
              },
            },
          ],
        },
      }),
    );

    // 1. 依總 DPS 排序：res-phys (1100) 排在前
    presenter.setSortMode('potential_dps');
    expect(root.children).toEqual([rowPhys, rowEle]);

    // 2. 依元素 DPS 排序：res-ele (800) 排在前
    presenter.setSortMode('potential_edps');
    expect(root.children).toEqual([rowEle, rowPhys]);

    // 3. 依物理 DPS 排序：res-phys (1000) 排在前
    presenter.setSortMode('potential_pdps');
    expect(root.children).toEqual([rowPhys, rowEle]);
  });

  it('性價比排序：匯率未開啟時不排序；開啟時依 getPrimaryPrice 換算後單位計算性價比並排序', async () => {
    const rowA: any = {
      getAttribute: vi.fn((attr: string) => (attr === 'data-id' ? 'res-a' : null)),
      querySelectorAll: vi.fn(() => []),
      querySelector: vi.fn(() => null),
      prepend: vi.fn(),
      appendChild: vi.fn(),
      style: { order: '' },
    };
    const rowB: any = {
      getAttribute: vi.fn((attr: string) => (attr === 'data-id' ? 'res-b' : null)),
      querySelectorAll: vi.fn(() => []),
      querySelector: vi.fn(() => null),
      prepend: vi.fn(),
      appendChild: vi.fn(),
      style: { order: '' },
    };

    const root: any = {
      querySelectorAll: vi.fn((selector: string) => {
        if (selector.includes('.row')) return [rowA, rowB];
        return [];
      }),
      querySelector: vi.fn((sel: string) => {
        if (sel.includes('.row')) return rowA;
        return null;
      }),
      insertBefore: vi.fn((node: any, ref: any) => {
        const idx = root.children.indexOf(node);
        if (idx !== -1) root.children.splice(idx, 1);
        const refIdx = ref ? root.children.indexOf(ref) : -1;
        if (refIdx !== -1) {
          root.children.splice(refIdx, 0, node);
        } else {
          root.children.push(node);
        }
      }),
      appendChild: vi.fn((node: any) => {
        const idx = root.children.indexOf(node);
        if (idx !== -1) root.children.splice(idx, 1);
        root.children.push(node);
      }),
      insertAdjacentElement: vi.fn(),
      matches: vi.fn(() => false),
      contains: vi.fn(() => false),
      children: [rowA, rowB],
      style: { display: '', flexDirection: '' },
    };

    vi.stubGlobal('window', {
      location: { origin: 'https://www.pathofexile.com' },
    });
    vi.stubGlobal('document', {
      createTextNode: vi.fn((text: string) => ({ nodeType: 3, textContent: text })),
      createElementNS: vi.fn((_ns: string, tag: string) =>
        (globalThis as any).document.createElement(tag),
      ),
      querySelector: vi.fn((sel: string) => (sel === '.results' ? root : null)),
      querySelectorAll: vi.fn(() => []),
      getElementById: vi.fn(() => null),
      addEventListener: vi.fn(),
      createElement: vi.fn(() => ({
        className: '',
        setAttribute: vi.fn(),
        getAttribute: vi.fn(() => null),
        addEventListener: vi.fn(),
        replaceChildren: vi.fn(),
        append: vi.fn(),
        appendChild: vi.fn(),
        prepend: vi.fn(),
        querySelector: vi.fn(() => ({ addEventListener: vi.fn() })),
        querySelectorAll: vi.fn(() => []),
        dataset: {},
        style: {},
      })),
      head: { appendChild: vi.fn() },
    });

    let ratesEnabled = false;
    const mockPricePresenter: any = {
      isEnabled: vi.fn(() => ratesEnabled),
      getPrimaryPrice: vi.fn((id: string) => {
        // res-a: 1000 DPS / 100 chaos = 10 性價比
        // res-b: 400 DPS / 10 chaos = 40 性價比 (性價比更高！)
        if (id === 'res-a') return 100;
        if (id === 'res-b') return 10;
        return undefined;
      }),
    };

    const presenter = new ResultItemNormalizer('poe2', mockPricePresenter);

    await presenter.handleFetchResponse(
      JSON.stringify({
        url: '/api/trade2/fetch/res-a,res-b?query=search-cp',
        data: {
          result: [
            {
              id: 'res-a',
              item: {
                realm: 'poe2',
                baseType: 'Expert Dual Bow',
                sockets: [],
                properties: [
                  {
                    name: 'Attacks per Second',
                    values: [['1.40', 0]],
                    type: 13,
                  },
                ],
                extended: { dps: 1000, pdps: 1000, edps: 0 },
              },
            },
            {
              id: 'res-b',
              item: {
                realm: 'poe2',
                baseType: 'Expert Dual Bow',
                sockets: [],
                properties: [
                  {
                    name: 'Attacks per Second',
                    values: [['1.40', 0]],
                    type: 13,
                  },
                ],
                extended: { dps: 400, pdps: 400, edps: 0 },
              },
            },
          ],
        },
      }),
    );

    // 1. 匯率未開啟時，setSortMode("cp_ratio") 應不執行任何重排
    presenter.setSortMode('cp_ratio');
    expect(root.children).toEqual([rowA, rowB]);

    // 2. 開啟匯率後，setSortMode("cp_ratio") 應正確重排：性價比高者 (res-b, ratio=40) 排在前
    ratesEnabled = true;
    presenter.setSortMode('cp_ratio');
    expect(root.children).toEqual([rowB, rowA]);

    // 3. 停用模組 setEnabled(false) 時，應物理還原回原始順序 [rowA, rowB]
    presenter.setEnabled(false);
    expect(root.children).toEqual([rowA, rowB]);
  });

  it('線上搜尋與主控台嚴格排除：在 live 網址或線上搜尋主控台下不顯示符文覆寫控制項與標籤，且立即清理移除既有注入', async () => {
    let prependCalled = false;
    const rowTotal = {
      className: 'row row-total',
      parentElement: null,
      prepend: vi.fn(() => {
        prependCalled = true;
      }),
    };

    const row = {
      getAttribute: vi.fn((attr: string) => (attr === 'data-id' ? 'res-live' : null)),
      querySelectorAll: vi.fn(() => []),
      querySelector: vi.fn(() => null),
      prepend: vi.fn(),
      appendChild: vi.fn(),
      style: { order: '' },
    };

    const root: any = {
      querySelectorAll: vi.fn((selector: string) => {
        if (selector.includes('.row')) return [row];
        return [];
      }),
      querySelector: vi.fn((sel: string) => {
        if (sel === '.row.row-total') return rowTotal;
        return null;
      }),
      insertAdjacentElement: vi.fn(),
      insertBefore: vi.fn(),
      appendChild: vi.fn(),
      matches: vi.fn(() => false),
      contains: vi.fn(() => false),
      children: [row],
      style: { display: '', flexDirection: '' },
    };

    const removedSelectors: string[] = [];
    vi.stubGlobal('window', {
      location: {
        origin: 'https://www.pathofexile.com',
        pathname: '/trade2/search/poe2/Standard/test123/live',
      },
    });
    vi.stubGlobal('document', {
      createTextNode: vi.fn((text: string) => ({ nodeType: 3, textContent: text })),
      createElementNS: vi.fn((_ns: string, tag: string) =>
        (globalThis as any).document.createElement(tag),
      ),
      querySelector: vi.fn((sel: string) => {
        if (sel === '.row.row-total') return rowTotal;
        if (sel === '.results') return root;
        return null;
      }),
      querySelectorAll: vi.fn((sel: string) => {
        removedSelectors.push(sel);
        return [];
      }),
      getElementById: vi.fn(() => null),
      addEventListener: vi.fn(),
      body: {
        getAttribute: vi.fn(() => null),
        classList: { contains: vi.fn(() => false) },
      },
    });

    // 1. 在 live 網址下初始化：isLiveOrConsole() 為 true
    const presenter = new ResultItemNormalizer('poe2');
    expect(presenter.isLiveOrConsole()).toBe(true);

    // 2. 呼叫 apply(root)：因處於 live 網址，絕對不注入 controls
    presenter.apply(root);
    expect(prependCalled).toBe(false);

    // 3. handleFetchResponse 應直接略過
    await presenter.handleFetchResponse(
      JSON.stringify({
        url: '/api/trade2/fetch/res-live?query=live-test',
        data: {
          result: [
            {
              id: 'res-live',
              item: {
                realm: 'poe2',
                baseType: 'Expert Dual Bow',
                sockets: [],
                properties: [
                  {
                    name: 'Attacks per Second',
                    values: [['1.40', 0]],
                    type: 13,
                  },
                ],
                extended: { dps: 500, pdps: 500, edps: 0 },
              },
            },
          ],
        },
      }),
    );
    expect(prependCalled).toBe(false);

    // 4. 切換為一般搜尋網址，但在主控台角色 (live-search-primary) 下：依然嚴格排除
    vi.stubGlobal('window', {
      location: {
        origin: 'https://www.pathofexile.com',
        pathname: '/trade2/search/poe2/Standard/test123',
      },
    });
    presenter.setPageMode('search');
    presenter.setPageRole('live-search-primary');
    expect(presenter.isLiveOrConsole()).toBe(true);

    presenter.apply(root);
    expect(prependCalled).toBe(false);
  });
});
