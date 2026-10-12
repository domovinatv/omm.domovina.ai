-- Otisak sadržaja snimka, da ponovljeni klik ili ponovljeni zahtjev ne stvori
-- duplikat. Uvoz s HEP-a: isti `uvoz` (nosi trenutak dohvata). Očitanje: isti
-- OMM i brojevi istog dana (UTC). Stari retci ostaju bez otiska.
ALTER TABLE snimci ADD COLUMN otisak TEXT;
CREATE UNIQUE INDEX snimci_otisak ON snimci (uredaj, otisak);
