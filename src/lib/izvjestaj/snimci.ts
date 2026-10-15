/** Snimci jednog ključa iz kojih se radi izvještaj, i popis OMM-ova u njima. */
import { env } from "cloudflare:workers";
import { CJENIK_URL, type Cjenik, type Snimak } from "./izracun";

const UVOZI = ["hep", "hep-moj-racun", "hep-hepi"];

/** Svi uvozi s HEP-a i vlastita očitanja (rucno, foto) ovog ključa. */
export async function snimciKljuca(kljuc: string): Promise<Snimak[]> {
  const { results } = await env.DB.prepare(
    `SELECT izvor, stvoren, omm, t1, t2, lat, lon, uvoz FROM snimci
      WHERE uredaj = ? AND izvor IN ('hep', 'hep-moj-racun', 'hep-hepi', 'rucno', 'foto')`,
  )
    .bind(kljuc)
    .all<Snimak>();
  return results;
}

/** OMM-ovi iz uvoza (jedan uvoz s Moje mreže ima više mjesta), s adresom iz najnovijeg. */
export function popisOmm(snimci: Snimak[]): { omm: string; adresa: string | null; zadnji: string }[] {
  const po = new Map<string, { omm: string; adresa: string | null; zadnji: string }>();
  for (const s of [...snimci].sort((a, b) => b.stvoren.localeCompare(a.stvoren))) {
    if (!UVOZI.includes(s.izvor) || !s.uvoz) continue;
    const u = JSON.parse(s.uvoz);
    const mjesta: { omm?: string; adresa?: string }[] = u.kupci ?? u.mjesta ?? [u];
    for (const m of mjesta) {
      if (!m?.omm || po.has(m.omm)) continue;
      po.set(m.omm, { omm: m.omm, adresa: m.adresa ?? null, zadnji: s.stvoren });
    }
  }
  return [...po.values()];
}

/** Javni cjenik HEP Elektre; Cloudflare ga drži dan u predmemoriji. */
export async function cjenik(): Promise<Cjenik> {
  const r = await fetch(CJENIK_URL, { cf: { cacheTtl: 86_400, cacheEverything: true } });
  if (!r.ok) throw new Error(`Cjenik HEP-a: ${r.status}`);
  return r.json();
}
