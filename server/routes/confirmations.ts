import type { IncomingMessage, ServerResponse } from "node:http";
import type { CarrierChoices, ConfirmationResponse, ConfirmMode } from "../../shared/protocol";
import { tools } from "../agent/tools";
import { emptyContext } from "../agent/tools/registry";
import {
  claimConfirmation,
  findConfirmation,
  finishConfirmation,
  parseChoices,
  toConfirmation,
} from "../domain/confirmations";
import { addMessage, conversationMessages } from "../domain/conversations";
import { HttpError, readJson, send, SMALL_BODY_BYTES } from "../http";

const answered: Record<string, string> = {
  running: "Bu əməliyyat artıq icra olunur.",
  done: "Bu əməliyyat artıq icra olunub.",
  failed: "Bu əməliyyat artıq cəhd edilib.",
  declined: "Bu əməliyyatdan artıq imtina edilib.",
  expired: "Təsdiq vaxtı keçib. Agentdən yenidən istəyin.",
};

/**
 * POST /api/confirmations/:id { approve } — the user's "Bəli" or "Xeyr" for
 * an action the agent prepared. Only here does it run, with exactly the
 * parameters the user was shown; the outcome is added to the chat.
 */
export async function handleConfirmation(req: IncomingMessage, res: ServerResponse, id: string) {
  const body = (await readJson(req, SMALL_BODY_BYTES)) as { approve?: unknown; mode?: unknown; carrierIds?: unknown } | null;
  if (typeof body?.approve !== "boolean") throw new HttpError(400, "Sorğunun formatı yanlışdır.");
  const stored = await findConfirmation(id);
  if (!stored) throw new HttpError(404, "Təsdiq tapılmadı.");

  // A new RFQ with a carrier picker: what the user chose is checked before the action is claimed.
  const choices = parseChoices(stored);
  let mode: ConfirmMode = "create";
  let carrierIds: number[] = [];
  if (body.approve && choices) {
    if (body.mode !== "send" && body.mode !== "create" && body.mode !== "link") throw new HttpError(400, "Seçim göndərilməyib.");
    mode = body.mode;
    if (mode === "send") {
      const known = new Set(choices.carriers.map((c) => c.id));
      carrierIds = [...new Set(Array.isArray(body.carrierIds) ? body.carrierIds.map(Number) : [])];
      if (carrierIds.length === 0) throw new HttpError(400, "Göndərmək üçün ən azı bir daşıyıcı seçin.");
      if (carrierIds.some((cid) => !known.has(cid))) throw new HttpError(400, "Seçilən daşıyıcı siyahıda yoxdur.");
    }
  }
  if (!(await claimConfirmation(id, body.approve ? "running" : "declined"))) {
    const status = toConfirmation(stored).status;
    throw new HttpError(409, answered[status] ?? "Bu əməliyyat artıq cavablandırılıb.");
  }
  if (!body.approve) {
    const result: ConfirmationResponse = { confirmation: toConfirmation((await findConfirmation(id))!) };
    return send(res, 200, result);
  }

  const tool = tools.get(stored.tool);
  const ctx = emptyContext();
  const run = await tools.execute(stored.tool, JSON.parse(stored.params), ctx);
  let outcome = run.ok
    ? (tool?.done?.(JSON.parse(run.content)) ?? "Hazırdır.")
    : `Alınmadı: ${run.content.replace(/^Error: /, "")}`;
  let clean = run.ok;
  if (run.ok && choices && mode !== "create") {
    const follow = await createdRfqFollowUp(JSON.parse(run.content), mode, carrierIds, choices, ctx);
    outcome = follow.text;
    clean = follow.ok;
    if (follow.ok) {
      for (const card of ctx.cards) if (card.title.includes("yaradıldı")) delete card.note;
    }
  }
  await finishConfirmation(id, run.ok ? "done" : "failed", outcome);
  const messageId = await addMessage(Number(stored.conversation_id), { role: "assistant", text: `${clean ? "✓" : "⚠"} ${outcome}`, cards: ctx.cards });
  const messages = await conversationMessages(Number(stored.conversation_id));
  const result: ConfirmationResponse = {
    confirmation: toConfirmation((await findConfirmation(id))!),
    message: messages.find((m) => m.id === messageId),
  };
  send(res, 200, result);
}

/**
 * After the RFQ was created from a card with a picker: send it to the chosen
 * carriers, or make a public link. Exactly the carriers the user ticked; a failure
 * here never undoes the RFQ, and the text says what did and did not happen.
 */
async function createdRfqFollowUp(
  created: { number?: number },
  mode: ConfirmMode,
  carrierIds: number[],
  choices: CarrierChoices,
  ctx: ReturnType<typeof emptyContext>,
): Promise<{ ok: boolean; text: string }> {
  const number = created.number;
  const base = `RFQ #${number} yaradıldı.`;
  if (mode === "link") {
    const link = await tools.execute("get_quote_link", { rfq_id: number }, ctx);
    if (!link.ok) return { ok: false, text: `${base} Link yaradılmadı: ${link.content.replace(/^Error: /, "")}` };
    const url = (JSON.parse(link.content) as { link?: string }).link;
    return { ok: true, text: `${base} Heç bir daşıyıcıya email göndərilmədi. Ümumi link: ${url}` };
  }
  const sent = await tools.execute("send_rfq_to_carriers", { rfq_id: number, audience: "specific", carrier_ids: carrierIds }, ctx);
  if (!sent.ok) {
    return { ok: false, text: `${base} Amma daşıyıcılara göndərilmədi: ${sent.content.replace(/^Error: /, "")} Heç kimə email getmədi. Göndərmək üçün söhbətdə yazın.` };
  }
  const result = JSON.parse(sent.content) as { recipients?: { name: string; email: string }[] };
  const got = result.recipients ?? [];
  const gotEmails = new Set(got.map((r) => r.email.toLowerCase()));
  const missed = choices.carriers.filter((c) => carrierIds.includes(c.id) && !gotEmails.has(c.email.toLowerCase()));
  const list = got.map((r) => `${r.name} (${r.email})`).join(", ");
  return {
    ok: missed.length === 0,
    text:
      `${base} ${got.length} daşıyıcıya göndərildi: ${list}.` +
      (missed.length ? ` Göndərilməyənlər: ${missed.map((c) => `${c.name} (${c.email})`).join(", ")}.` : ""),
  };
}
