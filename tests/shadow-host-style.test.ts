// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { appendShadowHostStyle } from '@/entrypoints/content/logic/shadow-host-style';

const readSource = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

/** 取出 createShadowRootUi(...) 的選項物件原始碼 */
const shadowRootUiOptions = (source: string) => {
  const start = source.indexOf('createShadowRootUi(ctx, {');
  expect(start).toBeGreaterThan(-1);
  return source.slice(start, source.indexOf('onMount:', start));
};

describe('shadow root host styles', () => {
  it('appends the host css as a separate style after existing styles', () => {
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const shared = document.createElement('style');
    shared.textContent = '.shared {}';
    shadow.appendChild(shared);

    const style = appendShadowHostStyle(shadow, ':host { display: block !important; }');

    expect(style.textContent).toBe(':host { display: block !important; }');
    expect(style.hasAttribute('data-poexd-host-style')).toBe(true);
    expect([...shadow.querySelectorAll('style')]).toEqual([shared, style]);
  });

  it.each([
    'entrypoints/content/logic/sidebar-layout.ts',
    'entrypoints/content/logic/toast-host.ts',
  ])(
    '%s keeps host css out of createShadowRootUi so the WXT stylesheet text stays identical',
    (path) => {
      const source = readSource(path);
      expect(shadowRootUiOptions(source)).not.toMatch(/\bcss:/);
      expect(source).toContain('appendShadowHostStyle(shadow, hostCss);');
    },
  );
});
