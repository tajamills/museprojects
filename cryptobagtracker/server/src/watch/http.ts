import { createHash } from "node:crypto";

// Shared HTTP helper for chain data providers: timeout, bounded retries with
// backoff, 429 awareness, and a payload hash so every stored snapshot/event
// can be tied back to exactly what a provider returned (spec §3.4).

export interface FetchResult<T> {
  data: T;
  rawText: string;
  payloadHash: string;
  rateLimited: boolean;
}

export class ProviderError extends Error {
  rateLimited = false;
  status = 0;
  constructor(message: string) {
    super(message);
    this.name = "ProviderError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchJsonWithRetry<T>(
  url: string,
  opts: { timeoutMs?: number; retries?: number; headers?: Record<string, string>; body?: unknown } = {},
): Promise<FetchResult<T>> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const retries = opts.retries ?? 2;
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: opts.body !== undefined ? "POST" : "GET",
        headers: {
          accept: "application/json",
          ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
          ...(opts.headers ?? {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: ctrl.signal,
      });
      const rawText = await res.text();
      const payloadHash = createHash("sha256").update(rawText).digest("hex");
      if (res.status === 429) {
        const err = new ProviderError(`HTTP 429 from ${new URL(url).host}`);
        err.rateLimited = true;
        err.status = 429;
        lastErr = err;
        if (attempt < retries) {
          await sleep(1000 * (attempt + 1) * 2);
          continue;
        }
        throw err;
      }
      if (!res.ok) {
        const err = new ProviderError(`HTTP ${res.status} from ${new URL(url).host}`);
        err.status = res.status;
        throw err;
      }
      let data: T;
      try {
        data = JSON.parse(rawText) as T;
      } catch {
        throw new ProviderError(`Non-JSON response from ${new URL(url).host}`);
      }
      return { data, rawText, payloadHash, rateLimited: false };
    } catch (e) {
      if (e instanceof ProviderError && !e.rateLimited) throw e;
      lastErr = e instanceof Error ? e : new Error(String(e));
      if (attempt < retries) await sleep(800 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr ?? new ProviderError("fetch failed");
}

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}
