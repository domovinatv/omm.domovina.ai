/**
 * Ključ uređaja u pregledniku umjesto prijave (privremeno). Dijele ga sve
 * stranice istog origina preko localStorage; `?k=<ključ>` (iz aplikacije ili
 * extensiona) preuzima postojeći ključ i makne ga iz adrese.
 */
export function kljuc(): string {
  let k: string | null = null;
  const parametri = new URLSearchParams(location.search);
  const izAdrese = parametri.get("k");
  if (izAdrese && /^[A-Za-z0-9_-]{22,64}$/.test(izAdrese)) {
    try { localStorage.setItem("omm-kljuc", izAdrese); } catch {}
    parametri.delete("k");
    const ostatak = parametri.toString();
    history.replaceState(null, "", location.pathname + (ostatak ? `?${ostatak}` : ""));
    return izAdrese;
  }
  try { k = localStorage.getItem("omm-kljuc"); } catch {}
  if (!k) {
    const b = crypto.getRandomValues(new Uint8Array(18));
    k = btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    try { localStorage.setItem("omm-kljuc", k); } catch {}
  }
  return k;
}
