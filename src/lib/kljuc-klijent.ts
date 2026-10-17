/**
 * Ključ uređaja u pregledniku umjesto prijave (privremeno). Dijele ga sve
 * stranice istog origina preko localStorage.
 *
 * Ključ iz adrese (`#k=`, stare oznake i aplikacija `?k=`) se nikad ne preuzima
 * sam: poveznica s tuđim ključem bi inače tiho preusmjerila sve uvoze na njega
 * (SEC-01 u docs/security/2026-10-16-security-audit-fable.md). Naslovnica ga
 * pokaže i preuzme tek na klik.
 */
const POHRANA = "omm-kljuc";
const OBLIK = /^[A-Za-z0-9_-]{22,64}$/;

export function kljuc(): string {
  let k: string | null = null;
  try { k = localStorage.getItem(POHRANA); } catch {}
  if (!k || !OBLIK.test(k)) {
    const b = crypto.getRandomValues(new Uint8Array(18));
    k = btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    postaviKljuc(k);
  }
  return k;
}

export function postaviKljuc(k: string) {
  try { localStorage.setItem(POHRANA, k); } catch {}
}

/**
 * Ključ iz `#k=` ili `?k=`, maknut iz adrese (i iz povijesti). Vraća ga samo
 * kad je drukčiji od ključa ovog preglednika.
 */
export function kljucIzAdrese(): string | null {
  const upit = new URLSearchParams(location.search);
  const fragment = new URLSearchParams(location.hash.slice(1));
  const izAdrese = fragment.get("k") ?? upit.get("k");
  if (!upit.has("k") && !fragment.has("k")) return null;
  upit.delete("k");
  fragment.delete("k");
  const u = upit.toString(), f = fragment.toString();
  history.replaceState(null, "", location.pathname + (u ? `?${u}` : "") + (f ? `#${f}` : ""));
  if (!izAdrese || !OBLIK.test(izAdrese) || izAdrese === kljuc()) return null;
  return izAdrese;
}

/** Početak i kraj ključa, da korisnik vidi koji je aktivan bez prikaza cijele tajne. */
export const skraceno = (k: string) => `${k.slice(0, 4)}…${k.slice(-4)}`;
