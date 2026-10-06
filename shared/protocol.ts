// Contract between the browser UI and the agent server (POST /api/chat).
// Imported by both sides; keep it free of runtime dependencies.

export interface UploadedFile {
  name: string;
  /** MIME type as reported by the browser; may be empty. */
  type: string;
  /** Base64-encoded file contents (no data: prefix). */
  data: string;
}

export interface ChatRequest {
  /**
   * The conversation so far, exactly as the server last returned it.
   * The UI treats it as opaque and sends it back unchanged (append-only).
   */
  transcript: unknown[];
  message: {
    text: string;
    files: UploadedFile[];
  };
}

export interface ToolCallSummary {
  name: string;
  /** Final parameters the tool ran with (defaults merged with overrides). */
  params: Record<string, unknown>;
  /** Parameters the model set explicitly, i.e. the user's overrides. */
  overrides: string[];
  ok: boolean;
}

/** A file a tool generated (PDF, Excel, ...) that the user can download. */
export interface Download {
  name: string;
  url: string;
}

export interface ChatResponse {
  reply: string;
  transcript: unknown[];
  toolCalls: ToolCallSummary[];
  downloads: Download[];
}

export interface ChatError {
  error: string;
}

/** GET /api/quote/:token — what a carrier sees on their personal quote page. */
export interface QuotePageData {
  rfq: {
    id: number;
    origin: string;
    destination: string;
    cargo_type: string;
    weight_kg: number;
    volume_m3: number;
    pallets: number;
    transport_type: string;
    loading_date: string;
    delivery_date: string;
    currency: string;
    offer_deadline: string;
    notes: string;
    /** False once a winner is chosen; the form is then closed. */
    open: boolean;
  };
  carrier: { name: string; language: "az" | "en" };
  /** Azerbaijani status label, e.g. "Baxıldı". */
  status: string;
  /** sent | delivered | viewed | offered | failed */
  statusCode: string;
  /** The carrier's own offers for this RFQ (offer 1, 2, ...), each with its versions oldest first. */
  offers: {
    offer_no: number;
    versions: {
      version: number;
      price: number;
      currency: string;
      transit_days: number;
      valid_until: string;
      notes: string;
      created_at: string;
      documents: Download[];
    }[];
  }[];
}

/**
 * POST /api/quote/:token — a carrier's offer: a new, separate offer, or
 * (with offer_no) a new version of one of their earlier offers.
 */
export interface QuoteSubmission {
  price: number;
  currency: string;
  transit_days: number;
  valid_until?: string;
  notes?: string;
  files?: UploadedFile[];
  /** The carrier's offer to update; omitted or 0 = send a new offer. */
  offer_no?: number;
}

/** GET /api/dashboard?days=N — numbers for the analytics panel. */
export interface DashboardData {
  generatedAt: string;
  periodDays: number;
  /** RFQs still collecting offers (all time). */
  activeRfqs: number;
  /** RFQs with a chosen winner, i.e. booked shipments (all time). */
  awardedRfqs: number;
  rfqsCreated: number;
  carriers: number;
  offersReceived: number;
  /** Percent of carriers reached that sent an offer; null when nothing was sent. */
  responseRate: number | null;
  statuses: { status: string; label: string; count: number }[];
  awardedValue: { currency: string; total: number }[];
  /** Latest RFQs that did not reach a carrier (bounced email, no address, ...), with the reason. */
  failedDeliveries: { rfq_id: number; carrier: string; channel: string; error: string | null; sent_at: string }[];
  recentOffers: {
    id: number;
    rfq_id: number;
    origin: string;
    destination: string;
    carrier: string;
    offer_no: number;
    /** How many separate offers this carrier sent for the RFQ. */
    carrier_offers: number;
    version: number;
    price: number;
    currency: string;
    transit_days: number;
    created_at: string;
    winner: boolean;
  }[];
}

/** The signed-in user, from /api/auth/me, login, register and password reset. */
export interface AuthResponse {
  user: { id: number; email: string; name: string };
}

/** GET /api/rfqs — every RFQ of the signed-in user, newest first. */
export interface RfqListItem {
  id: number;
  origin: string;
  destination: string;
  cargo_type: string;
  weight_kg: number;
  transport_type: string;
  currency: string;
  offer_deadline: string;
  created_at: string;
  /** open | awarded | closed */
  status: string;
  /** Azerbaijani label, e.g. "Təklif toplanır". */
  statusLabel: string;
  /** Carriers the RFQ was sent to. */
  carriersSent: number;
  /** Carriers that sent at least one offer. */
  carriersResponded: number;
  /** Cheapest latest offer, in the RFQ currency when there is one. */
  bestPrice: { price: number; currency: string } | null;
  /** The latest version of every offer (a carrier may have several), cheapest first. */
  offers: RfqOfferSummary[];
}

/** The latest version of one carrier offer for an RFQ, with how it compares to the others. */
export interface RfqOfferSummary {
  id: number;
  carrier_id: number;
  carrier: string;
  /** The carrier's Nth separate offer for this RFQ. */
  offer_no: number;
  /** How many separate offers this carrier sent for the RFQ; offer_no is worth showing when above 1. */
  carrier_offers: number;
  version: number;
  price: number;
  currency: string;
  transit_days: number;
  valid_until: string;
  created_at: string;
  expired: boolean;
  /** Cheapest among offers in the RFQ currency (other currencies are not compared without a rate). */
  cheapest: boolean;
  fastest: boolean;
  winner: boolean;
}

export interface RfqListData {
  rfqs: RfqListItem[];
}

/** GET /api/rfqs/:id — everything about one RFQ for its detail page. */
export interface RfqDetailData {
  rfq: Omit<RfqListItem, "offers"> & {
    volume_m3: number;
    pallets: number;
    loading_date: string;
    delivery_date: string;
    notes: string;
    source: string;
    awarded_at: string | null;
  };
  /** One row per carrier the RFQ was sent to (or shared a link with). */
  carriers: {
    carrier_id: number;
    name: string;
    email: string | null;
    channel: string;
    /** sent | delivered | viewed | offered | failed */
    status: string;
    statusLabel: string;
    /** Why it was not delivered, e.g. the bounce message. */
    error: string | null;
    sent_at: string;
    viewed_at: string | null;
    reminder_count: number;
    last_reminder_at: string | null;
  }[];
  /** The latest version of every offer, cheapest first, with that offer's earlier versions. */
  offers: (RfqOfferSummary & {
    notes: string;
    source: string;
    documents: Download[];
    /** Earlier versions, newest first. */
    previous: { id: number; version: number; price: number; currency: string; transit_days: number; notes: string; created_at: string }[];
  })[];
  /** True when the offers are in more than one currency, so "cheapest" compares within the RFQ currency only. */
  mixedCurrencies: boolean;
}
