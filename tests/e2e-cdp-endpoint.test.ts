import { describe, expect, it } from 'vitest';
import { getCdpCandidateUrls, isDevBrowserVersion } from '../e2e/cdp-endpoint';

describe('getCdpCandidateUrls', () => {
  it('同一個埠先試 IPv4 再試 IPv6（IPv4 被佔用時 Chrome 只會聽在 [::1]）', () => {
    expect(getCdpCandidateUrls({})).toEqual(['http://127.0.0.1:9222', 'http://[::1]:9222']);
  });

  it('使用 POEXD_CDP_PORT 指定的埠', () => {
    expect(getCdpCandidateUrls({ POEXD_CDP_PORT: '9333' })).toEqual([
      'http://127.0.0.1:9333',
      'http://[::1]:9333',
    ]);
  });

  it('POEXD_CDP_URL 明確指定時只用它', () => {
    expect(
      getCdpCandidateUrls({ POEXD_CDP_URL: 'http://localhost:9400', POEXD_CDP_PORT: '9333' }),
    ).toEqual(['http://localhost:9400']);
  });
});

describe('isDevBrowserVersion', () => {
  it('接受一般 Chrome', () => {
    expect(
      isDevBrowserVersion({
        Browser: 'Chrome/142.0.7444.60',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
      }),
    ).toBe(true);
  });

  it('拒絕同埠上的 Electron 應用程式', () => {
    expect(
      isDevBrowserVersion({
        Browser: 'Chrome/138.0.7204.97',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) poexd/1.0.0 Chrome/138.0.7204.97 Electron/37.2.0 Safari/537.36',
      }),
    ).toBe(false);
  });

  it('拒絕缺少版本資訊的回應', () => {
    expect(isDevBrowserVersion(null)).toBe(false);
    expect(isDevBrowserVersion({})).toBe(false);
  });
});
