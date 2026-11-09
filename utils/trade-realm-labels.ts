import { t } from './i18n';
import { getTradeRealmLabelKey } from './trade-realms';

/** UI 端：依市集網址取得目前語系的網域顯示名稱；非支援網域回傳 `undefined`。 */
export function getTradeRealmLabel(url: string): string | undefined {
  const key = getTradeRealmLabelKey(url);
  return key ? t(key) : undefined;
}
