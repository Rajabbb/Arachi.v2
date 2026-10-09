import { arachi } from "./client";
import { currentCustomerId } from "../auth/current";

/** The few arachi.co endpoints the AI agent uses. Every call runs as the signed-in customer. */

export interface ArachiRfq {
  /** arachi.co's database id (used in API paths). */
  id: number;
  /** The number the panel on arachi.co shows ("RFQ #267"): newest = how many RFQs there are. This is what the user means. */
  display_id: number;
  origin: string;
  destination: string;
  cargo_type?: string | null;
  weight_kg?: number | null;
  volume_m3?: number | null;
  deadline?: string | null;
  truck_type?: string | null;
  hs_code?: string | null;
  shipment_type?: string | null;
  additional_notes?: string | null;
  status: string;
  created_at?: string;
  quotes_count?: number;
}

export interface ArachiCarrier {
  id: number;
  company_name: string;
  email: string;
  category_id?: number | null;
  sub_category_id?: number | null;
}

export interface ArachiOffer {
  id: number;
  carrier_id: number;
  carrier_company: string;
  carrier_email?: string;
  price: number | null;
  currency: string;
  transit_time_days: number | null;
  is_winner: boolean;
  extra_details: Record<string, unknown>;
  quote_history: unknown[];
}

export interface ArachiRecipient {
  quote_id: number;
  carrier_id: number;
  company_name: string;
  email: string;
  mail_status: string;
  is_viewed: boolean;
  has_submitted: boolean;
  is_public: boolean;
}

export async function listRfqs(): Promise<ArachiRfq[]> {
  const data = await arachi<{ requests?: Omit<ArachiRfq, "display_id">[] }>("GET", `/requests/customer/${currentCustomerId()}`);
  const rows = [...(data.requests ?? [])].sort((a, b) => b.id - a.id);
  // The panel numbers RFQs the same way (customer.html): total - position, newest first.
  return rows.map((r, i) => ({ ...r, display_id: rows.length - i }));
}

export interface NewRfq {
  origin: string;
  destination: string;
  cargo_type: string;
  weight_kg: number;
  volume_m3: number;
  deadline: string;
  truck_type: string;
  hs_code: string;
  shipment_type: string;
  additional_notes: string;
}

/** Creates the RFQ only; sending it to carriers is a separate, confirmed step. */
export async function createRfq(rfq: NewRfq): Promise<ArachiRfq> {
  const data = await arachi<{ request_details: ArachiRfq }>("POST", "/requests/create", {
    json: { ...rfq, customer_id: currentCustomerId(), send_option: "none", send_to_all: false },
  });
  return data.request_details;
}

export async function listCarriers(): Promise<ArachiCarrier[]> {
  return arachi<ArachiCarrier[]>("GET", `/carriers/customer/${currentCustomerId()}`);
}

export async function addCarriers(carriers: { name: string; email: string }[]): Promise<{ message: string }> {
  return arachi("POST", "/carriers/manual", { json: { customer_id: currentCustomerId(), carriers, skip_duplicates: true } });
}

export interface SendResult {
  request_id: number;
  sent: { carrier_id: number; company_name: string; email: string }[];
  skipped_already_sent: number[];
  public_link?: string;
}

export async function sendRfq(requestId: number, body: { carrier_ids?: number[]; send_to_all?: boolean }): Promise<SendResult> {
  return arachi("POST", `/requests/${requestId}/send`, { json: body });
}

export async function publicLink(requestId: number): Promise<string> {
  return (await arachi<{ public_link: string }>("POST", `/requests/${requestId}/public-link`)).public_link;
}

export async function offers(requestId: number): Promise<ArachiOffer[]> {
  return (await arachi<{ quotes?: ArachiOffer[] }>("GET", `/quotes/request/${requestId}`)).quotes ?? [];
}

export async function recipients(requestId: number): Promise<ArachiRecipient[]> {
  return (await arachi<{ carriers?: ArachiRecipient[] }>("GET", `/requests/carriers-status/${requestId}`)).carriers ?? [];
}

export async function selectWinner(requestId: number, quoteId: number): Promise<void> {
  await arachi("POST", "/quotes/select-winner", { json: { request_id: requestId, quote_id: quoteId } });
}

export async function remind(quoteIds: number[]): Promise<{ message: string }> {
  return arachi("POST", "/quotes/reminder-batch", { json: { quote_ids: quoteIds } });
}

export async function stats(): Promise<Record<string, number>> {
  return arachi("GET", `/customer/stats/${currentCustomerId()}`);
}

export interface ArachiCategory {
  id: number;
  name: string;
}

export async function listCategories(): Promise<ArachiCategory[]> {
  return (await arachi<{ categories?: ArachiCategory[] }>("GET", `/categories/customer/${currentCustomerId()}`)).categories ?? [];
}

export async function createCategory(name: string): Promise<ArachiCategory> {
  return (await arachi<{ category: ArachiCategory }>("POST", "/categories/create", { json: { customer_id: currentCustomerId(), name } })).category;
}

export async function listSubCategories(categoryId: number): Promise<ArachiCategory[]> {
  return (await arachi<{ data?: ArachiCategory[] }>("GET", `/carrier-sub-categories/${categoryId}`)).data ?? [];
}

export async function createSubCategory(categoryId: number, name: string): Promise<ArachiCategory> {
  return (await arachi<{ data: ArachiCategory }>("POST", "/carrier-sub-categories", { json: { category_id: categoryId, name } })).data;
}

/** category 0 / subcategory 0 clear the carriers' category. */
export async function setCategory(carrierIds: number[], categoryId: number, subCategoryId: number): Promise<void> {
  await arachi("POST", "/carriers/bulk-set-category", {
    json: { customer_id: currentCustomerId(), carrier_ids: carrierIds, category_id: categoryId, sub_category_id: subCategoryId },
  });
}

export async function deleteCarriers(carrierIds: number[]): Promise<void> {
  await arachi("POST", "/carriers/bulk-delete", { json: { customer_id: currentCustomerId(), carrier_ids: carrierIds } });
}

export async function importCarriersFile(name: string, data: Uint8Array, type: string): Promise<{ message: string }> {
  const form = new FormData();
  form.set("customer_id", String(currentCustomerId()));
  form.set("skip_duplicates", "1");
  form.set("file", new Blob([data as unknown as ArrayBuffer], { type: type || "application/octet-stream" }), name);
  return arachi("POST", "/carriers/upload-excel", { form });
}

export async function cancelWinner(quoteId: number): Promise<void> {
  await arachi("POST", `/quotes/cancel-winner/${quoteId}`);
}

export interface ReportQuery {
  report_type: "all" | "today" | "date_range" | "selected";
  report_category: "rfq" | "quotes";
  start_date?: string;
  end_date?: string;
  rfq_ids?: number[];
}

export async function report(query: ReportQuery): Promise<Record<string, string | number | null>[]> {
  const data = await arachi<{ data?: Record<string, string | number | null>[] }>("POST", "/reports/generate", {
    json: { customer_id: currentCustomerId(), ...query },
  });
  return data.data ?? [];
}

export interface CustomerQuoteRecord {
  request_id: number;
  quote_id: number;
  base_price: number;
  margin_type: "percent";
  margin_value: number;
  final_price: number;
  currency: string;
  valid_until?: string;
  terms_conditions?: string;
}

export async function saveCustomerQuote(record: CustomerQuoteRecord): Promise<void> {
  await arachi("POST", "/customer-quotes/create", { json: { customer_id: currentCustomerId(), ...record } });
}
