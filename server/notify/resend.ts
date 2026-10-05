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
 * "Delivered" here means Resend accepted the message; bounces arrive later
 * through Resend webhooks, which are not wired up yet.
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
