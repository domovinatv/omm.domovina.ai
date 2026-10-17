-- SEC-03 (docs/security/2026-10-16-security-audit-fable.md): dnevnik čuva oblik
-- zahtjeva, ne sadržaj. Stari retci `snimak` nosili su cijeli uvoz (ime, adresa,
-- promet); ovdje postaju sažetak kakav od 2026-10-17 piše src/pages/api/snimak.
UPDATE dogadaji
   SET tijelo = json_object(
         'izvor', json_extract(tijelo, '$.izvor'),
         'omm', json_extract(tijelo, '$.omm'),
         'bajtova', length(tijelo),
         'mjesta', json_array_length(tijelo, '$.uvoz.mjesta'),
         'kupci', json_array_length(tijelo, '$.uvoz.kupci'))
 WHERE vrsta = 'snimak' AND json_valid(tijelo);

UPDATE dogadaji
   SET tijelo = json_object('omm', json_extract(tijelo, '$.omm'), 'status', json_extract(tijelo, '$.hep_dostava.Status'))
 WHERE vrsta = 'dostava' AND json_valid(tijelo);

UPDATE dogadaji
   SET tijelo = json_object('slika', json_extract(tijelo, '$.slika'), 'model', json_extract(tijelo, '$.model'),
                            'registri', json_extract(tijelo, '$.registri'), 'greska', json_extract(tijelo, '$.greska'))
 WHERE vrsta = 'ocitaj' AND json_valid(tijelo);
