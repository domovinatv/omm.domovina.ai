/** Zajedničko za API rute: JSON odgovori, ključ uređaja, CORS za aplikaciju. */

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
};

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  });
}

export const greska = (poruka: string, status = 400) => json({ greska: poruka }, status);

export const opcije = () => new Response(null, { status: 204, headers: CORS });

/**
 * Ključ uređaja iz `Authorization: Bearer <ključ>`. Generira ga klijent
 * (22+ znakova base64url). Nije prijava: tko zna ključ, vidi te snimke.
 */
export function uredaj(request: Request): string | null {
  const m = /^Bearer ([A-Za-z0-9_-]{22,64})$/.exec(request.headers.get("Authorization") ?? "");
  return m ? m[1] : null;
}

export const noviId = () => crypto.randomUUID();
