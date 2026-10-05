/**
 * Schema migrations, applied in order and tracked with PRAGMA user_version.
 * Never edit a migration that has shipped; append a new one instead.
 */
export const migrations: string[] = [
  // 1: key/value settings and the log of outgoing messages.
  `
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE outbox (
    id INTEGER PRIMARY KEY,
    channel TEXT NOT NULL,
    recipient TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    delivered INTEGER NOT NULL,
    error TEXT,
    created_at TEXT NOT NULL
  );
  `,

  // 2: freight requests for quotation (RFQ).
  `
  CREATE TABLE rfqs (
    id INTEGER PRIMARY KEY,
    origin TEXT NOT NULL,
    destination TEXT NOT NULL,
    cargo_type TEXT NOT NULL,
    weight_kg REAL NOT NULL,
    volume_m3 REAL NOT NULL DEFAULT 0,
    pallets INTEGER NOT NULL DEFAULT 0,
    transport_type TEXT NOT NULL,
    loading_date TEXT NOT NULL DEFAULT '',
    delivery_date TEXT NOT NULL DEFAULT '',
    currency TEXT NOT NULL,
    offer_deadline TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'chat',
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL
  );
  `,
];
