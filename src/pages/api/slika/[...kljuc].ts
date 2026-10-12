import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";

/**
 * Slika brojila. Put sadrži ključ uređaja, pa je tko ima link ima i sliku —
 * isto kao i za snimke dok nema prijave.
 */
export const GET: APIRoute = async ({ params }) => {
  const k = params.kljuc ?? "";
  if (!/^[A-Za-z0-9_-]{22,64}\/[0-9a-f-]{36}\.(jpg|png)$/.test(k)) return new Response("Ne", { status: 404 });
  const o = await env.SLIKE.get(k);
  if (!o) return new Response("Nema", { status: 404 });
  return new Response(o.body, {
    headers: { "Content-Type": o.httpMetadata?.contentType ?? "image/jpeg", "Cache-Control": "private, max-age=86400" },
  });
};
