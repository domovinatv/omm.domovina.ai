import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { zapisi } from "../../lib/dnevnik";
import { procitajRacun } from "../../lib/hep-racun";
import { greska, json, opcije, uredaj } from "../../lib/http";
import { spremiRacun } from "../../lib/racuni";

// HEP-ovi računi su do ~0,85 MB (rezije, 2026-10-17); parsiranje troši CPU (SEC-02).
const NAJVISE = 3 * 1024 * 1024;

/** GET brojevi računa (poziv na broj) koje ovaj ključ već ima, da bookmarklet šalje samo nove. */
export const GET: APIRoute = async ({ request }) => {
  const kljuc = uredaj(request);
  if (!kljuc) return greska("Nedostaje ključ uređaja", 401);
  const { results } = await env.DB.prepare(
    `SELECT json_extract(uvoz, '$.broj') AS broj FROM snimci WHERE uredaj = ? AND izvor = 'hep-racun'`,
  )
    .bind(kljuc)
    .all<{ broj: string | null }>();
  return json(results.map((r) => r.broj).filter(Boolean));
};

/**
 * POST PDF računa HEP Opskrbe (tijelo je sam PDF). Pročita se kao račun
 * primljen mailom i spremi kao snimak `hep-racun`; PDF se ne čuva.
 */
export const POST: APIRoute = async ({ request }) => {
  const kljuc = uredaj(request);
  if (!kljuc) return greska("Nedostaje ključ uređaja", 401);
  if (Number(request.headers.get("content-length") ?? 0) > NAJVISE) return greska("PDF je prevelik", 413);
  const pdf = new Uint8Array(await request.arrayBuffer());
  if (pdf.length > NAJVISE) return greska("PDF je prevelik", 413);
  const racun = await procitajRacun(pdf).catch(() => null);
  if (!racun) {
    await zapisi(request, { uredaj: kljuc, vrsta: "racun", ishod: "greska", tijelo: { bajtova: pdf.length } });
    return greska("Nije HEP-ov račun ili ga ne znam pročitati", 422);
  }
  const s = await spremiRacun(kljuc, racun);
  const sazetak = { broj: racun.broj, za_mjesec: racun.za_mjesec, iznos: racun.iznos, omm: racun.omm };
  await zapisi(request, { uredaj: kljuc, vrsta: "racun", ishod: s.duplikat ? "duplikat" : "novo", snimakId: s.id, tijelo: sazetak });
  return json({ id: s.id, duplikat: s.duplikat, ...sazetak }, s.duplikat ? 200 : 201);
};

export const OPTIONS: APIRoute = opcije;
