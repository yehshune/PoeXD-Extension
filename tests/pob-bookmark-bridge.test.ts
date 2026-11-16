import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import type { BookmarkModel } from '@/components/sidebar/bookmark-model';
import { createPobBookmarkBridge } from '@/components/sidebar/pob-build/pob-bookmark-bridge';
import { BOOKMARK_NAME_MAX_LENGTH } from '@/utils/bookmark-collection';

const ICON = 'https://web.poecdn.com/gen/image/abc/Shield.png';

function createFakeModel(connectOk = true) {
  const state = ref({
    groups: [
      { id: 'root', name: 'Root', order: 0 },
      { id: 'child', name: 'Child', order: 0, parentId: 'root' },
    ],
    bookmarks: [{ id: 'b0' }],
  });
  const execute = vi.fn(
    async (_intent: { type: string; bookmark: Record<string, unknown> }) =>
      ({ ok: true, value: undefined }) as {
        ok: boolean;
        value?: undefined;
        error?: { message: string };
      },
  );
  const connect = vi.fn(async () =>
    connectOk
      ? { ok: true as const, value: undefined }
      : { ok: false as const, error: { message: 'offline' } },
  );
  const dispose = vi.fn();
  const model = { state, execute, connect, dispose } as unknown as BookmarkModel;
  return { model, execute, connect, dispose };
}

describe('createPobBookmarkBridge', () => {
  it('第一次使用才連線，列出巢狀資料夾', async () => {
    const fake = createFakeModel();
    const createModel = vi.fn(() => fake.model);
    const bridge = createPobBookmarkBridge('poe1', createModel);
    expect(createModel).not.toHaveBeenCalled();

    expect(await bridge.listFolders()).toEqual([
      { id: 'root', name: 'Root', depth: 0 },
      { id: 'child', name: 'Child', depth: 1 },
    ]);
    await bridge.listFolders();
    expect(fake.connect).toHaveBeenCalledTimes(1);
  });

  it('新增書籤：名稱整理成單行並截斷，只收官方 CDN 圖示，排在最後', async () => {
    const fake = createFakeModel();
    const bridge = createPobBookmarkBridge('poe1', () => fake.model);
    const result = await bridge.add({
      groupId: 'child',
      name: `  Rise\n of ${'x'.repeat(200)}`,
      url: 'https://www.pathofexile.com/trade/search/Standard/H4sI',
      coverImageUrl: 'https://evil.example/x.png',
    });
    expect(result.ok).toBe(true);
    const bookmark = fake.execute.mock.calls[0][0].bookmark;
    expect(bookmark).toMatchObject({ groupId: 'child', order: 1, searchRecordId: '' });
    expect(String(bookmark.name).startsWith('Rise of x')).toBe(true);
    expect(bookmark.name).toHaveLength(BOOKMARK_NAME_MAX_LENGTH);
    expect(bookmark).not.toHaveProperty('coverImageUrl');

    await bridge.add({ groupId: 'root', name: 'A', url: 'https://x', coverImageUrl: ICON });
    expect(fake.execute.mock.calls[1][0].bookmark.coverImageUrl).toBe(ICON);
  });

  it('資料夾不存在、名稱空白或連線失敗時不新增', async () => {
    const fake = createFakeModel();
    const bridge = createPobBookmarkBridge('poe1', () => fake.model);
    expect(await bridge.add({ groupId: 'missing', name: 'A', url: 'https://x' })).toEqual({
      ok: false,
    });
    expect(await bridge.add({ groupId: 'root', name: '   ', url: 'https://x' })).toEqual({
      ok: false,
    });
    expect(fake.execute).not.toHaveBeenCalled();

    const offline = createFakeModel(false);
    const offlineBridge = createPobBookmarkBridge('poe1', () => offline.model);
    expect(await offlineBridge.listFolders()).toEqual([]);
    expect(await offlineBridge.add({ groupId: 'root', name: 'A', url: 'https://x' })).toEqual({
      ok: false,
    });
    // 連線失敗不留住結果，下次會重試
    expect(offline.connect).toHaveBeenCalledTimes(2);
  });

  it('書籤儲存回報錯誤時帶出訊息；dispose 釋放模型', async () => {
    const fake = createFakeModel();
    fake.execute.mockResolvedValueOnce({ ok: false, error: { message: 'quota' } } as never);
    const bridge = createPobBookmarkBridge('poe1', () => fake.model);
    expect(await bridge.add({ groupId: 'root', name: 'A', url: 'https://x' })).toEqual({
      ok: false,
      message: 'quota',
    });
    bridge.dispose();
    expect(fake.dispose).toHaveBeenCalledTimes(1);
  });
});
