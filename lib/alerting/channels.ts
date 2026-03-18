// PHASE-14: Alert channel implementations
// Handles delivery of alerts via different channels (email, Slack, webhook)

export interface AlertChannel {
  type: 'email' | 'slack' | 'webhook';
  config: Record<string, any>;
}

export interface Alert {
  ruleId?: string;
  alertType: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  metricValue?: number;
  thresholdValue?: number;
  route?: string;
  method?: string;
  metadata?: Record<string, any>;
}

type EmailChannelConfig = { recipients: string[]; from?: string };
type SlackChannelConfig = { webhook: string };
type WebhookChannelConfig = { url: string; headers?: Record<string, string> };

/**
 * PHASE-14: Send alert via email channel
 */
export async function sendEmailAlert(
  alert: Alert,
  channelConfig: EmailChannelConfig
): Promise<boolean> {
  try {
    // PHASE-14: Use nodemailer or SendGrid API
    // For now, we'll use a simple implementation
    // In production, integrate with your email service (SendGrid, SES, etc.)

    const nodemailer = require('nodemailer');

    // Configure transporter (use environment variables)
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
    });

    const from = channelConfig.from || process.env.ALERT_EMAIL_FROM || 'alerts@rxtrace.com';
    const subject = `[${alert.severity.toUpperCase()}] ${alert.alertType} - Alert Triggered`;

    const html = `
      <h2>Alert: ${alert.alertType}</h2>
      <p><strong>Severity:</strong> ${alert.severity}</p>
      <p><strong>Message:</strong> ${alert.message}</p>
      ${alert.metricValue !== undefined ? `<p><strong>Metric Value:</strong> ${alert.metricValue}</p>` : ''}
      ${alert.thresholdValue !== undefined ? `<p><strong>Threshold:</strong> ${alert.thresholdValue}</p>` : ''}
      ${alert.route ? `<p><strong>Route:</strong> ${alert.route}</p>` : ''}
      ${alert.method ? `<p><strong>Method:</strong> ${alert.method}</p>` : ''}
      <p><strong>Time:</strong> ${new Date().toISOString()}</p>
    `;

    await transporter.sendMail({
      from,
      to: channelConfig.recipients.join(', '),
      subject,
      html,
    });

    return true;
  } catch (error) {
    console.error('PHASE-14: Failed to send email alert:', error);
    return false;
  }
}

/**
 * PHASE-14: Send alert via Slack webhook
 */
export async function sendSlackAlert(
  alert: Alert,
  channelConfig: SlackChannelConfig
): Promise<boolean> {
  try {
    const response = await fetch(channelConfig.webhook, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: `🚨 *${alert.severity.toUpperCase()} Alert*`,
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: `${alert.severity.toUpperCase()} Alert: ${alert.alertType}`,
            },
          },
          {
            type: 'section',
            fields: [
              {
                type: 'mrkdwn',
                text: `*Message:*\n${alert.message}`,
              },
              {
                type: 'mrkdwn',
                text: `*Severity:*\n${alert.severity}`,
              },
              ...(alert.metricValue !== undefined
                ? [
                    {
                      type: 'mrkdwn',
                      text: `*Metric Value:*\n${alert.metricValue}`,
                    },
                  ]
                : []),
              ...(alert.thresholdValue !== undefined
                ? [
                    {
                      type: 'mrkdwn',
                      text: `*Threshold:*\n${alert.thresholdValue}`,
                    },
                  ]
                : []),
              ...(alert.route
                ? [
                    {
                      type: 'mrkdwn',
                      text: `*Route:*\n${alert.route}`,
                    },
                  ]
                : []),
            ],
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: `Time: ${new Date().toISOString()}`,
              },
            ],
          },
        ],
      }),
    });

    return response.ok;
  } catch (error) {
    console.error('PHASE-14: Failed to send Slack alert:', error);
    return false;
  }
}

/**
 * PHASE-14: Send alert via generic webhook
 */
export async function sendWebhookAlert(
  alert: Alert,
  channelConfig: WebhookChannelConfig
): Promise<boolean> {
  try {
    const response = await fetch(channelConfig.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(channelConfig.headers || {}),
      },
      body: JSON.stringify({
        alert: {
          ...alert,
          timestamp: new Date().toISOString(),
        },
      }),
    });

    return response.ok;
  } catch (error) {
    console.error('PHASE-14: Failed to send webhook alert:', error);
    return false;
  }
}

/**
 * PHASE-14: Send alert via configured channels
 */
export async function sendAlert(alert: Alert, channels: AlertChannel[]): Promise<{
  sent: number;
  failed: number;
  results: Array<{ channel: AlertChannel; success: boolean }>;
}> {
  const results: Array<{ channel: AlertChannel; success: boolean }> = [];

  for (const channel of channels) {
    let success = false;

    try {
      switch (channel.type) {
        case 'email': {
          const recipients = Array.isArray(channel.config?.recipients)
            ? channel.config.recipients.filter((r) => typeof r === 'string' && r.trim().length > 0)
            : [];
          if (recipients.length === 0) {
            success = false;
            break;
          }
          success = await sendEmailAlert(alert, {
            recipients,
            from: typeof channel.config?.from === 'string' ? channel.config.from : undefined,
          });
          break;
        }
        case 'slack': {
          const webhook = typeof channel.config?.webhook === 'string' ? channel.config.webhook : '';
          if (!webhook) {
            success = false;
            break;
          }
          success = await sendSlackAlert(alert, { webhook });
          break;
        }
        case 'webhook': {
          const url = typeof channel.config?.url === 'string' ? channel.config.url : '';
          if (!url) {
            success = false;
            break;
          }
          success = await sendWebhookAlert(alert, {
            url,
            headers: channel.config?.headers as Record<string, string> | undefined,
          });
          break;
        }
        default:
          console.warn(`PHASE-14: Unknown alert channel type: ${channel.type}`);
          success = false;
      }
    } catch (error) {
      console.error(`PHASE-14: Error sending alert via ${channel.type}:`, error);
      success = false;
    }

    results.push({ channel, success });
  }

  const sent = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  return { sent, failed, results };
}
