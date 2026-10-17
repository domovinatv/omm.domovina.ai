// /admin: prijava preko Cloudflare Accessa ili passkeya (isti model kao pay.domovina.ai,
// docs/admin.md). Ostatak stranice nema prijave i middleware ga ne dira.
import { defineMiddleware } from "astro:middleware";
import { env } from "cloudflare:workers";
import { getSession } from "./lib/admin/sesija";
import { CORS } from "./lib/http";

const JAVNO = new Set([
  "/admin/login",
  "/admin/sso",
  "/admin/passkey/login/options",
  "/admin/passkey/login/verify",
  // Odjava bez (važeće) sesije samo vodi na prijavu umjesto sirovog 401.
  "/admin/logout",
]);

const jeAdmin = (p: string) => p === "/admin" || p.startsWith("/admin/");
const lokalno = (h: string) => h === "localhost" || h === "127.0.0.1";
const json = (data: unknown, status: number) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

// Skupo: OCR (Workers AI) i PDF izvještaja (Browser Rendering). HTML i JSON izvještaja nisu.
const jeSkupo = (method: string, p: string, upit: URLSearchParams) =>
  (method === "POST" && p === "/api/ocitaj") ||
  (method === "GET" && /^\/api\/izvjestaj\/\d+$/.test(p) && (upit.get("oblik") ?? "pdf") === "pdf");

/** 429 kad IP (ili ključ, za skupe rute) prijeđe limit iz wrangler.jsonc (SEC-02). */
async function ogranicenje(request: Request, url: URL): Promise<Response | null> {
  if (request.method === "OPTIONS" || !env.LIMIT_API) return null;
  const ip = request.headers.get("cf-connecting-ip") ?? "lokalno";
  const kljucevi: [RateLimit, string][] = [[env.LIMIT_API, ip]];
  if (jeSkupo(request.method, url.pathname, url.searchParams)) {
    kljucevi.push([env.LIMIT_SKUPO, `ip:${ip}`]);
    const k = /^Bearer (\S+)$/.exec(request.headers.get("Authorization") ?? "")?.[1];
    if (k) kljucevi.push([env.LIMIT_SKUPO, `k:${k}`]);
  }
  for (const [limit, key] of kljucevi) {
    if (!(await limit.limit({ key })).success) {
      return new Response(JSON.stringify({ greska: "Previše zahtjeva, pokušaj za minutu." }), {
        status: 429,
        headers: { "Content-Type": "application/json; charset=utf-8", "Retry-After": "60", ...CORS },
      });
    }
  }
  return null;
}

export const onRequest = defineMiddleware(async ({ request, url, locals }, next) => {
  if (url.pathname.startsWith("/api/")) return (await ogranicenje(request, url)) ?? next();
  if (!jeAdmin(url.pathname)) return next();

  // 1. Jedan host: rpID passkeya je hostname, a Access štiti samo ADMIN_HOST/admin/sso.
  const host = (env.ADMIN_HOST ?? "").trim();
  if (host && url.hostname !== host && !lokalno(url.hostname)) {
    if (request.method !== "GET") return json({ error: "wrong_admin_host", admin_host: host }, 421);
    return Response.redirect(`https://${host}${url.pathname}${url.search}`, 301);
  }

  // 2. CSRF: svaka promjena mora doći s istog origina (kolačić je SameSite=Lax).
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const origin = request.headers.get("origin");
    if (!origin || origin !== url.origin) return json({ error: "bad_origin" }, 403);
  }

  // 3. Sesija za sve osim javnih putanja.
  if (!JAVNO.has(url.pathname)) {
    const s = await getSession(request.headers.get("cookie"));
    if (!s) {
      if (request.method !== "GET" || url.pathname.startsWith("/admin/api/")) return json({ error: "unauthorized" }, 401);
      return Response.redirect(new URL(`/admin/login?next=${encodeURIComponent(url.pathname + url.search)}`, url), 302);
    }
    locals.admin = s;
  }

  // 4. Sigurnosna zaglavlja. Astro male skripte umeće inline, pa dobivaju nonce.
  const odgovor = await next();
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))).replace(/[+/=]/g, "");
  let tijelo: BodyInit | null = odgovor.body;
  if ((odgovor.headers.get("content-type") ?? "").startsWith("text/html")) {
    tijelo = (await odgovor.text()).replace(/<script(?![^>]*\bsrc=)/g, `<script nonce="${nonce}"`);
  }
  const h = new Headers(odgovor.headers);
  h.set(
    "content-security-policy",
    `default-src 'none'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; ` +
      `img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
  );
  h.set("x-content-type-options", "nosniff");
  // Ne "no-referrer": uz nju preglednik na <form> POST šalje `Origin: null`.
  h.set("referrer-policy", "same-origin");
  h.set("x-frame-options", "DENY");
  h.set("x-robots-tag", "noindex");
  if (!h.has("cache-control")) h.set("cache-control", "no-store");
  return new Response(tijelo, { status: odgovor.status, statusText: odgovor.statusText, headers: h });
});
