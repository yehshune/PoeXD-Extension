import { describe, expect, it, vi } from 'vitest';
import { createContentPageRuntime } from '@/entrypoints/content/logic/runtime';
import { DEFAULT_PREFERENCES, type PreferencesLoadOutcome } from '@/utils/preferences';
import { createDeferred, createFakeRuntimeHarness } from './helpers/content-page-runtime-harness';

describe('ContentPageRuntime', () => {
  it('aborts before injecting interceptor or reading preferences on Cloudflare challenge pages', async () => {
    const h = createFakeRuntimeHarness({
      isCloudflareChallenge: vi.fn(() => true),
    });
    const runtime = createContentPageRuntime({ ctx: h.ctx, version: 'poe1', deps: h.deps });

    await runtime.start();

    expect(h.deps.injectApiInterceptor).not.toHaveBeenCalled();
    expect(h.deps.startPoeEventBuffer).not.toHaveBeenCalled();
    expect(h.deps.getPreferences).not.toHaveBeenCalled();
    expect(h.deps.initToastHost).not.toHaveBeenCalled();
    expect(h.ctx.onCleanup).not.toHaveBeenCalled();
  });

  it('starts early-event buffering before getPreferences and releases it only after mountSidebarLayout', async () => {
    const h = createFakeRuntimeHarness();
    h.pageLoadGateDeferred.resolve();
    const runtime = createContentPageRuntime({ ctx: h.ctx, version: 'poe1', deps: h.deps });

    await runtime.start();

    const bufferStartIdx = h.order.indexOf('start:earlyBuffer');
    const getPrefsIdx = h.order.indexOf('get:preferences');
    const mountSidebarIdx = h.order.indexOf('mount:sidebar');
    const bufferReleaseIdx = h.order.indexOf('release:earlyBuffer');

    expect(bufferStartIdx).toBeGreaterThanOrEqual(0);
    expect(bufferStartIdx).toBeLessThan(getPrefsIdx);
    expect(mountSidebarIdx).toBeLessThan(bufferReleaseIdx);
    expect(h.cleanups.earlyBufferRelease).toHaveBeenCalledTimes(1);

    // Subsequent dispose does not double-release the already-released early buffer
    runtime.dispose();
    expect(h.cleanups.earlyBufferRelease).toHaveBeenCalledTimes(1);
  });

  it('isolates normal vs live-search-primary TradePageRole behavior and prewarm lifecycle', async () => {
    // 1. Normal role: waits for pageLoadGate, enables ResultBoard, runs 2-stage idle prewarm
    const normal = createFakeRuntimeHarness();
    const normalRuntime = createContentPageRuntime({
      ctx: normal.ctx,
      version: 'poe1',
      deps: normal.deps,
    });

    const normalStart = normalRuntime.start();
    await vi.waitFor(() => {
      expect(normal.deps.mountSidebarLayout).toHaveBeenCalledTimes(1);
    });
    expect(normal.deps.markInitialPageLoadLoaded).not.toHaveBeenCalled();
    expect(normal.deps.createLiveSearchPrimarySession).not.toHaveBeenCalled();
    expect(normal.resultBoard.setEnabled).toHaveBeenLastCalledWith(
      DEFAULT_PREFERENCES.sidebarModuleResultBoard,
    );
    expect(normal.filterEnhancements.setSendToConsoleEnabled).toHaveBeenLastCalledWith(
      DEFAULT_PREFERENCES.sidebarModuleLiveSearch,
    );

    normal.preferences.emit({ sidebarModuleLiveSearch: false });
    await vi.waitFor(() => {
      expect(normal.filterEnhancements.setSendToConsoleEnabled).toHaveBeenLastCalledWith(false);
    });

    normal.pageLoadGateDeferred.resolve();
    await normalStart;

    expect(normal.deps.markInitialPageLoadLoaded).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(normal.idleCallbacks).toHaveLength(1);
    });
    normal.idleCallbacks[0].cb();
    expect(normal.deps.getHydratedModsByGroup).toHaveBeenCalledWith('poe1');
    expect(normal.idleCallbacks).toHaveLength(2);
    normal.idleCallbacks[1].cb();
    expect(normal.deps.markAffixSelectorPrewarmed).toHaveBeenCalledTimes(1);

    // 2. LiveSearch Primary role: resultBoard stays false even after preference updates,
    //    creates/disposes LiveSearchPrimarySession, cancels pageLoadGate, skips idle prewarm
    const primary = createFakeRuntimeHarness({
      getPageRole: vi.fn(async () => ({
        role: 'live-search-primary' as const,
        arrivalSignal: true,
      })),
    });
    const primaryRuntime = createContentPageRuntime({
      ctx: primary.ctx,
      version: 'poe2',
      deps: primary.deps,
    });

    await primaryRuntime.start();

    expect(primary.deps.createLiveSearchPrimarySession).toHaveBeenCalledTimes(1);
    expect(primary.pageLoadGate.cancel).toHaveBeenCalledTimes(1);
    expect(primary.deps.markInitialPageLoadLoaded).toHaveBeenCalledTimes(1);
    expect(primary.resultBoard.setEnabled).toHaveBeenLastCalledWith(false);

    // Turning ResultBoard preference on later must NOT enable ResultBoard on live-search-primary
    primary.resultBoard.setEnabled.mockClear();
    primary.preferences.emit({ sidebarModuleResultBoard: true });
    await vi.waitFor(() => {
      expect(primary.resultBoard.setEnabled).toHaveBeenCalledTimes(1);
    });
    expect(primary.resultBoard.setEnabled).toHaveBeenCalledWith(false);
    expect(primary.idleCallbacks).toHaveLength(0);

    primaryRuntime.dispose();
    expect(primary.cleanups.liveSearchDispose).toHaveBeenCalledTimes(1);

    // 3. getPageRole failure falls back to normal
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fallback = createFakeRuntimeHarness({
      getPageRole: vi.fn(async () => {
        throw new Error('background unreachable');
      }),
    });
    fallback.pageLoadGateDeferred.resolve();
    const fallbackRuntime = createContentPageRuntime({
      ctx: fallback.ctx,
      version: 'poe1',
      deps: fallback.deps,
    });
    await fallbackRuntime.start();
    expect(fallback.resultPipeline.setPageRole).toHaveBeenCalledWith('normal');
    expect(fallback.deps.createLiveSearchPrimarySession).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('cleans up late-resolving resources and stops downstream phases when disposed mid-flight', async () => {
    // 1. Dispose while awaiting getPreferences
    const prefsDeferred = createDeferred<PreferencesLoadOutcome>();
    const hPrefs = createFakeRuntimeHarness({
      getPreferences: vi.fn(() => prefsDeferred.promise),
    });
    const rtPrefs = createContentPageRuntime({
      ctx: hPrefs.ctx,
      version: 'poe1',
      deps: hPrefs.deps,
    });
    const startPrefs = rtPrefs.start();
    await vi.waitFor(() => {
      expect(hPrefs.deps.getPreferences).toHaveBeenCalledTimes(1);
    });
    rtPrefs.dispose();
    prefsDeferred.resolve({ ok: true, value: hPrefs.preferences.module });
    await startPrefs;
    expect(hPrefs.deps.connectSearchObservationSession).not.toHaveBeenCalled();
    expect(hPrefs.cleanups.earlyBufferRelease).toHaveBeenCalledTimes(1);

    // 2. Dispose while awaiting connectSearchObservationSession (late cleanup must still run)
    const searchSessionDeferred = createDeferred<() => void>();
    const lateSearchSessionCleanup = vi.fn();
    const hSession = createFakeRuntimeHarness({
      connectSearchObservationSession: vi.fn(() => searchSessionDeferred.promise),
    });
    const rtSession = createContentPageRuntime({
      ctx: hSession.ctx,
      version: 'poe1',
      deps: hSession.deps,
    });
    const startSession = rtSession.start();
    await vi.waitFor(() => {
      expect(hSession.deps.connectSearchObservationSession).toHaveBeenCalledTimes(1);
    });
    rtSession.dispose();
    searchSessionDeferred.resolve(lateSearchSessionCleanup);
    await startSession;
    expect(lateSearchSessionCleanup).toHaveBeenCalledTimes(1);
    expect(hSession.deps.whenTradePageReady).not.toHaveBeenCalled();

    // 3. Dispose while awaiting interceptorReady
    const interceptorDeferred = createDeferred<void>();
    const hInterceptor = createFakeRuntimeHarness({
      injectApiInterceptor: vi.fn(() => interceptorDeferred.promise),
    });
    const rtInterceptor = createContentPageRuntime({
      ctx: hInterceptor.ctx,
      version: 'poe1',
      deps: hInterceptor.deps,
    });
    const startInterceptor = rtInterceptor.start();
    await vi.waitFor(() => {
      expect(hInterceptor.deps.whenTradePageReady).toHaveBeenCalledTimes(1);
    });
    rtInterceptor.dispose();
    interceptorDeferred.resolve();
    await startInterceptor;
    expect(hInterceptor.deps.getPageRole).not.toHaveBeenCalled();

    // 4. Dispose while awaiting getPageRole
    const roleDeferred = createDeferred<{ role: 'normal'; arrivalSignal: boolean }>();
    const hRole = createFakeRuntimeHarness({
      getPageRole: vi.fn(() => roleDeferred.promise),
    });
    const rtRole = createContentPageRuntime({
      ctx: hRole.ctx,
      version: 'poe1',
      deps: hRole.deps,
    });
    const startRole = rtRole.start();
    await vi.waitFor(() => {
      expect(hRole.deps.getPageRole).toHaveBeenCalledTimes(1);
    });
    rtRole.dispose();
    roleDeferred.resolve({ role: 'normal', arrivalSignal: false });
    await startRole;
    expect(hRole.deps.mountSidebarLayout).not.toHaveBeenCalled();
    expect(hRole.resultPipeline.init).not.toHaveBeenCalled();

    // 5. Dispose while awaiting mountSidebarLayout + reserveSidebarPageLayout
    const mountDeferred = createDeferred<() => void>();
    const reserveDeferred = createDeferred<() => void>();
    const lateMountCleanup = vi.fn();
    const lateReserveCleanup = vi.fn();

    const hMount = createFakeRuntimeHarness({
      mountSidebarLayout: vi.fn(() => mountDeferred.promise),
      reserveSidebarPageLayout: vi.fn(() => reserveDeferred.promise),
    });
    const rtMount = createContentPageRuntime({
      ctx: hMount.ctx,
      version: 'poe1',
      deps: hMount.deps,
    });

    const startMount = rtMount.start();
    await vi.waitFor(() => {
      expect(hMount.deps.mountSidebarLayout).toHaveBeenCalledTimes(1);
    });

    rtMount.dispose();
    mountDeferred.resolve(lateMountCleanup);
    reserveDeferred.resolve(lateReserveCleanup);
    await startMount;

    expect(lateMountCleanup).toHaveBeenCalledTimes(1);
    expect(lateReserveCleanup).toHaveBeenCalledTimes(1);
    expect(hMount.filterEnhancements.initialize).not.toHaveBeenCalled();
    expect(hMount.deps.markInitialPageLoadLoaded).not.toHaveBeenCalled();
    expect(hMount.cleanups.earlyBufferRelease).toHaveBeenCalledTimes(1);

    // 6. Dispose while waiting on pageLoadGate.ready resolves start() without hanging
    const hGate = createFakeRuntimeHarness();
    const rtGate = createContentPageRuntime({
      ctx: hGate.ctx,
      version: 'poe1',
      deps: hGate.deps,
    });
    const startGate = rtGate.start();
    await vi.waitFor(() => {
      expect(hGate.filterEnhancements.initialize).toHaveBeenCalledTimes(1);
    });
    rtGate.dispose();
    await startGate;
    expect(hGate.pageLoadGate.cancel).toHaveBeenCalledTimes(1);
    expect(hGate.deps.markInitialPageLoadLoaded).not.toHaveBeenCalled();

    // 7. Dispose while waiting for whenTradePageReady resolves start() without hanging
    const hReady = createFakeRuntimeHarness({
      whenTradePageReady: vi.fn(() => hReady.cleanups.tradeReadyCleanup),
    });
    const rtReady = createContentPageRuntime({
      ctx: hReady.ctx,
      version: 'poe1',
      deps: hReady.deps,
    });
    const startReady = rtReady.start();
    await vi.waitFor(() => {
      expect(hReady.deps.whenTradePageReady).toHaveBeenCalledTimes(1);
    });
    rtReady.dispose();
    await startReady;
    expect(hReady.cleanups.tradeReadyCleanup).toHaveBeenCalledTimes(1);
    expect(hReady.deps.mountSidebarLayout).not.toHaveBeenCalled();
  });

  it('releases early events and marks initial page load on both pre-ready and post-ready failures', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // 1. Pre-ready failure: getPreferences returns error outcome
    const pre = createFakeRuntimeHarness({
      getPreferences: vi.fn(async () => ({
        ok: false as const,
        error: { code: 'unavailable' as const, message: 'storage down' },
      })),
    });
    const preRuntime = createContentPageRuntime({ ctx: pre.ctx, version: 'poe1', deps: pre.deps });
    await preRuntime.start();
    expect(pre.cleanups.earlyBufferRelease).toHaveBeenCalledTimes(1);
    expect(pre.deps.markInitialPageLoadLoaded).toHaveBeenCalledTimes(1);

    // 2. Post-ready failure: mountSidebarLayout throws inside initialize phase
    const post = createFakeRuntimeHarness({
      mountSidebarLayout: vi.fn(async () => {
        throw new Error('sidebar mount failed');
      }),
    });
    const postRuntime = createContentPageRuntime({
      ctx: post.ctx,
      version: 'poe1',
      deps: post.deps,
    });
    await postRuntime.start();
    expect(post.cleanups.earlyBufferRelease).toHaveBeenCalledTimes(1);
    expect(post.deps.markInitialPageLoadLoaded).toHaveBeenCalledTimes(1);

    errSpy.mockRestore();
  });

  it('wires page-context events, validates Live Trade Data, and removes listeners on dispose', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const validKnownStats = {
      'explicit.stat_1': { id: 'explicit.stat_1', text: '# to Life', type: 'explicit' },
    };
    const validStatLabels = { stats: {}, pseudoStats: {} };
    const h = createFakeRuntimeHarness({
      parsePoeLiveTradeData: vi.fn((detail: unknown) =>
        (detail as { valid?: boolean } | null)?.valid
          ? {
              knownStats: validKnownStats,
              filters: null,
              statLabels: validStatLabels,
            }
          : undefined,
      ),
    });
    h.pageLoadGateDeferred.resolve();
    const runtime = createContentPageRuntime({ ctx: h.ctx, version: 'poe1', deps: h.deps });
    await runtime.start();

    expect(h.deps.removeLegacyKnownStats).toHaveBeenCalledTimes(1);

    h.emitPageEvent('poexd-fetch-response', { result: [] });
    expect(h.resultPipeline.handleFetchResponse).toHaveBeenCalledWith({ result: [] }, 'Keepers');

    h.emitPageEvent(
      'poexd-search-result-summary',
      JSON.stringify({ searchId: 'abc123', total: 10, resultCount: 10, inexact: false }),
    );
    expect(h.resultPipeline.handleSearchResultSummary).toHaveBeenCalledWith('abc123');

    h.emitPageEvent('poexd-live-trade-data', { valid: false });
    expect(h.deps.setLiveTradeData).not.toHaveBeenCalled();

    h.emitPageEvent('poexd-live-trade-data', { valid: true });
    expect(h.deps.setKnownStats).toHaveBeenCalledWith(validKnownStats);
    expect(h.deps.setLiveTradeData).toHaveBeenCalledWith('poe1', {
      pageLocale: 'en',
      filters: null,
      statLabels: validStatLabels,
    });

    h.applyMarketSync({ statLabels: { 'explicit.stat_1': '生命' } });
    expect(h.deps.setMarketLiveTradeData).toHaveBeenCalledWith('poe1', {
      statLabels: { 'explicit.stat_1': '生命' },
    });

    runtime.dispose();
    expect(h.cleanups.marketSyncCleanup).toHaveBeenCalledTimes(1);
    expect(h.pageListeners.get('poexd-fetch-response')?.size ?? 0).toBe(0);
    expect(h.pageListeners.get('poexd-search-result-summary')?.size ?? 0).toBe(0);
    expect(h.pageListeners.get('poexd-live-trade-data')?.size ?? 0).toBe(0);
    warnSpy.mockRestore();
  });

  it('keeps start() and dispose() idempotent across repeated or pre-start calls', async () => {
    // Calling start() twice returns the same promise and only runs once
    const h1 = createFakeRuntimeHarness();
    h1.pageLoadGateDeferred.resolve();
    const rt1 = createContentPageRuntime({ ctx: h1.ctx, version: 'poe1', deps: h1.deps });
    const p1 = rt1.start();
    const p2 = rt1.start();
    expect(p1).toBe(p2);
    await p1;
    expect(h1.deps.getPreferences).toHaveBeenCalledTimes(1);

    rt1.dispose();
    rt1.dispose();
    expect(h1.cleanups.toastCleanup).toHaveBeenCalledTimes(1);

    // Calling dispose() before start() turns start() into a no-op
    const h2 = createFakeRuntimeHarness();
    const rt2 = createContentPageRuntime({ ctx: h2.ctx, version: 'poe1', deps: h2.deps });
    rt2.dispose();
    await rt2.start();
    expect(h2.deps.injectApiInterceptor).not.toHaveBeenCalled();
    expect(h2.deps.getPreferences).not.toHaveBeenCalled();
  });
});
