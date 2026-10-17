/**
 * Ključevi uređaja koje server poznaje (tablica `kljucevi`, SEC-05). Ključ i dalje
 * generira klijent; server ga zapamti pri prvom upisu, a nakon rotacije stari
 * ključ ostaje zapisan kao zamijenjen i dobiva 401.
 */
import { env } from "cloudflare:workers";

export type Stanje = "nepoznat" | "aktivan" | "zamijenjen";

export async function stanjeKljuca(kljuc: string): Promise<Stanje> {
  const r = await env.DB.prepare(`SELECT zamijenjen FROM kljucevi WHERE kljuc = ?`).bind(kljuc).first<{ zamijenjen: string | null }>();
  return !r ? "nepoznat" : r.zamijenjen ? "zamijenjen" : "aktivan";
}

export async function registriraj(kljuc: string): Promise<void> {
  const sad = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO kljucevi (kljuc, stvoren, zadnji) VALUES (?1, ?2, ?2) ON CONFLICT (kljuc) DO UPDATE SET zadnji = ?2`,
  )
    .bind(kljuc, sad)
    .run();
}

/** 18 nasumičnih bajtova kao base64url (22 znaka), kao web klijent. */
export function noviKljuc(): string {
  const b = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
