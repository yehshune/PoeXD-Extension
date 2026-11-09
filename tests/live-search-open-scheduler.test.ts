import { describe, expect, it, vi } from 'vitest';
import { LiveSearchOpenScheduler } from '@/entrypoints/content/logic/live-search-open-scheduler';

describe('LiveSearchOpenScheduler Tests', () => {
  it('serializes open tasks with cooldown delay between each execution', async () => {
    const sleepCalls: number[] = [];
    const executionOrder: string[] = [];

    const fakeSleep = async (ms: number) => {
      sleepCalls.push(ms);
      await Promise.resolve();
    };

    const scheduler = new LiveSearchOpenScheduler({
      cooldownMs: 1500,
      sleep: fakeSleep,
    });

    scheduler.enqueue(() => {
      executionOrder.push('task1');
    });
    scheduler.enqueue(() => {
      executionOrder.push('task2');
    });
    scheduler.enqueue(() => {
      executionOrder.push('task3');
    });

    // 等待微任務完成
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(executionOrder).toEqual(['task1', 'task2', 'task3']);
    expect(sleepCalls).toEqual([1500, 1500, 1500]);
  });

  it('drops remaining queue and prevents future enqueues when disposed', async () => {
    const executionOrder: string[] = [];
    let resolveSleep: () => void = () => {};

    const controllableSleep = () =>
      new Promise<void>((resolve) => {
        resolveSleep = resolve;
      });

    const scheduler = new LiveSearchOpenScheduler({
      cooldownMs: 1500,
      sleep: controllableSleep,
    });

    scheduler.enqueue(() => {
      executionOrder.push('task1');
    });
    scheduler.enqueue(() => {
      executionOrder.push('task2');
    });

    await Promise.resolve();
    expect(executionOrder).toEqual(['task1']);

    // 在冷卻中 dispose
    scheduler.dispose();

    // 嘗試在 dispose 後再 enqueue
    scheduler.enqueue(() => {
      executionOrder.push('task3');
    });

    // 釋放 sleep
    resolveSleep();
    await Promise.resolve();

    // task2 與 task3 不應被執行
    expect(executionOrder).toEqual(['task1']);
  });

  it('isolates errors inside tasks and continues queue execution', async () => {
    const executed: string[] = [];
    const scheduler = new LiveSearchOpenScheduler({
      cooldownMs: 0,
      sleep: () => Promise.resolve(),
    });

    scheduler.enqueue(() => {
      executed.push('first');
      throw new Error('Exploding open task');
    });
    scheduler.enqueue(() => {
      executed.push('second');
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(executed).toEqual(['first', 'second']);
  });
});
