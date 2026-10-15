import type { APIRoute } from "astro";
import { loginOptions } from "../../../../lib/admin/passkey";

export const POST: APIRoute = async ({ url }) => Response.json(await loginOptions(url));
