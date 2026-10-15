import type { APIRoute } from "astro";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { registerRefusal, verifyRegistration } from "../../../../lib/admin/passkey";

export const POST: APIRoute = async ({ request, url, locals }) => {
  const s = locals.admin!;
  const odbijeno = await registerRefusal(s);
  if (odbijeno) return Response.json({ error: odbijeno }, { status: 403 });
  const body = await request.json<{ response?: RegistrationResponseJSON; label?: string }>().catch(() => null);
  if (!body?.response?.id) return Response.json({ error: "bad_request" }, { status: 400 });
  const label = (body.label ?? "").trim();
  const ok = await verifyRegistration(url, s.email, body.response, label);
  if (ok) console.warn(JSON.stringify({ msg: "admin_passkey_added", email: s.email, label: label.slice(0, 60) }));
  return ok ? Response.json({ ok: true }) : Response.json({ error: "upis nije uspio" }, { status: 400 });
};
