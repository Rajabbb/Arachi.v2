import type { IncomingMessage, ServerResponse } from "node:http";
import type { ConfirmationResponse } from "../../shared/protocol";
import { tools } from "../agent/tools";
import { emptyContext } from "../agent/tools/registry";
import {
  claimConfirmation,
  findConfirmation,
  finishConfirmation,
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
  const body = (await readJson(req, SMALL_BODY_BYTES)) as { approve?: unknown } | null;
  if (typeof body?.approve !== "boolean") throw new HttpError(400, "Sorğunun formatı yanlışdır.");
  const stored = await findConfirmation(id);
  if (!stored) throw new HttpError(404, "Təsdiq tapılmadı.");
  if (!(await claimConfirmation(id, body.approve ? "running" : "declined"))) {
    const status = toConfirmation(stored).status;
    throw new HttpError(409, answered[status] ?? "Bu əməliyyat artıq cavablandırılıb.");
  }
  if (!body.approve) {
    const result: ConfirmationResponse = { confirmation: toConfirmation((await findConfirmation(id))!) };
    return send(res, 200, result);
  }

  const tool = tools.get(stored.tool);
  const run = await tools.execute(stored.tool, JSON.parse(stored.params), emptyContext());
  const outcome = run.ok
    ? (tool?.done?.(JSON.parse(run.content)) ?? "Hazırdır.")
    : `Alınmadı: ${run.content.replace(/^Error: /, "")}`;
  await finishConfirmation(id, run.ok ? "done" : "failed", outcome);
  const messageId = await addMessage(Number(stored.conversation_id), { role: "assistant", text: `${run.ok ? "✓" : "⚠"} ${outcome}` });
  const messages = await conversationMessages(Number(stored.conversation_id));
  const result: ConfirmationResponse = {
    confirmation: toConfirmation((await findConfirmation(id))!),
    message: messages.find((m) => m.id === messageId),
  };
  send(res, 200, result);
}
