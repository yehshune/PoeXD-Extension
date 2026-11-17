import type { PoeVersion } from '@/utils/trade-context';

/**
 * 主控台通知音效（ADR-0016）
 *
 * 由主控台決定何時播放：runtime 每接受一個新的結果 token 就呼叫 `notify()`，
 * 合併視窗內只播一次。播放的是官方頁面上唯一的 `<audio>` 元素，所以音效跟隨
 * 使用者在官方網站選的設定；音量從頁面 localStorage 的官方 lscache 讀取。
 * 不呼叫官方 Vue 方法、不碰 main world。
 */

export type LiveSearchSoundState = 'ready' | 'blocked';

export type LiveSearchSoundPlayOutcome =
  | { ok: true }
  | { ok: false; reason: 'muted' | 'missing' | 'blocked' | 'error' };

export interface LiveSearchSoundNotifier {
  /** 有新結果時呼叫；關閉、合併視窗內或音量 0 時不播放 */
  notify(): void;
  /** 設定頁試聽：略過開關與合併視窗 */
  preview(): Promise<LiveSearchSoundPlayOutcome>;
  getState(): LiveSearchSoundState;
  subscribe(listener: (state: LiveSearchSoundState) => void): () => void;
  dispose(): void;
}

export interface LiveSearchSoundNotifierOptions {
  version: PoeVersion;
  isEnabled: () => boolean;
  findAudio?: () => HTMLAudioElement | null;
  readStorage?: (key: string) => string | null;
  /** 監聽使用者互動以解除「被擋下」狀態 */
  activationTarget?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  now?: () => number;
  coalesceMs?: number;
}

export const LIVE_SEARCH_SOUND_COALESCE_MS = 300;
export const OFFICIAL_DEFAULT_SOUND_VOLUME = 50;

const ACTIVATION_EVENTS = ['pointerdown', 'keydown'] as const;

/** 官方以 lscache 儲存音效設定的鍵：PoE 1 bucket 為 `trade`，PoE 2 為 `trade2`。 */
export function getOfficialSoundSettingKey(version: PoeVersion): string {
  return version === 'poe2' ? 'lscache-trade2woop' : 'lscache-tradewoop';
}

/**
 * 解析官方音效設定的音量（0–100）。值由頁面寫入，視為不可信：
 * 只接受 0–100 的整數，其餘（鍵不存在、JSON 錯誤、型別不符）一律回官方預設 50。
 */
export function parseOfficialSoundVolume(raw: string | null): number {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 4_000_000) {
    return OFFICIAL_DEFAULT_SOUND_VOLUME;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return OFFICIAL_DEFAULT_SOUND_VOLUME;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return OFFICIAL_DEFAULT_SOUND_VOLUME;
  }
  const volume = (parsed as { volume?: unknown }).volume;
  return typeof volume === 'number' && Number.isInteger(volume) && volume >= 0 && volume <= 100
    ? volume
    : OFFICIAL_DEFAULT_SOUND_VOLUME;
}

function defaultFindAudio(): HTMLAudioElement | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector('audio');
}

function defaultReadStorage(key: string): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

function errorName(err: unknown): string {
  return err instanceof Error || (err && typeof err === 'object' && 'name' in err)
    ? String((err as { name: unknown }).name)
    : 'unknown error';
}

export function createLiveSearchSoundNotifier(
  options: LiveSearchSoundNotifierOptions,
): LiveSearchSoundNotifier {
  const findAudio = options.findAudio ?? defaultFindAudio;
  const readStorage = options.readStorage ?? defaultReadStorage;
  const activationTarget =
    options.activationTarget ?? (typeof document !== 'undefined' ? document : undefined);
  const now = options.now ?? (() => Date.now());
  const coalesceMs = options.coalesceMs ?? LIVE_SEARCH_SOUND_COALESCE_MS;
  const settingKey = getOfficialSoundSettingKey(options.version);

  let state: LiveSearchSoundState = 'ready';
  let lastPlayAt = Number.NEGATIVE_INFINITY;
  let disposed = false;
  let activationListening = false;
  const loggedErrors = new Set<string>();
  const listeners = new Set<(state: LiveSearchSoundState) => void>();

  const logOnce = (kind: string, detail: string) => {
    const key = `${kind}:${detail}`;
    if (loggedErrors.has(key)) return;
    loggedErrors.add(key);
    console.warn(`[PoeXD LiveSearch] Sound notification ${kind}: ${detail}`);
  };

  const setState = (next: LiveSearchSoundState) => {
    if (state === next) return;
    state = next;
    for (const listener of listeners) {
      try {
        listener(next);
      } catch (err) {
        logOnce('listener failed', errorName(err));
      }
    }
  };

  const onActivation = () => {
    stopActivationListening();
    if (!disposed) setState('ready');
  };

  function startActivationListening() {
    if (activationListening || !activationTarget) return;
    activationListening = true;
    for (const type of ACTIVATION_EVENTS) {
      activationTarget.addEventListener(type, onActivation, { capture: true });
    }
  }

  function stopActivationListening() {
    if (!activationListening || !activationTarget) return;
    activationListening = false;
    for (const type of ACTIVATION_EVENTS) {
      activationTarget.removeEventListener(type, onActivation, { capture: true });
    }
  }

  const play = async (): Promise<LiveSearchSoundPlayOutcome> => {
    const volume = parseOfficialSoundVolume(readStorage(settingKey));
    if (volume === 0) return { ok: false, reason: 'muted' };

    const audio = findAudio();
    if (!audio) {
      logOnce('skipped', 'official <audio> element not found');
      return { ok: false, reason: 'missing' };
    }

    try {
      if (audio.currentTime > 0) {
        audio.pause();
        audio.currentTime = 0;
      }
      audio.volume = volume / 100;
      await audio.play();
    } catch (err) {
      if (disposed) return { ok: false, reason: 'error' };
      if (errorName(err) === 'NotAllowedError') {
        setState('blocked');
        startActivationListening();
        return { ok: false, reason: 'blocked' };
      }
      logOnce('failed', errorName(err));
      return { ok: false, reason: 'error' };
    }

    if (disposed) return { ok: false, reason: 'error' };
    stopActivationListening();
    setState('ready');
    return { ok: true };
  };

  return {
    notify() {
      if (disposed) return;
      let enabled = false;
      try {
        enabled = options.isEnabled();
      } catch (err) {
        logOnce('preference read failed', errorName(err));
      }
      if (!enabled) return;
      const current = now();
      if (current - lastPlayAt < coalesceMs) return;
      lastPlayAt = current;
      void play();
    },
    preview() {
      if (disposed) return Promise.resolve({ ok: false, reason: 'error' });
      lastPlayAt = now();
      return play();
    },
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      disposed = true;
      stopActivationListening();
      listeners.clear();
    },
  };
}
