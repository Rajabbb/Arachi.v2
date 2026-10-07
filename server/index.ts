import { createServer } from "node:http";
import { app } from "./app";
import { config } from "./config";
import { closeDatabase, openDatabase } from "./db";
import { sendsForReal } from "./notify";
import { startEmailStatusPolling, statusCheckingEnabled } from "./notify/emailStatus";
import { provider } from "./agent/providers";

const server = createServer(app);

// Connect and apply pending migrations before taking requests.
try {
  const database = await openDatabase();
  if (database.kind !== "postgres" && process.env.NODE_ENV === "production") {
    console.warn("DATABASE_URL is not set: data goes to a local SQLite file, which most hosts erase on every deploy.");
  }
  console.log(database.kind === "postgres" ? "Database: Postgres (DATABASE_URL)" : `Database: SQLite (${config.dbPath})`);
} catch (err) {
  console.error("Could not open the database:", err instanceof Error ? err.message : err);
  process.exit(1);
}
console.log(sendsForReal("email") ? "Email: Resend" : "Email: log only (set RESEND_API_KEY and EMAIL_FROM to send)");
if (statusCheckingEnabled()) {
  startEmailStatusPolling();
  console.log("Email delivery status: checked with Resend every minute (bounces show as Çatdırılmadı)");
}
if (config.resendWebhookSecret) {
  console.log("Email delivery status: Resend webhook at /api/webhooks/resend, signed events applied right away");
}

server.listen(config.port, () => {
  const ai = provider();
  const fallback = ai.name === "gemini" && config.geminiFallbackModel ? `, fallback ${config.geminiFallbackModel}` : "";
  console.log(`AI: ${ai.name} (${ai.model}${fallback})`);
  const key = ai.name === "gemini" ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY";
  if (!process.env[key]) {
    console.warn(`${key} is not set; copy .env.example to .env and fill it in.`);
  }
  console.log(`Agent server listening on port ${config.port}`);
  console.log(`Links in emails and chat point to ${config.publicBaseUrl}`);
  if (process.env.NODE_ENV === "production" && config.publicBaseUrl.includes("localhost")) {
    console.warn("PUBLIC_BASE_URL is not set: links sent to carriers will point to localhost.");
  }
});

// Hosting platforms stop the old instance with SIGTERM on each deploy: finish open requests first.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    server.close(() => {
      void closeDatabase().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}
