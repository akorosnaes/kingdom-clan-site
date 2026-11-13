// Read-only access to Google Sheets with a service account, with no dependencies.
//
// Netlify environment variables (Site configuration > Environment variables):
//   GOOGLE_SA_EMAIL  the service account's email (share the sheet with it as Viewer)
//   GOOGLE_SA_KEY    its private key (PEM). A key pasted on one line with literal "\n" is fixed up here.
import { createSign } from "node:crypto";
import { env } from "./auth.mjs";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const TIMEOUT_MS = 5000;
const REFRESH_MARGIN_S = 60;

export const configured = () => !!(env("GOOGLE_SA_EMAIL") && env("GOOGLE_SA_KEY"));

// The PEM from an env var: drops wrapping quotes and turns literal "\n" into newlines
export const normalizeKey = raw => String(raw).trim().replace(/^"|"$/g, "").replace(/\\n/g, "\n");

const b64url = v => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");

// A signed RS256 JWT for Google's token endpoint
export function signJwt({ email, key, scope = SCOPE, now = Math.floor(Date.now() / 1000) }){
  const input = b64url({ alg: "RS256", typ: "JWT" }) + "." +
    b64url({ iss: email, scope, aud: TOKEN_URL, iat: now, exp: now + 3600 });
  return input + "." + createSign("RSA-SHA256").update(input).sign(key, "base64url");
}

let cached = null;   // { token, exp (seconds) }

export const clearToken = () => { cached = null; };

async function accessToken(){
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.exp - REFRESH_MARGIN_S > now) return cached.token;
  const assertion = signJwt({ email: env("GOOGLE_SA_EMAIL"), key: normalizeKey(env("GOOGLE_SA_KEY")), now });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Google token request failed (${res.status})`);
  const body = await res.json();
  if (!body.access_token) throw new Error("Google token response had no access_token");
  cached = { token: body.access_token, exp: now + (Number(body.expires_in) || 3600) };
  return cached.token;
}

const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets/";

async function sheetsGet(url){
  const res = await fetch(url, { headers: { authorization: "Bearer " + await accessToken() }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (res.status === 401) clearToken();          // a rejected token is dropped so the next read signs in again
  if (!res.ok) throw new Error(`Google Sheets read failed (${res.status})`);
  return res.json();
}

// The rows of one A1 range, e.g. readRange(id, "'Drops'!A2:B27"). Empty cells at the end of a row are left out by Google.
export async function readRange(sheetId, range){
  const body = await sheetsGet(`${SHEETS}${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}?majorDimension=ROWS`);
  return Array.isArray(body.values) ? body.values : [];
}

const channel = c => Math.round((Number(c) || 0) * 255).toString(16).padStart(2, "0");
const hex = bg => bg && typeof bg === "object" ? "#" + channel(bg.red) + channel(bg.green) + channel(bg.blue) : null;
const FIELDS = "sheets(data(rowData(values(formattedValue,userEnteredFormat(backgroundColor)))))";

// The cells of one A1 range with their fill colour: rows of [{ v, bg }], v the shown text and bg "#rrggbb" or null.
// Google leaves out empty trailing cells, and rows with nothing in them come back as [].
export async function readGrid(sheetId, range){
  const body = await sheetsGet(`${SHEETS}${encodeURIComponent(sheetId)}?includeGridData=true&ranges=${encodeURIComponent(range)}&fields=${encodeURIComponent(FIELDS)}`);
  const rows = body.sheets?.[0]?.data?.[0]?.rowData;
  return Array.isArray(rows) ? rows.map(r => (r?.values || []).map(c => ({ v: c?.formattedValue ?? "", bg: hex(c?.userEnteredFormat?.backgroundColor) }))) : [];
}
