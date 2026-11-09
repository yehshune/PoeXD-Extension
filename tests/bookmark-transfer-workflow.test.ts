import { describe, expect, it, vi } from 'vitest';
import {
  createBookmarkTransferWorkflow,
  type BookmarkTransferHost,
} from '@/components/sidebar/bookmark-transfer-workflow';
import type { BookmarkModel } from '@/components/sidebar/bookmark-model';
import { decodeBookmarkTransfer, encodeBookmarkTransfer } from '@/utils/bookmark-transfer';

const payload = {
  kind: 'poexd-bookmarks' as const,
  schemaVersion: 2 as const,
  gameVersion: 'poe1' as const,
  scope: 'collection' as const,
  folders: [
    {
      name: 'Favorites',
      bookmarks: [
        {
          name: 'Ring',
          url: 'https://www.pathofexile.com/trade/search/Standard/abc123',
        },
      ],
    },
  ],
};

function setup() {
  const order: string[] = [];
  const model = {
    execute: vi.fn(async (intent: { type: string }) => {
      order.push(intent.type === 'export-transfer' ? 'export' : 'import');
      return intent.type === 'export-transfer'
        ? { ok: true as const, value: payload }
        : { ok: true as const, value: undefined };
    }),
  } as unknown as BookmarkModel;
  const host = {
    closeMenus: vi.fn(() => order.push('close')),
    showAlert: vi.fn(async () => undefined),
    showToast: vi.fn(() => order.push('toast')),
    writeClipboard: vi.fn(async (_text: string) => {
      order.push('clipboard');
    }),
    downloadFile: vi.fn(() => order.push('download')),
  } satisfies BookmarkTransferHost;
  return {
    host,
    model,
    order,
    workflow: createBookmarkTransferWorkflow({ model, host }),
  };
}

describe('Bookmark Transfer workflow interface', () => {
  it('copies an encoded collection before closing the menu and showing the success toast', async () => {
    const { host, model, order, workflow } = setup();

    await workflow.run({ type: 'copy', scope: 'collection' });

    expect(model.execute).toHaveBeenCalledWith({ type: 'export-transfer', scope: 'collection' });
    expect(await decodeBookmarkTransfer(vi.mocked(host.writeClipboard).mock.calls[0][0])).toEqual({
      ...payload,
      schemaVersion: 2,
    });
    expect(order).toEqual(['export', 'clipboard', 'close', 'toast']);
    expect(host.showToast).toHaveBeenCalledWith('分享碼已複製。');
  });

  it('closes the menu before exporting pretty JSON with the existing filename contract', async () => {
    const { host, order, workflow } = setup();

    await workflow.run({ type: 'download' });

    expect(order).toEqual(['close', 'export', 'download']);
    expect(host.downloadFile).toHaveBeenCalledWith({
      content: expect.any(String),
      filename: expect.stringMatching(/^poexd_bookmarks_\d{4}-\d{2}-\d{2}\.json$/),
      mimeType: 'application/json',
    });
    const content = (
      vi.mocked(host.downloadFile).mock.calls[0] as unknown as [{ content: string }]
    )[0].content;
    expect(JSON.parse(content)).toHaveProperty('folders');
    expect(await decodeBookmarkTransfer(content)).toEqual({ ...payload, schemaVersion: 2 });
  });
});
