import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  extractEnabledStatIds,
  ResultModHighlighter,
} from '@/entrypoints/content/logic/result-mod-highlighter';

afterEach(() => vi.unstubAllGlobals());

describe('Result mod highlighter', () => {
  it('extracts only enabled stat filter ids', () => {
    expect([
      ...extractEnabledStatIds({
        stats: [
          { filters: [{ id: 'explicit.stat_1' }, { id: 'explicit.stat_2', disabled: true }] },
          { disabled: true, filters: [{ id: 'explicit.stat_3' }] },
        ],
      }),
    ]).toEqual(['explicit.stat_1']);
  });

  it('highlights only the data-field with the matching id', () => {
    const matchingClasses = new Set<string>();
    const otherClasses = new Set<string>();
    const matchingMutations: string[] = [];
    const otherMutations: string[] = [];
    const createHighlightTarget = (classes: Set<string>, mutations: string[]) => ({
      tagName: 'DIV',
      classList: {
        remove: (name: string) => {
          if (classes.has(name)) mutations.push('remove');
          classes.delete(name);
        },
        toggle: (name: string, force: boolean) => {
          if (force) {
            if (!classes.has(name)) mutations.push('add');
            classes.add(name);
          } else {
            if (classes.has(name)) mutations.push('remove');
            classes.delete(name);
          }
        },
      },
    });
    const matchingTarget = createHighlightTarget(matchingClasses, matchingMutations);
    const otherTarget = createHighlightTarget(otherClasses, otherMutations);
    const createModLine = (dataField: string, parentElement: object) => ({
      textContent: '完全相同的顯示文字',
      parentElement,
      getAttribute: (name: string) => (name === 'data-field' ? dataField : null),
      classList: { toggle: vi.fn() },
    });
    const matchingLine = createModLine('stat.explicit.stat_3917489142', matchingTarget);
    const otherLine = createModLine('stat.explicit.stat_other', otherTarget);
    const root = {
      querySelectorAll: (selector: string) =>
        selector === '.poexd-filter-mod-highlight'
          ? [matchingTarget, otherTarget].filter((_, index) =>
              (index === 0 ? matchingClasses : otherClasses).has('poexd-filter-mod-highlight'),
            )
          : selector === '[data-field]'
            ? [matchingLine, otherLine]
            : [],
    };
    let style: any;
    vi.stubGlobal('document', {
      querySelector: () => root,
      querySelectorAll: (selector: string) => root.querySelectorAll(selector),
      getElementById: () => style || null,
      createElement: () => ({ id: '', textContent: '' }),
      head: {
        appendChild: (element: any) => {
          style = element;
        },
      },
    });

    const highlighter = new ResultModHighlighter();
    highlighter.setEnabled(true);
    highlighter.handleSearchQuery('search-1', {
      stats: [{ filters: [{ id: 'explicit.stat_3917489142' }] }],
    });

    expect(matchingClasses.has('poexd-filter-mod-highlight')).toBe(true);
    expect(otherClasses.has('poexd-filter-mod-highlight')).toBe(false);
    expect(matchingLine.classList.toggle).not.toHaveBeenCalled();
    expect(style.textContent).toContain(
      'box-shadow: 0 0 20px oklch(0.70 0.12 265 / 0.25), 0 10px 30px oklch(0.10 0.02 265 / 0.6)',
    );
    expect(style.textContent).toContain('background-color: oklch(0.25 0.05 260 / 0.53)');
    expect(style.textContent).toContain('border: 1px solid oklch(0.85 0.08 265 / 0.65)');
    expect(style.textContent).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(style.textContent).toContain('padding: 5px');
    expect(style.textContent).toContain('margin: 5px 0');
    expect(style.textContent).not.toMatch(/^\s*color:/m);
    expect(style.textContent).not.toContain('font-weight:');
    expect(style.textContent).not.toContain('text-shadow:');
    highlighter.apply(root as any);
    expect(matchingMutations).toEqual(['add']);
    expect(otherMutations).toEqual([]);
    highlighter.setEnabled(false);
    expect(matchingClasses.has('poexd-filter-mod-highlight')).toBe(false);
  });
});
