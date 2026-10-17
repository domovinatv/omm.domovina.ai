/**
 * Oblik uvoza s HEP-a koji server prihvaća (SEC-06, SEC-11). Ne provjerava sve,
 * samo ono što se poslije čita kao OMM, datum ili broj (admin, izvještaj,
 * usporedba) i prikazuje kao tekst. Oblik je onaj iz flutter_moja_mreza parsera.
 */
const OMM = /^\d{10}$/;
const DATUM = /^\d{4}-\d{2}-\d{2}/;
const objekt = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const brojIliNista = (v: unknown) => v == null || (typeof v === "number" && Number.isFinite(v));
const tekstIliNista = (v: unknown) => v == null || (typeof v === "string" && v.length <= 1000);

function ocitanja(v: unknown, gdje: string): string | null {
  if (v == null) return null;
  if (!Array.isArray(v)) return `${gdje}.ocitanja mora biti niz`;
  for (const [i, o] of v.entries()) {
    if (!objekt(o)) return `${gdje}.ocitanja[${i}] mora biti objekt`;
    if (typeof o.datum !== "string" || !DATUM.test(o.datum)) return `${gdje}.ocitanja[${i}].datum mora biti GGGG-MM-DD`;
    if (!brojIliNista(o.t1_kwh) || !brojIliNista(o.t2_kwh)) return `${gdje}.ocitanja[${i}]: t1_kwh i t2_kwh su brojevi`;
    if (!tekstIliNista(o.opis)) return `${gdje}.ocitanja[${i}].opis mora biti tekst`;
  }
  return null;
}

/** Vraća opis greške ili null kad je uvoz u redu. */
export function provjeriUvoz(izvor: string, uvoz: unknown): string | null {
  if (!objekt(uvoz)) return "uvoz mora biti objekt";
  const polje = izvor === "hep" ? "mjesta" : "kupci";
  const popis = uvoz[polje];
  if (!Array.isArray(popis)) return `Uvoz '${izvor}' traži ${polje}[]`;
  for (const [i, m] of popis.entries()) {
    const gdje = `${polje}[${i}]`;
    if (!objekt(m)) return `${gdje} mora biti objekt`;
    if (m.omm != null && (typeof m.omm !== "string" || !OMM.test(m.omm))) return `${gdje}.omm ima 10 znamenki`;
    for (const k of ["ime", "adresa", "korisnik", "tarifni_model", "broj_brojila"]) {
      if (!tekstIliNista(m[k])) return `${gdje}.${k} mora biti tekst`;
    }
    const g = ocitanja(m.ocitanja, gdje);
    if (g) return g;
  }
  return null;
}
