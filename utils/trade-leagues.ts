import { getTradeVersionProfile, type PoeVersion } from './trade-context';
import { withTimeout } from './promise-timeout';

export const DEFAULT_TRADE_LEAGUES_TIMEOUT_MS = 5000;

export interface TradeLeague {
  id: string;
  text: string;
}

type TradeLeagueHttpClient = (
  url: string,
  init: RequestInit,
) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

export async function fetchTradeLeagues(
  version: PoeVersion,
  http: TradeLeagueHttpClient = fetch,
  timeoutMs: number = DEFAULT_TRADE_LEAGUES_TIMEOUT_MS,
): Promise<TradeLeague[]> {
  const routeRoot = getTradeVersionProfile(version).routeRoot;
  const controller =
    http === fetch && typeof AbortController !== 'undefined' ? new AbortController() : undefined;
  const init: RequestInit = controller
    ? { credentials: 'same-origin', signal: controller.signal }
    : { credentials: 'same-origin' };

  let response: Pick<Response, 'ok' | 'status' | 'json'>;
  try {
    response = await withTimeout(
      http(`/api/${routeRoot}/data/leagues`, init),
      timeoutMs,
      '市集聯盟讀取逾時',
    );
  } catch (err) {
    controller?.abort();
    throw err;
  }
  if (!response.ok) throw new Error(`市集聯盟讀取失敗 (${response.status})`);
  const payload = (await response.json()) as unknown;
  if (!isObject(payload) || !Array.isArray(payload.result)) {
    throw new Error('市集聯盟資料格式錯誤');
  }
  const realm = version === 'poe1' ? 'pc' : 'poe2';
  const leagues = payload.result
    .filter(
      (item) =>
        isObject(item) &&
        item.realm === realm &&
        typeof item.id === 'string' &&
        item.id.trim() &&
        typeof item.text === 'string' &&
        item.text.trim(),
    )
    .map((item) => ({ id: item.id.trim(), text: item.text.trim() }));
  return Array.from(new Map(leagues.map((league) => [league.id, league])).values());
}

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
