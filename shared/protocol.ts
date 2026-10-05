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
  /** The carrier's own offers for this RFQ, oldest version first. */
  offers: {
    version: number;
    price: number;
    currency: string;
    transit_days: number;
    valid_until: string;
    notes: string;
    created_at: string;
    documents: Download[];
  }[];
}

/** POST /api/quote/:token — a carrier's offer (a new version each time). */
export interface QuoteSubmission {
  price: number;
  currency: string;
  transit_days: number;
  valid_until?: string;
  notes?: string;
  files?: UploadedFile[];
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
  recentOffers: {
    id: number;
    rfq_id: number;
    origin: string;
    destination: string;
    carrier: string;
    version: number;
    price: number;
    currency: string;
    transit_days: number;
    created_at: string;
    winner: boolean;
  }[];
}
