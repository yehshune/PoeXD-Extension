import { describe, expect, it } from 'vitest';
import { createInitialPageLoadSignal } from '@/utils/initial-page-load-signal';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createInitialPageLoadSignal', () => {
  it('標記前不會 resolve，標記後所有等待者都會 resolve', async () => {
    const signal = createInitialPageLoadSignal();
    let early = false;
    void signal.wait().then(() => {
      early = true;
    });
    await flush();
    expect(early).toBe(false);
    expect(signal.isLoaded()).toBe(false);

    signal.markLoaded();
    await flush();
    expect(early).toBe(true);
    expect(signal.isLoaded()).toBe(true);
  });

  it('標記後才開始等待也會立即 resolve，重複標記無副作用', async () => {
    const signal = createInitialPageLoadSignal();
    signal.markLoaded();
    signal.markLoaded();
    let late = false;
    void signal.wait().then(() => {
      late = true;
    });
    await flush();
    expect(late).toBe(true);
  });
});
