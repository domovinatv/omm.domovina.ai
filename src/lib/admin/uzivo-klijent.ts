// Klijent za admin uživo (AdminOkvir `uzivo`): WebSocket na /admin/uzivo javlja da se baza
// promijenila, a stranica tada dohvati svoj HTML i zamijeni dijelove s `data-uzivo`
// (bez njih cijeli <main>). Novi ili promijenjeni retci i kartice kratko zasvijetle.
// Skrivena kartica osvježi se tek kad postane vidljiva.

const oznaka = document.getElementById("uzivo");
const IZRAZI: Record<string, string> = {
  snimak: "novi snimak", racun: "novi račun", dostava: "očitanje poslano HEP-u", brisanje: "brisanje",
  prikljucak: "priključna snaga", "mail-prikljucak": "mail s priključnom snagom", "mail-racun": "račun mailom",
  "mail-gmail-potvrda": "Gmailova potvrda", "mail-ostalo": "mail", kljuc: "novi ključ",
};

function stanje(s: "da" | "ne" | "van", naslov: string) {
  if (!oznaka) return;
  oznaka.dataset.stanje = s;
  oznaka.title = naslov;
}

/** Zamijeni `staro` s `novo`; elementi kojih prije nije bilo (po HTML-u) zasvijetle. */
function zamijeni(staro: Element, novo: Element) {
  const sel = "tr, .kartica, .plocica";
  const bilo = new Set([...staro.querySelectorAll(sel)].map((e) => e.outerHTML));
  staro.replaceChildren(...[...novo.childNodes].map((n) => document.importNode(n, true)));
  for (const e of staro.querySelectorAll(sel)) if (!bilo.has(e.outerHTML) && !e.closest("thead")) e.classList.add("uzivo-novo");
}

let ceka = false;
async function osvjezi() {
  if (document.hidden) { ceka = true; return; }
  ceka = false;
  let r: Response;
  try {
    r = await fetch(location.href, { cache: "no-store", redirect: "manual", headers: { accept: "text/html" } });
  } catch { return; }
  if (r.type === "opaqueredirect" || r.status === 401) return odjavljen();
  if (!r.ok) return;
  const nova = new DOMParser().parseFromString(await r.text(), "text/html");
  const dijelovi = document.querySelectorAll<HTMLElement>("[data-uzivo]");
  if (dijelovi.length) {
    for (const el of dijelovi) {
      const n = nova.querySelector(`[data-uzivo="${el.dataset.uzivo}"]`);
      if (n) zamijeni(el, n);
    }
  } else {
    const m = nova.querySelector("main"), main = document.querySelector("main");
    if (m && main) zamijeni(main, m);
  }
  document.dispatchEvent(new Event("uzivo"));
}

let ws: WebSocket | null = null;
let pokusaj = 0;
let gotovo = false;
let tajmer: ReturnType<typeof setTimeout> | undefined;

function odjavljen() {
  gotovo = true;
  stanje("van", "Sesija je istekla: osvježi stranicu i prijavi se ponovno.");
  ws?.close();
}

function spoji() {
  if (gotovo) return;
  const s = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/admin/uzivo`);
  ws = s;
  let otvoren = false;
  s.onopen = () => {
    otvoren = true;
    stanje("da", "Uživo: stranica se sama osvježi kad stignu novi podaci.");
    // Nakon prekida možda je nešto promaklo.
    if (pokusaj > 0) osvjezi();
    pokusaj = 0;
  };
  s.onmessage = (e) => {
    if (e.data === "pong") return;
    try {
      const d = JSON.parse(e.data) as { vrsta?: string; vrijeme?: string };
      stanje("da", `Uživo. Zadnje: ${IZRAZI[d.vrsta ?? ""] ?? d.vrsta}, ${new Date(d.vrijeme ?? Date.now()).toLocaleTimeString("hr-HR")}`);
    } catch {}
    // Jedan mail zna dati više upisa zaredom: jedno osvježavanje.
    clearTimeout(tajmer);
    tajmer = setTimeout(osvjezi, 400);
  };
  s.onclose = (e) => {
    if (ws !== s) return;
    if (e.code === 4001) return odjavljen();
    stanje("ne", "Veza prekinuta, ponovno spajanje…");
    // Odbijen handshake (npr. 401) izgleda kao 1006 bez otvaranja: nakon nekoliko takvih
    // provjeri sesiju stranicom.
    pokusaj += 1;
    if (!otvoren && pokusaj >= 3) osvjezi();
    setTimeout(spoji, Math.min(30_000, 1000 * 2 ** Math.min(pokusaj, 5)));
  };
}

if (oznaka) {
  spoji();
  // Proxyji gase tihe veze; "ping" odgovara runtime bez buđenja Durable Objecta.
  setInterval(() => { if (ws?.readyState === WebSocket.OPEN) ws.send("ping"); }, 25_000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && ceka) osvjezi(); });
}
