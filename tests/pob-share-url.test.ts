import { describe, expect, it } from 'vitest';
import { looksLikePobShareUrl, parsePobShareUrl } from '@/utils/pob-share-url';

describe('looksLikePobShareUrl', () => {
  it('網址與省略協定的支援網站視為網址，PoB 代碼不是', () => {
    expect(looksLikePobShareUrl(' https://poe.ninja/poe1/pob/abc')).toBe(true);
    expect(looksLikePobShareUrl('http://example.com/x')).toBe(true);
    expect(looksLikePobShareUrl('pobb.in/abcd')).toBe(true);
    expect(looksLikePobShareUrl('www.pastebin.com/abcd')).toBe(true);
    expect(looksLikePobShareUrl('eNrtXVtz2ziW_ivqfhh')).toBe(false);
  });
});

describe('parsePobShareUrl', () => {
  it('poe.ninja 分享頁換成原始代碼網址，舊網址與 raw 網址都接受，不需選用權限', () => {
    expect(parsePobShareUrl('https://poe.ninja/poe2/pob/abc_1-2')).toEqual({
      site: 'poe-ninja',
      rawUrl: 'https://poe.ninja/poe2/pob/raw/abc_1-2',
    });
    expect(parsePobShareUrl('https://www.poe.ninja/pob/abc')?.rawUrl).toBe(
      'https://poe.ninja/poe1/pob/raw/abc',
    );
    expect(parsePobShareUrl('poe.ninja/poe1/pob/raw/abc/')?.rawUrl).toBe(
      'https://poe.ninja/poe1/pob/raw/abc',
    );
  });

  it('pobb.in 與 pastebin 需要選用權限，raw 網址由這裡組出', () => {
    expect(parsePobShareUrl('https://pobb.in/AbCd-123')).toEqual({
      site: 'pobb-in',
      rawUrl: 'https://pobb.in/AbCd-123/raw',
      optionalOrigin: 'https://pobb.in/*',
    });
    expect(parsePobShareUrl('http://pastebin.com/raw/Xy12Ab34?foo=1#x')).toEqual({
      site: 'pastebin',
      rawUrl: 'https://pastebin.com/raw/Xy12Ab34',
      optionalOrigin: 'https://pastebin.com/*',
    });
  });

  it('拒絕白名單以外的網站、相似網域、其他路徑', () => {
    for (const input of [
      'https://example.com/pob/abc',
      'https://poe.ninja.evil.com/poe1/pob/abc',
      'https://evilpoe.ninja/poe1/pob/abc',
      'https://poe.ninja/poe1/builds/abc',
      'https://poe.ninja/poe3/pob/abc',
      'https://poe.ninja/poe1/pob/abc/def',
      'https://pobb.in/u/someone',
      'https://pobb.in/abc',
      'https://pastebin.com/u/someone',
      'https://pastebin.com/abc-def',
    ]) {
      expect(parsePobShareUrl(input), input).toBeUndefined();
    }
  });

  it('拒絕帳密、連接埠、其他協定、過長或空白輸入', () => {
    for (const input of [
      'https://user:pw@poe.ninja/poe1/pob/abc',
      'https://poe.ninja:8443/poe1/pob/abc',
      'ftp://poe.ninja/poe1/pob/abc',
      'javascript:alert(1)',
      `https://poe.ninja/poe1/pob/${'a'.repeat(600)}`,
      '   ',
    ]) {
      expect(parsePobShareUrl(input), input).toBeUndefined();
    }
    expect(parsePobShareUrl(42 as never)).toBeUndefined();
  });
});
