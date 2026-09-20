export async function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });

  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * The structural slice of `fetch` this codebase actually calls. Narrower than
 * `typeof fetch`, which in a DOM lib also carries non-standard members (e.g.
 * `preconnect`) that a test double or a polyfill has no reason to implement.
 * Injecting a plain async function is then type-safe without a cast.
 */
export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export async function fetchWithTimeout(
  input: string | URL | Request,
  init: RequestInit = {},
  opts: { ms: number; label: string },
  fetchImpl: FetchLike = fetch,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.ms);
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`${opts.label} timed out after ${opts.ms}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function envTimeout(name: string, fallbackMs: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallbackMs;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallbackMs;
}
