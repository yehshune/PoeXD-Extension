// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp, type App } from 'vue';
import TradeSearchPreviewContent from '@/components/sidebar/search-preview/TradeSearchPreviewContent.vue';
import type { TradeSearchPreviewData } from '@/components/sidebar/composables/useTradeSearchPreview';
import { setMockDictionaries } from '@/utils/trade-stat-dictionary';

const data: TradeSearchPreviewData = {
  loading: false,
  gameVersion: 'poe2',
  realmLabel: '國際服',
  league: 'Forbidden Rites',
  meta: { suggestedName: 'x', stats: [], filters: [] },
  criteria: {
    statGroups: [
      {
        type: 'and',
        disabled: true,
        filters: [{ id: 'explicit.stat_hybrid' }, { id: 'explicit.stat_int', value: { min: 34 } }],
      },
      { type: 'count', value: { min: 2 }, filters: [{ id: 'explicit.stat_int' }] },
    ],
    fields: [],
    sectionDisabled: {},
  },
};

let app: App | undefined;
afterEach(() => {
  app?.unmount();
  app = undefined;
});

beforeEach(() => {
  setMockDictionaries('poe2', {
    'explicit.stat_hybrid': [{ displayTemplate: '增加 #% 物理傷害|||||+# 命中值' }],
    'explicit.stat_int': [{ displayTemplate: '+# 智慧' }],
  });
});

function render(props: Record<string, unknown>) {
  const container = document.createElement('div');
  app = createApp(TradeSearchPreviewContent, { previewData: data, ...props });
  app.mount(container);
  return container;
}

describe('TradeSearchPreviewContent 標題列', () => {
  it('第一行顯示來源名稱與標籤，第二行放單行操作按鈕', () => {
    const container = render({ sourceName: '二元性 庇護細杖', canOverlay: true });
    const titleRow = container.querySelector('.preview-title-row')!;
    expect(titleRow.querySelector('[data-test="preview-source-name"]')?.textContent).toBe(
      '二元性 庇護細杖',
    );
    expect(
      Array.from(titleRow.querySelectorAll('.preview-tag')).map((t) => t.textContent?.trim()),
    ).toEqual(['國際服', 'Forbidden Rites']);

    const actionRow = container.querySelector('.preview-action-row')!;
    const buttons = Array.from(actionRow.querySelectorAll('button'));
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['全部摺疊', '全部疊加', '復原']);
    for (const button of buttons) expect(button.className).toContain('whitespace-nowrap');
  });

  it('標題列比照詞綴選擇器：固定高度、本文字級，內容區可捲動', () => {
    const container = render({ sourceName: '二元性 庇護細杖' });
    const header = container.querySelector('.preview-title-row')!;
    expect(header.className).toContain('h-[var(--pxd-sidebar-affix-dialog-header-height)]');
    expect(header.className).toContain('shrink-0');
    expect(container.querySelector('[data-test="preview-source-name"]')?.className).toContain(
      'text-[length:var(--pxd-font-body)]',
    );
    const body = container.querySelector('.preview-body')!;
    expect(body.className).toContain('overflow-y-auto');
    expect(body.className).toContain('p-[var(--pxd-pane-padding)]');
  });

  it('沒有來源名稱時標題列顯示預設名稱', () => {
    const container = render({});
    expect(container.querySelector('[data-test="preview-source-name"]')?.textContent).toBe(
      '搜尋預覽',
    );
  });

  it('只有固定顯示的預覽有關閉鈕，按下送出 close', () => {
    expect(render({}).querySelector('[data-test="preview-close"]')).toBeNull();
    app?.unmount();

    let closed = 0;
    const container = render({ closable: true, onClose: () => closed++ });
    (container.querySelector('[data-test="preview-close"]') as HTMLButtonElement).click();
    expect(closed).toBe(1);
  });

  it('不寫死像素尺寸', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      'components/sidebar/search-preview/TradeSearchPreviewContent.vue',
      'utf8',
    );
    expect(source).not.toMatch(/-\[\d+px\]/);
  });

  it('無法疊加時在操作列顯示原因', () => {
    const container = render({ overlayHint: '在官方搜尋頁才能疊加條件' });
    expect(
      container.querySelector('.preview-action-row [data-test="preview-overlay-hint"]')
        ?.textContent,
    ).toBe('在官方搜尋頁才能疊加條件');
  });
});

