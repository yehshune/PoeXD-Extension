import { describe, expect, it, vi } from 'vitest';
import {
  createLiveSearchDesktopNotifier,
  type DesktopNotificationConstructor,
  type DesktopNotificationInstance,
} from '@/entrypoints/content/logic/live-search-desktop-notifier';

function createFakeNotificationCtor(initialPermission: NotificationPermission = 'granted') {
  const created: Array<{
    title: string;
    options?: NotificationOptions;
    instance: DesktopNotificationInstance & { closed: boolean };
  }> = [];
  let permission: NotificationPermission = initialPermission;
  let requestResult: NotificationPermission = initialPermission;

  class FakeNotification implements DesktopNotificationInstance {
    static get permission(): NotificationPermission {
      return permission;
    }
    static async requestPermission(): Promise<NotificationPermission> {
      permission = requestResult;
      return permission;
    }
    onclick: ((ev: Event) => unknown) | null = null;
    closed = false;
    constructor(title: string, options?: NotificationOptions) {
      created.push({ title, options, instance: this });
    }
    close() {
      this.closed = true;
    }
  }

  return {
    ctor: FakeNotification as unknown as DesktopNotificationConstructor,
    created,
    setPermission(next: NotificationPermission) {
      permission = next;
    },
    setRequestResult(next: NotificationPermission) {
      requestResult = next;
    },
  };
}

describe('LiveSearchDesktopNotifier', () => {
  it('依監聽物品各自維護一張通知卡：同物品重彈會先關閉舊卡並換新 tag，不同物品互不覆蓋', () => {
    const fake = createFakeNotificationCtor('granted');
    let enabled = true;
    let background = true;
    let nextTimerId = 1;
    const timers = new Map<number, () => void>();
    const focusSpy = vi.fn();

    const flushAll = () => {
      const fns = Array.from(timers.values());
      timers.clear();
      for (const fn of fns) fn();
    };

    const notifier = createLiveSearchDesktopNotifier({
      version: 'poe1',
      isEnabled: () => enabled,
      isBackground: () => background,
      onFocusConsole: focusSpy,
      getNotificationCtor: () => fake.ctor,
      schedule: (fn) => {
        const id = nextTimerId++;
        timers.set(id, fn);
        return id as unknown as ReturnType<typeof setTimeout>;
      },
      cancelSchedule: (id) => {
        timers.delete(id as unknown as number);
      },
    });

    // 前景時不發送
    background = false;
    notifier.notify({ ownerKey: 'k-amulet', sourceName: '琥珀護身符' });
    expect(timers.size).toBe(0);

    // 關閉時不發送
    background = true;
    enabled = false;
    notifier.notify({ ownerKey: 'k-amulet', sourceName: '琥珀護身符' });
    expect(timers.size).toBe(0);

    // 同物品短時間命中兩次 → 合併成一張通知卡
    enabled = true;
    notifier.notify({ ownerKey: 'k-amulet', sourceName: '琥珀護身符' });
    notifier.notify({ ownerKey: 'k-amulet', sourceName: '琥珀護身符' });
    expect(fake.created).toHaveLength(0);
    flushAll();
    expect(fake.created).toHaveLength(1);
    expect(fake.created[0].options?.body).toContain('琥珀護身符');
    expect(fake.created[0].options?.body).toContain('2');

    // 不同物品命中 → 各自保留一張卡片，不關閉第一個物品的通知卡
    notifier.notify({ ownerKey: 'k-armour', sourceName: '皇家之鎧' });
    flushAll();
    expect(fake.created).toHaveLength(2);
    expect(fake.created[0].instance.closed).toBe(false);
    expect(fake.created[1].options?.body).toContain('皇家之鎧');
    expect(fake.created[1].options?.tag).not.toBe(fake.created[0].options?.tag);

    // 同一個物品再次命中 → 先關閉它先前的卡片，並用新 tag 彈出新橫幅；另一物品卡片不受影響
    notifier.notify({ ownerKey: 'k-amulet', sourceName: '琥珀護身符' });
    flushAll();
    expect(fake.created).toHaveLength(3);
    expect(fake.created[0].instance.closed).toBe(true);
    expect(fake.created[1].instance.closed).toBe(false);
    expect(fake.created[2].options?.tag).not.toBe(fake.created[0].options?.tag);

    // 點擊通知會關閉並聚焦主控台
    fake.created[2].instance.onclick?.(new Event('click'));
    expect(fake.created[2].instance.closed).toBe(true);
    expect(focusSpy).toHaveBeenCalledTimes(1);
  });

  it('test() 連續點擊會關閉前一張測試卡並換新 tag，權限不足或未支援時回傳對應原因', async () => {
    const fake = createFakeNotificationCtor('default');
    const notifier = createLiveSearchDesktopNotifier({
      version: 'poe2',
      isEnabled: () => false,
      isBackground: () => false,
      getNotificationCtor: () => fake.ctor,
    });

    expect(notifier.getPermission()).toBe('default');
    expect(notifier.test()).toEqual({ ok: false, reason: 'default' });

    fake.setRequestResult('granted');
    expect(await notifier.requestPermission()).toBe('granted');
    expect(notifier.test()).toEqual({ ok: true });
    expect(notifier.test()).toEqual({ ok: true });
    expect(fake.created).toHaveLength(2);
    expect(fake.created[0].instance.closed).toBe(true);
    expect(fake.created[1].instance.closed).toBe(false);
    expect(fake.created[1].options?.tag).not.toBe(fake.created[0].options?.tag);

    fake.setPermission('denied');
    expect(notifier.test()).toEqual({ ok: false, reason: 'denied' });

    const unsupported = createLiveSearchDesktopNotifier({
      version: 'poe1',
      isEnabled: () => true,
      getNotificationCtor: () => null,
    });
    expect(unsupported.getPermission()).toBe('unsupported');
    expect(unsupported.test()).toEqual({ ok: false, reason: 'unsupported' });
  });

  it('dispose 會取消所有待發送排程並關閉全部開啟中的通知卡', () => {
    const fake = createFakeNotificationCtor('granted');
    const cancelSpy = vi.fn();
    let nextId = 10;
    const pending: Array<() => void> = [];
    const notifier = createLiveSearchDesktopNotifier({
      version: 'poe1',
      isEnabled: () => true,
      isBackground: () => true,
      getNotificationCtor: () => fake.ctor,
      schedule: (fn) => {
        pending.push(fn);
        return nextId++ as unknown as ReturnType<typeof setTimeout>;
      },
      cancelSchedule: cancelSpy,
    });

    notifier.test();
    notifier.notify({ ownerKey: 'k-1', sourceName: 'A' });
    notifier.notify({ ownerKey: 'k-2', sourceName: 'B' });
    notifier.dispose();

    expect(cancelSpy).toHaveBeenCalledTimes(2);
    expect(fake.created[0].instance.closed).toBe(true);
    for (const fn of pending) fn();
    expect(fake.created).toHaveLength(1);
  });
});
