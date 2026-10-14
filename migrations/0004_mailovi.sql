-- Dolazni mailovi na racuni+<ključ>@omm.domovina.ai (Email Routing → Worker).
-- Ne čuva se sadržaj maila ni PDF, samo što je iz njega pročitano.
CREATE TABLE mailovi (
  id        TEXT PRIMARY KEY,
  uredaj    TEXT NOT NULL,
  primljen  TEXT NOT NULL,             -- ISO 8601 UTC
  od        TEXT,
  naslov    TEXT,
  vrsta     TEXT NOT NULL,             -- 'racun' | 'gmail-potvrda' | 'ostalo'
  ishod     TEXT NOT NULL,             -- 'novo' | 'duplikat' | 'nije-racun' | 'greska'
  poruka    TEXT,                      -- JSON: sažetak računa, Gmailov kod, ili greška
  snimak_id TEXT
);
CREATE INDEX mailovi_uredaj ON mailovi (uredaj, primljen DESC);
