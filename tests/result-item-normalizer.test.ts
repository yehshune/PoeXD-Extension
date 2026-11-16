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
  it('在 PoE 2 模式下成功攔截 fetch，將行內覆寫數值注入 .itemPopupAdditional，並在官方 row-total 左側注入控制按鈕組', async () => {
    let injectedControls: any = null;
    const inlineChildren: any[] = [];

    const rowTotal = {
      className: 'row row-total',
      parentElement: null,
      querySelector: vi.fn(() => null),
      prepend: vi.fn((el: any) => {
        injectedControls = el;
      }),
    };

    const dpsFieldSpan = {
      classList: { contains: vi.fn(() => false) },
      querySelector: vi.fn(() => null),
      querySelectorAll: vi.fn(() => []),
      appendChild: vi.fn((el: any) => {
        inlineChildren.push(el);
      }),
    };

    const popupAdditional = {
      querySelector: vi.fn((selector: string) => {
        if (selector === '[data-field="dps"]') return dpsFieldSpan;
        return null;
      }),
    };

    const row = {
      getAttribute: vi.fn((name: string) => (name === 'data-id' ? 'res-1' : null)),
      querySelectorAll: vi.fn(() => []),
      querySelector: vi.fn((selector: string) => {
        if (selector === '.itemPopupAdditional') return popupAdditional;
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

    // 驗證 3：行內覆寫數值追加進官方 .itemPopupAdditional 對應欄位（不建立舊的 .poexd-stat-badges）
    expect(dpsFieldSpan.appendChild).toHaveBeenCalled();
    const overrideEntry = inlineChildren.find((el) =>
      el.className?.includes('poexd-inline-override'),
    );
    expect(overrideEntry).toBeDefined();
    expect(textOf(overrideEntry)).toContain('➔');

    // 驗證 4：滿孔且未超限時，不顯示任何超限瓦孔或打孔標籤
    const overcapEntry = inlineChildren.find(
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

  it('防具各類型防禦排序：支援總防禦、護甲、閃避、能量護盾獨立降序排列', async () => {
    const mkRow = (id: string) => ({
      getAttribute: vi.fn((attr: string) => (attr === 'data-id' ? id : null)),
      querySelectorAll: vi.fn(() => []),
      querySelector: vi.fn(() => null),
      matches: vi.fn((sel: string) => sel.includes('.row') && !sel.includes('.controls')),
      prepend: vi.fn(),
      appendChild: vi.fn(),
      style: { order: '' },
    });
    const rowAr = mkRow('res-ar');
    const rowEv = mkRow('res-ev');
    const rowEs = mkRow('res-es');

    const root: any = {
      querySelectorAll: vi.fn((sel: string) => (sel.includes('.row') ? [rowAr, rowEv, rowEs] : [])),
      querySelector: vi.fn((sel: string) => (sel.includes('.row') ? rowAr : null)),
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
      children: [rowAr, rowEv, rowEs],
      style: { display: '', flexDirection: '' },
    };

    vi.stubGlobal('window', { location: { origin: 'https://www.pathofexile.com' } });
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
        querySelector: vi.fn(() => null),
        querySelectorAll: vi.fn(() => []),
        dataset: {},
        style: {},
      })),
      head: { appendChild: vi.fn() },
    });

    const presenter = new ResultItemNormalizer('poe2');
    await presenter.handleFetchResponse(
      JSON.stringify({
        url: '/api/trade2/fetch/res-ar?query=search-def',
        data: {
          result: [
            {
              id: 'res-ar',
              item: {
                realm: 'poe2',
                baseType: 'Exquisite Plate',
                sockets: [],
                properties: [
                  { name: 'Quality', values: [['+20%', 1]], type: 6 },
                  { name: 'Armour', values: [['900', 1]], type: 16 },
                ],
                extended: { ar: 900 },
              },
            },
            {
              id: 'res-ev',
              item: {
                realm: 'poe2',
                baseType: 'Smuggler Coat',
                sockets: [],
                properties: [
                  { name: 'Quality', values: [['+20%', 1]], type: 6 },
                  { name: 'Evasion Rating', values: [['700', 1]], type: 17 },
                  { name: 'Energy Shield', values: [['150', 1]], type: 18 },
                ],
                extended: { ev: 700, es: 150 },
              },
            },
            {
              id: 'res-es',
              item: {
                realm: 'poe2',
                baseType: 'Vile Robe',
                sockets: [],
                properties: [
                  { name: 'Quality', values: [['+20%', 1]], type: 6 },
                  { name: 'Armour', values: [['200', 1]], type: 16 },
                  { name: 'Energy Shield', values: [['500', 1]], type: 18 },
                ],
                extended: { ar: 200, es: 500 },
              },
            },
          ],
        },
      }),
    );

    // 總防禦：res-ar (1260) > res-ev (1190) > res-es (980)
    presenter.setSortMode('potential_def');
    expect(root.children).toEqual([rowAr, rowEv, rowEs]);

    // 護甲：res-ar (1260) > res-es (280) > res-ev (0)
    presenter.setSortMode('potential_armour');
    expect(root.children).toEqual([rowAr, rowEs, rowEv]);

    // 閃避：res-ev (980) 最大，其餘 (0) 維持相對順序或排後
    presenter.setSortMode('potential_evasion');
    expect(root.children[0]).toBe(rowEv);

    // 能量護盾：res-es (700) > res-ev (210) > res-ar (0)
    presenter.setSortMode('potential_es');
    expect(root.children).toEqual([rowEs, rowEv, rowAr]);
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

  it('PoE 1 國際服：僅注入排序按鈕並支援依換算價格排序，無標價與無法換算者置底，且能還原順序', async () => {
    let injectedControls: any = null;
    const builtControlWrappers: any[] = [];
    const rowTotal = {
      className: 'row row-total',
      parentElement: null,
      querySelector: vi.fn(() => null),
      prepend: vi.fn((el: any) => {
        injectedControls = el;
      }),
    };

    const makeRow = (id: string) => ({
      id,
      getAttribute: vi.fn((name: string) => (name === 'data-id' ? id : null)),
      querySelectorAll: vi.fn(() => []),
      querySelector: vi.fn(() => null),
      matches: vi.fn((sel: string) => sel.includes('.row') && !sel.includes('.controls')),
      prepend: vi.fn(),
      appendChild: vi.fn(),
      style: { order: '' },
    });

    // 原始順序: 2 divine (300c), 無標價, 100 chaos (100c), 未知通貨 (undefined), 1 divine (150c)
    const row2Div = makeRow('r-2div');
    const rowUnpriced = makeRow('r-unpriced');
    const row100c = makeRow('r-100c');
    const rowUnknownCur = makeRow('r-unknown');
    const row1Div = makeRow('r-1div');

    const root: any = {
      querySelectorAll: vi.fn((selector: string) => {
        if (selector.includes('.row'))
          return [row2Div, rowUnpriced, row100c, rowUnknownCur, row1Div];
        return [];
      }),
      querySelector: vi.fn((sel: string) => {
        if (sel.includes('.row')) return row2Div;
        return null;
      }),
      insertAdjacentElement: vi.fn(),
      insertBefore: vi.fn((node: any, ref: any) => {
        const idx = root.children.indexOf(node);
        if (idx !== -1) root.children.splice(idx, 1);
        const refIdx = ref ? root.children.indexOf(ref) : -1;
        if (refIdx !== -1) root.children.splice(refIdx, 0, node);
        else root.children.push(node);
      }),
      appendChild: vi.fn((node: any) => {
        const idx = root.children.indexOf(node);
        if (idx !== -1) root.children.splice(idx, 1);
        root.children.push(node);
      }),
      matches: vi.fn(() => false),
      contains: vi.fn((child: any) => root.children.includes(child)),
      children: [row2Div, rowUnpriced, row100c, rowUnknownCur, row1Div],
      style: { display: '', flexDirection: '' },
    };

    vi.stubGlobal('window', {
      location: { origin: 'https://www.pathofexile.com', pathname: '/trade/search/Standard/s1' },
    });
    vi.stubGlobal('document', {
      createTextNode: vi.fn((text: string) => ({ nodeType: 3, textContent: text })),
      createElementNS: vi.fn((_ns: string, tag: string) =>
        (globalThis as any).document.createElement(tag),
      ),
      querySelector: vi.fn((sel: string) => {
        if (sel === '.row.row-total') return rowTotal;
        if (sel === '.results') return root;
        if (sel === '.poexd-total-controls') return injectedControls;
        return null;
      }),
      querySelectorAll: vi.fn(() => []),
      getElementById: vi.fn(() => null),
      addEventListener: vi.fn(),
      createElement: vi.fn(() => {
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
            if (child?.className?.includes('poexd-btn-wrapper')) {
              builtControlWrappers.push(child);
            }
          }),
          prepend: vi.fn(),
          querySelector: vi.fn(() => null),
          querySelectorAll: vi.fn(() => []),
          dataset: {},
          style: {},
          textContent: '',
        };
        return el;
      }),
      head: { appendChild: vi.fn() },
    });

    const { ResultPricePresenter } =
      await import('@/entrypoints/content/logic/result-price-presenter');
    const pricePresenter = new ResultPricePresenter(
      'poe1',
      async () => ({ primary: 'chaos', rates: { chaos: 1, divine: 150 } }),
      true,
    );
    const normalizer = new ResultItemNormalizer('poe1', pricePresenter);

    const fetchDetail = JSON.stringify({
      url: '/api/trade/fetch/a,b,c,d,e?query=poe1-s1',
      data: {
        result: [
          { id: 'r-2div', listing: { price: { amount: 2, currency: 'divine' } }, item: {} },
          { id: 'r-unpriced', listing: {}, item: {} },
          { id: 'r-100c', listing: { price: { amount: 100, currency: 'chaos' } }, item: {} },
          {
            id: 'r-unknown',
            listing: { price: { amount: 10, currency: 'legacy_coin' } },
            item: {},
          },
          { id: 'r-1div', listing: { price: { amount: 1, currency: 'divine' } }, item: {} },
        ],
      },
    });

    await Promise.all([
      pricePresenter.handleFetchResponse(fetchDetail, 'Standard'),
      normalizer.handleFetchResponse(fetchDetail),
    ]);

    // 僅注入 sort 控制項，不應建立 weapon / armour 符文按鈕
    expect(injectedControls).not.toBeNull();
    expect(builtControlWrappers).toHaveLength(1);
    expect(builtControlWrappers[0].className).toContain('poexd-sort-wrapper');

    // 低 -> 高：100c < 1div(150c) < 2div(300c)，無標價與未知通貨維持相對順序並置底
    normalizer.setSortMode('price_asc');
    expect(root.children).toEqual([row100c, row1Div, row2Div, rowUnpriced, rowUnknownCur]);

    // 高 -> 低：2div(300c) > 1div(150c) > 100c，無標價與未知通貨仍置底
    normalizer.setSortMode('price_desc');
    expect(root.children).toEqual([row2Div, row1Div, row100c, rowUnpriced, rowUnknownCur]);

    // 停用價格換算時應自動重置排序並還原官方原始順序
    await pricePresenter.setEnabled(false);
    normalizer.syncPriceSupport();
    expect(root.children).toEqual([row2Div, rowUnpriced, row100c, rowUnknownCur, row1Div]);
  });

  it('PoE 1 非國際服（不支援價格換算）不注入控制列且不排序；非同步匯率晚到時自動重排', async () => {
    let injectedControls: any = null;
    const rowTotal = {
      className: 'row row-total',
      parentElement: null,
      querySelector: vi.fn(() => null),
      prepend: vi.fn((el: any) => {
        injectedControls = el;
      }),
    };
    const makeRow = (id: string) => ({
      id,
      getAttribute: vi.fn((name: string) => (name === 'data-id' ? id : null)),
      querySelectorAll: vi.fn(() => []),
      querySelector: vi.fn(() => null),
      matches: vi.fn((sel: string) => sel.includes('.row') && !sel.includes('.controls')),
      style: { order: '' },
    });
    const rowExpensive = makeRow('r-exp');
    const rowCheap = makeRow('r-cheap');
    const root: any = {
      querySelectorAll: vi.fn(() => [rowExpensive, rowCheap]),
      querySelector: vi.fn((sel: string) => (sel.includes('.row') ? rowExpensive : null)),
      insertAdjacentElement: vi.fn(),
      insertBefore: vi.fn((node: any, ref: any) => {
        const idx = root.children.indexOf(node);
        if (idx !== -1) root.children.splice(idx, 1);
        const refIdx = ref ? root.children.indexOf(ref) : -1;
        if (refIdx !== -1) root.children.splice(refIdx, 0, node);
        else root.children.push(node);
      }),
      appendChild: vi.fn((node: any) => {
        const idx = root.children.indexOf(node);
        if (idx !== -1) root.children.splice(idx, 1);
        root.children.push(node);
      }),
      matches: vi.fn(() => false),
      contains: vi.fn((child: any) => root.children.includes(child)),
      children: [rowExpensive, rowCheap],
      style: { display: '', flexDirection: '' },
    };

    vi.stubGlobal('window', {
      location: { origin: 'https://pathofexile.tw', pathname: '/trade/search/Standard/s1' },
    });
    vi.stubGlobal('document', {
      createTextNode: vi.fn((text: string) => ({ nodeType: 3, textContent: text })),
      createElementNS: vi.fn((_ns: string, tag: string) =>
        (globalThis as any).document.createElement(tag),
      ),
      querySelector: vi.fn((sel: string) => {
        if (sel === '.row.row-total') return rowTotal;
        if (sel === '.results') return root;
        if (sel === '.poexd-total-controls') return injectedControls;
        return null;
      }),
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
        querySelector: vi.fn(() => null),
        querySelectorAll: vi.fn(() => []),
        dataset: {},
        style: {},
      })),
      head: { appendChild: vi.fn() },
    });

    const { ResultPricePresenter } =
      await import('@/entrypoints/content/logic/result-price-presenter');
    const twPricePresenter = new ResultPricePresenter('poe1', async () => undefined, false);
    const twNormalizer = new ResultItemNormalizer('poe1', twPricePresenter);
    await twNormalizer.handleFetchResponse(
      JSON.stringify({
        url: '/api/trade/fetch/r-exp,r-cheap?query=tw-s1',
        data: {
          result: [
            { id: 'r-exp', listing: { price: { amount: 2, currency: 'divine' } }, item: {} },
            { id: 'r-cheap', listing: { price: { amount: 50, currency: 'chaos' } }, item: {} },
          ],
        },
      }),
    );
    expect(injectedControls).toBeNull();
    twNormalizer.setSortMode('price_asc');
    expect(root.children).toEqual([rowExpensive, rowCheap]);

    // 改測國際服非同步匯率延遲到達
    vi.stubGlobal('window', {
      location: { origin: 'https://www.pathofexile.com', pathname: '/trade/search/Standard/s2' },
    });
    let resolveRates!: (val: { primary: string; rates: Record<string, number> }) => void;
    const pendingRates = new Promise<{ primary: string; rates: Record<string, number> }>(
      (resolve) => {
        resolveRates = resolve;
      },
    );
    const intlPricePresenter = new ResultPricePresenter('poe1', () => pendingRates, true);
    const intlNormalizer = new ResultItemNormalizer('poe1', intlPricePresenter);
    const detail = JSON.stringify({
      url: '/api/trade/fetch/r-exp,r-cheap?query=intl-s2',
      data: {
        result: [
          { id: 'r-exp', listing: { price: { amount: 2, currency: 'divine' } }, item: {} },
          { id: 'r-cheap', listing: { price: { amount: 50, currency: 'chaos' } }, item: {} },
        ],
      },
    });

    const pricePromise = intlPricePresenter.handleFetchResponse(detail, 'Standard');
    await intlNormalizer.handleFetchResponse(detail);
    expect(injectedControls).not.toBeNull();

    // 使用者在匯率載入完成前點擊 price_asc，此時尚未重排
    intlNormalizer.setSortMode('price_asc');
    expect(root.children).toEqual([rowExpensive, rowCheap]);

    // 匯率完成載入後應自動觸發重排
    resolveRates({ primary: 'chaos', rates: { chaos: 1, divine: 150 } });
    await pricePromise;
    expect(root.children).toEqual([rowCheap, rowExpensive]);

    // 切換為線上搜尋主控台角色時立即還原順序且不再允許排序
    intlNormalizer.setPageRole('live-search-primary');
    expect(root.children).toEqual([rowExpensive, rowCheap]);
    intlNormalizer.setSortMode('price_asc');
    expect(root.children).toEqual([rowExpensive, rowCheap]);
  });

  it('PoE 2 亦支援純換算價格排序（含無符文飾品），且關閉價格換算時隱藏並重置價格排序', async () => {
    const rowExpensive = {
      getAttribute: vi.fn((attr: string) => (attr === 'data-id' ? 'ring-exp' : null)),
      querySelectorAll: vi.fn(() => []),
      querySelector: vi.fn(() => null),
      style: { order: '' },
    };
    const rowCheap = {
      getAttribute: vi.fn((attr: string) => (attr === 'data-id' ? 'ring-cheap' : null)),
      querySelectorAll: vi.fn(() => []),
      querySelector: vi.fn(() => null),
      style: { order: '' },
    };
    const root: any = {
      querySelectorAll: vi.fn(() => [rowExpensive, rowCheap]),
      querySelector: vi.fn((sel: string) => (sel.includes('.row') ? rowExpensive : null)),
      insertAdjacentElement: vi.fn(),
      insertBefore: vi.fn((node: any, ref: any) => {
        const idx = root.children.indexOf(node);
        if (idx !== -1) root.children.splice(idx, 1);
        const refIdx = ref ? root.children.indexOf(ref) : -1;
        if (refIdx !== -1) root.children.splice(refIdx, 0, node);
        else root.children.push(node);
      }),
      appendChild: vi.fn((node: any) => {
        const idx = root.children.indexOf(node);
        if (idx !== -1) root.children.splice(idx, 1);
        root.children.push(node);
      }),
      matches: vi.fn(() => false),
      contains: vi.fn((child: any) => root.children.includes(child)),
      children: [rowExpensive, rowCheap],
      style: { display: '', flexDirection: '' },
    };
    vi.stubGlobal('window', {
      location: {
        origin: 'https://www.pathofexile.com',
        pathname: '/trade2/search/poe2/Standard/s1',
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
        querySelector: vi.fn(() => null),
        querySelectorAll: vi.fn(() => []),
        dataset: {},
        style: {},
      })),
      head: { appendChild: vi.fn() },
    });

    let ratesEnabled = true;
    const mockPricePresenter: any = {
      isEnabled: vi.fn(() => ratesEnabled),
      getPrimaryPrice: vi.fn((id: string) =>
        id === 'ring-exp' ? 500 : id === 'ring-cheap' ? 20 : undefined,
      ),
    };
    const normalizer = new ResultItemNormalizer('poe2', mockPricePresenter);

    await normalizer.handleFetchResponse(
      JSON.stringify({
        url: '/api/trade2/fetch/ring-exp,ring-cheap?query=poe2-ring',
        data: {
          result: [
            {
              id: 'ring-exp',
              item: { realm: 'poe2', baseType: 'Ruby Ring', category: { accessories: ['ring'] } },
            },
            {
              id: 'ring-cheap',
              item: { realm: 'poe2', baseType: 'Ruby Ring', category: { accessories: ['ring'] } },
            },
          ],
        },
      }),
    );

    normalizer.setSortMode('price_asc');
    expect(root.children).toEqual([rowCheap, rowExpensive]);

    ratesEnabled = false;
    normalizer.syncPriceSupport();
    expect(root.children).toEqual([rowExpensive, rowCheap]);
  });

  it('真實 DOM 重排保留 Vue v-for 未載入佔位註解在已載入列後方，並透過 LIS 最小化搬移次數', async () => {
    const { Window } = await import('happy-dom');
    const happyWin = new Window({ url: 'https://www.pathofexile.com/trade/search/Standard/lis' });
    vi.stubGlobal('window', happyWin as any);
    vi.stubGlobal('document', happyWin.document as any);

    const results = happyWin.document.createElement('div');
    results.className = 'results';
    const resultSet = happyWin.document.createElement('div');
    resultSet.className = 'resultset';
    const rowTotal = happyWin.document.createElement('div');
    rowTotal.className = 'row row-total';

    const mkDomRow = (id: string) => {
      const r = happyWin.document.createElement('div');
      r.className = 'row';
      r.setAttribute('data-id', id);
      return r;
    };
    const rA = mkDomRow('r-a');
    const rB = mkDomRow('r-b');
    const rC = mkDomRow('r-c');
    const rD = mkDomRow('r-d');
    const placeholderComment = happyWin.document.createComment('');
    const controls = happyWin.document.createElement('div');
    controls.className = 'row controls';

    resultSet.append(rA, rB, rC, rD, placeholderComment, controls);
    results.append(rowTotal, resultSet);
    happyWin.document.body.appendChild(results);

    const insertSpy = vi.spyOn(resultSet, 'insertBefore');
    const { ResultPricePresenter } =
      await import('@/entrypoints/content/logic/result-price-presenter');
    const pricePresenter = new ResultPricePresenter(
      'poe1',
      async () => ({ primary: 'chaos', rates: { chaos: 1 } }),
      true,
    );
    const normalizer = new ResultItemNormalizer('poe1', pricePresenter);
    const detail = JSON.stringify({
      url: '/api/trade/fetch/a,b,c,d?query=lis',
      data: {
        result: [
          { id: 'r-a', listing: { price: { amount: 100, currency: 'chaos' } }, item: {} },
          { id: 'r-b', listing: { price: { amount: 200, currency: 'chaos' } }, item: {} },
          { id: 'r-c', listing: { price: { amount: 300, currency: 'chaos' } }, item: {} },
          { id: 'r-d', listing: { price: { amount: 50, currency: 'chaos' } }, item: {} },
        ],
      },
    });
    await Promise.all([
      pricePresenter.handleFetchResponse(detail, 'Standard'),
      normalizer.handleFetchResponse(detail),
    ]);

    // 目標升冪: [rD(50), rA(100), rB(200), rC(300)] -> 僅 rD 需要搬移 1 次，且不可越過 placeholderComment
    normalizer.setSortMode('price_asc');
    expect(insertSpy).toHaveBeenCalledTimes(1);
    const childNodes = Array.from(resultSet.childNodes);
    expect(childNodes.indexOf(rD as any)).toBeLessThan(childNodes.indexOf(rA as any));
    expect(childNodes.indexOf(rC as any)).toBeLessThan(
      childNodes.indexOf(placeholderComment as any),
    );
    expect(childNodes.indexOf(placeholderComment as any)).toBeLessThan(
      childNodes.indexOf(controls as any),
    );
    expect(normalizer.isMutatingResultOrder()).toBe(true);
    await Promise.resolve();
    expect(normalizer.isMutatingResultOrder()).toBe(false);
  });
});
