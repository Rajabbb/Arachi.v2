-- Agent-in etdiyi işlərin nəticə kartları (nə yaradıldı, kimlər əlavə olundu...): cavabla birlikdə saxlanılır.

ALTER TABLE conversation_messages ADD COLUMN cards text NOT NULL DEFAULT '[]';
