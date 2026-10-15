import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { verifyAccessJwt } from "../../lib/admin/access";
import { accessConfigured, adminEmails, readCookie, safeNext, startSession } from "../../lib/admin/sesija";

/** Access na rubu štiti samo ovu putanju. Ovdje se JWT pretvara u našu sesiju. */
export const GET: APIRoute = async ({ request, url }) => {
  if (!accessConfigured()) return new Response("Cloudflare Access nije konfiguriran.", { status: 503 });
  const token = request.headers.get("cf-access-jwt-assertion") ?? readCookie(request.headers.get("cookie"), "CF_Authorization");
  const claims = token ? await verifyAccessJwt(token, { teamDomain: env.ACCESS_TEAM_DOMAIN, aud: env.ACCESS_AUD }) : null;
  if (!claims || !adminEmails().has(claims.email)) {
    console.warn(JSON.stringify({ msg: "access_login_rejected", email: claims?.email ?? null }));
    return new Response(null, { status: 302, headers: { location: "/admin/login?error=access" } });
  }
  return startSession(request, claims.email, "access", safeNext(url.searchParams.get("next")));
};
