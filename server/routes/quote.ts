import type { IncomingMessage, ServerResponse } from "node:http";
import type { QuotePageData, QuoteSubmission } from "../../shared/protocol";
import { getCarrier } from "../domain/carriers";
import { dispatchFromToken, findDispatch, markViewed, statusLabels, type Dispatch } from "../domain/dispatches";
import { filesOf } from "../domain/files";
import { groupByOffer, offerVersions, submitOffer } from "../domain/offers";
import { getRfq } from "../domain/rfqs";
import { HttpError, readJson, send } from "../http";
import { asUser } from "../auth/current";
import { clientIp, limit } from "../rateLimit";

/** Documents one quote submission may carry. */
const MAX_FILES = 10;

/**
 * The carrier's quote page API. The signed token in the link is the only
 * credential: it names one RFQ sent to one carrier, so no login is needed.
 */
export async function handleQuote(req: IncomingMessage, res: ServerResponse, token: string) {
  const dispatch = await dispatchFromToken(token);
  // An RFQ from before accounts that no user has taken over yet has no owner to act for.
  if (!dispatch || dispatch.user_id === null) throw new HttpError(404, "Link etibarsızdır və ya vaxtı keçib.");
  await asUser(dispatch.user_id, () => respond(req, res, dispatch));
}

async function respond(req: IncomingMessage, res: ServerResponse, dispatch: Dispatch) {
  if (req.method === "GET") {
    await markViewed(dispatch);
    return send(res, 200, await pageData(dispatch));
  }
  if (req.method === "POST") {
    // The link needs no login, so cap how often one address can submit (and store files).
    limit(`quote:${clientIp(req)}`, 30, 60);
    const body = parseSubmission(await readJson(req));
    try {
      await submitOffer({
        rfqId: dispatch.rfq_id,
        carrierId: dispatch.carrier_id,
        dispatchId: dispatch.id,
        price: body.price,
        currency: body.currency,
        transitDays: body.transit_days,
        validUntil: body.valid_until ?? "",
        notes: body.notes ?? "",
        source: "link",
        files: body.files ?? [],
        offerNo: body.offer_no || undefined,
      });
    } catch (err) {
      throw new HttpError(400, err instanceof Error ? err.message : String(err));
    }
    return send(res, 200, await pageData(dispatch));
  }
  throw new HttpError(405, "Bu əməliyyat dəstəklənmir.");
}

export async function pageData(dispatch: Dispatch): Promise<QuotePageData> {
  const rfq = await getRfq(dispatch.rfq_id);
  const carrier = await getCarrier(dispatch.carrier_id);
  // Re-read so the page shows the status after this request's update.
  const fresh = (await findDispatch(dispatch.id)) ?? dispatch;
  const versions = await offerVersions(rfq.id, carrier.id);
  const documents = new Map(
    await Promise.all(versions.map(async (o) => [o.id, await filesOf("offer", o.id)] as const)),
  );
  return {
    rfq: {
      id: rfq.id,
      origin: rfq.origin,
      destination: rfq.destination,
      cargo_type: rfq.cargo_type,
      weight_kg: rfq.weight_kg,
      volume_m3: rfq.volume_m3,
      pallets: rfq.pallets,
      transport_type: rfq.transport_type,
      loading_date: rfq.loading_date,
      delivery_date: rfq.delivery_date,
      currency: rfq.currency,
      offer_deadline: rfq.offer_deadline,
      notes: rfq.notes,
      open: rfq.status === "open",
    },
    carrier: { name: carrier.name, language: carrier.language },
    status: statusLabels[fresh.status],
    statusCode: fresh.status,
    offers: groupByOffer(versions).map((g) => ({
      offer_no: g.offer_no,
      versions: g.versions.map((o) => ({
        version: o.version,
        price: o.price,
        currency: o.currency,
        transit_days: o.transit_days,
        valid_until: o.valid_until,
        notes: o.notes,
        created_at: o.created_at,
        documents: documents.get(o.id)!.map(({ name, url }) => ({ name, url })),
      })),
    })),
  };
}

function parseSubmission(body: unknown): QuoteSubmission {
  const b = body as Partial<QuoteSubmission> | null;
  const ok =
    b !== null &&
    typeof b === "object" &&
    typeof b.price === "number" &&
    typeof b.currency === "string" &&
    typeof b.transit_days === "number" &&
    (b.valid_until === undefined || typeof b.valid_until === "string") &&
    (b.notes === undefined || typeof b.notes === "string") &&
    (b.offer_no === undefined || (Number.isInteger(b.offer_no) && b.offer_no >= 0)) &&
    (b.files === undefined ||
      (Array.isArray(b.files) &&
        b.files.every((f) => typeof f?.name === "string" && typeof f.type === "string" && typeof f.data === "string")));
  if (!ok) throw new HttpError(400, "Təklifin formatı yanlışdır.");
  if ((b.files?.length ?? 0) > MAX_FILES) throw new HttpError(400, `Ən çox ${MAX_FILES} sənəd əlavə etmək olar.`);
  return b as QuoteSubmission;
}
