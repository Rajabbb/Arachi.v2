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
];
