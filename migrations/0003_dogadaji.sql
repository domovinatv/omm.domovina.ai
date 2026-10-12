-- Sirovi dnevnik: svaki dolazni zahtjev koji nešto upisuje, i duplikati.
-- `snimci` je pročišćena tablica (jedan redak po otisku); ovdje se vidi koliko
-- je puta i kada isti snimak stigao.
CREATE TABLE dogadaji (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  stvoren    TEXT NOT NULL,             -- ISO 8601 UTC
  uredaj     TEXT,
  vrsta      TEXT NOT NULL,             -- 'snimak' | 'ocitaj' | 'dostava' | 'brisanje'
  ishod      TEXT NOT NULL,             -- 'novo' | 'duplikat' | 'greska' | 'ok'
  snimak_id  TEXT,
  otisak     TEXT,
  tijelo     TEXT,                      -- JSON zahtjeva (bez slike) ili odgovora
  user_agent TEXT,
  ip_drzava  TEXT
);
CREATE INDEX dogadaji_uredaj ON dogadaji (uredaj, stvoren);
CREATE INDEX dogadaji_snimak ON dogadaji (snimak_id);
