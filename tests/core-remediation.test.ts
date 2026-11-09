import { describe, expect, it, vi } from 'vitest';

// 1. Mock 全域環境，防範 entrypoints 檔案在載入時拋出 ReferenceError
vi.stubGlobal('window', {
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  location: { pathname: '/trade/search/Standard', href: 'http://foo' },
  dispatchEvent: vi.fn(),
});

vi.stubGlobal('document', {
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  querySelectorAll: vi.fn(),
  querySelector: vi.fn(),
  getElementById: vi.fn().mockReturnValue(null),
  createElement: vi.fn().mockReturnValue({
    setAttribute: vi.fn(),
    appendChild: vi.fn(),
    classList: { add: vi.fn(), remove: vi.fn() },
  }),
  head: {
    appendChild: vi.fn(),
  },
  body: {
    classList: {
      add: vi.fn(),
      remove: vi.fn(),
    },
  },
});

vi.stubGlobal('chrome', {
  runtime: {
    getURL: vi.fn().mockReturnValue('mock://url'),
  },
  storage: {
    local: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      onChanged: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
  },
});

// 2. 導入要測試的邏輯函數
import {
  createVersionedStorageKeys,
  readStorageValue,
  collectLegacyStorageMigration,
} from '@/utils/storage-contracts';
import { getPoeVersion } from '@/utils/trade-context';

describe('2. Chrome Storage 非 Preference 狀態鍵值版本化及遷移', () => {
  it('應該在 Poe 1 與 Poe 2 時回傳不同的 versioned UI-state keys', () => {
    const keysPoe1 = createVersionedStorageKeys('poe1');
    const keysPoe2 = createVersionedStorageKeys('poe2');

    expect(keysPoe1.activeTab).toBe('activeTab_poe1');
    expect(keysPoe2.activeTab).toBe('activeTab_poe2');
    expect(keysPoe1.isCollapsed).toBe('isCollapsed_poe1');
    expect(keysPoe2.isCollapsed).toBe('isCollapsed_poe2');
  });

  it('應該能依 pathname 正確辨識 Poe 遊戲版本', () => {
    expect(getPoeVersion('/trade2/search/Standard')).toBe('poe2');
    expect(getPoeVersion('/trade/search/Standard')).toBe('poe1');
  });

  it('應該在讀取儲存庫時，如果無 versioned key 則 fallback 讀取 legacy key', () => {
    const data = {
      bookmarks_poe1: ['item1'],
      bookmarks: ['item2'],
    };

    // 1. Versioned key 存在，讀取 versioned key
    const val1 = readStorageValue(data, 'bookmarks_poe1', 'bookmarks', []);
    expect(val1).toEqual(['item1']);

    // 2. Versioned key 不存在，讀取 legacy key
    const val2 = readStorageValue(data, 'bookmarks_poe2', 'bookmarks', []);
    expect(val2).toEqual(['item2']);

    // 3. 兩者皆無時，回傳預設值
    const val3 = readStorageValue(data, 'nonexistent_key', 'legacy_nonexistent', ['default']);
    expect(val3).toEqual(['default']);
  });

  it('應該能正確搜集需要遷移的 legacy values', () => {
    const data = {
      bookmarks: ['item_legacy'],
      history: ['history_legacy'],
    };

    const mappings = [
      ['bookmarks_poe1', 'bookmarks'],
      ['history_poe1', 'history'],
      ['enableHotkeys_poe1', 'enableHotkeys'],
    ] as const;

    const migration = collectLegacyStorageMigration(data, mappings);
    expect(migration).toEqual({
      bookmarks_poe1: ['item_legacy'],
      history_poe1: ['history_legacy'],
    });
  });
});

describe('5. Nonce 事件安全來源驗證 (event payload validation)', () => {
  function createPoeEvent(nonce: string, payload: any) {
    return { source: 'poexd', nonce, payload };
  }

  function validatePoeEvent(eventDetail: any, expectedNonce: string) {
    if (!eventDetail || eventDetail.source !== 'poexd') return null;
    if (eventDetail.nonce !== expectedNonce) return null;
    return eventDetail.payload;
  }

  it('當 Nonce 完全正確時，應通過驗證並回傳 payload', () => {
    const nonce = 'security_nonce_12345';
    const payload = { query: 'test' };
    const event = createPoeEvent(nonce, payload);

    const result = validatePoeEvent(event, nonce);
    expect(result).toEqual(payload);
  });

  it('當 Nonce 錯誤或 source 不符時，應拒絕並回傳 null', () => {
    const nonce = 'security_nonce_12345';
    const wrongNonce = 'wrong_nonce';
    const payload = { query: 'test' };

    const eventWithWrongNonce = createPoeEvent(wrongNonce, payload);
    expect(validatePoeEvent(eventWithWrongNonce, nonce)).toBeNull();

    const eventWithWrongSource = { source: 'other', nonce, payload };
    expect(validatePoeEvent(eventWithWrongSource, nonce)).toBeNull();
  });
});
