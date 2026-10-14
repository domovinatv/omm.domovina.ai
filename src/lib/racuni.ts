/** Spremanje pročitanog HEP-ovog računa, zajedničko za mail i /api/racun (bookmarklet na Hepiju). */
import { env } from "cloudflare:workers";
import type { HepRacun } from "./hep-racun";

async function sha256(tekst: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(tekst));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Račun kao snimak `hep-racun`: OMM s računa, t1/t2 iz zadnjeg očitanja, isti broj računa je duplikat. */
export async function spremiRacun(uredaj: string, r: HepRacun): Promise<{ id: string; duplikat: boolean }> {
  const otisak = await sha256(JSON.stringify({ izvor: "hep-racun", broj: r.broj, iznos: r.iznos }));
  const postojeci = await env.DB.prepare(`SELECT id FROM snimci WHERE uredaj = ? AND otisak = ?`)
    .bind(uredaj, otisak).first<{ id: string }>();
  if (postojeci) return { id: postojeci.id, duplikat: true };
  const zadnje = [...r.ocitanja].sort((a, b) => b.datum.localeCompare(a.datum))[0];
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO snimci (id, uredaj, stvoren, izvor, omm, t1, t2, uvoz, otisak)
     VALUES (?, ?, ?, 'hep-racun', ?, ?, ?, ?, ?) ON CONFLICT (uredaj, otisak) DO NOTHING`,
  )
    .bind(id, uredaj, new Date().toISOString(), r.omm, zadnje ? Math.floor(zadnje.vt) : null,
      zadnje ? Math.floor(zadnje.nt) : null, JSON.stringify(r), otisak)
    .run();
  return { id, duplikat: false };
}
