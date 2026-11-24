import "server-only";

/**
 * The body of an answer from another service as text, at most `maxBytes` of it: the rest is not read, and the stream is let go. For the
 * calls whose answers are small and whose host is not ours (VIES, D157; Leadfeeder, D890), so a huge or endless answer cannot fill memory.
 */
export async function cappedText(response: Response, maxBytes: number): Promise<string> {
  const body = response.body;
  if (!body) return (await response.text()).slice(0, maxBytes);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  return new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))).slice(0, maxBytes);
}
