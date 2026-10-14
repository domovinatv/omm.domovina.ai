import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { greska, json, opcije, uredaj } from "../../lib/http";

/** GET zadnji primljeni mailovi ovog ključa (računi, Gmailova potvrda prosljeđivanja). */
export const GET: APIRoute = async ({ request }) => {
  const kljuc = uredaj(request);
  if (!kljuc) return greska("Nedostaje ključ uređaja", 401);
  const { results } = await env.DB.prepare(
    `SELECT primljen, od, naslov, vrsta, ishod, poruka, snimak_id FROM mailovi
      WHERE uredaj = ? ORDER BY primljen DESC LIMIT 50`,
  )
    .bind(kljuc)
    .all();
  return json(results.map((r) => ({ ...r, poruka: r.poruka ? JSON.parse(r.poruka as string) : null })));
};

export const OPTIONS: APIRoute = opcije;
