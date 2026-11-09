import { createApp } from 'vue';
import '@/assets/main.css';
import App from './App.vue';
import { getPreferences } from '@/utils/preferences';
import { applyDocumentLocaleMeta, setActiveDisplayLocalePreference, t } from '@/utils/i18n';
import { applyThemeToHost } from '@/lib/theme/theme-runtime';
import { syncUiRuntimeTokens } from '@/lib/tokens/ui-contract';
import { queryActiveTabTradeContext } from '@/utils/trade-context';

async function bootstrap() {
  const context = await queryActiveTabTradeContext();

  try {
    const outcome = await getPreferences(context.version);
    if (outcome.ok) {
      const snapshot = outcome.value.read();
      setActiveDisplayLocalePreference(snapshot.displayLocale, { hostname: '' });
      applyDocumentLocaleMeta(t('popup.documentTitle'));
      applyThemeToHost(document.documentElement, snapshot.theme);
      syncUiRuntimeTokens(document.documentElement, {
        scale: snapshot.fontSizeScale,
        density: snapshot.densityScale,
      });
    }
  } catch (err) {
    console.error('[PoeXD Popup] 預載入主題失敗:', err);
  }

  createApp(App, {
    initialVersion: context.version,
    initialIsTradePage: context.isTradePage,
  }).mount('#app');
}

void bootstrap();
