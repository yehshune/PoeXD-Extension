// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RESULT_SOURCE_BADGE_CLASS,
  RESULT_SOURCE_BADGE_STYLE_ID,
  createLiveSearchResultSourceBadge,
} from '@/entrypoints/content/logic/live-search-result-source-badge';

function createTradeResultsDom() {
  const results = document.createElement('div');
  results.className = 'results';
  document.body.appendChild(results);

  const addRow = (id: string) => {
    const rs = document.createElement('div');
    rs.className = 'resultset';
    const row = document.createElement('div');
    row.className = 'row';
    row.setAttribute('data-id', id);
    const right = document.createElement('div');
    right.className = 'right';
    const details = document.createElement('div');
    details.className = 'details';
    const price = document.createElement('div');
    price.className = 'price';
    price.textContent = '10 div';
    details.appendChild(price);
    right.appendChild(details);
    row.appendChild(right);
    rs.appendChild(row);
    results.appendChild(rs);
    return { rs, row, details };
  };

  return { results, addRow };
}

describe('live-search-result-source-badge', () => {
  afterEach(() => {
    document.body.replaceChildren();
    document.getElementById(RESULT_SOURCE_BADGE_STYLE_ID)?.remove();
  });

  it('在已渲染結果列（.row[data-id]）直接掛載來源標籤，點擊可觸發篩選並同步 active 狀態', async () => {
    const { addRow } = createTradeResultsDom();
    const { row } = addRow('item-1');

    let filterOwner: string | null = null;
    const onSelectOwner = vi.fn((owner: string) => {
      filterOwner = filterOwner === owner ? null : owner;
    });

    const badge = createLiveSearchResultSourceBadge({
      document,
      resolveSourceName: (key) => (key === 'poe1:covens:abc' ? '神聖衣監聽' : undefined),
      getFilterOwner: () => filterOwner,
      onSelectOwner,
      formatTooltip: (name) => `來源：${name}`,
    });

    badge.record('item-1', 'poe1:covens:abc');
    await Promise.resolve();

    const btn = row.querySelector<HTMLButtonElement>(`:scope > .${RESULT_SOURCE_BADGE_CLASS}`);
    expect(btn?.classList.contains(RESULT_SOURCE_BADGE_CLASS)).toBe(true);
    expect(btn?.textContent).toBe('神聖衣監聽');
    expect(btn?.getAttribute('title')).toBe('來源：神聖衣監聽');
    expect(btn?.hasAttribute('data-active')).toBe(false);
    expect(document.getElementById(RESULT_SOURCE_BADGE_STYLE_ID)).not.toBeNull();

    btn?.click();
    expect(onSelectOwner).toHaveBeenCalledWith('poe1:covens:abc');
    badge.syncAll();
    expect(btn?.getAttribute('data-active')).toBe('true');

    badge.dispose();
    expect(document.querySelector(`.${RESULT_SOURCE_BADGE_CLASS}`)).toBeNull();
    expect(document.getElementById(RESULT_SOURCE_BADGE_STYLE_ID)).toBeNull();
  });

  it('結果列於 record 之後才掛載或重繪時，會透過 MutationObserver 自動補上來源標籤', async () => {
    const { addRow } = createTradeResultsDom();
    const badge = createLiveSearchResultSourceBadge({
      document,
      resolveSourceName: () => '獵首搜尋',
    });

    badge.record('item-late', 'poe1:covens:xyz');
    await Promise.resolve();

    const { row } = addRow('item-late');
    await new Promise((resolve) => setTimeout(resolve, 0));

    const btn = row.querySelector(`:scope > .${RESULT_SOURCE_BADGE_CLASS}`);
    expect(btn?.textContent).toBe('獵首搜尋');

    badge.clear();
    expect(row.querySelector(`.${RESULT_SOURCE_BADGE_CLASS}`)).toBeNull();
    badge.dispose();
  });
});
