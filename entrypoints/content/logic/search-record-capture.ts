import type { PoeVersion } from '@/utils/trade-context';
import type { SearchRecordOutcome } from '@/utils/search-records';
import type { SearchRecordClient } from '@/utils/search-record-messaging';
import { parseTradeSearchUrl } from '@/utils/trade-search-identity';

export interface SearchRecordObservation {
  gameVersion: PoeVersion;
  url: string;
  name?: string;
  icon?: string;
}

export function createSearchRecordCaptureAdapter(
  client: SearchRecordClient,
  now: () => number = Date.now,
) {
  const validate = (observation: SearchRecordObservation): SearchRecordOutcome | undefined => {
    try {
      const identity = parseTradeSearchUrl(observation.url);
      if (!identity || identity.gameVersion !== observation.gameVersion) throw new Error();
    } catch {
      return {
        ok: false,
        error: {
          code: 'invalid-identity',
          message: 'Page observation requires a valid Trade search URL',
        },
      };
    }
    return undefined;
  };

  return {
    captureSearchUse(observation: SearchRecordObservation) {
      const invalid = validate(observation);
      if (invalid) return Promise.resolve(invalid);
      return client.execute({
        type: 'record-history',
        identity: {
          gameVersion: observation.gameVersion,
          url: observation.url,
        },
        entry: {
          name: observation.name?.trim() || '未命名搜尋',
          url: observation.url,
          ...(observation.icon ? { icon: observation.icon } : {}),
        },
      });
    },
    captureEnrichment(observation: SearchRecordObservation) {
      const invalid = validate(observation);
      if (invalid) return Promise.resolve(invalid);
      return client.execute({
        type: 'upsert-search-record',
        identity: {
          gameVersion: observation.gameVersion,
          url: observation.url,
        },
        patch: {
          ...(observation.name?.trim() ? { name: observation.name.trim() } : {}),
          ...(observation.icon ? { icon: observation.icon } : {}),
          url: observation.url,
        },
        usedAt: now(),
      });
    },
  };
}
