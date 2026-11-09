export interface DownloadFileOptions {
  content: string;
  filename: string;
  mimeType: string;
}

/** 以暫時的 object URL 觸發瀏覽器下載文字檔。 */
export function downloadTextFile({ content, filename, mimeType }: DownloadFileOptions): void {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
