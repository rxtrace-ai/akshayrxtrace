type BucketState = {
  tokens: number;
  lastRefillMs: number;
};

const buckets = new Map<string, BucketState>();

export type RateLimitResult =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterSeconds: number };

function nowMs() {
  return Date.now();
}

function refillTokens(state: BucketState, refillPerMinute: number, burst: number, currentMs: number) {
  const elapsed = Math.max(0, currentMs - state.lastRefillMs);
  const refillPerMs = refillPerMinute / 60000;
  const refillAmount = elapsed * refillPerMs;
  state.tokens = Math.min(burst, state.tokens + refillAmount);
  state.lastRefillMs = currentMs;
}

function consumeRateLimitInMemory(params: {
  key: string;
  refillPerMinute: number;
  burst: number;
  cost?: number;
}): RateLimitResult {
  const currentMs = nowMs();
  const cost = params.cost ?? 1;

  let state = buckets.get(params.key);
  if (!state) {
    state = { tokens: params.burst, lastRefillMs: currentMs };
    buckets.set(params.key, state);
  }

  refillTokens(state, params.refillPerMinute, params.burst, currentMs);

  if (state.tokens >= cost) {
    state.tokens -= cost;
    return { allowed: true, remaining: Math.floor(state.tokens) };
  }

  const missingTokens = cost - state.tokens;
  const refillPerSecond = params.refillPerMinute / 60;
  const retryAfterSeconds = Math.max(1, Math.ceil(missingTokens / Math.max(refillPerSecond, 0.0001)));
  return { allowed: false, retryAfterSeconds };
}

export async function consumeRateLimit(params: {
  key: string;
  refillPerMinute: number;
  burst: number;
  cost?: number;
}): Promise<RateLimitResult> {
  const cost = params.cost ?? 1;
  const isProduction = process.env.NODE_ENV === "production";
  const allowInMemoryFallback =
    String(process.env.RATE_LIMIT_ALLOW_IN_MEMORY_FALLBACK || (!isProduction)).toLowerCase() ===
    "true";

  try {
    const { getSupabaseAdmin } = await import("@/lib/supabase/admin");
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.rpc("consume_distributed_rate_limit", {
      p_key: params.key,
      p_refill_per_minute: params.refillPerMinute,
      p_burst: params.burst,
      p_cost: cost,
    });

    if (!error) {
      const row = Array.isArray(data) ? data[0] : data;
      if (row && row.allowed === true) {
        return {
          allowed: true,
          remaining: Number.isFinite(Number(row.remaining)) ? Number(row.remaining) : 0,
        };
      }
      if (row && row.allowed === false) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Number(row.retry_after_seconds || 1)),
        };
      }
    }
  } catch {
    // Ignore and apply explicit fallback policy below.
  }

  if (isProduction && !allowInMemoryFallback) {
    // Fail closed in production when distributed limiter is unavailable.
    return { allowed: false, retryAfterSeconds: 60 };
  }

  // Local/dev fallback for environments where DB migration isn't applied yet.
  return consumeRateLimitInMemory(params);
}
