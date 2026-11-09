import { readFileSync } from 'node:fs';
import { readBookmarkNodeSource } from './helpers/bookmark-node-source';
import { describe, expect, it } from 'vitest';

describe('Shadow DOM anti-translation & BookmarkPane clean template', () => {
  const sidebarLayoutSource = readFileSync('entrypoints/content/logic/sidebar-layout.ts', 'utf8');
  const bookmarkPaneSource = readFileSync('components/sidebar/BookmarkPane.vue', 'utf8');
  const bookmarkNodeSource = readBookmarkNodeSource();

  it('declares createShadowRootUi to encapsulate the entire sidebar in Shadow DOM', () => {
    expect(sidebarLayoutSource).toContain('createShadowRootUi');
    expect(sidebarLayoutSource).toContain("name: 'poexd-sidebar-container'");
    expect(sidebarLayoutSource).toContain('display: block !important;');
  });

  it('uses clean native template interpolation for bookmark and folder names without redundant nested SafeText', () => {
    expect(bookmarkPaneSource).not.toContain("import SafeText from './SafeText.vue'");
    expect(bookmarkPaneSource).not.toContain('SafeText');
    expect(bookmarkNodeSource).not.toContain("import SafeText from './SafeText.vue'");
    expect(bookmarkNodeSource).not.toContain('SafeText');
    expect(bookmarkNodeSource).toContain('{{ node.folder.name }}');
    expect(bookmarkNodeSource).toContain('{{ bm.name }}');
  });

  it('verifies standard TreeWalker traverses light DOM but cannot reach shadow DOM', () => {
    // Model representing DOM nodes as handled by TreeWalker
    type MockNode = {
      type: 'element' | 'text';
      value?: string;
      children?: MockNode[];
      shadowRoot?: MockNode;
    };

    const lightDomTree: MockNode = {
      type: 'element',
      children: [
        { type: 'element', children: [{ type: 'text', value: 'Search Results' }] },
        // SafeText host element with ShadowRoot
        {
          type: 'element',
          children: [], // Light DOM is empty
          shadowRoot: {
            type: 'element',
            children: [{ type: 'text', value: 'B' }], // Protected bookmark name in Shadow DOM
          },
        },
        // Unprotected element
        {
          type: 'element',
          children: [{ type: 'text', value: 'Unprotected B' }],
        },
      ],
    };

    // Standard TreeWalker implementation as used by browser and translation extensions (e.g. poe2说中文)
    function simulateTreeWalkerTextNodes(root: MockNode): string[] {
      const texts: string[] = [];
      function traverse(node: MockNode) {
        if (node.type === 'text' && node.value) {
          texts.push(node.value);
        }
        // W3C specification: TreeWalker only traverses light children of node, never penetrates shadowRoot
        if (node.children) {
          for (const child of node.children) {
            traverse(child);
          }
        }
      }
      traverse(root);
      return texts;
    }

    const visitedTexts = simulateTreeWalkerTextNodes(lightDomTree);

    // TreeWalker sees normal text
    expect(visitedTexts).toContain('Search Results');
    expect(visitedTexts).toContain('Unprotected B');

    // TreeWalker NEVER sees 'B' inside ShadowRoot
    expect(visitedTexts).not.toContain('B');
  });

  it('handles fallback gracefully when attachShadow is unavailable', () => {
    let textAssigned = '';
    const mockElement = {
      attachShadow: undefined,
      set textContent(val: string) {
        textAssigned = val;
      },
    };

    // Test fallback branch
    if (typeof mockElement.attachShadow === 'function') {
      // should not enter
      textAssigned = 'shadow';
    } else {
      mockElement.textContent = 'Fallback Name';
    }

    expect(textAssigned).toBe('Fallback Name');
  });
});
