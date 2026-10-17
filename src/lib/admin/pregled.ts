/**
 * Pregled za admin: tko je uvezao koji OMM. „Korisnik“ je ključ uređaja (`snimci.uredaj`),
 * jer prijave za korisnike nema. Uvoz s Moje mreže nosi više OMM-ova (`mjesta[]`), s Mojeg
 * računa i Hepija `kupci[]`; očitanja i računi mailom imaju OMM u stupcu `omm`.
 */
import { env } from "cloudflare:workers";
import type { Snimak } from "../izvjestaj/izracun";

const UVOZI = ["hep", "hep-moj-racun", "hep-hepi"];

type Red = { uredaj: string; stvoren: string; izvor: string; omm: string; adresa: string | null; ime: string | null };

export type KorisnikOmm = {
  uredaj: string; prvi: string; zadnji: string; uvoza: number; ocitanja: number; racuna: number; izvori: string[];
  adresa: string | null; ime: string | null;
};
export type OmmPregled = {
  omm: string; adresa: string | null; ime: string | null; zadnji: string;
  uvoza: number; ocitanja: number; racuna: number; izvori: string[]; korisnici: KorisnikOmm[];
  /** Ključevi ne navode istu adresu ili ime: netko je OMM možda prisvojio (SEC-07). */
  neslaganje: boolean;
};

/**
 * Svi OMM-ovi, najnoviji prvi. Adresa i ime kupca iz najnovijeg uvoza koji ih ima, i posebno
 * po ključu: uvoz šalje korisnik, pa tuđi OMM može upisati bilo tko (SEC-07).
 */
export async function pregledOmm(): Promise<OmmPregled[]> {
  const { results } = await env.DB.prepare(
    `SELECT s.uredaj, s.stvoren, s.izvor, json_extract(m.value, '$.omm') AS omm,
            json_extract(m.value, '$.adresa') AS adresa,
            COALESCE(json_extract(m.value, '$.korisnik'), json_extract(m.value, '$.ime')) AS ime
       FROM snimci s,
            json_each(s.uvoz, CASE WHEN json_type(s.uvoz, '$.kupci') = 'array' THEN '$.kupci' ELSE '$.mjesta' END) m
      WHERE s.izvor IN ('hep', 'hep-moj-racun', 'hep-hepi') AND json_valid(s.uvoz)
     UNION ALL
     SELECT uredaj, stvoren, izvor, omm, NULL, NULL FROM snimci
      WHERE izvor NOT IN ('hep', 'hep-moj-racun', 'hep-hepi') AND omm IS NOT NULL`,
  ).all<Red>();

  const po = new Map<string, OmmPregled & { _k: Map<string, KorisnikOmm> }>();
  for (const r of results.filter((r) => r.omm).sort((a, b) => b.stvoren.localeCompare(a.stvoren))) {
    let o = po.get(r.omm);
    if (!o) {
      o = { omm: r.omm, adresa: null, ime: null, zadnji: r.stvoren, uvoza: 0, ocitanja: 0, racuna: 0, izvori: [], korisnici: [], neslaganje: false, _k: new Map() };
      po.set(r.omm, o);
    }
    o.adresa ??= r.adresa;
    o.ime ??= r.ime;
    let k = o._k.get(r.uredaj);
    if (!k) {
      k = { uredaj: r.uredaj, prvi: r.stvoren, zadnji: r.stvoren, uvoza: 0, ocitanja: 0, racuna: 0, izvori: [], adresa: null, ime: null };
      o._k.set(r.uredaj, k);
    }
    k.adresa ??= r.adresa;
    k.ime ??= r.ime;
    k.prvi = r.stvoren; // redovi idu od najnovijeg, pa zadnji upisani je najstariji
    const polje = UVOZI.includes(r.izvor) ? "uvoza" : r.izvor === "hep-racun" ? "racuna" : "ocitanja";
    o[polje]++; k[polje]++;
    if (!o.izvori.includes(r.izvor)) o.izvori.push(r.izvor);
    if (!k.izvori.includes(r.izvor)) k.izvori.push(r.izvor);
  }
  const isto = (a: string | null) => (a ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  return [...po.values()].map(({ _k, ...o }) => {
    const korisnici = [..._k.values()];
    const razlicitih = (f: (k: KorisnikOmm) => string | null) => new Set(korisnici.map(f).filter(Boolean).map(isto)).size;
    return { ...o, korisnici, neslaganje: razlicitih((k) => k.adresa) > 1 || razlicitih((k) => k.ime) > 1 };
  });
}

export type Uredaj = { uredaj: string; prvi: string | null; zadnji: string | null; dogadaja: number; user_agent: string | null; drzava: string | null };

/** Iz sirovog dnevnika: kad je ključ prvi i zadnji put nešto poslao, i s kojeg preglednika. */
export async function uredaji(kljucevi: string[]): Promise<Map<string, Uredaj>> {
  if (!kljucevi.length) return new Map();
  const mjesta = kljucevi.map(() => "?").join(",");
  const { results } = await env.DB.prepare(
    `SELECT d.uredaj, MIN(d.stvoren) AS prvi, MAX(d.stvoren) AS zadnji, COUNT(*) AS dogadaja,
            (SELECT user_agent FROM dogadaji z WHERE z.uredaj = d.uredaj ORDER BY z.stvoren DESC LIMIT 1) AS user_agent,
            (SELECT ip_drzava FROM dogadaji z WHERE z.uredaj = d.uredaj ORDER BY z.stvoren DESC LIMIT 1) AS drzava
       FROM dogadaji d WHERE d.uredaj IN (${mjesta}) GROUP BY d.uredaj`,
  ).bind(...kljucevi).all<Uredaj>();
  return new Map(results.map((r) => [r.uredaj, r]));
}

/**
 * Snimci za izvještaj jednog OMM-a: jednog ključa ili (`kljuc` null) svih. Uvoz se bira po
 * OMM-u u `mjesta[]`/`kupci[]` (ili na vrhu, stari oblik), ne po tekstu bilo gdje u JSON-u:
 * `instr` je pustio i snimak koji OMM samo spominje (SEC-07).
 */
export async function snimciOmm(omm: string, kljuc: string | null): Promise<Snimak[]> {
  const { results } = await env.DB.prepare(
    `SELECT izvor, stvoren, omm, t1, t2, lat, lon, uvoz FROM snimci s
      WHERE izvor IN ('hep', 'hep-moj-racun', 'hep-hepi', 'rucno', 'foto')
        AND (?2 IS NULL OR uredaj = ?2)
        AND (omm = ?1 OR (json_valid(uvoz) AND (json_extract(uvoz, '$.omm') = ?1 OR EXISTS (
              SELECT 1 FROM json_each(s.uvoz, CASE WHEN json_type(s.uvoz, '$.kupci') = 'array' THEN '$.kupci' ELSE '$.mjesta' END) m
               WHERE json_extract(m.value, '$.omm') = ?1))))`,
  ).bind(omm, kljuc).all<Snimak>();
  return results;
}

/** Skraćeni ključ za prikaz; cijeli je u `title`. */
export const kratko = (k: string) => k.slice(0, 8) + "…";

const ZG = new Intl.DateTimeFormat("hr-HR", { timeZone: "Europe/Zagreb", day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
export const kad = (iso: string | null) => (iso ? ZG.format(new Date(iso)) : "—");

export const IZVORI: Record<string, string> = {
  hep: "Moja mreža", "hep-moj-racun": "Moj račun", "hep-hepi": "Hepi", "hep-racun": "račun mailom", rucno: "ručno", foto: "foto",
};
