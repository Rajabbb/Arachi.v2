import type { ServerResponse } from "node:http";
import type { CarrierDetailData, CarrierListData } from "../../shared/protocol";
import { carrierDetail, findCarrier, listCarriers } from "../domain/carrierOverview";
import { HttpError, send } from "../http";

/** GET /api/carriers — the signed-in user's carrier base for the panel. */
export async function handleCarrierList(res: ServerResponse) {
  const body: CarrierListData = { carriers: await listCarriers() };
  send(res, 200, body);
}

/** GET /api/carriers/:id — one carrier's page; another user's carrier is a 404. */
export async function handleCarrierDetail(res: ServerResponse, id: string) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0 || !(await findCarrier(n))) throw new HttpError(404, "Daşıyıcı tapılmadı.");
  const body: CarrierDetailData = await carrierDetail(n);
  send(res, 200, body);
}
