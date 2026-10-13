import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { zapisi } from "../../../lib/dnevnik";
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

async function sha256(tekst: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(tekst));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const cijeli = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);
const broj = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** `hep`: uvoz s Moje mreže (HEP ODS), `hep-moj-racun`: s Mojeg računa (HEP Elektra). */
const IZVORI = ["foto", "rucno", "hep", "hep-moj-racun"];

/** POST JSON snimak (očitanje i/ili uvoz s HEP-a). */
export const POST: APIRoute = async ({ request }) => {
  const kljuc = uredaj(request);
  if (!kljuc) return greska("Nedostaje ključ uređaja", 401);
  const b = (await request.json().catch(() => null)) as Ulaz | null;
  if (!b) return greska("Tijelo mora biti JSON");

  const izvor = IZVORI.includes(b.izvor as string) ? (b.izvor as string) : null;
  if (!izvor) return greska(`izvor mora biti ${IZVORI.map((i) => `'${i}'`).join(", ")}`);
  const uvozni = izvor === "hep" || izvor === "hep-moj-racun";
  const omm = b.omm == null ? null : String(b.omm);
  if (omm !== null && !/^\d{10}$/.test(omm)) return greska("OMM ima 10 znamenki");
  const slike = (b.slike ?? []).filter((s) => typeof s === "string" && s.startsWith(`${kljuc}/`));
  const t1 = cijeli(b.t1);
  const t2 = cijeli(b.t2);
  if (!uvozni && t1 === null) return greska("Nedostaje stanje 1.8.1 (t1)");
  if (uvozni && b.uvoz == null) return greska(`Izvor '${izvor}' traži uvoz`);
  if (izvor === "hep-moj-racun" && !Array.isArray((b.uvoz as { kupci?: unknown })?.kupci)) {
    return greska("Uvoz s Mojeg računa traži kupci[]");
  }

  const stvoren = new Date().toISOString();
  // Isti sadržaj = isti snimak; vraća se postojeći umjesto duplikata.
  // Trenutak dohvata nije sadržaj: isti podaci uvezeni ponovno su duplikat
  // (koliko je puta stigao vidi se u dnevniku).
  const otisak = await sha256(
    JSON.stringify(
      uvozni
        ? { izvor, uvoz: { ...(b.uvoz as object), dohvaceno: undefined } }
        : { izvor: "ocitanje", omm, t1, t2, dan: stvoren.slice(0, 10) },
    ),
  );
  const nadji = () =>
    env.DB.prepare(`SELECT id, stvoren FROM snimci WHERE uredaj = ? AND otisak = ?`)
      .bind(kljuc, otisak)
      .first<{ id: string; stvoren: string }>();
  const postojeci = await nadji();
  if (postojeci) {
    await zapisi(request, { uredaj: kljuc, vrsta: "snimak", ishod: "duplikat", snimakId: postojeci.id, otisak, tijelo: b });
    return json({ ...postojeci, duplikat: true });
  }

  const id = noviId();
  const upis = await env.DB.prepare(
    `INSERT INTO snimci (id, uredaj, stvoren, izvor, omm, t1, t2, slike, ocr, lat, lon, tocnost_m, uvoz, hep_dostava, otisak)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (uredaj, otisak) DO NOTHING`,
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
      otisak,
    )
    .run();
  // Dva istovremena zahtjeva: drugi ne upiše ništa i vrati prvi.
  if (!upis.meta.changes) {
    const prvi = await nadji();
    await zapisi(request, { uredaj: kljuc, vrsta: "snimak", ishod: "duplikat", snimakId: prvi?.id, otisak, tijelo: b });
    return json({ ...prvi, duplikat: true });
  }
  await zapisi(request, { uredaj: kljuc, vrsta: "snimak", ishod: "novo", snimakId: id, otisak, tijelo: b });
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
