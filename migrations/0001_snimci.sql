-- Snimak = stanje u jednom trenutku: očitanje s brojila (slika ili ručno),
-- uvoz s Moje mreže, ili oboje. Prijave još nema: `uredaj` je nasumični ključ
-- koji generira aplikacija ili preglednik (sigurnost dolazi kasnije).
CREATE TABLE snimci (
  id          TEXT PRIMARY KEY,
  uredaj      TEXT NOT NULL,
  stvoren     TEXT NOT NULL,              -- ISO 8601 UTC
  izvor       TEXT NOT NULL,              -- 'foto' | 'rucno' | 'hep'
  omm         TEXT,                       -- 10 znamenki
  t1          INTEGER,                    -- 1.8.1, viša tarifa, kWh
  t2          INTEGER,                    -- 1.8.2, niža tarifa, kWh
  slike       TEXT,                       -- JSON niz R2 ključeva
  ocr         TEXT,                       -- JSON: sirovi odgovor modela po slici
  lat         REAL,
  lon         REAL,
  tocnost_m   REAL,
  uvoz        TEXT,                       -- JSON iz HepUvoz.toJson()
  hep_dostava TEXT                        -- JSON odgovor POST /Omm/Dostava
);
CREATE INDEX snimci_uredaj ON snimci (uredaj, stvoren DESC);
