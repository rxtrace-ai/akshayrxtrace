type InviteEmailResult =
  | { success: true; provider: "resend" | "smtp" }
  | {
      success: false;
      provider: "resend" | "smtp";
      error: string;
      statusCode?: number;
      details?: unknown;
      from?: string;
      to?: string;
    };

function normalizeSender(value: string | undefined, fallback: string): string {
  const trimmed = String(value || "").trim();
  return trimmed || fallback;
}

function isTruthy(value: string | undefined): boolean {
  return /^(1|true|yes)$/i.test(String(value || "").trim());
}

async function sendViaResend(args: {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  html: string;
}): Promise<InviteEmailResult> {
  const { apiKey, from, to, subject, html } = args;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });

  const payload = await response.json().catch(() => ({} as any));
  if (!response.ok) {
    return {
      success: false,
      provider: "resend",
      error: String(payload?.message || response.statusText || "Resend API error"),
      statusCode: response.status,
      details: payload,
      from,
      to,
    };
  }

  return { success: true, provider: "resend" };
}

// Email service for sending invitations
export async function sendInviteEmail(params: {
  to: string;
  companyName: string;
  inviteUrl: string;
}): Promise<InviteEmailResult> {
  const { to, companyName, inviteUrl } = params;

  const resendApiKey = process.env.RESEND_API_KEY;
  const from = normalizeSender(
    process.env.RESEND_FROM || process.env.EMAIL_FROM,
    "RxTrace <noreply@rxtrace.in>"
  );
  const fallbackFrom = normalizeSender(
    process.env.RESEND_FALLBACK_FROM,
    "RxTrace <onboarding@resend.dev>"
  );
  const allowFallbackSender = isTruthy(process.env.RESEND_ALLOW_FALLBACK_SENDER);

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
    const primaryAttempt = await sendViaResend({
      apiKey: resendApiKey,
      from,
      to,
      subject,
      html,
    });

    if (primaryAttempt.success) {
      return primaryAttempt;
    }

    if (allowFallbackSender && fallbackFrom && fallbackFrom !== from) {
      const fallbackAttempt = await sendViaResend({
        apiKey: resendApiKey,
        from: fallbackFrom,
        to,
        subject,
        html,
      });
      if (fallbackAttempt.success) {
        return fallbackAttempt;
      }

      return {
        ...fallbackAttempt,
        error: `${primaryAttempt.error} | fallback sender failed: ${fallbackAttempt.error}`,
        details: {
          primary: {
            statusCode: primaryAttempt.statusCode,
            error: primaryAttempt.error,
            details: primaryAttempt.details,
            from: primaryAttempt.from,
          },
          fallback: {
            statusCode: fallbackAttempt.statusCode,
            error: fallbackAttempt.error,
            details: fallbackAttempt.details,
            from: fallbackAttempt.from,
          },
        },
      };
    }

    return primaryAttempt;
  }

  if (!process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
    throw new Error("Email not configured. Set RESEND_API_KEY or SMTP_USER/SMTP_PASSWORD.");
  }

  const nodemailerModule: any = await import("nodemailer");
  const nodemailer: any = nodemailerModule?.default ?? nodemailerModule;

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_SECURE === "true",
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

  return { success: true, provider: "smtp" };
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
