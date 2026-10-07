import type { ServerResponse } from "node:http";
import type { RfqDetailData, RfqListData } from "../../shared/protocol";
import { listRfqs, rfqDetail } from "../domain/rfqOverview";
import { findRfq } from "../domain/rfqs";
import { HttpError, send } from "../http";
import { now } from "../db";
import { collectReport, reportWorkbook, XLSX } from "../docs/rfqReport";

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

/** GET /api/rfqs/report — the Excel report of every RFQ of the signed-in user (the panel's download button). */
export async function handleRfqReport(res: ServerResponse) {
  const data = await reportWorkbook(await collectReport(0));
  const name = `RFQ-hesabati-${now().slice(0, 10)}.xlsx`;
  res.writeHead(200, {
    "content-type": XLSX,
    "content-length": data.byteLength,
    "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
  });
  res.end(Buffer.from(data));
}
