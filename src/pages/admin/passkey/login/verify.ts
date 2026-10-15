import type { APIRoute } from "astro";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { verifyLogin } from "../../../../lib/admin/passkey";
import { safeNext, startSession } from "../../../../lib/admin/sesija";

export const POST: APIRoute = async ({ request, url }) => {
  const body = await request.json<{ response?: AuthenticationResponseJSON; next?: string }>().catch(() => null);
  if (!body?.response?.id) return Response.json({ error: "bad_request" }, { status: 400 });
  const email = await verifyLogin(url, body.response);
  if (!email) return Response.json({ error: "prijava nije uspjela" }, { status: 401 });
  return startSession(request, email, "passkey", safeNext(body.next), true);
};
