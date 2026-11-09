// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { appendLabeledValue, createSvgIcon, setLabeledValue } from '@/utils/safe-dom';

describe('safe-dom', () => {
  it('creates an SVG icon with namespaced elements and attributes', () => {
    const svg = createSvgIcon({
      attrs: { width: '15', viewBox: '0 0 24 24', fill: 'none' },
      paths: ['M1 1h2', 'm3 3 4 4'],
    });
    expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(svg.tagName.toLowerCase()).toBe('svg');
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    const paths = svg.querySelectorAll('path');
    expect(paths).toHaveLength(2);
    expect(paths[1].getAttribute('d')).toBe('m3 3 4 4');
    expect(paths[0].namespaceURI).toBe('http://www.w3.org/2000/svg');
  });

  it('applies per-path attributes', () => {
    const svg = createSvgIcon({
      attrs: { viewBox: '0 0 24 24' },
      paths: ['M0 0'],
      pathAttrs: { style: 'fill: currentColor' },
    });
    expect(svg.querySelector('path')!.getAttribute('style')).toBe('fill: currentColor');
  });

  it('appends a label text node and a classed value span without parsing HTML', () => {
    const parent = document.createElement('span');
    appendLabeledValue(parent, '潛力 DPS: ', '<img src=x onerror=alert(1)>', 'colourAugmented');

    expect(parent.childNodes).toHaveLength(2);
    expect(parent.childNodes[0].nodeType).toBe(Node.TEXT_NODE);
    expect(parent.textContent).toBe('潛力 DPS: <img src=x onerror=alert(1)>');
    const value = parent.querySelector('span.colourAugmented')!;
    expect(value.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(parent.querySelector('img')).toBeNull();
  });

  it('replaces existing children when setting a labeled value', () => {
    const parent = document.createElement('div');
    parent.appendChild(document.createElement('b'));
    setLabeledValue(parent, 'A', 'B');
    expect(parent.querySelector('b')).toBeNull();
    expect(parent.innerHTML).toBe('A<span>B</span>');
  });
});
