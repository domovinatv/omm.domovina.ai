/**
 * Dolazni mail: HEP-ovi računi koje korisnik prosljeđuje na
 * `racuni+<ključ uređaja>@omm.domovina.ai` (Cloudflare Email Routing → ovaj
 * Worker). Ključ u adresi zamjenjuje prijavu, kao Bearer ključ u API-ju.
 *
 * Čuva se samo pročitani JSON računa (bez OIB-a i imena), ne PDF ni sirovi
 * mail. Gmailova potvrda prosljeđivanja čuva se da je korisnik vidi na /uvoz,
 * jer bez nje Gmail ne prosljeđuje.
 */
import { env } from "cloudflare:workers";
import PostalMime from "postal-mime";
import { procitajRacun, type HepRacun } from "./hep-racun";

const NAJVISE = 10 * 1024 * 1024;

async function sha256(tekst: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(tekst));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** `racuni+<ključ>@…` → ključ; bez ključa nema kome pripisati mail. */
export function kljucIzAdrese(adresa: string): string | null {
  const m = /^racuni\+([A-Za-z0-9_-]{22,64})@/i.exec(adresa.trim());
  return m ? m[1] : null;
}

/** Gmail šalje kod i poveznicu na adresu prosljeđivanja prije nego je pusti. */
export function gmailPotvrda(naslov: string, tekst: string): { kod: string | null; poveznica: string | null } | null {
  const kod = /\(#(\d{6,})\)/.exec(naslov)?.[1] ?? /(?:kod|code)[^\d]{0,40}(\d{6,})/i.exec(tekst)?.[1] ?? null;
  const poveznica = /https:\/\/mail(?:-settings)?\.google\.com\/mail\/[^\s"<>]*vf-[^\s"<>]*/.exec(tekst)?.[0] ?? null;
  if (!kod && !poveznica) return null;
  return { kod, poveznica };
}

type Zapis = { vrsta: "racun" | "gmail-potvrda" | "ostalo"; ishod: "novo" | "duplikat" | "nije-racun" | "greska"; poruka?: unknown; snimakId?: string };

async function zapisiMail(uredaj: string, od: string, naslov: string, z: Zapis) {
  await env.DB.prepare(
    `INSERT INTO mailovi (id, uredaj, primljen, od, naslov, vrsta, ishod, poruka, snimak_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), uredaj, new Date().toISOString(), od, naslov, z.vrsta, z.ishod,
      z.poruka === undefined ? null : JSON.stringify(z.poruka), z.snimakId ?? null)
    .run();
}

/** Račun kao snimak `hep-racun`: OMM s računa, t1/t2 iz zadnjeg očitanja, isti broj računa je duplikat. */
async function spremiRacun(uredaj: string, r: HepRacun): Promise<{ id: string; duplikat: boolean }> {
  const otisak = await sha256(JSON.stringify({ izvor: "hep-racun", broj: r.broj, iznos: r.iznos }));
  const postojeci = await env.DB.prepare(`SELECT id FROM snimci WHERE uredaj = ? AND otisak = ?`)
    .bind(uredaj, otisak).first<{ id: string }>();
  if (postojeci) return { id: postojeci.id, duplikat: true };
  const zadnje = [...r.ocitanja].sort((a, b) => b.datum.localeCompare(a.datum))[0];
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO snimci (id, uredaj, stvoren, izvor, omm, t1, t2, uvoz, otisak)
     VALUES (?, ?, ?, 'hep-racun', ?, ?, ?, ?, ?) ON CONFLICT (uredaj, otisak) DO NOTHING`,
  )
    .bind(id, uredaj, new Date().toISOString(), r.omm, zadnje ? Math.floor(zadnje.vt) : null,
      zadnje ? Math.floor(zadnje.nt) : null, JSON.stringify(r), otisak)
    .run();
  return { id, duplikat: false };
}

export async function primiMail(poruka: ForwardableEmailMessage): Promise<void> {
  const uredaj = kljucIzAdrese(poruka.to);
  if (!uredaj) return poruka.setReject("Nepoznata adresa");
  if (poruka.rawSize > NAJVISE) return poruka.setReject("Poruka je prevelika");

  const mail = await PostalMime.parse(poruka.raw);
  const naslov = mail.subject ?? "";
  const od = mail.from?.address ?? poruka.from;
  try {
    const potvrda = gmailPotvrda(naslov, `${mail.text ?? ""}\n${mail.html ?? ""}`);
    if (potvrda && /google\.com$/i.test(od)) {
      return await zapisiMail(uredaj, od, naslov, { vrsta: "gmail-potvrda", ishod: "novo", poruka: potvrda });
    }

    const pdfovi = mail.attachments.filter((a) => a.mimeType === "application/pdf" || /\.pdf$/i.test(a.filename ?? ""));
    let ijedan = false;
    for (const a of pdfovi) {
      const sadrzaj = typeof a.content === "string" ? new TextEncoder().encode(a.content) : new Uint8Array(a.content);
      const racun = await procitajRacun(sadrzaj).catch(() => null);
      if (!racun) continue;
      ijedan = true;
      const s = await spremiRacun(uredaj, racun);
      await zapisiMail(uredaj, od, naslov, {
        vrsta: "racun",
        ishod: s.duplikat ? "duplikat" : "novo",
        snimakId: s.id,
        poruka: { broj: racun.broj, za_mjesec: racun.za_mjesec, iznos: racun.iznos, omm: racun.omm },
      });
    }
    if (!ijedan) {
      await zapisiMail(uredaj, od, naslov, { vrsta: "ostalo", ishod: "nije-racun", poruka: { prilozi: mail.attachments.map((a) => a.filename) } });
    }
  } catch (e) {
    console.error("mail", e);
    await zapisiMail(uredaj, od, naslov, { vrsta: "ostalo", ishod: "greska", poruka: String(e) });
  }
}
