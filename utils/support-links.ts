/**
 * 贊助管道。之後新增管道（例如綠界）時在此加一筆即可，工具分頁會依序顯示。
 * 同步更新 `.github/FUNDING.yml` 與 README 的贊助段落。
 */
export interface SupportLink {
  readonly id: string;
  /** 平台名稱（不翻譯） */
  readonly label: string;
  readonly url: string;
}

export const SUPPORT_LINKS: readonly SupportLink[] = Object.freeze([
  { id: 'ko-fi', label: 'Ko-fi', url: 'https://ko-fi.com/shu540886' },
]);
