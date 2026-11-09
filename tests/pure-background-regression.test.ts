// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { updatePureBackgroundClass } from '@/entrypoints/content/logic/injected-controls';
import { createFilterDomEnhancements } from '@/entrypoints/content/logic/common';

describe('updatePureBackgroundClass (document_start regression)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries when document.body is not yet present and applies class once body is attached', () => {
    const origBody = document.body;
    try {
      // 1. 模擬 document_start 階段：document.body 尚未存在
      Object.defineProperty(document, 'body', {
        value: null,
        configurable: true,
        writable: true,
      });

      // 2. 呼叫 updatePureBackgroundClass(true)
      updatePureBackgroundClass(true);

      // 3. 模擬瀏覽器完成 DOM 解析並建立 body
      const newBody = document.createElement('body');
      Object.defineProperty(document, 'body', {
        value: newBody,
        configurable: true,
        writable: true,
      });

      expect(newBody.classList.contains('poexd-pure-bg')).toBe(false);

      // 4. 前進 timer 觸發 50ms retry
      vi.advanceTimersByTime(50);

      // 5. 斷言 poexd-pure-bg 最終成功套用至新建立的 body
      expect(newBody.classList.contains('poexd-pure-bg')).toBe(true);
    } finally {
      Object.defineProperty(document, 'body', {
        value: origBody,
        configurable: true,
        writable: true,
      });
    }
  });

  it('coordinates correctly via FilterDomEnhancements facade', () => {
    const origBody = document.body;
    try {
      Object.defineProperty(document, 'body', {
        value: null,
        configurable: true,
        writable: true,
      });

      const enhancements = createFilterDomEnhancements('poe1');
      enhancements.updatePureBackgroundClass(true);

      const newBody = document.createElement('body');
      Object.defineProperty(document, 'body', {
        value: newBody,
        configurable: true,
        writable: true,
      });

      vi.advanceTimersByTime(50);

      expect(newBody.classList.contains('poexd-pure-bg')).toBe(true);
    } finally {
      Object.defineProperty(document, 'body', {
        value: origBody,
        configurable: true,
        writable: true,
      });
    }
  });
});
