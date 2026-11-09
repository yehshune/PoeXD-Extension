// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createLiveSearchPrimaryExitGuard,
  type LiveSearchPrimaryExitGuard,
} from '@/entrypoints/content/logic/live-search-primary-exit-guard';
import { createLiveSearchPrimaryController } from '@/entrypoints/content/logic/live-search-primary-controller';
import { LiveSearchPrimaryRuntime } from '@/entrypoints/content/logic/live-search-primary-runtime';
import type {
  EnsureContainerOptions,
  HostCommandOutcome,
  ILiveSearchHostClient,
  RenderResultOptions,
  ResetUnreadOptions,
} from '@/entrypoints/content/logic/live-search-host-client';

class FakeHostClient implements ILiveSearchHostClient {
  public async ensureContainer(_options: EnsureContainerOptions): Promise<HostCommandOutcome> {
    return { success: true };
  }
  public async renderResult(_options: RenderResultOptions): Promise<HostCommandOutcome> {
    return { success: true };
  }
  public async resetUnread(_options: ResetUnreadOptions): Promise<HostCommandOutcome> {
    return { success: true };
  }
  public dispose(): void {}
}

class FakeWindow {
  private listeners = new Map<string, Set<(event: any) => void>>();

  public addEventListener(type: string, listener: (event: any) => void): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
  }

  public removeEventListener(type: string, listener: (event: any) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  public dispatchEvent(event: { type: string; [key: string]: any }): boolean {
    const set = this.listeners.get(event.type);
    if (!set) return true;
    for (const listener of Array.from(set)) {
      listener(event);
    }
    return !event.defaultPrevented;
  }

  public getListenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

describe('LiveSearch Primary Exit Guard Contract Tests', () => {
  describe('1. Deep Module & Architecture Boundary Inspection', () => {
    it('ensures live-search-primary-exit-guard NEVER imports Runtime, Bookmark, Coordinator, or Vue', () => {
      const filePath = resolve(
        process.cwd(),
        'entrypoints/content/logic/live-search-primary-exit-guard.ts',
      );
      const content = readFileSync(filePath, 'utf-8');

      expect(content).not.toMatch(/from\s+['"].*live-search-primary-runtime['"]/);
      expect(content).not.toMatch(/from\s+['"].*bookmark.*['"]/);
      expect(content).not.toMatch(/from\s+['"].*coordinator.*['"]/);
      expect(content).not.toMatch(/from\s+['"].*vue.*['"]/);
      expect(content).not.toMatch(/from\s+['"].*sidebar.*['"]/);
      expect(content).not.toContain('LiveSearchPrimaryRuntime');
      expect(content).not.toContain('Bookmark');
      expect(content).not.toContain('Coordinator');
    });
  });

  describe('2. Primary with Subscription (Warning Triggered)', () => {
    it('sets preventDefault and returnValue on beforeunload when shouldWarn is true', () => {
      const mockWin = new FakeWindow() as unknown as Window;
      const guard = createLiveSearchPrimaryExitGuard({
        shouldWarn: () => true,
        targetWindow: mockWin,
      });

      const event: any = {
        type: 'beforeunload',
        defaultPrevented: false,
        returnValue: undefined,
        preventDefault() {
          this.defaultPrevented = true;
        },
      };

      mockWin.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(event.returnValue).toBe('');

      guard.dispose();
    });
  });

  describe('3. Primary without Subscription (No Warning)', () => {
    it('does not preventDefault or modify returnValue when shouldWarn is false', () => {
      const mockWin = new FakeWindow() as unknown as Window;
      const guard = createLiveSearchPrimaryExitGuard({
        shouldWarn: () => false,
        targetWindow: mockWin,
      });

      const event: any = {
        type: 'beforeunload',
        defaultPrevented: false,
        returnValue: undefined,
        preventDefault() {
          this.defaultPrevented = true;
        },
      };

      mockWin.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
      expect(event.returnValue).toBeUndefined();

      guard.dispose();
    });
  });

  describe('4. Dynamic State Tracking & Controller Integration', () => {
    it('dynamically adapts warning state as subscriptions are added and removed', async () => {
      const mockWin = new FakeWindow() as unknown as Window;
      const hostClient = new FakeHostClient();
      const runtime = new LiveSearchPrimaryRuntime('poe1', {
        hostClient,
        webSocketFactory: () => ({ close: () => {} }) as any,
      });
      const controller = createLiveSearchPrimaryController(runtime);

      // Warning predicate directly reads live controller snapshot
      const guard = createLiveSearchPrimaryExitGuard({
        shouldWarn: () => controller.read().subscriptions.length > 0,
        targetWindow: mockWin,
      });

      const createEvent = (): any => ({
        type: 'beforeunload',
        defaultPrevented: false,
        returnValue: undefined,
        preventDefault() {
          this.defaultPrevented = true;
        },
      });

      // 1. Initial state: 0 subscriptions -> No warning
      let ev = createEvent();
      mockWin.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(false);

      // 2. Add subscription -> Warning enabled
      const addOutcome = await controller.addFromUrl(
        'https://www.pathofexile.com/trade/search/Standard/cluster_test',
        { name: '測試訂閱' },
      );
      expect(addOutcome.success).toBe(true);
      expect(controller.read().subscriptions).toHaveLength(1);

      ev = createEvent();
      mockWin.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(true);
      expect(ev.returnValue).toBe('');

      // 3. Remove subscription -> Warning disabled
      const subId = controller.read().subscriptions[0].id;
      controller.remove(subId);
      expect(controller.read().subscriptions).toHaveLength(0);

      ev = createEvent();
      mockWin.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(false);

      guard.dispose();
      runtime.dispose();
    });
  });

  describe('5. Dispose & Cleanup Idempotence', () => {
    it('removes listener on dispose and does not block subsequent beforeunload events', () => {
      const mockWin = new FakeWindow() as unknown as Window;
      const guard = createLiveSearchPrimaryExitGuard({
        shouldWarn: () => true,
        targetWindow: mockWin,
      });

      expect((mockWin as unknown as FakeWindow).getListenerCount('beforeunload')).toBe(1);

      guard.dispose();
      expect((mockWin as unknown as FakeWindow).getListenerCount('beforeunload')).toBe(0);

      const event: any = {
        type: 'beforeunload',
        defaultPrevented: false,
        returnValue: undefined,
        preventDefault() {
          this.defaultPrevented = true;
        },
      };

      mockWin.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);

      // Idempotent: repeated dispose call does not throw or misbehave
      expect(() => guard.dispose()).not.toThrow();
    });
  });

  describe('6. Cancel Leave Safety (No Destructive Side Effects on Warning)', () => {
    it('does not dispose runtime, close websockets, or mutate subscriptions when beforeunload fires', async () => {
      const mockWin = new FakeWindow() as unknown as Window;
      let wsClosed = false;
      const runtime = new LiveSearchPrimaryRuntime('poe1', {
        hostClient: new FakeHostClient(),
        webSocketFactory: () =>
          ({
            close: () => {
              wsClosed = true;
            },
          }) as any,
      });
      const controller = createLiveSearchPrimaryController(runtime);

      await controller.addFromUrl('https://www.pathofexile.com/trade/search/Standard/cluster_safe');
      expect(controller.read().subscriptions).toHaveLength(1);

      const guard = createLiveSearchPrimaryExitGuard({
        shouldWarn: () => controller.read().subscriptions.length > 0,
        targetWindow: mockWin,
      });

      // User triggers beforeunload (e.g. clicks refresh or close tab)
      const event: any = {
        type: 'beforeunload',
        defaultPrevented: false,
        returnValue: undefined,
        preventDefault() {
          this.defaultPrevented = true;
        },
      };
      mockWin.dispatchEvent(event);

      // Warning prompt was issued
      expect(event.defaultPrevented).toBe(true);

      // If user chooses "Cancel / Stay on page":
      // Runtime MUST NOT be disposed, subscriptions MUST remain intact, WebSocket MUST NOT be closed!
      expect(runtime.isDisposed()).toBe(false);
      expect(controller.read().subscriptions).toHaveLength(1);
      expect(wsClosed).toBe(false);

      guard.dispose();
      runtime.dispose();
    });
  });

  describe('7. Composition Root Contract in runtime.ts', () => {
    it('verifies runtime.ts only creates exit guard for live-search-primary role', () => {
      const filePath = resolve(process.cwd(), 'entrypoints/content/logic/runtime.ts');
      const content = readFileSync(filePath, 'utf-8');

      // 確保 exit guard 僅在 pageRole === 'live-search-primary' 分支中被建立
      const primaryBranchMatch = content.match(
        /if\s*\(\s*pageRole\s*===\s*['"]live-search-primary['"]\s*\)\s*\{[\s\S]*?createLiveSearchPrimaryExitGuard[\s\S]*?\}/,
      );
      expect(primaryBranchMatch).not.toBeNull();

      // 確保在 cleanupAll 中有主動 dispose activeExitGuard
      expect(content).toContain('activeExitGuard.dispose()');
    });
  });
});
