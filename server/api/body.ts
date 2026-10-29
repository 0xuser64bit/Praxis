import { PraxisInputError } from "../errors";

export async function readLimitedText(request: Request, maxBytes: number): Promise<string> {
  const tooLarge = () => new PraxisInputError(`Request body must be ${maxBytes} bytes or smaller`);
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > maxBytes) {
    await request.body?.cancel().catch(() => undefined);
    throw tooLarge();
  }
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw tooLarge();
      }
      if (value.byteLength > 0) chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return new TextDecoder().decode(Buffer.concat(chunks, totalBytes));
}
