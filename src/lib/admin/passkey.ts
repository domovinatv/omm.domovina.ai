// Preneseno iz pay.domovina.ai backend/src/admin/auth/passkey.ts — držati u skladu.
// WebAuthn ceremonije preko @simplewebauthn/server. rpID i origin izvode se iz
// zahtjeva: ključ upisan na localhostu ne otvara produkciju.
import { env } from "cloudflare:workers";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { adminEmails, consumeChallenge, storeChallenge } from "./sesija";

const RP_NAME = "OMM admin";

interface PasskeyRow { id: string; email: string; public_key: string; counter: number; transports: string | null }

const ctx = (url: URL) => ({ rpID: url.hostname, origin: url.origin });
const transports = (t: string | null) => (t ? (t.split(",") as AuthenticatorTransport[]) : undefined);

export async function registrationOptions(url: URL, email: string) {
  const existing = await env.DB.prepare("SELECT id, transports FROM admin_passkeys WHERE email = ?")
    .bind(email)
    .all<{ id: string; transports: string | null }>();
  const userID = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email)));
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: ctx(url).rpID,
    userName: email,
    userID,
    attestationType: "none",
    excludeCredentials: existing.results.map((k) => ({ id: k.id, transports: transports(k.transports) })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
  await storeChallenge(options.challenge, "register", email);
  return options;
}

export async function verifyRegistration(url: URL, email: string, response: RegistrationResponseJSON, label: string): Promise<boolean> {
  const { rpID, origin } = ctx(url);
  const result = await verifyRegistrationResponse({
    response,
    expectedChallenge: async (c) => (await consumeChallenge(c, "register"))?.email === email,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
  }).catch(() => null);
  if (!result?.verified) return false;
  const { credential } = result.registrationInfo;
  await env.DB.prepare(
    `INSERT INTO admin_passkeys (id, email, public_key, counter, transports, label, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(credential.id, email, isoBase64URL.fromBuffer(credential.publicKey), credential.counter,
      credential.transports?.join(",") ?? null, label.slice(0, 80) || "passkey", new Date().toISOString())
    .run();
  return true;
}

export async function loginOptions(url: URL) {
  const options = await generateAuthenticationOptions({
    rpID: ctx(url).rpID,
    userVerification: "required",
    allowCredentials: [], // discoverable: autentifikator sam ponudi ključ za ovu domenu
  });
  await storeChallenge(options.challenge, "login", null);
  return options;
}

/** Vraća e-mail vlasnika ključa ili null. Poruke greške namjerno ne razlikuju razloge. */
export async function verifyLogin(url: URL, response: AuthenticationResponseJSON): Promise<string | null> {
  const key = await env.DB.prepare("SELECT id, email, public_key, counter, transports FROM admin_passkeys WHERE id = ?")
    .bind(response.id)
    .first<PasskeyRow>();
  if (!key || !adminEmails().has(key.email)) return null;

  const { rpID, origin } = ctx(url);
  const result = await verifyAuthenticationResponse({
    response,
    expectedChallenge: async (c) => (await consumeChallenge(c, "login")) !== null,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
    credential: { id: key.id, publicKey: isoBase64URL.toBuffer(key.public_key), counter: key.counter, transports: transports(key.transports) },
  }).catch(() => null);
  if (!result?.verified) return null;

  await env.DB.prepare("UPDATE admin_passkeys SET counter = ?, last_used_at = ? WHERE id = ?")
    .bind(result.authenticationInfo.newCounter, new Date().toISOString(), key.id)
    .run();
  return key.email;
}

/** Ukradeni kolačić ne smije postati trajni passkey: svježa prijava i najviše 5 po e-mailu. */
const PASSKEY_REAUTH_SECONDS = 10 * 60;
const MAX_PASSKEYS_PER_EMAIL = 5;

export async function registerRefusal(s: { email: string; createdAt: string }): Promise<string | null> {
  const age = (Date.now() - Date.parse(s.createdAt)) / 1000;
  if (!(age <= PASSKEY_REAUTH_SECONDS)) {
    return "Za dodavanje passkeya prijava mora biti svježa (< 10 min): odjavi se i prijavi ponovno.";
  }
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM admin_passkeys WHERE email = ?").bind(s.email).first<{ n: number }>();
  if ((row?.n ?? 0) >= MAX_PASSKEYS_PER_EMAIL) {
    return `Najviše ${MAX_PASSKEYS_PER_EMAIL} passkeya po e-mailu — obriši stari pa dodaj novi.`;
  }
  return null;
}
