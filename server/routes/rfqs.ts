import type { ServerResponse } from "node:http";
import type { RfqDetailData, RfqListData } from "../../shared/protocol";
import { listRfqs, rfqDetail } from "../domain/rfqOverview";
import { findRfq } from "../domain/rfqs";
import { HttpError, send } from "../http";

/** GET /api/rfqs — the signed-in user's RFQs for the panel list. */
export async function handleRfqList(res: ServerResponse) {
  const body: RfqListData = { rfqs: await listRfqs() };
  send(res, 200, body);
}

/** GET /api/rfqs/:id — one RFQ's detail page; another user's RFQ is a 404. */
export async function handleRfqDetail(res: ServerResponse, id: string) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0 || !(await findRfq(n))) throw new HttpError(404, "Sorğu tapılmadı.");
  const body: RfqDetailData = await rfqDetail(n);
  send(res, 200, body);
}
