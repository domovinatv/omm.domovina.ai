// Ulaz Workera: Astro za HTTP, plus primanje maila (Email Routing → racuni+<ključ>@omm.domovina.ai).
import { handle } from "@astrojs/cloudflare/handler";
import { primiMail } from "./lib/mail";

export default {
  fetch: handle,
  email: (poruka) => primiMail(poruka),
} satisfies ExportedHandler<Env>;
