import {
  parsePoeSearchQueryObserved,
  type PoeSearchQueryObservedSource,
} from '@/utils/event-contracts';
import { parseTradeSearchUrl } from '@/utils/trade-search-identity';

export type SearchQueryObservationSource = PoeSearchQueryObservedSource;

export interface ResolvedSearchQueryObservation {
  searchId: string;
  criteria: unknown;
  source?: SearchQueryObservationSource;
}

export function resolveSearchQueryObservation(
  detail: string,
  currentUrl: string,
): ResolvedSearchQueryObservation | undefined {
  const event = parsePoeSearchQueryObserved(detail);
  if (!event) return undefined;

  try {
    const searchId =
      event.searchId && event.searchId.trim()
        ? event.searchId.trim()
        : parseTradeSearchUrl(currentUrl)?.searchId;
    if (!searchId) return undefined;
    const requestBody = JSON.parse(event.queryJson) as unknown;
    const criteria =
      requestBody && typeof requestBody === 'object' && !Array.isArray(requestBody)
        ? (requestBody as Record<string, unknown>).query
        : null;
    return { searchId, criteria, source: event.source };
  } catch {
    return undefined;
  }
}
