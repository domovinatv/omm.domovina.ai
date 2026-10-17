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
import { procitajRacun } from "./hep-racun";
import { slabKljuc } from "./http";
import { registriraj, stanjeKljuca } from "./kljucevi";
import { spremiRacun } from "./racuni";

const NAJVISE = 10 * 1024 * 1024;

/** `racuni+<ključ>@…` → ključ; bez ključa nema kome pripisati mail. */
export function kljucIzAdrese(adresa: string): string | null {
  const m = /^racuni\+([A-Za-z0-9_-]{22,64})@/i.exec(adresa.trim());
  return m && !slabKljuc(m[1]) ? m[1] : null;
}

/** Gmail šalje kod i poveznicu na adresu prosljeđivanja prije nego je pusti. */
export function gmailPotvrda(naslov: string, tekst: string): { kod: string | null; poveznica: string | null } | null {
  const kod = /\(#(\d{6,})\)/.exec(naslov)?.[1] ?? /(?:kod|code)[^\d]{0,40}(\d{6,})/i.exec(tekst)?.[1] ?? null;
  const poveznica = /https:\/\/mail(?:-settings)?\.google\.com\/mail\/[^\s"<>]*vf-[^\s"<>]*/.exec(tekst)?.[0] ?? null;
  if (!kod && !poveznica) return null;
  return { kod, poveznica };
}

/**
 * Mail je od Googlea: domena pošiljatelja je google.com ili njena poddomena (ne
 * `attacker-google.com`), a kad Email Routing doda `Authentication-Results`, DMARC je
 * prošao, pa `From` nije lažan (SEC-09). Bez tog zaglavlja vrijedi samo domena.
 */
export function odGooglea(od: string, rezultati: string | null): boolean {
  if (!/(^|[.@])google\.com$/i.test(od.trim())) return false;
  return rezultati == null || /\bdmarc=pass\b/i.test(rezultati);
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

export async function primiMail(poruka: ForwardableEmailMessage): Promise<void> {
  const uredaj = kljucIzAdrese(poruka.to);
  if (!uredaj) return poruka.setReject("Nepoznata adresa");
  if (poruka.rawSize > NAJVISE) return poruka.setReject("Poruka je prevelika");

  // Nepoznat ključ (SEC-05): prolazi samo Gmailova potvrda prosljeđivanja, koja
  // stiže prije prvog računa i registrira ključ; ostalo se odbije prije parsiranja PDF-a.
  const stanje = await stanjeKljuca(uredaj);
  if (stanje === "zamijenjen") return poruka.setReject("Nepoznata adresa");

  const mail = await PostalMime.parse(poruka.raw);
  const naslov = mail.subject ?? "";
  const od = mail.from?.address ?? poruka.from;
  try {
    const potvrda = gmailPotvrda(naslov, `${mail.text ?? ""}\n${mail.html ?? ""}`);
    if (potvrda && odGooglea(od, poruka.headers.get("authentication-results"))) {
      if (stanje === "nepoznat") await registriraj(uredaj);
      return await zapisiMail(uredaj, od, naslov, { vrsta: "gmail-potvrda", ishod: "novo", poruka: potvrda });
    }
    if (stanje === "nepoznat") return poruka.setReject("Nepoznata adresa");

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
