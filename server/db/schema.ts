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

  // 3: carrier base.
  `
  CREATE TABLE carriers (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT NOT NULL DEFAULT '',
    whatsapp TEXT NOT NULL DEFAULT '',
    telegram TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL,
    subcategory TEXT NOT NULL DEFAULT '',
    language TEXT NOT NULL DEFAULT 'az',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX carriers_email ON carriers (lower(email)) WHERE email IS NOT NULL;
  `,

  // 4: an RFQ sent to one carrier, with its personal link and delivery status.
  `
  CREATE TABLE dispatches (
    id INTEGER PRIMARY KEY,
    rfq_id INTEGER NOT NULL REFERENCES rfqs (id),
    carrier_id INTEGER NOT NULL REFERENCES carriers (id),
    channel TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    sent_at TEXT NOT NULL,
    viewed_at TEXT,
    reminder_count INTEGER NOT NULL DEFAULT 0,
    last_reminder_at TEXT,
    UNIQUE (rfq_id, carrier_id)
  );
  `,
];
