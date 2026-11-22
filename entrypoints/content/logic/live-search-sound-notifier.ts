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

export interface OfficialSoundSetting {
  file: string;
  volume: number;
  custom: boolean;
  name: string | null;
}

export type OfficialSoundUpdateOutcome =
  | { ok: true; setting: OfficialSoundSetting }
  | { ok: false; reason: 'invalid' | 'storage' };

export const OFFICIAL_SOUND_OPTIONS = [
  { id: 'pulse', file: 'audio/trade/pulse.mp3' },
  { id: 'piano', file: 'audio/trade/piano.mp3' },
  { id: 'chime', file: 'audio/trade/chime.mp3' },
  { id: 'gong', file: 'audio/trade/gong.mp3' },
] as const;

export type OfficialBuiltInSoundId = (typeof OFFICIAL_SOUND_OPTIONS)[number]['id'];

export const OFFICIAL_DEFAULT_SOUND_FILE = 'audio/trade/pulse.mp3';
export const OFFICIAL_DEFAULT_SOUND_VOLUME = 50;
export const OFFICIAL_CUSTOM_SOUND_MAX_BYTES = 1_000_000;
const OFFICIAL_FALLBACK_CDN_ORIGIN = 'https://web.poecdn.com';
const BUILTIN_AUDIO_PATH_RE = /^audio\/[^\s"'<>]+$/;

export interface LiveSearchSoundNotifier {
  /** 有新結果時呼叫；關閉、合併視窗內或音量 0 時不播放 */
  notify(): void;
  /** 設定頁試聽：略過開關與合併視窗 */
  preview(): Promise<LiveSearchSoundPlayOutcome>;
  /** 讀取目前官方音效與音量設定（localStorage） */
  readOfficialSetting(): OfficialSoundSetting;
  /** 直接更新官方音量（0–100 整數），寫回官網 lscache 鍵 */
  updateOfficialVolume(volume: number): OfficialSoundUpdateOutcome;
  /** 直接更新官方音效（內建或自訂 data:audio/...），寫回官網 lscache 並同步 `<audio>.src` */
  updateOfficialSound(next: {
    file: string;
    custom: boolean;
    name: string | null;
  }): OfficialSoundUpdateOutcome;
  getState(): LiveSearchSoundState;
  subscribe(listener: (state: LiveSearchSoundState) => void): () => void;
  dispose(): void;
}

export interface LiveSearchSoundNotifierOptions {
  version: PoeVersion;
  isEnabled: () => boolean;
  findAudio?: () => HTMLAudioElement | null;
  readStorage?: (key: string) => string | null;
  writeStorage?: (key: string, value: string) => void;
  /** 監聽使用者互動以解除「被擋下」狀態 */
  activationTarget?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  now?: () => number;
  coalesceMs?: number;
}

export const LIVE_SEARCH_SOUND_COALESCE_MS = 300;

const ACTIVATION_EVENTS = ['pointerdown', 'keydown'] as const;

/** 官方以 lscache 儲存音效設定的鍵：PoE 1 bucket 為 `trade`，PoE 2 為 `trade2`。 */
export function getOfficialSoundSettingKey(version: PoeVersion): string {
  return version === 'poe2' ? 'lscache-trade2woop' : 'lscache-tradewoop';
}

function isValidSoundFile(file: unknown, custom: boolean): file is string {
  if (typeof file !== 'string' || file.length === 0) return false;
  if (custom) return file.startsWith('data:audio/');
  return BUILTIN_AUDIO_PATH_RE.test(file);
}

function parseRawStorageObject(raw: string | null): Record<string, unknown> | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 4_000_000) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

/**
 * 解析官方音效設定（`{ file, volume, custom, name }`）。值由頁面寫入，視為不可信：
 * 音量只接受 0–100 整數（其餘回 50）；音效路徑不合法時回預設 `audio/trade/pulse.mp3`。
 */
export function parseOfficialSoundSetting(raw: string | null): OfficialSoundSetting {
  const parsed = parseRawStorageObject(raw);
  if (!parsed) {
    return {
      file: OFFICIAL_DEFAULT_SOUND_FILE,
      volume: OFFICIAL_DEFAULT_SOUND_VOLUME,
      custom: false,
      name: null,
    };
  }
  const volumeRaw = parsed.volume;
  const volume =
    typeof volumeRaw === 'number' &&
    Number.isInteger(volumeRaw) &&
    volumeRaw >= 0 &&
    volumeRaw <= 100
      ? volumeRaw
      : OFFICIAL_DEFAULT_SOUND_VOLUME;
  const custom = parsed.custom === true;
  if (isValidSoundFile(parsed.file, custom)) {
    const name =
      custom && typeof parsed.name === 'string' && parsed.name.trim().length > 0
        ? parsed.name.trim()
        : null;
    return { file: parsed.file, volume, custom, name };
  }
  return {
    file: OFFICIAL_DEFAULT_SOUND_FILE,
    volume,
    custom: false,
    name: null,
  };
}

