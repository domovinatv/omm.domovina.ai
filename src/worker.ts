// Ulaz Workera: Astro za HTTP, primanje maila (Email Routing → racuni+<ključ>@omm.domovina.ai)
// i dnevno čišćenje starih zapisa (rokovi u src/lib/ciscenje.ts).
import { handle } from "@astrojs/cloudflare/handler";
import { ocisti } from "./lib/ciscenje";
import { primiMail } from "./lib/mail";

export default {
  fetch: handle,
  email: (poruka) => primiMail(poruka),
  scheduled: (_kontroler, _env, ctx) => ctx.waitUntil(ocisti()),
} satisfies ExportedHandler<Env>;
