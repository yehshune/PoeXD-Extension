<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { Button } from '@/components/ui/button';
import { t, type I18nKey } from '@/utils/i18n';
import { POB_SHARE_OPTIONAL_ORIGINS } from '@/utils/pob-share-url';

/**
 * PoB 分享網址的選用權限授權頁。`chrome.permissions.request` 只能在擴充頁面由使用者點擊觸發，
 * 側欄（content script）不能直接呼叫，所以由側欄請 background 開這一頁。
 */
const origins = [...POB_SHARE_OPTIONAL_ORIGINS];
const granted = ref<boolean | null>(null);
const noticeKey = ref<I18nKey | null>(null);
const isBusy = ref(false);

const refresh = async () => {
  try {
    granted.value = await chrome.permissions.contains({ origins });
  } catch (error) {
    console.error('[PoeXD] 無法讀取權限狀態:', error);
    granted.value = false;
  }
};

const grant = async () => {
  isBusy.value = true;
  noticeKey.value = null;
  try {
    const ok = await chrome.permissions.request({ origins });
    noticeKey.value = ok ? 'pobShare.page.done' : 'pobShare.page.denied';
  } catch (error) {
    console.error('[PoeXD] 權限請求失敗:', error);
    noticeKey.value = 'pobShare.page.denied';
  } finally {
    isBusy.value = false;
    await refresh();
  }
};

const revoke = async () => {
  isBusy.value = true;
  noticeKey.value = null;
  try {
    await chrome.permissions.remove({ origins });
  } catch (error) {
    console.error('[PoeXD] 取消權限失敗:', error);
  } finally {
    isBusy.value = false;
    await refresh();
  }
};

const handleChange = () => void refresh();

onMounted(() => {
  void refresh();
  chrome.permissions.onAdded?.addListener(handleChange);
  chrome.permissions.onRemoved?.addListener(handleChange);
});
onUnmounted(() => {
  chrome.permissions.onAdded?.removeListener(handleChange);
  chrome.permissions.onRemoved?.removeListener(handleChange);
});
</script>

<template>
  <main class="mx-auto flex max-w-[560px] flex-col gap-4 px-6 py-10">
    <h1 class="m-0 text-xl font-bold">{{ t('pobShare.page.title') }}</h1>
    <p class="m-0 leading-relaxed text-muted-foreground">{{ t('pobShare.page.description') }}</p>
    <p class="m-0 text-sm text-muted-foreground">{{ t('pobShare.page.sites') }}</p>

    <div class="flex items-center gap-3 rounded-md border border-border bg-card px-4 py-3">
      <span
        class="size-2 shrink-0 rounded-full"
        :class="granted ? 'bg-primary' : 'bg-muted-foreground'"
        aria-hidden="true"
      />
      <span data-pob-share-status class="flex-1 font-medium">
        {{ granted ? t('pobShare.page.granted') : t('pobShare.page.notGranted') }}
      </span>
      <Button
        v-if="granted"
        variant="outline"
        size="sm"
        :disabled="isBusy"
        data-pob-share-revoke
        @click="revoke"
      >
        {{ t('pobShare.page.revokeBtn') }}
      </Button>
      <Button
        v-else
        size="sm"
        :disabled="isBusy || granted === null"
        data-pob-share-grant
        @click="grant"
      >
        {{ t('pobShare.page.grantBtn') }}
      </Button>
    </div>

    <p v-if="noticeKey" role="status" class="m-0 text-sm text-muted-foreground">
      {{ t(noticeKey) }}
    </p>
  </main>
</template>
