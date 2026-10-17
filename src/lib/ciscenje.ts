import { env } from "cloudflare:workers";

/** Rokovi čuvanja (SEC-03); /privatnost ih pokazuje, pa se mijenjaju samo ovdje. */
export const DNEVNIK_DANA = 90;
export const MAILOVI_DANA = 180;

const prije = (dana: number) => new Date(Date.now() - dana * 86_400_000).toISOString();

/** Dnevni cron (wrangler.jsonc `triggers`): briše stari dnevnik i zapise mailova. */
export async function ocisti(): Promise<void> {
  const [d, m] = await env.DB.batch([
    env.DB.prepare(`DELETE FROM dogadaji WHERE stvoren < ?`).bind(prije(DNEVNIK_DANA)),
    env.DB.prepare(`DELETE FROM mailovi WHERE primljen < ?`).bind(prije(MAILOVI_DANA)),
  ]);
  console.log("ciscenje", { dogadaji: d.meta.changes, mailovi: m.meta.changes });
}
