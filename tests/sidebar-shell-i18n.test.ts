// @vitest-environment happy-dom
import { describe, expect, it, beforeEach } from 'vitest';
import { createApp, defineComponent, h, nextTick } from 'vue';
import DragTrashZone from '@/components/sidebar/layout/DragTrashZone.vue';
import { setActiveDisplayLocale, resetI18nStateForTests, t } from '@/utils/i18n';

describe('Sidebar Shell & Navigation i18n (Seam 3)', () => {
  beforeEach(() => {
    resetI18nStateForTests('zh-TW');
  });

  describe('DragTrashZone', () => {
    it('reactively renders drag hints across locales', async () => {
      const host = document.createElement('div');
      document.body.appendChild(host);

      const app = createApp({
        render() {
          return h(DragTrashZone, {
            visible: true,
            overTrash: false,
            sidebarPosition: 'left',
          });
        },
      });
      app.mount(host);
      await nextTick();

      expect(host.textContent).toContain('拖曳至此處刪除');

      setActiveDisplayLocale('zh-CN');
      await nextTick();
      expect(host.textContent).toContain('拖拽至此处删除');

      setActiveDisplayLocale('en');
      await nextTick();
      expect(host.textContent).toContain('Drag here to delete');

      app.unmount();
      host.remove();
    });

    it('reactively renders over-trash release hint across locales', async () => {
      const host = document.createElement('div');
      document.body.appendChild(host);

      const app = createApp({
        render() {
          return h(DragTrashZone, {
            visible: true,
            overTrash: true,
            sidebarPosition: 'left',
          });
        },
      });
      app.mount(host);
      await nextTick();

      expect(host.textContent).toContain('放開以刪除');

      setActiveDisplayLocale('en');
      await nextTick();
      expect(host.textContent).toContain('Release to delete');

      app.unmount();
      host.remove();
    });
  });

  describe('Sidebar Navigation & Shell Messages', () => {
    it('localizes navigation tab labels and console titles in i18n dictionary', () => {
      setActiveDisplayLocale('zh-TW');
      expect(t('sidebar.nav.bookmarks')).toBe('快速書籤');
      expect(t('sidebar.nav.liveSearchConnections')).toBe('搜尋連線');
      expect(t('sidebar.nav.liveSearchSettings')).toBe('主控台設定');

      setActiveDisplayLocale('zh-CN');
      expect(t('sidebar.nav.bookmarks')).toBe('快速书签');
      expect(t('sidebar.nav.liveSearchConnections')).toBe('搜索连线');
      expect(t('sidebar.nav.liveSearchSettings')).toBe('主控台设置');

      setActiveDisplayLocale('en');
      expect(t('sidebar.nav.bookmarks')).toBe('Quick Bookmarks');
      expect(t('sidebar.nav.liveSearchConnections')).toBe('Search Connections');
      expect(t('sidebar.nav.liveSearchSettings')).toBe('Console Settings');
    });
  });
});
