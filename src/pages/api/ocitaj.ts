import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { zapisi } from "../../lib/dnevnik";
import { greska, json, noviId, opcije, uredaj } from "../../lib/http";
import { kwh, procitaj } from "../../lib/ocr";

/**
 * POST multipart `slika` (jedna slika zaslona) → prijedlog 1.8.1 / 1.8.2.
 * Slika se sprema u R2 da se OCR kasnije može provjeriti; ključ se vraća pa ga
 * klijent šalje uz snimak.
 */
function vrstaSlike(b: Uint8Array): string | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (String.fromCharCode(...b.subarray(0, 4)) === "RIFF" && String.fromCharCode(...b.subarray(8, 12)) === "WEBP") return "image/webp";
  return null;
}

export const POST: APIRoute = async ({ request }) => {
  const kljuc = uredaj(request);
  if (!kljuc) return greska("Nedostaje ključ uređaja", 401);

  const forma = await request.formData().catch(() => null);
  const slika = forma?.get("slika");
  if (!(slika instanceof File)) return greska("Pošalji sliku u polju 'slika'");
  if (slika.size > 8 * 1024 * 1024) return greska("Slika je veća od 8 MB", 413);

  const bajtovi = new Uint8Array(await slika.arrayBuffer());
  // Vrsta po sadržaju, ne po zaglavlju: Dartov http šalje application/octet-stream.
  const mime = vrstaSlike(bajtovi);
  if (!mime) {
    await zapisi(request, { uredaj: kljuc, vrsta: "ocitaj", ishod: "greska", tijelo: { greska: "nije JPEG/PNG/WebP", poslano_kao: slika.type } });
    return greska("Slika mora biti JPEG, PNG ili WebP", 415);
  }
  const r2 = `${kljuc}/${noviId()}.${mime === "image/png" ? "png" : "jpg"}`;
  await env.SLIKE.put(r2, bajtovi, { httpMetadata: { contentType: mime } });

  try {
    // `model` u formi služi za usporedbu modela; zadano je OCR_MODEL.
    const zatrazen = forma?.get("model");
    const model = typeof zatrazen === "string" && /^@cf\/[\w.\/-]+$/.test(zatrazen) ? zatrazen : env.OCR_MODEL;
    const r = await procitaj(env.AI, model, bajtovi, mime);
    const t1 = r.registri.find((x) => x.obis === "1.8.1");
    const t2 = r.registri.find((x) => x.obis === "1.8.2");
    // Vrijednost bez sigurne oznake tarife (npr. "?" ili 1.8.0): klijent je
    // stavlja u prvo prazno polje i upozori korisnika.
    const neodredeno = !t1 && !t2 ? r.registri.find((x) => !x.obis.startsWith("2.")) : undefined;
    await zapisi(request, {
      uredaj: kljuc,
      vrsta: "ocitaj",
      ishod: "ok",
      tijelo: { slika: r2, model, registri: r.registri, napomena: r.napomena },
    });
    return json({
      slika: r2,
      t1: t1 ? kwh(t1.vrijednost) : null,
      t2: t2 ? kwh(t2.vrijednost) : null,
      neodredeno: neodredeno ? kwh(neodredeno.vrijednost) : null,
      registri: r.registri,
      napomena: r.napomena ?? null,
      model: r.model,
      sirovo: r.sirovo,
    });
  } catch (e) {
    await zapisi(request, { uredaj: kljuc, vrsta: "ocitaj", ishod: "greska", tijelo: { slika: r2, greska: String(e) } });
    return json({ slika: r2, t1: null, t2: null, registri: [], greska: `OCR nije uspio: ${e}` }, 502);
  }
};

export const OPTIONS: APIRoute = opcije;
