async function sendViaResend(params: { from: string; to: string; subject: string; html: string }) {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    throw new Error('RESEND_API_KEY_MISSING');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: params.from, to: [params.to], subject: params.subject, html: params.html }),
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

export async function sendWelcomeEmail(email: string, fullName: string) {
  const resendFrom = String(process.env.RESEND_FROM || 'RxTrace India <noreply@rxtrace.in>').trim();

  const subject = 'Welcome to RxTrace India';
  const html = getWelcomeHtml(fullName);

  try {
    await sendViaResendWithRetry({ from: resendFrom, to: email, subject, html });
    return;
  } catch (resendError) {
    const hasSmtp = Boolean(process.env.SMTP_USER && process.env.SMTP_PASSWORD);
    if (!hasSmtp && String(resendError).includes('RESEND_API_KEY_MISSING')) {
      throw new Error('Email not configured. Set RESEND_API_KEY or SMTP_USER/SMTP_PASSWORD.');
    }
    if (!hasSmtp) {
      throw resendError;
    }
  }

  if (!process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
    throw new Error('Email not configured. Set RESEND_API_KEY or SMTP_USER/SMTP_PASSWORD.');
  }

  const nodemailerModule: any = await import('nodemailer');
  const nodemailer: any = nodemailerModule?.default ?? nodemailerModule;

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.zoho.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
  });

  await transporter.sendMail({
    from: process.env.EMAIL_FROM || process.env.SMTP_USER,
    to: email,
    subject,
    html,
  });
}

function getWelcomeHtml(fullName: string) {
  const safeName = fullName || 'there';
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937; }
        .container { max-width: 640px; margin: 0 auto; padding: 24px; }
        .card { background: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.06); }
        .header { background: linear-gradient(135deg, #0052CC, #FF6B35); color: #ffffff; padding: 28px; }
        .title { font-size: 24px; margin: 0 0 8px; }
        .subtitle { margin: 0; opacity: 0.9; }
        .content { padding: 28px; background: #f9fafb; }
        .cta { display: inline-block; padding: 12px 18px; background: #0052CC; color: #ffffff; border-radius: 8px; text-decoration: none; font-weight: 600; }
        .list { padding-left: 20px; margin: 16px 0; }
        .footer { padding: 20px; font-size: 12px; color: #6b7280; text-align: center; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="card">
          <div class="header">
            <div class="title">Welcome to RxTrace</div>
            <div class="subtitle">Pharmaceutical Traceability & Authentication</div>
          </div>
          <div class="content">
            <p>Hi ${safeName},</p>
            <p>Thanks for signing up. Your account is ready—complete verification and start generating GS1-compliant labels in minutes.</p>
            <p>Next steps you can take right now:</p>
            <ul class="list">
              <li>Verify your email with the OTP we sent</li>
              <li>Set up your company profile</li>
              <li>Create your first product batch and generate labels</li>
            </ul>
            <p>
              <a class="cta" href="${process.env.NEXT_PUBLIC_APP_URL || 'https://rxtrace.in'}/dashboard">Go to Dashboard</a>
            </p>
            <p>If you need help, reply to this email or reach us at support@rxtrace.in.</p>
          </div>
          <div class="footer">
            © ${new Date().getFullYear()} RxTrace India. All rights reserved.
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
}
