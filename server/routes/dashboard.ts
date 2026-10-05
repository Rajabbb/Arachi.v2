import type { IncomingMessage, ServerResponse } from "node:http";
import { dashboard } from "../domain/dashboard";
import { HttpError, send } from "../http";

/** GET /api/dashboard?days=30 — data for the analytics panel. */
export function handleDashboard(req: IncomingMessage, res: ServerResponse) {
  const days = Number(new URL(req.url ?? "/", "http://localhost").searchParams.get("days") ?? 30);
  if (!Number.isInteger(days) || days <= 0 || days > 3650) throw new HttpError(400, "Dövr yanlışdır.");
  send(res, 200, dashboard(days));
}
