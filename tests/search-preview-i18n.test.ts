// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';
import TradeSearchPreviewContent from '@/components/sidebar/search-preview/TradeSearchPreviewContent.vue';
import TradeSearchPreviewPopover from '@/components/sidebar/search-preview/TradeSearchPreviewPopover.vue';
import { setActiveDisplayLocale, resetI18nStateForTests } from '@/utils/i18n';

describe('Search Preview & Criteria Overlay i18n (Seam 5)', () => {
  beforeEach(() => {
    resetI18nStateForTests('zh-TW');
  });

  describe('TradeSearchPreviewContent', () => {
    it('reactively renders preview actions and section headers across locales', async () => {
      const host = document.createElement('div');
      document.body.appendChild(host);

      const previewData = {
        url: 'https://www.pathofexile.com/trade/search/Standard/test',
        loading: false,
        isLegacy: false,
        criteria: {
          version: 'poe2' as const,
          item: { name: 'Tabula Rasa' },
          status: 'online' as const,
          statGroups: [
            {
              type: 'and' as const,
              filters: [{ id: 'explicit.stat_1', value: { min: 10 } }],
            },
          ],
          fields: [],
          sectionDisabled: {},
        },
        meta: {
          name: 'Tabula Rasa',
          stats: [],
          filters: [],
        },
      };

      const app = createApp({
        render() {
          return h(TradeSearchPreviewContent, {
            previewData: previewData as any,
            canOverlay: true,
            canUndo: true,
            sourceName: 'My Custom Search Bookmark',
          });
        },
      });
      app.mount(host);
      await nextTick();

      // zh-TW default
      expect(host.textContent).toContain('My Custom Search Bookmark'); // Unmutated user name!
      expect(host.textContent).toContain('全部疊加');
      expect(host.textContent).toContain('復原');
      expect(host.textContent).toContain('物品：');
      expect(host.textContent).toContain('詞綴條件');

      // Switch to zh-CN
      setActiveDisplayLocale('zh-CN');
      await nextTick();
      expect(host.textContent).toContain('My Custom Search Bookmark');
      expect(host.textContent).toContain('全部叠加');
      expect(host.textContent).toContain('复原');
      expect(host.textContent).toContain('物品：');
      expect(host.textContent).toContain('词缀条件');

      // Switch to en
      setActiveDisplayLocale('en');
      await nextTick();
      expect(host.textContent).toContain('My Custom Search Bookmark');
      expect(host.textContent).toContain('Overlay All');
      expect(host.textContent).toContain('Undo');
      expect(host.textContent).toContain('Stat Criteria');

      app.unmount();
      host.remove();
    });
  });

  describe('TradeSearchPreviewPopover', () => {
    it('reactively renders overlay hint when outside search page', async () => {
      const host = document.createElement('div');
      document.body.appendChild(host);

      const fakeManager = {
        version: 'poe2',
        canUndo: ref(false),
        busy: ref(false),
        undo: vi.fn(),
        overlay: vi.fn(),
      };

      const previewData = {
        url: 'https://www.pathofexile.com/trade/search/Standard/test',
        loading: false,
        isLegacy: false,
        criteria: {
          version: 'poe2' as const,
          item: null,
          status: null,
          statGroups: [],
          fields: [],
          sectionDisabled: {},
        },
        meta: { stats: [], filters: [] },
      };

      const app = createApp({
        render() {
          return h(TradeSearchPreviewPopover, {
            open: true,
            previewData: previewData as any,
            readUrl: () => 'https://www.pathofexile.com/account/view-profile', // non-search page
            manager: fakeManager as any,
          });
        },
      });
      app.mount(host);
      await nextTick();

      // zh-TW
      expect(document.body.textContent).toContain('在官方搜尋頁才能疊加條件');

      // zh-CN
      setActiveDisplayLocale('zh-CN');
      await nextTick();
      expect(document.body.textContent).toContain('在官方搜索页才能叠加条件');

      // en
      setActiveDisplayLocale('en');
      await nextTick();
      expect(document.body.textContent).toContain(
        'Criteria overlay is only available on official search pages',
      );

      app.unmount();
      host.remove();
    });
  });
});
