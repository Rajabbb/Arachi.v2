-- A carrier can send several separate offers for one RFQ, and update any of
-- them. offer_no numbers a carrier's offers within an RFQ (1, 2, ...); each
-- offer keeps its own version history (v1, v2, ...). Existing offers are
-- offer 1 of their carrier, so their versions stay as they were.

ALTER TABLE offers ADD COLUMN offer_no integer NOT NULL DEFAULT 1;
ALTER TABLE offers DROP CONSTRAINT offers_rfq_id_carrier_id_version_key;
ALTER TABLE offers ADD CONSTRAINT offers_rfq_carrier_offer_version UNIQUE (rfq_id, carrier_id, offer_no, version);
