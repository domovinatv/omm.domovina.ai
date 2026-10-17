import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { zapisi } from "../../../lib/dnevnik";
import { greska, json, noviId, opcije, uredaj } from "../../../lib/http";
import { provjeriUvoz } from "../../../lib/uvoz";

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

/**
 * `hep`: uvoz s Moje mreže (HEP ODS), `hep-moj-racun`: s Mojeg računa (HEP Elektra).
 * `hep-hepi`: s Mojeg Hepi računa (HEP Opskrba). `hep-racun` (pročitani PDF
 * račun) upisuje samo src/lib/racuni.ts, iz maila ili /api/racun.
 */
const IZVORI = ["foto", "rucno", "hep", "hep-moj-racun", "hep-hepi"];

/**
 * Dio uvoza koji čini sadržaj za otisak: bez trenutka dohvata i bez datuma u
 * opisu salda (Moj račun piše „Dospjeli dug na dan 14.10.2026:“, pa bi svaki
 * dan bio „nov“ snimak iako se ništa nije promijenilo). Novo očitanje, račun
 * ili uplata mijenjaju sadržaj i daju novi snimak.
 */
function sadrzajUvoza(uvoz: unknown): unknown {
  const u = { ...(uvoz as Record<string, unknown>), dohvaceno: undefined };
  if (Array.isArray(u.kupci)) {
    u.kupci = u.kupci.map((k: { saldo?: { opis?: unknown } | null }) =>
      k?.saldo && typeof k.saldo.opis === "string"
        ? { ...k, saldo: { ...k.saldo, opis: k.saldo.opis.replace(/\d{1,2}\.\d{1,2}\.\d{4}\.?/g, "") } }
        : k,
    );
  }
  return u;
}

// Najveći uvoz u bazi 2026-10-17 je 45 kB (Hepi s prometom); 512 kB je rezerva za
// kupce s više mjesta, a štiti D1 od petlje s golemim JSON-om (SEC-02).
const NAJVISE_TIJELA = 512 * 1024;
const NAJVISE_OCR = 32 * 1024;

/**
 * Što od snimka ide u dnevnik: oblik, ne sadržaj. Uvoz nosi ime, adresu i promet,
 * a čuva se već u `snimci`; dnevnik služi za duplikate i greške (SEC-03).
 */
function sazetak(b: Ulaz, bajtova: number) {
  const u = b.uvoz as { mjesta?: unknown[]; kupci?: unknown[] } | null | undefined;
  return {
    izvor: b.izvor ?? null,
    omm: b.omm ?? null,
    bajtova,
    ...(u ? { mjesta: Array.isArray(u.mjesta) ? u.mjesta.length : null, kupci: Array.isArray(u.kupci) ? u.kupci.length : null } : {}),
    ...(b.slike?.length ? { slika: b.slike.length } : {}),
    ...(b.lokacija ? { lokacija: true } : {}),
  };
}

