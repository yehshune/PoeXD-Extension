import { describe, expect, it } from 'vitest';
import {
  parseFetchFailure,
  parseSearchResultSummary,
  parseWhisperOutcome,
  readGoneFetchIds,
  readMissingFetchIds,
  readWhisperErrorCode,
  readWhisperSuccess,
  serializeFetchFailure,
  serializeSearchResultSummary,
  serializeWhisperOutcome,
  summarizeSearchResponse,
} from '@/utils/result-board/board-events';

describe('summarizeSearchResponse', () => {
  it('reads the id, result count, total and inexact flag', () => {
    expect(
      summarizeSearchResponse({ id: 'abc', result: ['1', '2'], total: 10000, inexact: true }),
    ).toEqual({ searchId: 'abc', total: 10000, resultCount: 2, inexact: true });
    expect(summarizeSearchResponse({ id: 'abc', result: [], total: 0 })).toEqual({
      searchId: 'abc',
      total: 0,
      resultCount: 0,
      inexact: false,
    });
  });

  it('rejects malformed responses', () => {
    expect(summarizeSearchResponse(null)).toBeUndefined();
    expect(summarizeSearchResponse({ id: '', result: [], total: 0 })).toBeUndefined();
    expect(summarizeSearchResponse({ id: 'a', result: 'x', total: 0 })).toBeUndefined();
    expect(summarizeSearchResponse({ id: 'a', result: [], total: -1 })).toBeUndefined();
    expect(summarizeSearchResponse({ id: 'a', result: [], total: 1.5 })).toBeUndefined();
  });
});

describe('wire round trips', () => {
  it('round-trips a search summary and validates it', () => {
    const summary = { searchId: 's', total: 5, resultCount: 5, inexact: false };
    expect(parseSearchResultSummary(serializeSearchResultSummary(summary))).toEqual(summary);
    expect(
      parseSearchResultSummary('{"searchId":"s","total":"5","resultCount":5}'),
    ).toBeUndefined();
    expect(parseSearchResultSummary('not json')).toBeUndefined();
    expect(parseSearchResultSummary({ searchId: 's' })).toBeUndefined();
    expect(parseSearchResultSummary('[]')).toBeUndefined();
  });

  it('round-trips a fetch failure and validates it', () => {
    const failure = { url: '/api/trade/fetch/a?query=s', status: 429 };
    expect(parseFetchFailure(serializeFetchFailure(failure))).toEqual(failure);
    expect(parseFetchFailure('{"url":1,"status":429}')).toBeUndefined();
    expect(parseFetchFailure('{"url":"x","status":99999}')).toBeUndefined();
  });

  it('round-trips a whisper outcome and drops invalid fields', () => {
    expect(parseWhisperOutcome(serializeWhisperOutcome({ status: 404, code: 1 }))).toEqual({
      status: 404,
      code: 1,
    });
    expect(parseWhisperOutcome(serializeWhisperOutcome({ status: 200, success: true }))).toEqual({
      status: 200,
      success: true,
    });
    expect(parseWhisperOutcome('{"status":200,"code":"1","success":"true"}')).toEqual({
      status: 200,
    });
    expect(parseWhisperOutcome('{"code":1}')).toBeUndefined();
  });
});

describe('readWhisperErrorCode and readWhisperSuccess', () => {
  it('reads the official error code and success flag', () => {
    expect(readWhisperErrorCode({ error: { code: 1, message: 'gone' } })).toBe(1);
    expect(readWhisperErrorCode({ success: true })).toBeUndefined();
    expect(readWhisperErrorCode({ error: { code: 'x' } })).toBeUndefined();
    expect(readWhisperErrorCode(undefined)).toBeUndefined();

    expect(readWhisperSuccess({ success: true })).toBe(true);
    expect(readWhisperSuccess({ success: false })).toBe(false);
    expect(readWhisperSuccess({ success: 'true' })).toBeUndefined();
    expect(readWhisperSuccess(undefined)).toBeUndefined();
  });
});

describe('readMissingFetchIds', () => {
  const url = 'https://www.pathofexile.com/api/trade/fetch/a,b,c?query=s1';

  it('lists requested ids the official fetch returned as null', () => {
    expect(readMissingFetchIds(url, { result: [{ id: 'a' }, null, { id: 'c' }] })).toEqual(['b']);
  });

  it('returns nothing when the url or body is not a fetch', () => {
    expect(readMissingFetchIds('https://www.pathofexile.com/api/trade/search/x', {})).toEqual([]);
    expect(readMissingFetchIds(url, { result: 'nope' })).toEqual([]);
    expect(readMissingFetchIds(url, null)).toEqual([]);
    expect(readMissingFetchIds('http://[bad', { result: [] })).toEqual([]);
  });
});

describe('readGoneFetchIds', () => {
  it('lists ids marked with gone: true in a fetch response', () => {
    expect(
      readGoneFetchIds({
        result: [{ id: 'a', gone: true }, { id: 'b', gone: false }, null, { id: 'c' }],
      }),
    ).toEqual(['a']);
    expect(readGoneFetchIds(null)).toEqual([]);
  });
});
