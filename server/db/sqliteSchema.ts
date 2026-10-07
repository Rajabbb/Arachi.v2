/**
 * SQLite schema (local-development fallback), applied in order and tracked
 * with PRAGMA user_version. The Postgres schema lives in migrations/*.sql;
 * a schema change goes into both. Never edit a migration that has shipped;
 * append a new one instead.
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

  // 5: carrier offers (every submission is a new version) and stored files.
  `
  CREATE TABLE offers (
    id INTEGER PRIMARY KEY,
    rfq_id INTEGER NOT NULL REFERENCES rfqs (id),
    carrier_id INTEGER NOT NULL REFERENCES carriers (id),
    dispatch_id INTEGER REFERENCES dispatches (id),
    version INTEGER NOT NULL,
    price REAL NOT NULL,
    currency TEXT NOT NULL,
    transit_days INTEGER NOT NULL,
    valid_until TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (rfq_id, carrier_id, version)
  );
  CREATE TABLE files (
    id INTEGER PRIMARY KEY,
    owner_kind TEXT NOT NULL,
    owner_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    data BLOB NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX files_owner ON files (owner_kind, owner_id);
  `,

  // 6: the offer chosen as winner.
  `
  ALTER TABLE rfqs ADD COLUMN awarded_offer_id INTEGER REFERENCES offers (id);
  ALTER TABLE rfqs ADD COLUMN awarded_at TEXT;
  `,

  // 7: the email provider's message id, for matching delivery webhooks later.
  `
  ALTER TABLE outbox ADD COLUMN provider_id TEXT;
  `,

  // 8: user accounts, sessions, password resets; RFQs, carriers and messages get an owner.
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX users_email ON users (lower(email));
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX sessions_user ON sessions (user_id);
  CREATE TABLE password_resets (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT
  );
  CREATE INDEX password_resets_user ON password_resets (user_id);
  ALTER TABLE rfqs ADD COLUMN user_id INTEGER REFERENCES users (id);
  ALTER TABLE carriers ADD COLUMN user_id INTEGER REFERENCES users (id);
  ALTER TABLE outbox ADD COLUMN user_id INTEGER REFERENCES users (id);
  CREATE INDEX rfqs_user ON rfqs (user_id);
  CREATE INDEX outbox_user ON outbox (user_id);
  DROP INDEX carriers_email;
  CREATE UNIQUE INDEX carriers_email ON carriers (user_id, lower(email)) WHERE email IS NOT NULL;
  `,

  // 9: real email delivery status from Resend (polling or webhook), tied to its dispatch.
  `
  ALTER TABLE outbox ADD COLUMN dispatch_id INTEGER REFERENCES dispatches (id);
  ALTER TABLE outbox ADD COLUMN provider_status TEXT;
  ALTER TABLE outbox ADD COLUMN provider_detail TEXT;
  ALTER TABLE outbox ADD COLUMN status_checked_at TEXT;
  CREATE INDEX outbox_provider_id ON outbox (provider_id);
  `,

  // 10: several separate offers per carrier and RFQ (offer_no), each with its own versions.
  // SQLite cannot drop a UNIQUE constraint, so the table is rebuilt with the same ids.
  `
  CREATE TABLE offers_new (
    id INTEGER PRIMARY KEY,
    rfq_id INTEGER NOT NULL REFERENCES rfqs (id),
    carrier_id INTEGER NOT NULL REFERENCES carriers (id),
    dispatch_id INTEGER REFERENCES dispatches (id),
    offer_no INTEGER NOT NULL DEFAULT 1,
    version INTEGER NOT NULL,
    price REAL NOT NULL,
    currency TEXT NOT NULL,
    transit_days INTEGER NOT NULL,
    valid_until TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (rfq_id, carrier_id, offer_no, version)
  );
  INSERT INTO offers_new (id, rfq_id, carrier_id, dispatch_id, offer_no, version, price, currency, transit_days,
    valid_until, notes, source, created_at)
  SELECT id, rfq_id, carrier_id, dispatch_id, 1, version, price, currency, transit_days,
    valid_until, notes, source, created_at FROM offers;
  DROP TABLE offers;
  ALTER TABLE offers_new RENAME TO offers;
  `,

  // 11: chat history: conversations, their messages, and the model's context of the latest turns.
  `
  CREATE TABLE conversations (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    context TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX conversations_user ON conversations (user_id, updated_at);
  CREATE TABLE conversation_messages (
    id INTEGER PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    text TEXT NOT NULL,
    attachments TEXT NOT NULL DEFAULT '[]',
    downloads TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
  );
  CREATE INDEX conversation_messages_conversation ON conversation_messages (conversation_id, id);
  `,

  // 12: actions that send messages wait for the user's "Bəli" (see migrations/0006_confirmations.sql).
  `
  CREATE TABLE confirmations (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    conversation_id INTEGER NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
    message_id INTEGER REFERENCES conversation_messages (id) ON DELETE CASCADE,
    tool TEXT NOT NULL,
    params TEXT NOT NULL,
    summary TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    result TEXT NOT NULL DEFAULT '',
    noted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    resolved_at TEXT
  );
  CREATE INDEX confirmations_conversation ON confirmations (conversation_id, status);
  `,
];
