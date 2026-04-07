import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export function getAdminClient(): SupabaseClient {
  return createClient(supabaseUrl, supabaseServiceKey);
}

export function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export function getExpiryDate(minutes = 10): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}

export async function clearExistingOTPs(email: string, supabase: SupabaseClient) {
  return supabase
    .from('otp_verifications')
    .delete()
    .eq('email', email.toLowerCase());
}

export async function insertOTP(email: string, otp: string, expiresAt: Date, supabase: SupabaseClient) {
  return supabase
    .from('otp_verifications')
    .insert({
      email: email.toLowerCase(),
      otp,
      expires_at: expiresAt.toISOString(),
      verified: false,
    });
}

export async function fetchLatestOTP(email: string, supabase: SupabaseClient) {
  return supabase
    .from('otp_verifications')
    .select('*')
    .eq('email', email.toLowerCase())
    .eq('verified', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
}

export async function deleteOTPById(id: string, supabase: SupabaseClient) {
  return supabase
    .from('otp_verifications')
    .delete()
    .eq('id', id);
}

export async function markOTPVerified(id: string, supabase: SupabaseClient) {
  return supabase
    .from('otp_verifications')
    .update({ verified: true })
    .eq('id', id);
}

async function sendViaResend(params: { from: string; to: string; subject: string; html: string }) {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    throw new Error('RESEND_API_KEY_MISSING');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: params.from,
      to: [params.to],
      subject: params.subject,
      html: params.html,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({} as any));
    throw new Error(`Resend API error (${response.status}): ${errorData.message || response.statusText}`);
  }
}

async function sendViaResendWithRetry(params: { from: string; to: string; subject: string; html: string }) {
  const attempts = 2;
  let lastError: unknown = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      await sendViaResend(params);
      return;
    } catch (error) {
      lastError = error;
      if (i < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
  }
  throw lastError ?? new Error('RESEND_SEND_FAILED');
}

export async function sendOTPEmail(email: string, otp: string) {
  const resendFrom = String(process.env.RESEND_FROM || 'RxTrace India <noreply@rxtrace.in>').trim();
  const subject = 'Your RxTrace Email Verification Code';
  const html = getEmailHtml(otp);

  try {
    await sendViaResendWithRetry({ from: resendFrom, to: email, subject, html });
    return;
  } catch (resendError) {
    const hasSmtp = Boolean(process.env.SMTP_USER && process.env.SMTP_PASSWORD);
    if (!hasSmtp && String(resendError).includes('RESEND_API_KEY_MISSING')) {
      throw new Error('Email not configured. Set RESEND_API_KEY (recommended) or SMTP_USER/SMTP_PASSWORD (SMTP fallback).');
    }
    if (!hasSmtp) {
      throw resendError;
    }
  }

  if (!process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
    throw new Error('Email not configured. Set RESEND_API_KEY (recommended) or SMTP_USER/SMTP_PASSWORD (SMTP fallback).');
  }

  const nodemailerModule: any = await import('nodemailer');
  const nodemailer: any = nodemailerModule?.default ?? nodemailerModule;

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
  });

  await transporter.sendMail({
    from: process.env.EMAIL_FROM || `"RxTrace India" <${process.env.SMTP_USER}>`,
    to: email,
    subject,
    html,
  });
}

function getEmailHtml(otp: string) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #0052CC, #FF6B35); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
        .otp-box { background: white; border: 2px dashed #0052CC; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px; }
        .otp-code { font-size: 32px; font-weight: bold; color: #0052CC; letter-spacing: 8px; }
        .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>RxTrace India</h1>
          <p>Email Verification</p>
        </div>
        <div class="content">
          <p>Hello,</p>
          <p>Thank you for setting up your company profile with RxTrace India. To verify your email address, please use the following One-Time Password (OTP):</p>
          <div class="otp-box">
            <div class="otp-code">${otp}</div>
          </div>
          <p><strong>This OTP will expire in 10 minutes.</strong></p>
          <p>If you didn't request this verification, please ignore this email.</p>
          <div class="footer">
            <p>© ${new Date().getFullYear()} RxTrace India. All rights reserved.</p>
            <p>Pharmaceutical Traceability & Authentication Platform</p>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
}
