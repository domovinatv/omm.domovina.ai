/** Tablica `prikljucci` (migrations/0008): priključna snaga po OMM-u ključa. */
import { env } from "cloudflare:workers";
import { javiAdminu } from "./admin/uzivo";
import { snimciKljuca } from "./izvjestaj/snimci";
import { elektraZaOmm, type Elektra, type Podaci, type Prikljucak } from "./prikljucak";

export type Zapis = Prikljucak & { izvor: "mail" | "rucno"; tekst: string | null; azuriran: string };

export async function spremiPrikljucak(uredaj: string, omm: string, p: Prikljucak, izvor: Zapis["izvor"], tekst: string | null = null) {
  await env.DB.prepare(
    `INSERT INTO prikljucci (uredaj, omm, snaga_kw, faze, osigurac_a, izvor, tekst, azuriran) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (uredaj, omm) DO UPDATE SET snaga_kw = excluded.snaga_kw, faze = excluded.faze,
       osigurac_a = excluded.osigurac_a, izvor = excluded.izvor, tekst = excluded.tekst, azuriran = excluded.azuriran`,
  )
    .bind(uredaj, omm, p.snaga_kw, p.faze, p.osigurac_a, izvor, tekst, new Date().toISOString())
    .run();
  javiAdminu({ vrsta: "prikljucak", ishod: izvor });
}

const UVOZI = ["hep", "hep-moj-racun", "hep-hepi"];

/**
 * OMM-ovi ovog ključa s podacima za upit Elektri (iz najnovijeg uvoza koji ih ima),
 * Elektrom po prefiksu OMM-a i spremljenim priključkom.
 */
export async function popisPrikljucaka(uredaj: string): Promise<(Podaci & { elektra: Elektra | null; prikljucak: Zapis | null })[]> {
  const snimci = (await snimciKljuca(uredaj)).filter((s) => UVOZI.includes(s.izvor) && s.uvoz);
  const po = new Map<string, Podaci>();
  for (const s of snimci.sort((a, b) => b.stvoren.localeCompare(a.stvoren))) {
    const u = JSON.parse(s.uvoz!);
    const mjesta: Record<string, string | undefined>[] = u.kupci ?? u.mjesta ?? [u];
    for (const m of mjesta) {
      if (!m?.omm) continue;
      const p = po.get(m.omm) ?? { omm: m.omm };
      p.ime ??= m.ime ?? m.korisnik ?? null;
      p.adresa ??= m.adresa ?? null;
      p.brojilo ??= m.broj_brojila ?? null;
      p.sifra_kupca ??= m.sifra_kupca ?? null;
      po.set(m.omm, p);
    }
  }
  const { results } = await env.DB.prepare(
    `SELECT omm, snaga_kw, faze, osigurac_a, izvor, tekst, azuriran FROM prikljucci WHERE uredaj = ?`,
  )
    .bind(uredaj)
    .all<Zapis & { omm: string }>();
  const spremljeni = new Map(results.map(({ omm, ...z }) => [omm, z]));
  for (const omm of spremljeni.keys()) if (!po.has(omm)) po.set(omm, { omm });
  return [...po.values()].map((p) => ({ ...p, elektra: elektraZaOmm(p.omm), prikljucak: spremljeni.get(p.omm) ?? null }));
}
