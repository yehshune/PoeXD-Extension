// @vitest-environment happy-dom
// @vitest-environment-options { "url": "https://www.pathofexile.com/trade/search/Standard" }
import { afterEach, describe, expect, it } from 'vitest';
import { readOfficialRowCurrency } from '@/utils/trade-results-root';

function row(imgHtml: string, label = '<span>Chaos Orb</span>'): Element {
  const el = document.createElement('div');
  el.innerHTML = `<div class="price"><span class="currency-image">${imgHtml}${label}</span></div>`;
  document.body.append(el);
  return el;
}

describe('readOfficialRowCurrency', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('returns the absolute icon URL and the label name', () => {
    expect(readOfficialRowCurrency(row('<img src="https://web.poecdn.com/a.png">'))).toEqual({
      icon: 'https://web.poecdn.com/a.png',
      name: 'Chaos Orb',
    });
  });

  it('resolves protocol-relative and relative src against the page', () => {
    expect(readOfficialRowCurrency(row('<img src="//web.poecdn.com/a.png">'))?.icon).toBe(
      'https://web.poecdn.com/a.png',
    );
    expect(readOfficialRowCurrency(row('<img src="/image/a.png">'))?.icon).toBe(
      'https://www.pathofexile.com/image/a.png',
    );
  });

  it('omits the icon when src is missing or blank instead of using the page URL', () => {
    expect(readOfficialRowCurrency(row('<img>'))).toEqual({ name: 'Chaos Orb' });
    expect(readOfficialRowCurrency(row('<img src="  ">'))).toEqual({ name: 'Chaos Orb' });
  });

  it('falls back to the img title for the name', () => {
    const el = row('<img src="https://web.poecdn.com/a.png" title="divine">', '');
    expect(readOfficialRowCurrency(el)).toEqual({
      icon: 'https://web.poecdn.com/a.png',
      name: 'divine',
    });
  });

  it('returns undefined when the row has no currency image', () => {
    const el = document.createElement('div');
    expect(readOfficialRowCurrency(el)).toBeUndefined();
  });
});
