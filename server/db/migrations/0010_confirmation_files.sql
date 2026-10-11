-- Sorğu kartında "Fayl daşıyıcılara görünsün" seçimi: fayl təsdiq cavablanana qədər saxlanılır (base64 JSON), sonra silinir.

ALTER TABLE confirmations ADD COLUMN files text;
