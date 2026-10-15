/** Izvještaj kao HTML stranica ili PDF; isto za korisnika (`/api/izvjestaj`) i admina. */
import { env } from "cloudflare:workers";
import puppeteer from "@cloudflare/puppeteer";
import { html, PODNOZJE } from "./html";
import type { Podaci } from "./izracun";

export async function odgovorIzvjestaja(
  podaci: Podaci,
  o: { omm: string; oblik: "pdf" | "html"; anonimno: boolean; origin: string; zaglavlja?: Record<string, string> },
): Promise<Response> {
  const font = (w: number) => `${o.origin}/fonts/Inter-${w}.ttf`;
  if (o.oblik === "html") {
    const stranica = html(podaci, { 400: font(400), 600: font(600), 700: font(700) });
    return new Response(stranica, { headers: { "Content-Type": "text/html; charset=utf-8", ...o.zaglavlja } });
  }
  const ugradi = async (w: number) => {
    const r = await env.ASSETS.fetch(font(w));
    return `data:font/ttf;base64,${Buffer.from(await r.arrayBuffer()).toString("base64")}`;
  };
  const [f400, f600, f700] = await Promise.all([ugradi(400), ugradi(600), ugradi(700)]);
  const stranica = html(podaci, { 400: f400, 600: f600, 700: f700 });

  const preglednik = await puppeteer.launch(env.BROWSER);
  try {
    const tab = await preglednik.newPage();
    await tab.setContent(stranica, { waitUntil: "networkidle0" });
    const pdf = await tab.pdf({
      format: "A4", printBackground: true, preferCSSPageSize: true,
      displayHeaderFooter: true, headerTemplate: "<span></span>", footerTemplate: PODNOZJE,
    });
    // Anonimna verzija se dijeli, pa ni ime datoteke ne nosi OMM.
    const ime = o.anonimno ? `Potrosnja-struje-${podaci.od}-anonimno.pdf` : `Potrosnja-${o.omm}-${podaci.od}.pdf`;
    return new Response(new Uint8Array(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${ime}"`, ...o.zaglavlja },
    });
  } finally {
    await preglednik.close();
  }
}
