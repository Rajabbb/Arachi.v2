import { db, now } from "../db";

export const channels = ["email", "whatsapp", "telegram"] as const;
export type Channel = (typeof channels)[number];

export interface OutgoingMessage {
  channel: Channel;
  /** Email address, or phone number / handle for messengers. */
  to: string;
  subject: string;
  body: string;
}

export interface DeliveryResult {
  delivered: boolean;
  error?: string;
}

/** Sends messages over one channel. Swap in a real one with setProvider(). */
export interface MessageProvider {
  send(message: OutgoingMessage): Promise<DeliveryResult>;
}

/**
 * Default provider: sends nothing for real. It writes the message to the
 * server log, and every message lands in the outbox table either way.
 * Real email/WhatsApp/Telegram sending is a separate decision.
 */
export const logProvider: MessageProvider = {
  async send(message) {
    if (!message.to.trim()) {
      return { delivered: false, error: "Alıcının ünvanı yoxdur." };
    }
    console.log(`[${message.channel} → ${message.to}] ${message.subject}`);
    return { delivered: true };
  },
};

const providers: Record<Channel, MessageProvider> = {
  email: logProvider,
  whatsapp: logProvider,
  telegram: logProvider,
};

export function setProvider(channel: Channel, provider: MessageProvider) {
  providers[channel] = provider;
}

/** Sends one message through its channel's provider and records it in the outbox. */
export async function deliver(message: OutgoingMessage): Promise<DeliveryResult> {
  let result: DeliveryResult;
  try {
    result = await providers[message.channel].send(message);
  } catch (err) {
    result = { delivered: false, error: err instanceof Error ? err.message : String(err) };
  }
  db()
    .prepare(
      `INSERT INTO outbox (channel, recipient, subject, body, delivered, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      message.channel,
      message.to,
      message.subject,
      message.body,
      result.delivered ? 1 : 0,
      result.error ?? null,
      now(),
    );
  return result;
}
