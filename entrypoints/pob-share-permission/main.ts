import { createApp } from 'vue';
import '@/assets/main.css';
import App from './App.vue';
import { getPreferences } from '@/utils/preferences';
import { applyDocumentLocaleMeta, setActiveDisplayLocalePreference, t } from '@/utils/i18n';
import { applyThemeToHost, readThemeCustomColors } from '@/lib/theme/theme-runtime';
import { syncUiRuntimeTokens } from '@/lib/tokens/ui-contract';

async function bootstrap() {
  try {
    // 顯示語言與主題是共用設定，讀 PoE 1 那份即可
    const outcome = await getPreferences('poe1');
    if (outcome.ok) {
      const snapshot = outcome.value.read();
      setActiveDisplayLocalePreference(snapshot.displayLocale, { hostname: '' });
      applyThemeToHost(document.documentElement, snapshot.theme, readThemeCustomColors(snapshot));
      syncUiRuntimeTokens(document.documentElement, {
        scale: snapshot.fontSizeScale,
        density: snapshot.densityScale,
      });
    }
  } catch (error) {
    console.error('[PoeXD] 授權頁載入設定失敗:', error);
  }
  applyDocumentLocaleMeta(t('pobShare.page.documentTitle'));
  createApp(App).mount('#app');
}

void bootstrap();
