import { getAppUrl } from "@/lib/config";

export type TransactionalEmailEvent =
  | "PASSWORD_RESET"
  | "TRIAL_EXPIRED"
  | "SUBSCRIPTION_CANCELLED"
  | "SUBSCRIPTION_REMINDER_7"
  | "SUBSCRIPTION_REMINDER_2"
  | "SUBSCRIPTION_EXPIRED"
  | "SUBSCRIPTION_PURCHASED";

type CommonPayload = {
  user_name?: string;
};

type EventPayloadMap = {
  PASSWORD_RESET: CommonPayload & { reset_link: string };
  TRIAL_EXPIRED: CommonPayload & { upgrade_link: string };
  SUBSCRIPTION_CANCELLED: CommonPayload & { expiry_date: string; renew_link: string };
  SUBSCRIPTION_REMINDER_7: CommonPayload & { expiry_date: string; renew_link: string };
  SUBSCRIPTION_REMINDER_2: CommonPayload & { expiry_date: string; renew_link: string };
  SUBSCRIPTION_EXPIRED: CommonPayload & { renew_link: string };
  SUBSCRIPTION_PURCHASED: CommonPayload & { invoice_link: string };
};

type EventPayload<E extends TransactionalEmailEvent> = EventPayloadMap[E];

export type EmailAttachment = {
  filename: string;
  contentBase64: string;
  contentType?: string;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sanitizeUrl(value: string): string {
  const v = String(value || "").trim();
  if (!v) return "";
  if (v.startsWith("http://") || v.startsWith("https://")) return v;
  if (v.startsWith("/")) return `${getAppUrl()}${v}`;
  return "";
}

function baseEmailShell(params: {
  preheader: string;
  title: string;
  greetingName: string;
  lines: string[];
  ctaLabel: string;
  ctaLink: string;
}): string {
  const safeName = escapeHtml(params.greetingName || "there");
  const safeTitle = escapeHtml(params.title);
  const safePreheader = escapeHtml(params.preheader);
  const safeLines = params.lines.map((line) => `<p style="margin:0 0 12px;">${escapeHtml(line)}</p>`).join("");
  const ctaHref = sanitizeUrl(params.ctaLink);
  const ctaButton = ctaHref
    ? `<a href="${escapeHtml(ctaHref)}" style="display:inline-block;padding:12px 18px;background:#0052CC;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">${escapeHtml(params.ctaLabel)}</a>`
    : `<span style="display:inline-block;padding:12px 18px;background:#9ca3af;color:#ffffff;border-radius:8px;font-weight:600;">${escapeHtml(params.ctaLabel)}</span>`;

  return `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
  </head>
  <body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${safePreheader}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
            <tr>
              <td style="padding:20px 24px;border-bottom:1px solid #e5e7eb;">
                <div style="font-size:20px;font-weight:700;color:#0052CC;">RxTrace</div>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;">
                <h2 style="margin:0 0 14px;font-size:20px;color:#111827;">${safeTitle}</h2>
                <p style="margin:0 0 16px;">Hi ${safeName},</p>
                ${safeLines}
                <div style="margin:20px 0 16px;">${ctaButton}</div>
                ${
                  ctaHref
                    ? `<p style="margin:0 0 12px;font-size:13px;color:#4b5563;">If the button does not work, use this link: ${escapeHtml(ctaHref)}</p>`
                    : ""
                }
                <p style="margin:20px 0 0;color:#374151;">— RxTrace Team</p>
                <p style="margin:6px 0 0;font-size:13px;color:#4b5563;">support@rxtrace.in</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildTemplate<E extends TransactionalEmailEvent>(event: E, payload: EventPayload<E>): { subject: string; html: string } {
  const userName = String(payload.user_name || "there").trim() || "there";

  switch (event) {
    case "PASSWORD_RESET": {
      const resetPayload = payload as EventPayloadMap["PASSWORD_RESET"];
      const link = sanitizeUrl(resetPayload.reset_link);
      if (!link) throw new Error("PASSWORD_RESET requires reset_link");
      return {
        subject: "Reset your password - RxTrace",
        html: baseEmailShell({
          preheader: "Reset your RxTrace password",
          title: "Reset your password",
          greetingName: userName,
          lines: [
            "We received a request to reset your password.",
            "Click the button below to set a new password.",
            "This link will expire in 15 minutes.",
            "If you did not request this, you can safely ignore this email.",
          ],
          ctaLabel: "Reset Password",
          ctaLink: link,
        }),
      };
    }
    case "TRIAL_EXPIRED":
      const trialPayload = payload as EventPayloadMap["TRIAL_EXPIRED"];
      return {
        subject: "Your trial has expired",
        html: baseEmailShell({
          preheader: "Your RxTrace trial has expired",
          title: "Your trial has expired",
          greetingName: userName,
          lines: [
            "Your RxTrace trial has expired.",
            "To continue using code generation, tracking, and compliance features, please upgrade your plan.",
            "If you need help selecting a plan, contact us anytime.",
          ],
          ctaLabel: "Upgrade Plan",
          ctaLink: trialPayload.upgrade_link,
        }),
      };
    case "SUBSCRIPTION_CANCELLED":
      const cancelledPayload = payload as EventPayloadMap["SUBSCRIPTION_CANCELLED"];
      return {
        subject: "Subscription cancellation confirmed",
        html: baseEmailShell({
          preheader: "Your subscription cancellation is confirmed",
          title: "Subscription cancellation confirmed",
          greetingName: userName,
          lines: [
            `Your RxTrace subscription will remain active until ${cancelledPayload.expiry_date}.`,
            "After this date, the subscription will expire.",
            "You can renew or upgrade later from the subscription page.",
          ],
          ctaLabel: "Open Subscription Page",
          ctaLink: cancelledPayload.renew_link,
        }),
      };
    case "SUBSCRIPTION_REMINDER_7":
      const reminder7Payload = payload as EventPayloadMap["SUBSCRIPTION_REMINDER_7"];
      return {
        subject: "Your subscription expires in 7 days",
        html: baseEmailShell({
          preheader: "Your subscription expires in 7 days",
          title: "Subscription reminder",
          greetingName: userName,
          lines: [
            `Your RxTrace subscription will expire on ${reminder7Payload.expiry_date}.`,
            "To avoid interruption, please renew before expiry.",
          ],
          ctaLabel: "Renew Subscription",
          ctaLink: reminder7Payload.renew_link,
        }),
      };
    case "SUBSCRIPTION_REMINDER_2":
      const reminder2Payload = payload as EventPayloadMap["SUBSCRIPTION_REMINDER_2"];
      return {
        subject: "Subscription expiring soon",
        html: baseEmailShell({
          preheader: "Your subscription expires in 2 days",
          title: "Subscription expiring soon",
          greetingName: userName,
          lines: [
            `Your subscription will expire in 2 days (${reminder2Payload.expiry_date}).`,
            "Renew now to avoid service disruption.",
          ],
          ctaLabel: "Renew Now",
          ctaLink: reminder2Payload.renew_link,
        }),
      };
    case "SUBSCRIPTION_EXPIRED":
      const expiredPayload = payload as EventPayloadMap["SUBSCRIPTION_EXPIRED"];
      return {
        subject: "Subscription expired",
        html: baseEmailShell({
          preheader: "Your RxTrace subscription has expired",
          title: "Subscription expired",
          greetingName: userName,
          lines: [
            "Your RxTrace subscription has expired.",
            "Access to services may be limited until renewal.",
          ],
          ctaLabel: "Renew Subscription",
          ctaLink: expiredPayload.renew_link,
        }),
      };
    case "SUBSCRIPTION_PURCHASED":
      const purchasedPayload = payload as EventPayloadMap["SUBSCRIPTION_PURCHASED"];
      return {
        subject: "Subscription activated - Invoice attached",
        html: baseEmailShell({
          preheader: "Your subscription is active",
          title: "Subscription activated",
          greetingName: userName,
          lines: [
            "Your subscription has been successfully activated.",
            "Invoice details are attached for your reference.",
            "You can also download it using the button below.",
          ],
          ctaLabel: "Download Invoice",
          ctaLink: purchasedPayload.invoice_link,
        }),
      };
    default:
      throw new Error(`Unsupported event: ${String(event)}`);
  }
}

export async function sendTransactionalEmail<E extends TransactionalEmailEvent>(params: {
  to: string;
  event: E;
  payload: EventPayload<E>;
  attachments?: EmailAttachment[];
}): Promise<{ success: true }> {
  const resendApiKey = String(process.env.RESEND_API_KEY || "").trim();
  if (!resendApiKey) {
    throw new Error("RESEND_API_KEY is required for transactional emails");
  }

  const from = String(process.env.RESEND_FROM || process.env.EMAIL_FROM || "RxTrace <noreply@rxtrace.in>").trim();
  const to = String(params.to || "").trim();
  if (!to) throw new Error("Recipient email is required");

  const template = buildTemplate(params.event, params.payload);
  const attachmentPayload = (params.attachments || []).map((item) => ({
    filename: item.filename,
    content: item.contentBase64,
    ...(item.contentType ? { content_type: item.contentType } : {}),
  }));

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: template.subject,
      html: template.html,
      ...(attachmentPayload.length ? { attachments: attachmentPayload } : {}),
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({} as any));
    throw new Error(`Resend API error (${response.status}): ${String(err?.message || response.statusText || "Unknown error")}`);
  }

  return { success: true };
}
