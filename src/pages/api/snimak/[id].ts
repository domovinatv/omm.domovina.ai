import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { zapisi } from "../../../lib/dnevnik";
import { greska, json, opcije, uredaj } from "../../../lib/http";

/** PATCH {hep_dostava, omm?}: zapis odgovora HEP-a nakon što aplikacija pošalje očitanje. */
export const PATCH: APIRoute = async ({ request, params }) => {
  const kljuc = uredaj(request);
  if (!kljuc) return greska("Nedostaje ključ uređaja", 401);
  const b = (await request.json().catch(() => null)) as { hep_dostava?: unknown; omm?: string } | null;
  if (!b || b.hep_dostava == null) return greska("Nedostaje hep_dostava");
  if (b.omm != null && !/^\d{10}$/.test(b.omm)) return greska("OMM ima 10 znamenki");
  const r = await env.DB.prepare(
    `UPDATE snimci SET hep_dostava = ?, omm = COALESCE(?, omm) WHERE id = ? AND uredaj = ?`,
  )
    .bind(JSON.stringify(b.hep_dostava), b.omm ?? null, params.id, kljuc)
    .run();
  await zapisi(request, {
    uredaj: kljuc,
    vrsta: "dostava",
    ishod: r.meta.changes ? "ok" : "greska",
    snimakId: params.id,
    // Samo ishod dostave, ne cijeli odgovor HEP-a (SEC-03).
    tijelo: { omm: b.omm ?? null, status: (b.hep_dostava as { Status?: unknown })?.Status ?? null },
  });
  return r.meta.changes ? json({ ok: true }) : greska("Nema takvog snimka", 404);
};

/** DELETE: briše snimak, njegove slike i njegove retke u dnevniku. */
export const DELETE: APIRoute = async ({ request, params }) => {
  const kljuc = uredaj(request);
  if (!kljuc) return greska("Nedostaje ključ uređaja", 401);
  const row = await env.DB.prepare(`SELECT slike FROM snimci WHERE id = ? AND uredaj = ?`)
    .bind(params.id, kljuc)
    .first<{ slike: string | null }>();
  if (!row) return greska("Nema takvog snimka", 404);
  const slike: string[] = row.slike ? JSON.parse(row.slike) : [];
  if (slike.length) await env.SLIKE.delete(slike);
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM snimci WHERE id = ? AND uredaj = ?`).bind(params.id, kljuc),
    env.DB.prepare(`DELETE FROM dogadaji WHERE snimak_id = ? AND uredaj = ?`).bind(params.id, kljuc),
    env.DB.prepare(`UPDATE mailovi SET snimak_id = NULL WHERE snimak_id = ? AND uredaj = ?`).bind(params.id, kljuc),
  ]);
  await zapisi(request, { uredaj: kljuc, vrsta: "brisanje", ishod: "ok", snimakId: params.id });
  return json({ ok: true });
};

export const OPTIONS: APIRoute = opcije;
