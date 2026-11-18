// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import {
  PINNED_CARD_MAX_JSON_LENGTH,
  buildPinnedCardNode,
  capturePinnedCardDom,
  sanitizePinnedCardDom,
  type PinnedCardDom,
  type PinnedCardElement,
} from '@/utils/pinned-card-dom';
import { createPinnedItemSnapshot, parseStoredPinnedList } from '@/utils/pinned-items';

// 取自 2026-11-18 國際服 PoE1 結果列（含我們自己注入的節點）的實際結構
const ROW = `
<div class="row" data-id="r1">
  <div class="left">
    <button class="refresh" title="Refresh"></button>
    <button class="poexd-left-actions-btn poexd-pin-btn">pin</button>
    <div class="newItemContainer itemPlaced iW2 iH1 ipW2 ipH1" style="background: none;">
      <div class="iconContainer">
        <div class="icon"><img src="https://web.poecdn.com/gen/image/belt.png" alt=""></div>
        <div class="verifiedStatus">Verified</div>
      </div>
    </div>
  </div>
  <div class="middle">
    <div class="item-popup item-popup--unique">
      <div class="item-popup__header item-popup__header--double">
        <span class="item-popup__symbol item-popup__symbol--left"></span>
        <div class="item-popup__header-line">Mageblood</div>
        <div class="item-popup__header-line">Heavy Belt</div>
      </div>
      <div class="item-popup__content">
        <div class="item-property item-popup__property"><span data-field="ilvl" class="s lc"><span>Item Level: </span><span style="color: var(--colour-value-default)">80</span></span></div>
        <div class="item-mod item-mod--explicit poexd-result-mod-host"><span data-field="stat.explicit.stat_3261801346" class="s lc"><span>+36 to Dexterity</span></span><span class="lc l"><span class="d">[30—50]</span></span><span class="poexd-result-mod-actions"><button class="poexd-result-mod-btn">+AND</button></span></div>
        <div><span class="lc">Corrupted</span></div>
        <a href="javascript:alert(1)">link</a>
      </div>
    </div>
  </div>
</div>`;

afterEach(() => {
  document.body.innerHTML = '';
});

function captureRow(): PinnedCardDom {
  document.body.innerHTML = ROW;
  const dom = capturePinnedCardDom(document.querySelector('.row')!);
  if (!dom) throw new Error('capture failed');
  return dom;
}

function rebuild(dom: PinnedCardDom): HTMLElement {
  const host = document.createElement('div');
  if (dom.icon) host.appendChild(buildPinnedCardNode(dom.icon, document));
  dom.popup.forEach((node) => host.appendChild(buildPinnedCardNode(node, document)));
  return host;
}

describe('capturePinnedCardDom', () => {
  it('keeps the official icon and item frame and drops our injected nodes', () => {
    const host = rebuild(captureRow());
    expect(host.querySelector('.newItemContainer')?.className).toBe(
      'newItemContainer itemPlaced iW2 iH1 ipW2 ipH1',
    );
    expect(host.querySelector('img')?.getAttribute('src')).toBe(
      'https://web.poecdn.com/gen/image/belt.png',
    );
    expect(host.querySelector('.verifiedStatus')).toBeNull();
    expect(host.querySelector('button')).toBeNull();
    expect(host.querySelector('[class*="poexd"]')).toBeNull();
    expect(host.querySelector('.item-mod')?.className).toBe('item-mod item-mod--explicit');
    expect(host.querySelector('[data-field="stat.explicit.stat_3261801346"]')?.textContent).toBe(
      '+36 to Dexterity',
    );
    expect(host.querySelector('.lc.l')?.textContent).toBe('[30—50]');
    expect(
      [...host.querySelectorAll('.item-popup__header-line')].map((n) => n.textContent),
    ).toEqual(['Mageblood', 'Heavy Belt']);
    const value = host.querySelector<HTMLElement>('[data-field="ilvl"] span:last-child');
    expect(value?.style.color).toBe('var(--colour-value-default)');
    expect(host.querySelector('a')).toBeNull();
    expect(host.textContent).not.toContain('link');
  });

  it('returns undefined when the row has no item frame', () => {
    document.body.innerHTML = '<div class="row"><div class="middle"></div></div>';
    expect(capturePinnedCardDom(document.querySelector('.row')!)).toBeUndefined();
  });
});

describe('sanitizePinnedCardDom', () => {
  const popup = (k: unknown[]) => ({ t: 'div', c: 'item-popup', k });

  it('drops unknown tags, unsafe images, bad attributes and our own nodes', () => {
    const dom = sanitizePinnedCardDom({
      icon: { t: 'img', src: 'javascript:alert(1)' },
      popup: [
        popup([
          { t: 'script', k: ['alert(1)'] },
          { t: 'img', src: 'https://evil.example/x.png' },
          { t: 'span', c: 'poexd-thing', k: ['ours'] },
          { t: 'span', c: 'lc bad"class', f: 'x" onmouseover="y', co: 'red; background: url(x)' },
          { t: 'span', onclick: 'alert(1)', k: ['<img src=x onerror=alert(1)>'] },
        ]),
      ],
    });
    expect(dom?.icon).toBeUndefined();
    const children = (dom!.popup[0] as PinnedCardElement).k!;
    expect(children).toEqual([
      { t: 'span', c: 'lc' },
      { t: 'span', k: ['<img src=x onerror=alert(1)>'] },
    ]);
    const host = document.createElement('div');
    host.appendChild(buildPinnedCardNode(dom!.popup[0]!, document));
    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('rejects empty, oversized and overly deep trees', () => {
    expect(sanitizePinnedCardDom({ popup: [] })).toBeUndefined();
    expect(sanitizePinnedCardDom({ popup: ['text only'] })).toBeUndefined();
    const big = popup(Array.from({ length: 2000 }, () => 'x'.repeat(100)));
    expect(JSON.stringify(big).length).toBeGreaterThan(PINNED_CARD_MAX_JSON_LENGTH);
    expect(sanitizePinnedCardDom({ popup: [big] })).toBeUndefined();
    let deep: unknown = 'leaf';
    for (let i = 0; i < 40; i++) deep = { t: 'div', k: [deep] };
    expect(sanitizePinnedCardDom({ popup: [deep] })).toBeUndefined();
  });

  it('survives the snapshot round trip through storage parsing', () => {
    const card = captureRow();
    const snapshot = createPinnedItemSnapshot(
      { id: 'r1', item: { typeLine: 'Heavy Belt' }, listing: {} },
      {
        gameVersion: 'poe1',
        origin: 'https://www.pathofexile.com',
        league: 'Covens',
        card,
      },
      1,
    );
    expect(snapshot?.card).toEqual(card);
    expect(parseStoredPinnedList([snapshot], 'poe1').items[0]?.card).toEqual(card);
  });
});
