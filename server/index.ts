import { createServer } from "node:http";
import { app } from "./app";
import { config } from "./config";
import { openDatabase } from "./db";
import { sendsForReal } from "./notify";
import { startEmailStatusPolling, statusCheckingEnabled } from "./notify/emailStatus";
import { provider } from "./agent/providers";

const server = createServer(app);

// Connect and apply pending migrations before taking requests.
try {
  const database = await openDatabase();
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

server.listen(config.port, () => {
  const ai = provider();
  const fallback = ai.name === "gemini" && config.geminiFallbackModel ? `, fallback ${config.geminiFallbackModel}` : "";
  console.log(`AI: ${ai.name} (${ai.model}${fallback})`);
  const key = ai.name === "gemini" ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY";
  if (!process.env[key]) {
    console.warn(`${key} is not set; copy .env.example to .env and fill it in.`);
  }
  console.log(`Agent server listening on http://localhost:${config.port}`);
});
