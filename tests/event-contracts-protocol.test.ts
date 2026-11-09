// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  dispatchPoeEvent,
  initPoeEventNonce,
  listenPoeEvent,
  parsePoeFetchResponse,
  parsePoeKnownStats,
  parsePoeMoveStatFilter,
  parsePoeSearchQueryObserved,
  serializePoeFetchResponse,
  serializePoeKnownStats,
  serializePoeMoveStatFilter,
  serializePoeSearchQueryObserved,
  type PoeContentInternalEventMap,
  type PoeContentToMainEventMap,
  type PoeCrossWorldEventMap,
  type PoeEventMap,
  type PoeFetchResponsePayload,
  type PoeKnownStatsPayload,
  type PoeMainToContentEventMap,
  type PoeMoveStatFilterPayload,
  type PoeSearchQueryObservedPayload,
} from '@/utils/event-contracts';

// Type-level compile-time contract assertions
type Assert<T extends true> = T;
type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
type Keys<T> = keyof T;

type MainToContentKeys = Keys<PoeMainToContentEventMap>;
type ContentToMainKeys = Keys<PoeContentToMainEventMap>;
type CrossWorldKeys = Keys<PoeCrossWorldEventMap>;
type ContentInternalKeys = Keys<PoeContentInternalEventMap>;
type AllEventKeys = Keys<PoeEventMap>;

type ExpectedMainToContent =
  | 'poexd-history-changed'
  | 'poexd-fetch-response'
  | 'poexd-search-query-observed'
  | 'poexd-search-triggered'
  | 'poexd-known-stats'
  | 'poexd-equipment-type-changed'
  | 'poexd-livesearch-command-result'
  | 'poexd-criteria-overlay-read-result'
  | 'poexd-criteria-overlay-commit-result';
type _MainToContentExact = Assert<Equal<MainToContentKeys, ExpectedMainToContent>>;

type ExpectedContentToMain =
  | 'poexd-request-known-stats'
  | 'poexd-request-official-category'
  | 'poexd-add-stat-filter'
  | 'poexd-update-stat-category'
  | 'poexd-move-stat-filter'
  | 'poexd-livesearch-ensure-container'
  | 'poexd-livesearch-render-result'
  | 'poexd-livesearch-reset-unread'
  | 'poexd-livesearch-sync-total'
  | 'poexd-livesearch-console-guard'
  | 'poexd-criteria-overlay-read'
  | 'poexd-criteria-overlay-commit';
type _ContentToMainExact = Assert<Equal<ContentToMainKeys, ExpectedContentToMain>>;

type ExpectedInternal =
  | 'poexd-close-affix-modal'
  | 'poexd-modal-active-changed'
  | 'poexd-open-affix-modal'
  | 'poexd-request-result-images'
  | 'poexd-result-images'
  | 'poexd-sidebar-collapsed-changed'
  | 'poexd-sidebar-resizing-changed'
  | 'poexd-sidebar-width-preview'
  | 'poexd-toast'
  | 'poexd-trigger-dialog'
  | 'poexd-trigger-select-type-modal';
type _InternalExact = Assert<Equal<ContentInternalKeys, ExpectedInternal>>;

type _CrossNoOverlap = Assert<Equal<MainToContentKeys & ContentToMainKeys, never>>;
type _CrossInternalNoOverlap = Assert<Equal<CrossWorldKeys & ContentInternalKeys, never>>;
type _AllKeysIsUnion = Assert<Equal<AllEventKeys, CrossWorldKeys | ContentInternalKeys>>;

