/** Waits `ms` milliseconds; replaced in tests so they don't actually wait. */
export type Sleep = (ms: number) => Promise<void>;

export const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export interface RetryOptions {
  /** Extra attempts after the first one. */
  retries: number;
  /** Delay before the first retry; doubled on each next one, plus up to 25% jitter. */
  baseDelayMs: number;
  /** True for errors worth trying again (overload, rate limit, dropped connection). */
  isTransient: (err: unknown) => boolean;
  /** Called before each retry, for logging. */
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
  sleep?: Sleep;
}

/** Runs `fn`, retrying transient errors with exponential backoff; other errors are thrown at once. */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const sleep = options.sleep ?? realSleep;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt > options.retries || !options.isTransient(err)) throw err;
      const base = options.baseDelayMs * 2 ** (attempt - 1);
      const delayMs = Math.round(base + Math.random() * base * 0.25);
      options.onRetry?.(err, attempt, delayMs);
      await sleep(delayMs);
    }
  }
}

/** Error codes of a connection that dropped or never came up. */
const networkCodes = ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT"];

/** True when `err` is a network failure from fetch rather than an answer from the API. */
export function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: unknown }).code ?? (err.cause as { code?: unknown } | undefined)?.code;
  if (typeof code === "string" && networkCodes.includes(code)) return true;
  return err instanceof TypeError && /fetch failed/i.test(err.message);
}

/** Shown to the user when the AI service stays overloaded after all retries. */
export const overloadedMessage = "AI xidməti müvəqqəti yüklənib, bir az sonra yenidən cəhd edin.";