/**
 * 解析官方音效設定的音量（0–100）。值由頁面寫入，視為不可信：
 * 只接受 0–100 的整數，其餘（鍵不存在、JSON 錯誤、型別不符）一律回官方預設 50。
 */
export function parseOfficialSoundVolume(raw: string | null): number {
  return parseOfficialSoundSetting(raw).volume;
}

function extractCdnOrigin(src: string | null | undefined): string | null {
  if (!src || (!src.startsWith('http://') && !src.startsWith('https://'))) return null;
  try {
    return new URL(src).origin;
  } catch {
    return null;
  }
}

export function resolveOfficialAudioSrc(setting: OfficialSoundSetting, cdnOrigin: string): string {
  if (setting.custom && setting.file.startsWith('data:audio/')) {
    return setting.file;
  }
  return `${cdnOrigin.replace(/\/$/, '')}/${setting.file.replace(/^\//, '')}`;
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

function defaultWriteStorage(key: string, value: string): void {
  if (typeof localStorage === 'undefined') {
    throw new Error('localStorage unavailable');
  }
  localStorage.setItem(key, value);
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
  const writeStorage = options.writeStorage ?? defaultWriteStorage;
  const activationTarget =
    options.activationTarget ?? (typeof document !== 'undefined' ? document : undefined);
  const now = options.now ?? (() => Date.now());
  const coalesceMs = options.coalesceMs ?? LIVE_SEARCH_SOUND_COALESCE_MS;
  const settingKey = getOfficialSoundSettingKey(options.version);

  let state: LiveSearchSoundState = 'ready';
  let lastPlayAt = Number.NEGATIVE_INFINITY;
  let disposed = false;
  let activationListening = false;
  let cachedCdnOrigin = OFFICIAL_FALLBACK_CDN_ORIGIN;
  const loggedErrors = new Set<string>();
  const listeners = new Set<(state: LiveSearchSoundState) => void>();

  const captureCdnOrigin = (audio: HTMLAudioElement | null) => {
    const origin = extractCdnOrigin(audio?.src);
    if (origin) cachedCdnOrigin = origin;
  };

  const syncAudioElementSrc = (audio: HTMLAudioElement | null, setting: OfficialSoundSetting) => {
    if (!audio) return;
    captureCdnOrigin(audio);
    if (typeof audio.src !== 'string') return;
    const nextSrc = resolveOfficialAudioSrc(setting, cachedCdnOrigin);
    if (audio.src !== nextSrc) {
      audio.src = nextSrc;
    }
  };

  const readSetting = (): OfficialSoundSetting =>
    parseOfficialSoundSetting(readStorage(settingKey));

  const persistSetting = (next: OfficialSoundSetting): OfficialSoundUpdateOutcome => {
    const existing = parseRawStorageObject(readStorage(settingKey)) ?? {};
    const payload = {
      ...existing,
      name: next.custom ? next.name : null,
      file: next.file,
      volume: next.volume,
      custom: next.custom,
      playOnLoad: false,
    };
    try {
      writeStorage(settingKey, JSON.stringify(payload));
    } catch (err) {
      logOnce('storage write failed', errorName(err));
      return { ok: false, reason: 'storage' };
    }
    return { ok: true, setting: next };
  };

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
    const setting = readSetting();
    if (setting.volume === 0) return { ok: false, reason: 'muted' };

    const audio = findAudio();
    if (!audio) {
      logOnce('skipped', 'official <audio> element not found');
      return { ok: false, reason: 'missing' };
    }

    try {
      syncAudioElementSrc(audio, setting);
      if (audio.currentTime > 0) {
        audio.pause();
        audio.currentTime = 0;
      }
      audio.volume = setting.volume / 100;
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
    readOfficialSetting: readSetting,
    updateOfficialVolume(volume: number): OfficialSoundUpdateOutcome {
      if (!Number.isFinite(volume)) return { ok: false, reason: 'invalid' };
      const clamped = Math.min(100, Math.max(0, Math.round(volume)));
      const current = readSetting();
      return persistSetting({ ...current, volume: clamped });
    },
    updateOfficialSound(next: {
      file: string;
      custom: boolean;
      name: string | null;
    }): OfficialSoundUpdateOutcome {
      if (!isValidSoundFile(next.file, next.custom)) {
        return { ok: false, reason: 'invalid' };
      }
      const current = readSetting();
      const name = next.custom && next.name?.trim() ? next.name.trim() : null;
      const outcome = persistSetting({
        ...current,
        file: next.file,
        custom: next.custom,
        name,
      });
      if (outcome.ok) {
        syncAudioElementSrc(findAudio(), outcome.setting);
      }
      return outcome;
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
