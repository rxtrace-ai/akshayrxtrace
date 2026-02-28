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

export function consumeRateLimit(params: {
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
