import type { APIRoute } from "astro";
import { registerRefusal, registrationOptions } from "../../../../lib/admin/passkey";

export const POST: APIRoute = async ({ url, locals }) => {
  const s = locals.admin!;
  const odbijeno = await registerRefusal(s);
  if (odbijeno) return Response.json({ error: odbijeno }, { status: 403 });
  return Response.json(await registrationOptions(url, s.email));
};
