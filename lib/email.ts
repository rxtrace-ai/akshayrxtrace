// Email service for sending invitations
export async function sendInviteEmail(params: {
  to: string;
  companyName: string;
  inviteUrl: string;
}) {
  const { to, companyName, inviteUrl } = params;

  const resendApiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || 'RxTrace <noreply@rxtrace.in>';

  const subject = "Invitation to join a company workspace on RxTrace";
  const html = `
    <h2>You're invited to RxTrace</h2>
    <p>You have been invited to join a company workspace on <b>RxTrace</b>, a product traceability platform.</p>
    <p>Click the button below to accept your invitation.</p>
    <a href="${inviteUrl}" style="padding:12px 18px;background:#2563eb;color:white;border-radius:6px;text-decoration:none;">
      Accept Invite
    </a>
    <p>If the button does not work open this link:</p>
    <p>${inviteUrl}</p>
    <p>This email was sent automatically by RxTrace.</p>
    <p>If you need help contact support@rxtrace.in</p>
  `;

  if (resendApiKey) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: [to], subject, html }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({} as any));
      throw new Error(`Resend API error (${response.status}): ${errorData.message || response.statusText}`);
    }

    return { success: true };
  }

  if (!process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
    throw new Error('Email not configured. Set RESEND_API_KEY or SMTP_USER/SMTP_PASSWORD.');
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
    from,
    to,
    subject,
    html,
  });

  return { success: true };
}

// Backwards compatibility for older callers.
export async function sendInvitationEmail(params: {
  to: string;
  companyName: string;
  role: string;
  inviterName: string;
  customMessage?: string;
  inviteUrl: string;
}) {
  return sendInviteEmail({
    to: params.to,
    companyName: params.companyName,
    inviteUrl: params.inviteUrl,
  });
}
