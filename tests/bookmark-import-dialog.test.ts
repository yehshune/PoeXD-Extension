// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { createApp, nextTick, ref } from 'vue';
import BookmarkImportDialog from '@/components/sidebar/BookmarkImportDialog.vue';
import { encodeBookmarkTransfer } from '@/utils/bookmark-transfer';

type Collection = {
  groups: Array<{ id: string; name: string; order: number; parentId?: string }>;
  bookmarks: Array<{
    id: string;
    name: string;
    url: string;
    groupId: string;
    order: number;
    coverImageUrl?: string;
  }>;
};

const samplePayload = {
  kind: 'poexd-bookmarks' as const,
  schemaVersion: 2 as const,
  gameVersion: 'poe1' as const,
  scope: 'collection' as const,
  folders: [
    {
      name: 'IncomingFolder',
      bookmarks: [
        { name: 'BM1', url: 'https://www.pathofexile.com/trade/search/Standard/H4sIbm1' },
      ],
    },
  ],
};

const folderPayload = (name: string) => ({
  kind: 'poexd-bookmarks' as const,
  schemaVersion: 2 as const,
  gameVersion: 'poe1' as const,
  scope: 'folder' as const,
  folders: [
    {
      name,
      bookmarks: [
        { name: 'BM1', url: 'https://www.pathofexile.com/trade/search/Standard/H4sIbm1' },
      ],
    },
  ],
});

const sampleCurrent: Collection = {
  groups: [{ id: 'g1', name: 'ExistingFolder', order: 0 }],
  bookmarks: [
    {
      id: 'b1',
      name: 'ExistingBM',
      url: 'https://www.pathofexile.com/trade/search/Standard/H4sIex1',
      groupId: 'g1',
      order: 0,
    },
  ],
};

const emptyCollection: Collection = { groups: [], bookmarks: [] };

const flushAsync = async (ms = 50) => {
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, ms));
  await nextTick();
};

const bodyText = () => document.body.textContent || '';
const findButton = (label: string) =>
  Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
    button.textContent?.includes(label),
  );
const confirmButton = () =>
  document.body.querySelector<HTMLButtonElement>('.import-confirm-button')!;
const findModeOption = (label: string) =>
  Array.from(document.body.querySelectorAll<HTMLButtonElement>('.import-mode-option')).find(
    (button) => button.textContent?.includes(label),
  );

async function typeShareCode(code: string) {
  const input = document.body.querySelector<HTMLInputElement>('input[aria-label="書籤分享碼"]')!;
  input.value = code;
  input.dispatchEvent(new Event('input'));
  await flushAsync(80);
}

async function chooseSelectItem(value: string) {
  const trigger = document.body.querySelector<HTMLElement>('[data-slot="select-trigger"]');
  expect(trigger).not.toBeNull();
  trigger!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
  trigger!.click();
  await flushAsync(50);
  const item = Array.from(
    document.body.querySelectorAll<HTMLElement>('[data-slot="select-item"]'),
  ).find((candidate) => candidate.getAttribute('data-value') === value);
  expect(item).toBeDefined();
  const EventCtor = typeof PointerEvent !== 'undefined' ? PointerEvent : MouseEvent;
  item!.focus?.();
  item!.dispatchEvent(new EventCtor('pointerdown', { bubbles: true, cancelable: true }));
  item!.dispatchEvent(new EventCtor('pointerup', { bubbles: true, cancelable: true }));
  item!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  item!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  item!.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
  await flushAsync(50);
}

