import type { APIRoute } from "astro";
import { popisOmm, snimciKljuca } from "../../../lib/izvjestaj/snimci";
import { greska, json, opcije, uredaj } from "../../../lib/http";

/** GET OMM-ovi ovog ključa za koje se može napraviti izvještaj. */
export const GET: APIRoute = async ({ request }) => {
  const kljuc = uredaj(request);
  if (!kljuc) return greska("Nedostaje ključ uređaja", 401);
  return json(popisOmm(await snimciKljuca(kljuc)));
};

export const OPTIONS: APIRoute = opcije;
