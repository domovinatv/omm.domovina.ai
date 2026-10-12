import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { greska, json, noviId, opcije, uredaj } from "../../../lib/http";

type Ulaz = {
  izvor?: string;
  omm?: string | null;
  t1?: number | null;
  t2?: number | null;
  slike?: string[];
  ocr?: unknown;
  lokacija?: { lat: number; lon: number; tocnost_m?: number } | null;
  uvoz?: unknown;
  hep_dostava?: unknown;
};

const cijeli = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);
const broj = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** POST JSON snimak (očitanje i/ili uvoz s HEP-a). */
export const POST: APIRoute = async ({ request }) => {
  const kljuc = uredaj(request);
  if (!kljuc) return greska("Nedostaje ključ uređaja", 401);
  const b = (await request.json().catch(() => null)) as Ulaz | null;
  if (!b) return greska("Tijelo mora biti JSON");

  const izvor = b.izvor === "foto" || b.izvor === "rucno" || b.izvor === "hep" ? b.izvor : null;
  if (!izvor) return greska("izvor mora biti 'foto', 'rucno' ili 'hep'");
  const omm = b.omm == null ? null : String(b.omm);
  if (omm !== null && !/^\d{10}$/.test(omm)) return greska("OMM ima 10 znamenki");
  const slike = (b.slike ?? []).filter((s) => typeof s === "string" && s.startsWith(`${kljuc}/`));
  const t1 = cijeli(b.t1);
  const t2 = cijeli(b.t2);
  if (izvor !== "hep" && t1 === null) return greska("Nedostaje stanje 1.8.1 (t1)");
  if (izvor === "hep" && b.uvoz == null) return greska("Izvor 'hep' traži uvoz");

  const id = noviId();
  const stvoren = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO snimci (id, uredaj, stvoren, izvor, omm, t1, t2, slike, ocr, lat, lon, tocnost_m, uvoz, hep_dostava)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      kljuc,
      stvoren,
      izvor,
      omm,
      t1,
      t2,
      slike.length ? JSON.stringify(slike) : null,
      b.ocr == null ? null : JSON.stringify(b.ocr),
      broj(b.lokacija?.lat),
      broj(b.lokacija?.lon),
      broj(b.lokacija?.tocnost_m),
      b.uvoz == null ? null : JSON.stringify(b.uvoz),
      b.hep_dostava == null ? null : JSON.stringify(b.hep_dostava),
    )
    .run();
  return json({ id, stvoren }, 201);
};

/** GET popis snimaka ovog uređaja, najnoviji prvi. */
export const GET: APIRoute = async ({ request }) => {
  const kljuc = uredaj(request);
  if (!kljuc) return greska("Nedostaje ključ uređaja", 401);
  const { results } = await env.DB.prepare(
    `SELECT id, stvoren, izvor, omm, t1, t2, slike, lat, lon, tocnost_m, hep_dostava,
            uvoz IS NOT NULL AS ima_uvoz
       FROM snimci WHERE uredaj = ? ORDER BY stvoren DESC LIMIT 100`,
  )
    .bind(kljuc)
    .all();
  return json(
    results.map((r) => ({
      ...r,
      slike: r.slike ? JSON.parse(r.slike as string) : [],
      hep_dostava: r.hep_dostava ? JSON.parse(r.hep_dostava as string) : null,
      ima_uvoz: !!r.ima_uvoz,
    })),
  );
};

export const OPTIONS: APIRoute = opcije;
