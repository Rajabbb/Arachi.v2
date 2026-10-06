import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { config } from "../config";
import { HttpError, readBody, send } from "../http";
import { applyEmailStatus, checkEmailNow } from "../notify/emailStatus";

/** Signatures older or newer than this are rejected, against replays. */
const toleranceSeconds = 5 * 60;

/**
 * Checks a Resend (Svix) webhook signature: HMAC-SHA256 of
 * "<svix-id>.<svix-timestamp>.<raw body>" keyed with the base64 part of the
 * "whsec_..." secret, compared with each "v1,<base64>" in svix-signature.
 */
export function verifyResendSignature(
  secret: string,
  headers: { id?: string; timestamp?: string; signature?: string },
  body: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isInteger(ts) || Math.abs(nowSeconds - ts) > toleranceSeconds) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();
  return signature.split(" ").some((part) => {
    const [version, value] = part.split(",");
    if (version !== "v1" || !value) return false;
    const given = Buffer.from(value, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

interface ResendEvent {
  type?: string;
  data?: { email_id?: string; bounce?: { message?: string } };
}

/**
 * POST /api/webhooks/resend — Resend's delivery events (email.delivered,
 * email.bounced, ...). Needs a public address, so it only works once the
 * app is hosted. With RESEND_WEBHOOK_SECRET set, signed events are applied
 * directly. Without it the event is only a hint: the email's status is
 * fetched from the Resend API, so a forged request cannot change anything.
 */
export async function handleResendWebhook(req: IncomingMessage, res: ServerResponse) {
  const body = await readBody(req);
  const secret = config.resendWebhookSecret;
  const headers = {
    id: header(req, "svix-id") ?? header(req, "webhook-id"),
    timestamp: header(req, "svix-timestamp") ?? header(req, "webhook-timestamp"),
    signature: header(req, "svix-signature") ?? header(req, "webhook-signature"),
  };
  if (secret && !verifyResendSignature(secret, headers, body)) {
    throw new HttpError(401, "Webhook imzası yanlışdır.");
  }
  let event: ResendEvent;
  try {
    event = JSON.parse(body) as ResendEvent;
  } catch {
    throw new HttpError(400, "Sorğu düzgün JSON deyil.");
  }
  const emailId = event.data?.email_id;
  const status = event.type?.startsWith("email.") ? event.type.slice("email.".length) : undefined;
  if (emailId && status) {
    if (secret) await applyEmailStatus(emailId, status, event.data?.bounce?.message);
    else await checkEmailNow(emailId);
  }
  send(res, 200, { ok: true });
}
