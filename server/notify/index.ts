import { config } from "../config";
import { db, now } from "../db";
import { resendProvider } from "./resend";

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
  /** The provider's message id, e.g. Resend's email id. */
  providerId?: string;
}

/** Sends messages over one channel. Swap in a real one with setProvider(). */
export interface MessageProvider {
  send(message: OutgoingMessage): Promise<DeliveryResult>;
}

/**
 * Stub provider: sends nothing for real, it only writes the message to the
 * server log (every message lands in the outbox table either way). Used for
 * WhatsApp/Telegram, and for email when Resend is not configured, so local
 * development works without keys.
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

function emailProvider(): MessageProvider {
  if (!config.resendApiKey) return logProvider;
  if (!config.emailFrom) {
    console.warn("RESEND_API_KEY is set but EMAIL_FROM is not; emails are only logged.");
    return logProvider;
  }
  return resendProvider({ apiKey: config.resendApiKey, from: config.emailFrom, replyTo: config.emailReplyTo });
}

const providers: Record<Channel, MessageProvider> = {
  email: emailProvider(),
  whatsapp: logProvider,
  telegram: logProvider,
};

export function setProvider(channel: Channel, provider: MessageProvider) {
  providers[channel] = provider;
}

/** Whether messages on a channel really leave the system (false for the log stub). */
export function sendsForReal(channel: Channel): boolean {
  return providers[channel] !== logProvider;
}

/** A note for the agent's reply when some of the used channels only log; undefined when all really send. */
export function logOnlyNote(used: Iterable<Channel>): string | undefined {
  const logOnly = [...new Set(used)].filter((c) => !sendsForReal(c));
  return logOnly.length
    ? `Real göndərilməyən kanallar: ${logOnly.join(", ")}. Bu mesajlar yalnız serverin jurnalına və outbox cədvəlinə yazılır.`
    : undefined;
}

/** Sends one message through its channel's provider and records it in the outbox. */
export async function deliver(message: OutgoingMessage): Promise<DeliveryResult> {
  let result: DeliveryResult;
  try {
    result = await providers[message.channel].send(message);
  } catch (err) {
    result = { delivered: false, error: err instanceof Error ? err.message : String(err) };
  }
  await db().run(
    `INSERT INTO outbox (channel, recipient, subject, body, delivered, error, provider_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    message.channel,
    message.to,
    message.subject,
    message.body,
    result.delivered ? 1 : 0,
    result.error ?? null,
    result.providerId ?? null,
    now(),
  );
  return result;
}
