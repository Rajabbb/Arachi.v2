-- Plan və Aİ sorğu limiti: arachi.co-dan SSO zamanı gəlir, burada saxlanılır (sorğu sayğacı söhbət silinsə də azalmır).

ALTER TABLE users ADD COLUMN sub_plan text;
ALTER TABLE users ADD COLUMN sub_label text;
ALTER TABLE users ADD COLUMN sub_ai_limit integer;
ALTER TABLE users ADD COLUMN sub_ai_period text;
ALTER TABLE users ADD COLUMN sub_trial_ends_at text;

CREATE TABLE ai_usage (
  user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  period text NOT NULL,
  used integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, period)
);

ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;
