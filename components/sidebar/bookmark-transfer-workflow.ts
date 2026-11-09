import { encodeBookmarkTransfer, stringifyBookmarkTransfer } from '@/utils/bookmark-transfer';
import type { BookmarkModel } from './bookmark-model';
import { downloadTextFile } from '@/utils/download-file';
import { t } from '@/utils/i18n';

type TransferScope = 'collection' | 'folder';

export type BookmarkTransferWorkflowIntent =
  | { type: 'copy'; scope: TransferScope; groupId?: string }
  | { type: 'download' };

export interface BookmarkTransferHost {
  closeMenus(): void;
  showAlert(message: string, title: string): Promise<void>;
  showToast(message: string): void;
  writeClipboard(text: string): Promise<void>;
  downloadFile(file: { content: string; filename: string; mimeType: string }): void;
}

export interface BookmarkTransferWorkflow {
  run(intent: BookmarkTransferWorkflowIntent): Promise<void>;
}

export function createBookmarkTransferWorkflow(options: {
  model: BookmarkModel;
  host: BookmarkTransferHost;
}): BookmarkTransferWorkflow {
  const { model, host } = options;

  const readTransfer = async (scope: TransferScope, groupId?: string) => {
    const result = await model.execute({ type: 'export-transfer', scope, groupId });
    if (!result.ok) {
      await host.showAlert(
        t('bookmarkTransfer.export.failure', { message: result.error.message }),
        t('common.error'),
      );
      return undefined;
    }
    return result.value;
  };

  return {
    async run(intent) {
      switch (intent.type) {
        case 'copy': {
          const payload = await readTransfer(intent.scope, intent.groupId);
          if (!payload) return;
          try {
            await host.writeClipboard(await encodeBookmarkTransfer(payload));
            host.closeMenus();
            host.showToast(t('bookmarkTransfer.copy.successToast'));
          } catch (error) {
            await host.showAlert(
              t('bookmarkTransfer.copy.failure', { message: toErrorMessage(error) }),
              t('common.error'),
            );
          }
          return;
        }
        case 'download': {
          host.closeMenus();
          const payload = await readTransfer('collection');
          if (!payload) return;
          host.downloadFile({
            content: stringifyBookmarkTransfer(payload, 2),
            filename: `poexd_bookmarks_${new Date().toISOString().split('T')[0]}.json`,
            mimeType: 'application/json',
          });
          return;
        }
      }
    },
  };
}

export function createBrowserBookmarkTransferHost(options: {
  closeMenus(): void;
  showToast(message: string): void;
}): BookmarkTransferHost {
  return {
    closeMenus: options.closeMenus,
    showAlert: async (message, title) => {
      await (window as any).poexdAlert(message, title);
    },
    showToast: options.showToast,
    writeClipboard: (text) => navigator.clipboard.writeText(text),
    downloadFile: downloadTextFile,
  };
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
