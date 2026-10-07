import type { IncomingMessage, ServerResponse } from "node:http";
import { dashboard } from "../domain/dashboard";
import { isMonth, lastMonths, monthlyReport } from "../domain/analytics";
import { HttpError, send } from "../http";

/** GET /api/dashboard?days=30 — data for the analytics panel. */
export async function handleDashboard(req: IncomingMessage, res: ServerResponse) {
  const days = Number(new URL(req.url ?? "/", "http://localhost").searchParams.get("days") ?? 30);
  if (!Number.isInteger(days) || days <= 0 || days > 3650) throw new HttpError(400, "Dövr yanlışdır.");
  send(res, 200, await dashboard(days));
}

/** GET /api/report?month=2026-10 — one month's report for the panel (the current month by default). */
export async function handleMonthlyReport(req: IncomingMessage, res: ServerResponse) {
  const month = new URL(req.url ?? "/", "http://localhost").searchParams.get("month") ?? lastMonths(1)[0];
  if (!isMonth(month)) throw new HttpError(400, "Ay yanlışdır.");
  send(res, 200, await monthlyReport(month));
}
