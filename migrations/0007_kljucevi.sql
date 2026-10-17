-- SEC-05: ključevi uređaja koje server poznaje. Upis (POST/PATCH) registrira ključ
-- (src/middleware.ts), mail na racuni+<ključ>@ prihvaća se samo za poznat ključ, a
-- zamijenjen ključ (POST /api/kljuc/rotiraj) ostaje ovdje s `zamijenjen` da stara
-- oznaka dobije 401 umjesto da tiho otvori novi „račun“.
CREATE TABLE kljucevi (
  kljuc      TEXT PRIMARY KEY,
  stvoren    TEXT NOT NULL,             -- ISO 8601 UTC
  zadnji     TEXT NOT NULL,             -- zadnji upis
  zamijenjen TEXT                       -- kad je rotiran; NULL dok je aktivan
);

INSERT OR IGNORE INTO kljucevi (kljuc, stvoren, zadnji)
SELECT uredaj, MIN(t), MAX(t) FROM (
  SELECT uredaj, stvoren AS t FROM snimci
  UNION ALL SELECT uredaj, primljen FROM mailovi
  UNION ALL SELECT uredaj, stvoren FROM dogadaji WHERE uredaj IS NOT NULL
) GROUP BY uredaj;
