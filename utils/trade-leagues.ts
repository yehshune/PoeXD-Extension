import { getTradeVersionProfile, type PoeVersion } from './trade-context';

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
): Promise<TradeLeague[]> {
  const routeRoot = getTradeVersionProfile(version).routeRoot;
  const response = await http(`/api/${routeRoot}/data/leagues`, { credentials: 'same-origin' });
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