describe('Event Protocol Hardening (Phase 2)', () => {
  beforeEach(() => {
    initPoeEventNonce('test-nonce-123');
  });

  describe('1. Event classification & completeness (Type-level assertions)', () => {
    it('enforces event classification, separation, and non-overlap at compile time', () => {
      // Type assertions (_MainToContentExact, _ContentToMainExact, _InternalExact, _CrossNoOverlap, _CrossInternalNoOverlap, _AllKeysIsUnion)
      // are statically checked by TypeScript during build / test compilation.
      expect(true).toBe(true);
    });
  });

  describe('2. Active cross-world codecs & validation parsing', () => {
    describe('poexd-fetch-response', () => {
      it('parses realistic Main World fetch response wire fixture and rejects malformed inputs', () => {
        const realisticMainWorldFixture = JSON.stringify({
          url: '/api/trade/fetch/item-abc-123?query=search-xyz',
          data: {
            result: [
              {
                id: 'item-abc-123',
                item: { icon: 'https://web.poecdn.com/gen/image/.../item.png' },
              },
            ],
          },
        });
        const parsed = parsePoeFetchResponse(realisticMainWorldFixture);
        expect(parsed).toEqual({
          url: '/api/trade/fetch/item-abc-123?query=search-xyz',
          data: {
            result: [
              {
                id: 'item-abc-123',
                item: { icon: 'https://web.poecdn.com/gen/image/.../item.png' },
              },
            ],
          },
        });

        // 拒絕無效格式
        expect(parsePoeFetchResponse(null)).toBeUndefined();
        expect(parsePoeFetchResponse('')).toBeUndefined();
        expect(parsePoeFetchResponse('not json')).toBeUndefined();
        expect(parsePoeFetchResponse(JSON.stringify({ data: {} }))).toBeUndefined(); // 缺少 url
        expect(parsePoeFetchResponse(JSON.stringify({ url: 123 }))).toBeUndefined(); // url 非字串
      });

      it('serializes canonical fetch payload to wire JSON matching parser contract', () => {
        const payload: PoeFetchResponsePayload = {
          url: '/api/trade/fetch/item-123',
          data: { result: [{ id: 'item-123' }] },
        };
        const serialized = serializePoeFetchResponse(payload);
        expect(typeof serialized).toBe('string');
        expect(parsePoeFetchResponse(serialized)).toEqual(payload);
      });
    });

    describe('poexd-search-query-observed', () => {
      it('parses realistic search-response wire fixture from Main World network interception', () => {
        const searchResponseFixture = JSON.stringify({
          searchId: 'search-abc',
          queryJson: '{"query":{"status":{"option":"online"}}}',
          source: 'search-response',
        });
        const parsed = parsePoeSearchQueryObserved(searchResponseFixture);

        expect(parsed).toEqual({
          searchId: 'search-abc',
          queryJson: '{"query":{"status":{"option":"online"}}}',
          source: 'search-response',
        });
      });

      it('parses realistic current-query wire fixture from Main World store probe', () => {
        const currentQueryFixture = JSON.stringify({
          queryJson: '{"query":{"status":{"option":"any"}}}',
          source: 'current-query',
        });
        const parsed = parsePoeSearchQueryObserved(currentQueryFixture);

        expect(parsed).toEqual({
          searchId: undefined,
          queryJson: '{"query":{"status":{"option":"any"}}}',
          source: 'current-query',
        });
      });

      it('normalizes unrecognized or missing source to undefined while requiring valid queryJson', () => {
        const unrecognizedSourceFixture = JSON.stringify({
          queryJson: '{"query":{"status":{"option":"any"}}}',
          source: 'unknown-source',
        });
        const parsed = parsePoeSearchQueryObserved(unrecognizedSourceFixture);
        expect(parsed).toEqual({
          searchId: undefined,
          queryJson: '{"query":{"status":{"option":"any"}}}',
          source: undefined,
        });

        const missingSourceFixture = JSON.stringify({
          searchId: 'search-1',
          queryJson: '{"query":{}}',
        });
        const parsedMissing = parsePoeSearchQueryObserved(missingSourceFixture);
        expect(parsedMissing).toEqual({
          searchId: 'search-1',
          queryJson: '{"query":{}}',
          source: undefined,
        });
      });

      it('rejects malformed inputs missing queryJson or with non-string queryJson', () => {
        expect(parsePoeSearchQueryObserved(null)).toBeUndefined();
        expect(parsePoeSearchQueryObserved('malformed json {')).toBeUndefined();
        expect(parsePoeSearchQueryObserved(JSON.stringify({ searchId: '123' }))).toBeUndefined(); // 缺少 queryJson
        expect(parsePoeSearchQueryObserved(JSON.stringify({ queryJson: 12345 }))).toBeUndefined(); // queryJson 非字串
      });

      it('serializes canonical observed query payload to wire JSON matching parser contract', () => {
        const payload: PoeSearchQueryObservedPayload = {
          searchId: 'search-xyz',
          queryJson: '{"query":{}}',
          source: 'search-response',
        };
        const serialized = serializePoeSearchQueryObserved(payload);
        expect(typeof serialized).toBe('string');
        expect(parsePoeSearchQueryObserved(serialized)).toEqual(payload);
      });
    });

    describe('poexd-move-stat-filter', () => {
      it('serializes 4 integer indexes to exact wire format JSON string and parses them back', () => {
        const payload: PoeMoveStatFilterPayload = {
          fromGroup: 0,
          fromFilter: 2,
          toGroup: 1,
          toFilter: 0,
        };
        const serialized = serializePoeMoveStatFilter(payload);
        expect(serialized).toBe('{"fromGroup":0,"fromFilter":2,"toGroup":1,"toFilter":0}');
        expect(parsePoeMoveStatFilter(serialized)).toEqual(payload);
      });

      it('rejects malformed inputs (invalid JSON, missing field, string, negative, fractional, non-object)', () => {
        expect(parsePoeMoveStatFilter('not-json')).toBeNull();
        expect(parsePoeMoveStatFilter(null)).toBeNull();
        expect(parsePoeMoveStatFilter(JSON.stringify('string-payload'))).toBeNull();
        expect(parsePoeMoveStatFilter(JSON.stringify([0, 1, 2, 3]))).toBeNull();
        expect(
          parsePoeMoveStatFilter(JSON.stringify({ fromGroup: 0, fromFilter: 1, toGroup: 2 })),
        ).toBeNull();
        expect(
          parsePoeMoveStatFilter(
            JSON.stringify({ fromGroup: '0', fromFilter: 1, toGroup: 2, toFilter: 3 }),
          ),
        ).toBeNull();
        expect(
          parsePoeMoveStatFilter(
            JSON.stringify({ fromGroup: -1, fromFilter: 1, toGroup: 2, toFilter: 3 }),
          ),
        ).toBeNull();
        expect(
          parsePoeMoveStatFilter(
            JSON.stringify({ fromGroup: 0.5, fromFilter: 1, toGroup: 2, toFilter: 3 }),
          ),
        ).toBeNull();
      });
    });

    describe('poexd-known-stats', () => {
      it('parses realistic knownStats wire fixture from Main World static data probe', () => {
        const knownStatsFixture = JSON.stringify({
          stat_life: {
            id: 'explicit.stat_life',
            text: '+# to maximum Life',
            type: 'explicit',
          },
          stat_mana: {
            id: 'explicit.stat_mana',
            text: '+# to maximum Mana',
            type: 'explicit',
          },
        });
        const parsed = parsePoeKnownStats(knownStatsFixture);

        expect(parsed).toEqual({
          stat_life: {
            id: 'explicit.stat_life',
            text: '+# to maximum Life',
            type: 'explicit',
          },
          stat_mana: {
            id: 'explicit.stat_mana',
            text: '+# to maximum Mana',
            type: 'explicit',
          },
        });
      });

      it('accepts legitimate empty dictionary', () => {
        expect(parsePoeKnownStats('{}')).toEqual({});
      });

      it('rejects payload if any entry is malformed without returning partial or empty dictionary', () => {
        // 1. Partial invalid entry (missing fields)
        const partialInvalidFixture = JSON.stringify({
          stat_life: {
            id: 'explicit.stat_life',
            text: '+# to maximum Life',
            type: 'explicit',
          },
          stat_broken: {
            id: 'explicit.stat_broken',
            // missing text and type
          },
        });
        expect(parsePoeKnownStats(partialInvalidFixture)).toBeUndefined();

        // 2. Non-object entry
        const nonObjectEntryFixture = JSON.stringify({
          stat_life: {
            id: 'explicit.stat_life',
            text: '+# to maximum Life',
            type: 'explicit',
          },
          stat_broken: 'invalid string entry',
        });
        expect(parsePoeKnownStats(nonObjectEntryFixture)).toBeUndefined();

        // 3. Null entry
        const nullEntryFixture = JSON.stringify({
          stat_life: {
            id: 'explicit.stat_life',
            text: '+# to maximum Life',
            type: 'explicit',
          },
          stat_broken: null,
        });
        expect(parsePoeKnownStats(nullEntryFixture)).toBeUndefined();
      });

      it('rejects malformed top-level inputs for known stats', () => {
        expect(parsePoeKnownStats(null)).toBeUndefined();
        expect(parsePoeKnownStats('')).toBeUndefined();
        expect(parsePoeKnownStats('bad-json')).toBeUndefined();
        expect(parsePoeKnownStats(JSON.stringify(['array', 'not', 'allowed']))).toBeUndefined();
        expect(parsePoeKnownStats(JSON.stringify('string not allowed'))).toBeUndefined();
      });

      it('serializes canonical known stats payload to wire JSON matching parser contract', () => {
        const payload: PoeKnownStatsPayload = {
          stat_life: {
            id: 'explicit.stat_life',
            text: '+# to maximum Life',
            type: 'explicit',
          },
        };
        const serialized = serializePoeKnownStats(payload);
        expect(typeof serialized).toBe('string');
        expect(parsePoeKnownStats(serialized)).toEqual(payload);
      });
    });
  });

  describe('3. Nonce & Security Envelope Invariants', () => {
    it('dispatches CustomEvent with source "poexd" and activeNonce', () => {
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
      dispatchPoeEvent('poexd-history-changed');

      expect(dispatchSpy).toHaveBeenCalledTimes(1);
      const event = dispatchSpy.mock.calls[0][0] as CustomEvent;
      expect(event.type).toBe('poexd-history-changed');
      expect(event.detail).toEqual({
        source: 'poexd',
        nonce: 'test-nonce-123',
        payload: undefined,
      });
    });

    it('listens and accepts events with correct source and activeNonce', () => {
      const listener = vi.fn();
      const unsubscribe = listenPoeEvent('poexd-history-changed', listener);

      dispatchPoeEvent('poexd-history-changed');
      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();
    });

    it('rejects events with invalid source or mismatched nonce', () => {
      const listener = vi.fn();
      const unsubscribe = listenPoeEvent('poexd-history-changed', listener);

      // 1. 偽造來源 (source !== 'poexd')
      window.dispatchEvent(
        new CustomEvent('poexd-history-changed', {
          detail: { source: 'malicious-script', nonce: 'test-nonce-123' },
        }),
      );
      expect(listener).not.toHaveBeenCalled();

      // 2. 錯誤 Nonce
      window.dispatchEvent(
        new CustomEvent('poexd-history-changed', {
          detail: { source: 'poexd', nonce: 'wrong-nonce' },
        }),
      );
      expect(listener).not.toHaveBeenCalled();

      // 3. 空 detail
      window.dispatchEvent(new CustomEvent('poexd-history-changed', { detail: null }));
      expect(listener).not.toHaveBeenCalled();

      unsubscribe();
    });

    it('supports nonce rotation and rejects events signed with old nonce', () => {
      const listener = vi.fn();
      const unsubscribe = listenPoeEvent('poexd-history-changed', listener);

      // 旋轉至新 Nonce
      initPoeEventNonce('rotated-nonce-456');

      // 使用舊 Nonce 派發：應被忽略
      window.dispatchEvent(
        new CustomEvent('poexd-history-changed', {
          detail: { source: 'poexd', nonce: 'test-nonce-123' },
        }),
      );
      expect(listener).not.toHaveBeenCalled();

      // 使用新 Nonce 派發：應成功接收
      dispatchPoeEvent('poexd-history-changed');
      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();
    });
  });
});
