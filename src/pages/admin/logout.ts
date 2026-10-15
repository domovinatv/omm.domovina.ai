import type { APIRoute } from "astro";
import { deleteSession, sessionCookie } from "../../lib/admin/sesija";

export const POST: APIRoute = async ({ request }) => {
  await deleteSession(request.headers.get("cookie"));
  return new Response(null, { status: 303, headers: { location: "/admin/login", "set-cookie": sessionCookie("", 0) } });
};
