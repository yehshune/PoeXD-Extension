// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import LiveSearchConsoleSettingsPane from '@/components/sidebar/LiveSearchConsoleSettingsPane.vue';
import {
  createLiveSearchSoundNotifier,
  OFFICIAL_CUSTOM_SOUND_MAX_BYTES,
  type LiveSearchSoundNotifier,
} from '@/entrypoints/content/logic/live-search-sound-notifier';
import { DEFAULT_PREFERENCES, type Preferences, type PreferencesModule } from '@/utils/preferences';

let app: App | undefined;

afterEach(() => {
  app?.unmount();
  app = undefined;
  vi.restoreAllMocks();
});

function createFakePreferences(): PreferencesModule {
  let state: Preferences = { ...DEFAULT_PREFERENCES };
  const listeners = new Set<(snapshot: Readonly<Preferences>) => void>();
  return {
    read: () => state,
    update: async (patch) => {
      state = { ...state, ...patch };
      for (const listener of listeners) listener(state);
      return { ok: true, changed: true };
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function mountPane(soundNotifier: LiveSearchSoundNotifier) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  app = createApp(LiveSearchConsoleSettingsPane, {
    preferences: createFakePreferences(),
    soundNotifier,
  });
  app.mount(container);
  return {
    container,
    cleanup: () => {
      app?.unmount();
      app = undefined;
      container.remove();
    },
  };
}

function createFakeAudio() {
  return {
    src: 'https://web.poecdn.com/audio/trade/pulse.mp3',
    currentTime: 0,
    volume: 1,
    playCalls: 0,
    pause() {},
    async play() {
      this.playCalls += 1;
    },
  };
}

describe('LiveSearchConsoleSettingsPane 官方音量與音效設定', () => {
  it('音量滑桿拖動過程不寫入 storage，放開（change）才寫入一次並試聽；寫入失敗時保留錯誤訊息', async () => {
    const audio = createFakeAudio();
    const storage = new Map<string, string>([
      ['lscache-tradewoop', JSON.stringify({ file: 'audio/trade/pulse.mp3', volume: 33 })],
    ]);
    let failWrite = false;
    let writeCalls = 0;
    const notifier = createLiveSearchSoundNotifier({
      version: 'poe1',
      isEnabled: () => true,
      findAudio: () => audio as unknown as HTMLAudioElement,
      readStorage: (key) => storage.get(key) ?? null,
      writeStorage: (key, value) => {
        writeCalls += 1;
        if (failWrite) throw new Error('quota');
        storage.set(key, value);
      },
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { container, cleanup } = mountPane(notifier);
    await nextTick();

    const slider = container.querySelector<HTMLInputElement>(
      '[data-test="official-sound-volume"]',
    )!;
    const label = container.querySelector('[data-test="official-sound-volume-value"]')!;
    expect(slider.step).toBe('1');
    expect(slider.value).toBe('33');
    expect(label.textContent?.trim()).toBe('33%');

    // 連續拖動多次 input → 只更新畫面顯示，不寫入 storage
    for (const v of ['40', '50', '60']) {
      slider.value = v;
      slider.dispatchEvent(new Event('input'));
    }
    await nextTick();
    expect(label.textContent?.trim()).toBe('60%');
    expect(writeCalls).toBe(0);
    expect(audio.playCalls).toBe(0);

    // 放開滑桿觸發 change → 寫入一次並自動試聽
    slider.dispatchEvent(new Event('change'));
    await nextTick();
    expect(writeCalls).toBe(1);
    expect(audio.playCalls).toBe(1);

    // 寫入失敗 → 顯示錯誤訊息且不觸發試聽
    failWrite = true;
    slider.value = '80';
    slider.dispatchEvent(new Event('input'));
    slider.dispatchEvent(new Event('change'));
    await nextTick();
    expect(writeCalls).toBe(2);
    expect(audio.playCalls).toBe(1);
    expect(container.querySelector('[data-test="sound-preview-message"]')?.textContent).toContain(
      '無法寫入官方音效設定',
    );

    cleanup();
  });

  it('自訂音效上傳會檢查檔案上限與格式，合法音檔寫入並試聽', async () => {
    const audio = createFakeAudio();
    const storage = new Map<string, string>();
    const notifier = createLiveSearchSoundNotifier({
      version: 'poe1',
      isEnabled: () => true,
      findAudio: () => audio as unknown as HTMLAudioElement,
      readStorage: (key) => storage.get(key) ?? null,
      writeStorage: (key, value) => {
        storage.set(key, value);
      },
    });

    const { container, cleanup } = mountPane(notifier);
    await nextTick();

    const fileInput = container.querySelector<HTMLInputElement>(
      '[data-test="input-sound-upload"]',
    )!;

    // 超過 1 MB 拒絕
    const hugeFile = new File([new Uint8Array(OFFICIAL_CUSTOM_SOUND_MAX_BYTES + 1)], 'big.mp3', {
      type: 'audio/mpeg',
    });
    Object.defineProperty(fileInput, 'files', { value: [hugeFile], configurable: true });
    fileInput.dispatchEvent(new Event('change'));
    await nextTick();
    expect(container.querySelector('[data-test="sound-preview-message"]')?.textContent).toContain(
      '1 MB',
    );
    expect(audio.playCalls).toBe(0);

    // 非音訊格式拒絕
    const textFile = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    Object.defineProperty(fileInput, 'files', { value: [textFile], configurable: true });
    fileInput.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 30));
    expect(container.querySelector('[data-test="sound-preview-message"]')?.textContent).toContain(
      '不支援的音訊檔案格式',
    );

    // 合法音訊檔成功寫入並試聽
    const audioFile = new File(['fake-mp3'], 'ding.mp3', { type: 'audio/mpeg' });
    Object.defineProperty(fileInput, 'files', { value: [audioFile], configurable: true });
    fileInput.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 30));
    expect(audio.src.startsWith('data:audio/')).toBe(true);
    expect(audio.playCalls).toBe(1);
    expect(container.querySelector('[data-test="official-sound-select"]')?.textContent).toContain(
      'ding.mp3',
    );

    cleanup();
  });

  it('其他分頁更新官方 localStorage 時透過 storage 事件同步介面顯示', async () => {
    const audio = createFakeAudio();
    const storage = new Map<string, string>([
      ['lscache-tradewoop', JSON.stringify({ file: 'audio/trade/pulse.mp3', volume: 50 })],
    ]);
    const notifier = createLiveSearchSoundNotifier({
      version: 'poe1',
      isEnabled: () => true,
      findAudio: () => audio as unknown as HTMLAudioElement,
      readStorage: (key) => storage.get(key) ?? null,
      writeStorage: (key, value) => {
        storage.set(key, value);
      },
    });

    const { container, cleanup } = mountPane(notifier);
    await nextTick();
    expect(
      container.querySelector('[data-test="official-sound-volume-value"]')?.textContent?.trim(),
    ).toBe('50%');

    storage.set(
      'lscache-tradewoop',
      JSON.stringify({ file: 'audio/trade/gong.mp3', volume: 85, custom: false }),
    );
    window.dispatchEvent(new StorageEvent('storage', { key: 'lscache-tradewoop' }));
    await nextTick();

    expect(
      container.querySelector('[data-test="official-sound-volume-value"]')?.textContent?.trim(),
    ).toBe('85%');
    expect(container.querySelector('[data-test="official-sound-select"]')?.textContent).toContain(
      'Gong',
    );

    cleanup();
  });
});
