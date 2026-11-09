// @vitest-environment happy-dom
import { describe, expect, it, beforeEach } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';
import {
  formatBatchEnableSummary,
  resolveBatchEnableToast,
  formatBatchStopSummary,
  resolveBatchStopToast,
  resolveSingleEnqueueToast,
} from '@/components/sidebar/live-search-presentation';
import { createLiveSearchConsoleTitleGuard } from '@/entrypoints/content/logic/live-search-console-title';
import LiveSearchResumeInspectPopover from '@/components/sidebar/LiveSearchResumeInspectPopover.vue';
import LiveSearchConsoleSettingsPane from '@/components/sidebar/LiveSearchConsoleSettingsPane.vue';
import TemporarySearchDialog from '@/components/sidebar/TemporarySearchDialog.vue';
import { setActiveDisplayLocale, resetI18nStateForTests, t } from '@/utils/i18n';

describe('LiveSearch Console & Presentation i18n (Seam 7)', () => {
  beforeEach(() => {
    resetI18nStateForTests('zh-TW');
  });

  describe('live-search-presentation helpers', () => {
    it('reactively formats batch enable summary across locales', () => {
      const outcome = { succeeded: 3, skipped: 1, failed: 2 } as any;

      // zh-TW
      expect(formatBatchEnableSummary(outcome)).toBe('已啟用 3 項 · 略過 1 項 · 2 項無法啟用');

      // zh-CN
      setActiveDisplayLocale('zh-CN');
      expect(formatBatchEnableSummary(outcome)).toBe('已启用 3 项 · 略过 1 项 · 2 项无法启用');

      // en
      setActiveDisplayLocale('en');
      expect(formatBatchEnableSummary(outcome)).toBe('Enabled 3 · Skipped 1 · 2 failed to enable');
    });

    it('reactively formats single enqueue toast across locales', () => {
      // zh-TW
      const toastTw = resolveSingleEnqueueToast({ success: true, created: true } as any, 'Bow');
      expect(toastTw.message).toContain('已於背景開啟主控台並送入「Bow」');

      // zh-CN
      setActiveDisplayLocale('zh-CN');
      const toastCn = resolveSingleEnqueueToast({ success: true, created: true } as any, 'Bow');
      expect(toastCn.message).toContain('已在后台打开主控台并送入「Bow」');

      // en
      setActiveDisplayLocale('en');
      const toastEn = resolveSingleEnqueueToast({ success: true, created: true } as any, 'Bow');
      expect(toastEn.message).toContain('Opened console in background and added "Bow"');
    });
  });

  describe('live-search-console-title', () => {
    it('reactively updates document title across locales', async () => {
      const mockDoc = document.implementation.createHTMLDocument('Initial Title');
      const guard = createLiveSearchConsoleTitleGuard(mockDoc, 'poe2');
      guard.start();

      // zh-TW
      expect(mockDoc.title).toBe('線上搜尋主控台');

      // zh-CN
      setActiveDisplayLocale('zh-CN');
      await nextTick();
      expect(mockDoc.title).toBe('线上搜索主控台');

      // en
      setActiveDisplayLocale('en');
      await nextTick();
      expect(mockDoc.title).toBe('LiveSearch Console');

      guard.dispose();
    });
  });

  describe('LiveSearchResumeInspectPopover', () => {
    it('reactively renders inspect popover content across locales', async () => {
      const host = document.createElement('div');
      document.body.appendChild(host);

      const items = [{ id: '1', name: 'Item 1', groupPath: 'Group A', status: 'idle' as const }];

      const app = createApp({
        render() {
          return h(LiveSearchResumeInspectPopover, {
            open: true,
            items,
            leagueDisplay: 'Standard',
          });
        },
      });
      app.mount(host);
      await nextTick();

      // zh-TW default
      expect(document.body.textContent).toContain('可恢復連線');
      expect(document.body.textContent).toContain('恢復 1 項');

      // zh-CN
      setActiveDisplayLocale('zh-CN');
      await nextTick();
      expect(document.body.textContent).toContain('可恢复连接');
      expect(document.body.textContent).toContain('恢复 1 项');

      // en
      setActiveDisplayLocale('en');
      await nextTick();
      expect(document.body.textContent).toContain('Resumable Connections');
      expect(document.body.textContent).toContain('Restore 1');

      app.unmount();
      host.remove();
    });
  });

  describe('LiveSearchConsoleSettingsPane', () => {
    it('reactively renders settings labels across locales', async () => {
      const host = document.createElement('div');
      document.body.appendChild(host);

      const fakePrefMod = {
        read: () => ({ liveSearchResumeMode: 'off' }),
        subscribe: () => () => {},
        update: async () => ({ ok: true, value: {} }),
      };

      const app = createApp({
        render() {
          return h(LiveSearchConsoleSettingsPane, {
            preferences: fakePrefMod as any,
          });
        },
      });
      app.mount(host);
      await nextTick();

      // zh-TW
      expect(host.textContent).toContain('結果展示筆數上限');
      expect(host.textContent).toContain('重新開啟主控台時');
      expect(host.textContent).toContain('清理');

      // zh-CN
      setActiveDisplayLocale('zh-CN');
      await nextTick();
      expect(host.textContent).toContain('结果展示条数上限');
      expect(host.textContent).toContain('重新打开主控台时');
      expect(host.textContent).toContain('清理');

      // en
      setActiveDisplayLocale('en');
      await nextTick();
      expect(host.textContent).toContain('Max displayed results');
      expect(host.textContent).toContain('When Reopening Console');
      expect(host.textContent).toContain('Clean');

      app.unmount();
      host.remove();
    });
  });

  describe('TemporarySearchDialog', () => {
    it('reactively renders dialog title, tabs and input labels across locales', async () => {
      const host = document.createElement('div');
      document.body.appendChild(host);

      const fakeSourceCtrl = {
        read: () => ({ groups: [] }),
        subscribe: () => () => {},
      };

      const app = createApp({
        render() {
          return h(TemporarySearchDialog, {
            open: true,
            sourceController: fakeSourceCtrl as any,
          });
        },
      });
      app.mount(host);
      await nextTick();

      // zh-TW
      expect(document.body.textContent).toContain('新增搜尋連線');
      expect(document.body.textContent).toContain('從書籤挑選');
      expect(document.body.textContent).toContain('輸入搜尋網址');
      expect(document.body.textContent).toContain('取消');

      // zh-CN
      setActiveDisplayLocale('zh-CN');
      await nextTick();
      expect(document.body.textContent).toContain('新增搜索连线');
      expect(document.body.textContent).toContain('从书签挑选');
      expect(document.body.textContent).toContain('输入搜索网址');

      // en
      setActiveDisplayLocale('en');
      await nextTick();
      expect(document.body.textContent).toContain('Add Search Connection');
      expect(document.body.textContent).toContain('From Bookmarks');
      expect(document.body.textContent).toContain('Enter URL');
      expect(document.body.textContent).toContain('Cancel');

      app.unmount();
      host.remove();
    });
  });
});
