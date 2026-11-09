import { onMounted, onUnmounted, ref } from 'vue';
import {
  dispatchPoeEvent,
  listenPoeEvent,
  type DialogButtonSpec,
  type DialogButtonVariant,
} from '@/utils/event-contracts';

export type DialogButton = DialogButtonSpec;

function getActiveElementDeep(): Element | null {
  let activeElement = document.activeElement;
  while (activeElement?.shadowRoot?.activeElement) {
    activeElement = activeElement.shadowRoot.activeElement;
  }
  return activeElement;
}

export function installDialogGlobals() {
  (window as any).poexdConfirm = (message: string, title = '確認') =>
    new Promise((resolve) => {
      dispatchPoeEvent('poexd-trigger-dialog', {
        type: 'confirm',
        title,
        message,
        resolve,
      });
    });

  (window as any).poexdPrompt = (message: string, defaultValue = '', title = '輸入') =>
    new Promise((resolve) => {
      dispatchPoeEvent('poexd-trigger-dialog', {
        type: 'prompt',
        title,
        message,
        defaultValue,
        resolve,
      });
    });

  (window as any).poexdAlert = (message: string, title = '提示') =>
    new Promise((resolve) => {
      dispatchPoeEvent('poexd-trigger-dialog', { type: 'alert', title, message, resolve });
    });

  (window as any).poexdCustomDialog = (options: {
    title: string;
    message: string;
    buttons: DialogButton[];
  }) =>
    new Promise((resolve) => {
      dispatchPoeEvent('poexd-trigger-dialog', {
        type: 'custom',
        title: options.title,
        message: options.message,
        buttons: options.buttons,
        resolve,
      });
    });
}

export function useSidebarDialog() {
  const dialogState = ref({
    isOpen: false,
    type: 'confirm' as 'confirm' | 'alert' | 'prompt' | 'custom',
    title: '確認',
    message: '',
    inputValue: '',
    inputPlaceholder: '',
    buttons: [] as DialogButton[],
    confirmLabel: undefined as string | undefined,
    cancelLabel: undefined as string | undefined,
    resolve: null as ((value: any) => void) | null,
  });

  const handleDialogConfirm = () => {
    dialogState.value.resolve?.(
      dialogState.value.type === 'prompt' ? dialogState.value.inputValue : true,
    );
    dialogState.value.isOpen = false;
  };

  const handleDialogCancel = () => {
    dialogState.value.resolve?.(dialogState.value.type === 'prompt' ? null : false);
    dialogState.value.isOpen = false;
  };

  const handleCustomButtonClick = (value: any) => {
    dialogState.value.resolve?.(value);
    dialogState.value.isOpen = false;
  };

  const handleDialogDismiss = () => {
    if (dialogState.value.type === 'custom' && dialogState.value.buttons.length > 0) {
      const cancelButton = dialogState.value.buttons.find(
        (button) => button.value === 'cancel' || button.label.includes('取消'),
      );
      handleCustomButtonClick(cancelButton?.value ?? dialogState.value.buttons.at(-1)?.value);
    } else {
      handleDialogCancel();
    }
  };

  const handleDialogKeydown = (event: KeyboardEvent) => {
    if (!dialogState.value.isOpen) return;

    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (dialogState.value.type === 'custom' && dialogState.value.buttons.length > 0) {
        handleCustomButtonClick(dialogState.value.buttons[0].value);
      } else {
        handleDialogConfirm();
      }
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      handleDialogDismiss();
      return;
    }

    if (
      dialogState.value.type === 'prompt' &&
      getActiveElementDeep()?.classList.contains('dialog-input')
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  };

  const removeDialogListener = listenPoeEvent('poexd-trigger-dialog', (detail) => {
    dialogState.value.type = detail.type;
    dialogState.value.title =
      detail.title ||
      (detail.type === 'confirm' ? '確認' : detail.type === 'prompt' ? '輸入' : '提示');
    dialogState.value.message = detail.message || '';
    dialogState.value.inputValue = detail.defaultValue || '';
    dialogState.value.buttons = detail.buttons || [];
    dialogState.value.confirmLabel = detail.confirmLabel;
    dialogState.value.cancelLabel = detail.cancelLabel;
    dialogState.value.resolve = detail.resolve;
    dialogState.value.isOpen = true;
  });

  onMounted(() => {
    window.addEventListener('keydown', handleDialogKeydown, true);
  });
  onUnmounted(() => {
    window.removeEventListener('keydown', handleDialogKeydown, true);
    removeDialogListener();
  });

  return {
    dialogState,
    handleDialogConfirm,
    handleDialogCancel,
    handleCustomButtonClick,
    handleDialogDismiss,
  };
}
