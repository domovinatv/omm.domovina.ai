import { env } from "cloudflare:workers";

/**
 * Upis u `dogadaji`. Dnevnik nikad ne smije srušiti zahtjev, pa se greška
 * samo ispiše u log Workera.
 */
export async function zapisi(
  request: Request,
  d: {
    uredaj: string | null;
    vrsta: "snimak" | "ocitaj" | "dostava" | "brisanje";
    ishod: "novo" | "duplikat" | "greska" | "ok";
    snimakId?: string | null;
    otisak?: string | null;
    tijelo?: unknown;
  },
): Promise<void> {
  try {
    const cf = (request as Request & { cf?: { country?: string } }).cf;
    await env.DB.prepare(
      `INSERT INTO dogadaji (stvoren, uredaj, vrsta, ishod, snimak_id, otisak, tijelo, user_agent, ip_drzava)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        new Date().toISOString(),
        d.uredaj,
        d.vrsta,
        d.ishod,
        d.snimakId ?? null,
        d.otisak ?? null,
        d.tijelo === undefined ? null : JSON.stringify(d.tijelo),
        request.headers.get("User-Agent"),
        cf?.country ?? null,
      )
      .run();
  } catch (e) {
    console.error("dnevnik", e);
  }
}
