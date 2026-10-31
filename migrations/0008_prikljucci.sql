-- Priključna snaga i broj faza po OMM-u: iz HEP-ova odgovora proslijeđenog na
-- racuni+<ključ>@ (src/lib/prikljucak.ts) ili ručno. Ne vidi se ni na jednom portalu.
CREATE TABLE prikljucci (
  uredaj     TEXT NOT NULL,
  omm        TEXT NOT NULL,
  snaga_kw   REAL NOT NULL,
  faze       INTEGER,                   -- 1 | 3; NULL kad HEP ne kaže
  osigurac_a INTEGER,                   -- glavni osigurač po fazi (3x16 A → 16)
  izvor      TEXT NOT NULL,             -- 'mail' | 'rucno'
  tekst      TEXT,                      -- rečenica iz koje je pročitano (samo za 'mail')
  azuriran   TEXT NOT NULL,             -- ISO 8601 UTC
  PRIMARY KEY (uredaj, omm)
);
