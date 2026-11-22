import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLiveSearchSoundNotifier,
  getOfficialSoundSettingKey,
  parseOfficialSoundSetting,
  parseOfficialSoundVolume,
  type LiveSearchSoundNotifierOptions,
} from '@/entrypoints/content/logic/live-search-sound-notifier';

class FakeAudio {
  src = 'https://web.poecdn.com/audio/trade/pulse.mp3';
  currentTime = 0;
  volume = 1;
  playCalls = 0;
  pauseCalls = 0;
  playImpl: () => Promise<void> = async () => {
    this.currentTime = 0.5;
  };
  play() {
    this.playCalls += 1;
    return this.playImpl();
  }
  pause() {
    this.pauseCalls += 1;
  }
}

function notAllowed() {
  return Object.assign(new Error('play() failed'), { name: 'NotAllowedError' });
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(overrides: Partial<LiveSearchSoundNotifierOptions> = {}) {
  const audio = new FakeAudio();
  const storage = new Map<string, string>();
  const target = new EventTarget();
  let clock = 1000;
  let enabled = true;
  const notifier = createLiveSearchSoundNotifier({
    version: 'poe1',
    isEnabled: () => enabled,
    findAudio: () => audio as unknown as HTMLAudioElement,
    readStorage: (key) => storage.get(key) ?? null,
    writeStorage: (key, value) => {
      storage.set(key, value);
    },
    activationTarget: target,
    now: () => clock,
    ...overrides,
  });
  return {
    audio,
    storage,
    target,
    notifier,
    advance: (ms: number) => {
      clock += ms;
    },
    setEnabled: (value: boolean) => {
      enabled = value;
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseOfficialSoundVolume', () => {
  it('讀取官方 lscache 的 volume', () => {
    expect(
      parseOfficialSoundVolume(
        JSON.stringify({ file: 'audio/trade/gong.mp3', volume: 30, custom: false }),
      ),
    ).toBe(30);
    expect(parseOfficialSoundVolume(JSON.stringify({ volume: 0 }))).toBe(0);
    expect(parseOfficialSoundVolume(JSON.stringify({ volume: 100 }))).toBe(100);
  });

  it('鍵不存在或值不合法時回官方預設 50', () => {
    for (const raw of [
      null,
      '',
      'not json',
      'null',
      '[1]',
      '"50"',
      JSON.stringify({ volume: '30' }),
      JSON.stringify({ volume: -1 }),
      JSON.stringify({ volume: 101 }),
      JSON.stringify({ volume: 12.5 }),
      JSON.stringify({}),
    ]) {
      expect(parseOfficialSoundVolume(raw)).toBe(50);
    }
  });

  it('PoE 1 與 PoE 2 使用各自的 lscache 鍵', () => {
    expect(getOfficialSoundSettingKey('poe1')).toBe('lscache-tradewoop');
    expect(getOfficialSoundSettingKey('poe2')).toBe('lscache-trade2woop');
  });
});

describe('LiveSearchSoundNotifier', () => {
  it('以官方音量播放官方 <audio>', async () => {
    const { audio, storage, notifier } = setup();
    storage.set('lscache-tradewoop', JSON.stringify({ volume: 30 }));

    notifier.notify();
    await flush();

    expect(audio.playCalls).toBe(1);
    expect(audio.volume).toBeCloseTo(0.3);
  });

  it('PoE 2 讀 trade2 的設定', async () => {
    const { audio, storage, notifier } = setup({ version: 'poe2' });
    storage.set('lscache-tradewoop', JSON.stringify({ volume: 90 }));
    storage.set('lscache-trade2woop', JSON.stringify({ volume: 20 }));

    notifier.notify();
    await flush();

    expect(audio.volume).toBeCloseTo(0.2);
  });

  it('合併視窗內只播一次，過了視窗再播', async () => {
    const { audio, notifier, advance } = setup();

    notifier.notify();
    advance(100);
    notifier.notify();
    advance(150);
    notifier.notify();
    await flush();
    expect(audio.playCalls).toBe(1);

    advance(300);
    notifier.notify();
    await flush();
    expect(audio.playCalls).toBe(2);
    expect(audio.pauseCalls).toBe(1);
    expect(audio.currentTime).toBe(0.5);
  });

  it('關閉時不播；開關即時生效', async () => {
    const { audio, notifier, setEnabled, advance } = setup();
    setEnabled(false);
    notifier.notify();
    await flush();
    expect(audio.playCalls).toBe(0);

    setEnabled(true);
    advance(1);
    notifier.notify();
    await flush();
    expect(audio.playCalls).toBe(1);
  });

  it('讀取偏好設定拋錯時視為關閉並記錄', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { audio, notifier } = setup({
      isEnabled: () => {
        throw new Error('storage gone');
      },
    });
    notifier.notify();
    await flush();
    expect(audio.playCalls).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('官方音量 0 時不播，與官方一致', async () => {
    const { audio, storage, notifier } = setup();
    storage.set('lscache-tradewoop', JSON.stringify({ volume: 0 }));
    notifier.notify();
    await flush();
    expect(audio.playCalls).toBe(0);
    expect(await notifier.preview()).toEqual({ ok: false, reason: 'muted' });
  });

  it('被瀏覽器擋下時進入 blocked，使用者互動後回到 ready，且不補播', async () => {
    const { audio, target, notifier } = setup();
    audio.playImpl = () => Promise.reject(notAllowed());
    const states: string[] = [];
    notifier.subscribe((s) => states.push(s));

    notifier.notify();
    await flush();
    expect(notifier.getState()).toBe('blocked');

    target.dispatchEvent(new Event('pointerdown'));
    expect(notifier.getState()).toBe('ready');
    expect(states).toEqual(['blocked', 'ready']);
    expect(audio.playCalls).toBe(1);

    // 監聽只掛一次，互動後已移除
    target.dispatchEvent(new Event('keydown'));
    expect(states).toEqual(['blocked', 'ready']);
  });

  it('被擋下後下一次播放成功也會回到 ready', async () => {
    const { audio, notifier, advance } = setup();
    audio.playImpl = () => Promise.reject(notAllowed());
    notifier.notify();
    await flush();
    expect(notifier.getState()).toBe('blocked');

    audio.playImpl = async () => {};
    advance(1000);
    expect(await notifier.preview()).toEqual({ ok: true });
    expect(notifier.getState()).toBe('ready');
  });

  it('找不到官方 <audio> 時不播並只記錄一次', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { notifier, advance } = setup({ findAudio: () => null });

    notifier.notify();
    advance(1000);
    notifier.notify();
    await flush();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(await notifier.preview()).toEqual({ ok: false, reason: 'missing' });
  });

  it('其他播放錯誤只記錄錯誤名稱，不進入 blocked', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { audio, notifier } = setup();
    audio.playImpl = () =>
      Promise.reject(
        Object.assign(new Error('secret data:audio/...'), { name: 'NotSupportedError' }),
      );

    expect(await notifier.preview()).toEqual({ ok: false, reason: 'error' });
    expect(notifier.getState()).toBe('ready');
    expect(String(warn.mock.calls[0][0])).toContain('NotSupportedError');
    expect(String(warn.mock.calls[0][0])).not.toContain('data:audio');
  });

  it('試聽略過開關與合併視窗', async () => {
    const { audio, notifier, setEnabled } = setup();
    setEnabled(false);
    notifier.notify();
    expect(await notifier.preview()).toEqual({ ok: true });
    expect(audio.playCalls).toBe(1);
  });

  it('dispose 之後不再播放，也不再監聽互動', async () => {
    const { audio, target, notifier } = setup();
    audio.playImpl = () => Promise.reject(notAllowed());
    notifier.notify();
    await flush();
    const listener = vi.fn();
    notifier.subscribe(listener);

    notifier.dispose();
    notifier.notify();
    target.dispatchEvent(new Event('pointerdown'));
    await flush();

    expect(audio.playCalls).toBe(1);
    expect(listener).not.toHaveBeenCalled();
  });

  it('updateOfficialVolume 寫回官方 lscache 並保留既有音效欄位', () => {
    const { storage, notifier } = setup();
    storage.set(
      'lscache-tradewoop',
      JSON.stringify({
        name: null,
        file: 'audio/trade/gong.mp3',
        volume: 20,
        custom: false,
        playOnLoad: false,
      }),
    );

    const outcome = notifier.updateOfficialVolume(75);
    expect(outcome).toEqual({
      ok: true,
      setting: { file: 'audio/trade/gong.mp3', volume: 75, custom: false, name: null },
    });
    expect(JSON.parse(storage.get('lscache-tradewoop')!)).toMatchObject({
      file: 'audio/trade/gong.mp3',
      volume: 75,
      custom: false,
      name: null,
      playOnLoad: false,
    });
    expect(notifier.updateOfficialVolume(150)).toEqual({
      ok: true,
      setting: { file: 'audio/trade/gong.mp3', volume: 100, custom: false, name: null },
    });
  });

  it('updateOfficialSound 可切換內建與自訂音效，保留原本區服 CDN origin', () => {
    const { audio, storage, notifier } = setup();
    audio.src = 'https://web.poecdn.tw/audio/trade/pulse.mp3';

    const piano = notifier.updateOfficialSound({
      file: 'audio/trade/piano.mp3',
      custom: false,
      name: null,
    });
    expect(piano.ok).toBe(true);
    expect(audio.src).toBe('https://web.poecdn.tw/audio/trade/piano.mp3');

    const custom = notifier.updateOfficialSound({
      file: 'data:audio/mp3;base64,AAAA',
      custom: true,
      name: 'alert.mp3',
    });
    expect(custom).toEqual({
      ok: true,
      setting: {
        file: 'data:audio/mp3;base64,AAAA',
        volume: 50,
        custom: true,
        name: 'alert.mp3',
      },
    });
    expect(audio.src).toBe('data:audio/mp3;base64,AAAA');
    expect(parseOfficialSoundSetting(storage.get('lscache-tradewoop') ?? null)).toEqual({
      file: 'data:audio/mp3;base64,AAAA',
      volume: 50,
      custom: true,
      name: 'alert.mp3',
    });

    // 從自訂切回內建音效時仍使用原區服 CDN
    const chime = notifier.updateOfficialSound({
      file: 'audio/trade/chime.mp3',
      custom: false,
      name: null,
    });
    expect(chime.ok).toBe(true);
    expect(audio.src).toBe('https://web.poecdn.tw/audio/trade/chime.mp3');

    // 不合法路徑被拒絕
    expect(
      notifier.updateOfficialSound({ file: 'javascript:alert(1)', custom: false, name: null }),
    ).toEqual({ ok: false, reason: 'invalid' });
  });

  it('storage 寫入失敗時回傳 storage 錯誤且不拋出例外', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { notifier } = setup({
      writeStorage: () => {
        throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
      },
    });
    expect(notifier.updateOfficialVolume(40)).toEqual({ ok: false, reason: 'storage' });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
