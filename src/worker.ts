// Ulaz Workera: Astro za HTTP, primanje maila (Email Routing → racuni+<ključ>@omm.domovina.ai)
// i dnevno čišćenje starih zapisa (rokovi u src/lib/ciscenje.ts).
// /admin/uzivo (WebSocket na Durable Object AdminUzivo) ide mimo Astra.
import { handle } from "@astrojs/cloudflare/handler";
import { uzivo } from "./lib/admin/uzivo";
import { ocisti } from "./lib/ciscenje";
import { primiMail } from "./lib/mail";

export { AdminUzivo } from "./lib/admin/uzivo";

export default {
  fetch: (request, env, ctx) => (new URL(request.url).pathname === "/admin/uzivo" ? uzivo(request) : handle(request, env, ctx)),
  email: (poruka) => primiMail(poruka),
  scheduled: (_kontroler, _env, ctx) => ctx.waitUntil(ocisti()),
} satisfies ExportedHandler<Env>;
