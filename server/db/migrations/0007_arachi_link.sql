-- arachi.co ilə birləşmə: istifadəçilər arachi.co-dan SSO ilə gəlir. Hər v2 hesabı bir arachi.co müştərisinə bağlıdır,
-- sessiya isə həmin müştəri adından arachi.co API-sinə girişi (şifrələnmiş token) saxlayır.

ALTER TABLE users ADD COLUMN arachi_customer_id bigint;
CREATE UNIQUE INDEX users_arachi_customer ON users (arachi_customer_id) WHERE arachi_customer_id IS NOT NULL;

ALTER TABLE sessions ADD COLUMN arachi_token text;
ALTER TABLE sessions ADD COLUMN arachi_expires_at text;
