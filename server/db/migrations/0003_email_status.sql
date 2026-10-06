-- Real delivery status of outgoing emails, as Resend reports it (polled
-- from its API, or pushed by its webhook once the app is hosted).
-- dispatch_id ties an RFQ email or reminder to the dispatch whose panel
-- status it drives.

ALTER TABLE outbox ADD COLUMN dispatch_id bigint REFERENCES dispatches (id);
-- Resend's last event: sent, delivered, opened, bounced, complained, ...
ALTER TABLE outbox ADD COLUMN provider_status text;
-- Why it was not delivered, e.g. the bounce message.
ALTER TABLE outbox ADD COLUMN provider_detail text;
ALTER TABLE outbox ADD COLUMN status_checked_at text;
CREATE INDEX outbox_provider_id ON outbox (provider_id);
