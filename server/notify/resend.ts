import type { DeliveryResult, MessageProvider } from ".";

export interface ResendOptions {
  apiKey: string;
  /** Sender on a domain verified in Resend, e.g. "Arachi <rfq@example.com>". */
  from: string;
  /** Where carriers' replies go; empty = the sender address. */
  replyTo?: string;
  /** Injected in tests. */
  fetch?: typeof fetch;
}

const endpoint = "https://api.resend.com/emails";

/**
 * Sends email through the Resend API (https://resend.com/docs/api-reference/emails/send-email).
 * "Delivered" here means Resend accepted the message; whether it reached the
 * inbox or bounced is learned later (see emailStatus.ts).
 */
export function resendProvider(options: ResendOptions): MessageProvider {
  const send = options.fetch ?? fetch;
  return {
    async send(message): Promise<DeliveryResult> {
      const to = message.to.trim();
      if (!to) return { delivered: false, error: "Alıcının email ünvanı yoxdur." };
      let response: Response;
      try {
        response = await send(endpoint, {
          method: "POST",
          headers: { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({
            from: options.from,
            to: [to],
            subject: message.subject,
            text: message.body,
            ...(options.replyTo ? { reply_to: options.replyTo } : {}),
          }),
          signal: AbortSignal.timeout(15_000),
        });
      } catch (err) {
        return { delivered: false, error: `Resend-ə qoşulmaq alınmadı: ${err instanceof Error ? err.message : err}` };
      }
      const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
      if (!response.ok) {
        return { delivered: false, error: `Resend xətası (${response.status}): ${body.message ?? response.statusText}` };
      }
      return { delivered: true, providerId: body.id };
    },
  };
}

/**
 * The last delivery event Resend recorded for an email, e.g. "delivered" or
 * "bounced" (https://resend.com/docs/api-reference/emails/retrieve-email).
 * Undefined when Resend does not know the id (404).
 */
export async function fetchResendStatus(
  apiKey: string,
  id: string,
  send: typeof fetch = fetch,
): Promise<string | undefined> {
  const response = await send(`${endpoint}/${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 404) return undefined;
  if (response.status === 401 || response.status === 403) {
    throw new Error(
      `Resend API açarı məktubların statusunu oxuya bilmir (${response.status}). Resend → API Keys-də "Full access" icazəli açar yaradıb RESEND_API_KEY-ə yazın.`,
    );
  }
  const body = (await response.json().catch(() => ({}))) as { last_event?: string; message?: string };
  if (!response.ok) throw new Error(`Resend xətası (${response.status}): ${body.message ?? response.statusText}`);
  return body.last_event;
}
