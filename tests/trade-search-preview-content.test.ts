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
});
