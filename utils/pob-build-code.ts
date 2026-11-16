/**
 * Path of Building 匯出代碼解碼：代碼是 `base64url(zlib(XML))`，用瀏覽器內建的
 * DecompressionStream 解開，全程在本機完成、不連外。
 *
 * 代碼由使用者貼上，視為不可信輸入：限制輸入與解壓後的大小，避免壓縮炸彈。
 */

/** 實際的代碼約數千到數萬字元 */
const MAX_CODE_LENGTH = 400_000;
const MAX_XML_BYTES = 8 * 1024 * 1024;

export type PobBuildCodeErrorCode = 'empty' | 'too-large' | 'invalid';

export class PobBuildCodeError extends Error {
  constructor(readonly code: PobBuildCodeErrorCode) {
    super(`PoB build code: ${code}`);
    this.name = 'PobBuildCodeError';
  }
}

function decodeBase64Url(code: string): Uint8Array {
  const base64 = code.replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new PobBuildCodeError('invalid');
  try {
    return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  } catch {
    throw new PobBuildCodeError('invalid');
  }
}

async function inflate(bytes: Uint8Array): Promise<string> {
  const reader = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate'))
    .getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_XML_BYTES) {
      await reader.cancel();
      throw new PobBuildCodeError('too-large');
    }
    chunks.push(value);
  }
  return new TextDecoder('utf-8').decode(await new Blob(chunks as BlobPart[]).arrayBuffer());
}

/** 解出 PoB 的 build XML；代碼空白、過大或格式不對時丟出 PobBuildCodeError */
export async function decodePobBuildCode(code: string): Promise<string> {
  const compact = typeof code === 'string' ? code.replace(/\s+/g, '') : '';
  if (!compact) throw new PobBuildCodeError('empty');
  if (compact.length > MAX_CODE_LENGTH) throw new PobBuildCodeError('too-large');
  const bytes = decodeBase64Url(compact);
  try {
    return await inflate(bytes);
  } catch (error) {
    if (error instanceof PobBuildCodeError) throw error;
    throw new PobBuildCodeError('invalid');
  }
}
