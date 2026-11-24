// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createBookmarkWorkspace } from '@/components/sidebar/bookmark-workspace';
import { createFakeBookmarkWorkspaceHost } from '@/components/sidebar/bookmark-workspace/fake-host';
import { createFakeBookmarkModel } from './helpers/fake-bookmark-model';

const group = { id: 'g1', name: 'Folder', order: 0 };
const bookmark = {
  id: 'b1',
  name: 'One',
  url: 'https://www.pathofexile.com/trade/search/Standard/abc',
  groupId: 'g1',
  searchRecordId: 'abc',
  order: 0,
};

describe('Bookmark Workspace (tree + lifecycle)', () => {
  it('exposes the model tree read-only and reflects model changes', async () => {
    const model = createFakeBookmarkModel({ groups: [group], bookmarks: [bookmark] });
    const workspace = createBookmarkWorkspace(createFakeBookmarkWorkspaceHost(), {
      version: 'poe1',
      model,
    });

    expect(workspace.tree.groups.value).toEqual([group]);
    expect(workspace.tree.bookmarks.value).toEqual([bookmark]);

    model.setState({ bookmarks: [] });
    expect(workspace.tree.bookmarks.value).toEqual([]);
  });

  it('start() connects the model and clears isLoading; dispose() disconnects', async () => {
    const model = createFakeBookmarkModel();
    const workspace = createBookmarkWorkspace(createFakeBookmarkWorkspaceHost(), {
      version: 'poe1',
      model,
    });

    expect(workspace.tree.isLoading.value).toBe(true);
    await workspace.start();
    expect(model.connectCount).toBe(1);
    expect(workspace.tree.isLoading.value).toBe(false);

    workspace.dispose();
    expect(model.disposed).toBe(true);
  });

  it('refresh() re-resolves Bookmark targets against the current page', () => {
    const model = createFakeBookmarkModel();
    const workspace = createBookmarkWorkspace(createFakeBookmarkWorkspaceHost(), {
      version: 'poe1',
      model,
    });
    workspace.refresh();
    expect(model.refreshCount).toBe(1);
  });

  it('start() throws when the model cannot connect, but still clears isLoading', async () => {
    const model = createFakeBookmarkModel();
    model.connect = async () => ({
      ok: false,
      error: { code: 'unavailable', message: 'offline' } as any,
    });
    const workspace = createBookmarkWorkspace(createFakeBookmarkWorkspaceHost(), {
      version: 'poe1',
      model,
    });
    await expect(workspace.start()).rejects.toThrow('offline');
    expect(workspace.tree.isLoading.value).toBe(false);
  });
});
