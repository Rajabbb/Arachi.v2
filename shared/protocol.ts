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