/** POST JSON snimak (očitanje i/ili uvoz s HEP-a). */
export const POST: APIRoute = async ({ request }) => {
  const kljuc = uredaj(request);
  if (!kljuc) return greska("Nedostaje ključ uređaja", 401);
  if (Number(request.headers.get("content-length") ?? 0) > NAJVISE_TIJELA) return greska("Tijelo je preveliko", 413);
  const tekst = await request.text();
  if (tekst.length > NAJVISE_TIJELA) return greska("Tijelo je preveliko", 413);
  let b: Ulaz | null = null;
  try { b = JSON.parse(tekst) as Ulaz; } catch {}
  if (!b || typeof b !== "object") return greska("Tijelo mora biti JSON");
  if (b.ocr != null && JSON.stringify(b.ocr).length > NAJVISE_OCR) return greska("ocr je prevelik", 413);

  const izvor = IZVORI.includes(b.izvor as string) ? (b.izvor as string) : null;
  if (!izvor) return greska(`izvor mora biti ${IZVORI.map((i) => `'${i}'`).join(", ")}`);
  const uvozni = izvor === "hep" || izvor === "hep-moj-racun" || izvor === "hep-hepi";
  const omm = b.omm == null ? null : String(b.omm);
  if (omm !== null && !/^\d{10}$/.test(omm)) return greska("OMM ima 10 znamenki");
  const trazene = (Array.isArray(b.slike) ? b.slike : []).filter(
    (s): s is string => typeof s === "string" && (s.startsWith(`${kljuc}/`) || s.startsWith(`tmp/${kljuc}/`)),
  );
  const t1 = cijeli(b.t1);
  const t2 = cijeli(b.t2);
  if (!uvozni && t1 === null) return greska("Nedostaje stanje 1.8.1 (t1)");
  if (uvozni && b.uvoz == null) return greska(`Izvor '${izvor}' traži uvoz`);
  if (uvozni) {
    const g = provjeriUvoz(izvor, b.uvoz);
    if (g) return greska(g);
  }

  const stvoren = new Date().toISOString();
  // Isti sadržaj = isti snimak; vraća se postojeći umjesto duplikata.
  // Trenutak dohvata nije sadržaj: isti podaci uvezeni ponovno su duplikat
  // (koliko je puta stigao vidi se u dnevniku).
  const otisak = await sha256(
    JSON.stringify(
      uvozni
        ? { izvor, uvoz: sadrzajUvoza(b.uvoz) }
        : { izvor: "ocitanje", omm, t1, t2, dan: stvoren.slice(0, 10) },
    ),
  );
  const nadji = () =>
    env.DB.prepare(`SELECT id, stvoren FROM snimci WHERE uredaj = ? AND otisak = ?`)
      .bind(kljuc, otisak)
      .first<{ id: string; stvoren: string }>();
  const postojeci = await nadji();
  if (postojeci) {
    await zapisi(request, { uredaj: kljuc, vrsta: "snimak", ishod: "duplikat", snimakId: postojeci.id, otisak, tijelo: sazetak(b, tekst.length) });
    return json({ ...postojeci, duplikat: true });
  }

  // Slike iz /api/ocitaj su pod tmp/ (inače ih briše lifecycle): snimak ih zadrži.
  const slike: string[] = [];
  for (const s of trazene) {
    if (!s.startsWith("tmp/")) { slike.push(s); continue; }
    const trajno = s.slice(4);
    const o = await env.SLIKE.get(s);
    if (o) {
      await env.SLIKE.put(trajno, o.body, { httpMetadata: o.httpMetadata });
      await env.SLIKE.delete(s);
      slike.push(trajno);
    } else if (await env.SLIKE.head(trajno)) slike.push(trajno);
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
    await zapisi(request, { uredaj: kljuc, vrsta: "snimak", ishod: "duplikat", snimakId: prvi?.id, otisak, tijelo: sazetak(b, tekst.length) });
    return json({ ...prvi, duplikat: true });
  }
  await zapisi(request, { uredaj: kljuc, vrsta: "snimak", ishod: "novo", snimakId: id, otisak, tijelo: sazetak(b, tekst.length) });
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

/**
 * DELETE sve podatke ovog ključa: snimke, dnevnik, mailove i slike u R2 (i one
 * pod tmp/). Pravo na brisanje (SEC-03); gumb je na naslovnici.
 */
export const DELETE: APIRoute = async ({ request }) => {
  const kljuc = uredaj(request);
  if (!kljuc) return greska("Nedostaje ključ uređaja", 401);
  let slika = 0;
  for (const prefix of [`${kljuc}/`, `tmp/${kljuc}/`]) {
    let cursor: string | undefined;
    do {
      const popis = await env.SLIKE.list({ prefix, cursor });
      if (popis.objects.length) await env.SLIKE.delete(popis.objects.map((o) => o.key));
      slika += popis.objects.length;
      cursor = popis.truncated ? popis.cursor : undefined;
    } while (cursor);
  }
  const [snimci] = await env.DB.batch([
    env.DB.prepare(`DELETE FROM snimci WHERE uredaj = ?`).bind(kljuc),
    env.DB.prepare(`DELETE FROM dogadaji WHERE uredaj = ?`).bind(kljuc),
    env.DB.prepare(`DELETE FROM mailovi WHERE uredaj = ?`).bind(kljuc),
  ]);
  // Jedan redak ostaje da se vidi da je brisanje bilo; bez sadržaja.
  await zapisi(request, { uredaj: kljuc, vrsta: "brisanje", ishod: "ok", tijelo: { sve: true, snimaka: snimci.meta.changes, slika } });
  return json({ ok: true, snimaka: snimci.meta.changes, slika });
};

export const OPTIONS: APIRoute = opcije;
