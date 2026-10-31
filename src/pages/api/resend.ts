import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { obradiMail } from "../../lib/mail";

/**
 * POST webhook Resenda (`email.received`) za mail na `*@omm.domovina.ai`. MX poddomene
 * pokazuje na Resend, jer Cloudflare Email Routing traži svoje MX i na `domovina.ai`, gdje
 * je Google Workspace (docs/2026-10-31-prikljucna-snaga.md § Prijem maila).
 *
 * Webhook nosi samo metapodatke: mail se dohvati preko API-ja (`raw.download_url`) i ide
 * istim putem kao iz Email Routinga (`obradiMail`). Potpis je Svixov (HMAC-SHA256 nad
 * `id.timestamp.tijelo`, tajna `whsec_…` u `RESEND_WEBHOOK_SECRET`).
 */
const TOLERANCIJA_S = 5 * 60;

async function potpisValja(tijelo: string, zaglavlja: Headers): Promise<boolean> {
  const id = zaglavlja.get("svix-id");
  const vrijeme = zaglavlja.get("svix-timestamp");
  const potpisi = zaglavlja.get("svix-signature");
  const tajna = env.RESEND_WEBHOOK_SECRET;
  if (!id || !vrijeme || !potpisi || !tajna) return false;
  if (Math.abs(Date.now() / 1000 - Number(vrijeme)) > TOLERANCIJA_S) return false;
  const kljuc = await crypto.subtle.importKey(
    "raw", Uint8Array.from(atob(tajna.replace(/^whsec_/, "")), (c) => c.charCodeAt(0)),
    { name: "HMAC", hash: "SHA-256" }, false, ["verify"],
  );
  const sadrzaj = new TextEncoder().encode(`${id}.${vrijeme}.${tijelo}`);
  for (const p of potpisi.split(" ")) {
    const [verzija, b64] = p.split(",");
    if (verzija !== "v1" || !b64) continue;
    let potpis: Uint8Array<ArrayBuffer>;
    try { potpis = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); } catch { continue; }
    if (await crypto.subtle.verify("HMAC", kljuc, potpis, sadrzaj)) return true;
  }
  return false;
}

const resend = (put: string) =>
  fetch(`https://api.resend.com${put}`, { headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` } });

export const POST: APIRoute = async ({ request }) => {
  const tijelo = await request.text();
  if (!(await potpisValja(tijelo, request.headers))) return new Response("Neispravan potpis", { status: 401 });
  const dogadaj = JSON.parse(tijelo) as { type: string; data?: { email_id?: string; to?: string[]; from?: string } };
  if (dogadaj.type !== "email.received" || !dogadaj.data?.email_id) return new Response(null, { status: 204 });

  const r = await resend(`/emails/receiving/${encodeURIComponent(dogadaj.data.email_id)}`);
  // 5xx i 429 vraćaju grešku da Resend pokuša ponovno; ostalo bi se samo ponavljalo.
  if (!r.ok) return new Response(`Resend ${r.status}`, { status: r.status >= 500 || r.status === 429 ? 502 : 200 });
  const mail = (await r.json()) as {
    to: string[]; from: string; received_for?: string[];
    raw: { download_url: string } | null;
    authentication: { dmarc?: string } | null;
  };
  if (!mail.raw?.download_url) return new Response("Nema sirovog maila", { status: 200 });
  const sirovo = await fetch(mail.raw.download_url);
  if (!sirovo.ok) return new Response(`Sirovi mail ${sirovo.status}`, { status: 502 });
  const raw = await sirovo.arrayBuffer();

  // Gmailovo prosljeđivanje zna ostaviti izvornu adresu u To; prava je u received_for.
  const adrese = [...(mail.received_for ?? []), ...(mail.to ?? []), ...(dogadaj.data.to ?? [])];
  const to = adrese.find((a) => /^racuni\+/i.test(a.trim())) ?? adrese[0] ?? "";
  const odbij = await obradiMail({
    to, from: mail.from, raw, velicina: raw.byteLength,
    autentikacija: mail.authentication?.dmarc ? `dmarc=${mail.authentication.dmarc}` : null,
  });
  if (odbij) console.log("resend odbijeno", { razlog: odbij, id: dogadaj.data.email_id });
  return new Response(null, { status: 204 });
};