describe('BookmarkImportDialog', () => {
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  function mountDialog(props: {
    version?: 'poe1' | 'poe2';
    currentCollection?: Collection;
    initialPayload?: unknown;
  }) {
    const openRef = ref(true);
    const currentCollectionRef = ref(props.currentCollection ?? sampleCurrent);
    const importEvents: unknown[] = [];
    const app = createApp({
      components: { BookmarkImportDialog },
      setup: () => ({
        open: openRef,
        version: props.version ?? 'poe1',
        currentCollection: currentCollectionRef,
        initialPayload: props.initialPayload ?? null,
        onImport: (result: unknown) => importEvents.push(result),
      }),
      template: `
        <BookmarkImportDialog
          :open="open"
          :version="version"
          :current-collection="currentCollection"
          :initial-payload="initialPayload"
          @update:open="open = $event"
          @import="onImport"
        />
      `,
    });
    app.mount(container);
    return { openRef, currentCollectionRef, importEvents };
  }

  it('renders a single-step source row with share code input, clipboard and file actions', async () => {
    mountDialog({});
    await flushAsync();

    expect(bodyText()).toContain('匯入書籤');
    expect(bodyText()).toContain('貼上分享碼、選擇或拖曳書籤備份檔，自動解析並預覽變更。');
    expect(document.body.querySelector('input[aria-label="書籤分享碼"]')).not.toBeNull();
    expect(findButton('從剪貼簿匯入')).toBeDefined();
    expect(findButton('選擇書籤檔')).toBeDefined();
    expect(confirmButton().disabled).toBe(true);
    expect(document.body.querySelector('textarea')).toBeNull();
  });

  it('auto-parses a TFT share code into an inline preview without a separate step', async () => {
    const { importEvents } = mountDialog({ currentCollection: emptyCollection });
    await flushAsync();

    await typeShareCode(await encodeBookmarkTransfer(samplePayload));

    expect(bodyText()).toContain('POE1 · 全部書籤（1 個資料夾、1 個書籤）');
    expect(bodyText()).toContain('新增 1 資料夾 / 1 書籤');
    expect(document.body.querySelector('[aria-label="詳細變更預覽"]')?.textContent).toContain(
      'IncomingFolder',
    );
    // 書籤集合為空時不需要選擇匯入方式
    expect(document.body.querySelector('[aria-label="匯入方式"]')).toBeNull();

    const confirm = findButton('新增並匯入')!;
    expect(confirm.disabled).toBe(false);
    confirm.click();
    await flushAsync(20);
    expect(importEvents).toEqual([
      { payload: samplePayload, mode: 'create', targetGroupId: undefined },
    ]);
  });

  it('offers import modes for a non-empty collection and warns before replacing', async () => {
    const { importEvents } = mountDialog({ initialPayload: samplePayload });
    await flushAsync(80);

    expect(document.body.querySelector('[aria-label="匯入方式"]')).not.toBeNull();
    expect(bodyText()).not.toContain('此操作將刪除');

    findModeOption('合併現有書籤')!.click();
    await flushAsync();
    expect(findButton('合併並匯入')?.disabled).toBe(false);

    findModeOption('清除並取代全部書籤')!.click();
    await flushAsync();
    expect(bodyText()).toContain('刪除 1 資料夾 / 1 書籤');
    expect(bodyText()).toContain('此操作將刪除上述現有內容，且無法復原。');

    findButton('取代並匯入')!.click();
    await flushAsync(20);
    expect(importEvents).toEqual([
      { payload: samplePayload, mode: 'replace', targetGroupId: undefined },
    ]);
  });

  it('shows an error for share codes that belong to another game version', async () => {
    mountDialog({ version: 'poe1' });
    await flushAsync();

    await typeShareCode(
      await encodeBookmarkTransfer({
        ...samplePayload,
        gameVersion: 'poe2',
        folders: [
          {
            name: 'PoE2',
            bookmarks: [
              { name: 'X', url: 'https://www.pathofexile.com/trade2/search/poe2/Standard/H4sIx' },
            ],
          },
        ],
      }),
    );

    expect(bodyText()).toContain('此書籤資料屬於另一個遊戲版本');
    expect(document.body.querySelector('[aria-label="詳細變更預覽"]')).toBeNull();
    expect(confirmButton().disabled).toBe(true);
  });

  it('rejects legacy PoeXD share codes and clears the preview when the input is emptied', async () => {
    mountDialog({ currentCollection: emptyCollection });
    await flushAsync();

    await typeShareCode('poexd-bm2:abc');
    expect(bodyText()).toContain('無法讀取書籤');

    await typeShareCode(await encodeBookmarkTransfer(samplePayload));
    expect(bodyText()).not.toContain('無法讀取書籤');
    expect(findButton('新增並匯入')).toBeDefined();

    await typeShareCode('');
    expect(document.body.querySelector('[aria-label="詳細變更預覽"]')).toBeNull();
  });

  it('imports a folder without a name conflict directly as a new folder', async () => {
    const payload = folderPayload('UniqueFolder');
    const { importEvents } = mountDialog({ initialPayload: payload });
    await flushAsync(80);

    expect(document.body.querySelector('[aria-label="匯入方式"]')).toBeNull();
    expect(bodyText()).toContain('POE1 · 單一資料夾（1 個資料夾、1 個書籤）');
    findButton('新增並匯入')!.click();
    await flushAsync(20);
    expect(importEvents).toEqual([{ payload, mode: 'create', targetGroupId: undefined }]);
  });

  it('requires choosing a target folder when merging into one of several same-name folders', async () => {
    const payload = folderPayload('Weapon');
    const { importEvents } = mountDialog({
      initialPayload: payload,
      currentCollection: {
        groups: [
          { id: 'root_weapon', name: 'Weapon', order: 0 },
          { id: 'cat_equip', name: 'Equipment', order: 1 },
          { id: 'sub_weapon', name: 'Weapon', order: 0, parentId: 'cat_equip' },
        ],
        bookmarks: [],
      },
    });
    await flushAsync(80);

    expect(findButton('新增並匯入')?.disabled).toBe(false);
    findModeOption('合併到現有資料夾')!.click();
    await flushAsync();
    expect(bodyText()).toContain('請選擇目標資料夾後查看變更預覽。');
    const confirm = findButton('合併並匯入')!;
    expect(confirm.disabled).toBe(true);

    await chooseSelectItem('sub_weapon');
    expect(confirm.disabled).toBe(false);
    confirm.click();
    await flushAsync(20);
    expect(importEvents).toEqual([{ payload, mode: 'merge', targetGroupId: 'sub_weapon' }]);
  });

  it('auto-binds a single same-name folder and drops a stale target after external changes', async () => {
    const payload = folderPayload('Flasks');
    const { currentCollectionRef, importEvents } = mountDialog({
      initialPayload: payload,
      currentCollection: { groups: [{ id: 'f1', name: 'Flasks', order: 0 }], bookmarks: [] },
    });
    await flushAsync(80);

    findModeOption('合併到現有資料夾')!.click();
    await flushAsync();
    expect(findButton('合併並匯入')?.disabled).toBe(false);

    currentCollectionRef.value = { groups: [{ id: 'f1', name: 'Gems', order: 0 }], bookmarks: [] };
    await flushAsync(80);

    expect(document.body.querySelector('[aria-label="匯入方式"]')).toBeNull();
    findButton('新增並匯入')!.click();
    await flushAsync(20);
    expect(importEvents).toEqual([{ payload, mode: 'create', targetGroupId: undefined }]);
  });

  it('parses dropped backup files and clipboard text', async () => {
    mountDialog({ currentCollection: emptyCollection });
    await flushAsync();
    const code = await encodeBookmarkTransfer(samplePayload);

    const file = new File([code], 'bookmarks.json', { type: 'application/json' });
    const drop = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [file] } });
    document.body.querySelector('.import-drop-zone')!.dispatchEvent(drop);
    await flushAsync(100);
    expect(bodyText()).toContain('新增 1 資料夾 / 1 書籤');

    await typeShareCode('');
    const readText = vi.fn(async () => code);
    Object.defineProperty(navigator, 'clipboard', { value: { readText }, configurable: true });
    findButton('從剪貼簿匯入')!.click();
    await flushAsync(100);
    expect(readText).toHaveBeenCalled();
    expect(bodyText()).toContain('新增 1 資料夾 / 1 書籤');
  });

  it('only lists changed items in the diff preview', async () => {
    mountDialog({ initialPayload: samplePayload });
    await flushAsync(80);
    findModeOption('合併現有書籤')!.click();
    await flushAsync();

    const tree = document.body.querySelector('[aria-label="詳細變更預覽"]')!;
    expect(tree.textContent).toContain('IncomingFolder');
    expect(tree.textContent).not.toContain('ExistingBM');
  });
});
