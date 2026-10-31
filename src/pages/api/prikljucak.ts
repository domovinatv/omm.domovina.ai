import type { APIRoute } from "astro";
import { greska, json, opcije, uredaj } from "../../lib/http";
import { popisPrikljucaka, spremiPrikljucak } from "../../lib/prikljucci";

/** GET OMM-ovi ovog ključa: podaci za upit Elektri, Elektra i spremljena priključna snaga. */
export const GET: APIRoute = async ({ request }) => {
  const kljuc = uredaj(request);
  if (!kljuc) return greska("Nedostaje ključ uređaja", 401);
  return json(await popisPrikljucaka(kljuc));
};

/** POST `{omm, snaga_kw, faze?, osigurac_a?}`: ručni unos ili ispravak. */
export const POST: APIRoute = async ({ request }) => {
  const kljuc = uredaj(request);
  if (!kljuc) return greska("Nedostaje ključ uređaja", 401);
  const t: any = await request.json().catch(() => null);
  const omm = String(t?.omm ?? "");
  const snaga_kw = Number(t?.snaga_kw);
  const faze = t?.faze == null || t.faze === "" ? null : Number(t.faze);
  const osigurac_a = t?.osigurac_a == null || t.osigurac_a === "" ? null : Number(t.osigurac_a);
  if (!/^\d{10}$/.test(omm)) return greska("OMM ima 10 znamenki");
  if (!(snaga_kw > 0 && snaga_kw <= 1000)) return greska("Snaga mora biti između 0 i 1000 kW");
  if (faze !== null && faze !== 1 && faze !== 3) return greska("Faze su 1 ili 3");
  if (osigurac_a !== null && !(Number.isInteger(osigurac_a) && osigurac_a > 0 && osigurac_a <= 1000)) return greska("Osigurač je cijeli broj ampera");
  await spremiPrikljucak(kljuc, omm, { snaga_kw: Math.round(snaga_kw * 100) / 100, faze, osigurac_a }, "rucno");
  return json({ ok: true }, 201);
};

export const OPTIONS: APIRoute = opcije;
