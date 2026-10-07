import pg from "pg";
import { config } from "../config";
import { connectionUrl, sslOptions } from "./postgres";

/**
 * Checks that the database accepts a connection with the TLS settings the
 * app would use (DATABASE_SSL_CA included), without touching the running
 * app: deploy/check-db-ssl.sh runs it in a one-off container.
 */
if (!config.databaseUrl) {
  console.error("XƏTA: DATABASE_URL boşdur.");
  process.exit(1);
}
const verified = Boolean(config.databaseSslCa);
const pool = new pg.Pool({ connectionString: connectionUrl(config.databaseUrl), ssl: sslOptions(config.databaseUrl), max: 1 });
try {
  await pool.query("SELECT 1");
  console.log(
    verified
      ? `OK: baza sertifikatla tam yoxlanaraq qoşuldu (${config.databaseSslCa}).`
      : "OK: baza qoşuldu, amma DATABASE_SSL_CA verilmədiyi üçün sertifikat yoxlanmadı.",
  );
} catch (err) {
  console.error(`XƏTA: qoşulmaq alınmadı: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
