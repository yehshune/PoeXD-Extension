// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';
import StatGroupTemplateToolbar from '@/components/sidebar/stat-group-templates/StatGroupTemplateToolbar.vue';
import StatGroupTemplateSaveDialog from '@/components/injected/StatGroupTemplateSaveDialog.vue';
import StatGroupTemplatePane from '@/components/sidebar/stat-group-templates/StatGroupTemplatePane.vue';
import { setActiveDisplayLocale, resetI18nStateForTests, t } from '@/utils/i18n';

describe('Stat Group Templates i18n (Seam 6)', () => {
  beforeEach(() => {
    resetI18nStateForTests('zh-TW');
  });

  describe('StatGroupTemplateToolbar', () => {
    it('reactively renders toolbar actions across locales', async () => {
      const host = document.createElement('div');
      document.body.appendChild(host);

      const fakeManager = {
        version: 'poe2',
        templates: ref([{ id: 'tpl_1', name: 'My Custom Life Template', statGroups: [] }]),
        canUndo: ref(true),
        busy: ref(false),
        undo: vi.fn(),
        beginSaveTemplate: vi.fn(),
        exportTemplates: vi.fn(() => '[]'),
      };

      const app = createApp({
        render() {
          return h(StatGroupTemplateToolbar, {
            manager: fakeManager as any,
            canSave: true,
          });
        },
      });
      app.mount(host);
      await nextTick();

      // zh-TW default
      expect(host.textContent).toContain('儲存目前詞綴群組');
      expect(host.textContent).toContain('復原');

      // zh-CN
      setActiveDisplayLocale('zh-CN');
      await nextTick();
      expect(host.textContent).toContain('保存当前词缀分组');
      expect(host.textContent).toContain('复原');

      // en
      setActiveDisplayLocale('en');
      await nextTick();
      expect(host.textContent).toContain('Save Current Groups');
      expect(host.textContent).toContain('Undo');

      app.unmount();
      host.remove();
    });
  });

  describe('StatGroupTemplateSaveDialog', () => {
    it('reactively renders dialog title, input label and buttons without mutating default name', async () => {
      const host = document.createElement('div');
      document.body.appendChild(host);

      const app = createApp({
        render() {
          return h(StatGroupTemplateSaveDialog, {
            open: true,
            parts: [],
            defaultName: 'User Custom Template Name',
          });
        },
      });
      app.mount(host);
      await nextTick();

      // zh-TW default
      expect(document.body.textContent).toContain('儲存為常用詞綴群組');
      expect(document.body.textContent).toContain('取消');
      expect(document.body.textContent).toContain('儲存');

      // zh-CN
      setActiveDisplayLocale('zh-CN');
      await nextTick();
      expect(document.body.textContent).toContain('保存为常用词缀分组');
      expect(document.body.textContent).toContain('取消');
      expect(document.body.textContent).toContain('保存');

      // en
      setActiveDisplayLocale('en');
      await nextTick();
      expect(document.body.textContent).toContain('Save as Stat Template');
      expect(document.body.textContent).toContain('Cancel');
      expect(document.body.textContent).toContain('Save');

      app.unmount();
      host.remove();
    });
  });

  describe('StatGroupTemplatePane', () => {
    it('reactively renders empty state and template rows', async () => {
      const host = document.createElement('div');
      document.body.appendChild(host);

      const fakeManager = {
        version: 'poe2',
        templates: ref([
          {
            id: 'tpl_1',
            name: 'Crit & Life',
            statGroups: [
              {
                type: 'and',
                filters: [{ id: 'stat_1', disabled: false }],
              },
            ],
          },
        ]),
        canUndo: ref(false),
        busy: ref(false),
        applyTemplate: vi.fn(),
        removeTemplate: vi.fn(),
        renameTemplate: vi.fn(),
        reorderTemplates: vi.fn(),
        undo: vi.fn(),
        beginSaveTemplate: vi.fn(),
        exportTemplates: vi.fn(() => '[]'),
      };

      const app = createApp({
        render() {
          return h(StatGroupTemplatePane, {
            manager: fakeManager as any,
            readUrl: () => 'https://www.pathofexile.com/trade2/search/poe2/Standard',
          });
        },
      });
      app.mount(host);
      await nextTick();

      // zh-TW: template row buttons & units
      expect(host.textContent).toContain('Crit & Life');
      expect(host.textContent).toContain('條詞綴');
      expect(host.textContent).toContain('疊加');

      // zh-CN
      setActiveDisplayLocale('zh-CN');
      await nextTick();
      expect(host.textContent).toContain('条词缀');
      expect(host.textContent).toContain('叠加');

      // en
      setActiveDisplayLocale('en');
      await nextTick();
      expect(host.textContent).toContain('affixes');
      expect(host.textContent).toContain('Overlay');

      app.unmount();
      host.remove();
    });
  });
});
