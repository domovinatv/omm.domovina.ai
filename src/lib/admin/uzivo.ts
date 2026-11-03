// Admin uživo: otvorene /admin stranice drže WebSocket na jednom Durable Objectu, a svaki
// upis u bazu (snimak, mail, priključak…) mu javi da je nešto novo. Stranica tada sama
// dohvati svoj HTML i zamijeni sadržaj (AdminOkvir.astro), pa poruka ne nosi podatke.
//
// Jedan DO za sve admine je namjerno: admina je nekoliko, a upisa malo. WebSocketi su
// hibernacijski (ctx.acceptWebSocket), pa DO ne troši ništa dok nema događaja; ping
// klijenta odgovara runtime (setWebSocketAutoResponse) bez buđenja.
import { DurableObject, env, waitUntil } from "cloudflare:workers";
import { getSession } from "./sesija";

export type Dogadaj = { vrsta: string; ishod?: string };

type Privitak = { istice: number };

export class AdminUzivo extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request: Request): Promise<Response> {
    const istice = Number(request.headers.get("x-sesija-istice")) || Date.now() + 3600_000;
    const [klijent, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ istice } satisfies Privitak);
    return new Response(null, { status: 101, webSocket: klijent });
  }

  /** Pošalji događaj svim otvorenim admin stranicama; one s isteklom sesijom zatvori. */
  async javi(d: Dogadaj): Promise<void> {
    const poruka = JSON.stringify({ ...d, vrijeme: new Date().toISOString() });
    const sada = Date.now();
    for (const ws of this.ctx.getWebSockets()) {
      const p = ws.deserializeAttachment() as Privitak | null;
      try {
        if (p && p.istice < sada) ws.close(4001, "sesija istekla");
        else ws.send(poruka);
      } catch {}
    }
  }

  // Klijent osim pinga ništa ne šalje; hibernacijski API traži ove metode.
  async webSocketMessage(): Promise<void> {}
  async webSocketClose(ws: WebSocket, kod: number): Promise<void> {
    try { ws.close(kod === 1005 ? 1000 : kod, "zatvoreno"); } catch {}
  }
}

const stub = () => env.ADMIN_UZIVO.getByName("admin");

/**
 * Javi adminu da se baza promijenila. Ne čeka i ne smije srušiti zahtjev: ide kroz
 * waitUntil, greška samo u log.
 */
export function javiAdminu(d: Dogadaj): void {
  if (!env.ADMIN_UZIVO) return;
  waitUntil(stub().javi(d).catch((e) => console.error("admin uzivo", e)));
}

/**
 * GET /admin/uzivo (WebSocket). Ide mimo Astra (src/worker.ts), pa ovdje ponavlja
 * provjere iz middlewarea: host, Origin (kolačić ide i uz WebSocket, CSWSH) i sesiju.
 */
export async function uzivo(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const host = (env.ADMIN_HOST ?? "").trim();
  const lokalno = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (host && url.hostname !== host && !lokalno) return new Response("wrong_admin_host", { status: 421 });
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("Treba WebSocket", { status: 426 });
  if (request.headers.get("origin") !== url.origin) return new Response("bad_origin", { status: 403 });
  const s = await getSession(request.headers.get("cookie"));
  if (!s) return new Response("unauthorized", { status: 401 });
  const zahtjev = new Request(request);
  zahtjev.headers.set("x-sesija-istice", String(Date.parse(s.expiresAt)));
  return stub().fetch(zahtjev);
}
