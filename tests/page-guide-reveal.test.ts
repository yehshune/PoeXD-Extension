// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import {
  PAGE_GUIDE_REVEAL_ATTR,
  clearResultReveal,
  revealFirstResult,
} from '@/utils/page-guide-reveal';

afterEach(() => {
  document.body.innerHTML = '';
});

function renderResults() {
  document.body.innerHTML = `
    <div class="results">
      <div class="row" data-id="a">
        <div class="poexd-result-mod-host" id="a1"></div>
        <div class="poexd-result-mod-host poexd-filter-mod-highlight" id="a2"></div>
      </div>
      <div class="row" data-id="b"><div class="poexd-result-mod-host" id="b1"></div></div>
    </div>`;
}

describe('page guide result reveal', () => {
  it('reveals the first row and prefers its highlighted stat line', () => {
    renderResults();
    expect(revealFirstResult()).toBe(true);
    const revealed = Array.from(document.querySelectorAll(`[${PAGE_GUIDE_REVEAL_ATTR}]`));
    expect(revealed.map((el) => el.getAttribute('data-id') ?? el.id)).toEqual(['a', 'a2']);
  });

  it('returns false without results and clears every revealed element', () => {
    expect(revealFirstResult()).toBe(false);
    renderResults();
    revealFirstResult();
    clearResultReveal();
    expect(document.querySelector(`[${PAGE_GUIDE_REVEAL_ATTR}]`)).toBeNull();
  });
});

describe('clearResultReveal with the guide mock row', () => {
  it('keeps the mock row revealed', () => {
    document.body.innerHTML =
      '<div class="results" data-poexd-guide-mock><div class="row" data-poexd-guide-reveal></div></div>' +
      '<div class="results"><div class="row" data-id="a" data-poexd-guide-reveal></div></div>';
    clearResultReveal();
    expect(
      document
        .querySelector('[data-poexd-guide-mock] .row')!
        .hasAttribute('data-poexd-guide-reveal'),
    ).toBe(true);
    expect(
      document.querySelector('.row[data-id="a"]')!.hasAttribute('data-poexd-guide-reveal'),
    ).toBe(false);
  });
});
