-- Yeni RFQ kartının altında daşıyıcı seçimi: seçim siyahısı (JSON) təsdiqlə birlikdə saxlanılır.

ALTER TABLE confirmations ADD COLUMN choices text;
