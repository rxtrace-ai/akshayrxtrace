// Next.js instrumentation file
// Sentry: Error monitoring (server + edge)
// Note: OpenTelemetry is not loaded here to avoid Node-only deps in Next.js bundle.
// Correlation IDs, logging, and metrics still work via lib/observability.

export async function register() {
  const runtime = process.env.NEXT_RUNTIME;
  const isBuild = process.env.NEXT_PHASE === "phase-production-build";

  // Skip Sentry during next build to avoid hang
  if (isBuild || process.env.SENTRY_IGNORE_BUILD === "1") return;

  // Sentry: Initialize for both server and edge runtimes
  if (runtime === 'nodejs' || runtime === 'edge') {
    const Sentry = await import('@sentry/nextjs');
    const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN;
    if (!dsn) return;

    Sentry.init({
      dsn,
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1,
      enableLogs: true,
      sendDefaultPii: false,
    });
  }
}
