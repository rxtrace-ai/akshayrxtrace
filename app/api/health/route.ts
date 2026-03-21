import { NextResponse  } from 'next/server';
import { apiJson } from '@/lib/api/response';
import { getMissingProductionEnv, hasWebhookSecret } from '@/lib/env';

export async function GET() {
  const missingEnv = getMissingProductionEnv();
  const webhookSecretOk = hasWebhookSecret();
  const isProduction = process.env.NODE_ENV === 'production';
  const hasRazorpayKeys = Boolean(
    process.env.RAZORPAY_KEY_ID?.trim() || process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID?.trim()
  );

  // R2: In production, report degraded if critical env is missing or webhook secret not set (when Razorpay used)
  const hasCriticalGaps =
    isProduction &&
    (missingEnv.length > 0 || (hasRazorpayKeys && !webhookSecretOk));
  const status = hasCriticalGaps ? 'degraded' : 'ok';

  return apiJson(
    {
      status,
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      ...(isProduction && {
        env: {
          missing: missingEnv,
          webhook_secret_configured: webhookSecretOk,
        },
      }),
    },
    { status: hasCriticalGaps ? 503 : 200 }
  );
}

