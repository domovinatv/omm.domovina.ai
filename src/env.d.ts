// Secreti (wrangler secret put), nisu u wrangler.jsonc pa ih `wrangler types` ne vidi.
declare namespace Cloudflare {
  interface Env {
    RESEND_API_KEY: string;
    RESEND_WEBHOOK_SECRET: string;
  }
}

declare namespace App {
  interface Locals {
    /** Prijavljeni admin, samo pod /admin (src/middleware.ts). */
    admin?: import("./lib/admin/sesija").Session;
  }
}