describe('TradeSearchPreviewContent 詞綴群組卡片', () => {
  it('每個群組是一張卡片，標頭列出類型、範圍、停用、條數與疊加按鈕', () => {
    const container = render({ canOverlay: true });
    const cards = container.querySelectorAll<HTMLElement>('.preview-stat-group');
    expect(cards).toHaveLength(2);

    const [disabledCard, countCard] = cards;
    expect(disabledCard.dataset.disabled).toBe('true');
    expect(disabledCard.className).toContain('opacity-60');
    const disabledHeader = disabledCard.querySelector('.preview-stat-group-header')!;
    expect(disabledHeader.querySelector('.preview-stat-group-type')?.textContent).toBe('且 (AND)');
    expect(disabledHeader.querySelector('.preview-stat-group-disabled')?.textContent).toBe('停用');
    expect(disabledHeader.textContent).toContain('2 條');
    expect(
      disabledHeader.querySelector('[data-test="preview-overlay-stat-group"]')?.textContent?.trim(),
    ).toBe('疊加');

    expect(countCard.dataset.disabled).toBeUndefined();
    expect(countCard.querySelector('.preview-stat-group-header')?.textContent).toContain('≥ 2');
  });

  it('混合詞綴拆成同一列內的多行，不顯示 ||||| 分隔符', () => {
    const container = render({});
    const firstRow = container.querySelector('.preview-stat-group .preview-stat-row')!;
    expect(Array.from(firstRow.querySelectorAll('.stat-line')).map((l) => l.textContent)).toEqual([
      '增加 #% 物理傷害',
      '+# 命中值',
    ]);
    expect(container.textContent).not.toContain('|||||');
  });

  it('canOpenSearch 開啟時顯示前往搜尋與新分頁開啟按鈕，預設不顯示', () => {
    expect(render({}).querySelector('.preview-search-row')).toBeNull();
    app?.unmount();

    const modes: Array<'current' | 'new-tab'> = [];
    const container = render({
      canOpenSearch: true,
      onOpenSearch: (mode: 'current' | 'new-tab') => modes.push(mode),
    });
    expect(container.querySelector('.preview-search-row')).not.toBeNull();
    (container.querySelector('[data-test="preview-open-current"]') as HTMLButtonElement).click();
    (container.querySelector('[data-test="preview-open-new-tab"]') as HTMLButtonElement).click();
    expect(modes).toEqual(['current', 'new-tab']);
  });

  it('canTune 與 canOverwrite 啟用時可切換詞綴、改數值、顯示還原與覆蓋回書籤按鈕', () => {
    const events: string[] = [];
    const container = render({
      canOpenSearch: true,
      canTune: true,
      canOverwrite: true,
      isModified: true,
      onSetStatGroupDisabled: (g: number, d: boolean) => events.push(`g:${g}:${d}`),
      onSetStatGroupBound: (g: number, b: string, v: number | null) =>
        events.push(`gb:${g}:${b}:${v}`),
      onSetStatFilterDisabled: (g: number, f: number, d: boolean) =>
        events.push(`f:${g}:${f}:${d}`),
      onSetStatFilterBound: (g: number, f: number, b: string, v: number | null) =>
        events.push(`fb:${g}:${f}:${b}:${v}`),
      onResetTune: () => events.push('reset'),
      onOverwriteBookmark: () => events.push('overwrite'),
    });

    (
      container.querySelector('[data-test="preview-overwrite-bookmark"]') as HTMLButtonElement
    ).click();
    (container.querySelector('[data-test="preview-reset-tune"]') as HTMLButtonElement).click();

    const groupToggles = container.querySelectorAll<HTMLElement>(
      '[data-test="preview-stat-group-toggle"]',
    );
    expect(groupToggles).toHaveLength(2);
    groupToggles[0].click();

    const groupMin = container.querySelector<HTMLInputElement>(
      '[data-test="preview-stat-group-min"]',
    )!;
    groupMin.value = '3';
    groupMin.dispatchEvent(new Event('change'));

    const statToggles = container.querySelectorAll<HTMLElement>(
      '[data-test="preview-stat-toggle"]',
    );
    expect(statToggles[0].hasAttribute('disabled')).toBe(true);
    statToggles[2].click();

    const statMins = container.querySelectorAll<HTMLInputElement>('[data-test="preview-stat-min"]');
    statMins[1].value = '50';
    statMins[1].dispatchEvent(new Event('change'));

    // 最大／最小 input 之間不顯示波浪號 ~
    const groupHeaderTildes = Array.from(
      container.querySelectorAll('.preview-stat-group-header span'),
    ).filter((el) => el.textContent?.trim() === '~');
    const statRowTildes = Array.from(container.querySelectorAll('.preview-stat-row span')).filter(
      (el) => el.textContent?.trim() === '~',
    );
    expect(groupHeaderTildes).toHaveLength(0);
    expect(statRowTildes).toHaveLength(0);

    expect(events).toEqual([
      'overwrite',
      'reset',
      'g:0:false',
      'gb:1:min:3',
      'f:1:0:true',
      'fb:0:1:min:50',
    ]);
  });

  it('依官方詞綴網域顯示對應標籤徽章與共用色票，explicit 不顯示標籤', () => {
    setMockDictionaries('poe2', {
      'explicit.stat_int': [{ displayTemplate: '+# 智慧' }],
      'fractured.stat_life': [{ displayTemplate: '+# 最大生命' }],
      'desecrated.stat_res': [{ displayTemplate: '+#% 火焰抗性' }],
      'pseudo.pseudo_res': [{ displayTemplate: '+#% 總抗性' }],
    });
    const domainData: TradeSearchPreviewData = {
      loading: false,
      gameVersion: 'poe2',
      meta: { suggestedName: 'domain-test', stats: [], filters: [] },
      criteria: {
        statGroups: [
          {
            type: 'and',
            filters: [
              { id: 'explicit.stat_int' },
              { id: 'fractured.stat_life' },
              { id: 'desecrated.stat_res' },
              { id: 'pseudo.pseudo_res' },
            ],
          },
        ],
        fields: [],
        sectionDisabled: {},
      },
    };
    const container = render({ previewData: domainData });
    const rows = Array.from(container.querySelectorAll<HTMLElement>('.preview-stat-row'));
    expect(rows).toHaveLength(4);

    // explicit 不顯示標籤且維持 text-foreground
    expect(rows[0].dataset.statDomain).toBe('explicit');
    expect(rows[0].querySelector('.stat-domain-badge')).toBeNull();
    expect(rows[0].querySelector('.stat-name')?.className).toContain('text-foreground');

    // fractured / desecrated / pseudo 皆顯示官方標籤與共用 --pxd-stat-* 色票
    expect(rows[1].querySelector('.stat-domain-badge')?.textContent?.trim()).toBe('破裂');
    expect(rows[1].style.getPropertyValue('--pxd-stat-color')).toBe('var(--pxd-stat-fractured)');
    expect(rows[1].querySelector('.stat-name')?.className).toContain('pxd-stat-domain-text');

    expect(rows[2].querySelector('.stat-domain-badge')?.textContent?.trim()).toBe('褻瀆');
    expect(rows[2].style.getPropertyValue('--pxd-stat-color')).toBe('var(--pxd-stat-desecrated)');

    expect(rows[3].querySelector('.stat-domain-badge')?.textContent?.trim()).toBe('偽屬性');
    expect(rows[3].style.getPropertyValue('--pxd-stat-color')).toBe('var(--pxd-stat-pseudo)');
  });

  it('微調導致 previewData 更新但 resetKey 未變時保留區段摺疊狀態，且未指定 status 仍可於 canTune 模式顯示狀態選單', async () => {
    const { h, nextTick, ref } = await import('vue');
    const baseData: TradeSearchPreviewData = {
      loading: false,
      gameVersion: 'poe2',
      meta: { suggestedName: 'keep-collapse', stats: [], filters: [] },
      criteria: {
        statGroups: [{ type: 'and', filters: [{ id: 'explicit.stat_int' }] }],
        fields: [],
        sectionDisabled: {},
      },
    };
    const resetKeyRef = ref<TradeSearchPreviewData>(baseData);
    const previewRef = ref<TradeSearchPreviewData>(baseData);
    const container = document.createElement('div');
    app = createApp({
      setup: () => () =>
        h(TradeSearchPreviewContent, {
          previewData: previewRef.value,
          resetKey: resetKeyRef.value,
          canTune: true,
        }),
    });
    app.mount(container);

    // 即使原始 criteria 沒有 status，canTune 時仍顯示未指定的狀態選擇列
    expect(
      container.querySelector('[data-test="preview-status-select"]')?.textContent?.trim(),
    ).toBe('未指定');

    // 先摺疊詞綴區段
    const toggleBtn = container.querySelector<HTMLButtonElement>('.preview-section-toggle')!;
    toggleBtn.click();
    await nextTick();
    expect(toggleBtn.getAttribute('aria-expanded')).toBe('false');

    // 模擬微調後傳入新 previewData 物件，但 resetKey（原始預覽）未變
    previewRef.value = {
      ...baseData,
      criteria: {
        status: 'available',
        statGroups: [{ type: 'and', filters: [{ id: 'explicit.stat_int', value: { min: 10 } }] }],
        fields: [],
        sectionDisabled: {},
      },
    };
    await nextTick();
    expect(container.querySelector('.preview-section-toggle')?.getAttribute('aria-expanded')).toBe(
      'false',
    );

    // 切換到新的 resetKey（新預覽目標）時恢復全部展開
    const nextData: TradeSearchPreviewData = {
      ...baseData,
      meta: { suggestedName: 'other', stats: [], filters: [] },
    };
    resetKeyRef.value = nextData;
    previewRef.value = nextData;
    await nextTick();
    expect(container.querySelector('.preview-section-toggle')?.getAttribute('aria-expanded')).toBe(
      'true',
    );
  });
});
