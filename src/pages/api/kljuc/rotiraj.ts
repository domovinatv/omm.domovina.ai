import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { greska, json, opcije, uredaj } from "../../../lib/http";
import { noviKljuc } from "../../../lib/kljucevi";

/**
 * POST (Bearer stari ključ) → `{kljuc}`: novi ključ koji generira server, sa svim
 * podacima starog (snimci, dnevnik, mailovi, slike). Stari ostaje zapisan kao
 * zamijenjen i dobiva 401, pa procurjeli ključ više ništa ne otvara (SEC-05).
 * Oznaku i adresu za mailove treba zatim napraviti ponovno.
 */
export const POST: APIRoute = async ({ request }) => {
  const stari = uredaj(request);
  if (!stari) return greska("Nedostaje ključ uređaja", 401);
  const novi = noviKljuc();

  // Slike: prvo kopija pod novi ključ, pa baza, pa brisanje starih. Ako nešto
  // pukne prije baze, stari ključ i dalje vidi sve.
  const stare: string[] = [];
  let cursor: string | undefined;
  do {
    const popis = await env.SLIKE.list({ prefix: `${stari}/`, cursor, include: ["httpMetadata"] });
    for (const o of popis.objects) {
      const tijelo = await env.SLIKE.get(o.key);
      if (!tijelo) continue;
      await env.SLIKE.put(`${novi}/${o.key.slice(stari.length + 1)}`, tijelo.body, { httpMetadata: o.httpMetadata });
      stare.push(o.key);
    }
    cursor = popis.truncated ? popis.cursor : undefined;
  } while (cursor);

  const sad = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE snimci SET uredaj = ?1, slike = CASE WHEN slike IS NULL THEN NULL ELSE replace(slike, '"' || ?2 || '/', '"' || ?1 || '/') END
        WHERE uredaj = ?2`,
    ).bind(novi, stari),
    env.DB.prepare(`UPDATE dogadaji SET uredaj = ? WHERE uredaj = ?`).bind(novi, stari),
    env.DB.prepare(`UPDATE mailovi SET uredaj = ? WHERE uredaj = ?`).bind(novi, stari),
    env.DB.prepare(`INSERT INTO kljucevi (kljuc, stvoren, zadnji) VALUES (?1, ?2, ?2)`).bind(novi, sad),
    env.DB.prepare(
      `INSERT INTO kljucevi (kljuc, stvoren, zadnji, zamijenjen) VALUES (?1, ?2, ?2, ?2)
       ON CONFLICT (kljuc) DO UPDATE SET zamijenjen = ?2`,
    ).bind(stari, sad),
  ]);
  for (let i = 0; i < stare.length; i += 1000) await env.SLIKE.delete(stare.slice(i, i + 1000));
  return json({ kljuc: novi, slika: stare.length });
};

export const OPTIONS: APIRoute = opcije;
